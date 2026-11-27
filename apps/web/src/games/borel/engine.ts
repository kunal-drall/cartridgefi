import {
  CARTRIDGE_PROGRAM_IDS,
  FP_SCALE,
  MAGICBLOCK_CONSTANTS,
  RoomPhaseCode,
  SOLANA_CANONICAL_MINTS,
  USDC_UNIT,
  absBigInt,
  computeDirectionNeutralRelativeReturn,
  computeKalshiBrierScore,
  computeMultiStageCarryScore,
  computePoolAndFeeDistribution,
  computeUpdatedMarketElo,
  decodeWorldPulseFrame,
  encodeWorldPulseFrame,
  formatScaledBigInt,
  type ClaimAssetSymbol,
  type PoolDistributionResult,
} from "@cartridgefi/shared-types";
import type { ConvictionAllocationLeg } from "@cartridgefi/ui-system";

export type BorelDurationMode = 60 | 180;
export type BorelSessionMode = "PAPER" | "LIVE";
export type BorelAssetSymbol = "SOL-PERP" | "NVDAx" | "SPYx";
export type BorelKalshiCall = "YES" | "NO";

export interface BorelChipAllocation {
  symbol: BorelAssetSymbol;
  direction: "LONG" | "SHORT";
  /** Integer chips in [0, 100]; sum across legs must be <= 100. */
  chips: number;
}

export interface BorelMarketQuote {
  symbol: "SOL-PERP" | "NVDAx" | "SPYx" | "KALSHI-FED-CUT";
  venue: string;
  price8: bigint;
  entryPrice8: bigint;
  velocityBps: number;
  displayPrice: string;
  deltaBpsFormatted: string;
}

export interface BorelPodCompetitor {
  id: string;
  handle: string;
  isPlayer: boolean;
  cipherDigest: string;
  kalshiCall: BorelKalshiCall;
  legs: readonly BorelChipAllocation[];
  allocationsUi: readonly ConvictionAllocationLeg[];
  rawRelScoreScaled: bigint;
  compositeScoreScaled: bigint;
  deltaBpsFormatted: string;
  rank: number;
}

export interface BorelSettlementSummary {
  roundCode: string;
  vrfProgramId: string;
  vrfSeedHex: string;
  l1CommitSignature: string;
  playerRank: number;
  playerScoreBpsFormatted: string;
  playerScoreScaled: bigint;
  prevEloScaled: bigint;
  nextEloScaled: bigint;
  deltaEloScaled: bigint;
  poolDistribution: PoolDistributionResult;
  playerPayoutUsdcAtomic: bigint;
}

// 24-step deterministic market tape in 10^8 Pyth integer units (zero Math.random)
const SOL_TAPE_8: readonly bigint[] = [
  19_420_000_000n,
  19_436_000_000n,
  19_452_000_000n,
  19_444_000_000n,
  19_468_000_000n,
  19_491_000_000n,
  19_512_000_000n,
  19_503_000_000n,
  19_529_000_000n,
  19_548_000_000n,
  19_534_000_000n,
  19_561_000_000n,
  19_579_000_000n,
  19_566_000_000n,
  19_592_000_000n,
  19_615_000_000n,
  19_604_000_000n,
  19_628_000_000n,
  19_645_000_000n,
  19_639_000_000n,
  19_662_000_000n,
  19_684_000_000n,
  19_671_000_000n,
  19_695_000_000n,
];

const NVDA_TAPE_8: readonly bigint[] = [
  14_680_000_000n,
  14_705_000_000n,
  14_732_000_000n,
  14_758_000_000n,
  14_749_000_000n,
  14_784_000_000n,
  14_812_000_000n,
  14_839_000_000n,
  14_828_000_000n,
  14_865_000_000n,
  14_894_000_000n,
  14_918_000_000n,
  14_906_000_000n,
  14_935_000_000n,
  14_964_000_000n,
  14_992_000_000n,
  14_981_000_000n,
  15_014_000_000n,
  15_042_000_000n,
  15_068_000_000n,
  15_059_000_000n,
  15_088_000_000n,
  15_112_000_000n,
  15_138_000_000n,
];

