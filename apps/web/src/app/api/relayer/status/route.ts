import { NextResponse } from "next/server";
import {
  RELAYER_BALANCE_FLOOR_LAMPORTS,
  RELAYER_CLUSTER,
  getRelayerRpc,
  getRelayerSigner,
  isRelayerConfigured,
  solscanAccountUrl,
} from "@/lib/relayer/config";
import { RATE_LIMITS, withRateLimit } from "@/lib/relayer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getRelayerStatus(): Promise<NextResponse> {
  if (!isRelayerConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        funded: false,
        relayer: null,
        balanceLamports: "0",
        floorLamports: RELAYER_BALANCE_FLOOR_LAMPORTS.toString(),
        cluster: RELAYER_CLUSTER,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const signer = await getRelayerSigner();
    const { value: balance } = await getRelayerRpc()
      .getBalance(signer.address, { commitment: "confirmed" })
      .send();
    return NextResponse.json(
      {
        configured: true,
        funded: balance >= RELAYER_BALANCE_FLOOR_LAMPORTS,
        relayer: signer.address,
        balanceLamports: balance.toString(),
        floorLamports: RELAYER_BALANCE_FLOOR_LAMPORTS.toString(),
        cluster: RELAYER_CLUSTER,
        explorerUrl: solscanAccountUrl(signer.address),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { configured: true, funded: false, error: "Relayer status unavailable", cluster: RELAYER_CLUSTER },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = withRateLimit(RATE_LIMITS.relayerStatus, getRelayerStatus);
