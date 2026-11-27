"use client";

// Browser-side client for real test-USDC stakes in DEVNET Borel rooms (/api/borel/stake, /api/borel/claim).
// Every function resolves (never throws). The connected wallet signs exactly ONE transaction per stake;
// the relayer is fee payer and pays every rent, so the wallet needs test-USDC but no SOL.
import {
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  signBytes,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { walletClient } from "@/lib/wallet/client";
import type { BorelFailure, BorelResult } from "./client";
import { STAKE_AUTH_MAX_TTL_MS, STAKE_BUY_IN_UNITS, STAKE_FEE_BPS, stakeAuthMessage, stakeBuyInUnits } from "./stakes-core";
import type { ChainReceipt } from "./types";

/** Each staked room has ONE fixed buy-in per tier: pass `stakeBuyInUnits(roomId)` as `amountUnits`. */
export { STAKE_BUY_IN_UNITS, STAKE_FEE_BPS, stakeBuyInUnits };
/** Borel test-USDC has 6 decimals: 10 test-USDC = 10_000_000n units. */
export const TEST_USDC_DECIMALS = 6;

export interface StakeOk {
  readonly status: "ok";
  readonly envelope: string;
  readonly amountUnits: bigint;
  /** Wallet-signed open_session_envelope transaction (plus vault init receipts when this stake opened the vault). */
  readonly receipts: readonly ChainReceipt[];
}

export interface ClaimOk {
  readonly status: "ok";
  readonly payoutUnits: bigint;
  readonly wallet: string;
  readonly receipt: ChainReceipt;
}

export interface StakeStatusOk {
  readonly status: "ok";
  readonly roomId: string;
  readonly envelope: string;
  readonly staked: boolean;
  readonly principalUnits: bigint;
  readonly payoutUnits: bigint;
  /** 1-based final rank; 0 until payouts are distributed. */
  readonly rank: number;
  readonly settled: boolean;
  readonly claimed: boolean;
  readonly vault: { readonly address: string; readonly poolUnits: bigint; readonly settled: boolean; readonly feeBps: number } | null;
}

type Json = Record<string, unknown>;

const toBig = (v: unknown): bigint => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : 0n);

function fail(reason: string): BorelFailure {
  console.warn(`[borel-stakes] ${reason}`);
  return { status: "error", reason };
}