const SPY_TAPE_8: readonly bigint[] = [
  59_410_000_000n,
  59_402_000_000n,
  59_394_000_000n,
  59_388_000_000n,
  59_396_000_000n,
  59_382_000_000n,
  59_374_000_000n,
  59_368_000_000n,
  59_375_000_000n,
  59_361_000_000n,
  59_354_000_000n,
  59_348_000_000n,
  59_356_000_000n,
  59_342_000_000n,
  59_335_000_000n,
  59_329_000_000n,
  59_338_000_000n,
  59_324_000_000n,
  59_318_000_000n,
  59_311_000_000n,
  59_319_000_000n,
  59_305_000_000n,
  59_298_000_000n,
  59_290_000_000n,
];

// Kalshi YES cents in 10^8 scale (e.g. 68_000_000n = $0.68 = 68¢ YES)
const KALSHI_FED_YES_8: readonly bigint[] = [
  66_000_000n,
  66_500_000n,
  67_000_000n,
  67_200_000n,
  67_800_000n,
  68_400_000n,
  68_900_000n,
  68_600_000n,
  69_200_000n,
  69_800_000n,
  70_100_000n,
  70_600_000n,
  70_400_000n,
  71_000_000n,
  71_500_000n,
  72_100_000n,
  71_800_000n,
  72_400_000n,
  72_900_000n,
  73_300_000n,
  73_100_000n,
  73_800_000n,
  74_200_000n,
  74_600_000n,
];

export const ANTX_REFERENCE_PRICE_8 = 6_240_000_000n; // $62.40

const RIVAL_DEFINITIONS: readonly {
  id: string;
  handle: string;
  cipherDigest: string;
  kalshiCall: BorelKalshiCall;
  legs: readonly BorelChipAllocation[];
}[] = [
  {
    id: "borel-rival-pod-1",
    handle: "@AlphaQuant",
    cipherDigest: "0x9e4b…2a8c",
    kalshiCall: "YES",
    legs: [
      { symbol: "NVDAx", direction: "LONG", chips: 45 },
      { symbol: "SOL-PERP", direction: "LONG", chips: 30 },
      { symbol: "SPYx", direction: "LONG", chips: 25 },
    ],
  },
  {
    id: "borel-rival-pod-2",
    handle: "@BorelSigma",
    cipherDigest: "0x7c1d…f309",
    kalshiCall: "NO",
    legs: [
      { symbol: "SOL-PERP", direction: "LONG", chips: 50 },
      { symbol: "NVDAx", direction: "SHORT", chips: 30 },
      { symbol: "SPYx", direction: "SHORT", chips: 20 },
    ],
  },
  {
    id: "borel-rival-pod-3",
    handle: "@KalshiHawk",
    cipherDigest: "0x5a82…d411",
    kalshiCall: "YES",
    legs: [
      { symbol: "SOL-PERP", direction: "SHORT", chips: 45 },
      { symbol: "NVDAx", direction: "LONG", chips: 35 },
      { symbol: "SPYx", direction: "LONG", chips: 20 },
    ],
  },
];

export function formatPrice8Usd(price8: bigint): string {
  const whole = price8 / 100_000_000n;
  const cents = ((price8 % 100_000_000n) / 1_000_000n).toString().padStart(2, "0");
  return `$${new Intl.NumberFormat("en-US").format(whole)}.${cents}`;
}

export function formatScoreBps(scoreScaled: bigint): string {
  const bpsScaled = scoreScaled * 10_000n;
  const sign = bpsScaled >= 0n ? "+" : "";
  return `${sign}${formatScaledBigInt(bpsScaled, 1)} bps`;
}

