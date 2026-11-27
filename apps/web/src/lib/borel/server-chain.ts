// Server-only: Borel room lifecycle on Solana Devnet + the MagicBlock Private ER (TEE), relayer-signed.
// Imported exclusively by app/api/borel/* route handlers. Never import from client code.
//
// Source of truth = on-chain data (serverless instances share no memory):
//   * RoomShard PDA (cartridge_er_room.initialize_room_shard, relayer authority), delegated to the
//     devnet TEE validator when the room opens. Its event id is an HMAC of the room id under relayer
//     key material, so the PDA cannot be predicted or pre-created; authority, manifest and timestamps
//     are verified on read.
//   * PlayerStance PDA per player (init_stance_and_delegate → TEE). On the ER the player joins under a
//     Permission Program ACL (join_room_and_init_permission, members = player key + relayer), then the
//     hand and the single pivot are written with submit_stance. While the permission is private the
//     TEE returns nothing for the stance and redacts its transactions to non-members; the relayer, a
//     member, reads it to compute ranks and only ever returns ranks for rivals.
//   * Settlement: request_settlement_vrf → callback (VRF seed in RoomShard), trigger_showdown_unseal +
//     evaluate_player_score per stance, undelegate_player_stance, settle_and_commit_shard (commit +
//     undelegate back to Solana L1).
//   * Authenticated L1 memos for what has no account: the join registry (session → stance) and the
//     final settlement prices. A memo counts only with a valid relayer-key HMAC bound to the room id,
//     the relayer as fee payer, and a blockTime inside its phase window.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  AccountRole,
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  isAddress,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { cartridgeErRoom, cartridgeRegistry } from "@cartridgefi/codama-clients";
import {
  BOREL_MARKETS,
  ROOM_DURATION_MS,
  type BorelMarket,
  type ChainReceipt,
  type Conviction,
  type Direction,
  type HandLeg,
  type LegIndex,
  type LockedHand,
  type PivotAction,
  type PivotKind,
  type RankRow,
  type RoomMode,
  type RoomPhase,
  type StakeMode,
} from "./types";
import { handCommitment, handScoreE9, pythToE9, rankByScore } from "./scoring";
import { PYTH_FEEDS, fetchLatestPricesE9 } from "./pyth";
import { RELAYER_FALLBACK_RPC_URL, RELAYER_RPC_URL, deriveRelayerKeyMaterial, getRelayerRpc, solscanTxUrl } from "../relayer/config";
import { computeUnitLimitIx, memoIx, systemTransferIx } from "../relayer/actions";
import { signSendAndConfirm } from "../relayer/send";
import {
  MAGICBLOCK_TEE_VALIDATOR,
  erExplorerUrl,
  fetchErAccounts,
  sendErTransaction,
  type ErAccount,
} from "../relayer/er";

// ---------------------------------------------------------------------------
// Room schedule (deterministic from wall clock — no server memory needed)
// ---------------------------------------------------------------------------

export const LOBBY_MS: Record<RoomMode, number> = { BLITZ_3M: 45_000, MACRO_15M: 60_000 };
export const SHOWDOWN_WINDOW_MS = 15_000;
const MAX_LOCK_JITTER_MS = 5_000;
/** Server refuses to send a lock this close to lockAt (landing latency margin). */
const LOCK_SEND_MARGIN_MS = 2_000;
/**
 * cartridge_er_room accepts a pivot only once the ER clock reaches start_ts; the ER clock can trail the wall
 * clock by ~1 s, so pivots open this long after startsAt.
 */
const PIVOT_START_MARGIN_MS = 1_500;
/** blockTime has 1 s resolution and txs land ~1–2 s after send: tolerance on upper time bounds. */
const BLOCKTIME_TOLERANCE_MS = 2_000;
/** Prices older than this are refused for entry, pivot and settle. */
export const MAX_PRICE_AGE_MS = 60_000;
/** Latest-quote settle prices count only when sent within this long after 00:00 (Hermes historical has no limit). */
const SETTLE_LATE_MS = 8_000;
/** Rival ranks are recomputed at most once per this window (rank leakage, AUDIT_LOG §5 H3). */
const RIVAL_RANK_CADENCE_MS = 10_000;
/** Seats per client IP per room (AUDIT_LOG §5 H3), enforced from the on-chain join registry. */
const MAX_SEATS_PER_IP_PER_ROOM = Number(process.env.BOREL_MAX_SEATS_PER_IP_PER_ROOM ?? "2");
const MAX_SIGNATURE_PAGES = 5;
/** `-S` marks a staked room: only players with a stake envelope are ever counted on its RoomShard. */
const ROOM_ID_RE = /^(BLITZ_3M|MACRO_15M)-(PAPER|DEVNET)-(\d{1,10})(-S)?$/;
/** Lamports forwarded to a derived player key to pay PlayerStance + delegation rent; leftovers are swept back. */
export const PLAYER_FUNDING_LAMPORTS = 20_000_000n;
/** Per-room seat cap: bounds relayer rent spend per room. */
export const MAX_PLAYERS_PER_ROOM = 24;

export interface RoomSchedule {
  roomId: string;
  mode: RoomMode;
  stake: StakeMode;
  /**
   * Staked rooms (DEVNET only) are separate rooms with their own RoomShard. cartridge_vault_router's
   * distribute_pool_and_fees needs a stake envelope for every player the RoomShard counts, so in a staked
   * room the ER join (which counts the player) happens only once the player's envelope exists.
   */
  staked: boolean;
  cycleIndex: number;
  openAt: number;
  lockAt: number;
  startsAt: number;
  endsAt: number;
}

function cycleMs(mode: RoomMode): number {
  return LOBBY_MS[mode] + ROOM_DURATION_MS[mode];
}

/** Anti-snipe lock jitter (0–5 s before start), derived from the room id hash — deterministic, not VRF. */
function lockJitterMs(roomId: string): number {
  const h = createHash("sha256").update(`borel:jitter:${roomId}`).digest();
  return h.readUInt32LE(0) % (MAX_LOCK_JITTER_MS + 1);
}

export function scheduleFor(mode: RoomMode, stake: StakeMode, cycleIndex: number, staked = false): RoomSchedule {
  const c = cycleMs(mode);
  const openAt = cycleIndex * c;
  const startsAt = openAt + LOBBY_MS[mode];
  const isStaked = staked && stake === "DEVNET";
  const roomId = `${mode}-${stake}-${cycleIndex}${isStaked ? "-S" : ""}`;
  return {
    roomId,
    mode,
    stake,
    staked: isStaked,
    cycleIndex,
    openAt,
    startsAt,
    lockAt: startsAt - lockJitterMs(roomId),
    endsAt: startsAt + ROOM_DURATION_MS[mode],
  };
}

/** The room a new player joins now: the current cycle while its lobby is open, else the next one. */
export function joinableRoom(mode: RoomMode, stake: StakeMode, nowMs: number, staked = false): RoomSchedule {
  const c = cycleMs(mode);
  const k = Math.floor(nowMs / c);
  const current = scheduleFor(mode, stake, k, staked);
  // Leave at least 10 s to seal a hand; otherwise seat the player in the next room.
  return nowMs < current.lockAt - 10_000 ? current : scheduleFor(mode, stake, k + 1, staked);
}

export function parseRoomId(roomId: string): RoomSchedule | null {
  const m = ROOM_ID_RE.exec(roomId);
  if (!m) return null;
  const k = Number(m[3]);
  if (!Number.isSafeInteger(k)) return null;
  if (m[4] && m[2] !== "DEVNET") return null;
  return scheduleFor(m[1] as RoomMode, m[2] as StakeMode, k, m[4] === "-S");
}

// ---------------------------------------------------------------------------
// Program constants
// ---------------------------------------------------------------------------

