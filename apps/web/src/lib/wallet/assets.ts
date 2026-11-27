"use client";

import { address, createSolanaRpc, isAddress, lamports, type Address } from "@solana/kit";
import { DEVNET_RPC_URL } from "./client";

const rpc = createSolanaRpc(DEVNET_RPC_URL);

export const PUBLIC_FAUCET_URL = "https://faucet.solana.com";
/** 1 SOL per request is what the public devnet faucet usually grants without a 429. */
export const AIRDROP_LAMPORTS = 1_000_000_000n;

/** Test-USDC mint, from the env (central constant) or from the faucet route. Null until it exists. */
export function envTestUsdcMint(): Address | null {
  const raw = process.env.NEXT_PUBLIC_BOREL_TEST_USDC_MINT?.trim();
  return raw && isAddress(raw) ? address(raw) : null;
}

export async function fetchSolLamports(owner: Address): Promise<bigint> {
  const { value } = await rpc.getBalance(owner, { commitment: "confirmed" }).send();
  return value;
}

/** Sum of the owner's token-account balances for `mint`, in atomic units, plus the mint decimals. */
export async function fetchTokenAtomic(owner: Address, mint: Address): Promise<{ atomic: bigint; decimals: number }> {
  const { value } = await rpc
    .getTokenAccountsByOwner(owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" })
    .send();
  let atomic = 0n;
  let decimals = 6;
  for (const acct of value) {
    const info = acct.account.data.parsed.info as { tokenAmount: { amount: string; decimals: number } };
    atomic += BigInt(info.tokenAmount.amount);
    decimals = info.tokenAmount.decimals;
  }
  return { atomic, decimals };
}

export type AirdropResult =
  | { status: "ok"; signature: string }
  | { status: "rate_limited" | "faucet_dry" | "error"; reason: string };

/** Devnet SOL via requestAirdrop. Surfaces faucet 429 / dry-faucet errors honestly. */
export async function requestDevnetAirdrop(owner: Address): Promise<AirdropResult> {
  try {
    const signature = await rpc.requestAirdrop(owner, lamports(AIRDROP_LAMPORTS), { commitment: "confirmed" }).send();
    return { status: "ok", signature };
  } catch (err) {
    const text = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
    if (/429|too many|rate/i.test(text)) {
      return { status: "rate_limited", reason: "Devnet faucet rate limit reached (429). Try the web faucet or wait a few hours." };
    }
    if (/410|dry|limit.*reached|airdrop.*(unavailable|disabled)/i.test(text)) {
      return { status: "faucet_dry", reason: "The RPC airdrop is unavailable right now (410). Use the web faucet." };
    }
    return { status: "error", reason: text.slice(0, 200) || "Airdrop failed" };
  }
}

/** Formats an atomic bigint with `decimals` places, trimmed to `shown` fractional digits. No floats. */
export function formatAtomic(atomic: bigint, decimals: number, shown: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = atomic / base;
  const frac = (atomic % base).toString().padStart(decimals, "0").slice(0, shown);
  return shown > 0 ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}