export function getShowdownUnsealThreshold(durationSecs: BorelDurationMode): number {
  return durationSecs === 180 ? 30 : 15;
}

export function getBorelMarketSnapshot(tickIndex: number): {
  quotes: readonly BorelMarketQuote[];
  pulseVerified: boolean;
} {
  const idx = ((tickIndex % SOL_TAPE_8.length) + SOL_TAPE_8.length) % SOL_TAPE_8.length;
  const prevIdx = idx === 0 ? 0 : idx - 1;

  const sol8 = SOL_TAPE_8[idx] ?? SOL_TAPE_8[0]!;
  const nvda8 = NVDA_TAPE_8[idx] ?? NVDA_TAPE_8[0]!;
  const spy8 = SPY_TAPE_8[idx] ?? SPY_TAPE_8[0]!;
  const kalshi8 = KALSHI_FED_YES_8[idx] ?? KALSHI_FED_YES_8[0]!;

  const sol0 = SOL_TAPE_8[0]!;
  const nvda0 = NVDA_TAPE_8[0]!;
  const spy0 = SPY_TAPE_8[0]!;
  const kalshi0 = KALSHI_FED_YES_8[0]!;

  const calcDeltaBps = (curr: bigint, base: bigint): { vel: number; label: string } => {
    const bpsScaled = ((curr - base) * 10_000n * FP_SCALE) / base;
    const sign = bpsScaled >= 0n ? "+" : "";
    const intBps = Number(((curr - base) * 10_000n) / base);
    return {
      vel: intBps,
      label: `${sign}${formatScaledBigInt(bpsScaled, 1)} bps`,
    };
  };

  const solPrev = SOL_TAPE_8[prevIdx] ?? sol0;
  const stepVelBps = Number(((sol8 - solPrev) * 10_000n) / solPrev);

  // Encode & decode a canonical 48-byte binary WorldPulseFrame to verify wire-codec integrity
  const encodedFrame = encodeWorldPulseFrame({
    phase: RoomPhaseCode.FogOfWar,
    assetIndex: 0,
    timestampMs: BigInt(1_764_000_000_000 + idx * 10),
    price8: sol8,
    velocityBps: stepVelBps,
    volatilitySigmaMilli: 1850,
    countdownRemainingMs: 45_000,
    playerRank: 1,
    totalPlayers: 4,
    topLeaderScoreScaled: 12_500_000n,
    activeRoomsCount: 42,
    isFogEncrypted: true,
    vrfVerified: true,
  });
  const decodedFrame = decodeWorldPulseFrame(encodedFrame);

  const solDelta = calcDeltaBps(sol8, sol0);
  const nvdaDelta = calcDeltaBps(nvda8, nvda0);
  const spyDelta = calcDeltaBps(spy8, spy0);
  const kalshiCents = kalshi8 / 1_000_000n;
  const kalshiDiffCents = (kalshi8 - kalshi0) / 100_000n; // tenths of a cent
  const kalshiSign = kalshiDiffCents >= 0n ? "+" : "";

  const quotes: BorelMarketQuote[] = [
    {
      symbol: "SOL-PERP",
      venue: "Phoenix Perp",
      price8: sol8,
      entryPrice8: sol0,
      velocityBps: solDelta.vel,
      displayPrice: formatPrice8Usd(sol8),
      deltaBpsFormatted: solDelta.label,
    },
    {
      symbol: "NVDAx",
      venue: "Jupiter V2 xStocks",
      price8: nvda8,
      entryPrice8: nvda0,
      velocityBps: nvdaDelta.vel,
      displayPrice: formatPrice8Usd(nvda8),
      deltaBpsFormatted: nvdaDelta.label,
    },
    {
      symbol: "SPYx",
      venue: "Jupiter V2 xStocks",
      price8: spy8,
      entryPrice8: spy0,
      velocityBps: spyDelta.vel,
      displayPrice: formatPrice8Usd(spy8),
      deltaBpsFormatted: spyDelta.label,
    },
    {
      symbol: "KALSHI-FED-CUT",
      venue: "DFlow Kalshi",
      price8: kalshi8,
      entryPrice8: kalshi0,
      velocityBps: Number(kalshiDiffCents),
      displayPrice: `${kalshiCents.toString()}¢ YES`,
      deltaBpsFormatted: `${kalshiSign}${(Number(kalshiDiffCents) / 10).toFixed(1)}¢`,
    },
  ];

  return {
    quotes,
    pulseVerified: decodedFrame.price8 === sol8 && decodedFrame.vrfVerified,
  };
}