const ER_ROOM_PROGRAM = cartridgeErRoom.CARTRIDGE_ER_ROOM_PROGRAM_ADDRESS;
const REGISTRY_PROGRAM = cartridgeRegistry.CARTRIDGE_REGISTRY_PROGRAM_ADDRESS;
const DELEGATION_PROGRAM_ID = address("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const PERMISSION_PROGRAM_ID = address("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const VRF_PROGRAM_ID = address("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
/** Delegated (ephemeral) VRF oracle queue: the request runs inside the ER. */
const VRF_EPHEMERAL_QUEUE = address("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
/** MagicBlock pricing oracle SOL/USD feed (PriceUpdateV3, refreshed on the ER). submit/evaluate verify ≤ 15 s age. */
const ER_SOL_USD_ORACLE = address("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const MAGIC_VAULT = address("MagicVau1t999999999999999999999999999999999");
const TEE_VALIDATOR = address(MAGICBLOCK_TEE_VALIDATOR);
/** Lock + exactly one pivot, enforced on-chain by the manifest. */
const MAX_REBALANCES = 2;
const PLAYER_STANCE_DISCRIMINATOR = [34, 31, 241, 244, 80, 163, 83, 43] as const;

const addressEncoder = getAddressEncoder();

// ---------------------------------------------------------------------------
// On-chain room accounts
// ---------------------------------------------------------------------------

function sha256(input: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(input, "utf8").digest());
}

function manifestSlug(mode: RoomMode, stake: StakeMode): string {
  return `borel-${mode === "BLITZ_3M" ? "blitz-3m" : "macro-15m"}-${stake.toLowerCase()}-v2`;
}

/** cartridge_registry rejects fog_of_war_bps above 9000 (FogOfWarExceedsCap). */
const REGISTRY_MAX_FOG_BPS = 9_000;

/**
 * Earliest on-chain unseal: as close to the final 15 s as the registry cap allows (BLITZ 162 s of 180 s).
 * The relayer only sends trigger_showdown_unseal at settle, after 00:00, so stances stay private for
 * the whole live window either way; unseal_ts is the program-enforced lower bound.
 */
function fogOfWarBps(mode: RoomMode): number {
  const d = ROOM_DURATION_MS[mode];
  return Math.min(REGISTRY_MAX_FOG_BPS, Math.ceil(((d - SHOWDOWN_WINDOW_MS) * 10_000) / d));
}

function padUri96(uri: string): Uint8Array {
  const out = new Uint8Array(96);
  const raw = new TextEncoder().encode(uri);
  out.set(raw.subarray(0, 96), 0);
  return out;
}

function plainInstruction(ix: Instruction): Instruction {
  return {
    programAddress: ix.programAddress,
    accounts: (ix.accounts ?? []).map((a) => ({ address: a.address, role: a.role })),
    data: ix.data,
  };
}

async function delegationPdas(account: Address): Promise<{ buffer: Address; record: Address; metadata: Address }> {
  const bytes = addressEncoder.encode(account);
  const [buffer] = await getProgramDerivedAddress({ programAddress: ER_ROOM_PROGRAM, seeds: [new TextEncoder().encode("buffer"), bytes] });
  const [record] = await getProgramDerivedAddress({ programAddress: DELEGATION_PROGRAM_ID, seeds: [new TextEncoder().encode("delegation"), bytes] });
  const [metadata] = await getProgramDerivedAddress({
    programAddress: DELEGATION_PROGRAM_ID,
    seeds: [new TextEncoder().encode("delegation-metadata"), bytes],
  });
  return { buffer, record, metadata };
}

/** Permission Program PDA `["permission:", account]` (ER-local EphemeralPermission). */
async function permissionPda(account: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERMISSION_PROGRAM_ID,
    seeds: [new TextEncoder().encode("permission:"), addressEncoder.encode(account)],
  });
  return pda;
}

export interface RoomChainPlan {
  roomShardPda: Address;
  manifestPda: Address;
  eventId: Uint8Array;
  registerIx: Instruction;
  initRoomIx: Instruction;
  delegateRoomIx: Instruction;
}

/** Unpredictable 32-byte event id: HMAC(relayer key material, full room id incl. full cycle index). */
function roomEventId(roomId: string): Uint8Array {
  return deriveRelayerKeyMaterial(`borel:event:v2:${roomId}`);
}

export async function roomChainPlan(room: RoomSchedule, relayer: Address): Promise<RoomChainPlan> {
  const slug = manifestSlug(room.mode, room.stake);
  const slugHash = sha256(slug);
  const [manifestPda] = await getProgramDerivedAddress({
    programAddress: REGISTRY_PROGRAM,
    seeds: [new TextEncoder().encode("cartridge"), slugHash],
  });
  const registerIx = await cartridgeRegistry.getRegisterCartridgeInstructionAsync({
    creator: createNoopSigner(relayer),
    creatorFeeVault: relayer,
    cartridgeManifest: manifestPda,
    slugHash,
    creatorShareBps: 0,
    genreCode: 0,
    durationSecs: ROOM_DURATION_MS[room.mode] / 1000,
    fogOfWarBps: fogOfWarBps(room.mode),
    maxRebalances: MAX_REBALANCES,
    scoringFormula: cartridgeRegistry.ScoringFormula.DirectionNeutralRelReturn,
    actionBindingMode: cartridgeRegistry.ActionBindingMode.ConvictionWeights,
    allowedFeedsMerkleRoot: sha256(BOREL_MARKETS.join("|")),
    manifestUri: padUri96(`https://cartridgefi.com/borel/${slug}`),
  });
  const eventId = roomEventId(room.roomId);
  const [roomShardPda] = await cartridgeErRoom.findRoomShardPda({ eventId, shardIndex: 0 });
  const initRoomIx = cartridgeErRoom.getInitializeRoomShardInstruction({
    authority: createNoopSigner(relayer),
    cartridgeManifest: manifestPda,
    roomShard: roomShardPda,
    eventId,
    shardIndex: 0,
    startTs: BigInt(Math.floor(room.startsAt / 1000)),
    roomPoolUsdc: 0n,
    crankTaskId: BigInt(room.cycleIndex),
  });
  const del = await delegationPdas(roomShardPda);
  const delegateRoomIx = cartridgeErRoom.getDelegateRoomShardInstruction({
    authority: createNoopSigner(relayer),
    bufferRoomShard: del.buffer,
    delegationRecordRoomShard: del.record,
    delegationMetadataRoomShard: del.metadata,
    roomShard: roomShardPda,
    validator: TEE_VALIDATOR,
    eventId,
    shardIndex: 0,
  });
  return {
    roomShardPda,
    manifestPda,
    eventId,
    registerIx: plainInstruction(registerIx),
    initRoomIx: plainInstruction(initRoomIx),
    delegateRoomIx: plainInstruction(delegateRoomIx),
  };
}

/** Deterministic per-(room, session) keypair; re-derivable on any instance from the relayer secret. */
async function derivedSigner(kind: "player" | "session", roomId: string, sessionPubkey: string): Promise<KeyPairSigner> {
  const seed = deriveRelayerKeyMaterial(`borel:${kind}:v1:${roomId}:${sessionPubkey}`);
  return createKeyPairSignerFromPrivateKeyBytes(seed);
}

const playerAddressCache = new Map<string, Address>();

async function playerAddressFor(roomId: string, sessionPubkey: string): Promise<Address> {
  const key = `${roomId}|${sessionPubkey}`;
  const cached = playerAddressCache.get(key);
  if (cached) return cached;
  const signer = await derivedSigner("player", roomId, sessionPubkey);
  if (playerAddressCache.size > 10_000) playerAddressCache.clear();
  playerAddressCache.set(key, signer.address);
  return signer.address;
}

async function stancePdaFor(roomShard: Address, roomId: string, sessionPubkey: string): Promise<Address> {
  const player = await playerAddressFor(roomId, sessionPubkey);
  const [pda] = await cartridgeErRoom.findPlayerStancePda({ roomShard, player });
  return pda;
}

// ---------------------------------------------------------------------------
// Hand ↔ PlayerStance encoding (layout v2)
//
// The program keeps 4 conviction-weight slots. Slot 0 is priced in-program by the MagicBlock ER SOL/USD
// oracle, so Borel leaves it empty: the hand's three markets, in BOREL_MARKETS order, sit in slots 1..3,
// whose entry and exit prices are passed by the server (fresh Pyth at lock, Pyth at 00:00 at settle).
// Every price a Borel score uses is therefore server-set; the ER oracle only gates the program's checks.
//   weights_bps[slot]   = sign(direction) × conviction × 1000 (gross 6000 ≤ 10000 cap)
//   kalshi_prob_bps     = 500 + marketSet × 48 + legOrder × 8 + directionBits  (≤ 979; formula 0 ignores it)
//   stage1_score_scaled = pivot price (1e9) on the pivot submit
// A pivot rewrites the weights (FLIP negates the leg, SHIELD zeroes it); the original directions in
// kalshi_prob_bps identify which leg moved. Everything lives in the private stance until unseal.
// Only stances whose join the relayer performed (HMAC join memo → derived player key) are ever decoded.
// ---------------------------------------------------------------------------

const LAYOUT_V2_BASE = 500;
const MARKET_SETS: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (let a = 0; a < BOREL_MARKETS.length; a += 1)
    for (let b = a + 1; b < BOREL_MARKETS.length; b += 1)
      for (let c = b + 1; c < BOREL_MARKETS.length; c += 1) out.push([a, b, c]);
  return out;
})();
const LEG_ORDERS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
function slotOfSetPosition(_set: readonly [number, number, number], position: number): number {
  return position + 1;
}

interface StanceLayout {
  code: number;
  /** Market held in each of the 4 slots (null = empty). */
  slotMarkets: (BorelMarket | null)[];
  /** Slot of each hand leg. */
  legSlots: [number, number, number];
}

