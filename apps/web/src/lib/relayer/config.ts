// Server-only module: imported exclusively by app/api/relayer/* route handlers.
// Never import from a "use client" component — it reads the relayer secret.
import { createHmac } from "node:crypto";
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getBase58Encoder,
  type KeyPairSigner,
} from "@solana/kit";

export const RELAYER_CLUSTER = "devnet" as const;
export const RELAYER_RPC_URL =
  process.env.CARTRIDGEFI_RELAYER_RPC_URL ?? "https://api.devnet.solana.com";

/** Requests are refused once the relayer balance drops below this floor (0.03 SOL). */
export const RELAYER_BALANCE_FLOOR_LAMPORTS = 30_000_000n;

/** Funded public Devnet account used only as a stand-in fee payer for `sigVerify:false` simulations. */
export const SIMULATION_STAND_IN_PAYER = "D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1";

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

export function getRelayerRpc(): ReturnType<typeof createSolanaRpc> {
  if (!cachedRpc) cachedRpc = createSolanaRpc(RELAYER_RPC_URL);
  return cachedRpc;
}

export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=${RELAYER_CLUSTER}`;
}

export function solscanAccountUrl(account: string): string {
  return `https://solscan.io/account/${account}?cluster=${RELAYER_CLUSTER}`;
}
