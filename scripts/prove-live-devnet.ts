/**
 * Borel — Sealed-Conviction Live Market Showdowns: live Devnet lifecycle proof (relayer key).
 *
 * Runs one full room against the deployed CartridgeFi programs using ONLY the fresh relayer
 * authority (`.keys/relayer.json`, override with RELAYER_KEYPAIR). No upgrade/admin key needed.
 *
 *   L1  register_cartridge (relayer = creator, max_rebalances = 2 → lock + exactly one pivot, enforced on-chain)
 *   L1  initialize_room_shard (relayer = authority)
 *   L1  fund 2 player keys + initialize_passport ×2 + hand-commitment memo ×2
 *   L1  delegate_room_shard + init_stance_and_delegate ×2 → MagicBlock Delegation Program
 *   ER  join_room_and_init_permission ×2 (Permission Program, private Fog-of-War state)
 *   ER  submit_stance ×2 (sealed hand as conviction weights) + submit_stance ×2 (the single pivot)
 *   ER  request_settlement_vrf → callback_settlement_vrf (MagicBlock VRF seed)
 *   ER  trigger_showdown_unseal ×2, evaluate_player_score ×2
 *   ER  undelegate_player_stance ×2 + settle_and_commit_shard (commit + undelegate to L1)
 *   L1  test-USDC faucet mint ×2 → SPL stake ×2 into relayer escrow → winner payout + 1% fee into
 *       platformFeeAccount → cartridge_passport.record_elo_and_vault_credit ×2 (relayer = PassportConfig admin)
 *
 * Requires the programs redeployed under the relayer authority + `node scripts/init-borel-own-authority.ts`.
 *
 * Hand → slot mapping (program has 4 weight slots): [SOL/USD, BTC/USD, ETH/USD, NVDAx/USD];
 * weight_bps = sign(LONG=+1, SHORT=-1) × conviction × 1000 (gross ≤ 6000 ≤ 10000 cap).
 * SOL/USD is priced in-program by the MagicBlock ER pricing oracle; BTC/ETH/NVDAx entry/exit
 * prices are relayer-supplied from Pyth Hermes. SPY/USD has no slot in on-chain rooms.
 *
 * NOT executed: cartridge_vault_router open_session_envelope / distribute_pool_and_fees / claim_prize
 * (settlement here is relayer-escrowed SPL transfers, not the vault_router CPI path).
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

function ixTransferChecked(
  source: Address,
  mint: Address,
  destination: Address,
  owner: KeyPairSigner,
  amount: bigint,
  decimals: number,
): Instruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0); // TransferChecked
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: destination, role: AccountRole.WRITABLE },
      { address: owner.address, role: AccountRole.READONLY_SIGNER, signer: owner } as never,
    ],
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

// ===========================================================================
// Borel live lifecycle
// ===========================================================================

const MEMO_PROGRAM_ID = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const BOREL_SLOT_MARKETS = ["SOL/USD", "BTC/USD", "ETH/USD", "NVDAx/USD"] as const;
/** Pyth sponsored push-feed PriceUpdateV2 accounts (Solana mainnet) + feed ids. */
const PYTH_PUSH_FEEDS: Record<(typeof BOREL_SLOT_MARKETS)[number], { account: string; feedId: string }> = {
  "SOL/USD": { account: "7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE", feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
  "BTC/USD": { account: "APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5", feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
  "ETH/USD": { account: "7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH", feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
  "NVDAx/USD": { account: "VSgf6jkwrcs9jbLuR57iN1Gk2c68vT9stZe8G6GGix2", feedId: "4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f" },
};
const PYTH_MAINNET_RPC = process.env.PYTH_MAINNET_RPC ?? "https://solana-rpc.publicnode.com";

interface BorelLeg {
  market: (typeof BOREL_SLOT_MARKETS)[number];
  direction: "LONG" | "SHORT";
  conviction: 1 | 2 | 3;
}

function handToWeights(hand: readonly BorelLeg[]): [number, number, number, number] {
  const w: [number, number, number, number] = [0, 0, 0, 0];
  for (const leg of hand) {
    const slot = BOREL_SLOT_MARKETS.indexOf(leg.market);
    w[slot] = (leg.direction === "LONG" ? 1 : -1) * leg.conviction * 1000;
  }
  return w;
}

/** Latest Pyth prices scaled to 1e8 (program `price_8` units), decoded from PriceUpdateV2 push feeds. */
async function hermesPrices8(): Promise<Record<string, bigint>> {
  const res = await rpcCall<{ value: ({ data: [string, string] } | null)[] }>(PYTH_MAINNET_RPC, "getMultipleAccounts", [
    BOREL_SLOT_MARKETS.map((m) => PYTH_PUSH_FEEDS[m].account),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const out: Record<string, bigint> = {};
  BOREL_SLOT_MARKETS.forEach((m, i) => {
    const acct = res.value[i];
    if (!acct) throw new Error(`Pyth push feed missing for ${m}`);
    const bytes = Buffer.from(acct.data[0], "base64");
    let o = 8 + 32;
    o += bytes[o] === 0 ? 2 : 1;
    if (bytes.subarray(o, o + 32).toString("hex") !== PYTH_PUSH_FEEDS[m].feedId) throw new Error(`Feed id mismatch for ${m}`);
    o += 32;
    const price = bytes.readBigInt64LE(o);
    const expo = bytes.readInt32LE(o + 16);
    const shift = 8 + expo;
    out[m] = shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
  });
  return out;
}

function ixMemo(text: string): Instruction {
  return { programAddress: MEMO_PROGRAM_ID, data: new TextEncoder().encode(text) };
}

async function waitForOwners(
  endpoint: string,
  accounts: readonly Address[],
  owner: Address,
  label: string,
  polls = 60,
): Promise<void> {
  for (let i = 0; i < polls; i++) {
    const infos = await Promise.all(accounts.map((a) => getAccountBuffer(endpoint, a)));
    if (infos.every((info) => info?.owner === owner)) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main(): Promise<void> {
  const keypairPath =
    process.env.RELAYER_KEYPAIR ?? resolve(dirname(new URL(import.meta.url).pathname), "../.keys/relayer.json");
  const relayer = await loadKeypairFromDisk(keypairPath);
  const bal = await rpcCall<{ value: number }>(PRIMARY_DEVNET_RPC, "getBalance", [relayer.address], FALLBACK_DEVNET_RPC);
  console.log(`Relayer ${relayer.address} balance ${bal.value} lamports`);
  if (bal.value < 150_000_000) {
    throw new Error(`Relayer needs >= 0.15 SOL on Devnet (fund ${relayer.address} at faucet.solana.com)`);
  }

  const routes = await rpcCall<RouterRouteEntry[]>(MAGICBLOCK_ROUTER_RPC, "getRoutes", []);
  const usRoute = routes.find((r) => r.fqdn.includes("devnet-us")) ?? routes[0];
  if (!usRoute) throw new Error("MagicBlock Router returned no routes");
  const erValidatorPubkey = address(usRoute.identity);
  const erValidatorFqdn = usRoute.fqdn.replace(/\/+$/, "");
  console.log(`ER validator ${erValidatorPubkey} (${erValidatorFqdn})`);

  const erRoomProgramId = address(CARTRIDGE_PROGRAM_IDS.erRoom);
  const registryProgramId = address(CARTRIDGE_PROGRAM_IDS.registry);
  const passportProgramId = address(CARTRIDGE_PROGRAM_IDS.passport);
  const receipts: { step: string; layer: "L1" | "ER"; signature: string; url: string }[] = [];
  const record = (step: string, layer: "L1" | "ER", signature: string) => {
    const url = layer === "L1" ? solscanTxUrl(signature) : solscanTxUrl(signature, erValidatorFqdn);
    receipts.push({ step, layer, signature, url });
    console.log(`  ${layer} ${step}\n     ${url}`);
  };

  // 1. Manifest + RoomShard (relayer = creator & authority)
  const slug = `borel-live-${Date.now().toString(36)}`;
  const slugHash = sha256Bytes(slug);
  const [manifestPda] = await getProgramDerivedAddress({
    programAddress: registryProgramId,
    seeds: [Buffer.from("cartridge"), slugHash],
  });
  const durationSecs = 120;
  const registerIx = await cartridgeRegistry.getRegisterCartridgeInstructionAsync({
    creator: relayer,
    creatorFeeVault: relayer.address,
    cartridgeManifest: manifestPda,
    slugHash,
    creatorShareBps: 0,
    genreCode: 0,
    durationSecs,
    fogOfWarBps: 7500,
    maxRebalances: 2,
    scoringFormula: cartridgeRegistry.ScoringFormula.DirectionNeutralRelReturn,
    actionBindingMode: cartridgeRegistry.ActionBindingMode.ConvictionWeights,
    allowedFeedsMerkleRoot: sha256Bytes(BOREL_SLOT_MARKETS.join("|")),
    manifestUri: padUri96(`https://cartridgefi.com/borel/rooms/${slug}`),
  });
  const eventId = sha256Bytes(`${slug}:shard:0`);
  const [roomShardPda] = await cartridgeErRoom.findRoomShardPda({ eventId, shardIndex: 0 });
  const chainNow = await getChainUnixTimestamp(PRIMARY_DEVNET_RPC);
  const startTs = chainNow - 5n;
  const endTs = startTs + BigInt(durationSecs);
  const unsealTs = startTs + (BigInt(durationSecs) * 7500n) / 10_000n;
  const initShardIx = cartridgeErRoom.getInitializeRoomShardInstruction({
    authority: relayer,
    cartridgeManifest: manifestPda,
    roomShard: roomShardPda,
    eventId,
    shardIndex: 0,
    startTs,
    roomPoolUsdc: 0n,
    crankTaskId: 1n,
  });
  record(
    `register_cartridge (${slug}) + initialize_room_shard ${roomShardPda}`,
    "L1",
    await sendAndConfirmBaseTx(relayer, [registerIx, initShardIx], "register + init room shard"),
  );

  // 2. Players: fund, passports, hand commitments
  const hands: { label: string; hand: BorelLeg[]; pivot: { legIndex: 0 | 1 | 2; kind: "FLIP" | "SHIELD" } }[] = [
    {
      label: "Player A",
      hand: [
        { market: "SOL/USD", direction: "LONG", conviction: 3 },
        { market: "BTC/USD", direction: "SHORT", conviction: 1 },
        { market: "ETH/USD", direction: "LONG", conviction: 2 },
      ],
      pivot: { legIndex: 2, kind: "FLIP" },
    },
    {
      label: "Player B",
      hand: [
        { market: "NVDAx/USD", direction: "LONG", conviction: 3 },
        { market: "SOL/USD", direction: "SHORT", conviction: 2 },
        { market: "BTC/USD", direction: "LONG", conviction: 1 },
      ],
      pivot: { legIndex: 1, kind: "SHIELD" },
    },
  ];
  const players = await Promise.all(
    hands.map(async (h) => ({ ...h, signer: await generateKeyPairSigner(), session: await generateKeyPairSigner() })),
  );
  record(
    "fund 2 player keys (0.03 SOL each, relayer-sponsored)",
    "L1",
    await sendAndConfirmBaseTx(
      relayer,
      players.map((p) => ixSystemTransfer(relayer, p.signer.address, 30_000_000n)),
      "fund players",
    ),
  );
  for (const p of players) {
    const [passportPda] = await getProgramDerivedAddress({
      programAddress: passportProgramId,
      seeds: [Buffer.from("passport"), addressEncoder.encode(p.signer.address)],
    });
    const salt = createHash("sha256").update(`${p.signer.address}:${Date.now()}`).digest("hex");
    const canonical = p.hand.map((l) => `${l.market}|${l.direction}|${l.conviction}`).join(";");
    const commitment = createHash("sha256").update(`${canonical}#${salt}`).digest("hex");
    const passIx = await cartridgePassport.getInitializePassportInstructionAsync({
      payer: p.signer,
      owner: p.signer,
      passport: passportPda,
    });
    record(
      `${p.label}: initialize_passport + hand commitment sha256=${commitment.slice(0, 16)}…`,
      "L1",
      await sendAndConfirmBaseTx(
        p.signer,
        [passIx, ixMemo(`borel:v1:commit:${roomShardPda}:${p.signer.address}:${commitment}`)],
        `${p.label} passport + commitment`,
      ),
    );
  }

  // 3. Delegate RoomShard + PlayerStances to MagicBlock
  const shardDel = await deriveDelegationPdas(roomShardPda, erRoomProgramId);
  record(
    "delegate_room_shard → MagicBlock Delegation Program",
    "L1",
    await sendAndConfirmBaseTx(
      relayer,
      [
        cartridgeErRoom.getDelegateRoomShardInstruction({
          authority: relayer,
          bufferRoomShard: shardDel.buffer,
          delegationRecordRoomShard: shardDel.record,
          delegationMetadataRoomShard: shardDel.metadata,
          roomShard: roomShardPda,
          validator: erValidatorPubkey,
          eventId,
          shardIndex: 0,
        }),
      ],
      "delegate room shard",
    ),
  );
  const stancePdas: Address[] = [];
  for (const p of players) {
    const [stancePda] = await cartridgeErRoom.findPlayerStancePda({ roomShard: roomShardPda, player: p.signer.address });
    stancePdas.push(stancePda);
    const del = await deriveDelegationPdas(stancePda, erRoomProgramId);
    record(
      `${p.label}: init_stance_and_delegate (PlayerStance ${stancePda})`,
      "L1",
      await sendAndConfirmBaseTx(
        p.signer,
        [
          cartridgeErRoom.getInitStanceAndDelegateInstruction({
            player: p.signer,
            roomShard: roomShardPda,
            bufferPlayerStance: del.buffer,
            delegationRecordPlayerStance: del.record,
            delegationMetadataPlayerStance: del.metadata,
            playerStance: stancePda,
            validator: erValidatorPubkey,
            ephemeralSessionKey: p.session.address,
            sessionExpiryTs: endTs,
          }),
        ],
        `${p.label} init+delegate stance`,
      ),
    );
  }
  await waitForOwners(erValidatorFqdn, [roomShardPda, ...stancePdas], erRoomProgramId, "ER clones of shard + stances");

  // 4. ER: join (permission), sealed hand, single pivot
  const permPdas: Address[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const [permPda] = await getProgramDerivedAddress({
      programAddress: PERMISSION_PROGRAM_ID,
      seeds: [Buffer.from("permission:"), addressEncoder.encode(stancePdas[i]!)],
    });
    permPdas.push(permPda);
    record(
      `${p.label}: join_room_and_init_permission (private Fog-of-War)`,
      "ER",
      await sendAndConfirmErRouterTx(
        p.signer,
        [cartridgeErRoom.getJoinRoomAndInitPermissionInstruction({ payer: p.signer, roomShard: roomShardPda, playerStance: stancePdas[i]!, permission: permPda })],
        [roomShardPda, stancePdas[i]!, permPda],
        erValidatorFqdn,
        `${p.label} join`,
      ),
    );
  }
  const entry8 = await hermesPrices8();
  const submit = async (i: number, weights: [number, number, number, number], label: string) => {
    const p = players[i]!;
    const ix = cartridgeErRoom.getSubmitStanceInstruction({
      sessionSigner: p.session,
      roomShard: roomShardPda,
      playerStance: stancePdas[i]!,
      oracleFeed: LIVE_ER_SOL_USD_ORACLE,
      weightsBps: weights,
      kalshiBinaryCall: 0,
      kalshiProbBps: 5000,
      secondaryPrices8: [entry8["BTC/USD"]!, entry8["ETH/USD"]!, entry8["NVDAx/USD"]!],
      stage1ScoreScaled: 0n,
    });
    record(label, "ER", await sendAndConfirmErRouterTx(p.session, [ix], [roomShardPda, stancePdas[i]!], erValidatorFqdn, label));
  };
  for (let i = 0; i < players.length; i++) {
    const w = handToWeights(players[i]!.hand);
    await submit(i, w, `${players[i]!.label}: submit_stance — sealed hand weights [${w.join(",")}]`);
  }
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const pivoted = p.hand.map((leg, idx) =>
      idx !== p.pivot.legIndex
        ? leg
        : p.pivot.kind === "FLIP"
          ? { ...leg, direction: leg.direction === "LONG" ? ("SHORT" as const) : ("LONG" as const) }
          : null,
    ).filter((l): l is BorelLeg => l !== null);
    const w = handToWeights(pivoted);
    await submit(i, w, `${p.label}: submit_stance — pivot ${p.pivot.kind} leg ${p.pivot.legIndex + 1} → [${w.join(",")}] (max_rebalances=2 caps further moves)`);
  }

  // 5. ER: VRF
  const [vrfIdentity] = await getProgramDerivedAddress({ programAddress: erRoomProgramId, seeds: [Buffer.from("identity")] });
  record(
    "request_settlement_vrf (MagicBlock VRF)",
    "ER",
    await sendAndConfirmErRouterTx(
      relayer,
      [cartridgeErRoom.getRequestSettlementVrfInstruction({ authority: relayer, roomShard: roomShardPda, oracleQueue: DEFAULT_EPHEMERAL_QUEUE, programIdentity: vrfIdentity, vrfProgram: VRF_PROGRAM_ID, clientSeed: 42 })],
      [roomShardPda, DEFAULT_EPHEMERAL_QUEUE],
      erValidatorFqdn,
      "request VRF",
    ),
  );
  let vrfSeedHex = "";
  for (let i = 0; i < 60 && !vrfSeedHex; i++) {
    await sleep(500);
    const s = await getAccountBuffer(erValidatorFqdn, roomShardPda);
    if (s && s.data.length >= 197 && s.data[196] === 1) vrfSeedHex = s.data.subarray(164, 196).toString("hex");
  }
  console.log(vrfSeedHex ? `  VRF seed 0x${vrfSeedHex}` : "  VRF callback not observed within 30s (continuing)");

  // 6. ER: unseal at 75% of the clock, evaluate at 00:00
  while ((await getChainUnixTimestamp(erValidatorFqdn)) < unsealTs) await sleep(1000);
  for (let i = 0; i < players.length; i++) {
    record(
      `${players[i]!.label}: trigger_showdown_unseal`,
      "ER",
      await sendAndConfirmErRouterTx(
        relayer,
        [cartridgeErRoom.getTriggerShowdownUnsealInstruction({ authority: relayer, roomShard: roomShardPda, playerStance: stancePdas[i]!, permission: permPdas[i]! })],
        [roomShardPda, stancePdas[i]!, permPdas[i]!],
        erValidatorFqdn,
        "unseal",
      ),
    );
  }
  while ((await getChainUnixTimestamp(erValidatorFqdn)) < endTs) await sleep(1000);
  const exit8 = await hermesPrices8();
  for (let i = 0; i < players.length; i++) {
    record(
      `${players[i]!.label}: evaluate_player_score (i128 1e9 fixed point)`,
      "ER",
      await sendAndConfirmErRouterTx(
        relayer,
        [
          cartridgeErRoom.getEvaluatePlayerScoreInstruction({
            authority: relayer,
            roomShard: roomShardPda,
            playerStance: stancePdas[i]!,
            oracleFeed: LIVE_ER_SOL_USD_ORACLE,
            permission: permPdas[i]!,
            secondaryExitPrices8: [exit8["BTC/USD"]!, exit8["ETH/USD"]!, exit8["NVDAx/USD"]!],
            betaBenchScaled: 0n,
            lambdaDdScaled: 500_000_000n,
            kalshiOutcomeYes: 2,
            maxMultiplierScaled: SCALE_9,
          }),
        ],
        [roomShardPda, stancePdas[i]!, permPdas[i]!],
        erValidatorFqdn,
        "evaluate",
      ),
    );
  }

  // 7. Commit + undelegate to L1
  for (let i = 0; i < players.length; i++) {
    record(
      `${players[i]!.label}: undelegate_player_stance (commit → L1)`,
      "ER",
      await sendAndConfirmErRouterTx(
        relayer,
        [cartridgeErRoom.getUndelegatePlayerStanceInstruction({ authority: relayer, roomShard: roomShardPda, playerStance: stancePdas[i]! })],
        [stancePdas[i]!],
        erValidatorFqdn,
        "undelegate stance",
      ),
    );
  }
  const [shardPermPda] = await getProgramDerivedAddress({
    programAddress: PERMISSION_PROGRAM_ID,
    seeds: [Buffer.from("permission:"), addressEncoder.encode(roomShardPda)],
  });
  const rawSettle = cartridgeErRoom.getSettleAndCommitShardInstruction({
    authority: relayer,
    roomShard: roomShardPda,
    oracleFeed: LIVE_ER_SOL_USD_ORACLE,
    permission: shardPermPda,
    scheduleVaultAction: false,
    vaultActionAccounts: [],
  });
  const settleIx: Instruction = {
    programAddress: rawSettle.programAddress,
    data: rawSettle.data,
    accounts: rawSettle.accounts.map((meta) =>
      meta.address === shardPermPda || meta.address === "MagicVau1t999999999999999999999999999999999"
        ? { ...meta, role: AccountRole.READONLY }
        : meta,
    ),
  };
  record(
    "settle_and_commit_shard (commit + undelegate RoomShard → L1)",
    "ER",
    await sendAndConfirmErRouterTx(relayer, [settleIx], [roomShardPda], erValidatorFqdn, "settle + commit shard"),
  );
  await waitForOwners(PRIMARY_DEVNET_RPC, [roomShardPda, ...stancePdas], erRoomProgramId, "L1 undelegation restore", 90);
  console.log("  ✓ RoomShard + PlayerStances restored on Solana Devnet L1");

  // 7b. Own-authority steps (relayer = test-USDC mint authority + PassportConfig admin/keeper):
  //     SPL stakes in Borel test-USDC → winner settlement with a 1% fee into platformFeeAccount → record_elo.
  const deployment = JSON.parse(
    readFileSync(resolve(dirname(new URL(import.meta.url).pathname), "../apps/web/src/data/borel-deployment.json"), "utf8"),
  ) as { testUsdcMint: string; platformFeeAccount: string };
  const usdcMint = address(deployment.testUsdcMint);
  const platformFeeAccount = address(deployment.platformFeeAccount);
  const STAKE_UNITS = 10_000_000n; // 10 test-USDC per player
  const escrowAta = await deriveCanonicalAta(relayer.address, usdcMint);
  const playerAtas = await Promise.all(players.map((p) => deriveCanonicalAta(p.signer.address, usdcMint)));
  record(
    "faucet: mint 100 test-USDC to each player ATA (relayer = mint authority)",
    "L1",
    await sendAndConfirmBaseTx(
      relayer,
      [
        ixCreateAssociatedTokenAccountIdempotent(relayer, escrowAta, relayer.address, usdcMint),
        ...players.flatMap((p, i) => [
          ixCreateAssociatedTokenAccountIdempotent(relayer, playerAtas[i]!, p.signer.address, usdcMint),
          ixMintTo(usdcMint, playerAtas[i]!, relayer, 100_000_000n),
        ]),
      ],
      "faucet mint",
    ),
  );
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    record(
      `${p.label}: SPL stake 10 test-USDC → room escrow ${escrowAta}`,
      "L1",
      await sendAndConfirmBaseTx(p.signer, [ixTransferChecked(playerAtas[i]!, usdcMint, escrowAta, p.signer, STAKE_UNITS, 6)], `${p.label} stake`),
    );
  }
  const finalScores: bigint[] = [];
  for (const stance of stancePdas) {
    const acct = await getAccountBuffer(PRIMARY_DEVNET_RPC, stance, FALLBACK_DEVNET_RPC);
    finalScores.push(acct && acct.data.length >= 262 ? acct.data.readBigInt64LE(246) + (acct.data.readBigInt64LE(254) << 64n) : 0n);
  }
  const winnerIdx = finalScores[1]! > finalScores[0]! ? 1 : 0;
  const poolUnits = STAKE_UNITS * BigInt(players.length);
  const feeUnits = (poolUnits * BigInt(RELAYER_PLATFORM_FEE_BPS)) / 10_000n;
  record(
    `settle: winner ${players[winnerIdx]!.label} (final_score ${finalScores[winnerIdx]}) paid ${poolUnits - feeUnits} units + ${feeUnits} units (1%) → platformFeeAccount ${platformFeeAccount}`,
    "L1",
    await sendAndConfirmBaseTx(
      relayer,
      [
        ixTransferChecked(escrowAta, usdcMint, playerAtas[winnerIdx]!, relayer, poolUnits - feeUnits, 6),
        ixTransferChecked(escrowAta, usdcMint, platformFeeAccount, relayer, feeUnits, 6),
      ],
      "settle with fee",
    ),
  );
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const [passportPda] = await getProgramDerivedAddress({
      programAddress: passportProgramId,
      seeds: [Buffer.from("passport"), addressEncoder.encode(p.signer.address)],
    });
    const isWin = i === winnerIdx;
    record(
      `${p.label}: cartridge_passport.record_elo_and_vault_credit (${isWin ? "win" : "loss"}, relayer = PassportConfig admin)`,
      "L1",
      await sendAndConfirmBaseTx(
        relayer,
        [
          await cartridgePassport.getRecordEloAndVaultCreditInstructionAsync({
            authority: relayer,
            passport: passportPda,
            roomMeanEloScaled: 1_500n * SCALE_9,
            placementScoreScaled: isWin ? SCALE_9 : 0n,
            isLiveMode: true,
            isWin,
            sharpeScoreScaled: null,
            brierScoreScaled: null,
            assetCreditKind: cartridgePassport.AssetCreditKind.Usdc,
            assetCreditUnits: isWin ? poolUnits - feeUnits : 0n,
          }),
        ],
        `${p.label} record_elo`,
      ),
    );
  }

  // 8. Append real links to docs/DEVNET_PROOF.md
  const docPath = resolve(dirname(new URL(import.meta.url).pathname), "../docs/DEVNET_PROOF.md");
  const lines = [
    "",
    "---",
    "",
    `## Borel live run (own authority) — ${new Date().toISOString()}`,
    "",
    `Relayer authority \`${relayer.address}\` = upgrade authority of the redeployed programs (registry \`${registryProgramId}\`, er_room \`${erRoomProgramId}\`, passport \`${passportProgramId}\`), test-USDC mint authority (\`${usdcMint}\`) and PassportConfig admin; fees land in platformFeeAccount [\`${platformFeeAccount}\`](${solscanAccountUrl(platformFeeAccount)}). Room \`${slug}\`, RoomShard [\`${roomShardPda}\`](${solscanAccountUrl(roomShardPda)}), VRF seed \`${vrfSeedHex ? `0x${vrfSeedHex}` : "not observed"}\`.`,
    "Hand → slot mapping: [SOL/USD, BTC/USD, ETH/USD, NVDAx/USD], weight_bps = ±conviction × 1000; one pivot enforced on-chain by max_rebalances = 2. SPL stakes (10 test-USDC each) are escrowed in the relayer ATA and settled to the highest on-chain final_score with a 1% fee into platformFeeAccount; cartridge_vault_router.distribute_pool_and_fees is not exercised in this run.",
    "",
    "| Step | Layer | Solscan |",
    "| :--- | :--- | :--- |",
    ...receipts.map((r) => `| ${r.step.replace(/\|/g, "/")} | ${r.layer === "L1" ? "Solana Devnet L1" : "MagicBlock ER"} | [\`${r.signature.slice(0, 16)}…\`](${r.url}) |`),
    "",
  ];
  writeFileSync(docPath, readFileSync(docPath, "utf8") + lines.join("\n"));
  console.log(`\nAppended ${receipts.length} receipts to docs/DEVNET_PROOF.md`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
