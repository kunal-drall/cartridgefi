// Server-only: Borel room lifecycle on Solana Devnet, relayer-signed.
// Imported exclusively by app/api/borel/* route handlers. Never import from client code.
//
// Source of truth = on-chain data read over RPC (serverless instances share no memory):
//   * RoomShard PDA (cartridge_er_room.initialize_room_shard, relayer authority) per room. Its
//     event id is an HMAC of the room id under relayer key material, so the PDA cannot be predicted
//     or pre-created by third parties; authority and timestamps are still verified on read.
//   * PlayerStance PDA per player (cartridge_er_room.init_stance_and_delegate → MagicBlock delegation).
//   * Borel event memos (join / lock / pivot / settle / reveal) in transactions that touch the
//     RoomShard PDA, read back with paginated getSignaturesForAddress(roomShard). A memo counts only
//     if it carries a valid HMAC (relayer-held key, bound to the room id) and its blockTime satisfies
//     lock < lockAt ≤ pivot < endsAt ≤ settle.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  isAddress,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { cartridgeErRoom } from "@cartridgefi/codama-clients";
import { deriveCartridgeDeploymentPlan } from "@cartridgefi/sdk";
import { BOREL_GAMEDAY_MANIFEST, type CartridgeManifestV2 } from "@cartridgefi/shared-types";
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
  type LockedLeg,
  type PivotAction,
  type PivotKind,
  type RankRow,
  type RoomMode,
  type RoomPhase,
  type StakeMode,
} from "./types";
import { handCommitment, handScoreE9, rankByScore } from "./scoring";
import { fetchLatestPricesE9 } from "./pyth";
import {
  MAGICBLOCK_DEVNET_US_VALIDATOR,
  deriveRelayerKeyMaterial,
  getRelayerRpc,
  solscanTxUrl,
} from "../relayer/config";
import {
  computeUnitLimitIx,
  deserializeInstruction,
  fetchAccountsData,
  memoIx,
  systemTransferIx,
} from "../relayer/actions";

// ---------------------------------------------------------------------------
// Room schedule (deterministic from wall clock — no server memory needed)
// ---------------------------------------------------------------------------

export const LOBBY_MS: Record<RoomMode, number> = { BLITZ_3M: 45_000, MACRO_15M: 60_000 };
export const SHOWDOWN_WINDOW_MS = 15_000;
const MAX_LOCK_JITTER_MS = 5_000;
/** Server refuses to send a lock this close to lockAt (landing latency margin). */
const LOCK_SEND_MARGIN_MS = 2_000;
/** blockTime has 1 s resolution and txs land ~1–2 s after send: tolerance on upper time bounds. */
const BLOCKTIME_TOLERANCE_MS = 2_000;
/** Prices older than this are refused for entry, pivot and settle. */
export const MAX_PRICE_AGE_MS = 60_000;
const MAX_SIGNATURE_PAGES = 5;
const ROOM_ID_RE = /^(BLITZ_3M|MACRO_15M)-(PAPER|DEVNET)-(\d{1,10})$/;
/** Lamports forwarded to a derived player key to pay PlayerStance + delegation rent; leftovers are swept back. */
export const PLAYER_FUNDING_LAMPORTS = 20_000_000n;
/** Per-room seat cap: bounds relayer rent spend per room. */
export const MAX_PLAYERS_PER_ROOM = 24;

