import devnetProof from "@/data/devnet-proof.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVNET_RPC =
  process.env.CARTRIDGEFI_RELAYER_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";
const FEE_ATA = devnetProof.accounts.platformFeeAccountAta;
const CACHE_MS = 30_000;

export interface FeeInflowRow {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: boolean;
  /** Token-balance change of the platformFeeAccount in base units (6 dp), or null if unknown. */
  deltaUnits: string | null;
}

export interface FeeInflowsResponse {
  ok: boolean;
  feeAccount: string;
  balanceUnits: string | null;
  rows: FeeInflowRow[];
  fetchedAtIso: string;
  error?: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`devnet RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "devnet RPC error");
  return json.result as T;
}

interface ParsedTx {
  transaction: { message: { accountKeys: Array<{ pubkey: string } | string> } };
  meta: {
    preTokenBalances?: Array<{ accountIndex: number; uiTokenAmount: { amount: string } }>;
    postTokenBalances?: Array<{ accountIndex: number; uiTokenAmount: { amount: string } }>;
  } | null;
}

const deltaCache = new Map<string, string | null>();
let cached: { expiresAt: number; body: FeeInflowsResponse } | null = null;

async function load(): Promise<FeeInflowsResponse> {
  const [balance, sigs] = await Promise.all([
    rpc<{ value: { amount: string } }>("getTokenAccountBalance", [FEE_ATA, { commitment: "confirmed" }]),
    rpc<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>>(
      "getSignaturesForAddress",
      [FEE_ATA, { limit: 10, commitment: "confirmed" }],
    ),
  ]);

  // Resolve at most 4 new transactions per refresh to stay well inside public RPC limits.
  let budget = 4;
  for (const s of sigs) {
    if (deltaCache.has(s.signature)) continue;
    if (budget === 0) break;
    budget -= 1;
    try {
      const tx = await rpc<ParsedTx | null>("getTransaction", [
        s.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ]);
      let delta: string | null = null;
      if (tx?.meta) {
        const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
        const idx = keys.indexOf(FEE_ATA);
        if (idx >= 0) {
          const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === idx);
          const post = tx.meta.postTokenBalances?.find((b) => b.accountIndex === idx);
          delta = (
            BigInt(post?.uiTokenAmount.amount ?? "0") - BigInt(pre?.uiTokenAmount.amount ?? "0")
          ).toString();
        }
      }
      deltaCache.set(s.signature, delta);
    } catch {
      // Retry this signature on the next refresh.
    }
  }

  return {
    ok: true,
    feeAccount: FEE_ATA,
    balanceUnits: balance.value.amount,
    rows: sigs.map((s) => ({
      signature: s.signature,
      slot: s.slot,
      blockTime: s.blockTime,
      err: s.err !== null,
      deltaUnits: deltaCache.get(s.signature) ?? null,
    })),
    fetchedAtIso: new Date().toISOString(),
  };
}

/** Live platformFeeAccount balance and recent inflows (devnet RPC, cached 30s server-side). */
export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.body, { headers: { "cache-control": "no-store" } });
  }
  try {
    const body = await load();
    cached = { expiresAt: now + CACHE_MS, body };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const body: FeeInflowsResponse = cached?.body ?? {
      ok: false,
      feeAccount: FEE_ATA,
      balanceUnits: null,
      rows: [],
      fetchedAtIso: new Date().toISOString(),
    };
    return Response.json(
      { ...body, error: err instanceof Error ? err.message : "devnet RPC unavailable" },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
