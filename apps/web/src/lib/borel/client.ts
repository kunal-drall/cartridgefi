"use client";

// Browser-side client for the relayer-signed Borel room API (/api/borel/*).
// Every function resolves (never throws) and never logs with console.error.
// lockHand / pivot / authenticated getRoom are signed by the player's ephemeral ed25519 session key.
import { getBase58Decoder, signBytes, type KeyPairSigner } from "@solana/kit";
import {
  AUTH_MAX_TTL_MS,
  borelAuthMessage,
  walletDelegationFor,
  type BorelAuthAction,
  type WalletDelegation,
} from "./auth";
import type {
  ChainReceipt,
  LockedHand,
  LockedLeg,
  PivotAction,
  RankRow,
  RoomMode,
  RoomPhase,
  StakeMode,
} from "./types";

export interface BorelRoomSnapshot {
  readonly status: "ok";
  readonly roomId: string;
  readonly mode: RoomMode;
  readonly stake: StakeMode;
  /** Honest stake label: rooms are fee-free / paper-staked on-chain (no SPL stake). */
  readonly stakeLabel: string;
  readonly phase: RoomPhase;
  readonly startsAt: number;
  readonly lockAt: number;
  readonly endsAt: number;
  /** 32-byte tie-break seed (hex); "" until settle. Derived from a Devnet blockhash, not MagicBlock VRF. */
  readonly vrfSeed: string;
  readonly seedSource: string | null;
  readonly roomShard: string;
  readonly relayer: { readonly pubkey: string; readonly funded: boolean };
  readonly receipts: readonly ChainReceipt[];
  /** Ranks + scores only while sealed; `hand` / `pivot` appear after the 00:00 unseal. */
  readonly rows: readonly RankRow[];
}

export interface BorelUnfunded {
  readonly status: "unfunded";
  readonly reason: string;
  readonly simulationLogs?: readonly string[];
  readonly simulationOk?: boolean;
  /** joinRoom only: the room you would have joined, so paper play can continue. */
  readonly snapshot?: BorelRoomSnapshot;
}

export interface BorelFailure {
  readonly status: "error";
  readonly reason: string;
}

export type BorelResult<T> = T | BorelUnfunded | BorelFailure;

export interface ChainReceiptResult {
  readonly status: "ok";
  readonly receipt: ChainReceipt;
}

export interface LockResult extends ChainReceiptResult {
  /** The hand as sealed by the relayer: entry prices are set server-side from fresh Pyth data. */
  readonly hand: LockedHand;
}

export interface PivotResult extends ChainReceiptResult {
  /** Server-authoritative pivot (Pyth price at execution). */
  readonly pivot: PivotAction;
}

export interface SettleResult {
  readonly status: "ok";
  readonly receipts: readonly ChainReceipt[];
}

export function isBorelOk<T extends { status: "ok" }>(r: BorelResult<T>): r is T {
  return r.status === "ok";
}

type Json = Record<string, unknown>;

const toBig = (v: unknown): bigint => (typeof v === "string" && /^-?\d+$/.test(v) ? BigInt(v) : 0n);

function reviveLeg(raw: Json): LockedLeg {
  return { ...(raw as unknown as LockedLeg), entryPriceE9: toBig(raw.entryPriceE9) };
}

function revivePivot(raw: Json): PivotAction {
  return { ...(raw as unknown as PivotAction), priceE9: toBig(raw.priceE9) };
}

function reviveRow(raw: Json): RankRow {
  const hand = Array.isArray(raw.hand) ? (raw.hand as Json[]).map(reviveLeg) : undefined;
  return {
    ...(raw as unknown as RankRow),
    ...(typeof raw.scoreE9 === "string" ? { scoreE9: toBig(raw.scoreE9) } : {}),
    ...(hand ? { hand: hand as unknown as LockedHand } : {}),
    ...(raw.pivot && typeof raw.pivot === "object" ? { pivot: revivePivot(raw.pivot as Json) } : {}),
  };
}

function reviveSnapshot(raw: Json): BorelRoomSnapshot {
  const rows = Array.isArray(raw.rows) ? (raw.rows as Json[]).map(reviveRow) : [];
  return { ...(raw as unknown as BorelRoomSnapshot), status: "ok", rows };
}