function layoutForHand(hand: readonly HandLeg[]): StanceLayout {
  const idx = hand.map((leg) => BOREL_MARKETS.indexOf(leg.market));
  const sorted = [...idx].sort((a, b) => a - b);
  const setIndex = MARKET_SETS.findIndex((s) => s[0] === sorted[0] && s[1] === sorted[1] && s[2] === sorted[2]);
  if (setIndex < 0) throw new BorelRuleError("A hand needs three different markets");
  const set = MARKET_SETS[setIndex]!;
  const positions = idx.map((m) => set.indexOf(m)) as [number, number, number];
  const order = LEG_ORDERS.findIndex((o) => o[0] === positions[0] && o[1] === positions[1] && o[2] === positions[2]);
  const dirs = hand.reduce((bits, leg, i) => bits | (leg.direction === "SHORT" ? 1 << i : 0), 0);
  const slotMarkets: (BorelMarket | null)[] = [null, null, null, null];
  set.forEach((m, p) => {
    slotMarkets[slotOfSetPosition(set, p)] = BOREL_MARKETS[m] as BorelMarket;
  });
  return {
    code: LAYOUT_V2_BASE + setIndex * 48 + order * 8 + dirs,
    slotMarkets,
    legSlots: positions.map((p) => slotOfSetPosition(set, p)) as [number, number, number],
  };
}

function weightsFor(hand: readonly HandLeg[], layout: StanceLayout, pivot?: { legIndex: LegIndex; kind: PivotKind }): [number, number, number, number] {
  const w: [number, number, number, number] = [0, 0, 0, 0];
  hand.forEach((leg, i) => {
    let weight = (leg.direction === "LONG" ? 1 : -1) * leg.conviction * 1000;
    if (pivot && pivot.legIndex === i) weight = pivot.kind === "FLIP" ? -weight : 0;
    w[layout.legSlots[i]!] = weight;
  });
  return w;
}

/** Server-set Pyth prices for slots 1..3 in program units (1e8); 0 for an empty slot. */
function slotPrices8(layout: StanceLayout, pricesE9: Readonly<Record<string, bigint>>): [bigint, bigint, bigint] {
  return [1, 2, 3].map((slot) => {
    const m = layout.slotMarkets[slot];
    const p = m ? pricesE9[m] : undefined;
    return p !== undefined ? p / 10n : 0n;
  }) as [bigint, bigint, bigint];
}

type PlayerStanceAccount = ReturnType<ReturnType<typeof cartridgeErRoom.getPlayerStanceDecoder>["decode"]>;
type RoomShardAccount = ReturnType<ReturnType<typeof cartridgeErRoom.getRoomShardDecoder>["decode"]>;

interface DecodedHand {
  hand: LockedHand;
  pivot?: PivotAction;
  layout: StanceLayout;
}

/** Rebuilds the Borel hand (+ pivot) from a PlayerStance. Null when no hand is sealed or the layout is invalid. */
function decodeStanceHand(s: PlayerStanceAccount): DecodedHand | null {
  if (s.moveCount < 1 || s.kalshiProbBps < LAYOUT_V2_BASE) return null;
  const code = s.kalshiProbBps - LAYOUT_V2_BASE;
  const setIndex = Math.floor(code / 48);
  const order = Math.floor((code % 48) / 8);
  const dirs = code % 8;
  const set = MARKET_SETS[setIndex];
  const legOrder = LEG_ORDERS[order];
  if (!set || !legOrder) return null;
  const legs = legOrder.map((position, i) => {
    const slot = slotOfSetPosition(set, position);
    return {
      market: BOREL_MARKETS[set[position]!] as BorelMarket,
      direction: ((dirs >> i) & 1 ? "SHORT" : "LONG") as Direction,
      slot,
      weight: s.weightsBps[slot] ?? 0,
      entry8: s.entryPrices8[slot] ?? 0n,
    };
  });
  let pivot: PivotAction | undefined;
  const convictions: number[] = legs.map((l) => Math.abs(l.weight) / 1000);
  if (s.moveCount >= 2) {
    for (let i = 0; i < 3; i += 1) {
      const leg = legs[i]!;
      const kind: PivotKind | null =
        leg.weight === 0 ? "SHIELD" : (leg.weight > 0) !== (leg.direction === "LONG") ? "FLIP" : null;
      if (kind) {
        pivot = { legIndex: i as LegIndex, kind, priceE9: s.stage1ScoreScaled, atMs: Number(s.lastMoveTs) * 1000 };
        if (kind === "SHIELD") convictions[i] = 6 - convictions.reduce((a, c, j) => (j === i ? a : a + c), 0);
        break;
      }
    }
  }
  const cards = new Set(convictions);
  if (!(cards.has(1) && cards.has(2) && cards.has(3))) return null;
  const hand = legs.map((l, i) => ({
    market: l.market,
    direction: l.direction,
    conviction: convictions[i] as Conviction,
    entryPriceE9: l.entry8 * 10n,
  })) as unknown as LockedHand;
  return { hand, pivot, layout: layoutForHand(hand) };
}