export function normalizePlayerChips(
  legs: readonly BorelChipAllocation[],
  targetSymbol: BorelAssetSymbol,
  nextChipsRaw: number,
): BorelChipAllocation[] {
  const clampedTarget = Math.max(0, Math.min(100, Math.round(nextChipsRaw)));
  const otherSum = legs
    .filter((l) => l.symbol !== targetSymbol)
    .reduce((acc, l) => acc + l.chips, 0);

  const maxAllowed = 100 - clampedTarget;
  if (otherSum <= maxAllowed) {
    return legs.map((l) =>
      l.symbol === targetSymbol ? { ...l, chips: clampedTarget } : l,
    );
  }

  // Proportionally scale down other legs in integer chips so total never exceeds 100
  let remainingToAssign = maxAllowed;
  const others = legs.filter((l) => l.symbol !== targetSymbol);
  const adjustedOthers = new Map<BorelAssetSymbol, number>();

  others.forEach((other, idx) => {
    if (idx === others.length - 1) {
      adjustedOthers.set(other.symbol, Math.max(0, remainingToAssign));
    } else {
      const scaled = otherSum > 0 ? Math.floor((other.chips * maxAllowed) / otherSum) : 0;
      adjustedOthers.set(other.symbol, scaled);
      remainingToAssign -= scaled;
    }
  });

  return legs.map((l) => {
    if (l.symbol === targetSymbol) {
      return { ...l, chips: clampedTarget };
    }
    return { ...l, chips: adjustedOthers.get(l.symbol) ?? 0 };
  });
}

function buildAllocationsUi(
  legs: readonly BorelChipAllocation[],
  kalshiCall: BorelKalshiCall,
): ConvictionAllocationLeg[] {
  const ui: ConvictionAllocationLeg[] = legs
    .filter((l) => l.chips > 0)
    .map((l) => ({
      symbol: l.symbol,
      label: `${l.direction === "LONG" ? "+" : "-"}${l.chips}% ${l.direction}`,
      barWidthPct: Math.max(12, l.chips),
      tone: l.direction === "LONG" ? "emerald" : "amber",
    }));

  ui.push({
    symbol: "FED-CUT",
    label: kalshiCall === "YES" ? "YES 1.35x" : "NO 1.00x",
    barWidthPct: kalshiCall === "YES" ? 85 : 35,
    tone: "cyan",
  });

  return ui;
}

