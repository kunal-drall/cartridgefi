import { NextResponse } from "next/server";
import { BOREL_DEPLOYMENT } from "@/lib/borel/deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let cached: { at: number; faucetOnline: boolean } | null = null;

/**
 * Reports the test-USDC mint (central constant BOREL_DEPLOYMENT.testUsdcMint) and whether the faucet
 * (POST /api/borel/faucet) is deployed, probing it server-side so a missing route never shows as a browser 404.
 */
export async function GET(req: Request) {
  const now = Date.now();
  if (!cached || now - cached.at > 30_000) {
    let faucetOnline = false;
    try {
      const res = await fetch(new URL("/api/borel/faucet", req.url), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      // The faucet is POST-only: 405 means deployed, 404 means not yet.
      faucetOnline = res.status !== 404 && res.status < 500;
    } catch {
      faucetOnline = false;
    }
    cached = { at: now, faucetOnline };
  }
  const mint = String(BOREL_DEPLOYMENT.testUsdcMint ?? "");
  return NextResponse.json(
    {
      faucetOnline: cached.faucetOnline,
      mint: MINT_RE.test(mint) ? mint : null,
      decimals: BOREL_DEPLOYMENT.testUsdcDecimals ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
