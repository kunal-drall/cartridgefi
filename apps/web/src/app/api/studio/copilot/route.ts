import { NextResponse } from "next/server";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import {
  BOREL_GAMEDAY_MANIFEST,
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  CartridgeManifestV2Schema,
  PULSE_RUNNER_MANIFEST,
  PYTH_FEED_IDS,
  SOLANA_CANONICAL_MINTS,
  simulateCartridgeEconomy,
  validateManifestCompliance,
  type CartridgeManifestV2,
} from "@cartridgefi/shared-types";
import { deriveCartridgeDeploymentPlan } from "@cartridgefi/sdk";
import { getLiveMarketsSnapshot } from "@/lib/live-markets";

function slugifyPrompt(input: string): string {
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["build", "make", "create", "with", "that", "from", "into", "using"].includes(w))
    .slice(0, 4);
  const base = words.length > 0 ? words.join("-") : "custom-market-arena";
  return base.slice(0, 38);
}

function synthesizeDeterministicManifest(
  prompt: string,
  liveKalshiTicker: string,
  creatorWallet: string,
): { manifest: CartridgeManifestV2; summary: string } {
  const lower = prompt.toLowerCase();
  const isRunner =
    lower.includes("runner") ||
    lower.includes("lane") ||
    lower.includes("arcade") ||
    lower.includes("subway");
  const isBracket =
    lower.includes("bracket") ||
    lower.includes("kalshi") ||
    lower.includes("fed") ||
    lower.includes("fomc") ||
    lower.includes("election");

  const wantsTsla = lower.includes("tsla");
  const wantsNvda = lower.includes("nvda") || (!wantsTsla && !lower.includes("spy"));
  const wantsSpy = lower.includes("spy") || lower.includes("s&p") || lower.includes("macro");

  const durationMatch = lower.match(/(\d+)\s*(?:s|sec|second)/);
  const minMatch = lower.match(/(\d+)\s*(?:m|min|minute)/);
  let durationSecs = isRunner ? 90 : 120;
  if (durationMatch?.[1]) {
    durationSecs = Math.max(30, Math.min(86_400, Number(durationMatch[1])));
  } else if (minMatch?.[1]) {
    durationSecs = Math.max(60, Math.min(86_400, Number(minMatch[1]) * 60));
  }

  const slug = slugifyPrompt(prompt);
  const titleWords = slug
    .split("-")
    .map((w) =>
      ["nvda", "nvdax", "tsla", "tslax", "spy", "spyx", "sol", "btc", "fomc", "tee"].includes(w)
        ? w.toUpperCase()
        : `${w.charAt(0).toUpperCase()}${w.slice(1)}`,
    )
    .join(" ");

  if (isRunner) {
    const base = structuredClone(PULSE_RUNNER_MANIFEST);
    const primaryEquity = wantsTsla ? "TSLAx" : "NVDAx";
    base.metadata.slug = slug;
    base.metadata.title = titleWords.toLowerCase().endsWith("runner")
      ? titleWords
      : `${titleWords} Runner`;
    base.metadata.subtitle = `Live ${primaryEquity} + SOL-USD volatility runner settled on Solana Devnet via MagicBlock ER.`;
    base.metadata.creatorWallet = creatorWallet;
    base.magicblockRoomConfig.durationSecs = durationSecs;
    base.marketUniverse = [
      {
        alias: "SOL_PERP",
        venue: "PHOENIX_PERP",
        symbol: "SOL-PERP",
        pythFeedId: PYTH_FEED_IDS["SOL/USD"],
      },
      {
        alias: primaryEquity,
        venue: "JUPITER_XSTOCKS",
        symbol: primaryEquity,
        mint: SOLANA_CANONICAL_MINTS[primaryEquity],
        ...(primaryEquity === "NVDAx"
          ? { pythFeedId: PYTH_FEED_IDS["NVDAx/USD"] }
          : {}),
      },
    ];
    base.actionBindings = [
      {
        gameEvent: "PLAYER_LANE_SWITCH",
        bindingType: "CONTINUOUS_STANCE_VECTOR",
        mapping: {
          LANE_LEFT: { asset: "SOL_PERP", weightBps: -5000 },
          LANE_CENTER: { asset: primaryEquity, weightBps: 2500 },
          LANE_RIGHT: { asset: primaryEquity, weightBps: 7500 },
        },
        nettingPolicy: "NET_AT_CHECKPOINTS_30S",
      },
    ];
    return {
      manifest: base,
      summary: `Compiled 3-lane ARCADE_RUNNER manifest "${slug}" (${durationSecs}s window) bound to live SOL-USD and ${primaryEquity} Raydium pools with 30s stance netting.`,
    };
  }

  const base = structuredClone(BOREL_GAMEDAY_MANIFEST);
  base.metadata.slug = slug;
  base.metadata.title = titleWords;
  base.metadata.genre = isBracket ? "PREDICTION_BRACKET" : "BOREL_GAMEDAY";
  base.metadata.subtitle = `Hardware-sealed TEE conviction arena pairing live Solana xStocks with Kalshi ${liveKalshiTicker}.`;
  base.metadata.creatorWallet = creatorWallet;
  base.magicblockRoomConfig.durationSecs = durationSecs;
  base.scoringAndPrizes.primaryFormula = isBracket
    ? "KALSHI_BRIER_CALIBRATION"
    : "DIRECTION_NEUTRAL_REL_RETURN";

  const marketUniverse: CartridgeManifestV2["marketUniverse"] = [
    {
      alias: "SOL_PERP",
      venue: "PHOENIX_PERP",
      symbol: "SOL-PERP",
      pythFeedId: PYTH_FEED_IDS["SOL/USD"],
    },
  ];
  const allowedAssets = ["SOL_PERP"];

  if (wantsNvda) {
    marketUniverse.push({
      alias: "NVDAx",
      venue: "JUPITER_XSTOCKS",
      symbol: "NVDAx",
      mint: SOLANA_CANONICAL_MINTS.NVDAx,
      pythFeedId: PYTH_FEED_IDS["NVDAx/USD"],
    });
    allowedAssets.push("NVDAx");
  }
  if (wantsTsla) {
    marketUniverse.push({
      alias: "TSLAx",
      venue: "JUPITER_XSTOCKS",
      symbol: "TSLAx",
      mint: SOLANA_CANONICAL_MINTS.TSLAx,
    });
    allowedAssets.push("TSLAx");
  }
  if (wantsSpy || allowedAssets.length < 2) {
    marketUniverse.push({
      alias: "SPYx",
      venue: "JUPITER_XSTOCKS",
      symbol: "SPYx",
      mint: SOLANA_CANONICAL_MINTS.SPYx,
      pythFeedId: PYTH_FEED_IDS["SPYx/USD"],
    });
    allowedAssets.push("SPYx");
  }
  marketUniverse.push({
    alias: "KALSHI_CATALYST",
    venue: "DFLOW_KALSHI",
    symbol: liveKalshiTicker,
    marketId: liveKalshiTicker,
  });

  base.marketUniverse = marketUniverse;
  base.actionBindings = [
    {
      gameEvent: "SUBMIT_CONVICTION_VECTOR",
      bindingType: "CONVICTION_WEIGHT_VECTOR",
      maxRebalances: 4,
      allowedAssets,
      nettingPolicy: "NET_ON_ENTRY_AND_SETTLEMENT",
    },
    {
      gameEvent: "LOCK_BINARY_CALL",
      bindingType: "BINARY_OUTCOME_CALL",
      asset: "KALSHI_CATALYST",
      scoreCarryMultiplierBps: 12500,
    },
  ];

  return {
    manifest: base,
    summary: `Compiled ${base.metadata.genre} manifest "${slug}" (${durationSecs}s, 75% Intel TDX Fog-of-War) bound to live ${allowedAssets.join(", ")} + Kalshi ${liveKalshiTicker}.`,
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  let prompt = "";
  let creatorWallet: string = CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper;

  try {
    const body = (await req.json()) as {
      prompt?: unknown;
      creatorWallet?: unknown;
    };
    if (typeof body.prompt === "string") {
      prompt = body.prompt.trim();
    }
    if (
      typeof body.creatorWallet === "string" &&
      body.creatorWallet.trim().length >= 32
    ) {
      creatorWallet = body.creatorWallet.trim();
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!prompt) {
    return NextResponse.json(
      { error: "Provide a natural-language cartridge specification prompt." },
      { status: 400 },
    );
  }

  // Pull real live markets so the compiler binds actual live Kalshi & Solana tickers
  const liveSnapshot = await getLiveMarketsSnapshot();
  const topKalshi =
    liveSnapshot.kalshiContracts[0]?.ticker ?? "KXFEDDECISION-26DEC-H25";

  // Build baseline manifest via deterministic compiler first
  let { manifest, summary } = synthesizeDeterministicManifest(
    prompt,
    topKalshi,
    creatorWallet,
  );
  let engineUsed = "mcp-deterministic-compiler";

  // If Vercel AI Gateway key is configured, run AI SDK v7 tool-calling agent
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  if (gatewayKey) {
    try {
      const result = await generateText({
        model: "anthropic/claude-sonnet-4.5",
        stopWhen: isStepCount(3),
        system: `You are the CartridgeFi Protocol Compiler using @cartridgefi/mcp tools on Solana (${CARTRIDGE_PROGRAM_IDS.registry}). Refine the CartridgeManifest v2 parameters based on the user's request and call configureManifest.`,
        prompt: `User prompt: "${prompt}". Available live Kalshi contracts: ${liveSnapshot.kalshiContracts
          .slice(0, 4)
          .map((c) => `${c.ticker} (${c.eventTitle}: ${c.subtitle} @ $${c.lastPrice})`)
          .join("; ")}.`,
        tools: {
          configureManifest: tool({
            description:
              "Configure durationSecs, fogOfWarBps, and creatorFeeShareBps on the synthesized CartridgeManifest v2",
            inputSchema: z.object({
              title: z.string().min(3).max(80),
              subtitle: z.string().min(4).max(160),
              durationSecs: z.number().int().min(30).max(86400),
              fogOfWarBps: z.number().int().min(0).max(9000),
              creatorFeeShareBps: z.number().int().min(0).max(5000),
            }),
            execute: async (patch) => {
              manifest = {
                ...manifest,
                metadata: {
                  ...manifest.metadata,
                  title: patch.title,
                  subtitle: patch.subtitle,
                  creatorFeeShareBps: patch.creatorFeeShareBps,
                },
                magicblockRoomConfig: {
                  ...manifest.magicblockRoomConfig,
                  durationSecs: patch.durationSecs,
                  fogOfWarBps: patch.fogOfWarBps,
                },
              };
              return { status: "updated", slug: manifest.metadata.slug };
            },
          }),
        },
      });
      if (result.text) {
        summary = result.text;
      }
      engineUsed = "vercel-ai-sdk-v7";
    } catch {
      // Fallback cleanly to deterministic MCP synthesis
    }
  }

  const parsed = CartridgeManifestV2Schema.parse(manifest);
  const compliance = validateManifestCompliance(parsed);
  const plan = await deriveCartridgeDeploymentPlan(parsed, {
    network: "devnet",
  });
  const simulation = simulateCartridgeEconomy(parsed, "calm", 500, 24);

  return NextResponse.json({
    ok: true,
    engineUsed,
    summary,
    liveMarketsBound: {
      kalshiTicker: topKalshi,
      spotQuotes: liveSnapshot.markets.map((m) => ({
        symbol: m.symbol,
        priceUsd: m.priceUsd,
      })),
    },
    manifest: parsed,
    compliance,
    pdaPreview: {
      manifestPda: plan.cartridgeManifestPda,
      roomShardPda: plan.roomShardPda,
      roomVaultPda: plan.roomVaultPda,
      creatorFeeVaultPda: plan.creatorFeeVaultPda,
    },
    simulation,
  });
}
