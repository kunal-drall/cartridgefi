"use client";

import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type AccountRole,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import type { SerializedInstructionPayload } from "@cartridgefi/sdk";
import devnetProof from "@/data/devnet-proof.json";

const SESSION_SEED_STORAGE_KEY = "cartridgefi_ed25519_seed_v2";

export const SOLANA_DEVNET_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? devnetProof.clusters.solanaDevnetRpc;

export interface InjectedSolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  publicKey?: { toBase58(): string };
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{
    publicKey?: { toBase58(): string };
  }>;
  disconnect(): Promise<void>;
  signMessage?(
    message: Uint8Array,
    display?: string,
  ): Promise<{ signature: Uint8Array } | Uint8Array>;
}

export interface DetectedBrowserWallet {
  id: "phantom" | "solflare" | "backpack" | "injected";
  name: string;
  provider: InjectedSolanaProvider;
}

export function detectBrowserSolanaWallets(): DetectedBrowserWallet[] {
  if (typeof window === "undefined") return [];
  const win = window as unknown as Record<string, unknown>;
  const found: DetectedBrowserWallet[] = [];
  const seen = new Set<unknown>();

  const phantomObj = win.phantom as { solana?: InjectedSolanaProvider } | undefined;
  if (phantomObj?.solana && !seen.has(phantomObj.solana)) {
    seen.add(phantomObj.solana);
    found.push({ id: "phantom", name: "Phantom", provider: phantomObj.solana });
  }

  const solflareObj = win.solflare as InjectedSolanaProvider | undefined;
  if (solflareObj && typeof solflareObj.connect === "function" && !seen.has(solflareObj)) {
    seen.add(solflareObj);
    found.push({ id: "solflare", name: "Solflare", provider: solflareObj });
  }

  const backpackObj = win.backpack as { solana?: InjectedSolanaProvider } | undefined;
  if (backpackObj?.solana && !seen.has(backpackObj.solana)) {
    seen.add(backpackObj.solana);
    found.push({ id: "backpack", name: "Backpack", provider: backpackObj.solana });
  }

  const genericSolana = win.solana as InjectedSolanaProvider | undefined;
  if (
    genericSolana &&
    typeof genericSolana.connect === "function" &&
    !seen.has(genericSolana)
  ) {
    seen.add(genericSolana);
    found.push({
      id: "injected",
      name: genericSolana.isPhantom
        ? "Phantom"
        : genericSolana.isSolflare
          ? "Solflare"
          : "Browser Wallet",
      provider: genericSolana,
    });
  }

  return found;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Loads or generates a real WebCrypto Ed25519 Solana keypair signer stored in browser localStorage.
 */
export async function getOrCreateBrowserSessionSigner(
  forceRotate = false,
): Promise<KeyPairSigner> {
  let seedBytes: Uint8Array | null = null;

  if (typeof window !== "undefined" && !forceRotate) {
    try {
      const existingHex = window.localStorage.getItem(SESSION_SEED_STORAGE_KEY);
      if (existingHex && /^[0-9a-f]{64}$/i.test(existingHex)) {
        seedBytes = hexToBytes(existingHex);
      }
    } catch {
      // Ignore storage access errors
    }
  }

  if (!seedBytes || seedBytes.length !== 32) {
    seedBytes = new Uint8Array(32);
    crypto.getRandomValues(seedBytes);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          SESSION_SEED_STORAGE_KEY,
          bytesToHex(seedBytes),
        );
      } catch {
        // Ignore storage errors
      }
    }
  }

  return createKeyPairSignerFromPrivateKeyBytes(seedBytes);
}

export async function fetchWalletDevnetBalances(walletAddress: string): Promise<{
  lamports: bigint;
  splAtomic: bigint;
}> {
  try {
    const res = await fetch("/api/cashier/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: walletAddress,
        requestDevnetSol: false,
      }),
    });
    if (!res.ok) return { lamports: 0n, splAtomic: 0n };
    const data = (await res.json()) as {
      onchainLamports?: string;
      onchainSplAtomic?: string;
    };
    return {
      lamports: BigInt(data.onchainLamports ?? "0"),
      splAtomic: BigInt(data.onchainSplAtomic ?? "0"),
    };
  } catch {
    return { lamports: 0n, splAtomic: 0n };
  }
}

export interface DevnetExecutionResult {
  mode: "broadcast_confirmed" | "devnet_rpc_simulated";
  signature: string | null;
  solscanUrl: string | null;
  unitsConsumed: number | null;
  logs: string[];
  error: string | null;
}

