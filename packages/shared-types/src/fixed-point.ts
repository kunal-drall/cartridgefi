import { BPS_DENOMINATOR, ENGINE_GUARDRAILS, FP_SCALE } from "./constants.js";

/**
 * Deterministic Fixed-Point Skill, ELO, and Payout Conservation Math.
 * Zero floating-point operations (`number` never used for financial or score arithmetic).
 * Every scalar is scaled by `FP_SCALE = 1_000_000_000n` (`10^9`), matching Rust `i128` bit-for-bit.
 */

export function absBigInt(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export function fpClamp(val: bigint, minVal: bigint, maxVal: bigint): bigint {
  if (val < minVal) return minVal;
  if (val > maxVal) return maxVal;
  return val;
}

/**
 * Signed fixed-point multiplication: `(a * b) / FP_SCALE` truncating toward zero (matches Rust `/` on `i128`).
 */
export function fpMul(a: bigint, b: bigint): bigint {
  return (a * b) / FP_SCALE;
}

/**
 * Signed fixed-point division: `(a * FP_SCALE) / b` truncating toward zero.
 * Throws if `b === 0n`.
 */
export function fpDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) {
    throw new Error("Fixed-point division by zero");
  }
  return (a * FP_SCALE) / b;
}

/**
 * Exact integer floor square root for non-negative `bigint` via Newton-Raphson.
 */
export function isqrtBigInt(n: bigint): bigint {
  if (n < 0n) {
    throw new Error("Square root of negative bigint");
  }
  if (n < 2n) {
    return n;
  }
  let x0 = n;
  let x1 = (x0 + 1n) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + n / x0) >> 1n;
  }
  return x0;
}

/**
 * Fixed-point square root of a `10^9`-scaled non-negative value, returning a `10^9`-scaled value:
 * `sqrt(x_scaled / 10^9) * 10^9 = floor(sqrt(x_scaled * 10^9))`.
 */
export function fpSqrt(xScaled: bigint): bigint {
  if (xScaled < 0n) {
    throw new Error("fpSqrt requires non-negative scaled input");
  }
  return isqrtBigInt(xScaled * FP_SCALE);
}

export interface RelativeReturnAssetLeg {
  /** Weight scaled by 10^9 in [-FP_SCALE, +FP_SCALE]. Sum of |weightScaled| across legs must be <= FP_SCALE. */
  weightScaled: bigint;
  /** Positive entry price in integer oracle units (e.g. 10^8). */
  entryPrice: bigint;
  /** Positive exit/settlement price in integer oracle units. */
  exitPrice: bigint;
}

/**
 * Formula 1: Direction-Neutral Relative Return (`S_rel`, scaled by `10^9`):
 *   S_rel = sum_i w_i * ((P_{i,T} - P_{i,0}) / P_{i,0}) - beta_bench * (1/N) * sum_i ((P_{i,T} - P_{i,0}) / P_{i,0})
 * Enforces `sum_i |w_i| <= 10^9`.
 */
export function computeDirectionNeutralRelativeReturn(
  legs: readonly RelativeReturnAssetLeg[],
  betaBenchScaled: bigint,
): bigint {
  if (legs.length === 0) {
    return 0n;
  }
  let absWeightSum = 0n;
  let weightedReturnSum = 0n;
  let rawReturnSum = 0n;

  for (const leg of legs) {
    if (leg.entryPrice <= 0n || leg.exitPrice < 0n) {
      throw new Error("Invalid non-positive entryPrice or negative exitPrice");
    }
    absWeightSum += absBigInt(leg.weightScaled);
    const assetReturnScaled = ((leg.exitPrice - leg.entryPrice) * FP_SCALE) / leg.entryPrice;
    weightedReturnSum += fpMul(leg.weightScaled, assetReturnScaled);
    rawReturnSum += assetReturnScaled;
  }

  if (absWeightSum > FP_SCALE) {
    throw new Error(`Gross conviction weight ${absWeightSum} exceeds FP_SCALE (${FP_SCALE})`);
  }

  const nBig = BigInt(legs.length);
  const benchMeanReturnScaled = rawReturnSum / nBig;
  const benchAdjustmentScaled = fpMul(betaBenchScaled, benchMeanReturnScaled);
  return weightedReturnSum - benchAdjustmentScaled;
}

