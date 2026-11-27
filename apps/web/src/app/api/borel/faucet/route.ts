import { z } from "zod";
import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  isAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
import { bigintJson } from "@/lib/borel/server-api";
import { BOREL_DEPLOYMENT } from "@/lib/borel/deployment";
import {
  RELAYER_BALANCE_FLOOR_LAMPORTS,
  getRelayerRpc,
  getRelayerSigner,
  isRelayerConfigured,
  solscanTxUrl,
} from "@/lib/relayer/config";
import { clientIpFromRequest } from "@/lib/relayer/rate-limit";
import { RelayerTxError, signSendAndConfirm } from "@/lib/relayer/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

/** 100 test-USDC (6 decimals) per drip. */
const DRIP_UNITS = 100_000_000n;
/** One drip per wallet address every 10 minutes; at most 5 drips per IP per 10 minutes. */
const WINDOW_MS = 10 * 60_000;
const MAX_PER_ADDRESS = 1;
const MAX_PER_IP = 5;
const MAX_TRACKED_KEYS = 5_000;

const hits = new Map<string, number[]>();

function takeSlot(key: string, max: number, now: number): number {
  const recent = (hits.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil(((recent[0] ?? now) + WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED_KEYS) {
    for (const [k, times] of hits) if (times.every((t) => t <= now - WINDOW_MS)) hits.delete(k);
  }
  return 0;
}

function releaseSlot(key: string): void {
  const recent = hits.get(key);
  if (recent && recent.length > 0) recent.pop();
}

const FaucetSchema = z.object({
  wallet: z
    .string()
    .trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "wallet must be a base58 Solana address")
    .refine((v) => isAddress(v), "wallet must be a valid Solana address"),
});

const addressEncoder = getAddressEncoder();

async function deriveAta(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [addressEncoder.encode(owner), addressEncoder.encode(TOKEN_PROGRAM_ID), addressEncoder.encode(mint)],
  });
  return ata;
}

function createAtaIdempotentIx(payer: Address, ata: Address, owner: Address, mint: Address): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  };
}

function mintToIx(mint: Address, destination: Address, authority: Address, amount: bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 7; // MintTo
  new DataView(data.buffer).setBigUint64(1, amount, true);
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}

/**
 * POST /api/borel/faucet  { wallet: string }
 * Mints 100 Borel test-USDC to the wallet's ATA (created if missing). Relayer pays all fees.
 */
export async function POST(req: Request) {
  if (!isRelayerConfigured()) {
    return bigintJson({ status: "error", reason: "Relayer is not configured on this deployment" }, 503);
  }
  const parsed = FaucetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bigintJson({ status: "error", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  const wallet = address(parsed.data.wallet);
  const now = Date.now();
  const ipKey = `borel-faucet-ip:${clientIpFromRequest(req)}`;
  const addrKey = `borel-faucet-addr:${wallet}`;
  const addrWait = takeSlot(addrKey, MAX_PER_ADDRESS, now);
  if (addrWait > 0) {
    return rateLimited(`This wallet was funded recently — retry in ${addrWait}s`, addrWait);
  }
  const ipWait = takeSlot(ipKey, MAX_PER_IP, now);
  if (ipWait > 0) {
    releaseSlot(addrKey);
    return rateLimited(`Too many faucet requests from this IP — retry in ${ipWait}s`, ipWait);
  }

  try {
    const signer = await getRelayerSigner();
    if (signer.address !== BOREL_DEPLOYMENT.authority) {
      throw new Error("Configured relayer is not the test-USDC mint authority");
    }
    const rpc = getRelayerRpc();
    const { value: lamports } = await rpc.getBalance(signer.address, { commitment: "confirmed" }).send();
    if (lamports < RELAYER_BALANCE_FLOOR_LAMPORTS) {
      throw new Error("Relayer balance is below the operating floor");
    }
    const mint = address(BOREL_DEPLOYMENT.testUsdcMint);
    const tokenAccount = await deriveAta(wallet, mint);
    const tx = await signSendAndConfirm(
      signer,
      [createAtaIdempotentIx(signer.address, tokenAccount, wallet, mint), mintToIx(mint, tokenAccount, signer.address, DRIP_UNITS)],
      [signer],
    );
    const { value: balance } = await rpc.getTokenAccountBalance(tokenAccount, { commitment: "confirmed" }).send();
    return bigintJson({
      status: "ok",
      wallet,
      mint,
      tokenAccount,
      decimals: BOREL_DEPLOYMENT.testUsdcDecimals,
      amountUnits: DRIP_UNITS,
      balanceUnits: balance.amount,
      signature: tx.signature,
      solscanTxUrl: solscanTxUrl(tx.signature),
    });
  } catch (err) {
    releaseSlot(addrKey);
    releaseSlot(ipKey);
    const reason = err instanceof RelayerTxError || err instanceof Error ? err.message.slice(0, 300) : "Faucet failed";
    return bigintJson({ status: "error", reason }, 502);
  }
}

function rateLimited(reason: string, retryAfterSecs: number) {
  const res = bigintJson({ status: "error", reason, retryAfterSecs }, 429);
  res.headers.set("retry-after", String(retryAfterSecs));
  return res;
}