export interface RoomSchedule {
  roomId: string;
  mode: RoomMode;
  stake: StakeMode;
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

export function scheduleFor(mode: RoomMode, stake: StakeMode, cycleIndex: number): RoomSchedule {
  const c = cycleMs(mode);
  const openAt = cycleIndex * c;
  const startsAt = openAt + LOBBY_MS[mode];
  const roomId = `${mode}-${stake}-${cycleIndex}`;
  return {
    roomId,
    mode,
    stake,
    cycleIndex,
    openAt,
    startsAt,
    lockAt: startsAt - lockJitterMs(roomId),
    endsAt: startsAt + ROOM_DURATION_MS[mode],
  };
}

/** The room a new player joins now: the current cycle while its lobby is open, else the next one. */
export function joinableRoom(mode: RoomMode, stake: StakeMode, nowMs: number): RoomSchedule {
  const c = cycleMs(mode);
  const k = Math.floor(nowMs / c);
  const current = scheduleFor(mode, stake, k);
  // Leave at least 10 s to seal a hand; otherwise seat the player in the next room.
  return nowMs < current.lockAt - 10_000 ? current : scheduleFor(mode, stake, k + 1);
}

export function parseRoomId(roomId: string): RoomSchedule | null {
  const m = ROOM_ID_RE.exec(roomId);
  if (!m) return null;
  const k = Number(m[3]);
  if (!Number.isSafeInteger(k)) return null;
  return scheduleFor(m[1] as RoomMode, m[2] as StakeMode, k);
}

// ---------------------------------------------------------------------------
// On-chain room accounts
// ---------------------------------------------------------------------------

function arenaManifest(mode: RoomMode, stake: StakeMode, relayer: Address): CartridgeManifestV2 {
  const base = BOREL_GAMEDAY_MANIFEST;
  return {
    ...base,
    metadata: {
      ...base.metadata,
      slug: `borel-${mode === "BLITZ_3M" ? "blitz-3m" : "macro-15m"}-${stake.toLowerCase()}-v1`,
      creatorWallet: relayer,
    },
    magicblockRoomConfig: {
      ...base.magicblockRoomConfig,
      durationSecs: ROOM_DURATION_MS[mode] / 1000,
    },
  };
}

export interface RoomChainPlan {
  roomShardPda: Address;
  manifestPda: Address;
  registerIx: Instruction;
  initRoomIx: Instruction;
}

/** Unpredictable 32-byte event id: HMAC(relayer key material, full room id incl. full cycle index). */
function roomEventId(roomId: string): Uint8Array {
  return deriveRelayerKeyMaterial(`borel:event:v1:${roomId}`);
}

export async function roomChainPlan(room: RoomSchedule, relayer: Address): Promise<RoomChainPlan> {
  const plan = await deriveCartridgeDeploymentPlan(arenaManifest(room.mode, room.stake, relayer), {
    shardIndex: 0,
    authorityAddress: relayer,
    roomPoolUsdcAtomic: 0n,
    network: "devnet",
  });
  const manifestPda = address(plan.cartridgeManifestPda);
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
  return {
    roomShardPda,
    manifestPda,
    registerIx: deserializeInstruction(plan.registerCartridgeInstruction),
    initRoomIx: { programAddress: initRoomIx.programAddress, accounts: initRoomIx.accounts.map((a) => ({ address: a.address, role: a.role })), data: initRoomIx.data },
  };
}

/** Deterministic per-(room, session) keypair; re-derivable on any instance from the relayer secret. */
async function derivedSigner(kind: "player" | "session", roomId: string, sessionPubkey: string): Promise<KeyPairSigner> {
  const seed = deriveRelayerKeyMaterial(`borel:${kind}:v1:${roomId}:${sessionPubkey}`);
  return createKeyPairSignerFromPrivateKeyBytes(seed);
}

// ---------------------------------------------------------------------------
// Hand sealing (AES-256-GCM, server-held key) + compact encodings
// ---------------------------------------------------------------------------

const MARKET_INDEX = new Map<BorelMarket, number>(BOREL_MARKETS.map((m, i) => [m, i]));

function encodeHand(hand: LockedHand, saltHex: string): string {
  const legs = hand.map(
    (leg) => `${MARKET_INDEX.get(leg.market)}${leg.direction === "LONG" ? "L" : "S"}${leg.conviction}~${leg.entryPriceE9.toString()}`,
  );
  return `${legs.join(",")}#${saltHex}`;
}

function decodeHand(encoded: string): { hand: LockedHand; saltHex: string } | null {
  const [legsPart, saltHex = ""] = encoded.split("#");
  const legs = (legsPart ?? "").split(",");
  if (legs.length !== 3) return null;
  const parsed: LockedLeg[] = [];
  for (const leg of legs) {
    const m = /^([0-4])([LS])([123])~(\d{1,30})$/.exec(leg);
    if (!m) return null;
    parsed.push({
      market: BOREL_MARKETS[Number(m[1])] as BorelMarket,
      direction: (m[2] === "L" ? "LONG" : "SHORT") as Direction,
      conviction: Number(m[3]) as Conviction,
      entryPriceE9: BigInt(m[4] as string),
    });
  }
  return { hand: parsed as unknown as LockedHand, saltHex };
}

function sealKey(roomId: string): Buffer {
  return Buffer.from(deriveRelayerKeyMaterial(`borel:seal:v1:${roomId}`));
}

function sealHand(roomId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(roomId), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${iv.toString("base64")}.${ct.toString("base64")}`;
}

function unsealHand(roomId: string, sealed: string): string | null {
  try {
    const [ivB64, ctB64] = sealed.split(".");
    if (!ivB64 || !ctB64) return null;
    const iv = Buffer.from(ivB64, "base64");
    const all = Buffer.from(ctB64, "base64");
    const tag = all.subarray(all.length - 16);
    const ct = all.subarray(0, all.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", sealKey(roomId), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
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

// ---------------------------------------------------------------------------
// Authenticated event memos
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

interface JoinEvent { kind: "join"; session: string; signature: string; slot: number; atMs: number }
interface LockEvent { kind: "lock"; session: string; commitment: string; sealed: string; signature: string; slot: number; atMs: number }
interface PivotEvent { kind: "pivot"; session: string; pivot: PivotAction; signature: string; slot: number; atMs: number }
interface SettleEvent { kind: "settle"; seedHex: string; prices: Partial<Record<BorelMarket, bigint>>; signature: string; slot: number; atMs: number }
interface RevealEvent { kind: "reveal"; session: string; encoded: string; signature: string; slot: number; atMs: number }
type RoomEvent = JoinEvent | LockEvent | PivotEvent | SettleEvent | RevealEvent;

const SESSION_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function parseMemoEntries(memoField: string): string[] {
  // RPC format: "[len] text; [len] text"
  return memoField
    .split("; ")
    .map((part) => part.replace(/^\[\d+\]\s*/, "").trim())
    .filter((t) => t.startsWith("borel:v1:"));
}

function parseEvent(body: string, signature: string, slot: number, atMs: number): RoomEvent | null {
  const parts = body.split(":");
  const kind = parts[2];
  const base = { signature, slot, atMs };
  if (kind === "join" && parts[3] && SESSION_RE.test(parts[3])) {
    return { kind: "join", session: parts[3], ...base };
  }
  if (kind === "lock" && parts[3] && SESSION_RE.test(parts[3]) && parts[4] && parts[5]) {
    return { kind: "lock", session: parts[3], commitment: parts[4], sealed: parts[5], ...base };
  }
  if (kind === "pivot" && parts[3] && SESSION_RE.test(parts[3])) {
    const legIndex = Number(parts[4]);
    const pivotKind = parts[5];
    if ((legIndex === 0 || legIndex === 1 || legIndex === 2) && (pivotKind === "FLIP" || pivotKind === "SHIELD") && /^\d{1,30}$/.test(parts[6] ?? "") && /^\d{1,15}$/.test(parts[7] ?? "")) {
      return {
        kind: "pivot",
        session: parts[3],
        pivot: { legIndex: legIndex as LegIndex, kind: pivotKind as PivotKind, priceE9: BigInt(parts[6] as string), atMs: Number(parts[7]) },
        ...base,
      };
    }
  }
  if (kind === "settle" && /^[0-9a-f]{64}$/.test(parts[3] ?? "")) {
    const prices: Partial<Record<BorelMarket, bigint>> = {};
    for (const entry of (parts[4] ?? "").split(",")) {
      const [idx, value] = entry.split("=");
      const market = BOREL_MARKETS[Number(idx)];
      if (market && value && /^\d{1,30}$/.test(value)) prices[market] = BigInt(value);
    }
    return { kind: "settle", seedHex: parts[3] as string, prices, ...base };
  }
  if (kind === "reveal" && parts[3] && SESSION_RE.test(parts[3]) && parts[4]) {
    return { kind: "reveal", session: parts[3], encoded: parts.slice(4).join(":"), ...base };
  }
  return null;
}

/** Enforces lock < lockAt ≤ pivot < endsAt ≤ settle on the transaction's blockTime. */
function inWindow(ev: RoomEvent, room: RoomSchedule): boolean {
  const t = ev.atMs;
  switch (ev.kind) {
    case "join":
    case "lock":
      return t < room.lockAt + BLOCKTIME_TOLERANCE_MS;
    case "pivot":
      return t >= room.lockAt - 1_000 && t < room.endsAt + BLOCKTIME_TOLERANCE_MS;
    case "settle":
    case "reveal":
      return t >= room.endsAt - 1_000;
  }
}

/** signature → fee payer, cached per instance (confirmed transactions are immutable). */
const feePayerCache = new Map<string, string | null>();
const FEE_PAYER_CACHE_MAX = 20_000;

async function feePayerOf(signature: string): Promise<string | null> {
  const cached = feePayerCache.get(signature);
  if (cached !== undefined) return cached;
  try {
    const tx = await getRelayerRpc()
      .getTransaction(signature as Signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" })
      .send();
    const payer = tx ? String(tx.transaction.message.accountKeys[0] ?? "") || null : null;
    if (tx) {
      if (feePayerCache.size >= FEE_PAYER_CACHE_MAX) feePayerCache.clear();
      feePayerCache.set(signature, payer);
    }
    return payer;
  } catch {
    return null;
  }
}

async function readRoomEvents(room: RoomSchedule, roomShard: Address, relayerPubkey: string): Promise<RoomEvent[]> {
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
  const candidates: { signature: string; events: RoomEvent[] }[] = [];
  // RPC returns newest first; replay oldest first so "first wins" rules are deterministic.
  for (const s of all.reverse()) {
    if (s.failed || !s.memo || s.blockTime === null) continue;
    const evs: RoomEvent[] = [];
    for (const text of parseMemoEntries(s.memo)) {
      const body = verifiedBody(room.roomId, text);
      if (!body) continue;
      const ev = parseEvent(body, s.signature, s.slot, s.blockTime * 1000);
      if (ev && inWindow(ev, room)) evs.push(ev);
    }
    if (evs.length > 0) candidates.push({ signature: s.signature, events: evs });
  }
  const payers: (string | null)[] = [];
  for (let i = 0; i < candidates.length; i += 8) {
    payers.push(...(await Promise.all(candidates.slice(i, i + 8).map((c) => feePayerOf(c.signature)))));
  }
  return candidates.flatMap((c, i) => (payers[i] === relayerPubkey ? c.events : []));
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface PlayerState {
  joined: boolean;
  lock?: LockEvent;
  pivot?: PivotEvent;
}

export interface RoomStateSnapshot {
  schedule: RoomSchedule;
  phase: RoomPhase;
  vrfSeed: string;
  seedSource: string | null;
  roomShardPda: Address;
  roomExists: boolean;
  /** Set when an account exists at our PDA but is not a relayer-authored room for this schedule. */
  roomInvalid: string | null;
  receipts: ChainReceipt[];
  rows: RankRow[];
  players: Map<string, PlayerState>;
  settled: SettleEvent | null;
}

function receipt(label: string, signature: string, slot?: number): ChainReceipt {
  return { label, signature, cluster: "devnet", explorerUrl: solscanTxUrl(signature), slot };
}

function verifyRoomAccount(data: Uint8Array, room: RoomSchedule, relayerPubkey: string): string | null {
  try {
    const shard = cartridgeErRoom.getRoomShardDecoder().decode(data);
    if (shard.authority !== relayerPubkey) return "RoomShard authority is not the relayer";
    if (shard.startTs !== BigInt(Math.floor(room.startsAt / 1000)) || shard.endTs !== BigInt(Math.floor(room.endsAt / 1000))) {
      return "RoomShard timestamps do not match the room schedule";
    }
    return null;
  } catch {
    return "RoomShard account could not be decoded";
  }
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
  const [roomData] = await fetchAccountsData([plan.roomShardPda]);
  const roomInvalid = roomData ? verifyRoomAccount(roomData, room, relayerPubkey) : null;
  const events = roomData && !roomInvalid ? await readRoomEvents(room, plan.roomShardPda, relayerPubkey) : [];

  const players = new Map<string, PlayerState>();
  const receipts: ChainReceipt[] = [];
  let settled: SettleEvent | null = null;
  const reveals = new Map<string, RevealEvent>();

  for (const ev of events) {
    if (ev.kind === "settle") {
      if (!settled) {
        settled = ev;
        receipts.push(receipt("Room settled: final Pyth prices + tie-break seed committed", ev.signature, ev.slot));
      }
      continue;
    }
    if (ev.kind === "reveal") {
      if (settled && !reveals.has(ev.session)) reveals.set(ev.session, ev);
      continue;
    }
    const p = players.get(ev.session) ?? { joined: false };
    const tag = publicId(ev.session).slice(0, 6);
    if (ev.kind === "join" && !p.joined) {
      p.joined = true;
      receipts.push(receipt(`Join ${tag}: PlayerStance init + MagicBlock delegation`, ev.signature, ev.slot));
    } else if (ev.kind === "lock" && p.joined && !p.lock) {
      p.lock = ev;
      receipts.push(receipt(`Hand sealed ${tag}: sha256 commitment`, ev.signature, ev.slot));
    } else if (ev.kind === "pivot" && p.lock && !p.pivot) {
      p.pivot = ev;
      receipts.push(receipt(`Pivot ${tag}: ${ev.pivot.kind}`, ev.signature, ev.slot));
    }
    players.set(ev.session, p);
  }
  for (const r of reveals.values()) {
    receipts.push(receipt(`Hand revealed ${publicId(r.session).slice(0, 6)}`, r.signature, r.slot));
  }

  const phase: RoomPhase = settled
    ? "SETTLED"
    : nowMs < room.lockAt
      ? "LOBBY"
      : nowMs < room.endsAt - SHOWDOWN_WINDOW_MS
        ? "SEALED"
        : "SHOWDOWN";

  const pricesE9 = settled ? settled.prices : (await latestPrices()).prices;
  const seed = settled?.seedHex ?? "";

  const scored: Array<{ id: string; session: string; scoreE9: bigint; hand: LockedHand; pivot?: PivotAction }> = [];
  for (const [session, p] of players) {
    if (!p.lock) continue;
    const plain = unsealHand(room.roomId, p.lock.sealed);
    const decoded = plain ? decodeHand(plain) : null;
    if (!decoded) continue;
    scored.push({
      id: publicId(session),
      session,
      scoreE9: handScoreE9(decoded.hand, pricesE9, p.pivot?.pivot),
      hand: decoded.hand,
      pivot: p.pivot?.pivot,
    });
  }
  const baseRank = new Map(rankByScore(scored.map((s) => ({ id: s.id, scoreE9: 0n })), "").map((r) => [r.id, r.rank]));
  const ranked = rankByScore(scored, seed);
  const rows: RankRow[] = ranked.map((r) => {
    const isYou = viewerSession !== undefined && r.session === viewerSession;
    const revealScore = settled !== null || isYou;
    return {
      id: r.id,
      label: isYou ? "You" : `Player ${r.id.slice(0, 6)}`,
      kind: "PLAYER",
      rank: r.rank,
      rankDelta: (baseRank.get(r.id) ?? r.rank) - r.rank,
      pivotUsed: r.pivot !== undefined,
      ...(isYou ? { isYou: true } : {}),
      ...(revealScore ? { scoreE9: r.scoreE9 } : {}),
      ...(settled ? { hand: r.hand, ...(r.pivot ? { pivot: r.pivot } : {}) } : {}),
    };
  });

  return {
    schedule: room,
    phase,
    vrfSeed: seed,
    seedSource: settled ? `sha256(Devnet blockhash ‖ RoomShard) committed in ${settled.signature}` : null,
    roomShardPda: plan.roomShardPda,
    roomExists: roomData !== null,
    roomInvalid,
    receipts,
    rows,
    players,
    settled,
  };
}

// ---------------------------------------------------------------------------
// Transaction builders (all fee-paid by the relayer)
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

export async function buildJoin(room: RoomSchedule, sessionPubkey: string, relayer: Address, state: RoomStateSnapshot): Promise<BuiltBorelTx> {
  assertRoomUsable(state);
  if (state.phase !== "LOBBY") throw new BorelRuleError("Room lobby is closed");
  if (state.players.get(sessionPubkey)?.joined) throw new BorelRuleError("Session already joined this room");
  const seated = [...state.players.values()].filter((p) => p.joined).length;
  if (seated >= MAX_PLAYERS_PER_ROOM) throw new BorelRuleError(`Room is full (${MAX_PLAYERS_PER_ROOM} seats)`);

  const plan = await roomChainPlan(room, relayer);
  const [manifestData] = await fetchAccountsData([plan.manifestPda]);
  const instructions: Instruction[] = [computeUnitLimitIx(600_000)];
  if (!manifestData) instructions.push(plan.registerIx);
  if (!state.roomExists) instructions.push(plan.initRoomIx);

  const player = await derivedSigner("player", room.roomId, sessionPubkey);
  const session = await derivedSigner("session", room.roomId, sessionPubkey);
  instructions.push(systemTransferIx(relayer, player.address, PLAYER_FUNDING_LAMPORTS));
  instructions.push(
    await cartridgeErRoom.getInitStanceAndDelegateInstructionAsync({
      player,
      roomShard: plan.roomShardPda,
      validator: address(MAGICBLOCK_DEVNET_US_VALIDATOR),
      ephemeralSessionKey: session.address,
      sessionExpiryTs: BigInt(Math.floor(room.endsAt / 1000)),
    }),
  );
  instructions.push(signedMemo(room.roomId, `borel:v1:join:${sessionPubkey}:${room.stake}`));
  return {
    label: state.roomExists
      ? "Join: PlayerStance PDA initialized & delegated to MagicBlock ER (cartridge_er_room.init_stance_and_delegate)"
      : "Room opened (cartridge_er_room.initialize_room_shard) + PlayerStance initialized & delegated to MagicBlock ER",
    instructions,
    extraSigners: [player],
    sweepSigners: [player],
  };
}

/**
 * Seals a hand. Entry prices are set server-side from fresh Pyth data (client prices are ignored);
 * the lock is refused if any leg's feed is missing or older than MAX_PRICE_AGE_MS.
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
  requireJoined = true,
): Promise<{ tx: BuiltBorelTx; hand: LockedHand }> {
  assertRoomUsable(state);
  if (nowMs >= room.lockAt - LOCK_SEND_MARGIN_MS) throw new BorelRuleError("Hand lock window has closed");
  const p = state.players.get(sessionPubkey);
  // requireJoined=false only for unfunded dry-runs, where the join tx was simulated, not landed.
  if (requireJoined && !p?.joined) throw new BorelRuleError("Join the room before locking a hand");
  if (p?.lock) throw new BorelRuleError("Hand already sealed for this room");
  if (saltHex !== undefined) {
    const expected = await handCommitment([legs[0]!, legs[1]!, legs[2]!], saltHex);
    if (expected !== commitment) throw new BorelRuleError("Commitment does not match hand + salt");
  }
  const prices = await requireFreshPrices(legs.map((l) => l.market), nowMs);
  const hand = legs.map((leg) => ({
    market: leg.market,
    direction: leg.direction,
    conviction: leg.conviction,
    entryPriceE9: prices[leg.market]!,
  })) as unknown as LockedHand;
  const sealed = sealHand(room.roomId, encodeHand(hand, saltHex ?? ""));
  return {
    hand,
    tx: {
      label: "Hand sealed: sha256 commitment + AES-256-GCM sealed hand in memo (server-held key)",
      instructions: [
        computeUnitLimitIx(800_000),
        roomIndexIx(relayer, state.roomShardPda),
        signedMemo(room.roomId, `borel:v1:lock:${sessionPubkey}:${commitment}:${sealed}`),
      ],
      extraSigners: [],
      sweepSigners: [],
    },
  };
}

export async function buildPivot(
  room: RoomSchedule,
  sessionPubkey: string,
  legIndex: LegIndex,
  kind: PivotKind,
  relayer: Address,
  state: RoomStateSnapshot,
  nowMs: number,
): Promise<{ tx: BuiltBorelTx; pivot: PivotAction }> {
  assertRoomUsable(state);
  if (nowMs < room.lockAt || nowMs >= room.endsAt) throw new BorelRuleError("Pivots are only allowed while the room is live");
  const p = state.players.get(sessionPubkey);
  if (!p?.lock) throw new BorelRuleError("No sealed hand for this session");
  if (p.pivot) throw new BorelRuleError("Pivot already used — exactly one per player");
  const plain = unsealHand(room.roomId, p.lock.sealed);
  const decoded = plain ? decodeHand(plain) : null;
  if (!decoded) throw new BorelRuleError("Sealed hand unreadable");
  const market = decoded.hand[legIndex].market;
  const prices = await requireFreshPrices([market], nowMs);
  const priceE9 = prices[market]!;
  const pivot: PivotAction = { legIndex, kind, priceE9, atMs: nowMs };
  return {
    pivot,
    tx: {
      label: `Pivot: ${kind} leg ${legIndex + 1} at Pyth price (single pivot enforced by relayer)`,
      instructions: [
        computeUnitLimitIx(400_000),
        roomIndexIx(relayer, state.roomShardPda),
        signedMemo(room.roomId, `borel:v1:pivot:${sessionPubkey}:${legIndex}:${kind}:${priceE9.toString()}:${nowMs}`),
      ],
      extraSigners: [],
      sweepSigners: [],
    },
  };
}

/**
 * Settles at 00:00. Every market held in a sealed hand must have a fresh price (no silent zero).
 * Prices are the latest Pyth publish at settle time; settle is accepted only after endsAt.
 */
export async function buildSettle(room: RoomSchedule, relayer: Address, state: RoomStateSnapshot, nowMs: number): Promise<BuiltBorelTx[]> {
  assertRoomUsable(state);
  if (nowMs < room.endsAt) throw new BorelRuleError("Room has not reached 00:00");
  if (state.settled) throw new BorelRuleError("Room already settled");
  if (!state.roomExists) throw new BorelRuleError("Room was never opened on-chain");

  const plains: { session: string; plain: string; hand: LockedHand }[] = [];
  for (const [session, p] of state.players) {
    if (!p.lock) continue;
    const plain = unsealHand(room.roomId, p.lock.sealed);
    const decoded = plain ? decodeHand(plain) : null;
    if (plain && decoded) plains.push({ session, plain, hand: decoded.hand });
  }
  const heldMarkets = plains.flatMap((x) => x.hand.map((leg) => leg.market));
  const prices = await requireFreshPrices(heldMarkets, nowMs);

  const { value: bh } = await getRelayerRpc().getLatestBlockhash({ commitment: "finalized" }).send();
  const seedHex = createHash("sha256").update(`${bh.blockhash}:${state.roomShardPda}`).digest("hex");
  const priceField = BOREL_MARKETS.map((m, i) => (prices[m] !== undefined ? `${i}=${prices[m]!.toString()}` : null))
    .filter((v): v is string => v !== null)
    .join(",");

  const txs: BuiltBorelTx[] = [
    {
      label: "Settle: final Pyth prices + tie-break seed sha256(blockhash ‖ RoomShard) committed",
      instructions: [
        computeUnitLimitIx(600_000),
        roomIndexIx(relayer, state.roomShardPda),
        signedMemo(room.roomId, `borel:v1:settle:${seedHex}:${priceField}`),
      ],
      extraSigners: [],
      sweepSigners: [],
    },
  ];

  // Public reveal of every sealed hand (+ salt, when supplied at lock) so commitments are verifiable.
  for (let i = 0; i < plains.length; i += 2) {
    txs.push({
      label: "Unseal: hands revealed on-chain",
      instructions: [
        computeUnitLimitIx(1_000_000),
        roomIndexIx(relayer, state.roomShardPda),
        ...plains.slice(i, i + 2).map((x) => signedMemo(room.roomId, `borel:v1:reveal:${x.session}:${x.plain}`)),
      ],
      extraSigners: [],
      sweepSigners: [],
    });
  }
  return txs;
}

export function sessionPubkeyIsValid(v: string): boolean {
  return SESSION_RE.test(v) && isAddress(v);
}
