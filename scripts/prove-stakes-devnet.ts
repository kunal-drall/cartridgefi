/**
 * Borel — real test-USDC stakes + vault-router payouts on Solana Devnet (relayer = our own authority).
 *
 * Two generated wallets (no SOL; test-USDC from the relayer-run faucet) play one room end to end. The stake,
 * distribution, claim and ELO steps call the SAME module the app's API routes use
 * (apps/web/src/lib/borel/stakes-core.ts), with the same per-(room, session) derived player keys:
 *
 *   L1  faucet: mint 100 test-USDC to each wallet (relayer = mint authority)
 *   L1  register_cartridge + initialize_room_shard (relayer authority) + delegate_room_shard
 *   L1  join ×2: init_stance_and_delegate for the derived player keys (relayer-funded, swept back; the relayer
 *       co-signs as room authority)
 *   L1  cartridge_vault_router.initialize_room_vault (fixed buy-in, 8-seat cap, fee-routing manifest)
 *   L1  stake ×2: ONE wallet signature each — wallet ATA (funder) → open_session_envelope → vault PDA
 *       (relayer = fee payer, envelope rent and room-authority co-signer; player key co-signs; MarketPassport
 *       initialized for the wallet)
 *   ER  join_room_and_init_permission ×2 and submit_stance ×2 before start_ts (authority co-signed, attested entry
 *       prices), one pivot while live, request_settlement_vrf, trigger_showdown_unseal ×2, evaluate_player_score ×2,
 *       undelegate_player_stance ×2, settle_and_commit_shard (→ L1, SettledCommitted)
 *   L1  distribute_pool_and_fees: 1% fee → platformFeeAccount, Harmonic Shapley payouts into envelopes
 *   L1  claim_prize ×winners → straight into the funding wallet's ATA (program-pinned destination)
 *   L1  cartridge_passport.record_elo_and_vault_credit ×2, bound to the settled envelopes, MatchCredit receipts
 *
 * Run: node scripts/prove-stakes-devnet.ts   (RELAYER_KEYPAIR overrides .keys/relayer.json;
 *      SOLANA_RPC_URL=https://rpc.magicblock.app/devnet avoids public-RPC 429s)
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
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
  type Transaction,
} from "@solana/kit";
import { CARTRIDGE_PROGRAM_IDS, cartridgeErRoom, cartridgePassport, cartridgeRegistry } from "@cartridgefi/codama-clients";

import {
  createAtaIdempotentIx,
  deriveAta,
  distributeAndPay,
  ensureRoomVault,
  finalizeStakeTransaction,
  findPassportPda,
  findVaultPdas,
  buildStakeTransaction,
  mintToIx,
  readRoomVault,
  sendSignedAndConfirm,
  STAKE_BUY_IN_UNITS,
  systemTransferIx,
  type StakeChain,
} from "../apps/web/src/lib/borel/stakes-core.ts";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DEVNET_RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const MAGICBLOCK_ROUTER_RPC = process.env.MAGICBLOCK_ROUTER_URL ?? "https://devnet-router.magicblock.app";
const PERMISSION_PROGRAM_ID = address("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const VRF_PROGRAM_ID = address("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const DEFAULT_EPHEMERAL_QUEUE = address("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
const LIVE_ER_SOL_USD_ORACLE = address("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const SCALE_9 = 1_000_000_000n;
// Fixed per-tier buy-in (audit H2): both players stake the BLITZ_3M tier amount (10 test-USDC).
const STAKES: bigint[] = [STAKE_BUY_IN_UNITS.BLITZ_3M, STAKE_BUY_IN_UNITS.BLITZ_3M];
const FAUCET_UNITS = 100_000_000n;
const PLAYER_FUNDING_LAMPORTS = 20_000_000n;
const DURATION_SECS = 60;

const addressEncoder = getAddressEncoder();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function solscanTx(sig: string, customRpc?: string): string {
  return customRpc
    ? `https://solscan.io/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(customRpc)}`
    : `https://solscan.io/tx/${sig}?cluster=devnet`;
}
const solscanAccount = (a: string) => `https://solscan.io/account/${a}?cluster=devnet`;

// ---------------------------------------------------------------------------
// Raw JSON-RPC (ER endpoints) + helpers
// ---------------------------------------------------------------------------

async function rpcCall<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() + attempt, method, params }),
      });
      if (res.status === 429) {
        lastErr = new Error(`RPC ${method} on ${endpoint}: HTTP 429`);
        await sleep(700 * (attempt + 1));
        continue;
      }
      const parsed = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
      if (parsed.error) throw new Error(`RPC ${method} on ${endpoint}: ${parsed.error.message} ${parsed.error.data ? JSON.stringify(parsed.error.data).slice(0, 600) : ""}`);
      return parsed.result as T;
    } catch (err) {
      lastErr = err;
      if (String(err).includes("custom program error") || String(err).includes("Error processing Instruction")) break;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function accountInfo(endpoint: string, pubkey: Address): Promise<{ owner: string; data: Buffer } | null> {
  const res = await rpcCall<{ value: { owner: string; data: [string, string] } | null }>(endpoint, "getAccountInfo", [
    pubkey,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  return res.value ? { owner: res.value.owner, data: Buffer.from(res.value.data[0], "base64") } : null;
}

async function chainUnixTs(endpoint: string): Promise<bigint> {
  const clock = await accountInfo(endpoint, address("SysvarC1ock11111111111111111111111111111111"));
  return clock && clock.data.length >= 40 ? clock.data.readBigInt64LE(32) : BigInt(Math.floor(Date.now() / 1000));
}

async function waitForOwners(endpoint: string, accounts: readonly Address[], owner: string, label: string, polls = 90): Promise<void> {
  for (let i = 0; i < polls; i += 1) {
    const infos = await Promise.all(accounts.map((a) => accountInfo(endpoint, a)));
    if (infos.every((info) => info?.owner === owner)) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Public devnet RPC rate-limits bursts: retry 429 / transient failures with backoff. */
