import {
  BOREL_MARKETS,
  SCALE,
  type BorelMarket,
  type Conviction,
  type Direction,
  type LockedHand,
  type LockedLeg,
} from "@/lib/borel/types";

export type PriceBookE9 = Readonly<Partial<Record<BorelMarket, bigint>>>;

export interface PacerProfile {
  readonly id: string;
  readonly label: string;
  /** One-line, plain-language description of the deterministic strategy. */
  readonly strategy: string;
}

/** Paper-mode rivals. Every hand is a pure function of the real prices observed before the seal. */
export const PACER_PROFILES: readonly PacerProfile[] = [
  { id: "pacer-momentum", label: "Pacer · Momentum", strategy: "Long the 3 strongest movers, 3x on the leader" },
  { id: "pacer-contrarian", label: "Pacer · Contrarian", strategy: "Short the 3 strongest movers, 3x on the leader" },
  { id: "pacer-index", label: "Pacer · Index", strategy: "Long SPY 3x, BTC 2x, ETH 1x" },
  { id: "pacer-crypto-beta", label: "Pacer · Crypto beta", strategy: "Long SOL 3x, ETH 2x, BTC 1x" },
  { id: "pacer-pair", label: "Pacer · Pair trade", strategy: "Long BTC 3x, short SOL 2x, long NVDAx 1x" },
  { id: "pacer-laggard", label: "Pacer · Laggard", strategy: "Long the 3 weakest movers, 3x on the weakest" },
];

type LegPlan = readonly [BorelMarket, Direction, Conviction];

function returnE9(fromE9: bigint | undefined, toE9: bigint | undefined): bigint {
  if (fromE9 === undefined || toE9 === undefined || fromE9 <= 0n) return 0n;
  return ((toE9 - fromE9) * SCALE) / fromE9;
}

/** Markets ordered by move since the baseline (strongest first); ties keep canonical order. */
function rankMovers(baseline: PriceBookE9, now: PriceBookE9): BorelMarket[] {
  return BOREL_MARKETS.map((market, index) => ({
    market,
    index,
    move: returnE9(baseline[market], now[market]),
  }))
    .sort((a, b) => {
      if (a.move !== b.move) return a.move > b.move ? -1 : 1;
      return a.index - b.index;
    })
    .map((row) => row.market);
}

function planFor(profileId: string, baseline: PriceBookE9, now: PriceBookE9): readonly LegPlan[] {
  const movers = rankMovers(baseline, now);
  const [m0, m1, m2] = [movers[0]!, movers[1]!, movers[2]!];
  const weakest = [...movers].reverse();
  const [w0, w1, w2] = [weakest[0]!, weakest[1]!, weakest[2]!];
  switch (profileId) {
    case "pacer-momentum":
      return [[m0, "LONG", 3], [m1, "LONG", 2], [m2, "LONG", 1]];
    case "pacer-contrarian":
      return [[m0, "SHORT", 3], [m1, "SHORT", 2], [m2, "SHORT", 1]];
    case "pacer-index":
      return [["SPY/USD", "LONG", 3], ["BTC/USD", "LONG", 2], ["ETH/USD", "LONG", 1]];
    case "pacer-crypto-beta":
      return [["SOL/USD", "LONG", 3], ["ETH/USD", "LONG", 2], ["BTC/USD", "LONG", 1]];
    case "pacer-pair":
      return [["BTC/USD", "LONG", 3], ["SOL/USD", "SHORT", 2], ["NVDAx/USD", "LONG", 1]];
    default:
      return [[w0, "LONG", 3], [w1, "LONG", 2], [w2, "LONG", 1]];
  }
}

/**
 * Builds a pacer's locked hand at the seal instant. Legs whose market has no live price yet are
 * locked at 0 and therefore score 0 (scoring treats a non-positive entry as flat).
 */
export function buildPacerHand(
  profile: PacerProfile,
  baseline: PriceBookE9,
  sealPrices: PriceBookE9,
): LockedHand {
  const plan = planFor(profile.id, baseline, sealPrices);
  const legs = plan.map(
    ([market, direction, conviction]): LockedLeg => ({
      market,
      direction,
      conviction,
      entryPriceE9: sealPrices[market] ?? 0n,
    }),
  );
  return [legs[0]!, legs[1]!, legs[2]!];
}
