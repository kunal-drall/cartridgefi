import { FP_SCALE, USDC_UNIT } from "./constants.js";
import {
  computeDirectionNeutralRelativeReturn,
  computeDrawdownPenalizedSharpe,
  computeKalshiBrierScore,
  computeMultiStageCarryScore,
  computePoolAndFeeDistribution,
  formatScaledBigInt,
} from "./fixed-point.js";
import type { CartridgeManifestV2 } from "./manifest.js";

export type VolatilityRegime = "calm" | "crash_vix35";

export interface CartridgeSimulationReport {
  slug: string;
  volatilityRegime: VolatilityRegime;
  tickCount: number;
  simulatedPlayers: number;
  roomPoolUsdcAtomic: string;
  payoutConservationVerified: boolean;
  totalDistributedUsdcAtomic: string;
  creatorFeePerRoomUsdcAtomic: string;
  projectedMonthlyCreatorFeeUsdcFormatted: string;
  p90ScoreFormatted: string;
  medianScoreFormatted: string;
  p10ScoreFormatted: string;
  topPodium: {
    player: string;
    rank: number;
    scoreScaled: string;
    scoreFormatted: string;
    payoutUsdcAtomic: string;
  }[];
}

/**
 * Deterministic Xorshift64* PRNG in pure `bigint` so simulation runs reproducibly across WASM/Node/Browser.
 */
function nextDeterministicU64(state: bigint): { nextState: bigint; value: bigint } {
  let x = state & 0xffff_ffff_ffff_ffffn;
  if (x === 0n) x = 0x9e37_79b9_7f4a_7c15n;
  x ^= x >> 12n;
  x ^= (x << 25n) & 0xffff_ffff_ffff_ffffn;
  x ^= x >> 27n;
  const out = (x * 0x2545_f491_4f6c_dd1dn) & 0xffff_ffff_ffff_ffffn;
  return { nextState: x, value: out };
}

/**
 * Runs 500 market ticks through CartridgeFi's deterministic `bigint` fixed-point scoring & payout engine.
 */
