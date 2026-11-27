import { NextResponse } from "next/server";
import { isAddress } from "@solana/kit";
import devnetProof from "@/data/devnet-proof.json";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? devnetProof.clusters.solanaDevnetRpc;

async function rpcCall<T>(
  method: string,
  params: unknown[],
): Promise<{ result?: T; error?: { code?: number; message?: string } }> {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!res.ok) {
      return { error: { code: res.status, message: `HTTP ${res.status}` } };
    }
    return (await res.json()) as {
      result?: T;
      error?: { code?: number; message?: string };
    };
  } catch (err) {
    return {
      error: {
        message: err instanceof Error ? err.message : "RPC timeout",
      },
    };
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let wallet = devnetProof.accounts.relayerWallet;
  let amountUsdcAtomic = "100000000";
  let requestDevnetSol = false;

  try {
    const body = (await req.json()) as {
      wallet?: unknown;
      amountUsdcAtomic?: unknown;
      requestDevnetSol?: unknown;
    };
    if (typeof body.wallet === "string" && isAddress(body.wallet.trim())) {
      wallet = body.wallet.trim();
    }
    if (
      typeof body.amountUsdcAtomic === "string" &&
      /^[0-9]+$/.test(body.amountUsdcAtomic)
    ) {
      amountUsdcAtomic = body.amountUsdcAtomic;
    }
    if (body.requestDevnetSol === true) {
      requestDevnetSol = true;
    }
  } catch {
    // Empty body uses defaults
  }

  // 1. Query real live Devnet SOL balance and SPL balance for this wallet
  const [balRes, splRes] = await Promise.all([
    rpcCall<{ value: number }>("getBalance", [
      wallet,
      { commitment: "confirmed" },
    ]),
    rpcCall<{
      value: Array<{
        pubkey: string;
        account: {
          data: {
            parsed?: {
              info?: {
                mint?: string;
                tokenAmount?: { amount?: string; uiAmountString?: string };
              };
            };
          };
        };
      }>;
    }>("getTokenAccountsByOwner", [
      wallet,
      { mint: devnetProof.accounts.splMint },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]),
  ]);

  let lamports = balRes.result?.value ?? 0;
  const splTokenAccount = splRes.result?.value?.[0]?.pubkey ?? null;
  const splBalanceAtomic =
    splRes.result?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount
      ?.amount ?? "0";

  // 2. Attempt real Solana Devnet SOL airdrop if requested (never synthesize fake signatures!)
  let airdropSignature: string | null = null;
  let airdropError: string | null = null;

  if (requestDevnetSol) {
    try {
      const drop = await rpcCall<string>("requestAirdrop", [
        wallet,
        500_000_000, // 0.5 SOL
      ]);
      if (typeof drop.result === "string" && drop.result.length >= 64) {
        airdropSignature = drop.result;
        lamports += 500_000_000;
      } else if (drop.error?.message) {
        airdropError = drop.error.message;
      }
    } catch (err) {
      airdropError = err instanceof Error ? err.message : "RPC airdrop failed";
    }
  }

  // 3. If external core-api relayer is explicitly configured, route live SPL minting
  const configuredApi =
    process.env.CARTRIDGEFI_API_URL ?? process.env.NEXT_PUBLIC_CORE_API_URL;
  if (configuredApi) {
    try {
      const upstream = await fetch(`${configuredApi}/v1/cashier/devnet-faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet,
          amount_usdc_atomic: Number(amountUsdcAtomic),
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (upstream.ok) {
        const data = (await upstream.json()) as {
          txSignature?: string;
          tx_signature?: string;
        };
        const realSig = data.txSignature ?? data.tx_signature ?? null;
        return NextResponse.json({
          status: "credited_onchain",
          routedVia: "cartridge-core-api",
          wallet,
          mint: devnetProof.accounts.splMint,
          amountUsdcAtomic,
          onchainLamports: lamports.toString(),
          onchainSplAtomic: splBalanceAtomic,
          splTokenAccount,
          txSignature: realSig,
          solscanTxUrl: realSig
            ? `https://solscan.io/tx/${realSig}?cluster=devnet`
            : null,
        });
      }
    } catch {
      // Fall through to honest paper session margin + real Devnet balance report
    }
  }

  return NextResponse.json({
    status: airdropSignature ? "devnet_sol_airdropped" : "paper_session_funded",
    routedVia: airdropSignature
      ? "solana-devnet-rpc"
      : "client-paper-margin",
    wallet,
    mint: devnetProof.accounts.splMint,
    amountUsdcAtomic,
    onchainLamports: lamports.toString(),
    onchainSplAtomic: splBalanceAtomic,
    splTokenAccount,
    txSignature: airdropSignature,
    solscanTxUrl: airdropSignature
      ? `https://solscan.io/tx/${airdropSignature}?cluster=devnet`
      : null,
    airdropError,
  });
}
