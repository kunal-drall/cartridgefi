// Server-only module: imported exclusively by app/api/relayer/* route handlers.
// Never import from a "use client" component — it reads the relayer secret.
import "server-only";
import { createHmac } from "node:crypto";
import { DEVNET_RPC_FALLBACK, DEVNET_RPC_PRIMARY } from "../devnet-rpc";
import {
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  createDefaultRpcTransport,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcFromTransport,
  getBase58Encoder,
  isSolanaError,
  type KeyPairSigner,
} from "@solana/kit";

export const RELAYER_CLUSTER = "devnet" as const;
/**
 * Primary devnet RPC: env override, else MagicBlock's devnet base-layer RPC (serves every method the relayer
 * uses; far fewer 429s than the shared public endpoint). See `@/lib/devnet-rpc`.
 */
export const RELAYER_RPC_URL = process.env.CARTRIDGEFI_RELAYER_RPC_URL ?? DEVNET_RPC_PRIMARY;

/** Requests are refused once the relayer balance drops below this floor (0.03 SOL). */
export const RELAYER_BALANCE_FLOOR_LAMPORTS = 30_000_000n;

/** Funded public Devnet account used only as a stand-in fee payer for `sigVerify:false` simulations. */
export const SIMULATION_STAND_IN_PAYER = "D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1"; // historical proof run (2026-11-26) deployer, used only as a funded fee payer for sigVerify:false simulations

export const MAGICBLOCK_DEVNET_US_VALIDATOR = "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

export class RelayerConfigError extends Error {}

let cachedSigner: Promise<KeyPairSigner> | null = null;

export function isRelayerConfigured(): boolean {
  const raw = process.env.CARTRIDGEFI_RELAYER_SECRET_BASE58;
  return typeof raw === "string" && raw.trim().length > 0;
}

export function getRelayerSigner(): Promise<KeyPairSigner> {
  if (cachedSigner) return cachedSigner;
  const raw = process.env.CARTRIDGEFI_RELAYER_SECRET_BASE58?.trim();
  if (!raw) {
    return Promise.reject(
      new RelayerConfigError("Relayer is not configured (CARTRIDGEFI_RELAYER_SECRET_BASE58 missing)"),
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(getBase58Encoder().encode(raw));
  } catch {
    return Promise.reject(new RelayerConfigError("Relayer secret is not valid base58"));
  }
  if (bytes.length !== 64) {
    return Promise.reject(new RelayerConfigError("Relayer secret must decode to 64 bytes"));
  }
  cachedSigner = createKeyPairSignerFromBytes(bytes).catch((err: unknown) => {
    cachedSigner = null;
    throw err;
  });
  return cachedSigner;
}

/**
 * Domain-separated 32-byte key material derived from the relayer secret (never the secret itself).
 * Used for deterministic per-room keys and hand sealing so serverless instances stay stateless.
 */
export function deriveRelayerKeyMaterial(domain: string): Uint8Array {
  const raw = process.env.CARTRIDGEFI_RELAYER_SECRET_BASE58?.trim();
  if (!raw) throw new RelayerConfigError("Relayer is not configured (CARTRIDGEFI_RELAYER_SECRET_BASE58 missing)");
  return new Uint8Array(createHmac("sha256", raw).update(domain).digest());
}

let cachedRpc: ReturnType<typeof createSolanaRpc> | null = null;

const RPC_RETRY_DELAYS_MS = [0, 500, 1_000, 2_000, 4_000] as const;
/**
 * Second devnet RPC used when the primary fails with HTTP 429 / 5xx or a network error: public devnet, or
 * MagicBlock's devnet RPC when the primary was overridden to the public endpoint.
 */
export const RELAYER_FALLBACK_RPC_URL =
  process.env.CARTRIDGEFI_RELAYER_FALLBACK_RPC_URL ??
  (RELAYER_RPC_URL === DEVNET_RPC_FALLBACK ? DEVNET_RPC_PRIMARY : DEVNET_RPC_FALLBACK);

/**
 * HTTP transport that retries HTTP 429 / 5xx and network errors, alternating primary and fallback
 * with backoff. Every JSON-RPC call the relayer makes is safe to repeat: reads, status polls, and
 * sendTransaction of the same signed bytes.
 */
function retryOn429Transport(url: string, fallbackUrl: string): ReturnType<typeof createDefaultRpcTransport> {
  const urls = [url, fallbackUrl];
  const transports = urls.map((u) => createDefaultRpcTransport({ url: u }));
  const transport = async (...args: Parameters<(typeof transports)[number]>) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await transports[attempt % transports.length]!(...args);
      } catch (err) {
        // Retry on the other endpoint for 429 / 5xx and network failures (fetch TypeError); JSON-RPC
        // errors are not transport errors and are never retried here.
        const httpError = isSolanaError(err, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR);
        const retryable = httpError
          ? err.context.statusCode === 429 || err.context.statusCode >= 500
          : err instanceof TypeError;
        const delay = RPC_RETRY_DELAYS_MS[attempt];
        if (!retryable || delay === undefined) throw err;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      }
    }
  };
  return transport as ReturnType<typeof createDefaultRpcTransport>;
}

export function getRelayerRpc(): ReturnType<typeof createSolanaRpc> {
  if (!cachedRpc) cachedRpc = createSolanaRpcFromTransport(retryOn429Transport(RELAYER_RPC_URL, RELAYER_FALLBACK_RPC_URL)) as ReturnType<typeof createSolanaRpc>;
  return cachedRpc;
}

export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=${RELAYER_CLUSTER}`;
}

export function solscanAccountUrl(account: string): string {
  return `https://solscan.io/account/${account}?cluster=${RELAYER_CLUSTER}`;
}
