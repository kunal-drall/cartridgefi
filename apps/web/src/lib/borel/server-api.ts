// Server-only: shared plumbing for /api/borel/* route handlers.
import "server-only";
import { NextResponse } from "next/server";
import {
  address,
  getBase58Encoder,
  getPublicKeyFromAddress,
  verifySignature,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type SignatureBytes,
} from "@solana/kit";
import { z } from "zod";
import {
  AUTH_MAX_TTL_MS,
  WALLET_DELEGATION_MAX_TTL_MS,
  borelAuthMessage,
  borelWalletDelegationMessage,
  type BorelAuthAction,
} from "./auth";
import {
  RELAYER_BALANCE_FLOOR_LAMPORTS,
  SIMULATION_STAND_IN_PAYER,
  getRelayerRpc,
  getRelayerSigner,
  isRelayerConfigured,
  solscanTxUrl,
} from "../relayer/config";
import { checkRateLimit, clientIpFromRequest } from "../relayer/rate-limit";
import { RelayerTxError, signSendAndConfirm, simulateUnsigned, sweepEphemeralKeys } from "../relayer/send";
import { ErTxError, sendErTransaction } from "../relayer/er";
import type { ChainReceipt } from "./types";
import { erReceipt, type BuiltBorelTx, type RoomStateSnapshot } from "./server-chain";

export function bigintJson(body: unknown, status = 200): NextResponse {
  return new NextResponse(
    JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}

/** Returns a response when the request must stop (rate limited / not configured), else null. */
export function guardRequest(req: Request, opts: { rateLimit: boolean }): NextResponse | null {
  if (opts.rateLimit) {
    const verdict = checkRateLimit(`borel:${clientIpFromRequest(req)}`);
    if (!verdict.allowed) {
      const res = bigintJson({ status: "error", reason: `Rate limited — retry in ${verdict.retryAfterSecs}s` });
      res.headers.set("retry-after", String(verdict.retryAfterSecs));
      return res;
    }
  }
  if (!isRelayerConfigured()) {
    return bigintJson({ status: "error", reason: "Relayer is not configured on this deployment" }, 503);
  }
  return null;
}

const Base58Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);

export const WalletDelegationSchema = z.object({
  walletAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  roomId: z.string().min(1).max(64),
  expiresAt: z.number().int().positive(),
  signature: Base58Signature,
});

export const AuthSchema = z.object({
  expiresAt: z.number().int().positive(),
  signature: Base58Signature,
  /** Optional: the connected wallet's delegation of this session key for this room. */
  wallet: WalletDelegationSchema.optional(),
});

async function verifyEd25519(signer: string, signatureB58: string, message: Uint8Array): Promise<boolean> {
  const sig = new Uint8Array(getBase58Encoder().encode(signatureB58));
  if (sig.length !== 64) return false;
  const key = await getPublicKeyFromAddress(address(signer));
  return verifySignature(key, sig as unknown as SignatureBytes, message);
}

/**
 * Verifies that `walletAddress` signed `{roomId, sessionPubkey, walletAddress, expiresAt}` (the one
 * wallet popup at join), binding the ephemeral session key to that wallet for that room only.
 * Returns the verified wallet address, or a human-readable reason.
 */
export async function verifyWalletDelegation(args: {
  roomId: string;
  sessionPubkey: string;
  delegation: z.infer<typeof WalletDelegationSchema>;
}): Promise<{ ok: true; walletAddress: Address } | { ok: false; reason: string }> {
  const d = args.delegation;
  const now = Date.now();
  if (d.roomId !== args.roomId) return { ok: false, reason: "Wallet authorization is for a different room" };
  if (d.expiresAt <= now) return { ok: false, reason: "Wallet authorization expired" };
  if (d.expiresAt > now + WALLET_DELEGATION_MAX_TTL_MS) {
    return { ok: false, reason: "Wallet authorization expiry too far in the future" };
  }
  try {
    const message = borelWalletDelegationMessage({
      roomId: d.roomId,
      sessionPubkey: args.sessionPubkey,
      walletAddress: d.walletAddress,
      expiresAt: d.expiresAt,
    });
    const ok = await verifyEd25519(d.walletAddress, d.signature, message);
    return ok ? { ok: true, walletAddress: address(d.walletAddress) } : { ok: false, reason: "Invalid wallet signature" };
  } catch {
    return { ok: false, reason: "Wallet authorization could not be verified" };
  }
}

/**
 * Verifies that the session key signed `{action, roomId, sessionPubkey, params, expiresAt}`, and, when the
 * request carries `auth.wallet`, that the wallet delegated this session key for this room.
 * Returns null when valid, else a human-readable reason.
 */
export async function verifySessionAuth(args: {
  action: BorelAuthAction;
  roomId: string;
  sessionPubkey: string;
  params: unknown;
  auth: z.infer<typeof AuthSchema>;
}): Promise<string | null> {
  const now = Date.now();
  if (args.auth.expiresAt <= now) return "Session signature expired";
  if (args.auth.expiresAt > now + AUTH_MAX_TTL_MS) return "Session signature expiry too far in the future";
  try {
    const message = borelAuthMessage({
      action: args.action,
      roomId: args.roomId,
      sessionPubkey: args.sessionPubkey,
      params: args.params,
      expiresAt: args.auth.expiresAt,
    });
    if (!(await verifyEd25519(args.sessionPubkey, args.auth.signature, message))) return "Invalid session signature";
  } catch {
    return "Session signature could not be verified";
  }
  // A request that claims a wallet must carry a valid wallet delegation; anonymous sessions omit it.
  if (args.auth.wallet) {
    const verdict = await verifyWalletDelegation({
      roomId: args.roomId,
      sessionPubkey: args.sessionPubkey,
      delegation: args.auth.wallet,
    });
    if (!verdict.ok) return verdict.reason;
  }
  return null;
}