function retryingRpc(url: string) {
  const base = createDefaultRpcTransport({ url });
  const transport = (async (req: Parameters<typeof base>[0]) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await base(req);
      } catch (err) {
        if (attempt >= 6 || !/429|Too Many Requests|fetch failed|ECONNRESET/i.test(String(err))) throw err;
        await sleep(500 * (attempt + 1));
      }
    }
  }) as typeof base;
  return createSolanaRpcFromTransport(transport);
}

async function tokenBalance(rpc: ReturnType<typeof retryingRpc>, ata: Address): Promise<bigint> {
  try {
    const { value } = await rpc.getTokenAccountBalance(ata, { commitment: "confirmed" }).send();
    return BigInt(value.amount);
  } catch {
    return 0n;
  }
}

async function signAndSend(endpoint: string, feePayer: KeyPairSigner, ixs: Instruction[], label: string, blockhashFor?: Address[]): Promise<string> {
  // ER txs go through the Magic Router; when it cannot route the account set (e.g. the VRF oracle queue
  // lives on another node) fall back to the room's ER validator directly, as prove-live-devnet.ts does.
  let sendTo = endpoint;
  let bh: { blockhash: string; lastValidBlockHeight: number };
  if (blockhashFor) {
    try {
      bh = await rpcCall<{ blockhash: string; lastValidBlockHeight: number }>(MAGICBLOCK_ROUTER_RPC, "getBlockhashForAccounts", [blockhashFor]);
      sendTo = MAGICBLOCK_ROUTER_RPC;
    } catch {
      bh = (await rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>(endpoint, "getLatestBlockhash", [{ commitment: "confirmed" }])).value;
    }
  } else {
    bh = (await rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>(endpoint, "getLatestBlockhash", [{ commitment: "confirmed" }])).value;
  }
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash as never, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  try {
    await rpcCall<string>(sendTo, "sendTransaction", [
      getBase64EncodedWireTransaction(signed),
      { encoding: "base64", preflightCommitment: "confirmed" },
    ]);
  } catch (err) {
    if (!String(err).includes("already been processed")) throw new Error(`[${label}] ${String(err)}`);
  }
  const statusEndpoint = blockhashFor ? endpoint : DEVNET_RPC;
  for (let i = 0; i < 90; i += 1) {
    await sleep(blockhashFor ? 300 : 700);
    const st = await rpcCall<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>(statusEndpoint, "getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
    const entry = st.value[0];
    if (entry?.err) throw new Error(`[${label}] tx ${sig} failed: ${JSON.stringify(entry.err)}`);
    if (entry && (blockhashFor || entry.confirmationStatus === "confirmed" || entry.confirmationStatus === "finalized")) return sig;
  }
  throw new Error(`[${label}] timed out confirming ${sig}`);
}

/** Pyth PriceUpdateV2 push feeds (Solana mainnet) for the secondary slots, scaled to 1e8. */
const SLOT_FEEDS: Record<string, { account: string; feedId: string }> = {
  "BTC/USD": { account: "APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5", feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
  "ETH/USD": { account: "7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH", feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
  "NVDAx/USD": { account: "VSgf6jkwrcs9jbLuR57iN1Gk2c68vT9stZe8G6GGix2", feedId: "4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f" },
};
async function secondaryPrices8(): Promise<[bigint, bigint, bigint]> {
  const markets = ["BTC/USD", "ETH/USD", "NVDAx/USD"];
  const res = await rpcCall<{ value: ({ data: [string, string] } | null)[] }>(process.env.PYTH_MAINNET_RPC ?? "https://solana-rpc.publicnode.com", "getMultipleAccounts", [
    markets.map((m) => SLOT_FEEDS[m]!.account),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const out = markets.map((m, i) => {
    const acct = res.value[i];
    if (!acct) throw new Error(`Pyth push feed missing for ${m}`);
    const bytes = Buffer.from(acct.data[0], "base64");
    let o = 8 + 32;
    o += bytes[o] === 0 ? 2 : 1;
    if (bytes.subarray(o, o + 32).toString("hex") !== SLOT_FEEDS[m]!.feedId) throw new Error(`Feed id mismatch for ${m}`);
    o += 32;
    const price = bytes.readBigInt64LE(o);
    const expo = bytes.readInt32LE(o + 16);
    const shift = 8 + expo;
    return shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
  });
  return [out[0]!, out[1]!, out[2]!];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const keyPath = process.env.RELAYER_KEYPAIR ?? resolve(ROOT, ".keys/relayer.json");
  const secret = new Uint8Array(JSON.parse(readFileSync(keyPath, "utf8")) as number[]);
  const relayer = await createKeyPairSignerFromBytes(secret);
  // Same domain-separated key material as apps/web/src/lib/relayer/config.ts deriveRelayerKeyMaterial().
  const secretB58 = getBase58Decoder().decode(secret);
  const keyMaterial = (domain: string) => new Uint8Array(createHmac("sha256", secretB58).update(domain).digest());
  const deployment = JSON.parse(readFileSync(resolve(ROOT, "apps/web/src/data/borel-deployment.json"), "utf8")) as {
    authority: string;
    testUsdcMint: string;
    testUsdcDecimals: number;
    platformFeeAccount: string;
  };
  if (relayer.address !== deployment.authority) throw new Error(`Relayer ${relayer.address} is not the deployment authority`);
  const rpc = retryingRpc(DEVNET_RPC);
  const startLamports = (await rpc.getBalance(relayer.address).send()).value;
  console.log(`Relayer ${relayer.address}: ${startLamports} lamports`);
  if (startLamports < 300_000_000n) throw new Error("Relayer needs >= 0.3 devnet SOL");

  const receipts: { step: string; layer: "L1" | "ER"; signature: string; url: string }[] = [];
  let erFqdn = "";
  const record = (step: string, layer: "L1" | "ER", signature: string) => {
    const url = layer === "L1" ? solscanTx(signature) : solscanTx(signature, erFqdn);
    receipts.push({ step, layer, signature, url });
    console.log(`  ${new Date().toISOString()} ${layer} ${step}\n     ${url}`);
  };

  const chain: StakeChain = {
    rpc,
    relayer,
    mint: address(deployment.testUsdcMint),
    decimals: deployment.testUsdcDecimals,
    platformFeeAccount: address(deployment.platformFeeAccount),
    send: async (label, ixs) => {
      const sig = await signAndSend(DEVNET_RPC, relayer, ixs, label);
      record(label, "L1", sig);
      return sig;
    },
    mac: (body) => createHmac("sha256", keyMaterial("borel:stake-memo:v1")).update(body).digest("hex").slice(0, 32),
  };

  const routes = await rpcCall<{ identity: string; fqdn: string }[]>(MAGICBLOCK_ROUTER_RPC, "getRoutes", []);
  const route = routes.find((r) => r.fqdn.includes("devnet-us")) ?? routes[0];
  if (!route) throw new Error("MagicBlock Router returned no routes");
  const validator = address(route.identity);
  erFqdn = route.fqdn.replace(/\/+$/, "");
  console.log(`ER validator ${validator} (${erFqdn})`);
  const erRoomProgram = address(CARTRIDGE_PROGRAM_IDS.erRoom);

  // 1. Wallets + faucet (wallets hold no SOL: the relayer pays every fee and every rent)
  const wallets = [await generateKeyPairSigner(), await generateKeyPairSigner()];
  const sessions = [await generateKeyPairSigner(), await generateKeyPairSigner()];
  const walletAtas = await Promise.all(wallets.map((w) => deriveAta(w.address, chain.mint)));
  const feeBefore = await tokenBalance(rpc, chain.platformFeeAccount);
  record(
    `faucet: mint ${FAUCET_UNITS} units test-USDC to wallets ${wallets.map((w) => w.address).join(", ")}`,
    "L1",
    await signAndSend(
      DEVNET_RPC,
      relayer,
      wallets.flatMap((w, i) => [createAtaIdempotentIx(relayer, walletAtas[i]!, w.address, chain.mint), mintToIx(chain.mint, walletAtas[i]!, relayer, FAUCET_UNITS)]),
      "faucet",
    ),
  );

  // 2. Room: manifest + RoomShard + delegation (relayer authority)
  const roomId = `borel-stakes-${Date.now().toString(36)}`;
  const slugHash = new Uint8Array(createHash("sha256").update(roomId).digest());
  const [manifestPda] = await getProgramDerivedAddress({ programAddress: address(CARTRIDGE_PROGRAM_IDS.registry), seeds: [Buffer.from("cartridge"), slugHash] });
  const eventId = new Uint8Array(createHash("sha256").update(`${roomId}:shard:0`).digest());
  const [roomShard] = await cartridgeErRoom.findRoomShardPda({ eventId, shardIndex: 0 });
  // The sealed entry must land before start_ts, so leave room for setup (room, joins, vault, stakes, ER joins).
  const startTs = (await chainUnixTs(DEVNET_RPC)) + 240n;
  const endTs = startTs + BigInt(DURATION_SECS);
  const unsealTs = startTs + (BigInt(DURATION_SECS) * 7500n) / 10_000n;
  const uri = new Uint8Array(96);
  uri.set(Buffer.from(`https://cartridgefi.com/borel/rooms/${roomId}`).subarray(0, 96));
  record(
    `register_cartridge (${roomId}) + initialize_room_shard ${roomShard} + delegate_room_shard`,
    "L1",
    await signAndSend(
      DEVNET_RPC,
      relayer,
      [
        await cartridgeRegistry.getRegisterCartridgeInstructionAsync({
          creator: relayer,
          creatorFeeVault: relayer.address,
          cartridgeManifest: manifestPda,
          slugHash,
          creatorShareBps: 0,
          genreCode: 0,
          durationSecs: DURATION_SECS,
          fogOfWarBps: 7500,
          maxRebalances: 2,
          scoringFormula: cartridgeRegistry.ScoringFormula.DirectionNeutralRelReturn,
          actionBindingMode: cartridgeRegistry.ActionBindingMode.ConvictionWeights,
          allowedFeedsMerkleRoot: new Uint8Array(createHash("sha256").update("SOL/USD|BTC/USD|ETH/USD|NVDAx/USD").digest()),
          manifestUri: uri,
        }),
        cartridgeErRoom.getInitializeRoomShardInstruction({
          authority: relayer,
          cartridgeManifest: manifestPda,
          roomShard,
          eventId,
          shardIndex: 0,
          startTs,
          roomPoolUsdc: 0n,
          crankTaskId: 1n,
        }),
        await cartridgeErRoom.getDelegateRoomShardInstructionAsync({ authority: relayer, roomShard, validator, eventId, shardIndex: 0 }),
      ],
      "room",
    ),
  );

  // 3. Join ×2 exactly like /api/borel/join: derived player + session keys per (room, session)
  const players: KeyPairSigner[] = [];
  const sessionKeys: KeyPairSigner[] = [];
  const stances: Address[] = [];
  for (let i = 0; i < 2; i += 1) {
    const player = await createKeyPairSignerFromPrivateKeyBytes(keyMaterial(`borel:player:v1:${roomId}:${sessions[i]!.address}`));
    const sessionKey = await createKeyPairSignerFromPrivateKeyBytes(keyMaterial(`borel:session:v1:${roomId}:${sessions[i]!.address}`));
    players.push(player);
    sessionKeys.push(sessionKey);
    const [stance] = await cartridgeErRoom.findPlayerStancePda({ roomShard, player: player.address });
    stances.push(stance);
    record(
      `join ${i === 0 ? "A" : "B"}: init_stance_and_delegate (derived player ${player.address})`,
      "L1",
      await signAndSend(
        DEVNET_RPC,
        relayer,
        [
          systemTransferIx(relayer, player.address, PLAYER_FUNDING_LAMPORTS),
          await cartridgeErRoom.getInitStanceAndDelegateInstructionAsync({
            player,
            roomShard,
            validator,
            roomAuthority: relayer,
            ephemeralSessionKey: sessionKey.address,
            sessionExpiryTs: endTs,
          }),
        ],
        `join ${i}`,
      ),
    );
    const { value: left } = await rpc.getBalance(player.address, { commitment: "confirmed" }).send();
    if (left > 0n) {
      record(
        `join ${i === 0 ? "A" : "B"}: sweep ${left} lamports from derived player back to relayer`,
        "L1",
        await signAndSend(DEVNET_RPC, relayer, [systemTransferIx(player, relayer.address, left)], `sweep ${i}`),
      );
    }
  }

  // 4. Vault + stakes (the exact build the API route returns; the wallet signs the issued message bytes)
  await ensureRoomVault(chain, roomShard, STAKE_BUY_IN_UNITS.BLITZ_3M);
  for (let i = 0; i < 2; i += 1) {
    const built = await buildStakeTransaction(chain, {
      roomShard,
      player: players[i]!,
      wallet: createNoopSigner(wallets[i]!.address),
      session: sessions[i]!.address,
      ephemeralSessionKey: sessionKeys[i]!.address,
      amountUnits: STAKES[i]!,
    });
    // Browser-wallet equivalent: sign the issued (unsigned) message bytes without modifying them; the server
    // then adds the relayer + player signatures, exactly like POST /api/borel/stake {action:"submit"}.
    const [walletSigs] = await wallets[i]!.signTransactions([built.transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number]]);
    const walletSigned: Transaction = { ...built.transaction, signatures: { ...built.transaction.signatures, ...walletSigs } };
    const sig = await sendSignedAndConfirm(rpc, await finalizeStakeTransaction(chain, walletSigned, players[i]!));
    record(
      `stake ${i === 0 ? "A" : "B"}: ${STAKES[i]} units, ONE wallet signature (${wallets[i]!.address}); relayer fee payer; open_session_envelope → envelope ${built.envelope}${built.passportInitialized ? " + initialize_passport(wallet)" : ""}`,
      "L1",
      sig,
    );
  }
  const vault = await readRoomVault(chain, roomShard);
  const { vaultUsdcToken } = await findVaultPdas(roomShard);
  console.log(`  room vault ${vault?.address}: pool ${vault?.state.roomPoolUsdc} units, vault token ${await tokenBalance(rpc, vaultUsdcToken)} units`);

  // 5. MagicBlock ER lifecycle
  await waitForOwners(erFqdn, [roomShard, ...stances], erRoomProgram, "ER clones of shard + stances");
  const perms: Address[] = [];
  for (let i = 0; i < 2; i += 1) {
    const [perm] = await getProgramDerivedAddress({ programAddress: PERMISSION_PROGRAM_ID, seeds: [Buffer.from("permission:"), addressEncoder.encode(stances[i]!)] });
    perms.push(perm);
    record(
      `join_room_and_init_permission ${i === 0 ? "A" : "B"} (private Fog-of-War)`,
      "ER",
      await signAndSend(
        erFqdn,
        relayer,
        [cartridgeErRoom.getJoinRoomAndInitPermissionInstruction({ payer: relayer, roomShard, playerStance: stances[i]!, permission: perm, roomAuthority: relayer })],
        `er join ${i}`,
        [roomShard, stances[i]!, perm],
      ),
    );
  }
  const weights: [number, number, number, number][] = [
    [3000, -1000, 2000, 0],
    [-2000, 1000, 0, 3000],
  ];
  const submitIx = (i: number, w: [number, number, number, number], prices8: [bigint, bigint, bigint], stage1: bigint) =>
    cartridgeErRoom.getSubmitStanceInstruction({
      sessionSigner: sessionKeys[i]!,
      roomShard,
      playerStance: stances[i]!,
      oracleFeed: LIVE_ER_SOL_USD_ORACLE,
      // The room authority co-signs: it attests the entry prices and the timing of every move.
      roomAuthority: relayer,
      weightsBps: w,
      kalshiBinaryCall: 0,
      kalshiProbBps: 5000,
      secondaryPrices8: prices8,
      stage1ScoreScaled: stage1,
    });
  // Sealed entries land BEFORE start_ts (cartridge_er_room rejects a first move at or after start_ts).
  const erNow = await chainUnixTs(erFqdn);
  if (erNow >= startTs) throw new Error(`Setup overran start_ts (ER clock ${erNow} >= ${startTs}); rerun`);
  const entry = await secondaryPrices8();
  for (let i = 0; i < 2; i += 1) {
    record(
      `submit_stance ${i === 0 ? "A" : "B"}: sealed weights [${weights[i]!.join(",")}] before start_ts (session key + room authority)`,
      "ER",
      await signAndSend(erFqdn, relayer, [submitIx(i, weights[i]!, entry, 0n)], `submit ${i}`, [roomShard, stances[i]!]),
    );
  }
  // One pivot while the room is live (pivots before start_ts are rejected on-chain).
  while ((await chainUnixTs(erFqdn)) < startTs) await sleep(1000);
  const pivotWeights: [number, number, number, number] = [3000, 1000, 2000, 0];
  record(
    `submit_stance A: pivot FLIP slot 1 → [${pivotWeights.join(",")}] while live`,
    "ER",
    await signAndSend(erFqdn, relayer, [submitIx(0, pivotWeights, [0n, 0n, 0n], 0n)], "pivot A", [roomShard, stances[0]!]),
  );
  const [vrfIdentity] = await getProgramDerivedAddress({ programAddress: erRoomProgram, seeds: [Buffer.from("identity")] });
  record(
    "request_settlement_vrf (MagicBlock VRF)",
    "ER",
    await signAndSend(
      erFqdn,
      relayer,
      [cartridgeErRoom.getRequestSettlementVrfInstruction({ authority: relayer, roomShard, oracleQueue: DEFAULT_EPHEMERAL_QUEUE, programIdentity: vrfIdentity, vrfProgram: VRF_PROGRAM_ID, clientSeed: 7 })],
      "vrf",
      [roomShard, DEFAULT_EPHEMERAL_QUEUE],
    ),
  );
  let vrfSeedHex = "";
  for (let i = 0; i < 60 && !vrfSeedHex; i += 1) {
    await sleep(500);
    const shardEr = await accountInfo(erFqdn, roomShard);
    if (shardEr && shardEr.data.length >= 197 && shardEr.data[196] === 1) vrfSeedHex = shardEr.data.subarray(164, 196).toString("hex");
  }
  console.log(vrfSeedHex ? `  VRF seed 0x${vrfSeedHex}` : "  VRF callback not observed within 30s (settle requires it; continuing)");
  while ((await chainUnixTs(erFqdn)) < unsealTs) await sleep(1000);
  for (let i = 0; i < 2; i += 1) {
    record(
      `trigger_showdown_unseal ${i === 0 ? "A" : "B"}`,
      "ER",
      await signAndSend(erFqdn, relayer, [cartridgeErRoom.getTriggerShowdownUnsealInstruction({ authority: relayer, roomShard, playerStance: stances[i]!, permission: perms[i]! })], "unseal", [roomShard, stances[i]!, perms[i]!]),
    );
  }
  while ((await chainUnixTs(erFqdn)) < endTs) await sleep(1000);
  const exit = await secondaryPrices8();
  for (let i = 0; i < 2; i += 1) {
    record(
      `evaluate_player_score ${i === 0 ? "A" : "B"} (i128 1e9 fixed point)`,
      "ER",
      await signAndSend(
        erFqdn,
        relayer,
        [
          cartridgeErRoom.getEvaluatePlayerScoreInstruction({
            authority: relayer,
            roomShard,
            playerStance: stances[i]!,
            oracleFeed: LIVE_ER_SOL_USD_ORACLE,
            permission: perms[i]!,
            secondaryExitPrices8: exit,
            betaBenchScaled: 0n,
            lambdaDdScaled: 500_000_000n,
            kalshiOutcomeYes: 2,
            maxMultiplierScaled: SCALE_9,
          }),
        ],
        "evaluate",
        [roomShard, stances[i]!, perms[i]!],
      ),
    );
  }
  for (let i = 0; i < 2; i += 1) {
    record(
      `undelegate_player_stance ${i === 0 ? "A" : "B"} (commit → L1)`,
      "ER",
      await signAndSend(erFqdn, relayer, [cartridgeErRoom.getUndelegatePlayerStanceInstruction({ authority: relayer, roomShard, playerStance: stances[i]! })], "undelegate", [stances[i]!]),
    );
  }
  const [shardPerm] = await getProgramDerivedAddress({ programAddress: PERMISSION_PROGRAM_ID, seeds: [Buffer.from("permission:"), addressEncoder.encode(roomShard)] });
  const rawSettle = cartridgeErRoom.getSettleAndCommitShardInstruction({
    authority: relayer,
    roomShard,
    oracleFeed: LIVE_ER_SOL_USD_ORACLE,
    permission: shardPerm,
    scheduleVaultAction: false,
    vaultActionAccounts: [],
  });
  const settleIx: Instruction = {
    programAddress: rawSettle.programAddress,
    data: rawSettle.data,
    accounts: rawSettle.accounts.map((meta) =>
      meta.address === shardPerm || meta.address === "MagicVau1t999999999999999999999999999999999" ? { ...meta, role: AccountRole.READONLY } : meta,
    ),
  };
  record("settle_and_commit_shard (SettledCommitted, commit + undelegate RoomShard → L1)", "ER", await signAndSend(erFqdn, relayer, [settleIx], "settle", [roomShard]));
  await waitForOwners(DEVNET_RPC, [roomShard, ...stances], erRoomProgram, "L1 undelegation restore");
  console.log("  RoomShard + PlayerStances restored on Solana Devnet L1");

  // 6. Payouts through the vault router (same function the app's settle route calls via distributeRoomPayouts)
  const walletsBefore = await Promise.all(walletAtas.map((a) => tokenBalance(rpc, a)));
  const outcome = await distributeAndPay(chain, roomShard, async (env) => players.find((p) => p.address === env.state.player) ?? null, STAKE_BUY_IN_UNITS.BLITZ_3M);
  if (outcome.status !== "ok") throw new Error(`distribute ${outcome.status}: ${outcome.reason}`);
  if (outcome.errors.length > 0) console.warn(`  partial errors: ${outcome.errors.join(" | ")}`);
  const walletsAfter = await Promise.all(walletAtas.map((a) => tokenBalance(rpc, a)));
  const feeAfter = await tokenBalance(rpc, chain.platformFeeAccount);
  const passports = await Promise.all(wallets.map((w) => findPassportPda(w.address)));
  const passportState = await Promise.all(
    passports.map(async (p) => {
      const acc = await accountInfo(DEVNET_RPC, p);
      return acc ? cartridgePassport.getMarketPassportDecoder().decode(new Uint8Array(acc.data)) : null;
    }),
  );
  const summary = outcome.players.map((p) => {
    const i = wallets.findIndex((w) => w.address === p.wallet);
    const ps = passportState[i];
    return `| ${i === 0 ? "A" : "B"} | \`${p.wallet}\` | ${p.principalUnits} | ${p.rank} | ${p.payoutUnits} | ${walletsBefore[i]} → ${walletsAfter[i]} | ${ps ? `${ps.eloScaled / SCALE_9}.${(ps.eloScaled % SCALE_9).toString().padStart(9, "0").slice(0, 2)} (${ps.matchesPlayed} played, ${ps.winsCount} won, ${ps.earnedUsdcUnits} units credited)` : "n/a"} |`;
  });
  console.log(`  platformFeeAccount ${feeBefore} → ${feeAfter} (+${feeAfter - feeBefore}); pool ${outcome.poolUnits}, fee ${outcome.feeUnits}`);
  for (const line of summary) console.log(`  ${line}`);
  const endLamports = (await rpc.getBalance(relayer.address).send()).value;
  console.log(`Relayer spent ${startLamports - endLamports} lamports`);

  // 7. Append to docs/DEVNET_PROOF.md
  const docPath = resolve(ROOT, "docs/DEVNET_PROOF.md");
  const lines = [
    "",
    "---",
    "",
    `## Borel wallet stakes + vault-router payouts — ${new Date().toISOString()}`,
    "",
    `Two generated wallets with **0 SOL** (test-USDC from the relayer faucet) staked through \`cartridge_vault_router\` (\`${CARTRIDGE_PROGRAM_IDS.vaultRouter}\`) and were paid out by the program itself. Each stake is ONE wallet signature on a transaction built by the server code the app uses (\`apps/web/src/lib/borel/stakes-core.ts\`): the wallet deposits the fixed buy-in directly as \`funder\`; relayer \`${relayer.address}\` is fee payer, pays every rent and co-signs as room authority (seats, entries and envelopes are authority-approved on-chain); the room's derived player key co-signs \`open_session_envelope\`. Payouts go straight to the funding wallet; ELO credits are bound to the settled envelopes with one MatchCredit receipt per (wallet, room). Room \`${roomId}\`, RoomShard [\`${roomShard}\`](${solscanAccount(roomShard)}), RoomVault [\`${outcome.roomVault}\`](${solscanAccount(outcome.roomVault)}), VRF seed \`${vrfSeedHex ? `0x${vrfSeedHex}` : "not observed"}\`, fee ${outcome.feeUnits} units (1%, creator_share_bps = 0) into platformFeeAccount [\`${chain.platformFeeAccount}\`](${solscanAccount(chain.platformFeeAccount)}) (${feeBefore} → ${feeAfter}). Relayer spend for the whole run: ${startLamports - endLamports} lamports.`,
    "",
    "| Player | Wallet | Stake (units) | Rank | Payout (units) | Wallet test-USDC at settle | MarketPassport after |",
    "| :--- | :--- | ---: | ---: | ---: | :--- | :--- |",
    ...summary,
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
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
