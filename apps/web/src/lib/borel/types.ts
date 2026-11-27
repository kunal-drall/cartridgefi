/**
 * Borel — Sealed-Conviction Live Market Showdowns.
 * Shared contract between the chain/relayer layer, the live-data layer and the UI.
 * All prices, returns and scores are fixed-point bigint scaled by SCALE (1e9).
 */

export const SCALE = 1_000_000_000n;

/** Markets a hand may draft. Feed IDs are resolved by the live-data layer from Pyth Hermes. */
export const BOREL_MARKETS = ["SOL/USD", "BTC/USD", "ETH/USD", "NVDAx/USD", "SPY/USD"] as const;
export type BorelMarket = (typeof BOREL_MARKETS)[number];

export type Direction = "LONG" | "SHORT";

/** Conviction cards: every hand holds exactly one of each; the 3x card is the secret Sniper. */
export type Conviction = 1 | 2 | 3;

export interface HandLeg {
  readonly market: BorelMarket;
  readonly direction: Direction;
  readonly conviction: Conviction;
}

export type SealedHand = readonly [HandLeg, HandLeg, HandLeg];

export type LegIndex = 0 | 1 | 2;

/** A locked leg remembers the price it was sealed at. */
export interface LockedLeg extends HandLeg {
  readonly entryPriceE9: bigint;
}

export type LockedHand = readonly [LockedLeg, LockedLeg, LockedLeg];

/** The single mid-round tactical move each player gets. */
export type PivotKind = "FLIP" | "SHIELD";

export interface PivotAction {
  readonly legIndex: LegIndex;
  readonly kind: PivotKind;
  /** Price of the pivoted leg's market at the moment the pivot executed. */
  readonly priceE9: bigint;
  readonly atMs: number;
}

export type RoomPhase = "LOBBY" | "SEALED" | "SHOWDOWN" | "SETTLED";

export type RoomMode = "BLITZ_3M" | "MACRO_15M";

export const ROOM_DURATION_MS: Record<RoomMode, number> = {
  BLITZ_3M: 180_000,
  MACRO_15M: 900_000,
};

export type StakeMode = "PAPER" | "DEVNET";

export type RivalKind = "PLAYER" | "PACER_BOT";

/**
 * Leaderboard row. While the room is sealed, rival rows carry only `rank` / `rankDelta`;
 * `scoreE9` is present for the authenticated caller's own row and for every row after settle.
 * `hand` / `pivot` stay undefined until the room settles and unseals. `id` is a short opaque label,
 * never a full session key.
 */
export interface RankRow {
  readonly id: string;
  readonly label: string;
  readonly kind: RivalKind;
  readonly scoreE9?: bigint;
  readonly rank: number;
  /** Positions gained (+) or lost (−) since the hands were sealed. */
  readonly rankDelta?: number;
  readonly isYou?: boolean;
  readonly pivotUsed: boolean;
  readonly hand?: LockedHand;
  readonly pivot?: PivotAction;
}

/** A confirmed on-chain action surfaced to the UI. */
export interface ChainReceipt {
  readonly label: string;
  readonly signature: string;
  readonly cluster: "devnet" | "magicblock-er";
  readonly explorerUrl: string;
  readonly slot?: number;
}