/** Short opaque public label for a session; full session keys are never exposed in room rows. */
function publicId(session: string): string {
  return createHash("sha256").update(`borel:seat:${session}`).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Live prices (shared Pyth layer) — server-side authority for entry / pivot / settle prices
// ---------------------------------------------------------------------------

export interface FreshPrices {
  prices: Partial<Record<BorelMarket, bigint>>;
  publishTimeMs: Partial<Record<BorelMarket, number>>;
}

async function latestPrices(): Promise<FreshPrices> {
  try {
    const result = await fetchLatestPricesE9(BOREL_MARKETS);
    return { prices: result.pricesE9, publishTimeMs: result.publishTimeMs };
  } catch {
    return { prices: {}, publishTimeMs: {} };
  }
}

/** Returns a price for each market or throws a rule error naming every missing / stale feed. */
async function requireFreshPrices(markets: readonly BorelMarket[], nowMs: number): Promise<Record<string, bigint>> {
  const { prices, publishTimeMs } = await latestPrices();
  const out: Record<string, bigint> = {};
  const problems: string[] = [];
  for (const m of new Set(markets)) {
    const p = prices[m];
    const t = publishTimeMs[m];
    if (p === undefined || p <= 0n || t === undefined) {
      problems.push(`${m} has no Pyth price${m === "SPY/USD" ? " (SPY needs PYTH_API_KEY / US session)" : ""}`);
    } else if (nowMs - t > MAX_PRICE_AGE_MS) {
      problems.push(`${m} Pyth price is ${Math.round((nowMs - t) / 1000)}s old (max ${MAX_PRICE_AGE_MS / 1000}s)`);
    } else {
      out[m] = p;
    }
  }
  if (problems.length > 0) throw new BorelRuleError(problems.join("; "));
  return out;
}

/** Global price snapshot per RIVAL_RANK_CADENCE_MS bucket (per instance): rival ranks move at most every 10 s. */
let rankBucket: { index: number; prices: Promise<Partial<Record<BorelMarket, bigint>>> } | null = null;

function cadencePrices(nowMs: number): Promise<Partial<Record<BorelMarket, bigint>>> {
  const index = Math.floor(nowMs / RIVAL_RANK_CADENCE_MS);
  if (!rankBucket || rankBucket.index !== index) rankBucket = { index, prices: latestPrices().then((r) => r.prices) };
  return rankBucket.prices;
}

const HERMES_URL = "https://hermes.pyth.network";

/** Pyth Hermes historical update for one feed at `ts` (first publish ≥ ts); null when not entitled / unavailable. */
async function hermesPriceAt(market: BorelMarket, ts: number, apiKey: string): Promise<{ priceE9: bigint; publishTs: number } | null> {
  try {
    const res = await fetch(`${HERMES_URL}/v2/updates/price/${ts}?ids[]=${PYTH_FEEDS[market].feedId}&parsed=true`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { parsed?: { price: { price: string; expo: number; publish_time: number } }[] };
    const update = json.parsed?.[0];
    if (!update) return null;
    const price = BigInt(update.price.price);
    return price > 0n ? { priceE9: pythToE9(price, update.price.expo), publishTs: update.price.publish_time } : null;
  } catch {
    return null;
  }
}

/**
 * Settlement prices at endsAt (AUDIT_LOG §5 M1). Per market: the Hermes historical update published in
 * [endsAt, endsAt + 5 s] when PYTH_API_KEY grants the feed; otherwise the latest quote, accepted only while
 * now ≤ endsAt + SETTLE_LATE_MS and published in [endsAt − 60 s, endsAt + 2 s]. Any held market without such
 * a price refuses the settle (no silent zero, no call-time pricing).
 */
async function pricesAtEndsAt(markets: readonly BorelMarket[], room: RoomSchedule, nowMs: number): Promise<{ prices: Record<string, bigint>; source: "h" | "l" }> {
  const ts = Math.floor(room.endsAt / 1000);
  const apiKey = process.env.PYTH_API_KEY?.trim();
  const out: Record<string, bigint> = {};
  const problems: string[] = [];
  let allHistorical = true;
  const latest = nowMs <= room.endsAt + SETTLE_LATE_MS ? await latestPrices() : null;
  for (const m of new Set(markets)) {
    const hist = apiKey ? await hermesPriceAt(m, ts, apiKey) : null;
    if (hist && hist.publishTs >= ts && hist.publishTs <= ts + 5) {
      out[m] = hist.priceE9;
      continue;
    }
    allHistorical = false;
    const p = latest?.prices[m];
    const t = latest?.publishTimeMs[m];
    if (p !== undefined && p > 0n && t !== undefined && t >= room.endsAt - MAX_PRICE_AGE_MS && t <= room.endsAt + 2_000) {
      out[m] = p;
    } else {
      problems.push(
        latest
          ? `${m} has no Pyth price published at 00:00`
          : `${m} has no Hermes historical price at 00:00 and the ${SETTLE_LATE_MS / 1000}s window for latest quotes has passed`,
      );
    }
  }
  if (problems.length > 0) throw new BorelRuleError(problems.join("; "));
  return { prices: out, source: allHistorical ? "h" : "l" };
}

/** Room-scoped, relayer-keyed tag of the client IP: counts seats per IP without publishing the IP. */
export function joinIpTag(roomId: string, clientIp: string): string {
  return createHmac("sha256", deriveRelayerKeyMaterial("borel:ip:v1")).update(`${roomId}|${clientIp}`).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Authenticated L1 memos (join registry + settlement prices) and L1 commit receipts
// ---------------------------------------------------------------------------

function memoMac(roomId: string, body: string): string {
  const key = deriveRelayerKeyMaterial("borel:memo:v1");
  return createHmac("sha256", key).update(`${roomId}|${body}`).digest("hex").slice(0, 32);
}

function signedMemo(roomId: string, body: string): Instruction {
  return memoIx(`${body}:h=${memoMac(roomId, body)}`);
}

function verifiedBody(roomId: string, text: string): string | null {
  const at = text.lastIndexOf(":h=");
  if (at < 0) return null;
  const body = text.slice(0, at);
  const mac = text.slice(at + 3);
  const expected = memoMac(roomId, body);
  if (mac.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? body : null;
}

interface JoinEvent { kind: "join"; session: string; ipTag: string | null; signature: string; slot: number; atMs: number }
interface SettleEvent {
  kind: "settle";
  /** Unix second the prices are for (must equal the room's endsAt). */
  priceTs: number;
  /** "h" = Pyth Hermes historical update at endsAt; "l" = latest quotes taken within SETTLE_LATE_MS of endsAt. */
  source: "h" | "l";
  prices: Partial<Record<BorelMarket, bigint>>;
  signature: string;
  slot: number;
  atMs: number;
}
type MemoEvent = JoinEvent | SettleEvent;
/** L1 transaction on the RoomShard fee-paid by the TEE validator: the ER → L1 commit + undelegation. */
interface CommitEvent { signature: string; slot: number; atMs: number }

const SESSION_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function parseMemoEntries(memoField: string): string[] {
  // RPC format: "[len] text; [len] text"
  return memoField
    .split("; ")
    .map((part) => part.replace(/^\[\d+\]\s*/, "").trim())
    .filter((t) => t.startsWith("borel:v1:"));
}

function parseEvent(body: string, signature: string, slot: number, atMs: number): MemoEvent | null {
  const parts = body.split(":");
  const kind = parts[2];
  const base = { signature, slot, atMs };
  if (kind === "join" && parts[3] && SESSION_RE.test(parts[3])) {
    const ipTag = parts[5] && /^[0-9a-f]{12}$/.test(parts[5]) ? parts[5] : null;
    return { kind: "join", session: parts[3], ipTag, ...base };
  }
  if (kind === "settle3" && /^\d{1,12}$/.test(parts[3] ?? "") && (parts[4] === "h" || parts[4] === "l")) {
    const prices: Partial<Record<BorelMarket, bigint>> = {};
    for (const entry of (parts[5] ?? "").split(",")) {
      const [idx, value] = entry.split("=");
      const market = BOREL_MARKETS[Number(idx)];
      if (market && value && /^\d{1,30}$/.test(value)) prices[market] = BigInt(value);
    }
    return { kind: "settle", priceTs: Number(parts[3]), source: parts[4], prices, ...base };
  }
  return null;
}

/**
 * Enforces join < lockAt on the blockTime. A settle memo must price exactly endsAt: Hermes historical
 * prices may land any time after 00:00, latest-quote prices only within SETTLE_LATE_MS of 00:00.
 */
function inWindow(ev: MemoEvent, room: RoomSchedule): boolean {
  if (ev.kind === "join") return ev.atMs < room.lockAt + BLOCKTIME_TOLERANCE_MS;
  if (ev.priceTs !== Math.floor(room.endsAt / 1000) || ev.atMs < room.endsAt - 1_000) return false;
  return ev.source === "h" || ev.atMs <= room.endsAt + SETTLE_LATE_MS + BLOCKTIME_TOLERANCE_MS;
}

/** signature → fee payer, cached per instance (confirmed transactions are immutable). */
const feePayerCache = new Map<string, string | null>();
const FEE_PAYER_CACHE_MAX = 20_000;

async function feePayerOf(signature: string): Promise<string | null> {
  const cached = feePayerCache.get(signature);
  if (cached !== undefined) return cached;
  // Raw JSON-RPC: MagicBlock settlement transactions on L1 need maxSupportedTransactionVersion 1.
  // A transient failure throws (never "no payer"), so a rate-limited read cannot drop a join memo.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(attempt % 2 === 0 ? RELAYER_RPC_URL : RELAYER_FALLBACK_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }],
      }),
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt % 2 === 1) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt >> 1)));
      continue;
    }
    const body = (await res.json()) as { result?: { transaction: { message: { accountKeys: string[] } } } | null; error?: unknown };
    if (body.error) throw new Error(`getTransaction ${signature.slice(0, 12)}… failed`);
    if (!body.result) return null;
    const payer = String(body.result.transaction.message.accountKeys[0] ?? "") || null;
    if (feePayerCache.size >= FEE_PAYER_CACHE_MAX) feePayerCache.clear();
    feePayerCache.set(signature, payer);
    return payer;
  }
  throw new Error("Devnet RPC is rate limiting room reads; retry shortly");
}

async function readRoomEvents(
  room: RoomSchedule,
  roomShard: Address,
  relayerPubkey: string,
): Promise<{ memos: MemoEvent[]; commits: CommitEvent[] }> {
  const rpc = getRelayerRpc();
  const all: { signature: string; slot: number; memo: string | null; blockTime: number | null; failed: boolean }[] = [];
  let before: Signature | undefined;
  for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
    const sigs = await rpc
      .getSignaturesForAddress(roomShard, { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) })
      .send();
    for (const s of sigs) {
      all.push({ signature: s.signature, slot: Number(s.slot), memo: s.memo, blockTime: s.blockTime === null ? null : Number(s.blockTime), failed: s.err !== null });
    }
    if (sigs.length < 1000) break;
    before = sigs[sigs.length - 1]?.signature;
  }
  // Pass 1: HMAC + time window (cheap). Pass 2: fee payer must be the relayer (one getTransaction
  // per candidate signature, cached), so replayed relayer memos inside third-party txs are ignored.
  const candidates: { signature: string; events: MemoEvent[] }[] = [];
  const commitCandidates: CommitEvent[] = [];
  // RPC returns newest first; replay oldest first so "first wins" rules are deterministic.
  for (const s of all.reverse()) {
    if (s.failed || s.blockTime === null) continue;
    if (!s.memo) {
      if (s.blockTime * 1000 >= room.endsAt - 1_000) commitCandidates.push({ signature: s.signature, slot: s.slot, atMs: s.blockTime * 1000 });
      continue;
    }
    const evs: MemoEvent[] = [];
    for (const text of parseMemoEntries(s.memo)) {
      const body = verifiedBody(room.roomId, text);
      if (!body) continue;
      const ev = parseEvent(body, s.signature, s.slot, s.blockTime * 1000);
      if (ev && inWindow(ev, room)) evs.push(ev);
    }
    if (evs.length > 0) candidates.push({ signature: s.signature, events: evs });
  }
  const lookups = [...candidates.map((c) => c.signature), ...commitCandidates.map((c) => c.signature)];
  const payers: (string | null)[] = [];
  for (let i = 0; i < lookups.length; i += 8) {
    payers.push(...(await Promise.all(lookups.slice(i, i + 8).map((sig) => feePayerOf(sig)))));
  }
  const memos = candidates.flatMap((c, i) => (payers[i] === relayerPubkey ? c.events : []));
  const commits = commitCandidates.filter((_, i) => payers[candidates.length + i] === MAGICBLOCK_TEE_VALIDATOR);
  return { memos, commits };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface PlayerState {
  /** Authenticated L1 join memo for this session (the registry). */
  joined: boolean;
  /** Room-scoped HMAC of the joining client IP (seat cap per IP). */
  ipTag?: string | null;
  stancePda?: Address;
  /** Where the stance was read: the TEE while delegated, L1 after the commit. */
  stanceSource?: "er" | "l1";
  stance?: PlayerStanceAccount;
  /** Decoded sealed hand (+ pivot); server-side only, never returned for rivals before settle. */
  hand?: LockedHand;
  pivot?: PivotAction;
  layout?: StanceLayout;
}

