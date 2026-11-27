import { fetchLatestPricesE9, parseMarketsParam, toWirePayload } from "@/lib/borel/pyth";
import {
  PYTH_STREAMS_PER_IP,
  RATE_LIMITS,
  acquireStreamSlot,
  applyRateLimitHeaders,
  clientIpFromRequest,
  takeRateLimit,
} from "@/lib/relayer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Fits every Vercel plan; the stream closes itself before this so the function never times out. */
export const maxDuration = 60;

/** Server-side stream lifetime; the browser hook reconnects when the stream ends cleanly. */
const STREAM_LIFETIME_MS = 50_000;
const TICK_MS = 1_000;
const KEEP_ALIVE_MS = 15_000;

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-store",
  connection: "keep-alive",
} as const;

/**
 * Same-origin Pyth SSE stream for the browser.
 * Polls the shared all-markets server quote cache once a second (Hermes per feed when PYTH_API_KEY is
 * set, with on-chain push-feed fallback for feeds the key is not entitled to; push feeds only without
 * a key) and emits an event whenever a publish time changes, plus a 15 s keep-alive comment.
 * Limits: PYTH_STREAMS_PER_IP concurrent streams and RATE_LIMITS.pythStream opens per minute per IP.
 * After STREAM_LIFETIME_MS it sends a data-less `reconnect` event and closes cleanly.
 */
function streamFallback(verdict: Parameters<typeof applyRateLimitHeaders>[2]): Response {
  const res = new Response("event: fallback\nretry: 10000\n\n", {
    status: 200,
    headers: { ...SSE_HEADERS, "x-borel-stream": "fallback" },
  });
  applyRateLimitHeaders(res.headers, RATE_LIMITS.pythStream, verdict);
  return res;
}

export async function GET(request: Request): Promise<Response> {
  const ip = clientIpFromRequest(request);
  const verdict = takeRateLimit(RATE_LIMITS.pythStream, ip);
  // Over the limit, degrade instead of erroring: a 200 with `x-borel-stream: fallback` tells the
  // browser hook to switch to REST polling (/api/pyth/latest), which has its own limit. A 429 here
  // would surface as a console error for ordinary users behind a shared IP.
  if (!verdict.allowed) return streamFallback(verdict);
  const release = acquireStreamSlot(ip, PYTH_STREAMS_PER_IP);
  if (!release) return streamFallback({ ...verdict, allowed: false, retryAfterSecs: 5 });

  const markets = parseMarketsParam(new URL(request.url).searchParams.get("markets"));
  const encoder = new TextEncoder();
  let shutdown: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSignature = "";
      let closed = false;
      let inFlight = false;
      const timers: ReturnType<typeof setTimeout>[] = [];

      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const close = (): void => {
        if (closed) return;
        closed = true;
        for (const t of timers) clearInterval(t);
        request.signal.removeEventListener("abort", close);
        release();
        try {
          controller.close();
        } catch {
          // Already closed or cancelled by the runtime.
        }
      };
      shutdown = close;

      const tick = async (): Promise<void> => {
        if (closed || inFlight) return;
        inFlight = true;
        try {
          const payload = toWirePayload(await fetchLatestPricesE9(markets));
          const signature = payload.parsed.map((p) => `${p.id}:${p.price.publish_time}:${p.price.price}`).join("|");
          if (signature !== lastSignature) {
            lastSignature = signature;
            send(`data: ${JSON.stringify(payload)}\n\n`);
          }
        } catch {
          // Quote cache never rejects; keep the stream alive regardless.
        } finally {
          inFlight = false;
        }
      };

      void tick();
      timers.push(setInterval(() => void tick(), TICK_MS));
      timers.push(setInterval(() => send(": keep-alive\n\n"), KEEP_ALIVE_MS));
      timers.push(
        setTimeout(() => {
          // No `data:` line: clients ignore it as a price payload; it only marks a planned close.
          send("event: reconnect\nretry: 500\n\n");
          close();
        }, STREAM_LIFETIME_MS),
      );
      if (request.signal.aborted) close();
      else request.signal.addEventListener("abort", close);
    },
    cancel() {
      shutdown?.();
    },
  });

  const res = new Response(body, { status: 200, headers: SSE_HEADERS });
  applyRateLimitHeaders(res.headers, RATE_LIMITS.pythStream, verdict);
  return res;
}