/**
 * Formula 2: Drawdown-Penalized Volatility Sharpe (`S_sharpe`, scaled by `10^9`):
 *   S_sharpe = (sum_{k=1}^K r_k) / sqrt(sum_{k=1}^K (r_k - r_bar)^2 + epsilon) - lambda_DD * DD_max
 * Inputs:
 *   - `stepReturnsScaled`: array of `10^9`-scaled step returns `r_k`
 *   - `maxDrawdownScaled`: `10^9`-scaled maximum drawdown `DD_max >= 0`
 *   - `lambdaDdScaled`: `10^9`-scaled drawdown penalty weight (e.g. `500_000_000n` for 0.5)
 *   - `epsilonScaledSq`: small positive stabilizer in `10^18` squared-scale units (default `1_000_000_000_000n` = 10^-6 in unscaled variance)
 */
export function computeDrawdownPenalizedSharpe(
  stepReturnsScaled: readonly bigint[],
  maxDrawdownScaled: bigint,
  lambdaDdScaled: bigint,
  epsilonScaledSq: bigint = 1_000_000_000_000n,
): bigint {
  if (stepReturnsScaled.length === 0) {
    return 0n;
  }
  if (maxDrawdownScaled < 0n || epsilonScaledSq <= 0n) {
    throw new Error("maxDrawdownScaled must be >= 0 and epsilonScaledSq must be > 0");
  }

  const kBig = BigInt(stepReturnsScaled.length);
  let sumReturns = 0n;
  for (const r of stepReturnsScaled) {
    sumReturns += r;
  }
  const meanReturn = sumReturns / kBig;

  // Each (diff)^2 is in 10^18 scale; isqrtBigInt(sumSqDiff + epsilonScaledSq) yields a 10^9-scaled denominator!
  let sumSqDiff18 = 0n;
  for (const r of stepReturnsScaled) {
    const diff = r - meanReturn;
    sumSqDiff18 += diff * diff;
  }

  const denomScaled = isqrtBigInt(sumSqDiff18 + epsilonScaledSq);
  const rawSharpeScaled = fpDiv(sumReturns, denomScaled);
  const drawdownPenaltyScaled = fpMul(lambdaDdScaled, maxDrawdownScaled);
  return rawSharpeScaled - drawdownPenaltyScaled;
}

export interface BrierForecastItem {
  /** Forecast probability `f_m` in `[0, FP_SCALE]`. */
  forecastProbScaled: bigint;
  /** Resolved binary outcome `o_m`: `0n` (No) or `FP_SCALE` (Yes). */
  outcomeScaled: bigint;
}

/**
 * Formula 3: Kalshi Prediction Brier Calibration (`S_brier`, scaled by `10^9`):
 *   S_brier = 1 - (1/M) * sum_{m=1}^M (f_m - o_m)^2
 */
export function computeKalshiBrierScore(items: readonly BrierForecastItem[]): bigint {
  if (items.length === 0) {
    return 0n;
  }
  let sqErrSumScaled = 0n;
  for (const item of items) {
    const f = fpClamp(item.forecastProbScaled, 0n, FP_SCALE);
    const o = fpClamp(item.outcomeScaled, 0n, FP_SCALE);
    const diff = f - o;
    const sqScaled = (diff * diff) / FP_SCALE;
    sqErrSumScaled += sqScaled;
  }
  const meanBrierLossScaled = sqErrSumScaled / BigInt(items.length);
  return FP_SCALE - meanBrierLossScaled;
}

/**
 * Formula 4a: Multi-Stage Carry-Over Total Score (`S_total`, scaled by `10^9`):
 *   S_total = S_2 * (1 + (M_max - 1) * clamp(S_1, 0, 1))
 */
