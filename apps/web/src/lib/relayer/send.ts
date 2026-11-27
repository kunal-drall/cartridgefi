// Server-only: compile, sign, send and confirm relayer transactions on Solana Devnet.
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { getRelayerRpc } from "./config";
import { sweepTransferIx } from "./actions";

const CONFIRM_TIMEOUT_MS = 45_000;
const CONFIRM_POLL_MS = 600;

export class RelayerTxError extends Error {
  constructor(
    message: string,
    readonly logs: readonly string[] = [],
  ) {
    super(message);
  }
}

async function latestBlockhash() {
  const { value } = await getRelayerRpc().getLatestBlockhash({ commitment: "confirmed" }).send();
  return value;
}

export interface ConfirmedRelayerTx {
  signature: string;
  slot: number;
}

export async function signSendAndConfirm(
  feePayer: KeyPairSigner,
  instructions: Instruction[],
  extraSigners: KeyPairSigner[],
): Promise<ConfirmedRelayerTx> {
  const rpc = getRelayerRpc();
  const blockhash = await latestBlockhash();

  // Attach extra signers by address so kit can collect them from account metas.
  const signerByAddress = new Map<string, KeyPairSigner>(extraSigners.map((s) => [s.address, s]));
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
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(withSigners, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);

  try {
    await rpc
      .sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3n })
      .send();
  } catch (err) {
    const logs = extractLogs(err);
    throw new RelayerTxError(describeRpcError(err), logs);
  }

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new RelayerTxError(`Transaction ${signature} failed on-chain: ${JSON.stringify(status.err, bigintReplacer)}`);
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return { signature, slot: Number(status.slot) };
      }
    }
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
  }
  throw new RelayerTxError(`Timed out waiting for confirmation of ${signature}`);
}

export interface SimulationResult {
  ok: boolean;
  err: unknown;
  logs: readonly string[];
  unitsConsumed: number | null;
  feePayer: string;
  wireBytes: number;
}

/** sigVerify:false + replaceRecentBlockhash:true dry-run; signatures are left empty. */
export async function simulateUnsigned(
  feePayer: Address,
  instructions: Instruction[],
  extraSigners: KeyPairSigner[],
): Promise<SimulationResult> {
  const rpc = getRelayerRpc();
  const blockhash = await latestBlockhash();
  const signerByAddress = new Map<string, KeyPairSigner>(extraSigners.map((s) => [s.address, s]));
  const withSigners = instructions.map((ix) => ({
    ...ix,
    accounts: ix.accounts?.map((meta) => {
      const signer = signerByAddress.get(meta.address);
      return signer && (meta.role === 2 || meta.role === 3) ? { ...meta, signer } : meta;
    }),
  })) as Instruction[];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(withSigners, m),
  );
  const tx =
    extraSigners.length > 0
      ? await partiallySignTransactionMessageWithSigners(message)
      : compileTransaction(message);
  const wire = getBase64EncodedWireTransaction(tx);
  const { value } = await rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    })
    .send();
  return {
    ok: value.err === null,
    err: value.err,
    logs: value.logs ?? [],
    unitsConsumed: value.unitsConsumed === undefined ? null : Number(value.unitsConsumed),
    feePayer,
    wireBytes: Buffer.from(wire, "base64").length,
  };
}

/** Returns leftover lamports from relayer-sponsored ephemeral keys to the relayer. Best-effort. */
export async function sweepEphemeralKeys(
  relayer: KeyPairSigner,
  ephemeral: KeyPairSigner[],
): Promise<string[]> {
  const rpc = getRelayerRpc();
  const swept: string[] = [];
  for (const key of ephemeral) {
    try {
      const { value: balance } = await rpc.getBalance(key.address, { commitment: "confirmed" }).send();
      if (balance <= 0n) continue;
      const result = await signSendAndConfirm(
        relayer,
        [sweepTransferIx(key.address, address(relayer.address), balance)],
        [key],
      );
      swept.push(result.signature);
    } catch {
      // Sweeping is best-effort; leftover dust stays on the ephemeral key.
    }
  }
  return swept;
}

export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function extractLogs(err: unknown): string[] {
  const ctx = (err as { context?: { logs?: unknown } } | null)?.context;
  const cause = (err as { cause?: { context?: { logs?: unknown } } } | null)?.cause?.context;
  const logs = ctx?.logs ?? cause?.logs;
  return Array.isArray(logs) ? logs.filter((l): l is string => typeof l === "string").slice(-25) : [];
}

function describeRpcError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? ` (${cause.message})` : "";
    return `${err.message}${causeMsg}`.slice(0, 600);
  }
  return "Unknown RPC error";
}