export interface SettledInfo {
  /** VRF output (hex) from RoomShard.vrf_seed. */
  seedHex: string;
  /** Final server-set Pyth prices committed in the settle memo. */
  prices: Partial<Record<BorelMarket, bigint>>;
  signature: string;
  slot: number;
  atMs: number;
}

export interface RoomStateSnapshot {
  schedule: RoomSchedule;
  phase: RoomPhase;
  vrfSeed: string;
  seedSource: string | null;
  roomShardPda: Address;
  roomExists: boolean;
  /** True while the RoomShard is delegated to the TEE validator (L1 owner = Delegation Program). */
  roomDelegated: boolean;
  /** Set when an account exists at our PDA but is not a relayer-authored room for this schedule. */
  roomInvalid: string | null;
  /** Live RoomShard (TEE while delegated, L1 after the commit). */
  shard: RoomShardAccount | null;
  receipts: ChainReceipt[];
  rows: RankRow[];
  players: Map<string, PlayerState>;
  settleMemo: SettleEvent | null;
  commits: CommitEvent[];
  settled: SettledInfo | null;
}

function receipt(label: string, signature: string, slot?: number): ChainReceipt {
  return { label, signature, cluster: "devnet", explorerUrl: solscanTxUrl(signature), slot };
}

export function erReceipt(label: string, signature: string, slot?: number): ChainReceipt {
  return { label, signature, cluster: "magicblock-er", explorerUrl: erExplorerUrl(signature), slot };
}

function verifyRoomAccount(data: Uint8Array, room: RoomSchedule, relayerPubkey: string, manifestPda: Address): string | null {
  try {
    const shard = cartridgeErRoom.getRoomShardDecoder().decode(data);
    if (shard.authority !== relayerPubkey) return "RoomShard authority is not the relayer";
    if (shard.cartridgeManifest !== manifestPda) return "RoomShard manifest is not the Borel v2 manifest";
    if (shard.startTs !== BigInt(Math.floor(room.startsAt / 1000)) || shard.endTs !== BigInt(Math.floor(room.endsAt / 1000))) {
      return "RoomShard timestamps do not match the room schedule";
    }
    return null;
  } catch {
    return "RoomShard account could not be decoded";
  }
}

interface L1Account {
  owner: string;
  data: Uint8Array;
}

async function fetchL1Accounts(addresses: readonly Address[]): Promise<(L1Account | null)[]> {
  if (addresses.length === 0) return [];
  const out: (L1Account | null)[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const res = await getRelayerRpc()
      .getMultipleAccounts(addresses.slice(i, i + 100), { encoding: "base64", commitment: "confirmed" })
      .send();
    for (const acc of res.value) out.push(acc ? { owner: String(acc.owner), data: new Uint8Array(Buffer.from(acc.data[0], "base64")) } : null);
  }
  return out;
}

function decodeShard(acc: L1Account | ErAccount | null): RoomShardAccount | null {
  if (!acc || acc.owner !== ER_ROOM_PROGRAM) return null;
  try {
    return cartridgeErRoom.getRoomShardDecoder().decode(acc.data);
  } catch {
    return null;
  }
}

function decodeStance(acc: L1Account | ErAccount | null): PlayerStanceAccount | null {
  if (!acc || acc.owner !== ER_ROOM_PROGRAM) return null;
  if (!PLAYER_STANCE_DISCRIMINATOR.every((b, i) => acc.data[i] === b)) return null;
  try {
    return cartridgeErRoom.getPlayerStanceDecoder().decode(acc.data);
  } catch {
    return null;
  }
}

