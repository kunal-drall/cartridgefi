import "server-only";

/**
 * Shared per-IP rate limiting for every Borel / relayer / Pyth / protocol route.
 *
 * Scope: IN-MEMORY, PER SERVERLESS INSTANCE. Each Vercel function instance keeps its own counters
 * (state is pinned to globalThis, so all routes in one process share them),
 * so the effective ceiling is `limit × live instances`, and counters reset on cold start. This bounds
 * accidental hammering and cheap single-origin abuse; a global guarantee needs a shared store
 * (Vercel KV / Upstash) or the Vercel Firewall rate-limit rules in front of these routes.
 *
 * Algorithm: sliding-window log per `${policy}:${ip}` key; the key map is bounded (LRU eviction).
 * Responses carry IETF draft `RateLimit-*` headers plus `Retry-After` on 429.
 */

export interface RateLimitPolicy {
  /** Short stable id, also the counter namespace. */
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

/** Per-IP budgets. Sized for the real client cadence with headroom for shared NAT egress. */
export const RATE_LIMITS = {
  /** POST join / lock / pivot / settle (relayer-paid). */
  borelWrite: { name: "borel-write", limit: 6, windowMs: 60_000 },
  /** GET /api/borel/room — each read walks room signatures on the devnet RPC. */
  borelRoom: { name: "borel-room", limit: 120, windowMs: 60_000 },
  /** GET /api/relayer/status — the inspector polls every 15 s. */
  relayerStatus: { name: "relayer-status", limit: 120, windowMs: 60_000 },
  /** GET /api/pyth/latest — the REST fallback polls every 2 s (30/min) per tab. */
  pythLatest: { name: "pyth-latest", limit: 120, windowMs: 60_000 },
  /** GET /api/pyth/stream — new stream opens (each stream reconnects about once a minute). */
  pythStream: { name: "pyth-stream", limit: 60, windowMs: 60_000 },
  /** GET /api/protocol/fee-inflows — inspector polls every 30 s. */
  protocolFeeInflows: { name: "protocol-fee-inflows", limit: 120, windowMs: 60_000 },
  /** GET /api/protocol-telemetry — inspector polls every 15 s. */
  protocolTelemetry: { name: "protocol-telemetry", limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

/** Concurrent open Pyth SSE streams per IP (several tabs behind one NAT). */
export const PYTH_STREAMS_PER_IP = 8;

const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the oldest counted request leaves the window (0 when the window is empty). */
  resetSecs: number;
  /** Seconds to wait before retrying (0 when allowed). */
  retryAfterSecs: number;
}

interface LimiterState {
  hits: Map<string, number[]>;
  openStreams: Map<string, number>;
}
// Pinned to globalThis so every route bundle (and dev HMR re-evaluations) share one set of counters per process.
const STATE_KEY = Symbol.for("cartridgefi.relayer.rate-limit.v1");
const state: LimiterState = ((globalThis as Record<symbol, unknown>)[STATE_KEY] as LimiterState | undefined) ??
  ((globalThis as Record<symbol, unknown>)[STATE_KEY] = { hits: new Map(), openStreams: new Map() } satisfies LimiterState) as LimiterState;
const hits = state.hits;

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

const LONGEST_WINDOW_MS = Math.max(...Object.values(RATE_LIMITS).map((p) => p.windowMs));

function evictIfFull(now: number): void {
  if (hits.size <= MAX_TRACKED_KEYS) return;
  for (const [k, times] of hits) {
    const last = times[times.length - 1];
    if (last === undefined || last <= now - LONGEST_WINDOW_MS) hits.delete(k);
  }
  // Still over the cap: drop least-recently-used keys (Map keeps insertion order; hits re-insert).
  for (const k of hits.keys()) {
    if (hits.size <= MAX_TRACKED_KEYS) break;
    hits.delete(k);
  }
}

/** Counts one request against `policy` for `subject` (usually the client IP). */
export function takeRateLimit(
  policy: RateLimitPolicy,
  subject: string,
  now: number = Date.now(),
): RateLimitVerdict {
  const key = `${policy.name}:${subject}`;
  const windowStart = now - policy.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  hits.delete(key);

  if (recent.length >= policy.limit) {
    hits.set(key, recent);
    const oldest = recent[0] ?? now;
    const wait = Math.max(1, Math.ceil((oldest + policy.windowMs - now) / 1000));
    return { allowed: false, limit: policy.limit, remaining: 0, resetSecs: wait, retryAfterSecs: wait };
  }

  recent.push(now);
  hits.set(key, recent);
  evictIfFull(now);

  const oldest = recent[0] ?? now;
  return {
    allowed: true,
    limit: policy.limit,
    remaining: policy.limit - recent.length,
    resetSecs: Math.max(0, Math.ceil((oldest + policy.windowMs - now) / 1000)),
    retryAfterSecs: 0,
  };
}

/** Back-compat helper for the relayer-paid POST routes (6 requests / minute / IP). */
export function checkRateLimit(key: string, now: number = Date.now()): RateLimitVerdict {
  return takeRateLimit(RATE_LIMITS.borelWrite, key, now);
}

export function applyRateLimitHeaders(headers: Headers, policy: RateLimitPolicy, verdict: RateLimitVerdict): void {
  headers.set("ratelimit-limit", String(verdict.limit));
  headers.set("ratelimit-remaining", String(verdict.remaining));
  headers.set("ratelimit-reset", String(verdict.resetSecs));
  headers.set("ratelimit-policy", `${policy.limit};w=${Math.round(policy.windowMs / 1000)}`);
  if (!verdict.allowed) headers.set("retry-after", String(verdict.retryAfterSecs));
}

/** 429 body shaped for every caller: Borel clients read `status`/`reason`, pollers read `ok`. */
export function rateLimitedResponse(policy: RateLimitPolicy, verdict: RateLimitVerdict, reason?: string): Response {
  const res = Response.json(
    {
      status: "error",
      ok: false,
      error: "rate_limited",
      reason: reason ?? `Rate limited — retry in ${verdict.retryAfterSecs}s`,
      retryAfterSecs: verdict.retryAfterSecs,
    },
    { status: 429, headers: { "cache-control": "no-store" } },
  );
  applyRateLimitHeaders(res.headers, policy, verdict);
  return res;
}

/** Wraps a route handler: 429 when over budget, otherwise the handler's response plus RateLimit headers. */
export function withRateLimit<Rest extends unknown[]>(
  policy: RateLimitPolicy,
  handler: (req: Request, ...rest: Rest) => Promise<Response>,
): (req: Request, ...rest: Rest) => Promise<Response> {
  return async (req: Request, ...rest: Rest): Promise<Response> => {
    const verdict = takeRateLimit(policy, clientIpFromRequest(req));
    if (!verdict.allowed) return rateLimitedResponse(policy, verdict);
    const res = await handler(req, ...rest);
    applyRateLimitHeaders(res.headers, policy, verdict);
    return res;
  };
}

/* ------------------------- concurrent stream slots ------------------------- */

const openStreams = state.openStreams;

/**
 * Reserves one concurrent-stream slot for `subject`. Returns an idempotent release function, or
 * null when `max` streams are already open (per instance, like the counters above).
 */
export function acquireStreamSlot(subject: string, max: number): (() => void) | null {
  const open = openStreams.get(subject) ?? 0;
  if (open >= max) return null;
  openStreams.set(subject, open + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const now = (openStreams.get(subject) ?? 1) - 1;
    if (now <= 0) openStreams.delete(subject);
    else openStreams.set(subject, now);
  };
}