async function call(path: string, init?: RequestInit): Promise<Json> {
  try {
    const res = await fetch(path, { ...init, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as Json | null;
    if (!body || typeof body.status !== "string") return { status: "error", reason: `Stake API responded with HTTP ${res.status}` };
    return body;
  } catch {
    return { status: "error", reason: "Stake API unreachable" };
  }
}

const post = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function walletRejection(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel|declin/i.test(text)) return "Stake declined in wallet — you can keep playing unstaked";
  return `Wallet could not sign the stake: ${text.slice(0, 160)}`;
}

/** Converts "12.5" test-USDC into base units (no floating point). Returns null for invalid input. */
export function parseTestUsdc(amount: string): bigint | null {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) return null;
  return BigInt(m[1] as string) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/**
 * Stake test-USDC into the room's on-chain vault (cartridge_vault_router.open_session_envelope).
 * Preconditions: the session already joined `roomId` (a staked DEVNET room, id ending in -S), it is among the
 * first 8 joiners, and a wallet is connected. `amountUnits` must equal `stakeBuyInUnits(roomId)`. Must complete
 * before the room's lockAt. One wallet popup; the session key signs the intent silently. The server answers
 * 503 "Staked rooms are paused for an on-chain upgrade" while BOREL_STAKES_ENABLED is off.
 */
export async function stake(args: {
  roomId: string;
  /** The same ephemeral session signer used for joinRoom / lockHand. */
  signer: KeyPairSigner;
  amountUnits: bigint;
}): Promise<BorelResult<StakeOk>> {
  const { connected } = walletClient.wallet.getState();
  if (!connected) return fail("Connect a wallet to stake (anonymous sessions play unstaked)");
  const walletSigner = connected.signer;
  if (!walletSigner) return fail("This wallet is read-only and cannot sign transactions");
  if (!connected.supportedTransactionVersions.has(0)) return fail("This wallet cannot sign version-0 transactions");
  const buyIn = stakeBuyInUnits(args.roomId);
  if (buyIn === null || args.amountUnits !== buyIn) {
    return fail(`This room has a fixed buy-in of ${(buyIn ?? 0n) / 1_000_000n} test-USDC`);
  }
  const wallet = connected.account.address;

  let auth: { expiresAt: number; signature: string };
  try {
    const expiresAt = Date.now() + Math.floor(STAKE_AUTH_MAX_TTL_MS / 2);
    const message = stakeAuthMessage({ roomId: args.roomId, sessionPubkey: args.signer.address, walletAddress: wallet, amountUnits: args.amountUnits, expiresAt });
    auth = { expiresAt, signature: getBase58Decoder().decode(await signBytes(args.signer.keyPair.privateKey, message)) };
  } catch {
    return fail("Session key could not sign the stake request");
  }

  const built = await post("/api/borel/stake", {
    action: "build",
    roomId: args.roomId,
    sessionPubkey: args.signer.address,
    wallet,
    amountUnits: args.amountUnits.toString(),
    auth,
  });
  if (built.status !== "ok" || typeof built.transaction !== "string" || typeof built.token !== "string") {
    return fail(String(built.reason ?? "Stake could not be prepared"));
  }

  let signedWire: string;
  try {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction)) as Transaction;
    let signed: Transaction;
    if (isTransactionModifyingSigner(walletSigner)) {
      const [out] = await walletSigner.modifyAndSignTransactions([tx]);
      if (!out) return fail("Wallet returned no transaction");
      signed = out;
    } else if (isTransactionPartialSigner(walletSigner)) {
      const [sigs] = await walletSigner.signTransactions([tx as Parameters<typeof walletSigner.signTransactions>[0][number]]);
      signed = { ...tx, signatures: { ...tx.signatures, ...(sigs ?? {}) } };
    } else {
      return fail("This wallet can only sign-and-send; Borel stakes need sign-only (relayer pays the fee)");
    }
    signedWire = getBase64EncodedWireTransaction(signed);
  } catch (err) {
    return fail(walletRejection(err));
  }

  const submitted = await post("/api/borel/stake", {
    action: "submit",
    roomId: args.roomId,
    sessionPubkey: args.signer.address,
    wallet,
    transaction: signedWire,
    token: built.token,
  });
  if (submitted.status !== "ok") return fail(String(submitted.reason ?? "Stake submission failed"));
  const vaultReceipts = Array.isArray(built.receipts) ? (built.receipts as ChainReceipt[]) : [];
  return {
    status: "ok",
    envelope: String(submitted.envelope ?? built.envelope ?? ""),
    amountUnits: args.amountUnits,
    receipts: [...vaultReceipts, submitted.receipt as ChainReceipt],
  };
}

/**
 * Pays a settled stake out to the wallet that staked it (cartridge_vault_router.claim_prize → wallet ATA).
 * Settlement already pushes payouts automatically; call this only if getStake shows settled && !claimed &&
 * payoutUnits > 0. No wallet popup.
 */
export async function claim(args: { roomId: string; sessionPubkey: string }): Promise<BorelResult<ClaimOk>> {
  const body = await post("/api/borel/claim", { roomId: args.roomId, sessionPubkey: args.sessionPubkey });
  if (body.status !== "ok") return fail(String(body.reason ?? "Claim failed"));
  return { status: "ok", payoutUnits: toBig(body.payoutUnits), wallet: String(body.wallet ?? ""), receipt: body.receipt as ChainReceipt };
}

/** On-chain stake status for a session in a room (envelope principal, payout, rank, claim state). */
export async function getStake(args: { roomId: string; sessionPubkey: string }): Promise<BorelResult<StakeStatusOk>> {
  const qs = new URLSearchParams({ roomId: args.roomId, sessionPubkey: args.sessionPubkey });
  const body = await call(`/api/borel/stake?${qs.toString()}`);
  if (body.status !== "ok") return fail(String(body.reason ?? "Stake status unavailable"));
  const vault = body.vault as Json | null;
  return {
    status: "ok",
    roomId: String(body.roomId ?? args.roomId),
    envelope: String(body.envelope ?? ""),
    staked: body.staked === true,
    principalUnits: toBig(body.principalUnits),
    payoutUnits: toBig(body.payoutUnits),
    rank: typeof body.rank === "number" ? body.rank : 0,
    settled: body.settled === true,
    claimed: body.claimed === true,
    vault: vault
      ? { address: String(vault.address ?? ""), poolUnits: toBig(vault.poolUnits), settled: vault.settled === true, feeBps: typeof vault.feeBps === "number" ? vault.feeBps : 0 }
      : null,
  };
}
