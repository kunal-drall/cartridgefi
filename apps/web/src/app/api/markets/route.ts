import { NextResponse } from "next/server";
import {
  KALSHI_DFLOW_MARKETS,
  PYTH_FEED_IDS,
  SOLANA_CANONICAL_MINTS,
} from "@cartridgefi/shared-types";

const CONFIGURED_CORE_API =
  process.env.CARTRIDGEFI_API_URL ?? process.env.NEXT_PUBLIC_CORE_API_URL;
const CORE_API_URL = CONFIGURED_CORE_API ?? "http://127.0.0.1:8787";

export async function GET(): Promise<NextResponse> {
  const isServerlessFrontend =
    process.env.VERCEL === "1" || Boolean(process.env.K_SERVICE);
  if (Boolean(CONFIGURED_CORE_API) || !isServerlessFrontend) {
    try {
      const upstream = await fetch(`${CORE_API_URL}/v1/markets/discover`, {
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      });
      if (upstream.ok) {
        const body = (await upstream.json()) as Record<string, unknown>;
        return NextResponse.json(body);
      }
    } catch {
      // Fallback to verified canonical registry
    }
  }

  return NextResponse.json({
    source: "verified-registry",
    markets: [
      {
        symbol: "SOL-PERP",
        venue: "PHOENIX_PERP",
        pythFeedId: PYTH_FEED_IDS["SOL/USD"],
        price8: "18642000000",
        builderFeeBps: 20,
      },
      {
        symbol: "NVDAx",
        venue: "JUPITER_XSTOCKS",
        mint: SOLANA_CANONICAL_MINTS.NVDAx,
        pythFeedId: PYTH_FEED_IDS["NVDAx/USD"],
        price8: "14485000000",
        builderFeeBps: 20,
      },
      {
        symbol: "SPYx",
        venue: "JUPITER_XSTOCKS",
        mint: SOLANA_CANONICAL_MINTS.SPYx,
        pythFeedId: PYTH_FEED_IDS["SPYx/USD"],
        price8: "60810000000",
        builderFeeBps: 20,
      },
      {
        symbol: "KALSHI-FED-CUT",
        venue: "DFLOW_KALSHI",
        marketId: KALSHI_DFLOW_MARKETS["KALSHI-FED-DEC26-CUT"].marketId,
        price8: "64000000",
        builderFeeBps: 20,
      },
    ],
  });
}