function serialize(body: unknown): string {
  return JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

async function call(path: string, init?: RequestInit): Promise<Json> {
  try {
    const res = await fetch(path, { ...init, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as Json | null;
    if (!body || typeof body.status !== "string") {
      return { status: "error", reason: `Borel API responded with HTTP ${res.status}` };
    }
    return body;
  } catch {
    return { status: "error", reason: "Borel API unreachable" };
  }
}

function settleFailure(body: Json): BorelUnfunded | BorelFailure {
  if (body.status === "unfunded") {
    return {
      status: "unfunded",
      reason: String(body.reason ?? "Relayer unfunded"),
      simulationLogs: Array.isArray(body.simulationLogs) ? (body.simulationLogs as string[]) : undefined,
      simulationOk: typeof body.simulationOk === "boolean" ? body.simulationOk : undefined,
      snapshot: body.snapshot && typeof body.snapshot === "object" ? reviveSnapshot(body.snapshot as Json) : undefined,
    };
  }
  const reason = String(body.reason ?? "Borel request failed");
  console.warn(`[borel] ${reason}`);
  return { status: "error", reason };
}

async function signAuth(
  signer: KeyPairSigner,
  action: BorelAuthAction,
  roomId: string,
  params: unknown,
): Promise<{ expiresAt: number; signature: string; wallet?: WalletDelegation } | null> {
  try {
    const expiresAt = Date.now() + Math.floor(AUTH_MAX_TTL_MS / 2);
    const message = borelAuthMessage({ action, roomId, sessionPubkey: signer.address, params, expiresAt });
    const sig = await signBytes(signer.keyPair.privateKey, message);
    return { expiresAt, signature: getBase58Decoder().decode(sig), wallet: walletDelegationFor(roomId, signer.address) };
  } catch {
    return null;
  }
}

const post = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "content-type": "application/json" }, body: serialize(body) });

export async function joinRoom(args: {
  mode: RoomMode;
  stake: StakeMode;
  sessionPubkey: string;
}): Promise<BorelResult<BorelRoomSnapshot>> {
  const body = await post("/api/borel/join", args);
  return body.status === "ok" ? reviveSnapshot(body) : settleFailure(body);
}

/** Pass the session signer to receive your own live score while the room is sealed. */
export async function getRoom(roomId: string, signer?: KeyPairSigner): Promise<BorelResult<BorelRoomSnapshot>> {
  const qs = new URLSearchParams({ roomId });
  const auth = signer ? await signAuth(signer, "room", roomId, {}) : null;
  if (signer && auth) {
    qs.set("sessionPubkey", signer.address);
    qs.set("expiresAt", String(auth.expiresAt));
    qs.set("signature", auth.signature);
  }
  const body = await call(`/api/borel/room?${qs.toString()}`);
  return body.status === "ok" ? reviveSnapshot(body) : settleFailure(body);
}

export async function lockHand(args: {
  roomId: string;
  signer: KeyPairSigner;
  /** Markets, directions and cards; entry prices are ignored (set server-side). */
  hand: readonly { market: LockedLeg["market"]; direction: LockedLeg["direction"]; conviction: LockedLeg["conviction"] }[];
  commitment: string;
  /** Optional: lets the relayer verify the commitment now and reveal the salt at unseal. */
  salt?: string;
}): Promise<BorelResult<LockResult>> {
  const legs = args.hand.map((l) => ({ market: l.market, direction: l.direction, conviction: l.conviction }));
  const params = { hand: legs, commitment: args.commitment, salt: args.salt };
  const auth = await signAuth(args.signer, "lock", args.roomId, params);
  if (!auth) return { status: "error", reason: "Session key could not sign the lock request" };
  const body = await post("/api/borel/lock", {
    roomId: args.roomId,
    sessionPubkey: args.signer.address,
    ...params,
    auth,
  });
  if (body.status === "ok") {
    const hand = Array.isArray(body.hand) ? ((body.hand as Json[]).map(reviveLeg) as unknown as LockedHand) : [];
    return { status: "ok", receipt: body.receipt as ChainReceipt, hand: hand as LockedHand };
  }
  return settleFailure(body);
}

export async function pivot(args: {
  roomId: string;
  signer: KeyPairSigner;
  pivot: Pick<PivotAction, "legIndex" | "kind">;
}): Promise<BorelResult<PivotResult>> {
  const requested = { legIndex: args.pivot.legIndex, kind: args.pivot.kind };
  const auth = await signAuth(args.signer, "pivot", args.roomId, requested);
  if (!auth) return { status: "error", reason: "Session key could not sign the pivot request" };
  const body = await post("/api/borel/pivot", {
    roomId: args.roomId,
    sessionPubkey: args.signer.address,
    pivot: requested,
    auth,
  });
  if (body.status === "ok") {
    return { status: "ok", receipt: body.receipt as ChainReceipt, pivot: revivePivot(body.pivot as Json) };
  }
  return settleFailure(body);
}

export async function settleRoom(roomId: string): Promise<BorelResult<SettleResult>> {
  const body = await post("/api/borel/settle", { roomId });
  return body.status === "ok"
    ? { status: "ok", receipts: (body.receipts as ChainReceipt[]) ?? [] }
    : settleFailure(body);
}
