// Server-only: MagicBlock Private Ephemeral Rollup (TEE) transport for relayer-built transactions.
// The TEE auth token is minted for the relayer key and never leaves this module: it is not returned
// to clients and never appears in explorer links.
import "server-only";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getRelayerSigner } from "./config";

/** Devnet Private ER (Intel TDX TEE). Reads of permissioned accounts need a member's auth token. */
export const MAGICBLOCK_TEE_URL = (process.env.MAGICBLOCK_TEE_URL ?? "https://devnet-tee.magicblock.app").replace(/\/+$/, "");
/** Identity of the devnet TEE validator (`getIdentity` on MAGICBLOCK_TEE_URL); delegation target for Borel rooms. */
export const MAGICBLOCK_TEE_VALIDATOR = process.env.MAGICBLOCK_TEE_VALIDATOR ?? "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";

const ER_CONFIRM_TIMEOUT_MS = 20_000;
const ER_CONFIRM_POLL_MS = 250;
/** Refresh the cached token this long before its stated expiry. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

export class ErTxError extends Error {
  constructor(
    message: string,
    readonly signature?: string,
  ) {
    super(message);
  }
}

/** Explorer link for an ER transaction. Before unseal the TEE redacts a private stance's instructions and logs. */
export function erExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(MAGICBLOCK_TEE_URL)}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

async function mintToken(): Promise<string> {
  const signer = await getRelayerSigner();
  const challengeRes = await fetch(`${MAGICBLOCK_TEE_URL}/auth/challenge?pubkey=${signer.address}`, { cache: "no-store" });
  const challengeJson = (await challengeRes.json()) as { challenge?: string; error?: string };
  if (!challengeJson.challenge) throw new ErTxError(`TEE auth challenge failed: ${challengeJson.error ?? challengeRes.status}`);
  const signature = await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(challengeJson.challenge));
  const loginRes = await fetch(`${MAGICBLOCK_TEE_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pubkey: signer.address, challenge: challengeJson.challenge, signature: getBase58Decoder().decode(signature) }),
    cache: "no-store",
  });
  const loginJson = (await loginRes.json()) as { token?: string; expiresAt?: number; error?: string };
  if (loginRes.status !== 200 || !loginJson.token) throw new ErTxError(`TEE auth login failed: ${loginJson.error ?? loginRes.status}`);
  const expiresAt = typeof loginJson.expiresAt === "number" ? loginJson.expiresAt : Date.now() + 24 * 60 * 60_000;
  cachedToken = { token: loginJson.token, expiresAt };
  return loginJson.token;
}

async function relayerToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cachedToken.token;
  pendingToken ??= mintToken().finally(() => {
    pendingToken = null;
  });
  return pendingToken;
}

interface JsonRpcReply<T> {
  result?: T;
  error?: { code: number; message: string };
}

/** JSON-RPC call to the TEE as the relayer (a member of every Borel stance permission). */
export async function erRpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = await relayerToken(attempt > 0);
    const res = await fetch(`${MAGICBLOCK_TEE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) continue;
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    const body = (await res.json()) as JsonRpcReply<T>;
    if (body.error) throw new ErTxError(`TEE ${method} failed (${body.error.code}): ${body.error.message.slice(0, 500)}`);
    return body.result as T;
  }
  throw new ErTxError(`TEE ${method} failed after re-authentication`);
}

export interface ErAccount {
  owner: string;
  data: Uint8Array;
}

/** Reads accounts on the TEE with the relayer's token (permissioned stances are visible to the relayer only). */
export async function fetchErAccounts(addresses: readonly Address[]): Promise<(ErAccount | null)[]> {
  if (addresses.length === 0) return [];
  const out: (ErAccount | null)[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const res = await erRpc<{ value: ({ owner: string; data: [string, string] } | null)[] }>("getMultipleAccounts", [
      chunk,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    for (const acc of res.value) out.push(acc ? { owner: acc.owner, data: new Uint8Array(Buffer.from(acc.data[0], "base64")) } : null);
  }
  return out;
}

/** getProgramAccounts on the TEE (relayer token), used to find stances that joined a room outside the registry. */
export async function erProgramAccounts(program: Address, memcmpOffset: number, memcmpBytes: string): Promise<{ pubkey: Address; data: Uint8Array }[]> {
  const res = await erRpc<{ pubkey: Address; account: { data: [string, string] } }[]>("getProgramAccounts", [
    program,
    { encoding: "base64", commitment: "confirmed", filters: [{ memcmp: { offset: memcmpOffset, bytes: memcmpBytes } }] },
  ]);
  return res.map((r) => ({ pubkey: r.pubkey, data: new Uint8Array(Buffer.from(r.account.data[0], "base64")) }));
}

export interface ConfirmedErTx {
  signature: string;
  slot: number;
}

/**
 * Signs and sends one transaction to the TEE and waits for it to execute. ER transactions cost
 * 0 lamports, so the relayer as fee payer spends nothing; `extraSigners` (e.g. a per-room stance
 * session key) are attached by address.
 */
export async function sendErTransaction(
  feePayer: KeyPairSigner,
  instructions: readonly Instruction[],
  extraSigners: readonly KeyPairSigner[] = [],
): Promise<ConfirmedErTx> {
  const { value: bh } = await erRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  const signerByAddress = new Map<string, KeyPairSigner>([feePayer, ...extraSigners].map((s) => [s.address, s]));
  const withSigners = instructions.map((ix) => ({
    ...ix,
    accounts: ix.accounts?.map((meta) => {
      const signer = signerByAddress.get(meta.address);
      return signer && (meta.role === 2 || meta.role === 3) ? { ...meta, signer } : meta;
    }),
  })) as Instruction[];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: bh.blockhash as Blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) },
        m,
      ),
    (m) => appendTransactionMessageInstructions(withSigners, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  // Preflight stays on: on the ER it executes the transaction and returns its error synchronously.
  await erRpc<string>("sendTransaction", [getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }]).catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already been processed")) throw new ErTxError(msg, signature);
    },
  );
  const deadline = Date.now() + ER_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await erRpc<{ value: ({ slot: number; err: unknown } | null)[] }>("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ]);
    const status = value[0];
    if (status) {
      if (status.err) throw new ErTxError(`ER transaction ${signature} failed: ${JSON.stringify(status.err)}`, signature);
      return { signature, slot: Number(status.slot) };
    }
    await new Promise((r) => setTimeout(r, ER_CONFIRM_POLL_MS));
  }
  throw new ErTxError(`Timed out waiting for ER transaction ${signature}`, signature);
}

/** Unix seconds on the TEE (Clock sysvar). */
export async function erUnixTimestamp(): Promise<number> {
  const [clock] = await fetchErAccounts(["SysvarC1ock11111111111111111111111111111111" as Address]);
  if (!clock || clock.data.length < 40) return Math.floor(Date.now() / 1000);
  return Number(new DataView(clock.data.buffer, clock.data.byteOffset, clock.data.byteLength).getBigInt64(32, true));
}
