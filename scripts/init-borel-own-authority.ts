/**
 * Borel — one-time Devnet admin initialization for the programs redeployed under OUR authority.
 *
 * Signer: the relayer (`.keys/relayer.json`, override with RELAYER_KEYPAIR) = upgrade authority,
 * EngineConfig admin, PassportConfig admin + keeper, and test-USDC mint authority.
 *
 *   1. test-USDC mint (6 decimals, relayer = mint authority) at `.keys/borel-test-usdc-mint.json`
 *   2. platformFeeAccount = ATA(treasury `.keys/borel-treasury.json`, test-USDC)
 *   3. cartridge_registry.initialize_engine_config(admin = relayer, platformFeeAccount, private beta caps)
 *   4. cartridge_passport.initialize_passport_config(admin = relayer, keeper = relayer)
 *
 * Idempotent: every step is skipped when the target account already exists.
 * Writes the resulting addresses to `apps/web/src/data/borel-deployment.json`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

import {
  CARTRIDGE_PROGRAM_IDS,
  cartridgePassport,
  cartridgeRegistry,
} from "@cartridgefi/codama-clients";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINT_SPACE = 82n;
const BETA_MAX_ROOM_POOL_USDC = 500_000_000n;
const BETA_MAX_GLOBAL_TVL_USDC = 5_000_000_000n;

const addressEncoder = getAddressEncoder();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: attempt + 1, method, params }),
      });
      if (res.status === 429) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      const parsed = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
      if (parsed.error) {
        throw new Error(`RPC ${method} failed (${parsed.error.code}): ${parsed.error.message} ${JSON.stringify(parsed.error.data ?? "")}`);
      }
      return parsed.result as T;
    } catch (err) {
      lastErr = err;
      if (String(err).includes("failed (")) throw err;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function accountExists(pubkey: Address): Promise<boolean> {
  const info = await rpcCall<{ value: unknown }>("getAccountInfo", [pubkey, { encoding: "base64", commitment: "confirmed" }]);
  return info.value !== null;
}

async function loadSigner(path: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

async function deriveAta(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [addressEncoder.encode(owner), addressEncoder.encode(TOKEN_PROGRAM_ID), addressEncoder.encode(mint)],
  });
  return ata;
}

async function sendAndConfirm(feePayer: KeyPairSigner, instructions: readonly Instruction[], label: string): Promise<string> {
  const bh = await rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: bh.value.blockhash as never, lastValidBlockHeight: BigInt(bh.value.lastValidBlockHeight) },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  await rpcCall<string>("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]);
  for (let i = 0; i < 60; i++) {
    await sleep(700);
    const st = await rpcCall<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
    const entry = st.value[0];
    if (entry?.err) throw new Error(`[${label}] tx ${sig} failed: ${JSON.stringify(entry.err)}`);
    if (entry?.confirmationStatus === "confirmed" || entry?.confirmationStatus === "finalized") {
      console.log(`  ✓ ${label}: https://solscan.io/tx/${sig}?cluster=devnet`);
      return sig;
    }
  }
  throw new Error(`[${label}] timed out confirming ${sig}`);
}

async function main(): Promise<void> {
  const relayer = await loadSigner(process.env.RELAYER_KEYPAIR ?? resolve(REPO_ROOT, ".keys/relayer.json"));
  const mintKpPath = resolve(REPO_ROOT, ".keys/borel-test-usdc-mint.json");
  const treasuryPath = resolve(REPO_ROOT, ".keys/borel-treasury.json");
  if (!existsSync(mintKpPath) || !existsSync(treasuryPath)) {
    throw new Error("Missing .keys/borel-test-usdc-mint.json or .keys/borel-treasury.json (generate with solana-keygen).");
  }
  const mint = await loadSigner(mintKpPath);
  const treasury = await loadSigner(treasuryPath);
  const platformFeeAccount = await deriveAta(treasury.address, mint.address);
  const [engineConfig] = await cartridgeRegistry.findEngineConfigPda();
  const [passportConfig] = await cartridgePassport.findPassportConfigPda();
  const signatures: Record<string, string> = {};

  console.log(`Relayer/admin ${relayer.address} | mint ${mint.address} | platformFeeAccount ${platformFeeAccount}`);

  if (!(await accountExists(mint.address))) {
    const rent = await rpcCall<number>("getMinimumBalanceForRentExemption", [Number(MINT_SPACE)]);
    const create = Buffer.alloc(52);
    create.writeUInt32LE(0, 0);
    create.writeBigUInt64LE(BigInt(rent), 4);
    create.writeBigUInt64LE(MINT_SPACE, 12);
    Buffer.from(addressEncoder.encode(TOKEN_PROGRAM_ID)).copy(create, 20);
    const initMint = Buffer.alloc(35);
    initMint.writeUInt8(20, 0); // InitializeMint2
    initMint.writeUInt8(6, 1);
    Buffer.from(addressEncoder.encode(relayer.address)).copy(initMint, 2);
    initMint.writeUInt8(0, 34); // no freeze authority
    signatures.createMint = await sendAndConfirm(
      relayer,
      [
        {
          programAddress: SYSTEM_PROGRAM_ID,
          accounts: [
            { address: relayer.address, role: AccountRole.WRITABLE_SIGNER, signer: relayer } as never,
            { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint } as never,
          ],
          data: new Uint8Array(create),
        },
        { programAddress: TOKEN_PROGRAM_ID, accounts: [{ address: mint.address, role: AccountRole.WRITABLE }], data: new Uint8Array(initMint) },
      ],
      "create test-USDC mint (6 dp, relayer mint authority)",
    );
  } else {
    console.log("  • test-USDC mint already exists");
  }

  if (!(await accountExists(platformFeeAccount))) {
    signatures.createPlatformFeeAccount = await sendAndConfirm(
      relayer,
      [
        {
          programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
          accounts: [
            { address: relayer.address, role: AccountRole.WRITABLE_SIGNER, signer: relayer } as never,
            { address: platformFeeAccount, role: AccountRole.WRITABLE },
            { address: treasury.address, role: AccountRole.READONLY },
            { address: mint.address, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
          ],
          data: new Uint8Array([1]), // CreateIdempotent
        },
      ],
      "create platformFeeAccount (treasury ATA)",
    );
  } else {
    console.log("  • platformFeeAccount already exists");
  }

  if (!(await accountExists(engineConfig))) {
    const ix = await cartridgeRegistry.getInitializeEngineConfigInstructionAsync({
      adminMultisig: relayer,
      platformFeeAccount,
      privateBetaMode: true,
      maxRoomPoolUsdc: BETA_MAX_ROOM_POOL_USDC,
      maxGlobalTvlUsdc: BETA_MAX_GLOBAL_TVL_USDC,
    });
    signatures.initializeEngineConfig = await sendAndConfirm(relayer, [ix], "cartridge_registry.initialize_engine_config");
  } else {
    console.log("  • EngineConfig already initialized");
  }

  if (!(await accountExists(passportConfig))) {
    const ix = await cartridgePassport.getInitializePassportConfigInstructionAsync({
      admin: relayer,
      keeperAuthority: relayer.address,
    });
    signatures.initializePassportConfig = await sendAndConfirm(relayer, [ix], "cartridge_passport.initialize_passport_config");
  } else {
    console.log("  • PassportConfig already initialized");
  }

  const outPath = resolve(REPO_ROOT, "apps/web/src/data/borel-deployment.json");
  const previous = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as { initSignatures?: Record<string, string> }) : {};
  const out = {
    cluster: "devnet",
    deployedAt: new Date().toISOString(),
    authority: relayer.address,
    programs: CARTRIDGE_PROGRAM_IDS,
    testUsdcMint: mint.address,
    testUsdcDecimals: 6,
    treasury: treasury.address,
    platformFeeAccount,
    engineConfig,
    passportConfig,
    initSignatures: { ...(previous.initSignatures ?? {}), ...signatures },
  };
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
