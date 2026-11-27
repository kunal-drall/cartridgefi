import {
  SCALE,
  type Conviction,
  type Direction,
  type HandLeg,
  type LockedHand,
  type LockedLeg,
  type PivotAction,
  type SealedHand,
} from "./types";

export type HandValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** A hand needs three distinct markets and exactly one 1x, 2x and 3x card. */
export function validateHand(hand: readonly HandLeg[]): HandValidation {
  if (hand.length !== 3) return { ok: false, reason: "A hand has exactly 3 legs." };
  const markets = new Set(hand.map((leg) => leg.market));
  if (markets.size !== 3) return { ok: false, reason: "Each leg must be a different market." };
  const cards = new Set<Conviction>(hand.map((leg) => leg.conviction));
  if (!(cards.has(1) && cards.has(2) && cards.has(3))) {
    return { ok: false, reason: "Assign the 1x, 2x and 3x cards once each." };
  }
  return { ok: true };
}

/**
 * Convert a Pyth price (integer mantissa + exponent) into SCALE (1e9) fixed point.
 * Pyth exponents are negative (typically -8 for crypto, -5 for equities).
 */
export function pythToE9(price: bigint, expo: number): bigint {
  const shift = 9 + expo;
  if (shift >= 0) return price * 10n ** BigInt(shift);
  return price / 10n ** BigInt(-shift);
}

const sign = (direction: Direction): bigint => (direction === "LONG" ? 1n : -1n);

/** Signed fractional return from `from` to `to`, scaled by SCALE. */
function returnE9(fromE9: bigint, toE9: bigint): bigint {
  if (fromE9 <= 0n) return 0n;
  return ((toE9 - fromE9) * SCALE) / fromE9;
}

/**
 * Score of one leg at `nowPriceE9`, scaled by SCALE (1e9 = +100% × conviction).
 * FLIP: the move up to the pivot is banked, then the leg rides the opposite direction from the pivot price.
 * SHIELD: the move up to the pivot is banked and the leg is frozen in cash.
 */
export function legScoreE9(leg: LockedLeg, nowPriceE9: bigint, pivot?: PivotAction): bigint {
  const dir = sign(leg.direction);
  const multiplier = BigInt(leg.conviction);
  if (!pivot) return dir * returnE9(leg.entryPriceE9, nowPriceE9) * multiplier;

  const banked = dir * returnE9(leg.entryPriceE9, pivot.priceE9);
  if (pivot.kind === "SHIELD") return banked * multiplier;
  const afterFlip = -dir * returnE9(pivot.priceE9, nowPriceE9);
  return (banked + afterFlip) * multiplier;
}

/** Total hand score. `pricesE9` maps a market to its latest price; a missing price contributes 0. */
export function handScoreE9(
  hand: LockedHand,
  pricesE9: Readonly<Partial<Record<LockedLeg["market"], bigint>>>,
  pivot?: PivotAction,
): bigint {
  let total = 0n;
  hand.forEach((leg, index) => {
    const now = pricesE9[leg.market];
    if (now === undefined) return;
    total += legScoreE9(leg, now, pivot?.legIndex === index ? pivot : undefined);
  });
  return total;
}

/** Score in basis points (1 bp = 0.01%) for display; integer division, truncates toward zero. */
export function scoreToBps(scoreE9: bigint): bigint {
  return (scoreE9 * 10_000n) / SCALE;
}

/** "+12.34%" style string from a SCALE-denominated score, no floating point. */
export function formatScorePct(scoreE9: bigint): string {
  const bps = scoreToBps(scoreE9);
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : "+"}${whole.toString()}.${frac}%`;
}

/**
 * Deterministic ranking: higher score first; ties are broken by the room's VRF randomness so
 * no player can engineer a tie-break. `vrfSeed` is the 32-byte VRF output as hex (or "" before VRF).
 */
export function rankByScore<T extends { readonly id: string; readonly scoreE9: bigint }>(
  rows: readonly T[],
  vrfSeed: string,
): Array<T & { readonly rank: number }> {
  const tieKey = (id: string): bigint => {
    let h = 0xcbf29ce484222325n;
    for (const ch of `${vrfSeed}:${id}`) {
      h ^= BigInt(ch.codePointAt(0) ?? 0);
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h;
  };
  return [...rows]
    .sort((a, b) => {
      if (a.scoreE9 !== b.scoreE9) return a.scoreE9 > b.scoreE9 ? -1 : 1;
      const ka = tieKey(a.id);
      const kb = tieKey(b.id);
      return ka === kb ? 0 : ka < kb ? -1 : 1;
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * Commitment to a sealed hand: sha256(canonical hand || salt) as hex.
 * Published at lock time; the revealed hand + salt must reproduce it at unseal.
 */
export async function handCommitment(hand: SealedHand, saltHex: string): Promise<string> {
  const canonical = hand
    .map((leg) => `${leg.market}|${leg.direction}|${leg.conviction}`)
    .join(";");
  const bytes = new TextEncoder().encode(`${canonical}#${saltHex}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
