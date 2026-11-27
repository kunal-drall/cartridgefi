import { NextResponse } from "next/server";
import { getLiveMarketsSnapshot } from "@/lib/live-markets";

export async function GET(): Promise<NextResponse> {
  const snapshot = await getLiveMarketsSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
    },
  });
}