export interface RelayerContext {
  signer: KeyPairSigner;
  /** Address used as fee payer / authority: the relayer, or the simulation stand-in when unfunded. */
  payer: Address;
  funded: boolean;
  balanceLamports: bigint;
}

export async function relayerContext(): Promise<RelayerContext> {
  const signer = await getRelayerSigner();
  const { value: balance } = await getRelayerRpc().getBalance(signer.address, { commitment: "confirmed" }).send();
  const funded = balance >= RELAYER_BALANCE_FLOOR_LAMPORTS;
  return {
    signer,
    payer: funded ? address(signer.address) : address(SIMULATION_STAND_IN_PAYER),
    funded,
    balanceLamports: balance,
  };
}

export type ExecOutcome =
  | { status: "ok"; receipts: ChainReceipt[] }
  | { status: "unfunded"; reason: string; simulationLogs: string[]; simulationOk: boolean }
  | { status: "error"; reason: string; logs?: readonly string[] };

/** Sends each tx in order (funded) or dry-runs them with sigVerify:false (unfunded). Never throws. */
export async function executeBorelTxs(ctx: RelayerContext, txs: BuiltBorelTx[]): Promise<ExecOutcome> {
  try {
    if (!ctx.funded) {
      const logs: string[] = [];
      let allOk = true;
      for (const tx of txs) {
        const sim = await simulateUnsigned(ctx.payer, tx.instructions, tx.extraSigners);
        allOk = allOk && sim.ok;
        logs.push(`# ${tx.label} — ${sim.ok ? "simulation OK" : `simulation failed: ${JSON.stringify(sim.err)}`} (${sim.unitsConsumed ?? "?"} CU, ${sim.wireBytes} bytes, stand-in payer ${sim.feePayer})`);
        logs.push(...sim.logs);
      }
      return {
        status: "unfunded",
        reason: `Relayer ${ctx.signer.address} holds ${ctx.balanceLamports.toString()} lamports (< floor ${RELAYER_BALANCE_FLOOR_LAMPORTS.toString()}); transaction simulated only, nothing broadcast`,
        simulationLogs: logs,
        simulationOk: allOk,
      };
    }
    const receipts: ChainReceipt[] = [];
    for (const tx of txs) {
      const confirmed = await signSendAndConfirm(ctx.signer, tx.instructions, tx.extraSigners);
      receipts.push({
        label: tx.label,
        signature: confirmed.signature,
        cluster: "devnet",
        explorerUrl: solscanTxUrl(confirmed.signature),
        slot: confirmed.slot,
      });
      if (tx.sweepSigners.length > 0) await sweepEphemeralKeys(ctx.signer, tx.sweepSigners);
    }
    return { status: "ok", receipts };
  } catch (err) {
    if (err instanceof RelayerTxError) return { status: "error", reason: err.message, logs: err.logs };
    return { status: "error", reason: err instanceof Error ? err.message.slice(0, 400) : "Relayer failure" };
  }
}

/**
 * Sends one relayer-signed transaction to the MagicBlock Private ER (TEE). ER execution costs 0
 * lamports, so this never spends relayer SOL; the stance session key co-signs submit_stance.
 */
export async function executeErAction(
  ctx: RelayerContext,
  action: { label: string; instructions: Instruction[]; extraSigners: KeyPairSigner[] },
): Promise<{ status: "ok"; receipt: ChainReceipt } | { status: "error"; reason: string }> {
  try {
    const tx = await sendErTransaction(ctx.signer, action.instructions, action.extraSigners);
    return { status: "ok", receipt: erReceipt(action.label, tx.signature, tx.slot) };
  } catch (err) {
    if (err instanceof ErTxError) return { status: "error", reason: err.message.slice(0, 600) };
    return { status: "error", reason: err instanceof Error ? err.message.slice(0, 400) : "MagicBlock ER failure" };
  }
}

export interface SnapshotJson {
  roomId: string;
  mode: RoomStateSnapshot["schedule"]["mode"];
  stake: RoomStateSnapshot["schedule"]["stake"];
  stakeLabel: string;
  staked: boolean;
  phase: RoomStateSnapshot["phase"];
  startsAt: number;
  lockAt: number;
  endsAt: number;
  vrfSeed: string;
  seedSource: string | null;
  roomShard: string;
  relayer: { pubkey: string; funded: boolean };
  receipts: ChainReceipt[];
  rows: RoomStateSnapshot["rows"];
}

export function snapshotJson(
  state: RoomStateSnapshot,
  ctx: RelayerContext,
  extraReceipts: ChainReceipt[] = [],
): SnapshotJson {
  const seen = new Set(state.receipts.map((r) => r.signature));
  return {
    roomId: state.schedule.roomId,
    mode: state.schedule.mode,
    stake: state.schedule.stake,
    stakeLabel: state.schedule.staked
      ? "Staked room: test-USDC stakes via cartridge_vault_router; only stakers are counted on-chain"
      : "Fee-free on-chain room (no SPL stake)",
    staked: state.schedule.staked,
    phase: state.phase,
    startsAt: state.schedule.startsAt,
    lockAt: state.schedule.lockAt,
    endsAt: state.schedule.endsAt,
    vrfSeed: state.vrfSeed,
    seedSource: state.seedSource,
    roomShard: state.roomShardPda,
    relayer: { pubkey: ctx.signer.address, funded: ctx.funded },
    receipts: [...state.receipts, ...extraReceipts.filter((r) => !seen.has(r.signature))],
    rows: state.rows,
  };
}
