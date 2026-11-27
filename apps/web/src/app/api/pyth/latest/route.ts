import { fetchLatestPricesE9, parseMarketsParam, toWirePayload } from "@/lib/borel/pyth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Latest Pyth prices (Hermes with PYTH_API_KEY, else Solana mainnet push feeds), expo -9. */
export async function GET(request: Request): Promise<Response> {
  const markets = parseMarketsParam(new URL(request.url).searchParams.get("markets"));
  const result = await fetchLatestPricesE9(markets);
  return Response.json(toWirePayload(result), { headers: { "cache-control": "no-store" } });
}