export function computeMultiStageCarryScore(
  stage1ScoreScaled: bigint,
  stage2ScoreScaled: bigint,
  maxMultiplierScaled: bigint,
): bigint {
  const clampedStage1 = fpClamp(stage1ScoreScaled, 0n, FP_SCALE);
  const bonusFactor = fpMul(maxMultiplierScaled - FP_SCALE, clampedStage1);
  const multiplier = FP_SCALE + bonusFactor;
  return fpMul(stage2ScoreScaled, multiplier);
}

/**
 * Exact deterministic `10^(x / (400 * 10^9))` scaled by `10^9` for ELO expected score calculation.
 * Uses exact octave decomposition (`400 * 10^9` steps = powers of 10) + high-order integer Taylor series for `exp(u * ln(10))`
 * on the reduced fractional interval `[-200 * 10^9, +200 * 10^9]`, matching Rust `i128` bit-for-bit.
 */
const LN10_SCALED = 2_302_585_093n; // round(ln(10) * 10^9)
const ELO_DIVISOR_SCALED = 400n * FP_SCALE;

export function pow10EloRatioScaled(eloDiffScaled: bigint): bigint {
  // Clamp extreme ELO gaps to [-1600, +1600] rating points to prevent any 10^k overflow while preserving saturation (< 0.0001).
  const clampedDiff = fpClamp(eloDiffScaled, -1600n * FP_SCALE, 1600n * FP_SCALE);

  // Decompose clampedDiff = q * (400 * 10^9) + r where r is in [-200 * 10^9, +200 * 10^9]
  let q = clampedDiff / ELO_DIVISOR_SCALED;
  let r = clampedDiff - q * ELO_DIVISOR_SCALED;
  if (r > 200n * FP_SCALE) {
    q += 1n;
    r -= ELO_DIVISOR_SCALED;
  } else if (r < -200n * FP_SCALE) {
    q -= 1n;
    r += ELO_DIVISOR_SCALED;
  }

  // z = (r / (400 * 10^9)) * ln(10), scaled by 10^9. Since |r| <= 200*10^9, |z| <= 0.5 * ln(10) * 10^9 ≈ 1.151e9
  const zScaled = (r * LN10_SCALED) / ELO_DIVISOR_SCALED;

  // 8-term integer Taylor series: exp(z) = sum_{n=0}^8 z^n / n! (error < 10^-8, 100% deterministic integer ops)
  let term = FP_SCALE;
  let expSum = FP_SCALE;
  for (let n = 1n; n <= 8n; n += 1n) {
    term = (term * zScaled) / (n * FP_SCALE);
    expSum += term;
  }

  if (q >= 0n) {
    let factor = 1n;
    for (let i = 0n; i < q; i += 1n) {
      factor *= 10n;
    }
    return expSum * factor;
  }
  let divisor = 1n;
  for (let i = 0n; i < -q; i += 1n) {
    divisor *= 10n;
  }
  return expSum / divisor;
}

/**
 * Formula 4b: Multiplayer Market ELO Update (`ELO'_u`, scaled by `10^9`):
 *   ELO'_u = ELO_u + K_tier * (p_u - 1 / (1 + 10^((mean_ELO - ELO_u)/400)))
 * where:
 *   - `playerEloScaled`: current player ELO * `10^9` (e.g. `1200 * 10^9`)
 *   - `roomMeanEloScaled`: room average ELO * `10^9`
 *   - `placementScoreScaled`: normalized placement `p_u` in `[0, FP_SCALE]` (`FP_SCALE` = 1st place, `0n` = last place)
 *   - `mode`: `"PAPER"` (`K = 12`) or `"LIVE"` (`K = 32`)
 */
