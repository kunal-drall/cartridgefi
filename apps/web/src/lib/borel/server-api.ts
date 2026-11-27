// Server-only: shared plumbing for /api/borel/* route handlers.
import { NextResponse } from "next/server";
import {
  address,
  getBase58Encoder,
  getPublicKeyFromAddress,
  verifySignature,
  type Address,
  type KeyPairSigner,
  type SignatureBytes,
} from "@solana/kit";
import { z } from "zod";
import { AUTH_MAX_TTL_MS, borelAuthMessage, type BorelAuthAction } from "./auth";
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
import type { ChainReceipt } from "./types";
import type { BuiltBorelTx, RoomStateSnapshot } from "./server-chain";

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

export const AuthSchema = z.object({
  expiresAt: z.number().int().positive(),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/),
});

/**
 * Verifies that the session key signed `{action, roomId, sessionPubkey, params, expiresAt}`.
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
    const sig = new Uint8Array(getBase58Encoder().encode(args.auth.signature));
    if (sig.length !== 64) return "Malformed session signature";
    const key = await getPublicKeyFromAddress(address(args.sessionPubkey));
    const message = borelAuthMessage({
      action: args.action,
      roomId: args.roomId,
      sessionPubkey: args.sessionPubkey,
      params: args.params,
      expiresAt: args.auth.expiresAt,
    });
    const ok = await verifySignature(key, sig as unknown as SignatureBytes, message);
    return ok ? null : "Invalid session signature";
  } catch {
    return "Session signature could not be verified";
  }
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

export interface SnapshotJson {
  roomId: string;
  mode: RoomStateSnapshot["schedule"]["mode"];
  stake: RoomStateSnapshot["schedule"]["stake"];
  stakeLabel: string;
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
    stakeLabel: "Fee-free paper-staked on-chain room (no SPL stake)",
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
