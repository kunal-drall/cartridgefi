import "server-only";
import type { Address, Instruction } from "@solana/kit";
import { SYSTEM_PROGRAM_ID } from "./config";

/**
 * Relayer spend guard (audit H4). Every relayer-paid transaction passes `reserveRelayerSpend` in
 * `signSendAndConfirm` before it is signed, so no route can spend relayer SOL around it.
 *
 *  1. Daily lamport budget (UTC day). Each transaction is charged a conservative estimate before it
 *     is sent: 5,000 lamports per signature + every System transfer/CreateAccount debiting the relayer
 *     + a rent allowance for each program instruction that names the relayer as a writable signer
 *     (CPI rent: ATA, RoomShard, manifest). Funding transactions are then reconciled to the real
 *     fee-payer balance delta once confirmed. Lamports transferred back to the relayer (ephemeral-key
 *     sweeps) are credited, so the ledger tracks net spend.
 *  2. Per-room join cap. Each `init_stance_and_delegate` instruction (one relayer-funded seat) is
 *     counted against its RoomShard; the cap is reserved before sending, so concurrent joins on one
 *     instance cannot race past the on-chain seat count.
 *  3. Completion reserve. Fee-only transactions (lock, pivot, settle, unseal: signatures only, no
 *     lamport outflow) may use `COMPLETION_RESERVE_LAMPORTS` beyond the budget so rooms already in
 *     progress can settle; refunds (sweeps) are always allowed.
 *
 * Scope: IN-MEMORY, PER SERVERLESS INSTANCE, like the rate limiter. The on-chain balance floor
 * (`RELAYER_BALANCE_FLOOR_LAMPORTS`) remains the global backstop; a fleet-wide budget needs a
 * shared store (Vercel KV / Upstash).
 */

function envLamports(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d{1,20}$/.test(raw)) return fallback;
  return BigInt(raw);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d{1,6}$/.test(raw)) return fallback;
  return Number(raw);
}

/** Net lamports one instance may spend per UTC day (default 1 SOL). */
export const DAILY_BUDGET_LAMPORTS = envLamports("CARTRIDGEFI_RELAYER_DAILY_BUDGET_LAMPORTS", 1_000_000_000n);
/** Headroom above the budget for fee-only transactions that finish rooms already in progress (0.05 SOL). */
export const COMPLETION_RESERVE_LAMPORTS = envLamports("CARTRIDGEFI_RELAYER_COMPLETION_RESERVE_LAMPORTS", 50_000_000n);
/** Relayer-funded seats per RoomShard (matches the 24-seat room cap). */
export const MAX_JOINS_PER_ROOM = envInt("CARTRIDGEFI_RELAYER_MAX_JOINS_PER_ROOM", 24);

const LAMPORTS_PER_SIGNATURE = 5_000n;
/**
 * Pre-send allowance for CPI rent the relayer may pay in one program instruction (≈ a 1.2 KB account).
 * Funding transactions are reconciled to the actual fee-payer balance delta after confirmation.
 */
const RENT_ALLOWANCE_PER_PAYER_IX = 10_000_000n;
/** Anchor discriminator of cartridge_er_room.init_stance_and_delegate (accounts[1] = room_shard). */
const INIT_STANCE_AND_DELEGATE_DISCRIMINATOR = [116, 163, 238, 141, 193, 254, 49, 199] as const;
const MAX_TRACKED_ROOMS = 2_000;

export class RelayerBudgetError extends Error {
  constructor(
    message: string,
    readonly reason: "daily_budget" | "room_join_cap",
  ) {
    super(`Relayer budget reached: ${message}`);
    this.name = "RelayerBudgetError";
  }
}

export type SpendClass = "refund" | "fee-only" | "funding";

export interface SpendEstimate {
  /** Net lamports charged to the relayer (negative for sweeps that return more than the fee). */
  netLamports: bigint;
  feeLamports: bigint;
  outflowLamports: bigint;
  inflowLamports: bigint;
  rentAllowanceLamports: bigint;
  spendClass: SpendClass;
  /** RoomShard address of every relayer-funded seat in the transaction. */
  joinRooms: string[];
}