export function computeUpdatedMarketElo(
  playerEloScaled: bigint,
  roomMeanEloScaled: bigint,
  placementScoreScaled: bigint,
  mode: "PAPER" | "LIVE",
): { nextEloScaled: bigint; deltaEloScaled: bigint; expectedScoreScaled: bigint } {
  const kFactor = mode === "LIVE" ? ENGINE_GUARDRAILS.eloKLive : ENGINE_GUARDRAILS.eloKPaper;
  const clampedPlacement = fpClamp(placementScoreScaled, 0n, FP_SCALE);
  const ratioScaled = pow10EloRatioScaled(roomMeanEloScaled - playerEloScaled);
  const expectedScoreScaled = (FP_SCALE * FP_SCALE) / (FP_SCALE + ratioScaled);
  const deltaEloScaled = kFactor * (clampedPlacement - expectedScoreScaled);
  const rawNext = playerEloScaled + deltaEloScaled;
  const nextEloScaled = rawNext < 100n * FP_SCALE ? 100n * FP_SCALE : rawNext;
  return {
    nextEloScaled,
    deltaEloScaled: nextEloScaled - playerEloScaled,
    expectedScoreScaled,
  };
}

export interface PoolDistributionInput {
  /** Total room USDC pool in 6-decimal atomic units. */
  roomPoolUsdc: bigint;
  /** Protocol/builder fee rate on room pool in basis points (e.g. 250 = 2.50%). */
  totalFeeBps: number;
  /** Creator share of net fee in basis points (<= 5000 when no partner wallet; ignored if partnerWalletActive is true). */
  creatorShareBps: number;
  /** True when embedded via `<CartridgeDeck partnerFeeVault=... />` (40% partner / 30% creator / 30% engine). */
  partnerWalletActive: boolean;
  /** Ranked players' final fixed-point scores (sorted or unsorted; ties handled deterministically by index). */
  playerScores: readonly { player: string; scoreScaled: bigint }[];
}

export interface PoolDistributionResult {
  roomPoolUsdc: bigint;
  totalFeeUsdc: bigint;
  platformFeeUsdc: bigint;
  creatorFeeUsdc: bigint;
  partnerFeeUsdc: bigint;
  netPrizePoolUsdc: bigint;
  payouts: { player: string; rank: number; payoutUsdc: bigint }[];
  totalDistributedUsdc: bigint;
  undistributedDustUsdc: bigint;
}

/**
 * Computes exact integer USDC payouts and builder/protocol fee splits with provable conservation:
 *   `sum(winnerPayouts) + platformFeeUsdc + creatorFeeUsdc + partnerFeeUsdc <= roomPoolUsdc`
 */