function hexOf(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Reads a room from chain. `relayerPubkey` is the real relayer (authority check); `planPayer` is the
 * address used to derive instructions (stand-in payer during unfunded dry-runs). `viewerSession` is an
 * authenticated session key whose own row may include its live score.
 */
export async function readRoomState(
  room: RoomSchedule,
  planPayer: Address,
  relayerPubkey: string,
  nowMs: number,
  viewerSession?: string,
): Promise<RoomStateSnapshot> {
  const plan = await roomChainPlan(room, planPayer);
  const [l1Shard] = await fetchL1Accounts([plan.roomShardPda]);
  const roomInvalid = l1Shard ? verifyRoomAccount(l1Shard.data, room, relayerPubkey, plan.manifestPda) : null;
  const roomDelegated = l1Shard?.owner === DELEGATION_PROGRAM_ID;
  const { memos, commits } =
    l1Shard && !roomInvalid ? await readRoomEvents(room, plan.roomShardPda, relayerPubkey) : { memos: [], commits: [] };

  const players = new Map<string, PlayerState>();
  const receipts: ChainReceipt[] = [];
  let settleMemo: SettleEvent | null = null;
  for (const ev of memos) {
    if (ev.kind === "settle") {
      if (!settleMemo) {
        settleMemo = ev;
        receipts.push(receipt("Settle: final server-set Pyth prices committed (HMAC memo)", ev.signature, ev.slot));
      }
      continue;
    }
    if (players.has(ev.session) || players.size >= MAX_PLAYERS_PER_ROOM) continue;
    players.set(ev.session, { joined: true, ipTag: ev.ipTag });
    receipts.push(receipt(`Join ${publicId(ev.session).slice(0, 6)}: PlayerStance init + delegation to the MagicBlock TEE validator`, ev.signature, ev.slot));
  }

  // Stances: L1 first (public after the commit), TEE (relayer token) while delegated.
  let shard: RoomShardAccount | null = null;
  if (l1Shard && !roomInvalid) {
    const sessions = [...players.keys()];
    const stancePdas = await Promise.all(sessions.map((s) => stancePdaFor(plan.roomShardPda, room.roomId, s)));
    const l1 = await fetchL1Accounts(stancePdas);
    const needEr = stancePdas.filter((_, i) => l1[i]?.owner === DELEGATION_PROGRAM_ID);
    const erAccounts = await fetchErAccounts(roomDelegated ? [plan.roomShardPda, ...needEr] : needEr);
    const erByAddress = new Map<string, ErAccount | null>(
      (roomDelegated ? [plan.roomShardPda, ...needEr] : needEr).map((a, i) => [a, erAccounts[i] ?? null]),
    );
    shard = roomDelegated ? decodeShard(erByAddress.get(plan.roomShardPda) ?? null) : decodeShard(l1Shard);
    sessions.forEach((session, i) => {
      const pda = stancePdas[i]!;
      const onL1 = l1[i]?.owner === ER_ROOM_PROGRAM;
      const stance = onL1 ? decodeStance(l1[i] ?? null) : decodeStance(erByAddress.get(pda) ?? null);
      const p = players.get(session)!;
      p.stancePda = pda;
      if (stance) {
        p.stance = stance;
        p.stanceSource = onL1 ? "l1" : "er";
        const decoded = decodeStanceHand(stance);
        if (decoded) {
          p.hand = decoded.hand;
          p.pivot = decoded.pivot;
          p.layout = decoded.layout;
        }
      }
    });
  }

  const committed = shard?.phase === cartridgeErRoom.RoomPhase.SettledCommitted;
  const allEvaluated = [...players.values()].every((p) => !p.stance?.joinedEr || p.stance.evaluated);
  const vrfSeed = shard?.vrfFulfilled ? hexOf(shard.vrfSeed) : "";
  const settled: SettledInfo | null =
    settleMemo && vrfSeed && allEvaluated
      ? { seedHex: vrfSeed, prices: settleMemo.prices, signature: settleMemo.signature, slot: settleMemo.slot, atMs: settleMemo.atMs }
      : null;
  for (const c of commits) receipts.push(receipt("MagicBlock TEE → Solana L1: commit + undelegate (Delegation Program)", c.signature, c.slot));

  const phase: RoomPhase = settled
    ? "SETTLED"
    : nowMs < room.lockAt
      ? "LOBBY"
      : nowMs < room.endsAt - SHOWDOWN_WINDOW_MS
        ? "SEALED"
        : "SHOWDOWN";

  // Final prices after settle. Before settle, rival ranks use a 10 s price snapshot; only the viewer's own
  // score is live (AUDIT_LOG §5 H3). Entry, pivot and exit prices are all server-set (layout v2).
  const rankPrices = settled ? settled.prices : await cadencePrices(nowMs);
  const ownPrices = settled ? settled.prices : (await latestPrices()).prices;

  const scored: Array<{ id: string; session: string; scoreE9: bigint; hand: LockedHand; pivot?: PivotAction }> = [];
  for (const [session, p] of players) {
    if (!p.hand) continue;
    scored.push({ id: publicId(session), session, scoreE9: handScoreE9(p.hand, rankPrices, p.pivot), hand: p.hand, pivot: p.pivot });
  }
  const baseRank = new Map(rankByScore(scored.map((s) => ({ id: s.id, scoreE9: 0n })), "").map((r) => [r.id, r.rank]));
  const ranked = rankByScore(scored, settled ? vrfSeed : "");
  // Lobby: nothing about rivals (not even the seat count); the viewer sees only their own row.
  const visible = phase === "LOBBY" ? ranked.filter((r) => r.session === viewerSession).map((r) => ({ ...r, rank: 1 })) : ranked;
  const rows: RankRow[] = visible.map((r) => {
    const isYou = viewerSession !== undefined && r.session === viewerSession;
    const own = isYou ? players.get(r.session) : undefined;
    const scoreE9 = settled ? r.scoreE9 : own?.hand ? handScoreE9(own.hand, ownPrices, own.pivot) : undefined;
    return {
      id: r.id,
      label: isYou ? "You" : `Player ${r.id.slice(0, 6)}`,
      kind: "PLAYER",
      rank: r.rank,
      rankDelta: phase === "LOBBY" ? 0 : (baseRank.get(r.id) ?? r.rank) - r.rank,
      // Rivals' pivot use stays hidden until settle.
      pivotUsed: (settled !== null || isYou) && r.pivot !== undefined,
      ...(isYou ? { isYou: true } : {}),
      ...((settled !== null || isYou) && scoreE9 !== undefined ? { scoreE9 } : {}),
      ...(settled ? { hand: r.hand, ...(r.pivot ? { pivot: r.pivot } : {}) } : {}),
    };
  });

  return {
    schedule: room,
    phase,
    vrfSeed: settled ? vrfSeed : "",
    seedSource: settled
      ? `MagicBlock VRF: request_settlement_vrf → callback_settlement_vrf wrote RoomShard.vrf_seed${committed ? " (committed to Solana L1)" : " (on the TEE ER)"}`
      : null,
    roomShardPda: plan.roomShardPda,
    roomExists: l1Shard !== null,
    roomDelegated,
    roomInvalid,
    shard,
    receipts,
    rows,
    players,
    settleMemo,
    commits,
    settled,
  };
}

// ---------------------------------------------------------------------------
// Transaction builders
// ---------------------------------------------------------------------------

export class BorelRuleError extends Error {}

export interface BuiltBorelTx {
  label: string;
  instructions: Instruction[];
  extraSigners: KeyPairSigner[];
  sweepSigners: KeyPairSigner[];
}

/** 0-lamport transfer that write-locks the RoomShard so the tx is indexed under the room address. */
function roomIndexIx(relayer: Address, roomShard: Address): Instruction {
  return systemTransferIx(relayer, roomShard, 0n);
}

function assertRoomUsable(state: RoomStateSnapshot): void {
  if (state.roomInvalid) throw new BorelRuleError(`Room rejected: ${state.roomInvalid}`);
}

/**
 * L1 join: (first player) register the v2 manifest, open the RoomShard and delegate it to the TEE
 * validator; then fund the derived player key, init_stance_and_delegate (→ TEE) and the HMAC join memo.
 */
export async function buildJoin(
  room: RoomSchedule,
  sessionPubkey: string,
  relayer: Address,
  state: RoomStateSnapshot,
  clientIp: string,
): Promise<BuiltBorelTx[]> {
  assertRoomUsable(state);
  const ipTag = joinIpTag(room.roomId, clientIp);
  const seatsFromIp = [...state.players.values()].filter((p) => p.ipTag === ipTag).length;
  if (seatsFromIp >= MAX_SEATS_PER_IP_PER_ROOM) {
    throw new BorelRuleError(`This network already holds ${MAX_SEATS_PER_IP_PER_ROOM} seats in this room; join the next room`);
  }
  if (state.phase !== "LOBBY") throw new BorelRuleError("Room lobby is closed");
  if (state.players.get(sessionPubkey)?.joined) throw new BorelRuleError("Session already joined this room");
  if (state.players.size >= MAX_PLAYERS_PER_ROOM) throw new BorelRuleError(`Room is full (${MAX_PLAYERS_PER_ROOM} seats)`);
  if (state.roomExists && !state.roomDelegated) throw new BorelRuleError("Room is no longer delegated to the MagicBlock ER");

  const plan = await roomChainPlan(room, relayer);
  const [manifest] = await fetchL1Accounts([plan.manifestPda]);
  const txs: BuiltBorelTx[] = [];
  if (!manifest) {
    txs.push({
      label: "Borel v2 manifest registered (cartridge_registry.register_cartridge: max_rebalances = 2, Fog of War until the final 15 s)",
      instructions: [computeUnitLimitIx(200_000), plan.registerIx],
      extraSigners: [],
      sweepSigners: [],
    });
  }

  const player = await derivedSigner("player", room.roomId, sessionPubkey);
  const session = await derivedSigner("session", room.roomId, sessionPubkey);
  const [stancePda] = await cartridgeErRoom.findPlayerStancePda({ roomShard: plan.roomShardPda, player: player.address });
  const del = await delegationPdas(stancePda);
  const instructions: Instruction[] = [computeUnitLimitIx(600_000)];
  if (!state.roomExists) instructions.push(plan.initRoomIx, plan.delegateRoomIx);
  instructions.push(systemTransferIx(relayer, player.address, PLAYER_FUNDING_LAMPORTS));
  instructions.push(
    plainInstruction(
      cartridgeErRoom.getInitStanceAndDelegateInstruction({
        player: createNoopSigner(player.address),
        roomShard: plan.roomShardPda,
        bufferPlayerStance: del.buffer,
        delegationRecordPlayerStance: del.record,
        delegationMetadataPlayerStance: del.metadata,
        playerStance: stancePda,
        validator: TEE_VALIDATOR,
        // The room authority (relayer) co-signs every seat (audit C1).
        roomAuthority: createNoopSigner(relayer),
        ephemeralSessionKey: session.address,
        sessionExpiryTs: BigInt(Math.floor(room.endsAt / 1000)),
      }),
    ),
  );
  instructions.push(signedMemo(room.roomId, `borel:v1:join:${sessionPubkey}:${room.stake}:${ipTag}`));
  txs.push({
    label: state.roomExists
      ? "Join: PlayerStance initialized & delegated to the MagicBlock TEE validator (init_stance_and_delegate)"
      : "Room opened + delegated to the MagicBlock TEE validator (initialize_room_shard, delegate_room_shard) + PlayerStance init_stance_and_delegate",
    instructions,
    extraSigners: [player],
    sweepSigners: [player],
  });
  return txs;
}

async function joinPermissionIx(relayer: Address, roomShard: Address, stancePda: Address): Promise<Instruction> {
  return plainInstruction(
    cartridgeErRoom.getJoinRoomAndInitPermissionInstruction({
      payer: createNoopSigner(relayer),
      roomShard,
      playerStance: stancePda,
      permission: await permissionPda(stancePda),
      roomAuthority: createNoopSigner(relayer),
    }),
  );
}

/**
 * ER join after the L1 delegation lands: waits for the TEE to clone the stance, then
 * join_room_and_init_permission creates the private EphemeralPermission (members: player key + relayer).
 */
export async function joinOnEr(room: RoomSchedule, sessionPubkey: string, relayer: KeyPairSigner, roomShard: Address): Promise<ChainReceipt> {
  const stancePda = await stancePdaFor(roomShard, room.roomId, sessionPubkey);
  const deadline = Date.now() + 20_000;
  for (;;) {
    const [s, st] = await fetchErAccounts([roomShard, stancePda]);
    const stance = decodeStance(st ?? null);
    if (s?.owner === ER_ROOM_PROGRAM && stance) {
      if (stance.joinedEr) throw new BorelRuleError("Stance already joined on the ER");
      break;
    }
    if (Date.now() > deadline) throw new BorelRuleError("MagicBlock TEE has not cloned the delegated stance yet; the lock will retry the ER join");
    await new Promise((r) => setTimeout(r, 400));
  }
  const tx = await sendErTransaction(relayer, [await joinPermissionIx(relayer.address, roomShard, stancePda)]);
  return erReceipt("Private ER join: join_room_and_init_permission (Permission Program ACL, private until unseal)", tx.signature, tx.slot);
}

function submitStanceIx(
  relayer: Address,
  session: KeyPairSigner,
  roomShard: Address,
  stancePda: Address,
  weights: [number, number, number, number],
  code: number,
  secondary8: [bigint, bigint, bigint],
  stage1: bigint,
): Instruction {
  return plainInstruction(
    cartridgeErRoom.getSubmitStanceInstruction({
      sessionSigner: createNoopSigner(session.address),
      roomShard,
      playerStance: stancePda,
      oracleFeed: ER_SOL_USD_ORACLE,
      // The room authority attests the entry prices and the move timing (audit C1).
      roomAuthority: createNoopSigner(relayer),
      weightsBps: weights,
      kalshiBinaryCall: 0,
      kalshiProbBps: code,
      secondaryPrices8: secondary8,
      stage1ScoreScaled: stage1,
    }),
  );
}

export interface ErAction {
  label: string;
  instructions: Instruction[];
  extraSigners: KeyPairSigner[];
  stancePda: Address;
}

function requirePlayer(state: RoomStateSnapshot, sessionPubkey: string): PlayerState & { stancePda: Address; stance: PlayerStanceAccount } {
  const p = state.players.get(sessionPubkey);
  if (!p?.joined) throw new BorelRuleError("Join the room before locking a hand");
  if (!p.stancePda || !p.stance) throw new BorelRuleError("PlayerStance is not visible on the MagicBlock ER yet; retry in a moment");
  return p as PlayerState & { stancePda: Address; stance: PlayerStanceAccount };
}

/**
 * Seals a hand on the Private ER: submit_stance signed by the per-room stance session key (derived
 * server-side, released only for a valid ed25519 session signature). Entry prices for slots 1–3 are
 * server-set from fresh Pyth data (client prices ignored); slot 0 (SOL) is the in-program ER oracle.
 */
export async function buildLock(
  room: RoomSchedule,
  sessionPubkey: string,
  legs: readonly HandLeg[],
  commitment: string,
  saltHex: string | undefined,
  relayer: Address,
  state: RoomStateSnapshot,
  nowMs: number,
  /** Staked rooms only: whether this session's stake envelope exists (checked by the route). */
  stakeConfirmed = false,
): Promise<ErAction> {
  assertRoomUsable(state);
  if (nowMs >= room.lockAt - LOCK_SEND_MARGIN_MS) throw new BorelRuleError("Hand lock window has closed");
  const p = requirePlayer(state, sessionPubkey);
  if (room.staked && !p.stance.joinedEr && !stakeConfirmed) {
    throw new BorelRuleError("This is a staked room: stake test-USDC before sealing your hand");
  }
  if (p.stance.moveCount > 0) throw new BorelRuleError("Hand already sealed for this room");
  if (saltHex !== undefined) {
    const expected = await handCommitment([legs[0]!, legs[1]!, legs[2]!], saltHex);
    if (expected !== commitment) throw new BorelRuleError("Commitment does not match hand + salt");
  }
  const prices = await requireFreshPrices(legs.map((l) => l.market), nowMs);
  const layout = layoutForHand(legs);
  const session = await derivedSigner("session", room.roomId, sessionPubkey);
  const instructions: Instruction[] = [];
  if (!p.stance.joinedEr) instructions.push(await joinPermissionIx(relayer, state.roomShardPda, p.stancePda));
  instructions.push(submitStanceIx(relayer, session, state.roomShardPda, p.stancePda, weightsFor(legs, layout), layout.code, slotPrices8(layout, prices), 0n));
  return {
    label: "Hand sealed on the MagicBlock Private ER (TEE): submit_stance under a Permission Program ACL",
    instructions,
    extraSigners: [session],
    stancePda: p.stancePda,
  };
}

/** The single pivot: a second submit_stance (FLIP negates / SHIELD zeroes the leg); max_rebalances = 2 caps it on-chain. */
export async function buildPivot(
  room: RoomSchedule,
  sessionPubkey: string,
  legIndex: LegIndex,
  kind: PivotKind,
  state: RoomStateSnapshot,
  nowMs: number,
  relayer: Address,
): Promise<{ action: ErAction; pivot: PivotAction }> {
  assertRoomUsable(state);
  if (nowMs >= room.endsAt) throw new BorelRuleError("Pivots are only allowed while the room is live");
  if (nowMs < room.startsAt + PIVOT_START_MARGIN_MS) {
    throw new BorelRuleError(`Pivots open ${PIVOT_START_MARGIN_MS / 1000} s after the room goes live`);
  }
  const p = requirePlayer(state, sessionPubkey);
  if (!p.hand || !p.layout) throw new BorelRuleError("No sealed hand for this session");
  if (p.pivot || p.stance.moveCount >= MAX_REBALANCES) throw new BorelRuleError("Pivot already used — exactly one per player");
  const market = p.hand[legIndex].market;
  const prices = await requireFreshPrices([market], nowMs);
  const priceE9 = prices[market]!;
  const session = await derivedSigner("session", room.roomId, sessionPubkey);
  return {
    pivot: { legIndex, kind, priceE9, atMs: nowMs },
    action: {
      label: `Pivot on the MagicBlock Private ER: submit_stance ${kind} leg ${legIndex + 1} at the server-set Pyth price (max_rebalances = 2)`,
      instructions: [
        submitStanceIx(relayer, session, state.roomShardPda, p.stancePda, weightsFor(p.hand, p.layout, { legIndex, kind }), p.layout.code, [0n, 0n, 0n], priceE9),
      ],
      extraSigners: [session],
      stancePda: p.stancePda,
    },
  };
}

/** Reads a stance back from the TEE after a write and decodes the hand (entry prices as stored on-chain). */
export async function readStanceHand(stancePda: Address): Promise<{ hand: LockedHand; pivot?: PivotAction } | null> {
  const [acc] = await fetchErAccounts([stancePda]);
  const stance = decodeStance(acc ?? null);
  const decoded = stance ? decodeStanceHand(stance) : null;
  return decoded ? { hand: decoded.hand, ...(decoded.pivot ? { pivot: decoded.pivot } : {}) } : null;
}

// ---------------------------------------------------------------------------
// Settlement (idempotent state machine; anyone may trigger it after 00:00)
// ---------------------------------------------------------------------------

export interface SettlementResult {
  receipts: ChainReceipt[];
  /** Set when a step is still pending (e.g. VRF callback not yet observed); calling settle again resumes. */
  pending: string | null;
  /** Non-blocking condition, e.g. the RoomShard commit is held back by stances the relayer never admitted. */
  note: string | null;
}

async function erShard(roomShard: Address): Promise<RoomShardAccount | null> {
  const [acc] = await fetchErAccounts([roomShard]);
  return decodeShard(acc ?? null);
}

function evaluateIx(relayer: Address, roomShard: Address, stancePda: Address, permission: Address, exit8: [bigint, bigint, bigint]): Instruction {
  return plainInstruction(
    cartridgeErRoom.getEvaluatePlayerScoreInstruction({
      authority: createNoopSigner(relayer),
      roomShard,
      playerStance: stancePda,
      oracleFeed: ER_SOL_USD_ORACLE,
      permission,
      secondaryExitPrices8: exit8,
      betaBenchScaled: 0n,
      lambdaDdScaled: 0n,
      kalshiOutcomeYes: 2,
      maxMultiplierScaled: 1_000_000_000n,
    }),
  );
}

function slotExit8(layout: StanceLayout | undefined, prices: Partial<Record<BorelMarket, bigint>>): [bigint, bigint, bigint] {
  if (!layout) return [0n, 0n, 0n];
  return [1, 2, 3].map((slot) => {
    const m = layout.slotMarkets[slot];
    const p = m ? prices[m] : undefined;
    return p !== undefined ? p / 10n : 0n;
  }) as [bigint, bigint, bigint];
}

/**
 * Settles at 00:00 on-chain: settle memo (fresh server-set Pyth prices) → VRF → per stance
 * trigger_showdown_unseal + evaluate_player_score → undelegate_player_stance → settle_and_commit_shard.
 * Every step re-reads chain state first, so concurrent or repeated calls converge.
 */
export async function runSettlement(
  room: RoomSchedule,
  relayer: KeyPairSigner,
  initial: RoomStateSnapshot,
  nowMs: number,
  /** Staked rooms: true when the session holds a stake envelope (stakers who never locked are counted at settle). */
  isStaked: (sessionPubkey: string) => Promise<boolean> = async () => false,
): Promise<SettlementResult> {
  assertRoomUsable(initial);
  if (nowMs < room.endsAt) throw new BorelRuleError("Room has not reached 00:00");
  if (!initial.roomExists) throw new BorelRuleError("Room was never opened on-chain");
  const receipts: ChainReceipt[] = [];
  let state = initial;
  const relayerAddress = address(relayer.address);
  const shardPda = state.roomShardPda;

  // 1. Final prices: the first settle memo wins; every held market must have a fresh price (no silent zero).
  if (!state.settleMemo) {
    const held = [...state.players.values()].flatMap((p) => (p.hand ? p.hand.map((l) => l.market) : []));
    const { prices, source } = await pricesAtEndsAt(held, room, Date.now());
    const priceField = BOREL_MARKETS.map((m, i) => (prices[m] !== undefined ? `${i}=${prices[m]!.toString()}` : null))
      .filter((v): v is string => v !== null)
      .join(",");
    const body = `borel:v1:settle3:${Math.floor(room.endsAt / 1000)}:${source}:${priceField}`;
    const tx = await signSendAndConfirm(relayer, [computeUnitLimitIx(200_000), roomIndexIx(relayerAddress, shardPda), signedMemo(room.roomId, body)], []);
    receipts.push(
      receipt(`Settle: Pyth prices at 00:00 (${source === "h" ? "Hermes historical" : "latest quotes at 00:00"}) committed (HMAC memo)`, tx.signature, tx.slot),
    );
    state = await readRoomState(room, relayerAddress, relayer.address, Date.now());
    if (!state.settleMemo) throw new BorelRuleError("Settle memo landed outside the 00:00 pricing window; call settle again");
  }
  const finalPrices = state.settleMemo?.prices ?? {};
  if (!state.roomDelegated) return { receipts, pending: null, note: null };

  // 2. VRF seed (MagicBlock VRF oracle → callback_settlement_vrf on the ER).
  let shard = await erShard(shardPda);
  if (!shard) throw new BorelRuleError("RoomShard is not readable on the MagicBlock ER");
  if (shard.phase !== cartridgeErRoom.RoomPhase.SettledCommitted && !shard.vrfFulfilled) {
    const [identity] = await cartridgeErRoom.findProgramIdentityPda();
    const vrf = await sendErTransaction(relayer, [
      plainInstruction(
        cartridgeErRoom.getRequestSettlementVrfInstruction({
          authority: createNoopSigner(relayerAddress),
          roomShard: shardPda,
          oracleQueue: VRF_EPHEMERAL_QUEUE,
          programIdentity: identity,
          vrfProgram: VRF_PROGRAM_ID,
          clientSeed: room.cycleIndex % 256,
        }),
      ),
    ]);
    receipts.push(erReceipt("MagicBlock VRF: request_settlement_vrf (tie-break seed)", vrf.signature, vrf.slot));
    const deadline = Date.now() + 20_000;
    while (!shard?.vrfFulfilled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      shard = await erShard(shardPda);
    }
    if (!shard?.vrfFulfilled) return { receipts, note: null, pending: "Waiting for the MagicBlock VRF callback; call settle again" };
  }

  // 2b. Staked rooms: a staker who never locked is joined now (FogOfWar still open), so every envelope
  //     has a counted, evaluated stance and the vault can distribute.
  if (room.staked && shard && (shard.phase === cartridgeErRoom.RoomPhase.FogOfWar || shard.phase === cartridgeErRoom.RoomPhase.LobbyOpen)) {
    let joinedAny = false;
    for (const [session, p] of state.players) {
      if (!p.stancePda || !p.stance || p.stanceSource !== "er" || p.stance.joinedEr) continue;
      if (!(await isStaked(session))) continue;
      const tx = await sendErTransaction(relayer, [await joinPermissionIx(relayerAddress, shardPda, p.stancePda)]);
      receipts.push(erReceipt(`Staker ${p.stancePda.slice(0, 6)} counted at settle: join_room_and_init_permission`, tx.signature, tx.slot));
      joinedAny = true;
    }
    if (joinedAny) {
      state = await readRoomState(room, relayerAddress, relayer.address, Date.now());
      shard = await erShard(shardPda);
    }
  }

  // 3. Unseal + evaluate the relayer-admitted stances only (HMAC join memo → derived player key). Stances
  //    created by anyone else are ignored entirely: never evaluated, ranked or returned (AUDIT_LOG §5 C1).
  const targets: { pda: Address; stance: PlayerStanceAccount; layout?: StanceLayout }[] = [];
  for (const p of state.players.values()) {
    if (p.stancePda && p.stance && p.stanceSource === "er") targets.push({ pda: p.stancePda, stance: p.stance, layout: p.layout });
  }
  for (const t of targets) {
    if (!t.stance.joinedEr || t.stance.evaluated) continue;
    const permission = await permissionPda(t.pda);
    const exit8 = slotExit8(t.layout, finalPrices);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await erShard(shardPda);
      const ixs: Instruction[] = [];
      if (current && (current.phase === cartridgeErRoom.RoomPhase.FogOfWar || current.phase === cartridgeErRoom.RoomPhase.Showdown)) {
        ixs.push(
          plainInstruction(
            cartridgeErRoom.getTriggerShowdownUnsealInstruction({ authority: createNoopSigner(relayerAddress), roomShard: shardPda, playerStance: t.pda, permission }),
          ),
        );
      }
      ixs.push(evaluateIx(relayerAddress, shardPda, t.pda, permission, exit8));
      try {
        const tx = await sendErTransaction(relayer, ixs);
        const [after] = await fetchErAccounts([t.pda]);
        if (decodeStance(after ?? null)?.evaluated) {
          receipts.push(
            erReceipt(
              `Showdown ${t.pda.slice(0, 6)}: ${ixs.length > 1 ? "trigger_showdown_unseal + " : ""}evaluate_player_score (permission closed, stance public)`,
              tx.signature,
              tx.slot,
            ),
          );
          break;
        }
      } catch (err) {
        // ER clock can trail wall clock by ~1 s at 00:00 (SettlementBeforeRoomEnd); retry shortly.
        if (attempt === 2) throw err;
      }
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }

  // 4. Commit + undelegate each evaluated stance back to L1.
  const toUndelegate: Address[] = [];
  const latest = await fetchErAccounts(targets.map((t) => t.pda));
  const onL1 = await fetchL1Accounts(targets.map((t) => t.pda));
  targets.forEach((t, i) => {
    const s = decodeStance(latest[i] ?? null);
    if (s?.evaluated && onL1[i]?.owner === DELEGATION_PROGRAM_ID) toUndelegate.push(t.pda);
  });
  for (let i = 0; i < toUndelegate.length; i += 4) {
    const batch = await Promise.allSettled(
      toUndelegate.slice(i, i + 4).map((pda) =>
        sendErTransaction(relayer, [
          plainInstruction(cartridgeErRoom.getUndelegatePlayerStanceInstruction({ authority: createNoopSigner(relayerAddress), roomShard: shardPda, playerStance: pda })),
        ]).then((tx) => ({ pda, tx })),
      ),
    );
    for (const r of batch) {
      if (r.status === "fulfilled") receipts.push(erReceipt(`Commit ${r.value.pda.slice(0, 6)}: undelegate_player_stance (stance → Solana L1)`, r.value.tx.signature, r.value.tx.slot));
    }
  }

  // 5. Commit + undelegate the RoomShard (requires VRF, evaluated_count == player_count, fresh ER oracle).
  shard = await erShard(shardPda);
  if (shard && shard.phase !== cartridgeErRoom.RoomPhase.SettledCommitted) {
    if (shard.evaluatedCount !== shard.playerCount) {
      // Every admitted stance is evaluated, so the gap is stances the relayer never admitted. Borel's
      // result (hands, ranks, VRF seed) is final; only the RoomShard commit stays blocked on-chain.
      return {
        receipts,
        pending: null,
        note: `RoomShard commit held back: ${shard.playerCount - shard.evaluatedCount} stance(s) joined this room outside the relayer and are ignored`,
      };
    }
    const shardPermission = await permissionPda(shardPda);
    const raw = plainInstruction(
      cartridgeErRoom.getSettleAndCommitShardInstruction({
        authority: createNoopSigner(relayerAddress),
        roomShard: shardPda,
        oracleFeed: ER_SOL_USD_ORACLE,
        permission: shardPermission,
        scheduleVaultAction: false,
        vaultActionAccounts: [],
      }),
    );
    // The RoomShard has no EphemeralPermission: pass permission + vault read-only so the close CPI is skipped.
    const settleIx: Instruction = {
      ...raw,
      accounts: (raw.accounts ?? []).map((m) => (m.address === shardPermission || m.address === MAGIC_VAULT ? { ...m, role: AccountRole.READONLY } : m)),
    };
    const tx = await sendErTransaction(relayer, [settleIx]);
    // While the commit is in flight the TEE can briefly serve the shard under another owner: poll both layers.
    let committed = false;
    for (let i = 0; i < 8 && !committed; i += 1) {
      const [l1Acc] = await fetchL1Accounts([shardPda]);
      const view = decodeShard(l1Acc ?? null) ?? (await erShard(shardPda));
      committed = view?.phase === cartridgeErRoom.RoomPhase.SettledCommitted;
      if (!committed) {
        if (view?.phase === cartridgeErRoom.RoomPhase.RetryGrace) {
          return { receipts, note: null, pending: "settle_and_commit_shard deferred (ER oracle stale → RetryGrace); call settle again" };
        }
        await new Promise((r) => setTimeout(r, 750));
      }
    }
    if (!committed) return { receipts, note: null, pending: "RoomShard commit not observed yet; call settle again" };
    receipts.push(erReceipt("settle_and_commit_shard: RoomShard commit + undelegate → Solana L1 (MagicIntentBundleBuilder)", tx.signature, tx.slot));
  }
  return { receipts, pending: null, note: null };
}

/** True once the RoomShard is back on Solana L1 (owned by cartridge_er_room, not the Delegation Program). */
export async function roomShardOnL1(room: RoomSchedule, relayer: Address): Promise<boolean> {
  const plan = await roomChainPlan(room, relayer);
  const [acc] = await fetchL1Accounts([plan.roomShardPda]);
  return acc?.owner === ER_ROOM_PROGRAM;
}

export function sessionPubkeyIsValid(v: string): boolean {
  return SESSION_RE.test(v) && isAddress(v);
}