export function simulateCartridgeEconomy(
  manifest: CartridgeManifestV2,
  volatilityRegime: VolatilityRegime,
  tickCount: number = 500,
  simulatedPlayers: number = 24,
): CartridgeSimulationReport {
  // Seed deterministically from slug + regime
  let seed = 0x517c_c1b7_2722_0a95n;
  const key = `${manifest.metadata.slug}:${volatilityRegime}`;
  for (let i = 0; i < key.length; i += 1) {
    seed = ((seed ^ BigInt(key.charCodeAt(i))) * 0x100_0000_01b3n) & 0xffff_ffff_ffff_ffffn;
  }

  const stepAmplitudeBps = volatilityRegime === "crash_vix35" ? 85n : 18n;
  const driftBiasBps = volatilityRegime === "crash_vix35" ? -12n : 3n;

  // Generate 2 correlated integer price paths in 10^8 Pyth units across `tickCount` ticks
  let p0 = 18_500_000_000n; // $185.00
  let p1 = 14_200_000_000n; // $142.00
  const startP0 = p0;
  const startP1 = p1;

  const p0Series: bigint[] = [p0];
  const p1Series: bigint[] = [p1];

  for (let t = 0; t < tickCount; t += 1) {
    const r0 = nextDeterministicU64(seed);
    seed = r0.nextState;
    const r1 = nextDeterministicU64(seed);
    seed = r1.nextState;

    const centered0 = BigInt(Number(r0.value % 201n) - 100); // [-100, +100]
    const centered1 = BigInt(Number(r1.value % 201n) - 100);
    const deltaBps0 = (centered0 * stepAmplitudeBps) / 100n + driftBiasBps;
    const deltaBps1 = (centered1 * stepAmplitudeBps) / 100n + driftBiasBps / 2n;

    p0 = p0 + (p0 * deltaBps0) / 100_000n;
    p1 = p1 + (p1 * deltaBps1) / 100_000n;
    if (p0 < 100_000_000n) p0 = 100_000_000n;
    if (p1 < 100_000_000n) p1 = 100_000_000n;
    p0Series.push(p0);
    p1Series.push(p1);
  }

  const endP0 = p0Series[p0Series.length - 1] ?? startP0;
  const endP1 = p1Series[p1Series.length - 1] ?? startP1;

  const playerScores: { player: string; scoreScaled: bigint }[] = [];

  for (let p = 0; p < simulatedPlayers; p += 1) {
    const rp = nextDeterministicU64(seed);
    seed = rp.nextState;
    // Conviction weights summing |w0| + |w1| <= 10^9
    const rawW0 = BigInt(Number(rp.value % 1201n) - 600) * 1_000_000n; // [-0.6, +0.6] * 10^9
    const remCap = FP_SCALE - (rawW0 < 0n ? -rawW0 : rawW0);
    const rq = nextDeterministicU64(seed);
    seed = rq.nextState;
    const sign1 = rq.value % 2n === 0n ? 1n : -1n;
    const rawW1 = sign1 * ((remCap * BigInt(Number(rq.value % 80n))) / 100n);

    const relScore = computeDirectionNeutralRelativeReturn(
      [
        { weightScaled: rawW0, entryPrice: startP0, exitPrice: endP0 },
        { weightScaled: rawW1, entryPrice: startP1, exitPrice: endP1 },
      ],
      500_000_000n, // beta_bench = 0.5
    );

    let scoreScaled = relScore;

    if (
      manifest.scoringAndPrizes.primaryFormula ===
      "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL"
    ) {
      // Sample 20 checkpoint returns along the 500-tick path
      const stride = Math.max(1, Math.floor(tickCount / 20));
      const stepReturns: bigint[] = [];
      let peakCum = 0n;
      let cum = 0n;
      let maxDd = 0n;
      for (let idx = stride; idx < p0Series.length; idx += stride) {
        const prev = p0Series[idx - stride] ?? startP0;
        const curr = p0Series[idx] ?? prev;
        const assetRet = ((curr - prev) * FP_SCALE) / prev;
        const playerStepRet = (rawW0 * assetRet) / FP_SCALE;
        stepReturns.push(playerStepRet);
        cum += playerStepRet;
        if (cum > peakCum) peakCum = cum;
        const dd = peakCum - cum;
        if (dd > maxDd) maxDd = dd;
      }
      scoreScaled = computeDrawdownPenalizedSharpe(
        stepReturns,
        maxDd,
        350_000_000n,
      );
    } else if (
      manifest.scoringAndPrizes.primaryFormula === "KALSHI_BRIER_CALIBRATION"
    ) {
      const forecastProb = BigInt(Number(rq.value % 900n) + 50) * 1_000_000n;
      const outcome = volatilityRegime === "crash_vix35" ? FP_SCALE : 0n;
      scoreScaled = computeKalshiBrierScore([
        { forecastProbScaled: forecastProb, outcomeScaled: outcome },
      ]);
    } else if (
      manifest.scoringAndPrizes.primaryFormula === "MULTI_STAGE_CARRY_COMPOSITE"
    ) {
      const stage1Brier = computeKalshiBrierScore([
        {
          forecastProbScaled: BigInt(Number(rq.value % 800n) + 100) * 1_000_000n,
          outcomeScaled: FP_SCALE,
        },
      ]);
      scoreScaled = computeMultiStageCarryScore(
        stage1Brier,
        relScore + 250_000_000n,
        1_350_000_000n,
      );
    }

    playerScores.push({
      player: `Player_${(p + 1).toString().padStart(2, "0")}`,
      scoreScaled,
    });
  }

  const envelopeMidUsdc = BigInt(
    Math.min(
      20,
      manifest.onboardingAndSession.liveSessionEnvelopeUsdc.maxUsdc,
    ),
  );
  const roomPoolUsdc = BigInt(simulatedPlayers) * envelopeMidUsdc * USDC_UNIT;

  const dist = computePoolAndFeeDistribution({
    roomPoolUsdc,
    totalFeeBps: 250, // 2.50% builder + protocol fee
    creatorShareBps: manifest.metadata.creatorFeeShareBps,
    partnerWalletActive: false,
    playerScores,
  });

  const sortedScores = [...playerScores]
    .map((s) => s.scoreScaled)
    .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));

  const p10Idx = Math.min(
    sortedScores.length - 1,
    Math.floor(sortedScores.length * 0.9),
  );
  const medIdx = Math.min(
    sortedScores.length - 1,
    Math.floor(sortedScores.length * 0.5),
  );
  const p90Idx = Math.min(
    sortedScores.length - 1,
    Math.floor(sortedScores.length * 0.1),
  );

  // Project monthly creator fee assuming 40 rooms/day (1,200 rooms/month) in 10^9 scaled USD
  const monthlyCreatorUsdcAtomic = dist.creatorFeeUsdc * 1_200n;
  const monthlyCreatorScaled = (monthlyCreatorUsdcAtomic * FP_SCALE) / USDC_UNIT;

  const scoreByPlayer = new Map(
    playerScores.map((p) => [p.player, p.scoreScaled] as const),
  );

  return {
    slug: manifest.metadata.slug,
    volatilityRegime,
    tickCount,
    simulatedPlayers,
    roomPoolUsdcAtomic: dist.roomPoolUsdc.toString(),
    payoutConservationVerified: dist.totalDistributedUsdc <= dist.roomPoolUsdc,
    totalDistributedUsdcAtomic: dist.totalDistributedUsdc.toString(),
    creatorFeePerRoomUsdcAtomic: dist.creatorFeeUsdc.toString(),
    projectedMonthlyCreatorFeeUsdcFormatted: formatScaledBigInt(
      monthlyCreatorScaled,
      2,
    ),
    p90ScoreFormatted: formatScaledBigInt(sortedScores[p90Idx] ?? 0n, 4),
    medianScoreFormatted: formatScaledBigInt(sortedScores[medIdx] ?? 0n, 4),
    p10ScoreFormatted: formatScaledBigInt(sortedScores[p10Idx] ?? 0n, 4),
    topPodium: dist.payouts.slice(0, 3).map((w) => {
      const sc = scoreByPlayer.get(w.player) ?? 0n;
      return {
        player: w.player,
        rank: w.rank,
        scoreScaled: sc.toString(),
        scoreFormatted: formatScaledBigInt(sc, 4),
        payoutUsdcAtomic: w.payoutUsdc.toString(),
      };
    }),
  };
}
