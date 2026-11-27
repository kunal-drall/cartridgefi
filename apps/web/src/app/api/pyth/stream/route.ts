import {
  fetchLatestPricesE9,
  parseMarketsParam,
  toWirePayload,
} from "@/lib/borel/pyth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-store",
  connection: "keep-alive",
} as const;

/**
 * Same-origin Pyth SSE stream for the browser.
 * Polls the shared server quote cache once a second (Hermes per feed when PYTH_API_KEY is set,
 * with on-chain push-feed fallback for feeds the key is not entitled to; push feeds only without
 * a key) and emits an event whenever a publish time changes, plus a 15s keep-alive comment.
 */
export async function GET(request: Request): Promise<Response> {
  const markets = parseMarketsParam(new URL(request.url).searchParams.get("markets"));

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer) clearInterval(timer);
    if (keepAlive) clearInterval(keepAlive);
    timer = null;
    keepAlive = null;
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSignature = "";
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        stop();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };
      const tick = async (): Promise<void> => {
        const payload = toWirePayload(await fetchLatestPricesE9(markets));
        const signature = payload.parsed
          .map((p) => `${p.id}:${p.price.publish_time}:${p.price.price}`)
          .join("|");
        if (closed || signature === lastSignature) return;
        lastSignature = signature;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          close();
        }
      };
      void tick();
      timer = setInterval(() => {
        void tick();
      }, 1_000);
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          close();
        }
      }, 15_000);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      stop();
    },
  });

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