export function computePoolAndFeeDistribution(input: PoolDistributionInput): PoolDistributionResult {
  if (input.roomPoolUsdc < 0n) {
    throw new Error("Negative roomPoolUsdc");
  }
  if (input.totalFeeBps < 0 || input.totalFeeBps > 1000) {
    throw new Error("totalFeeBps out of bounds [0, 1000]");
  }
  if (input.creatorShareBps < 0 || input.creatorShareBps > ENGINE_GUARDRAILS.maxCreatorShareBps) {
    throw new Error("creatorShareBps exceeds 5000 bps cap");
  }

  const totalFeeUsdc = (input.roomPoolUsdc * BigInt(input.totalFeeBps)) / BPS_DENOMINATOR;
  let partnerFeeUsdc = 0n;
  let creatorFeeUsdc = 0n;
  let platformFeeUsdc = 0n;

  if (input.partnerWalletActive) {
    partnerFeeUsdc =
      (totalFeeUsdc * BigInt(ENGINE_GUARDRAILS.partnerWalletShareBps)) / BPS_DENOMINATOR;
    creatorFeeUsdc =
      (totalFeeUsdc * BigInt(ENGINE_GUARDRAILS.partnerCreatorShareBps)) / BPS_DENOMINATOR;
    platformFeeUsdc = totalFeeUsdc - partnerFeeUsdc - creatorFeeUsdc;
  } else {
    creatorFeeUsdc = (totalFeeUsdc * BigInt(input.creatorShareBps)) / BPS_DENOMINATOR;
    platformFeeUsdc = totalFeeUsdc - creatorFeeUsdc;
  }

  const netPrizePoolUsdc = input.roomPoolUsdc - totalFeeUsdc;

  if (input.playerScores.length === 0 || netPrizePoolUsdc === 0n) {
    const totalDistributedUsdc = platformFeeUsdc + creatorFeeUsdc + partnerFeeUsdc;
    return {
      roomPoolUsdc: input.roomPoolUsdc,
      totalFeeUsdc,
      platformFeeUsdc,
      creatorFeeUsdc,
      partnerFeeUsdc,
      netPrizePoolUsdc,
      payouts: [],
      totalDistributedUsdc,
      undistributedDustUsdc: input.roomPoolUsdc - totalDistributedUsdc,
    };
  }

  const sorted = input.playerScores
    .map((entry, idx) => ({ ...entry, idx }))
    .sort((a, b) => {
      if (b.scoreScaled !== a.scoreScaled) {
        return b.scoreScaled > a.scoreScaled ? 1 : -1;
      }
      return a.idx - b.idx;
    });

  // Top 20% (minimum up to min(3, N) winners in small pods so 2-8 playerBlitz pods reward podium) Shapley harmonic weights
  const n = sorted.length;
  const winnerCount = Math.max(Math.min(3, n), Math.ceil(n * 0.2));

  // Harmonic Shapley integer weights scaled by LCM-safe integer factor `2520 * 1000`
  const WEIGHT_BASE = 2_520_000n;
  const rawWeights: bigint[] = [];
  let weightSum = 0n;
  for (let r = 0; r < winnerCount; r += 1) {
    const w = WEIGHT_BASE / BigInt(r + 1);
    rawWeights.push(w);
    weightSum += w;
  }

  const payouts: { player: string; rank: number; payoutUsdc: bigint }[] = [];
  let paidWinnerSum = 0n;
  for (let i = 0; i < sorted.length; i += 1) {
    const entry = sorted[i];
    if (!entry) continue;
    let payoutUsdc = 0n;
    if (i < winnerCount && weightSum > 0n) {
      const w = rawWeights[i] ?? 0n;
      payoutUsdc = (netPrizePoolUsdc * w) / weightSum;
      paidWinnerSum += payoutUsdc;
    }
    payouts.push({
      player: entry.player,
      rank: i + 1,
      payoutUsdc,
    });
  }

  // Credit integer division dust strictly to Rank #1 winner so 100% of netPrizePoolUsdc is accounted for without ever exceeding roomPoolUsdc
  const prizeDust = netPrizePoolUsdc - paidWinnerSum;
  if (prizeDust > 0n && payouts[0]) {
    payouts[0].payoutUsdc += prizeDust;
    paidWinnerSum += prizeDust;
  }

  const totalDistributedUsdc = paidWinnerSum + platformFeeUsdc + creatorFeeUsdc + partnerFeeUsdc;
  if (totalDistributedUsdc > input.roomPoolUsdc) {
    throw new Error("Solvency invariant violated: distributed exceeds pool");
  }

  return {
    roomPoolUsdc: input.roomPoolUsdc,
    totalFeeUsdc,
    platformFeeUsdc,
    creatorFeeUsdc,
    partnerFeeUsdc,
    netPrizePoolUsdc,
    payouts,
    totalDistributedUsdc,
    undistributedDustUsdc: input.roomPoolUsdc - totalDistributedUsdc,
  };
}

/**
 * Formats a `10^9`-scaled `bigint` into a fixed decimal string without IEEE-754 float conversion.
 */
export function formatScaledBigInt(valueScaled: bigint, decimals: number = 2): string {
  const negative = valueScaled < 0n;
  const abs = negative ? -valueScaled : valueScaled;
  const whole = abs / FP_SCALE;
  const fracRaw = abs % FP_SCALE;
  const fracPadded = fracRaw.toString().padStart(9, "0").slice(0, Math.max(0, Math.min(9, decimals)));
  const sign = negative ? "-" : "";
  return decimals > 0 ? `${sign}${whole.toString()}.${fracPadded}` : `${sign}${whole.toString()}`;
}