function scoreCompetitorLegs(
  legs: readonly BorelChipAllocation[],
  kalshiCall: BorelKalshiCall,
  quotes: readonly BorelMarketQuote[],
): { rawRelScoreScaled: bigint; compositeScoreScaled: bigint } {
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q] as const));
  const relLegs = legs.map((leg) => {
    const q = quoteBySymbol.get(leg.symbol);
    const entryPrice = q?.entryPrice8 ?? 10_000_000_000n;
    const exitPrice = q?.price8 ?? entryPrice;
    const sign = leg.direction === "LONG" ? 1n : -1n;
    // chips in [0, 100] -> weightScaled in [-10^9, +10^9]
    const weightScaled = sign * BigInt(leg.chips) * 10_000_000n;
    return {
      weightScaled,
      entryPrice,
      exitPrice,
    };
  });

  // Ensure sum |w_i| <= FP_SCALE
  let absSum = 0n;
  for (const rl of relLegs) {
    absSum += absBigInt(rl.weightScaled);
  }
  const safeRelLegs =
    absSum <= FP_SCALE
      ? relLegs
      : relLegs.map((rl) => ({
          ...rl,
          weightScaled: (rl.weightScaled * FP_SCALE) / absSum,
        }));

  const rawRelScoreScaled = computeDirectionNeutralRelativeReturn(
    safeRelLegs,
    500_000_000n, // beta_bench = 0.50
  );

  // Kalshi catalyst carry multiplier (1.35x max carry via Brier calibration)
  const kalshiQuote = quoteBySymbol.get("KALSHI-FED-CUT");
  const kalshiYesProbScaled = (kalshiQuote?.price8 ?? 68_000_000n) * 10n; // 68_000_000 * 10 = 0.68 * 10^9
  const forecastProbScaled =
    kalshiCall === "YES" ? kalshiYesProbScaled : FP_SCALE - kalshiYesProbScaled;
  const brierScoreScaled = computeKalshiBrierScore([
    {
      forecastProbScaled,
      outcomeScaled: FP_SCALE, // Dovish Fed print momentum on tape
    },
  ]);

  const compositeScoreScaled =
    rawRelScoreScaled >= 0n
      ? computeMultiStageCarryScore(brierScoreScaled, rawRelScoreScaled, 1_350_000_000n)
      : rawRelScoreScaled;

  return { rawRelScoreScaled, compositeScoreScaled };
}