/**
 * Builds a real Solana v0 TransactionMessage from a serialized Codama instruction.
 * If the session signer has >= 0.002 SOL on Devnet, signs and broadcasts live via sendTransaction.
 * Otherwise, executes a real `simulateTransaction` (`sigVerify: false`) against Solana Devnet RPC
 * returning actual validator logs & compute units without ever fabricating a fake tx hash.
 */
export async function executeOrSimulateInstructionOnDevnet(
  signer: KeyPairSigner,
  payload: SerializedInstructionPayload,
): Promise<DevnetExecutionResult> {
  try {
    const [bhRes, balRes] = await Promise.all([
      fetch(SOLANA_DEVNET_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getLatestBlockhash",
          params: [{ commitment: "confirmed" }],
        }),
        signal: AbortSignal.timeout(3500),
      }),
      fetch(SOLANA_DEVNET_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "getBalance",
          params: [signer.address, { commitment: "confirmed" }],
        }),
        signal: AbortSignal.timeout(3500),
      }),
    ]);

    const bhJson = (await bhRes.json()) as {
      result?: {
        value?: { blockhash: string; lastValidBlockHeight: number };
      };
    };
    const balJson = (await balRes.json()) as {
      result?: { value?: number };
    };

    const recentBh = bhJson.result?.value;
    if (!recentBh?.blockhash) {
      return {
        mode: "devnet_rpc_simulated",
        signature: null,
        solscanUrl: null,
        unitsConsumed: null,
        logs: [],
        error: "Unable to fetch latest blockhash from Solana Devnet RPC.",
      };
    }

    const instruction: Instruction = {
      programAddress: address(payload.programAddress),
      accounts: payload.accounts.map((acc) => ({
        address: address(acc.address),
        role: acc.role as AccountRole,
      })),
      data: hexToBytes(payload.dataHex),
    };

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash(recentBh.blockhash),
            lastValidBlockHeight: BigInt(recentBh.lastValidBlockHeight),
          },
          m,
        ),
      (m) => appendTransactionMessageInstruction(instruction, m),
    );

    const lamports = balJson.result?.value ?? 0;

    if (lamports >= 2_500_000) {
      const signedTx = await signTransactionMessageWithSigners(txMessage);
      const wireBase64 = getBase64EncodedWireTransaction(signedTx);
      const expectedSig = getSignatureFromTransaction(signedTx);

      const sendRes = await fetch(SOLANA_DEVNET_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "sendTransaction",
          params: [
            wireBase64,
            { encoding: "base64", preflightCommitment: "confirmed" },
          ],
        }),
        signal: AbortSignal.timeout(3500),
      });
      const sendJson = (await sendRes.json()) as {
        result?: string;
        error?: { message?: string; data?: { logs?: string[] } };
      };

      if (sendJson.result) {
        return {
          mode: "broadcast_confirmed",
          signature: sendJson.result,
          solscanUrl: `https://solscan.io/tx/${sendJson.result}?cluster=devnet`,
          unitsConsumed: null,
          logs: [`Broadcast transaction ${expectedSig} to Solana Devnet.`],
          error: null,
        };
      }

      return {
        mode: "devnet_rpc_simulated",
        signature: null,
        solscanUrl: null,
        unitsConsumed: null,
        logs: sendJson.error?.data?.logs ?? [],
        error: sendJson.error?.message ?? "Transaction preflight failed",
      };
    }

    // Wallet has < 0.0025 SOL: run real validator preflight simulation on Devnet RPC
    const unsignedTx = compileTransaction(txMessage);
    const wireBase64 = getBase64EncodedWireTransaction(unsignedTx);

    const simRes = await fetch(SOLANA_DEVNET_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "simulateTransaction",
        params: [
          wireBase64,
          {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: "confirmed",
          },
        ],
      }),
      signal: AbortSignal.timeout(3500),
    });

    const simJson = (await simRes.json()) as {
      result?: {
        value?: {
          err: unknown;
          logs?: string[];
          unitsConsumed?: number;
        };
      };
    };

    const simVal = simJson.result?.value;
    return {
      mode: "devnet_rpc_simulated",
      signature: null,
      solscanUrl: null,
      unitsConsumed: simVal?.unitsConsumed ?? null,
      logs: simVal?.logs ?? [],
      error: simVal?.err
        ? `Session wallet (${signer.address.slice(0, 6)}…) holds ${(lamports / 1e9).toFixed(4)} SOL on Devnet. Fund wallet with Devnet SOL to pay rent and commit state.`
        : null,
    };
  } catch (err) {
    return {
      mode: "devnet_rpc_simulated",
      signature: null,
      solscanUrl: null,
      unitsConsumed: null,
      logs: [],
      error: err instanceof Error ? err.message : "Devnet RPC error",
    };
  }
}