function u32le(data: Uint8Array, offset: number): number | null {
  if (data.length < offset + 4) return null;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function u64le(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

const isSignerRole = (role: number): boolean => role === 2 || role === 3;
const isWritableSignerRole = (role: number): boolean => role === 3;

function isInitStanceAndDelegate(data: Uint8Array | undefined): boolean {
  if (!data || data.length < 8) return false;
  return INIT_STANCE_AND_DELEGATE_DISCRIMINATOR.every((b, i) => data[i] === b);
}

/** Conservative pre-send cost estimate of one relayer-paid transaction. */
export function estimateRelayerSpend(feePayer: Address, instructions: readonly Instruction[]): SpendEstimate {
  const signers = new Set<string>([feePayer]);
  let outflow = 0n;
  let inflow = 0n;
  let rent = 0n;
  const joinRooms: string[] = [];

  for (const ix of instructions) {
    const accounts = ix.accounts ?? [];
    for (const meta of accounts) if (isSignerRole(meta.role)) signers.add(meta.address);
    const data = ix.data ? new Uint8Array(ix.data) : undefined;

    if (ix.programAddress === SYSTEM_PROGRAM_ID && data) {
      const tag = u32le(data, 0);
      const from = accounts[0]?.address;
      const to = accounts[1]?.address;
      // 0 = CreateAccount { lamports, space, owner }, 2 = Transfer { lamports }.
      const lamports = tag === 0 || tag === 2 ? (u64le(data, 4) ?? 0n) : 0n;
      if (from === feePayer) outflow += lamports;
      else if (to === feePayer && tag === 2) inflow += lamports;
      continue;
    }

    if (isInitStanceAndDelegate(data)) {
      const roomShard = accounts[1]?.address;
      if (roomShard) joinRooms.push(roomShard);
    }
    if (accounts.some((m) => m.address === feePayer && isWritableSignerRole(m.role))) {
      rent += RENT_ALLOWANCE_PER_PAYER_IX;
    }
  }

  const fee = LAMPORTS_PER_SIGNATURE * BigInt(signers.size);
  const net = fee + outflow + rent - inflow;
  const spendClass: SpendClass =
    inflow > 0n && outflow === 0n && rent === 0n ? "refund" : outflow === 0n && rent === 0n ? "fee-only" : "funding";
  return {
    netLamports: net,
    feeLamports: fee,
    outflowLamports: outflow,
    inflowLamports: inflow,
    rentAllowanceLamports: rent,
    spendClass,
    joinRooms,
  };
}

/* --------------------------------- ledger --------------------------------- */

interface Ledger {
  day: string;
  spentLamports: bigint;
  joinsByRoom: Map<string, number>;
}
// Pinned to globalThis: join, lock, settle, stake, claim and faucet routes share ONE ledger per process even
// when the bundler (or dev HMR) evaluates this module more than once.
const LEDGER_KEY = Symbol.for("cartridgefi.relayer.spend-guard.v1");
const ledger: Ledger = ((globalThis as Record<symbol, unknown>)[LEDGER_KEY] as Ledger | undefined) ??
  ((globalThis as Record<symbol, unknown>)[LEDGER_KEY] = { day: "", spentLamports: 0n, joinsByRoom: new Map() } satisfies Ledger) as Ledger;
const joinsByRoom = ledger.joinsByRoom;

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function rollDay(now: number): void {
  const day = utcDay(now);
  if (day === ledger.day) return;
  ledger.day = day;
  ledger.spentLamports = 0n;
}

function secondsToUtcMidnight(now: number): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

function sol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, "0").slice(0, 3);
  return `${whole.toString()}.${frac}`;
}

export interface SpendReservation {
  readonly estimate: SpendEstimate;
  /** Undo the reservation (call only when the transaction was never broadcast). */
  release(): void;
  /** Replace the estimate with the confirmed fee-payer balance delta (pre − post lamports). */
  reconcile(actualNetLamports: bigint): void;
}

/**
 * Charges a transaction against the daily budget and per-room join cap, or throws
 * `RelayerBudgetError` without reserving anything.
 */
export function reserveRelayerSpend(
  feePayer: Address,
  instructions: readonly Instruction[],
  now: number = Date.now(),
): SpendReservation {
  rollDay(now);
  const estimate = estimateRelayerSpend(feePayer, instructions);

  if (estimate.spendClass !== "refund") {
    const ceiling =
      estimate.spendClass === "fee-only" ? DAILY_BUDGET_LAMPORTS + COMPLETION_RESERVE_LAMPORTS : DAILY_BUDGET_LAMPORTS;
    if (ledger.spentLamports + estimate.netLamports > ceiling) {
      throw new RelayerBudgetError(
        `daily relayer spend limit of ${sol(DAILY_BUDGET_LAMPORTS)} SOL is used up (${sol(ledger.spentLamports)} SOL spent today); ` +
          `retry in ${secondsToUtcMidnight(now)}s after 00:00 UTC`,
        "daily_budget",
      );
    }
  }

  const perRoom = new Map<string, number>();
  for (const room of estimate.joinRooms) perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
  for (const [room, n] of perRoom) {
    if ((joinsByRoom.get(room) ?? 0) + n > MAX_JOINS_PER_ROOM) {
      throw new RelayerBudgetError(
        `this room has used its ${MAX_JOINS_PER_ROOM} relayer-funded seats; join the next room`,
        "room_join_cap",
      );
    }
  }

  const day = ledger.day;
  ledger.spentLamports += estimate.netLamports;
  for (const [room, n] of perRoom) {
    joinsByRoom.delete(room);
    joinsByRoom.set(room, (joinsByRoom.get(room) ?? 0) + n);
  }
  for (const k of joinsByRoom.keys()) {
    if (joinsByRoom.size <= MAX_TRACKED_ROOMS) break;
    joinsByRoom.delete(k);
  }

  let released = false;
  let charged = estimate.netLamports;
  return {
    estimate,
    reconcile(actualNetLamports: bigint) {
      if (released || ledger.day !== day) return;
      ledger.spentLamports += actualNetLamports - charged;
      charged = actualNetLamports;
    },
    release() {
      if (released) return;
      released = true;
      if (ledger.day === day) ledger.spentLamports -= charged;
      for (const [room, n] of perRoom) {
        const left = (joinsByRoom.get(room) ?? n) - n;
        if (left <= 0) joinsByRoom.delete(room);
        else joinsByRoom.set(room, left);
      }
    },
  };
}

export interface RelayerSpendSnapshot {
  day: string;
  spentLamports: bigint;
  budgetLamports: bigint;
  remainingLamports: bigint;
  completionReserveLamports: bigint;
  maxJoinsPerRoom: number;
  scope: "per-instance";
}

export function relayerSpendSnapshot(now: number = Date.now()): RelayerSpendSnapshot {
  rollDay(now);
  const remaining = DAILY_BUDGET_LAMPORTS - ledger.spentLamports;
  return {
    day: ledger.day,
    spentLamports: ledger.spentLamports,
    budgetLamports: DAILY_BUDGET_LAMPORTS,
    remainingLamports: remaining > 0n ? remaining : 0n,
    completionReserveLamports: COMPLETION_RESERVE_LAMPORTS,
    maxJoinsPerRoom: MAX_JOINS_PER_ROOM,
    scope: "per-instance",
  };
}
