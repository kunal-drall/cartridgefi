/**
 * CartridgeFi Protocol — MagicBlock Blitz v10 Full On-Chain Proof Harness
 *
 * STRICT NON-SIMULATION MODE (`CARTRIDGEFI_STANDALONE_DEV=false`):
 * Generates deterministic, verifiable on-chain transactions across all 3 `build.magicblock.app`
 * scoring categories against `https://api.devnet.solana.com`, `https://devnet-router.magicblock.app`,
 * `https://devnet-tee.magicblock.app`, and `https://payments.magicblock.app`:
 *
 *   1. Program Delegations, 6x Real-Time Session Updates & Live VRF:
 *      - Configures `EngineConfig.platform_fee_account` to an explicit canonical SPL Associated Token
 *        Account (`ATA(platformFeeOwner, usdcMint)`).
 *      - Creates a fresh `RoomShard` (`cartridge_er_room`) + `RoomVault` (`cartridge_vault_router`),
 *        opens 2 player `SessionRiskEnvelope`s, and delegates `RoomShard` + 2 `PlayerStance` PDAs to
 *        `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`.
 *      - Executes 6 real-time zero-popup session-key state updates (`submit_stance` x3 per player)
 *        + `join_room_and_init_permission` (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`) on the
 *        Ephemeral Rollup via `https://devnet-router.magicblock.app`.
 *      - Requests & fulfills live asynchronous MagicBlock VRF (`Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`
 *        on `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc`).
 *      - Unseals Showdown permissions, evaluates deterministic `i128` (`10^9`) scores against live
 *        MagicBlock Pricing Oracle (`PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`), commits &
 *        undelegates back to Solana Devnet L1 via `MagicIntentBundleBuilder`, distributes pool &
 *        protocol fees into `platformFeeAccount`, claims winner payout, and records Market ELO.
 *
 *   2. Relayer Private Payments, TEE Auth & `platformFeeAccount` (`SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2`):
 *      - Authenticates the Relayer wallet against `https://devnet-tee.magicblock.app` (`getAuthToken`)
 *        and `https://payments.magicblock.app` (`cluster: "devnet-private"`).
 *      - Delegates SPL balance from the Relayer wallet to Private ER TEE (`MTEWGuqx...`) using SDK
 *        `delegateSpl`.
 *      - Executes 3 encrypted private relayer transfers (`visibility: "private"`, `cluster: "devnet-private"`,
 *        `platformFeeBps: 100`) paying token fees directly into `platformFeeAccount` canonical ATA,
 *        plus an in-TEE private SDK `transferSpl` (`ephemeral -> ephemeral`) on `devnet-tee.magicblock.app`.
 *      - Executes SDK `withdrawSpl` back to Solana Devnet L1.
 *
 *   3. Proof Artifacts:
 *      - Writes `docs/DEVNET_PROOF.md` and `apps/web/src/data/devnet-proof.json`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  delegateSpl,
  deriveEphemeralAta,
  deriveRentPda,
  deriveVault,
  getAuthToken,
  transferSpl,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-kit";

import { CARTRIDGE_DEVNET_AUTHORITIES } from "@cartridgefi/shared-types";
import {
  CARTRIDGE_PROGRAM_IDS,
  cartridgeErRoom,
  cartridgePassport,
  cartridgeRegistry,
  cartridgeVaultRouter,
} from "@cartridgefi/codama-clients";

if (process.env.CARTRIDGEFI_STANDALONE_DEV === "true") {
  throw new Error(
    "FATAL: CARTRIDGEFI_STANDALONE_DEV=true is forbidden in prove-magicblock-blitz.ts.",
  );
}
process.env.CARTRIDGEFI_STANDALONE_DEV = "false";

const PRIMARY_DEVNET_RPC =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const FALLBACK_DEVNET_RPC = "https://rpc.magicblock.app/devnet";
const MAGICBLOCK_ROUTER_RPC =
  process.env.MAGICBLOCK_ROUTER_URL ?? "https://devnet-router.magicblock.app";
const MAGICBLOCK_TEE_RPC =
  process.env.MAGICBLOCK_TEE_URL ?? "https://devnet-tee.magicblock.app";
const MAGICBLOCK_PAYMENTS_API =
  process.env.MAGICBLOCK_PAYMENTS_URL ?? "https://payments.magicblock.app";

const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DELEGATION_PROGRAM_ID = address(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const PERMISSION_PROGRAM_ID = address(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
);
const VRF_PROGRAM_ID = address("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const DEFAULT_EPHEMERAL_QUEUE = address(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);
const LIVE_ER_SOL_USD_ORACLE = address(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
);

const MINT_SPACE = 82n;
const TOKEN_ACCOUNT_SPACE = 165n;
const BETA_MAX_ROOM_POOL_USDC = 500_000_000n;
const BETA_MAX_GLOBAL_TVL_USDC = 5_000_000_000n;
const SCALE_9 = 1_000_000_000n;
const RELAYER_PLATFORM_FEE_BPS = 100; // 1.00% token fee into platformFeeAccount ATA

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface AccountInfoResult {
  value: {
    data: [string, string];
    executable: boolean;
    lamports: number;
    owner: string;
    rentEpoch: number;
    space: number;
  } | null;
}

interface BlockhashValue {
  blockhash: string;
  lastValidBlockHeight: number;
}

interface RouterRouteEntry {
  identity: string;
  fqdn: string;
  baseFee: number;
  blockTimeMs: number;
  countryCode: string;
}

type ProofCategory =
  | "delegation_and_vrf"
  | "private_payments_and_fees"
  | "l1_settlement";

interface RecordedProofTx {
  step: string;
  category: ProofCategory;
  layer: "Solana Devnet L1" | "MagicBlock ER" | "MagicBlock Private ER (TEE)";
  signature: string;
  endpoint: string;
  solscanUrl: string;
  notes: string;
}

interface PaymentsTransferResponse {
  kind: string;
  version: string;
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  sendRpcEndpoint?: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
  fees?: {
    lamports: string;
    tokens: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const base58Decoder = getBase58Decoder();
const txDecoder = getTransactionDecoder();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256Bytes(input: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(input, "utf8").digest());
}

function padUri96(uri: string): Uint8Array {
  const out = new Uint8Array(96);
  const raw = Buffer.from(uri, "utf8");
  out.set(raw.subarray(0, Math.min(96, raw.length)), 0);
  return out;
}

function solscanTxUrl(sig: string, customRpc?: string): string {
  if (customRpc) {
    return `https://solscan.io/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(customRpc)}`;
  }
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

function solscanAccountUrl(addr: string): string {
  return `https://solscan.io/account/${addr}?cluster=devnet`;
}

async function deriveCanonicalAta(
  owner: Address,
  mint: Address,
): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(TOKEN_PROGRAM_ID),
      addressEncoder.encode(mint),
    ],
  });
  return ata;
}

function ixCreateAssociatedTokenAccountIdempotent(
  payer: KeyPairSigner,
  ata: Address,
  owner: Address,
  mint: Address,
): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      {
        address: payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: payer,
      } as never,
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]), // CreateIdempotent
  };
}

function attachSignersToInstructions(
  instructions: readonly Instruction[],
  signers: readonly KeyPairSigner[],
): Instruction[] {
  const map = new Map<string, KeyPairSigner>();
  for (const s of signers) {
    map.set(s.address, s);
  }
  return instructions.map((ix) => ({
    programAddress: ix.programAddress,
    data: ix.data,
    accounts: (ix.accounts ?? []).map((meta) => {
      const signer = map.get(meta.address);
      if (
        signer &&
        (meta.role === AccountRole.WRITABLE_SIGNER ||
          meta.role === AccountRole.READONLY_SIGNER)
      ) {
        return { ...meta, signer } as never;
      }
      return meta;
    }),
  }));
}

async function rpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown[],
  fallbackEndpoint?: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let lastErr: unknown = null;
  const targets = fallbackEndpoint ? [endpoint, fallbackEndpoint] : [endpoint];

  for (let attempt = 0; attempt < 5; attempt++) {
    const target = targets[attempt % targets.length]!;
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(extraHeaders ?? {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now() + attempt,
          method,
          params,
        }),
      });
      if (res.status === 429) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      const parsed = (await res.json()) as JsonRpcResponse<T>;
      if (parsed.error) {
        throw new Error(
          `RPC ${method} on ${target} failed (${parsed.error.code}): ${parsed.error.message}${
            parsed.error.data ? ` | ${JSON.stringify(parsed.error.data)}` : ""
          }`,
        );
      }
      return parsed.result as T;
    } catch (err) {
      lastErr = err;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function getAccountBuffer(
  endpoint: string,
  pubkey: Address,
  fallbackEndpoint?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ owner: Address; lamports: bigint; data: Buffer } | null> {
  const res = await rpcCall<AccountInfoResult>(
    endpoint,
    "getAccountInfo",
    [pubkey, { encoding: "base64", commitment: "confirmed" }],
    fallbackEndpoint,
    extraHeaders,
  );
  if (!res.value) {
    return null;
  }
  return {
    owner: address(res.value.owner),
    lamports: BigInt(res.value.lamports),
    data: Buffer.from(res.value.data[0], "base64"),
  };
}

async function getTokenAccountBalance(
  endpoint: string,
  tokenAccount: Address,
): Promise<bigint> {
  const info = await getAccountBuffer(
    endpoint,
    tokenAccount,
    FALLBACK_DEVNET_RPC,
  );
  if (!info || info.data.length < 72) {
    throw new Error(`Token account ${tokenAccount} not found or invalid`);
  }
  return info.data.readBigUInt64LE(64);
}

async function getChainUnixTimestamp(endpoint: string): Promise<bigint> {
  const SYSVAR_CLOCK = address("SysvarC1ock11111111111111111111111111111111");
  const clockAcc = await getAccountBuffer(
    endpoint,
    SYSVAR_CLOCK,
    FALLBACK_DEVNET_RPC,
  );
  if (clockAcc && clockAcc.data.length >= 40) {
    return clockAcc.data.readBigInt64LE(32);
  }
  return BigInt(Math.floor(Date.now() / 1000));
}

function ixSystemCreateAccount(
  payer: KeyPairSigner,
  newAccount: KeyPairSigner,
  lamports: bigint,
  space: bigint,
  ownerProgram: Address,
): Instruction {
  const data = Buffer.alloc(52);
  data.writeUInt32LE(0, 0);
  data.writeBigUInt64LE(lamports, 4);
  data.writeBigUInt64LE(space, 12);
  Buffer.from(addressEncoder.encode(ownerProgram)).copy(data, 20);
  return {
    programAddress: SYSTEM_PROGRAM_ID,
    accounts: [
      {
        address: payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: payer,
      } as never,
      {
        address: newAccount.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: newAccount,
      } as never,
    ],
    data: new Uint8Array(data),
  };
}

function ixSystemTransfer(
  from: KeyPairSigner,
  to: Address,
  lamports: bigint,
): Instruction {
  const data = Buffer.alloc(12);
  data.writeUInt32LE(2, 0);
  data.writeBigUInt64LE(lamports, 4);
  return {
    programAddress: SYSTEM_PROGRAM_ID,
    accounts: [
      {
        address: from.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: from,
      } as never,
      { address: to, role: AccountRole.WRITABLE },
    ],
    data: new Uint8Array(data),
  };
}

function ixInitializeMint2(
  mint: Address,
  decimals: number,
  mintAuthority: Address,
): Instruction {
  const data = Buffer.alloc(35);
  data.writeUInt8(20, 0);
  data.writeUInt8(decimals, 1);
  Buffer.from(addressEncoder.encode(mintAuthority)).copy(data, 2);
  data.writeUInt8(0, 34);
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [{ address: mint, role: AccountRole.WRITABLE }],
    data: new Uint8Array(data),
  };
}

function ixInitializeAccount3(
  tokenAccount: Address,
  mint: Address,
  owner: Address,
): Instruction {
  const data = Buffer.alloc(33);
  data.writeUInt8(18, 0);
  Buffer.from(addressEncoder.encode(owner)).copy(data, 1);
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: tokenAccount, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };
}

function ixMintTo(
  mint: Address,
  destination: Address,
  mintAuthority: KeyPairSigner,
  amount: bigint,
): Instruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(7, 0);
  data.writeBigUInt64LE(amount, 1);
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      {
        address: mintAuthority.address,
        role: AccountRole.READONLY_SIGNER,
        signer: mintAuthority,
      } as never,
    ],
    data: new Uint8Array(data),
  };
}

async function confirmBaseSignature(sig: string, label: string): Promise<void> {
  for (let i = 0; i < 45; i++) {
    await sleep(600);
    const st = await rpcCall<{
      value: Array<{
        confirmationStatus?: string;
        err: unknown;
      } | null>;
    }>(
      PRIMARY_DEVNET_RPC,
      "getSignatureStatuses",
      [[sig], { searchTransactionHistory: true }],
      FALLBACK_DEVNET_RPC,
    );
    const entry = st.value[0];
    if (entry) {
      if (entry.err) {
        throw new Error(
          `[${label}] Base L1 tx ${sig} failed: ${JSON.stringify(entry.err)}`,
        );
      }
      if (
        entry.confirmationStatus === "confirmed" ||
        entry.confirmationStatus === "finalized"
      ) {
        return;
      }
    }
  }
  throw new Error(`[${label}] Timed out confirming Base L1 tx ${sig}`);
}

async function sendAndConfirmBaseTx(
  feePayer: KeyPairSigner,
  instructions: readonly Instruction[],
  label: string,
): Promise<string> {
  const bhRes = await rpcCall<{ value: BlockhashValue }>(
    PRIMARY_DEVNET_RPC,
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
    FALLBACK_DEVNET_RPC,
  );
  const lifetime = {
    blockhash: bhRes.value.blockhash as never,
    lastValidBlockHeight: BigInt(bhRes.value.lastValidBlockHeight),
  };

  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  const wireBase64 = getBase64EncodedWireTransaction(signed);

  try {
    await rpcCall<string>(
      PRIMARY_DEVNET_RPC,
      "sendTransaction",
      [
        wireBase64,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
        },
      ],
      FALLBACK_DEVNET_RPC,
    );
  } catch (err) {
    if (!String(err).includes("already been processed")) {
      throw err;
    }
  }

  await confirmBaseSignature(sig, label);
  console.log(`  ✓ [L1] ${label}: ${sig}`);
  return sig;
}

async function sendAndConfirmErRouterTx(
  feePayer: KeyPairSigner,
  instructions: readonly Instruction[],
  routedAccounts: readonly Address[],
  erValidatorFqdn: string,
  label: string,
): Promise<string> {
  let lifetime: { blockhash: never; lastValidBlockHeight: bigint };
  try {
    const routerBh = await rpcCall<BlockhashValue>(
      MAGICBLOCK_ROUTER_RPC,
      "getBlockhashForAccounts",
      [routedAccounts],
    );
    lifetime = {
      blockhash: routerBh.blockhash as never,
      lastValidBlockHeight: BigInt(routerBh.lastValidBlockHeight),
    };
  } catch {
    const directBh = await rpcCall<{ value: BlockhashValue }>(
      erValidatorFqdn,
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
    );
    lifetime = {
      blockhash: directBh.value.blockhash as never,
      lastValidBlockHeight: BigInt(directBh.value.lastValidBlockHeight),
    };
  }

  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  const wireBase64 = getBase64EncodedWireTransaction(signed);

  try {
    await rpcCall<string>(
      MAGICBLOCK_ROUTER_RPC,
      "sendTransaction",
      [wireBase64, { encoding: "base64", skipPreflight: false }],
      erValidatorFqdn,
    );
  } catch (err) {
    if (!String(err).includes("already been processed")) {
      throw err;
    }
  }

  for (let i = 0; i < 30; i++) {
    await sleep(250);
    const st = await rpcCall<{
      value: Array<{ confirmationStatus?: string; err: unknown } | null>;
    }>(erValidatorFqdn, "getSignatureStatuses", [
      [sig],
      { searchTransactionHistory: true },
    ]);
    const entry = st.value[0];
    if (entry) {
      if (entry.err) {
        throw new Error(
          `[${label}] ER tx ${sig} failed on ${erValidatorFqdn}: ${JSON.stringify(entry.err)}`,
        );
      }
      console.log(`  ✓ [ER] ${label}: ${sig}`);
      return sig;
    }
  }
  throw new Error(`[${label}] Timed out confirming ER tx ${sig}`);
}

async function sendAndConfirmTeeTx(
  feePayer: KeyPairSigner,
  instructions: readonly Instruction[],
  teeAuthToken: string,
  label: string,
): Promise<string> {
  const teeHeaders = { Authorization: `Bearer ${teeAuthToken}` };
  const teeBh = await rpcCall<{ value: BlockhashValue }>(
    MAGICBLOCK_TEE_RPC,
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
    undefined,
    teeHeaders,
  );
  const lifetime = {
    blockhash: teeBh.value.blockhash as never,
    lastValidBlockHeight: BigInt(teeBh.value.lastValidBlockHeight),
  };

  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  const wireBase64 = getBase64EncodedWireTransaction(signed);

  await rpcCall<string>(
    MAGICBLOCK_TEE_RPC,
    "sendTransaction",
    [wireBase64, { encoding: "base64", skipPreflight: false }],
    undefined,
    teeHeaders,
  );

  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const st = await rpcCall<{
      value: Array<{ confirmationStatus?: string; err: unknown } | null>;
    }>(
      MAGICBLOCK_TEE_RPC,
      "getSignatureStatuses",
      [[sig], { searchTransactionHistory: true }],
      undefined,
      teeHeaders,
    );
    const entry = st.value[0];
    if (entry) {
      if (entry.err) {
        throw new Error(
          `[${label}] TEE tx ${sig} failed: ${JSON.stringify(entry.err)}`,
        );
      }
      console.log(`  ✓ [TEE] ${label}: ${sig}`);
      return sig;
    }
  }
  throw new Error(`[${label}] Timed out confirming TEE tx ${sig}`);
}

async function deriveDelegationPdas(
  delegatedAccount: Address,
  ownerProgram: Address,
): Promise<{
  buffer: Address;
  record: Address;
  metadata: Address;
}> {
  const acctBytes = addressEncoder.encode(delegatedAccount);
  const [buffer] = await getProgramDerivedAddress({
    programAddress: ownerProgram,
    seeds: [Buffer.from("buffer"), acctBytes],
  });
  const [record] = await getProgramDerivedAddress({
    programAddress: DELEGATION_PROGRAM_ID,
    seeds: [Buffer.from("delegation"), acctBytes],
  });
  const [metadata] = await getProgramDerivedAddress({
    programAddress: DELEGATION_PROGRAM_ID,
    seeds: [Buffer.from("delegation-metadata"), acctBytes],
  });
  return { buffer, record, metadata };
}

async function loadKeypairFromDisk(path: string): Promise<KeyPairSigner> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(raw));
}

async function authenticatePaymentsPrivateApi(
  relayer: KeyPairSigner,
): Promise<string> {
  const challengeRes = await fetch(
    `${MAGICBLOCK_PAYMENTS_API}/v1/spl/challenge?pubkey=${relayer.address}&cluster=devnet-private`,
  );
  const challengeJson = (await challengeRes.json()) as {
    challenge?: string;
    error?: unknown;
  };
  if (!challengeRes.ok || !challengeJson.challenge) {
    throw new Error(
      `Payments API challenge failed: ${JSON.stringify(challengeJson)}`,
    );
  }
  const sigBytes = await signBytes(
    relayer.keyPair.privateKey,
    new Uint8Array(Buffer.from(challengeJson.challenge, "utf8")),
  );
  const signatureBase58 = base58Decoder.decode(sigBytes);

  const loginRes = await fetch(`${MAGICBLOCK_PAYMENTS_API}/v1/spl/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: relayer.address,
      challenge: challengeJson.challenge,
      signature: signatureBase58,
      cluster: "devnet-private",
    }),
  });
  const loginJson = (await loginRes.json()) as {
    token?: string;
    error?: unknown;
  };
  if (!loginRes.ok || !loginJson.token) {
    throw new Error(`Payments API login failed: ${JSON.stringify(loginJson)}`);
  }
  return loginJson.token;
}

async function main(): Promise<void> {
  const startedAtIso = new Date().toISOString();
  console.log(
    "=== CartridgeFi Protocol — MagicBlock Blitz v10 Full On-Chain Proof Harness ===",
  );
  console.log(`  Solana Devnet RPC:        ${PRIMARY_DEVNET_RPC}`);
  console.log(`  MagicBlock Router RPC:    ${MAGICBLOCK_ROUTER_RPC}`);
  console.log(`  MagicBlock Private TEE:   ${MAGICBLOCK_TEE_RPC}`);
  console.log(`  MagicBlock Payments API:  ${MAGICBLOCK_PAYMENTS_API}`);

  const recordedTxs: RecordedProofTx[] = [];

  const keypairPath =
    process.env.SOLANA_KEYPAIR ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(keypairPath)) {
    throw new Error(`Relayer/Deployer keypair not found at ${keypairPath}`);
  }
  const relayer = await loadKeypairFromDisk(keypairPath);
  const platformFeeOwner = address(CARTRIDGE_DEVNET_AUTHORITIES.koraSponsor);
  console.log(`  Relayer / App Wallet:     ${relayer.address}`);
  console.log(`  Platform Fee Owner:       ${platformFeeOwner}`);

  // Resolve Public ER Route & Private ER TEE Validator Identity
  const routes = await rpcCall<RouterRouteEntry[]>(
    MAGICBLOCK_ROUTER_RPC,
    "getRoutes",
    [],
  );
  const usRoute =
    routes.find((r) => r.fqdn.includes("devnet-us")) ?? routes[0];
  if (!usRoute) {
    throw new Error("MagicBlock Router returned empty routes list");
  }
  const erValidatorPubkey = address(usRoute.identity);
  const erValidatorFqdn = usRoute.fqdn.replace(/\/+$/, "");

  const teeIdentityRes = await rpcCall<{ identity: string }>(
    MAGICBLOCK_TEE_RPC,
    "getIdentity",
    [],
  );
  const teeValidatorPubkey = address(teeIdentityRes.identity);

  console.log(
    `  Public ER Validator:      ${erValidatorPubkey} (${erValidatorFqdn}, ${usRoute.blockTimeMs}ms)`,
  );
  console.log(
    `  Private TEE Validator:    ${teeValidatorPubkey} (${MAGICBLOCK_TEE_RPC})`,
  );

  // Authenticate Relayer against both Direct TEE RPC (`getAuthToken`) & Hosted Private Payments API
  const directTeeAuth = await getAuthToken(
    MAGICBLOCK_TEE_RPC,
    relayer.address,
    async (msg) => signBytes(relayer.keyPair.privateKey, msg),
  );
  const paymentsBearerToken = await authenticatePaymentsPrivateApi(relayer);
  console.log(
    "  ✓ Authenticated Relayer with Intel TDX Private ER TEE (`devnet-tee.magicblock.app` + `payments.magicblock.app`)",
  );

  const registryProgramId = address(CARTRIDGE_PROGRAM_IDS.registry);
  const erRoomProgramId = address(CARTRIDGE_PROGRAM_IDS.erRoom);
  const vaultRouterProgramId = address(CARTRIDGE_PROGRAM_IDS.vaultRouter);
  const passportProgramId = address(CARTRIDGE_PROGRAM_IDS.passport);

  const [engineConfigPda] = await getProgramDerivedAddress({
    programAddress: registryProgramId,
    seeds: [Buffer.from("engine_config")],
  });
  const [passportConfigPda] = await getProgramDerivedAddress({
    programAddress: passportProgramId,
    seeds: [Buffer.from("passport_config")],
  });
  const [vaultRouterAuthPda] = await getProgramDerivedAddress({
    programAddress: vaultRouterProgramId,
    seeds: [Buffer.from("vault_router_auth")],
  });

  const mintRent = BigInt(
    await rpcCall<number>(
      PRIMARY_DEVNET_RPC,
      "getMinimumBalanceForRentExemption",
      [Number(MINT_SPACE)],
      FALLBACK_DEVNET_RPC,
    ),
  );
  const tokenAccountRent = BigInt(
    await rpcCall<number>(
      PRIMARY_DEVNET_RPC,
      "getMinimumBalanceForRentExemption",
      [Number(TOKEN_ACCOUNT_SPACE)],
      FALLBACK_DEVNET_RPC,
    ),
  );

  // =========================================================================
  // PART 1: PROTOCOL CONFIG, CANONICAL `platformFeeAccount` ATA, DELEGATIONS,
  //         6x REAL-TIME SESSION UPDATES, LIVE VRF & L1 SETTLEMENT
  // =========================================================================
  console.log(
    "\n[Part 1] Protocol Config, Canonical platformFeeAccount ATA, Arena Delegation, 6x Session Updates & VRF...",
  );

  let usdcMint: Address;
  let platformFeeAccount: Address;

  const existingEngineCfg = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    engineConfigPda,
    FALLBACK_DEVNET_RPC,
  );

  if (existingEngineCfg && existingEngineCfg.data.length >= 72) {
    const currentFeeAcc = addressDecoder.decode(
      existingEngineCfg.data.subarray(40, 72),
    );
    const feeAccInfo = await getAccountBuffer(
      PRIMARY_DEVNET_RPC,
      currentFeeAcc,
      FALLBACK_DEVNET_RPC,
    );
    if (!feeAccInfo || feeAccInfo.data.length < 32) {
      throw new Error("Existing EngineConfig fee token account missing on Devnet");
    }
    usdcMint = addressDecoder.decode(feeAccInfo.data.subarray(0, 32));
    platformFeeAccount = await deriveCanonicalAta(platformFeeOwner, usdcMint);

    // Ensure canonical ATA exists on Devnet & align EngineConfig.platform_fee_account to it
    const canonicalAtaInfo = await getAccountBuffer(
      PRIMARY_DEVNET_RPC,
      platformFeeAccount,
      FALLBACK_DEVNET_RPC,
    );
    const cfgSetupIxs: Instruction[] = [];
    if (!canonicalAtaInfo) {
      cfgSetupIxs.push(
        ixCreateAssociatedTokenAccountIdempotent(
          relayer,
          platformFeeAccount,
          platformFeeOwner,
          usdcMint,
        ),
      );
    }
    if (currentFeeAcc !== platformFeeAccount) {
      cfgSetupIxs.push(
        cartridgeRegistry.getUpdateEngineConfigInstruction({
          adminMultisig: relayer,
          engineConfig: engineConfigPda,
          newAdminMultisig: null,
          newPlatformFeeAccount: platformFeeAccount,
          privateBetaMode: null,
          maxRoomPoolUsdc: null,
          maxGlobalTvlUsdc: null,
          paused: null,
        }),
      );
    }
    if (cfgSetupIxs.length > 0) {
      const updateCfgSig = await sendAndConfirmBaseTx(
        relayer,
        cfgSetupIxs,
        `Init Canonical platformFeeAccount ATA (${platformFeeAccount}) & Update EngineConfig`,
      );
      recordedTxs.push({
        step: "1a. Init Canonical platformFeeAccount ATA & Bind EngineConfig",
        category: "delegation_and_vrf",
        layer: "Solana Devnet L1",
        signature: updateCfgSig,
        endpoint: PRIMARY_DEVNET_RPC,
        solscanUrl: solscanTxUrl(updateCfgSig),
        notes: `Canonical ATA ${platformFeeAccount} (owner=${platformFeeOwner}, mint=${usdcMint})`,
      });
    } else {
      console.log(
        `  ✓ Canonical platformFeeAccount ATA verified live: ${platformFeeAccount} (mint=${usdcMint})`,
      );
    }
  } else {
    const mintKp = await generateKeyPairSigner();
    usdcMint = mintKp.address;
    platformFeeAccount = await deriveCanonicalAta(platformFeeOwner, usdcMint);

    const initCfgIx =
      await cartridgeRegistry.getInitializeEngineConfigInstructionAsync({
        adminMultisig: relayer,
        platformFeeAccount,
        engineConfig: engineConfigPda,
        privateBetaMode: true,
        maxRoomPoolUsdc: BETA_MAX_ROOM_POOL_USDC,
        maxGlobalTvlUsdc: BETA_MAX_GLOBAL_TVL_USDC,
      });

    const sig = await sendAndConfirmBaseTx(
      relayer,
      [
        ixSystemCreateAccount(
          relayer,
          mintKp,
          mintRent,
          MINT_SPACE,
          TOKEN_PROGRAM_ID,
        ),
        ixInitializeMint2(usdcMint, 6, relayer.address),
        ixCreateAssociatedTokenAccountIdempotent(
          relayer,
          platformFeeAccount,
          platformFeeOwner,
          usdcMint,
        ),
        initCfgIx,
      ],
      "Init Devnet SPL Mint + Canonical platformFeeAccount ATA + EngineConfig",
    );
    recordedTxs.push({
      step: "1a. Init Mint, Canonical platformFeeAccount ATA & EngineConfig",
      category: "delegation_and_vrf",
      layer: "Solana Devnet L1",
      signature: sig,
      endpoint: PRIMARY_DEVNET_RPC,
      solscanUrl: solscanTxUrl(sig),
      notes: `Canonical ATA ${platformFeeAccount} (owner=${platformFeeOwner})`,
    });
  }

  const existingPassportCfg = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    passportConfigPda,
    FALLBACK_DEVNET_RPC,
  );
  if (!existingPassportCfg) {
    const initPassportCfgIx =
      await cartridgePassport.getInitializePassportConfigInstructionAsync({
        admin: relayer,
        passportConfig: passportConfigPda,
        keeperAuthority: relayer.address,
      });
    const sig = await sendAndConfirmBaseTx(
      relayer,
      [initPassportCfgIx],
      "Initialize PassportConfig",
    );
    recordedTxs.push({
      step: "1b. Initialize PassportConfig",
      category: "delegation_and_vrf",
      layer: "Solana Devnet L1",
      signature: sig,
      endpoint: PRIMARY_DEVNET_RPC,
      solscanUrl: solscanTxUrl(sig),
      notes: `PassportConfig PDA ${passportConfigPda}`,
    });
  }

  // Reference Harness #001 (Borel) & #002 (Pulse Runner) Manifests
  const borelSlugHash = sha256Bytes("borel-blind-conviction-blitz-001");
  const runnerSlugHash = sha256Bytes("pulse-runner-volatility-arcade-002");

  const [borelManifestPda] = await getProgramDerivedAddress({
    programAddress: registryProgramId,
    seeds: [Buffer.from("cartridge"), borelSlugHash],
  });
  const [runnerManifestPda] = await getProgramDerivedAddress({
    programAddress: registryProgramId,
    seeds: [Buffer.from("cartridge"), runnerSlugHash],
  });

  let creatorFeeVault: Address;
  const existingBorel = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    borelManifestPda,
    FALLBACK_DEVNET_RPC,
  );
  if (existingBorel && existingBorel.data.length >= 104) {
    creatorFeeVault = addressDecoder.decode(existingBorel.data.subarray(72, 104));
  } else {
    const creatorFeeKp = await generateKeyPairSigner();
    creatorFeeVault = creatorFeeKp.address;
    const regBorelIx =
      await cartridgeRegistry.getRegisterCartridgeInstructionAsync({
        creator: relayer,
        creatorFeeVault,
        engineConfig: engineConfigPda,
        cartridgeManifest: borelManifestPda,
        slugHash: borelSlugHash,
        creatorShareBps: 5000,
        genreCode: 1,
        durationSecs: 45,
        fogOfWarBps: 6000,
        maxRebalances: 8,
        scoringFormula:
          cartridgeRegistry.ScoringFormula.DirectionNeutralRelReturn,
        actionBindingMode:
          cartridgeRegistry.ActionBindingMode.ConvictionWeights,
        allowedFeedsMerkleRoot: new Uint8Array(32).fill(0x11),
        manifestUri: padUri96(
          "https://cartridgefi.com/manifests/borel-001.json",
        ),
      });
    const sig = await sendAndConfirmBaseTx(
      relayer,
      [
        ixSystemCreateAccount(
          relayer,
          creatorFeeKp,
          tokenAccountRent,
          TOKEN_ACCOUNT_SPACE,
          TOKEN_PROGRAM_ID,
        ),
        ixInitializeAccount3(creatorFeeVault, usdcMint, relayer.address),
        regBorelIx,
      ],
      "Register Reference Harness #001 Manifest",
    );
    recordedTxs.push({
      step: "1c. Register Reference Harness #001 Manifest",
      category: "delegation_and_vrf",
      layer: "Solana Devnet L1",
      signature: sig,
      endpoint: PRIMARY_DEVNET_RPC,
      solscanUrl: solscanTxUrl(sig),
      notes: `Manifest PDA ${borelManifestPda}`,
    });
  }

  const existingRunner = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    runnerManifestPda,
    FALLBACK_DEVNET_RPC,
  );
  if (!existingRunner) {
    const regRunnerIx =
      await cartridgeRegistry.getRegisterCartridgeInstructionAsync({
        creator: relayer,
        creatorFeeVault,
        engineConfig: engineConfigPda,
        cartridgeManifest: runnerManifestPda,
        slugHash: runnerSlugHash,
        creatorShareBps: 5000,
        genreCode: 2,
        durationSecs: 90,
        fogOfWarBps: 5000,
        maxRebalances: 12,
        scoringFormula:
          cartridgeRegistry.ScoringFormula.DrawdownPenalizedSharpe,
        actionBindingMode: cartridgeRegistry.ActionBindingMode.ThreeLaneStance,
        allowedFeedsMerkleRoot: new Uint8Array(32).fill(0x22),
        manifestUri: padUri96(
          "https://cartridgefi.com/manifests/pulse-runner-002.json",
        ),
      });
    await sendAndConfirmBaseTx(
      relayer,
      [regRunnerIx],
      "Register Reference Harness #002 Manifest",
    );
  }

  // Open Arena RoomShard + RoomVault
  const runNonce = `${Date.now()}`;
  const eventId = sha256Bytes(`blitz-v10-protocol-proof-${runNonce}`);
  const shardIndex = 0;
  const shardIdxBytes = Buffer.alloc(2);
  shardIdxBytes.writeUInt16LE(shardIndex, 0);

  const [roomShardPda] = await getProgramDerivedAddress({
    programAddress: erRoomProgramId,
    seeds: [Buffer.from("room_shard"), eventId, shardIdxBytes],
  });
  const [roomVaultPda] = await getProgramDerivedAddress({
    programAddress: vaultRouterProgramId,
    seeds: [Buffer.from("room_vault"), addressEncoder.encode(roomShardPda)],
  });
  const [vaultUsdcTokenPda] = await getProgramDerivedAddress({
    programAddress: vaultRouterProgramId,
    seeds: [
      Buffer.from("room_vault_token"),
      addressEncoder.encode(roomShardPda),
    ],
  });

  const borelManifestInfo = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    borelManifestPda,
    FALLBACK_DEVNET_RPC,
  );
  if (!borelManifestInfo) {
    throw new Error("Reference Harness #001 manifest missing on Devnet");
  }
  const borelDurationSecs = BigInt(borelManifestInfo.data.readUInt32LE(107));
  const borelFogBps = BigInt(borelManifestInfo.data.readUInt16LE(111));

  const chainNow = await getChainUnixTimestamp(PRIMARY_DEVNET_RPC);
  const startTs =
    chainNow - (borelDurationSecs > 42n ? borelDurationSecs - 38n : 4n);
  const unsealTs = startTs + (borelDurationSecs * borelFogBps) / 10_000n;
  const endTs = startTs + borelDurationSecs;

  const initShardIx = cartridgeErRoom.getInitializeRoomShardInstruction({
    authority: relayer,
    cartridgeManifest: borelManifestPda,
    roomShard: roomShardPda,
    eventId,
    shardIndex,
    startTs,
    roomPoolUsdc: 0n,
    crankTaskId: BigInt(Date.now() % 1_000_000),
  });
  const initVaultIx =
    await cartridgeVaultRouter.getInitializeRoomVaultInstructionAsync({
      authority: relayer,
      roomShard: roomShardPda,
      engineConfig: engineConfigPda,
      cartridgeManifest: borelManifestPda,
      usdcMint,
      roomVault: roomVaultPda,
      vaultUsdcToken: vaultUsdcTokenPda,
      platformFeeAccount,
      creatorFeeVault,
      totalFeeBps: 500,
      partnerWalletActive: false,
    });

  const openShardSig = await sendAndConfirmBaseTx(
    relayer,
    [initShardIx, initVaultIx],
    `Initialize ArenaShard (${roomShardPda}) + RoomVault`,
  );
  recordedTxs.push({
    step: "1d. Initialize ArenaShard & RoomVault on L1",
    category: "delegation_and_vrf",
    layer: "Solana Devnet L1",
    signature: openShardSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(openShardSig),
    notes: `RoomShard ${roomShardPda} bound to canonical platformFeeAccount ${platformFeeAccount}`,
  });

  // Fund 2 Test Players + 2 Ephemeral Session Keys (0 SOL on Base L1)
  const player1 = await generateKeyPairSigner();
  const player2 = await generateKeyPairSigner();
  const sessionKey1 = await generateKeyPairSigner();
  const sessionKey2 = await generateKeyPairSigner();
  const player1Ata = await deriveCanonicalAta(player1.address, usdcMint);
  const player2Ata = await deriveCanonicalAta(player2.address, usdcMint);
  const depositPerPlayerUsdc = 100_000_000n;

  const fundPlayersSig = await sendAndConfirmBaseTx(
    relayer,
    [
      ixSystemTransfer(relayer, player1.address, 45_000_000n),
      ixSystemTransfer(relayer, player2.address, 45_000_000n),
      ixCreateAssociatedTokenAccountIdempotent(
        relayer,
        player1Ata,
        player1.address,
        usdcMint,
      ),
      ixMintTo(usdcMint, player1Ata, relayer, depositPerPlayerUsdc),
      ixCreateAssociatedTokenAccountIdempotent(
        relayer,
        player2Ata,
        player2.address,
        usdcMint,
      ),
      ixMintTo(usdcMint, player2Ata, relayer, depositPerPlayerUsdc),
    ],
    "Fund 2 Test Players & Mint 100 USDC Principal Each into Canonical ATAs",
  );
  recordedTxs.push({
    step: "1e. Fund 2 Players & Mint 100 USDC Principal Each",
    category: "delegation_and_vrf",
    layer: "Solana Devnet L1",
    signature: fundPlayersSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(fundPlayersSig),
    notes: `Player1=${player1.address}, Player2=${player2.address}`,
  });

  const players = [
    {
      label: "Participant A (Long Conviction)",
      signer: player1,
      session: sessionKey1,
      usdcAta: player1Ata,
      stanceSeries: [
        [3000, 7000, 0, 0],
        [3500, 6500, 0, 0],
        [4000, 6000, 0, 0],
      ] as const,
    },
    {
      label: "Participant B (Short Conviction)",
      signer: player2,
      session: sessionKey2,
      usdcAta: player2Ata,
      stanceSeries: [
        [-3000, -7000, 0, 0],
        [-3500, -6500, 0, 0],
        [-4000, -6000, 0, 0],
      ] as const,
    },
  ];

  const stancePdas: Address[] = [];
  const envelopePdas: Address[] = [];
  const passportPdas: Address[] = [];

  for (const p of players) {
    const [passportPda] = await getProgramDerivedAddress({
      programAddress: passportProgramId,
      seeds: [Buffer.from("passport"), addressEncoder.encode(p.signer.address)],
    });
    const [envPda] = await getProgramDerivedAddress({
      programAddress: vaultRouterProgramId,
      seeds: [
        Buffer.from("session_envelope"),
        addressEncoder.encode(roomShardPda),
        addressEncoder.encode(p.signer.address),
      ],
    });
    const [stancePda] = await getProgramDerivedAddress({
      programAddress: erRoomProgramId,
      seeds: [
        Buffer.from("player_stance"),
        addressEncoder.encode(roomShardPda),
        addressEncoder.encode(p.signer.address),
      ],
    });
    passportPdas.push(passportPda);
    envelopePdas.push(envPda);
    stancePdas.push(stancePda);

    const initPassIx =
      await cartridgePassport.getInitializePassportInstructionAsync({
        payer: p.signer,
        owner: p.signer,
        passport: passportPda,
      });
    const openEnvIx =
      await cartridgeVaultRouter.getOpenSessionEnvelopeInstructionAsync({
        player: p.signer,
        engineConfig: engineConfigPda,
        roomVault: roomVaultPda,
        usdcMint,
        vaultUsdcToken: vaultUsdcTokenPda,
        playerUsdcAta: p.usdcAta,
        sessionEnvelope: envPda,
        vaultRouterAuth: vaultRouterAuthPda,
        principalUsdc: depositPerPlayerUsdc,
        leverage: 3,
        ephemeralSessionKey: p.session.address,
      });
    const envSig = await sendAndConfirmBaseTx(
      p.signer,
      [initPassIx, openEnvIx],
      `${p.label}: Init MarketPassport + Open SessionRiskEnvelope`,
    );
    recordedTxs.push({
      step: `1f. ${p.label} Open SessionRiskEnvelope`,
      category: "delegation_and_vrf",
      layer: "Solana Devnet L1",
      signature: envSig,
      endpoint: PRIMARY_DEVNET_RPC,
      solscanUrl: solscanTxUrl(envSig),
      notes: `Envelope ${envPda} -> SessionKey ${p.session.address}`,
    });
  }

  // Delegate RoomShard + 2 PlayerStance PDAs to MagicBlock Delegation Program
  const shardDel = await deriveDelegationPdas(roomShardPda, erRoomProgramId);
  const delShardIx = cartridgeErRoom.getDelegateRoomShardInstruction({
    authority: relayer,
    bufferRoomShard: shardDel.buffer,
    delegationRecordRoomShard: shardDel.record,
    delegationMetadataRoomShard: shardDel.metadata,
    roomShard: roomShardPda,
    validator: erValidatorPubkey,
    eventId,
    shardIndex,
  });
  const delShardSig = await sendAndConfirmBaseTx(
    relayer,
    [delShardIx],
    `Delegate ArenaShard to ${DELEGATION_PROGRAM_ID}`,
  );
  recordedTxs.push({
    step: "1g. Delegate ArenaShard to MagicBlock Delegation Program",
    category: "delegation_and_vrf",
    layer: "Solana Devnet L1",
    signature: delShardSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(delShardSig),
    notes: `Delegated ${roomShardPda} -> ${DELEGATION_PROGRAM_ID} (validator=${erValidatorPubkey})`,
  });

  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const stancePda = stancePdas[i]!;
    const stanceDel = await deriveDelegationPdas(stancePda, erRoomProgramId);
    const initDelStanceIx = cartridgeErRoom.getInitStanceAndDelegateInstruction(
      {
        player: p.signer,
        roomShard: roomShardPda,
        bufferPlayerStance: stanceDel.buffer,
        delegationRecordPlayerStance: stanceDel.record,
        delegationMetadataPlayerStance: stanceDel.metadata,
        playerStance: stancePda,
        validator: erValidatorPubkey,
        ephemeralSessionKey: p.session.address,
        sessionExpiryTs: endTs,
      },
    );
    const sig = await sendAndConfirmBaseTx(
      p.signer,
      [initDelStanceIx],
      `${p.label}: Init & Delegate PlayerStance`,
    );
    recordedTxs.push({
      step: `1h. ${p.label} Init & Delegate PlayerStance`,
      category: "delegation_and_vrf",
      layer: "Solana Devnet L1",
      signature: sig,
      endpoint: PRIMARY_DEVNET_RPC,
      solscanUrl: solscanTxUrl(sig),
      notes: `Delegated ${stancePda} -> ${DELEGATION_PROGRAM_ID}`,
    });
  }

  console.log("  Waiting for ER clone propagation on MagicBlock Router...");
  let erReady = false;
  for (let poll = 0; poll < 30; poll++) {
    await sleep(600);
    const baseShard = await getAccountBuffer(
      PRIMARY_DEVNET_RPC,
      roomShardPda,
      FALLBACK_DEVNET_RPC,
    );
    const erShard = await getAccountBuffer(erValidatorFqdn, roomShardPda);
    const erS0 = await getAccountBuffer(erValidatorFqdn, stancePdas[0]!);
    const erS1 = await getAccountBuffer(erValidatorFqdn, stancePdas[1]!);
    if (
      baseShard?.owner === DELEGATION_PROGRAM_ID &&
      erShard?.owner === erRoomProgramId &&
      erS0?.owner === erRoomProgramId &&
      erS1?.owner === erRoomProgramId
    ) {
      erReady = true;
      break;
    }
  }
  if (!erReady) {
    throw new Error("Timed out waiting for delegated ArenaShard & PlayerStances on ER");
  }

  // Join ER Room + Execute 6 Real-Time Session-Key State Updates (3 per participant)
  let sessionUpdateCounter = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const stancePda = stancePdas[i]!;
    const [permPda] = await getProgramDerivedAddress({
      programAddress: PERMISSION_PROGRAM_ID,
      seeds: [Buffer.from("permission:"), addressEncoder.encode(stancePda)],
    });
    const joinIx = cartridgeErRoom.getJoinRoomAndInitPermissionInstruction({
      payer: p.signer,
      roomShard: roomShardPda,
      playerStance: stancePda,
      permission: permPda,
    });
    const joinSig = await sendAndConfirmErRouterTx(
      p.signer,
      [joinIx],
      [roomShardPda, stancePda, permPda],
      erValidatorFqdn,
      `${p.label}: join_room_and_init_permission (ACLseoPoy...)`,
    );
    recordedTxs.push({
      step: `1i. ${p.label} Init ER EphemeralPermission`,
      category: "delegation_and_vrf",
      layer: "MagicBlock ER",
      signature: joinSig,
      endpoint: erValidatorFqdn,
      solscanUrl: solscanTxUrl(joinSig, erValidatorFqdn),
      notes: `Permission PDA ${permPda} (${PERMISSION_PROGRAM_ID})`,
    });

    for (let stepIdx = 0; stepIdx < p.stanceSeries.length; stepIdx++) {
      sessionUpdateCounter += 1;
      const weights = p.stanceSeries[stepIdx]!;
      const stanceIx = cartridgeErRoom.getSubmitStanceInstruction({
        sessionSigner: p.session,
        roomShard: roomShardPda,
        playerStance: stancePda,
        oracleFeed: LIVE_ER_SOL_USD_ORACLE,
        weightsBps: [...weights],
        kalshiBinaryCall: 2,
        kalshiProbBps: 7800 + stepIdx * 300,
        secondaryPrices8: [14_000_000_000n, 60_000_000_000n, 64_000_000n],
        stage1ScoreScaled: 0n,
      });
      const stanceSig = await sendAndConfirmErRouterTx(
        p.session,
        [stanceIx],
        [roomShardPda, stancePda],
        erValidatorFqdn,
        `Session Update #${sessionUpdateCounter} (${p.label} Rebalance #${stepIdx + 1})`,
      );
      recordedTxs.push({
        step: `1j.${sessionUpdateCounter} Real-Time ER Session Update #${sessionUpdateCounter}`,
        category: "delegation_and_vrf",
        layer: "MagicBlock ER",
        signature: stanceSig,
        endpoint: erValidatorFqdn,
        solscanUrl: solscanTxUrl(stanceSig, erValidatorFqdn),
        notes: `${p.label} zero-popup SessionKey (${p.session.address.slice(0, 8)}…) weights=[${weights.join(",")}]`,
      });
    }
  }

  // Trigger Live MagicBlock VRF Randomness Request & Callback
  const [vrfProgramIdentityPda] = await getProgramDerivedAddress({
    programAddress: erRoomProgramId,
    seeds: [Buffer.from("identity")],
  });
  const reqVrfIx = cartridgeErRoom.getRequestSettlementVrfInstruction({
    authority: relayer,
    roomShard: roomShardPda,
    oracleQueue: DEFAULT_EPHEMERAL_QUEUE,
    programIdentity: vrfProgramIdentityPda,
    vrfProgram: VRF_PROGRAM_ID,
    clientSeed: 108,
  });
  const vrfReqSig = await sendAndConfirmErRouterTx(
    relayer,
    [reqVrfIx],
    [roomShardPda, DEFAULT_EPHEMERAL_QUEUE],
    erValidatorFqdn,
    `request_settlement_vrf (${VRF_PROGRAM_ID})`,
  );
  recordedTxs.push({
    step: "1k. Request Live MagicBlock VRF Randomness",
    category: "delegation_and_vrf",
    layer: "MagicBlock ER",
    signature: vrfReqSig,
    endpoint: erValidatorFqdn,
    solscanUrl: solscanTxUrl(vrfReqSig, erValidatorFqdn),
    notes: `Delegated queue ${DEFAULT_EPHEMERAL_QUEUE} -> callback_settlement_vrf`,
  });

  console.log("  Waiting for live MagicBlock VRF callback on ER...");
  let vrfFulfilled = false;
  let vrfSeedHex = "";
  for (let i = 0; i < 45; i++) {
    await sleep(500);
    const erShard = await getAccountBuffer(erValidatorFqdn, roomShardPda);
    if (erShard && erShard.data.length >= 197 && erShard.data[196] === 1) {
      vrfFulfilled = true;
      vrfSeedHex = erShard.data.subarray(164, 196).toString("hex");
      break;
    }
  }
  if (!vrfFulfilled) {
    throw new Error("MagicBlock VRF callback did not fulfill within timeout");
  }
  console.log(`  ✓ MagicBlock VRF callback fulfilled! Seed=0x${vrfSeedHex.slice(0, 32)}…`);

  // Showdown Unseal + Score Evaluation + Commit & Undelegate to Solana Devnet L1
  while (true) {
    const erNow = await getChainUnixTimestamp(erValidatorFqdn);
    if (erNow >= unsealTs) break;
    await sleep(1000);
  }
  for (let i = 0; i < players.length; i++) {
    const stancePda = stancePdas[i]!;
    const [permPda] = await getProgramDerivedAddress({
      programAddress: PERMISSION_PROGRAM_ID,
      seeds: [Buffer.from("permission:"), addressEncoder.encode(stancePda)],
    });
    const unsealIx = cartridgeErRoom.getTriggerShowdownUnsealInstruction({
      authority: relayer,
      roomShard: roomShardPda,
      playerStance: stancePda,
      permission: permPda,
    });
    const unsealSig = await sendAndConfirmErRouterTx(
      relayer,
      [unsealIx],
      [roomShardPda, stancePda, permPda],
      erValidatorFqdn,
      `Showdown Unseal (${players[i]!.label})`,
    );
    recordedTxs.push({
      step: `1l. Showdown Permission Unseal (${players[i]!.label})`,
      category: "delegation_and_vrf",
      layer: "MagicBlock ER",
      signature: unsealSig,
      endpoint: erValidatorFqdn,
      solscanUrl: solscanTxUrl(unsealSig, erValidatorFqdn),
      notes: `UpdateEphemeralPermissionCpi -> public Showdown state`,
    });
  }

  while (true) {
    const erNow = await getChainUnixTimestamp(erValidatorFqdn);
    if (erNow >= endTs) break;
    const rem = Number(endTs - erNow);
    process.stdout.write(`  [clock] ${rem}s until shard end_ts (${endTs})...\r`);
    await sleep(1000);
  }
  console.log("");

  for (let i = 0; i < players.length; i++) {
    const stancePda = stancePdas[i]!;
    const [permPda] = await getProgramDerivedAddress({
      programAddress: PERMISSION_PROGRAM_ID,
      seeds: [Buffer.from("permission:"), addressEncoder.encode(stancePda)],
    });
    const evalIx = cartridgeErRoom.getEvaluatePlayerScoreInstruction({
      authority: relayer,
      roomShard: roomShardPda,
      playerStance: stancePda,
      oracleFeed: LIVE_ER_SOL_USD_ORACLE,
      permission: permPda,
      secondaryExitPrices8: [15_400_000_000n, 60_000_000_000n, 64_000_000n],
      betaBenchScaled: 0n,
      lambdaDdScaled: 500_000_000n,
      kalshiOutcomeYes: 2,
      maxMultiplierScaled: SCALE_9,
    });
    const evalSig = await sendAndConfirmErRouterTx(
      relayer,
      [evalIx],
      [roomShardPda, stancePda, permPda],
      erValidatorFqdn,
      `evaluate_player_score (${players[i]!.label})`,
    );
    recordedTxs.push({
      step: `1m. Evaluate Deterministic Score (${players[i]!.label})`,
      category: "l1_settlement",
      layer: "MagicBlock ER",
      signature: evalSig,
      endpoint: erValidatorFqdn,
      solscanUrl: solscanTxUrl(evalSig, erValidatorFqdn),
      notes: `i128 (10^9) fixed-point score + CloseEphemeralPermissionCpi`,
    });
  }

  for (let i = 0; i < players.length; i++) {
    const stancePda = stancePdas[i]!;
    const undelIx = cartridgeErRoom.getUndelegatePlayerStanceInstruction({
      authority: relayer,
      roomShard: roomShardPda,
      playerStance: stancePda,
    });
    const undelSig = await sendAndConfirmErRouterTx(
      relayer,
      [undelIx],
      [stancePda],
      erValidatorFqdn,
      `undelegate_player_stance (${players[i]!.label})`,
    );
    recordedTxs.push({
      step: `1n. Commit & Undelegate PlayerStance (${players[i]!.label})`,
      category: "l1_settlement",
      layer: "MagicBlock ER",
      signature: undelSig,
      endpoint: erValidatorFqdn,
      solscanUrl: solscanTxUrl(undelSig, erValidatorFqdn),
      notes: `MagicIntentBundleBuilder::commit_and_undelegate -> Solana Devnet L1`,
    });
  }

  const [shardPermPda] = await getProgramDerivedAddress({
    programAddress: PERMISSION_PROGRAM_ID,
    seeds: [Buffer.from("permission:"), addressEncoder.encode(roomShardPda)],
  });
  const rawSettleCommitIx = cartridgeErRoom.getSettleAndCommitShardInstruction({
    authority: relayer,
    roomShard: roomShardPda,
    oracleFeed: LIVE_ER_SOL_USD_ORACLE,
    permission: shardPermPda,
    scheduleVaultAction: false,
    vaultActionAccounts: [],
  });
  const settleCommitIx: Instruction = {
    programAddress: rawSettleCommitIx.programAddress,
    data: rawSettleCommitIx.data,
    accounts: rawSettleCommitIx.accounts.map((meta) =>
      meta.address === shardPermPda ||
      meta.address === "MagicVau1t999999999999999999999999999999999"
        ? { ...meta, role: AccountRole.READONLY }
        : meta,
    ),
  };
  const settleCommitSig = await sendAndConfirmErRouterTx(
    relayer,
    [settleCommitIx],
    [roomShardPda],
    erValidatorFqdn,
    `settle_and_commit_shard (${roomShardPda})`,
  );
  recordedTxs.push({
    step: "1o. Settle & Commit+Undelegate ArenaShard to L1",
    category: "l1_settlement",
    layer: "MagicBlock ER",
    signature: settleCommitSig,
    endpoint: erValidatorFqdn,
    solscanUrl: solscanTxUrl(settleCommitSig, erValidatorFqdn),
    notes: `MagicIntentBundleBuilder::commit_and_undelegate -> Solana Devnet L1`,
  });

  console.log("  Waiting for L1 undelegation restoration...");
  let l1Restored = false;
  for (let poll = 0; poll < 60; poll++) {
    await sleep(1000);
    const s = await getAccountBuffer(
      PRIMARY_DEVNET_RPC,
      roomShardPda,
      FALLBACK_DEVNET_RPC,
    );
    const p0 = await getAccountBuffer(
      PRIMARY_DEVNET_RPC,
      stancePdas[0]!,
      FALLBACK_DEVNET_RPC,
    );
    const p1 = await getAccountBuffer(
      PRIMARY_DEVNET_RPC,
      stancePdas[1]!,
      FALLBACK_DEVNET_RPC,
    );
    if (
      s?.owner === erRoomProgramId &&
      p0?.owner === erRoomProgramId &&
      p1?.owner === erRoomProgramId
    ) {
      l1Restored = true;
      break;
    }
  }
  if (!l1Restored) {
    throw new Error("Timed out waiting for undelegated shard & stances on L1");
  }

  const platformFeeBeforeArena = await getTokenAccountBalance(
    PRIMARY_DEVNET_RPC,
    platformFeeAccount,
  );
  const creatorFeeBeforeArena = await getTokenAccountBalance(
    PRIMARY_DEVNET_RPC,
    creatorFeeVault,
  );

  const baseDistIx = cartridgeVaultRouter.getDistributePoolAndFeesInstruction({
    authority: relayer,
    roomVault: roomVaultPda,
    roomShard: roomShardPda,
    usdcMint,
    vaultUsdcToken: vaultUsdcTokenPda,
    platformFeeAccount,
    creatorFeeVault,
    engineConfig: engineConfigPda,
    vaultRouterAuth: vaultRouterAuthPda,
  });
  const distIxWithPairs: Instruction = {
    programAddress: baseDistIx.programAddress,
    data: baseDistIx.data,
    accounts: [
      ...baseDistIx.accounts,
      { address: stancePdas[0]!, role: AccountRole.READONLY },
      { address: envelopePdas[0]!, role: AccountRole.WRITABLE },
      { address: stancePdas[1]!, role: AccountRole.READONLY },
      { address: envelopePdas[1]!, role: AccountRole.WRITABLE },
    ],
  };
  const distSig = await sendAndConfirmBaseTx(
    relayer,
    [distIxWithPairs],
    "distribute_pool_and_fees (Harmonic Shapley + Platform & Creator Fee Split)",
  );
  recordedTxs.push({
    step: "1p. Settle Arena Pool & Pay Protocol Fee on L1",
    category: "l1_settlement",
    layer: "Solana Devnet L1",
    signature: distSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(distSig),
    notes: `Credited canonical platformFeeAccount (${platformFeeAccount}) + creatorFeeVault`,
  });

  const platformFeeAfterArena = await getTokenAccountBalance(
    PRIMARY_DEVNET_RPC,
    platformFeeAccount,
  );
  const creatorFeeAfterArena = await getTokenAccountBalance(
    PRIMARY_DEVNET_RPC,
    creatorFeeVault,
  );
  const arenaPlatformFeeDelta = platformFeeAfterArena - platformFeeBeforeArena;
  const arenaCreatorFeeDelta = creatorFeeAfterArena - creatorFeeBeforeArena;

  const claimIx = cartridgeVaultRouter.getClaimPrizeInstruction({
    player: player1,
    roomVault: roomVaultPda,
    sessionEnvelope: envelopePdas[0]!,
    usdcMint,
    desiredMint: usdcMint,
    vaultUsdcToken: vaultUsdcTokenPda,
    playerDestinationAta: player1Ata,
    engineConfig: engineConfigPda,
    vaultRouterAuth: vaultRouterAuthPda,
    xstockUnitsOut: 0n,
  });
  const claimSig = await sendAndConfirmBaseTx(
    player1,
    [claimIx],
    "Participant A Winner claim_prize on Solana Devnet L1",
  );
  recordedTxs.push({
    step: "1q. Winner Claim Payout on L1",
    category: "l1_settlement",
    layer: "Solana Devnet L1",
    signature: claimSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(claimSig),
    notes: `Winner ${player1.address} claimed Harmonic Shapley payout`,
  });

  const winnerUsdcAfter = await getTokenAccountBalance(
    PRIMARY_DEVNET_RPC,
    player1Ata,
  );
  const eloIx =
    await cartridgePassport.getRecordEloAndVaultCreditInstructionAsync({
      authority: relayer,
      passportConfig: passportConfigPda,
      passport: passportPdas[0]!,
      roomMeanEloScaled: 1200n * SCALE_9,
      placementScoreScaled: SCALE_9,
      isLiveMode: true,
      isWin: true,
      sharpeScoreScaled: 2_250_000_000n,
      brierScoreScaled: 970_000_000n,
      assetCreditKind: cartridgePassport.AssetCreditKind.Usdc,
      assetCreditUnits: winnerUsdcAfter,
    });
  const eloSig = await sendAndConfirmBaseTx(
    relayer,
    [eloIx],
    "Update Cross-Game Market ELO Passport on Solana Devnet L1",
  );
  recordedTxs.push({
    step: "1r. Update Cross-Game Market ELO Passport on L1",
    category: "l1_settlement",
    layer: "Solana Devnet L1",
    signature: eloSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(eloSig),
    notes: `MarketPassport PDA ${passportPdas[0]}`,
  });

  // =========================================================================
  // PART 2: RELAYER PRIVATE PAYMENTS, TEE AUTH & `platformFeeAccount`
  //         (`delegateSpl`, `transferSpl`, `withdrawSpl` + `payments.magicblock.app`)
  // =========================================================================
  console.log(
    "\n[Part 2] Executing Relayer Private eSPL Payments & platformFeeAccount Settlements...",
  );

  const relayerAta = await deriveCanonicalAta(relayer.address, usdcMint);
  const recipients = [
    address(CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1),
    address(CARTRIDGE_DEVNET_AUTHORITIES.pacerBot2),
    address(CARTRIDGE_DEVNET_AUTHORITIES.pacerBot3),
  ] as const;

  const prepRelayerIxs: Instruction[] = [
    ixCreateAssociatedTokenAccountIdempotent(
      relayer,
      relayerAta,
      relayer.address,
      usdcMint,
    ),
    ixMintTo(usdcMint, relayerAta, relayer, 25_000_000n),
  ];
  for (const r of recipients) {
    const rAta = await deriveCanonicalAta(r, usdcMint);
    prepRelayerIxs.push(
      ixCreateAssociatedTokenAccountIdempotent(relayer, rAta, r, usdcMint),
    );
  }

  // Ensure eSPL Rent PDA is funded on Devnet (check balance first)
  const [rentPda] = await deriveRentPda();
  const rentPdaAcc = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    rentPda,
    FALLBACK_DEVNET_RPC,
  );
  if (!rentPdaAcc || rentPdaAcc.lamports < 20_000_000n) {
    prepRelayerIxs.push(ixSystemTransfer(relayer, rentPda, 50_000_000n));
  }

  const mintRelayerSig = await sendAndConfirmBaseTx(
    relayer,
    prepRelayerIxs,
    "Prepare Relayer Canonical ATA & Mint 25.00 SPL Units",
  );
  recordedTxs.push({
    step: "2a. Fund Relayer Canonical ATA & Recipient ATAs",
    category: "private_payments_and_fees",
    layer: "Solana Devnet L1",
    signature: mintRelayerSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(mintRelayerSig),
    notes: `Relayer ATA ${relayerAta} funded with 25,000,000 units of ${usdcMint}`,
  });

  // 2b. Delegate Relayer SPL balance into Private ER TEE using SDK `delegateSpl`
  const [globalEsplVault] = await deriveVault(usdcMint);
  const [relayerEata] = await deriveEphemeralAta(relayer.address, usdcMint);
  const [relayerEataPerm] = await getProgramDerivedAddress({
    programAddress: PERMISSION_PROGRAM_ID,
    seeds: [Buffer.from("permission:"), addressEncoder.encode(relayerEata)],
  });

  const existingVault = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    globalEsplVault,
    FALLBACK_DEVNET_RPC,
  );
  const existingRelayerEata = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    relayerEata,
    FALLBACK_DEVNET_RPC,
  );
  const existingRelayerPerm = await getAccountBuffer(
    PRIMARY_DEVNET_RPC,
    relayerEataPerm,
    FALLBACK_DEVNET_RPC,
  );

  const rawDelegateSplIxs = await delegateSpl(
    relayer.address,
    usdcMint,
    5_000_000n,
    {
      payer: relayer.address,
      validator: teeValidatorPubkey,
      initVaultIfMissing: !existingVault,
      initIfMissing: !existingRelayerEata,
      initAtasIfMissing: false,
      private: !existingRelayerPerm && !existingRelayerEata,
    },
  );
  // If relayerEata is already delegated on Base L1 from a previous run, filter out duplicate `delegateIx` (ix discriminator 4 on relayerEata)
  const filteredDelegateSplIxs =
    existingRelayerEata?.owner === DELEGATION_PROGRAM_ID
      ? rawDelegateSplIxs.filter(
          (ix) =>
            !(
              ix.programAddress === EPHEMERAL_SPL_TOKEN_PROGRAM_ID &&
              ix.data?.[0] === 4 &&
              ix.accounts?.[1]?.address === relayerEata
            ),
        )
      : rawDelegateSplIxs;

  const delegateSplSig = await sendAndConfirmBaseTx(
    relayer,
    attachSignersToInstructions(filteredDelegateSplIxs, [relayer]),
    `SDK delegateSpl (5.00 USDC -> Private ER TEE ${teeValidatorPubkey})`,
  );
  recordedTxs.push({
    step: "2b. Relayer SDK `delegateSpl` into Private ER TEE",
    category: "private_payments_and_fees",
    layer: "Solana Devnet L1",
    signature: delegateSplSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(delegateSplSig),
    notes: `Deposited & delegated 5,000,000 units via ${EPHEMERAL_SPL_TOKEN_PROGRAM_ID} to TEE ${teeValidatorPubkey}`,
  });

  // Wait for shuttle deposit to materialize in Relayer's TEE ATA
  console.log("  Waiting for delegated eSPL balance to materialize inside Private ER TEE...");
  for (let i = 0; i < 25; i++) {
    await sleep(800);
    const teeAtaInfo = await getAccountBuffer(
      MAGICBLOCK_TEE_RPC,
      relayerAta,
      undefined,
      { Authorization: `Bearer ${directTeeAuth.token}` },
    );
    if (teeAtaInfo && teeAtaInfo.data.length >= 72) {
      const teeBal = teeAtaInfo.data.readBigUInt64LE(64);
      if (teeBal >= 1_000_000n) {
        console.log(
          `  ✓ Verified Relayer private TEE balance at canonical ATA ${relayerAta}: ${teeBal} units`,
        );
        break;
      }
    }
  }

  // Refresh TEE bearer tokens right before 2c/2d
  const freshTeeAuth = await getAuthToken(
    MAGICBLOCK_TEE_RPC,
    relayer.address,
    async (msg) => signBytes(relayer.keyPair.privateKey, msg),
  );
  const freshPaymentsBearer = await authenticatePaymentsPrivateApi(relayer);

  // 2c. Execute 3 Private Relayer Transfers paying `platformFeeBps` into `platformFeeAccount` ATA
  const platformFeeBeforePrivate = await getTokenAccountBalance(
    PRIMARY_DEVNET_RPC,
    platformFeeAccount,
  );
  const transferAmounts = [1_500_000, 2_000_000, 2_500_000] as const;

  for (let idx = 0; idx < recipients.length; idx++) {
    const recipient = recipients[idx]!;
    const amountUnits = transferAmounts[idx]!;
    const buildRes = await fetch(`${MAGICBLOCK_PAYMENTS_API}/v1/spl/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshPaymentsBearer}`,
      },
      body: JSON.stringify({
        from: relayer.address,
        to: recipient,
        mint: usdcMint,
        amount: amountUnits,
        visibility: "private",
        cluster: "devnet-private",
        fromBalance: "base",
        toBalance: "ephemeral",
        initIfMissing: true,
        initAtasIfMissing: true,
        initVaultIfMissing: false,
        platformFeeBps: RELAYER_PLATFORM_FEE_BPS,
        platformFeeAccount,
        clientRefId: `${Date.now()}${idx + 1}`,
        legacy: true,
      }),
    });
    const buildJson = (await buildRes.json()) as PaymentsTransferResponse;
    if (!buildRes.ok || !buildJson.transactionBase64) {
      throw new Error(
        `Private transfer #${idx + 1} build failed: ${JSON.stringify(buildJson)}`,
      );
    }

    const unsignedTx = txDecoder.decode(
      new Uint8Array(Buffer.from(buildJson.transactionBase64, "base64")),
    );
    const signedTx = await partiallySignTransaction(
      [relayer.keyPair],
      unsignedTx,
    );
    const signedBase64 = getBase64EncodedWireTransaction(signedTx);
    const finalSig = getSignatureFromTransaction(signedTx);

    try {
      await rpcCall<string>(
        FALLBACK_DEVNET_RPC,
        "sendTransaction",
        [signedBase64, { encoding: "base64", skipPreflight: false }],
        PRIMARY_DEVNET_RPC,
      );
    } catch (err) {
      if (!String(err).includes("already been processed")) {
        throw err;
      }
    }
    await confirmBaseSignature(
      finalSig,
      `Relayer Private Transfer #${idx + 1} -> Encrypted Magic ATA`,
    );
    console.log(
      `  ✓ [Private eSPL #${idx + 1}] ${amountUnits} units -> ${recipient.slice(0, 8)}… (fee=${buildJson.fees?.tokens ?? "0"} -> platformFeeAccount): ${finalSig}`,
    );
    recordedTxs.push({
      step: `2c.${idx + 1} Relayer Private Transfer #${idx + 1} (Encrypted TEE Magic ATA + Fee)`,
      category: "private_payments_and_fees",
      layer: "Solana Devnet L1",
      signature: finalSig,
      endpoint: PRIMARY_DEVNET_RPC,
      solscanUrl: solscanTxUrl(finalSig),
      notes: `Encrypted ix 34 -> TEE ${teeValidatorPubkey}; paid ${buildJson.fees?.tokens ?? "0"} token fee (${RELAYER_PLATFORM_FEE_BPS} bps) into platformFeeAccount ${platformFeeAccount}`,
    });
  }

  // 2d. Execute in-TEE private SDK `transferSpl` (`ephemeral -> ephemeral`) directly inside Private ER TEE
  const rawInTeeTransferIxs = await transferSpl(
    relayer.address,
    recipients[0],
    usdcMint,
    500_000n,
    {
      visibility: "private",
      fromBalance: "ephemeral",
      toBalance: "ephemeral",
      initIfMissing: true,
    },
  );
  const inTeeSig = await sendAndConfirmTeeTx(
    relayer,
    attachSignersToInstructions(rawInTeeTransferIxs, [relayer]),
    freshTeeAuth.token,
    `SDK transferSpl (private ephemeral -> ephemeral inside Intel TDX TEE)`,
  );
  recordedTxs.push({
    step: "2d. In-TEE SDK `transferSpl` (Private Ephemeral -> Ephemeral)",
    category: "private_payments_and_fees",
    layer: "MagicBlock Private ER (TEE)",
    signature: inTeeSig,
    endpoint: MAGICBLOCK_TEE_RPC,
    solscanUrl: solscanTxUrl(inTeeSig, MAGICBLOCK_TEE_RPC),
    notes: `Executed inside Intel TDX TEE (${MAGICBLOCK_TEE_RPC}) via EnsureMagicAtaDestination + SPL Transfer`,
  });

  // 2e. Execute SDK `withdrawSpl` from Private ER TEE back to Relayer canonical ATA on Base L1
  const rawWithdrawIxs = await withdrawSpl(
    relayer.address,
    usdcMint,
    1_000_000n,
    {
      payer: relayer.address,
      validator: teeValidatorPubkey,
    },
  );
  const withdrawSig = await sendAndConfirmBaseTx(
    relayer,
    attachSignersToInstructions(rawWithdrawIxs, [relayer]),
    `SDK withdrawSpl (1.00 USDC Shuttle Withdrawal from Private ER TEE -> Base L1)`,
  );
  recordedTxs.push({
    step: "2e. Relayer SDK `withdrawSpl` Shuttle Withdrawal to Base L1",
    category: "private_payments_and_fees",
    layer: "Solana Devnet L1",
    signature: withdrawSig,
    endpoint: PRIMARY_DEVNET_RPC,
    solscanUrl: solscanTxUrl(withdrawSig),
    notes: `Withdrew 1,000,000 units from TEE ${teeValidatorPubkey} -> ${relayerAta}`,
  });

  const platformFeeAfterPrivate = await getTokenAccountBalance(
    PRIMARY_DEVNET_RPC,
    platformFeeAccount,
  );
  const privateTransfersFeeDelta =
    platformFeeAfterPrivate - platformFeeBeforePrivate;
  const totalRunFeeDelta = platformFeeAfterPrivate - platformFeeBeforeArena;

  if (privateTransfersFeeDelta <= 0n || arenaPlatformFeeDelta <= 0n) {
    throw new Error(
      `Expected positive platformFeeAccount inflows: arena=${arenaPlatformFeeDelta}, privateTransfers=${privateTransfersFeeDelta}`,
    );
  }

  console.log(
    `  ✓ Verified platformFeeAccount (${platformFeeAccount}): +${arenaPlatformFeeDelta} (Arena Settlement) +${privateTransfersFeeDelta} (3x Private Relayer Transfers) = ${platformFeeAfterPrivate} total units`,
  );

  // =========================================================================
  // PART 3: WRITE `apps/web/src/data/devnet-proof.json` & `docs/DEVNET_PROOF.md`
  // =========================================================================
  const completedAtIso = new Date().toISOString();
  const proofJson = {
    protocolVersion: "0.1.0-blitz-protocol",
    executionMode: "CARTRIDGEFI_STANDALONE_DEV=false",
    startedAtUtc: startedAtIso,
    verifiedAtUtc: completedAtIso,
    clusters: {
      solanaDevnetRpc: "https://api.devnet.solana.com",
      magicblockRouterRpc: MAGICBLOCK_ROUTER_RPC,
      magicblockPublicErRpc: erValidatorFqdn,
      magicblockPublicErValidator: erValidatorPubkey,
      magicblockPrivateTeeRpc: MAGICBLOCK_TEE_RPC,
      magicblockPrivateTeeValidator: teeValidatorPubkey,
      magicblockPaymentsApi: MAGICBLOCK_PAYMENTS_API,
    },
    programs: {
      cartridgeErRoom: {
        programId: CARTRIDGE_PROGRAM_IDS.erRoom,
        priority: 1,
        binaryBytes: 435080,
        minRentSol: "2.21085664",
        solscanUrl: solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.erRoom),
      },
      cartridgeVaultRouter: {
        programId: CARTRIDGE_PROGRAM_IDS.vaultRouter,
        priority: 2,
        binaryBytes: 373232,
        minRentSol: "1.89666880",
        solscanUrl: solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.vaultRouter),
      },
      cartridgeRegistry: {
        programId: CARTRIDGE_PROGRAM_IDS.registry,
        priority: 3,
        binaryBytes: 188752,
        minRentSol: "0.95951040",
        solscanUrl: solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.registry),
      },
      cartridgePassport: {
        programId: CARTRIDGE_PROGRAM_IDS.passport,
        priority: 4,
        binaryBytes: 182040,
        minRentSol: "0.92541344",
        solscanUrl: solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.passport),
      },
      magicblockDelegation: DELEGATION_PROGRAM_ID,
      magicblockPermission: PERMISSION_PROGRAM_ID,
      magicblockVrf: VRF_PROGRAM_ID,
      magicblockEsplToken: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    },
    accounts: {
      relayerWallet: relayer.address,
      relayerCanonicalAta: relayerAta,
      splMint: usdcMint,
      platformFeeOwner,
      platformFeeAccountAta: platformFeeAccount,
      creatorFeeVault,
      engineConfigPda,
      passportConfigPda,
      referenceHarness001ManifestPda: borelManifestPda,
      referenceHarness002ManifestPda: runnerManifestPda,
      settledRoomShardPda: roomShardPda,
      settledRoomVaultPda: roomVaultPda,
      globalEsplVaultPda: globalEsplVault,
      relayerEataPda: relayerEata,
    },
    metrics: {
      erSessionStateUpdatesCount: sessionUpdateCounter,
      vrfFulfilled: true,
      vrfQueue: DEFAULT_EPHEMERAL_QUEUE,
      vrfSeedHex: `0x${vrfSeedHex}`,
      privateTransfersCount: 4,
      relayerFeePaidTransfersCount: 3,
      relayerPlatformFeeBps: RELAYER_PLATFORM_FEE_BPS,
      arenaPlatformFeeUnits: arenaPlatformFeeDelta.toString(),
      arenaCreatorFeeUnits: arenaCreatorFeeDelta.toString(),
      privateRelayerFeeUnits: privateTransfersFeeDelta.toString(),
      totalRunPlatformFeeUnits: totalRunFeeDelta.toString(),
      platformFeeAccountFinalBalanceUnits: platformFeeAfterPrivate.toString(),
      winnerPayoutUnits: winnerUsdcAfter.toString(),
    },
    transactions: recordedTxs,
  };

  const jsonPath = resolve(
    process.cwd(),
    "apps/web/src/data/devnet-proof.json",
  );
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(proofJson, null, 2)}\n`, "utf8");

  const cat1Rows = recordedTxs
    .filter(
      (t) =>
        t.category === "delegation_and_vrf" || t.category === "l1_settlement",
    )
    .map(
      (t) =>
        `| ${t.step} | ${t.layer} | [\`${t.signature.slice(0, 16)}…\`](${t.solscanUrl}) | ${t.notes} |`,
    )
    .join("\n");

  const cat2Rows = recordedTxs
    .filter((t) => t.category === "private_payments_and_fees")
    .map(
      (t) =>
        `| ${t.step} | ${t.layer} | [\`${t.signature.slice(0, 16)}…\`](${t.solscanUrl}) | ${t.notes} |`,
    )
    .join("\n");

  const proofMarkdown = `# CartridgeFi Protocol (\`v0.1.0-blitz-protocol\`) — MagicBlock Blitz v10 Live On-Chain Proof

**Positioning:** Technical Entertainment Finance Protocol (\`Infra + DeFi + Privacy\`)  
**Execution Mode:** \`CARTRIDGEFI_STANDALONE_DEV=false\` (100% Live On-Chain Execution)  
**Verified Timestamp (UTC):** \`${completedAtIso}\`  
**Solana Devnet L1 RPC:** \`https://api.devnet.solana.com\`  
**MagicBlock Router RPC:** \`${MAGICBLOCK_ROUTER_RPC}\` (\`${erValidatorFqdn}\` · Validator \`${erValidatorPubkey}\`)  
**MagicBlock Private ER TEE:** \`${MAGICBLOCK_TEE_RPC}\` (Intel TDX Validator \`${teeValidatorPubkey}\`)

---

## 1. Deployed Protocol Program IDs & Priority Rent Audit

| Priority | Program | Devnet Program ID | SBF Size | Rent-Exempt Min |
| :---: | :--- | :--- | :---: | :---: |
| **#1** | \`cartridge_er_room\` | [\`${CARTRIDGE_PROGRAM_IDS.erRoom}\`](${solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.erRoom)}) | \`435,080 B\` | \`2.21085664 SOL\` |
| **#2** | \`cartridge_vault_router\` | [\`${CARTRIDGE_PROGRAM_IDS.vaultRouter}\`](${solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.vaultRouter)}) | \`373,232 B\` | \`1.89666880 SOL\` |
| **#3** | \`cartridge_registry\` | [\`${CARTRIDGE_PROGRAM_IDS.registry}\`](${solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.registry)}) | \`188,752 B\` | \`0.95951040 SOL\` |
| **#4** | \`cartridge_passport\` | [\`${CARTRIDGE_PROGRAM_IDS.passport}\`](${solscanAccountUrl(CARTRIDGE_PROGRAM_IDS.passport)}) | \`182,040 B\` | \`0.92541344 SOL\` |

- **Compiler Profile (\`Cargo.toml\`):** \`opt-level = "z"\`, \`lto = "fat"\`, \`codegen-units = 1\`, \`overflow-checks = true\` (zero raw OS \`strip\`)

---

## 2. \`build.magicblock.app\` Submission Identity & Fee Accounts

| Submission Field | Live Devnet Pubkey | On-Chain Verification |
| :--- | :--- | :--- |
| **Relayer / App Wallet** | [\`${relayer.address}\`](${solscanAccountUrl(relayer.address)}) | Signed TEE auth, \`delegateSpl\`, 3x private fee-paying transfers, in-TEE \`transferSpl\`, and \`withdrawSpl\` |
| **\`platformFeeAccount\` (Canonical ATA)** | [\`${platformFeeAccount}\`](${solscanAccountUrl(platformFeeAccount)}) | Canonical SPL ATA of owner [\`${platformFeeOwner}\`](${solscanAccountUrl(platformFeeOwner)}) for mint [\`${usdcMint}\`](${solscanAccountUrl(usdcMint)}); Balance **\`${platformFeeAfterPrivate}\` units** (\`+${arenaPlatformFeeDelta}\` Arena + \`+${privateTransfersFeeDelta}\` Private Transfers) |
| **\`platformFeeAccount\` Owner** | [\`${platformFeeOwner}\`](${solscanAccountUrl(platformFeeOwner)}) | Protocol Treasury Authority |
| **Devnet SPL Mint (6 Decimals)** | [\`${usdcMint}\`](${solscanAccountUrl(usdcMint)}) | Shared across \`RoomVault\` escrow & eSPL (\`SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2\`) |
| **Protocol \`EngineConfig\` PDA** | [\`${engineConfigPda}\`](${solscanAccountUrl(engineConfigPda)}) | Bound to canonical \`platformFeeAccount\` \`${platformFeeAccount}\` |
| **Reference Harness #001 Manifest** | [\`${borelManifestPda}\`](${solscanAccountUrl(borelManifestPda)}) | Protocol Integration Demo #001 (\`DirectionNeutralRelReturn\`) |
| **Settled \`RoomShard\` PDA** | [\`${roomShardPda}\`](${solscanAccountUrl(roomShardPda)}) | Delegated -> 6x Session Updates -> VRF \`0x${vrfSeedHex.slice(0, 24)}…\` -> Undelegated to L1 |
| **eSPL Global Vault PDA** | [\`${globalEsplVault}\`](${solscanAccountUrl(globalEsplVault)}) | Initialized & active under \`${EPHEMERAL_SPL_TOKEN_PROGRAM_ID}\` |

---

## 3. Category A — Program Delegations, 6x Real-Time Session Updates, VRF & L1 Settlement

| Step | Layer | Solscan Proof | Verification Notes |
| :--- | :--- | :--- | :--- |
${cat1Rows}

---

## 4. Category B — Relayer Private eSPL Payments, TEE Auth & \`platformFeeAccount\`

| Step | Layer | Solscan Proof | Verification Notes |
| :--- | :--- | :--- | :--- |
${cat2Rows}

---

## 5. Reproducing This Proof

\`\`\`bash
CARTRIDGEFI_STANDALONE_DEV=false pnpm prove:blitz
\`\`\`
`;

  const mdPath = resolve(process.cwd(), "docs/DEVNET_PROOF.md");
  writeFileSync(mdPath, proofMarkdown, "utf8");

  console.log(`\n=== SUCCESS: MagicBlock Blitz v10 Proof Complete ===`);
  console.log(`  Markdown Report:      ${mdPath}`);
  console.log(`  Console JSON Data:    ${jsonPath}`);
  console.log(`  Relayer Wallet:       ${relayer.address}`);
  console.log(`  platformFeeAccount:   ${platformFeeAccount} (owner=${platformFeeOwner})`);
  console.log(`  Session Updates:      ${sessionUpdateCounter} on ER`);
  console.log(`  VRF Seed:             0x${vrfSeedHex}`);
  console.log(`  Total Recorded Txs:   ${recordedTxs.length}`);
}

main().catch((err) => {
  console.error("\n[prove-magicblock-blitz FAILED]:", err);
  process.exit(1);
});
