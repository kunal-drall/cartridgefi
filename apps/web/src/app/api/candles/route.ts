import { NextResponse } from "next/server";
import { getLiveCandles } from "@/lib/live-markets";

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "SOL-USD";
  const interval = searchParams.get("interval") ?? "5m";

  const data = await getLiveCandles(symbol, interval);
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
    },
  });
}