export function evaluateBorelPodStandings(
  playerLegs: readonly BorelChipAllocation[],
  playerKalshiCall: BorelKalshiCall,
  quotes: readonly BorelMarketQuote[],
): readonly BorelPodCompetitor[] {
  const playerScores = scoreCompetitorLegs(playerLegs, playerKalshiCall, quotes);
  const unsorted: Omit<BorelPodCompetitor, "rank">[] = [
    {
      id: "borel-player-pod",
      handle: "You (Session Key)",
      isPlayer: true,
      cipherDigest: "0x3f1a…90e4",
      kalshiCall: playerKalshiCall,
      legs: playerLegs,
      allocationsUi: buildAllocationsUi(playerLegs, playerKalshiCall),
      rawRelScoreScaled: playerScores.rawRelScoreScaled,
      compositeScoreScaled: playerScores.compositeScoreScaled,
      deltaBpsFormatted: formatScoreBps(playerScores.compositeScoreScaled),
    },
    ...RIVAL_DEFINITIONS.map((rival) => {
      const sc = scoreCompetitorLegs(rival.legs, rival.kalshiCall, quotes);
      return {
        id: rival.id,
        handle: rival.handle,
        isPlayer: false,
        cipherDigest: rival.cipherDigest,
        kalshiCall: rival.kalshiCall,
        legs: rival.legs,
        allocationsUi: buildAllocationsUi(rival.legs, rival.kalshiCall),
        rawRelScoreScaled: sc.rawRelScoreScaled,
        compositeScoreScaled: sc.compositeScoreScaled,
        deltaBpsFormatted: formatScoreBps(sc.compositeScoreScaled),
      };
    }),
  ];

  const sorted = [...unsorted].sort((a, b) => {
    if (b.compositeScoreScaled !== a.compositeScoreScaled) {
      return b.compositeScoreScaled > a.compositeScoreScaled ? 1 : -1;
    }
    return a.isPlayer ? -1 : 1;
  });

  return sorted.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

export function computeBorelSettlement(params: {
  roundNumber: number;
  standings: readonly BorelPodCompetitor[];
  sessionMode: BorelSessionMode;
  envelopeUsdcWhole: number;
  currentPlayerEloScaled: bigint;
}): BorelSettlementSummary {
  const playerPod =
    params.standings.find((s) => s.isPlayer) ?? params.standings[0]!;
  const totalPlayers = params.standings.length;

  // Placement p_u in [0, FP_SCALE]: rank 1 => 1.0, rank 4 => 0.0
  const denom = BigInt(Math.max(1, totalPlayers - 1));
  const numer = BigInt(Math.max(0, totalPlayers - playerPod.rank));
  const placementScaled = (numer * FP_SCALE) / denom;

  // Room average ELO = 1,465 * 10^9
  const roomMeanEloScaled = 1_465_000_000_000n;
  const eloUpdate = computeUpdatedMarketElo(
    params.currentPlayerEloScaled,
    roomMeanEloScaled,
    placementScaled,
    params.sessionMode,
  );

  // Pool: in Live Mode = 4 players * envelopeUsdc; in Paper Mode = $40 sponsor fractional stock pool
  const roomPoolUsdc =
    params.sessionMode === "LIVE"
      ? BigInt(params.envelopeUsdcWhole) * 4n * USDC_UNIT
      : 40n * USDC_UNIT;

  const poolDistribution = computePoolAndFeeDistribution({
    roomPoolUsdc,
    totalFeeBps: params.sessionMode === "LIVE" ? 250 : 0,
    creatorShareBps: 5000,
    partnerWalletActive: false,
    playerScores: params.standings.map((s) => ({
      player: s.handle,
      scoreScaled: s.compositeScoreScaled,
    })),
  });

  const playerPayoutEntry = poolDistribution.payouts.find(
    (p) => p.player === playerPod.handle,
  );

  const roundPadded = (418 + params.roundNumber).toString().padStart(4, "0");

  return {
    roundCode: `BLZ-${roundPadded}`,
    vrfProgramId: MAGICBLOCK_CONSTANTS.vrfProgramId,
    vrfSeedHex: "0xbf045a4c5d10a34e728c51e2d05e1bd82e444fc73e1c2356ba26d0061895d428",
    l1CommitSignature:
      "3Ljspf1XppENsm75dzu7utizmAobbxQCP7L8L4S1kcLUksLN1VR6HzCqbpPVG4orw3xzr5tQSsJ2czFLrGSs9EE9",
    playerRank: playerPod.rank,
    playerScoreBpsFormatted: playerPod.deltaBpsFormatted,
    playerScoreScaled: playerPod.compositeScoreScaled,
    prevEloScaled: params.currentPlayerEloScaled,
    nextEloScaled: eloUpdate.nextEloScaled,
    deltaEloScaled: eloUpdate.deltaEloScaled,
    poolDistribution,
    playerPayoutUsdcAtomic: playerPayoutEntry?.payoutUsdc ?? 5_000_000n,
  };
}

export function buildLiveBorelQuotes(params: {
  solUsd: number | null;
  solChange24hPct: number;
  nvdaUsd: number | null;
  nvdaChange24hPct: number;
  spyUsd: number | null;
  spyChange24hPct: number;
  kalshiYesPrice: number | null;
  kalshiTickerLabel: string;
}): BorelMarketQuote[] | null {
  if (!params.solUsd || !params.nvdaUsd || !params.spyUsd) {
    return null;
  }

  const makeQuote = (
    symbol: "SOL-PERP" | "NVDAx" | "SPYx",
    venue: string,
    priceUsd: number,
    changePct: number,
  ): BorelMarketQuote => {
    const curr8 = BigInt(Math.max(1, Math.round(priceUsd * 1e8)));
    // Derive entry price from live 24h open (or 25bps baseline if flat) so scoring reflects real relative market return
    const openUsd =
      Math.abs(changePct) > 0.001
        ? priceUsd / (1 + changePct / 100)
        : priceUsd * 0.998;
    const entry8 = BigInt(Math.max(1, Math.round(openUsd * 1e8)));
    const bpsScaled = ((curr8 - entry8) * 10_000n * FP_SCALE) / entry8;
    const sign = bpsScaled >= 0n ? "+" : "";
    const intBps = Number(((curr8 - entry8) * 10_000n) / entry8);
    return {
      symbol,
      venue,
      price8: curr8,
      entryPrice8: entry8,
      velocityBps: intBps,
      displayPrice: formatPrice8Usd(curr8),
      deltaBpsFormatted: `${sign}${formatScaledBigInt(bpsScaled, 1)} bps`,
    };
  };

  const kalshiMid =
    params.kalshiYesPrice && params.kalshiYesPrice > 0
      ? Math.min(0.99, Math.max(0.01, params.kalshiYesPrice))
      : 0.68;
  const kalshi8 = BigInt(Math.round(kalshiMid * 1e8));
  const kalshiEntry8 = BigInt(Math.round(Math.max(0.01, kalshiMid - 0.015) * 1e8));
  const kalshiCents = Math.round(kalshiMid * 100);

  return [
    makeQuote("SOL-PERP", "Coinbase / Phoenix", params.solUsd, params.solChange24hPct),
    makeQuote("NVDAx", "Solana Raydium xStock", params.nvdaUsd, params.nvdaChange24hPct),
    makeQuote("SPYx", "Solana Raydium xStock", params.spyUsd, params.spyChange24hPct),
    {
      symbol: "KALSHI-FED-CUT",
      venue: `Kalshi (${params.kalshiTickerLabel})`,
      price8: kalshi8,
      entryPrice8: kalshiEntry8,
      velocityBps: 15,
      displayPrice: `${kalshiCents}¢ YES`,
      deltaBpsFormatted: `${(kalshiMid * 100).toFixed(1)}% prob`,
    },
  ];
}

export function getClaimAssetReferencePrice8(
  asset: ClaimAssetSymbol,
  quotes: readonly BorelMarketQuote[],
): { price8: bigint; mintShort: string } {
  if (asset === "NVDAx") {
    const q = quotes.find((item) => item.symbol === "NVDAx");
    return {
      price8: q?.price8 ?? 15_600_000_000n,
      mintShort: `${SOLANA_CANONICAL_MINTS.NVDAx.slice(0, 6)}…${SOLANA_CANONICAL_MINTS.NVDAx.slice(-4)}`,
    };
  }
  if (asset === "SPYx") {
    const q = quotes.find((item) => item.symbol === "SPYx");
    return {
      price8: q?.price8 ?? 73_500_000_000n,
      mintShort: `${SOLANA_CANONICAL_MINTS.SPYx.slice(0, 6)}…${SOLANA_CANONICAL_MINTS.SPYx.slice(-4)}`,
    };
  }
  if (asset === "ANTx") {
    return {
      price8: ANTX_REFERENCE_PRICE_8,
      mintShort: `${SOLANA_CANONICAL_MINTS.ANTx.slice(0, 6)}…${SOLANA_CANONICAL_MINTS.ANTx.slice(-4)}`,
    };
  }
  if (asset === "TSLAx") {
    return {
      price8: 38_900_000_000n,
      mintShort: `${SOLANA_CANONICAL_MINTS.TSLAx.slice(0, 6)}…${SOLANA_CANONICAL_MINTS.TSLAx.slice(-4)}`,
    };
  }
  return {
    price8: 100_000_000n,
    mintShort: `${SOLANA_CANONICAL_MINTS.USDC.slice(0, 6)}…${SOLANA_CANONICAL_MINTS.USDC.slice(-4)}`,
  };
}

export const BOREL_ENGINE_PROOF = {
  erRoomProgramId: CARTRIDGE_PROGRAM_IDS.erRoom,
  teePermissionProgramId: MAGICBLOCK_CONSTANTS.permissionProgramId,
  vrfProgramId: MAGICBLOCK_CONSTANTS.vrfProgramId,
  passportProgramId: CARTRIDGE_PROGRAM_IDS.passport,
} as const;
