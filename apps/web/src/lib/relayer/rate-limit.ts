// Server-only: simple in-memory sliding-window limiter (per serverless instance).
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;
const MAX_TRACKED_KEYS = 5_000;

const hits = new Map<string, number[]>();

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSecs: number;
  remaining: number;
}

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitVerdict {
  const windowStart = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = recent[0] ?? now;
    hits.set(key, recent);
    return {
      allowed: false,
      retryAfterSecs: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
      remaining: 0,
    };
  }

  recent.push(now);
  hits.set(key, recent);

  if (hits.size > MAX_TRACKED_KEYS) {
    for (const [k, times] of hits) {
      if (times.every((t) => t <= windowStart)) hits.delete(k);
    }
  }

  return {
    allowed: true,
    retryAfterSecs: 0,
    remaining: MAX_REQUESTS_PER_WINDOW - recent.length,
  };
}
