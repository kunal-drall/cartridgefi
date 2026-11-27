import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import * as client from "@/lib/borel/client";
import { authorizeWalletForRoom } from "@/lib/wallet/identity";
import type {
  ChainReceipt,
  LegIndex,
  LockedHand,
  PivotKind,
  RoomMode,
} from "@/lib/borel/types";

/** UI-facing result of one chain action. Never carries a fabricated signature. */
export type ChainOutcome =
  | { kind: "receipt"; receipt: ChainReceipt }
  | { kind: "unfunded"; reason: string }
  | { kind: "paper" }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

/** Server room schedule (epoch ms). DEVNET rooms run on this clock, not a local one. */
export interface RoomClock {
  startsAt: number;
  lockAt: number;
  endsAt: number;
}

export interface JoinStep {
  outcome: ChainOutcome;
  roomId: string | null;
  vrfSeed: string | null;
  clock: RoomClock | null;
}

function clockOf(s: client.BorelRoomSnapshot | undefined): RoomClock | null {
  return s ? { startsAt: s.startsAt, lockAt: s.lockAt, endsAt: s.endsAt } : null;
}

let sessionSignerPromise: Promise<KeyPairSigner> | null = null;

/**
 * Ephemeral per-tab ed25519 session key. The relayer signs and pays for transactions; this key signs
 * each lock / pivot request so the relayer only acts for its holder. When a wallet is connected, the
 * wallet delegates this key once at join (see authorizeWalletForRoom); no further popups are needed.
 */
function sessionSigner(): Promise<KeyPairSigner> {
  sessionSignerPromise ??= generateKeyPairSigner();
  return sessionSignerPromise;
}

async function sessionPubkey(): Promise<string> {
  return (await sessionSigner()).address;
}

function failure(r: client.BorelUnfunded | client.BorelFailure): ChainOutcome {
  return r.status === "unfunded"
    ? { kind: "unfunded", reason: r.reason }
    : { kind: "error", message: r.reason };
}

function lastReceipt(receipts: readonly ChainReceipt[], fallback: string): ChainOutcome {
  const last = receipts[receipts.length - 1];
  return last ? { kind: "receipt", receipt: last } : { kind: "info", message: fallback };
}

export async function chainJoin(mode: RoomMode): Promise<JoinStep> {
  const session = await sessionPubkey();
  const r = await client.joinRoom({ mode, stake: "DEVNET", sessionPubkey: session });
  // With a connected wallet, the wallet signs ONE delegation of this session key for this room, so the
  // player identity is the wallet while later locks / pivots stay popup-free. Anonymous play is unchanged.
  if (client.isBorelOk(r)) {
    await authorizeWalletForRoom({ roomId: r.roomId, sessionPubkey: session, roomEndsAt: r.endsAt });
  }
  if (client.isBorelOk(r)) {
    return {
      outcome: lastReceipt(r.receipts, "joined · no transaction yet"),
      roomId: r.roomId,
      vrfSeed: r.vrfSeed || null,
      clock: clockOf(r),
    };
  }
  const snapshot = r.status === "unfunded" ? r.snapshot : undefined;
  return {
    outcome: failure(r),
    roomId: snapshot?.roomId ?? null,
    vrfSeed: snapshot?.vrfSeed || null,
    clock: clockOf(snapshot),
  };
}

export async function chainLock(
  roomId: string | null,
  hand: LockedHand,
  commitment: string,
  salt: string,
): Promise<ChainOutcome> {
  if (!roomId) return { kind: "error", message: "No Devnet room joined" };
  const r = await client.lockHand({
    roomId,
    signer: await sessionSigner(),
    hand,
    commitment,
    salt,
  });
  return client.isBorelOk(r) ? { kind: "receipt", receipt: r.receipt } : failure(r);
}

export async function chainPivot(
  roomId: string | null,
  legIndex: LegIndex,
  kind: PivotKind,
): Promise<ChainOutcome> {
  if (!roomId) return { kind: "error", message: "No Devnet room joined" };
  const r = await client.pivot({
    roomId,
    signer: await sessionSigner(),
    pivot: { legIndex, kind },
  });
  return client.isBorelOk(r) ? { kind: "receipt", receipt: r.receipt } : failure(r);
}

export async function chainSettle(roomId: string | null): Promise<ChainOutcome> {
  if (!roomId) return { kind: "error", message: "No Devnet room joined" };
  const r = await client.settleRoom(roomId);
  return client.isBorelOk(r) ? lastReceipt(r.receipts, "settled · no transaction") : failure(r);
}

export interface TieBreakSeed {
  seed: string;
  source: string | null;
}

/** Reads the room's published tie-break seed (empty until the room settles). */
export async function chainTieBreakSeed(roomId: string | null): Promise<TieBreakSeed | null> {
  if (!roomId) return null;
  const r = await client.getRoom(roomId, await sessionSigner());
  if (!client.isBorelOk(r) || !r.vrfSeed) return null;
  return { seed: r.vrfSeed, source: r.seedSource };
}
