/**
 * Solana devnet JSON-RPC endpoints (isomorphic: browser probes and server routes).
 *
 * Primary: MagicBlock's devnet base-layer RPC. Verified 2026-11-27 to serve getSlot, getBalance,
 * getAccountInfo, getMultipleAccounts, getSignaturesForAddress, getTransaction, getLatestBlockhash,
 * getSignatureStatuses, getTokenAccountBalance, sendTransaction and simulateTransaction, with CORS for
 * our origins. A 40-request burst got 40×200, while the public endpoint returned 11×429.
 * Fallback: the public Solana devnet RPC, used when the primary fails at the HTTP level (429, 5xx, any
 * non-2xx), on network errors or on timeout. JSON-RPC error bodies are returned, never retried.
 */
export const DEVNET_RPC_PRIMARY = "https://rpc.magicblock.app/devnet";
export const DEVNET_RPC_FALLBACK = "https://api.devnet.solana.com";

/**
 * POSTs one JSON-RPC request to `primary` (default MagicBlock), moving on to MagicBlock and then the public
 * devnet RPC when an endpoint fails at the HTTP / network level. Returns the parsed JSON body and the endpoint that answered.
 */
export async function devnetRpcFetch<T = unknown>(
  method: string,
  params: unknown[] = [],
  opts: { primary?: string; timeoutMs?: number } = {},
): Promise<{ body: { result?: T; error?: { code?: number; message?: string } }; endpoint: string }> {
  // Configured endpoint first, then MagicBlock, then public devnet (deduped).
  const endpoints = [...new Set([opts.primary ?? DEVNET_RPC_PRIMARY, DEVNET_RPC_PRIMARY, DEVNET_RPC_FALLBACK])];
  let lastError: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
        cache: "no-store",
      });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return { body: (await res.json()) as { result?: T; error?: { code?: number; message?: string } }, endpoint };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("devnet RPC unreachable");
}
