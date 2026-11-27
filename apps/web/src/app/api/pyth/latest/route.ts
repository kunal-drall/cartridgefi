import { fetchLatestPricesE9, parseMarketsParam, toWirePayload } from "@/lib/borel/pyth";
import { RATE_LIMITS, withRateLimit } from "@/lib/relayer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Latest Pyth prices (Hermes with PYTH_API_KEY, else Solana mainnet push feeds), expo -9. */
async function getLatest(request: Request): Promise<Response> {
  const markets = parseMarketsParam(new URL(request.url).searchParams.get("markets"));
  const result = await fetchLatestPricesE9(markets);
  return Response.json(toWirePayload(result), { headers: { "cache-control": "no-store" } });
}

export const GET = withRateLimit(RATE_LIMITS.pythLatest, getLatest);
