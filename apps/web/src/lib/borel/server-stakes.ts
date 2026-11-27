// Server-only: real test-USDC stakes and payouts for DEVNET Borel rooms through cartridge_vault_router.
// Imported exclusively by app/api/borel/* route handlers. Never import from client code.
//
//   build   POST /api/borel/stake {action:"build"}  → relayer + player partially sign; wallet signs in-browser
//   submit  POST /api/borel/stake {action:"submit"} → server checks the exact message it issued, then sends
//   settle  distributeRoomPayouts(roomId)            → distribute_pool_and_fees, claim_prize → wallets, ELO
//   claim   POST /api/borel/claim                    → idempotent single-player claim (retry path)
//
// Kill switch: everything above is OFF unless BOREL_STAKES_ENABLED=true (server env). The on-chain fixes in
// docs/specs/STAKES_ONCHAIN_FIXES.md (authority-co-signed seats and envelopes, fixed buy-in, 8-seat cap, refunds,
// MatchCredit ELO receipts) are what make enabling it safe (audit C1/H1/H2/M2, docs/AUDIT_LOG.md §5).
//
// The envelope's player is the room's PlayerStance key, which the join route derives per (room, session)
// from relayer key material (server-chain.ts `derivedSigner`). The same derivation is reproduced here and
// cross-checked against the on-chain PlayerStance before any stake is built.
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  address,
  createDefaultRpcTransport,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  createSolanaRpcFromTransport,
  decompileTransactionMessage,
  getBase58Encoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  verifySignature,
  type Address,
  type KeyPairSigner,
  type Signature,
  type SignatureBytes,
} from "@solana/kit";
import { cartridgeErRoom } from "@cartridgefi/codama-clients";
import { BOREL_DEPLOYMENT } from "./deployment";
import { parseRoomId, readRoomState, roomChainPlan, type RoomSchedule } from "./server-chain";
import {
  MAX_STAKED_PLAYERS_PER_ROOM,
  STAKE_AUTH_MAX_TTL_MS,
  STAKE_FEE_BPS,
  ER_ROOM_PROGRAM_ID,
  buildStakeTransaction,
  claimToWallet,
  deriveAta,
  distributeAndPay,
  ensureRoomVault,
  finalizeStakeTransaction,
  findSessionEnvelopePda,
  findStakeRecord,
  findVaultPdas,
  readEngineConfig,
  readEnvelope,
  readRoomVault,
  sendSignedAndConfirm,
  stakeAuthMessage,
  stakeBuyInUnits,
  type DistributionOutcome,
  type StakeChain,
  type StakeReceipt,
} from "./stakes-core";
import { RELAYER_RPC_URL, deriveRelayerKeyMaterial, getRelayerSigner, solscanTxUrl } from "../relayer/config";
import { signSendAndConfirm } from "../relayer/send";
import { reserveRelayerSpend } from "../relayer/spend-guard";

const DELEGATION_PROGRAM_ID = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
/** Private-beta caps enforced by cartridge_vault_router when EngineConfig.private_beta_mode is set. */
const BETA_MAX_ROOM_POOL_USDC = 500_000_000n;
const BETA_MAX_GLOBAL_TVL_USDC = 5_000_000_000n;
/** A stake must land before lockAt: refuse to build one this close to it (wallet popup + landing latency). */
const STAKE_BUILD_MARGIN_MS = 8_000;
const STAKE_SUBMIT_MARGIN_MS = 1_500;

export class StakeRuleError extends Error {}

export const STAKES_PAUSED_REASON = "Staked rooms are paused for an on-chain upgrade";

/** Server kill switch (default OFF): BOREL_STAKES_ENABLED=true|1 turns staking, claims and payouts on. */
export function stakingEnabled(): boolean {
  const raw = process.env.BOREL_STAKES_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

// ---------------------------------------------------------------------------
// Chain context + derived keys
// ---------------------------------------------------------------------------

function memoMac(body: string): string {
  return createHmac("sha256", deriveRelayerKeyMaterial("borel:stake-memo:v1")).update(body).digest("hex").slice(0, 32);
}

/** Stake reads fan out (~10 calls per build); retry 429 / transient transport failures with backoff. */
function createStakeRpc() {
  const base = createDefaultRpcTransport({ url: RELAYER_RPC_URL });
  const transport = (async (request: Parameters<typeof base>[0]) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await base(request);
      } catch (err) {
        if (attempt >= 4 || !/429|Too Many Requests|fetch failed|ECONNRESET/i.test(String(err))) throw err;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }) as typeof base;
  return createSolanaRpcFromTransport(transport);
}

let stakeRpc: ReturnType<typeof createStakeRpc> | null = null;

export async function stakeChain(): Promise<StakeChain> {
  const relayer = await getRelayerSigner();
  if (relayer.address !== BOREL_DEPLOYMENT.authority) {
    throw new StakeRuleError("Configured relayer is not the Borel vault / passport authority");
  }
  return {
    rpc: (stakeRpc ??= createStakeRpc()),
    relayer,
    mint: address(BOREL_DEPLOYMENT.testUsdcMint),
    decimals: BOREL_DEPLOYMENT.testUsdcDecimals,
    platformFeeAccount: address(BOREL_DEPLOYMENT.platformFeeAccount),
    send: async (_label, instructions) => (await signSendAndConfirm(relayer, instructions, [])).signature,
    mac: memoMac,
  };
}

/** Same derivation as server-chain.ts `derivedSigner("player", roomId, sessionPubkey)`. */
async function derivedPlayer(roomId: string, sessionPubkey: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromPrivateKeyBytes(deriveRelayerKeyMaterial(`borel:player:v1:${roomId}:${sessionPubkey}`));
}

function stakeRoom(roomId: string): RoomSchedule {
  const room = parseRoomId(roomId);
  if (!room) throw new StakeRuleError("Unknown roomId");
  if (room.stake !== "DEVNET") throw new StakeRuleError("Stakes are only accepted in DEVNET rooms");
  // Open rooms count unstaked players on their RoomShard; one envelope there would block distribute_pool_and_fees.
  if (!room.staked) throw new StakeRuleError("This room is not a staked room — join a staked room (id ending in -S) to stake test-USDC");
  return room;
}

async function roomShardFor(room: RoomSchedule, relayer: Address): Promise<Address> {
  return (await roomChainPlan(room, relayer)).roomShardPda;
}

export function receiptJson(r: StakeReceipt) {
  return { label: r.label, signature: r.signature, cluster: "devnet" as const, explorerUrl: solscanTxUrl(r.signature) };
}

// ---------------------------------------------------------------------------
// Request authentication
// ---------------------------------------------------------------------------

async function verifyEd25519(signer: string, signatureBytes: Uint8Array, message: Uint8Array): Promise<boolean> {
  if (signatureBytes.length !== 64) return false;
  const key = await getPublicKeyFromAddress(address(signer));
  return verifySignature(key, signatureBytes as unknown as SignatureBytes, message);
}

/** Verifies the session key signed {roomId, session, wallet, amount, expiresAt}. Returns a reason or null. */
export async function verifyStakeAuth(args: {
  roomId: string;
  sessionPubkey: string;
  walletAddress: string;
  amountUnits: bigint;
  expiresAt: number;
  signature: string;
}): Promise<string | null> {
  const now = Date.now();
  if (args.expiresAt <= now) return "Stake signature expired";
  if (args.expiresAt > now + STAKE_AUTH_MAX_TTL_MS) return "Stake signature expiry too far in the future";
  try {
    const sig = new Uint8Array(getBase58Encoder().encode(args.signature));
    const ok = await verifyEd25519(args.sessionPubkey, sig, stakeAuthMessage(args));
    return ok ? null : "Invalid session signature";
  } catch {
    return "Session signature could not be verified";
  }
}

function issueToken(roomId: string, sessionPubkey: string, wallet: string, messageBytes: Uint8Array): string {
  return createHmac("sha256", deriveRelayerKeyMaterial("borel:stake-tx:v1"))
    .update(`${roomId}|${sessionPubkey}|${wallet}|`)
    .update(messageBytes)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Stake: build (partially signed) → wallet signs → submit
// ---------------------------------------------------------------------------

export interface BuiltStakeResponse {
  roomId: string;
  roomShard: Address;
  roomVault: Address;
  envelope: Address;
  wallet: Address;
  amountUnits: bigint;
  feeBps: number;
  /** Base64 wire transaction, unsigned: the wallet signs first; relayer (fee payer) + player sign at submit. */
  transaction: string;
  /** HMAC binding the exact message bytes to (room, session, wallet); echo it back on submit. */
  token: string;
  lastValidBlockHeight: bigint;
  lockAt: number;
  receipts: ReturnType<typeof receiptJson>[];
}

export async function buildStakeForWallet(args: {
  roomId: string;
  sessionPubkey: string;
  wallet: Address;
  amountUnits: bigint;
  nowMs: number;
}): Promise<BuiltStakeResponse> {
  if (!stakingEnabled()) throw new StakeRuleError(STAKES_PAUSED_REASON);
  const room = stakeRoom(args.roomId);
  if (args.nowMs >= room.lockAt - STAKE_BUILD_MARGIN_MS) throw new StakeRuleError("Stakes are closed for this room (lock is imminent)");
  const buyIn = stakeBuyInUnits(room.roomId);
  if (buyIn === null || args.amountUnits !== buyIn) {
    throw new StakeRuleError(`This room has a fixed buy-in of ${buyIn ?? 0n} test-USDC base units`);
  }
  if (args.wallet === args.sessionPubkey) throw new StakeRuleError("The session key cannot stake for itself");

  const chain = await stakeChain();
  const roomShard = await roomShardFor(room, chain.relayer.address);
  const player = await derivedPlayer(room.roomId, args.sessionPubkey);
  if (player.address === args.wallet) throw new StakeRuleError("Wallet collides with the room player key");

  // Seat cap by JOIN ORDER, not by envelope count (audit H1): only the first MAX_STAKED_PLAYERS_PER_ROOM
  // relayer-MAC'd join memos of this room may ever stake, so concurrent builds cannot exceed the cap.
  const roomState = await readRoomState(room, chain.relayer.address, chain.relayer.address, args.nowMs);
  const seat = [...roomState.players.keys()].indexOf(args.sessionPubkey);
  if (seat < 0) throw new StakeRuleError("Join the room before staking (no authenticated join for this session)");
  if (seat >= MAX_STAKED_PLAYERS_PER_ROOM) {
    throw new StakeRuleError(`Only the first ${MAX_STAKED_PLAYERS_PER_ROOM} players to join a staked room may stake; join the next staked room`);
  }

  // The player must have joined: its PlayerStance exists (on L1, or delegated to MagicBlock) and is ours.
  const [stancePda] = await cartridgeErRoom.findPlayerStancePda({ roomShard, player: player.address });
  const envelope = await findSessionEnvelopePda(roomShard, player.address);
  const walletAta = await deriveAta(args.wallet, chain.mint);
  const accounts = await chain.rpc.getMultipleAccounts([stancePda, envelope, walletAta], { encoding: "base64", commitment: "confirmed" }).send();
  const [stanceAcc, envelopeAcc, walletAtaAcc] = accounts.value;
  if (!stanceAcc) throw new StakeRuleError("Join the room before staking (no PlayerStance for this session)");
  if (stanceAcc.owner !== ER_ROOM_PROGRAM_ID && stanceAcc.owner !== DELEGATION_PROGRAM_ID) {
    throw new StakeRuleError("PlayerStance has an unexpected owner");
  }
  const stance = cartridgeErRoom.getPlayerStanceDecoder().decode(new Uint8Array(getBase64Encoder().encode(stanceAcc.data[0])));
  if (stance.player !== player.address || stance.roomShard !== roomShard) {
    throw new StakeRuleError("PlayerStance does not belong to this session (derivation mismatch)");
  }
  if (envelopeAcc) throw new StakeRuleError("This session already staked in this room");
  if (!walletAtaAcc) throw new StakeRuleError("Wallet has no test-USDC account — use the faucet first");
  const { value: balance } = await chain.rpc.getTokenAccountBalance(walletAta, { commitment: "confirmed" }).send();
  if (BigInt(balance.amount) < args.amountUnits) {
    throw new StakeRuleError(`Wallet holds ${balance.amount} test-USDC units, stake needs ${args.amountUnits}`);
  }

  // EngineConfig caps (the program re-checks all of these atomically).
  const cfg = await readEngineConfig(chain);
  if (cfg.paused) throw new StakeRuleError("CartridgeFi engine is paused");
  const vaultBefore = await readRoomVault(chain, roomShard);
  if (vaultBefore?.state.settled) throw new StakeRuleError("Room vault already settled");
  const nextPool = (vaultBefore?.state.roomPoolUsdc ?? 0n) + args.amountUnits;
  const nextTvl = cfg.currentGlobalTvlUsdc + args.amountUnits;
  const poolCap = cfg.privateBetaMode && BETA_MAX_ROOM_POOL_USDC < cfg.maxRoomPoolUsdc ? BETA_MAX_ROOM_POOL_USDC : cfg.maxRoomPoolUsdc;
  const tvlCap = cfg.privateBetaMode && BETA_MAX_GLOBAL_TVL_USDC < cfg.maxGlobalTvlUsdc ? BETA_MAX_GLOBAL_TVL_USDC : cfg.maxGlobalTvlUsdc;
  if (nextPool > poolCap) throw new StakeRuleError(`Room pool cap reached (${poolCap} units)`);
  if (nextTvl > tvlCap) throw new StakeRuleError(`Global TVL cap reached (${tvlCap} units)`);

  const receipts = await ensureRoomVault(chain, roomShard, buyIn);
  const built = await buildStakeTransaction(chain, {
    roomShard,
    player,
    wallet: createNoopSigner(args.wallet),
    session: args.sessionPubkey,
    ephemeralSessionKey: stance.ephemeralSessionKey,
    amountUnits: args.amountUnits,
  });
  const { roomVault } = await findVaultPdas(roomShard);
  return {
    roomId: room.roomId,
    roomShard,
    roomVault,
    envelope: built.envelope,
    wallet: args.wallet,
    amountUnits: args.amountUnits,
    feeBps: STAKE_FEE_BPS,
    transaction: getBase64EncodedWireTransaction(built.transaction),
    token: issueToken(room.roomId, args.sessionPubkey, args.wallet, built.transaction.messageBytes as unknown as Uint8Array),
    lastValidBlockHeight: built.lastValidBlockHeight,
    lockAt: room.lockAt,
    receipts: receipts.map(receiptJson),
  };
}

export async function submitSignedStake(args: {
  roomId: string;
  sessionPubkey: string;
  wallet: Address;
  transaction: string;
  token: string;
  nowMs: number;
}): Promise<{ envelope: Address; receipt: ReturnType<typeof receiptJson> }> {
  if (!stakingEnabled()) throw new StakeRuleError(STAKES_PAUSED_REASON);
  const room = stakeRoom(args.roomId);
  // The server signs last, so this clock check cannot be bypassed by broadcasting the built tx (audit L1).
  if (args.nowMs >= room.lockAt - STAKE_SUBMIT_MARGIN_MS) throw new StakeRuleError("Stakes are closed for this room");
  let tx: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  try {
    tx = getTransactionDecoder().decode(getBase64Encoder().encode(args.transaction));
  } catch {
    throw new StakeRuleError("Signed transaction could not be decoded");
  }
  const messageBytes = tx.messageBytes as unknown as Uint8Array;
  const expected = Buffer.from(issueToken(room.roomId, args.sessionPubkey, args.wallet, messageBytes), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/.test(args.token) ? args.token : "", "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new StakeRuleError("Transaction does not match the stake the server issued (was it modified by the wallet?)");
  }
  const walletSig = (tx.signatures as Record<string, SignatureBytes | null>)[args.wallet];
  if (!walletSig) throw new StakeRuleError("Wallet signature missing");
  if (!(await verifyEd25519(args.wallet, walletSig as unknown as Uint8Array, messageBytes))) {
    throw new StakeRuleError("Wallet signature is invalid");
  }

  const chain = await stakeChain();
  const roomShard = await roomShardFor(room, chain.relayer.address);
  const player = await derivedPlayer(room.roomId, args.sessionPubkey);
  const envelope = await findSessionEnvelopePda(roomShard, player.address);
  const signed = await finalizeStakeTransaction(chain, tx, player);

  // Relayer rent (envelope, passport) goes through the daily spend guard like every relayer tx.
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(tx.messageBytes));
  const reservation = reserveRelayerSpend(chain.relayer.address, message.instructions);
  let signature: string;
  try {
    signature = await sendSignedAndConfirm(chain.rpc, signed);
  } catch (err) {
    // Preflight rejections never reach the cluster; a timed-out send keeps the conservative charge.
    if (!/Timed out/.test(err instanceof Error ? err.message : "")) reservation.release();
    throw err;
  }
  try {
    const confirmed = await chain.rpc
      .getTransaction(signature as Signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" })
      .send();
    const pre = confirmed?.meta?.preBalances[0];
    const post = confirmed?.meta?.postBalances[0];
    if (pre !== undefined && post !== undefined) reservation.reconcile(BigInt(pre) - BigInt(post));
  } catch {
    // Keep the conservative estimate.
  }
  return {
    envelope,
    receipt: receiptJson({
      label: "Stake: test-USDC → room vault via cartridge_vault_router.open_session_envelope (wallet-signed, relayer-paid)",
      signature,
    }),
  };
}

// ---------------------------------------------------------------------------
// Status, claim, settlement
// ---------------------------------------------------------------------------

export interface StakeStatus {
  roomId: string;
  roomShard: Address;
  envelope: Address;
  staked: boolean;
  principalUnits: bigint;
  payoutUnits: bigint;
  rank: number;
  settled: boolean;
  claimed: boolean;
  vault: { address: Address; poolUnits: bigint; settled: boolean; feeBps: number } | null;
}

export async function getStakeStatus(roomId: string, sessionPubkey: string): Promise<StakeStatus> {
  const room = stakeRoom(roomId);
  const chain = await stakeChain();
  const roomShard = await roomShardFor(room, chain.relayer.address);
  const player = await derivedPlayer(room.roomId, sessionPubkey);
  const envelope = await findSessionEnvelopePda(roomShard, player.address);
  const [env, vault] = await Promise.all([readEnvelope(chain, envelope), readRoomVault(chain, roomShard)]);
  return {
    roomId: room.roomId,
    roomShard,
    envelope,
    staked: env !== null,
    principalUnits: env?.principalUsdc ?? 0n,
    payoutUnits: env?.payoutUsdc ?? 0n,
    rank: env?.rank ?? 0,
    settled: env?.settled ?? false,
    claimed: env?.claimed ?? false,
    vault: vault
      ? { address: vault.address, poolUnits: vault.state.roomPoolUsdc, settled: vault.state.settled, feeBps: vault.state.totalFeeBps }
      : null,
  };
}

/** Pays one settled envelope out to the wallet that staked it. Safe to call by anyone: the destination is fixed. */
export async function claimForSession(roomId: string, sessionPubkey: string): Promise<{ receipt: ReturnType<typeof receiptJson>; payoutUnits: bigint; wallet: Address }> {
  if (!stakingEnabled()) throw new StakeRuleError(STAKES_PAUSED_REASON);
  const room = stakeRoom(roomId);
  const chain = await stakeChain();
  const roomShard = await roomShardFor(room, chain.relayer.address);
  const player = await derivedPlayer(room.roomId, sessionPubkey);
  const envelope = await findSessionEnvelopePda(roomShard, player.address);
  const state = await readEnvelope(chain, envelope);
  if (!state) throw new StakeRuleError("No stake for this session in this room");
  if (!state.settled) throw new StakeRuleError("Room payouts have not been distributed yet");
  if (state.claimed) throw new StakeRuleError("Payout already claimed");
  if (state.payoutUsdc === 0n) throw new StakeRuleError("No payout for this rank");
  const record = await findStakeRecord(chain, roomShard, envelope);
  if (!record || record.session !== sessionPubkey || record.wallet !== state.funder) throw new StakeRuleError("Stake record not found for this session");
  // The program pays the funder recorded on the envelope (the staking wallet) and nobody else.
  const receipt = await claimToWallet(chain, roomShard, { address: envelope, state }, player);
  return { receipt: receiptJson(receipt), payoutUnits: state.payoutUsdc, wallet: state.funder };
}

/**
 * Settle-route hook for the chain layer. Call AFTER settle_and_commit_shard has returned the RoomShard to L1
 * (phase SettledCommitted) with every counted PlayerStance evaluated and undelegated. Idempotent; never throws.
 *   no-stakes → staking disabled (BOREL_STAKES_ENABLED off), unstaked room, or nobody staked: nothing to do
 *   pending   → RoomShard not yet committed to L1 / not SettledCommitted; call again later
 *   blocked   → cannot settle via the program (e.g. an unstaked player is counted in the shard)
 *   ok        → distribute + claims (pushed to wallets) + ELO receipts; `errors` lists partial failures
 */
export async function distributeRoomPayouts(roomId: string): Promise<DistributionOutcome | { status: "error"; reason: string }> {
  try {
    // Kill switch: no chain calls at all while staking is disabled.
    if (!stakingEnabled()) return { status: "no-stakes", reason: STAKES_PAUSED_REASON };
    const parsed = parseRoomId(roomId);
    if (parsed && !parsed.staked) return { status: "no-stakes", reason: "Unstaked room: no vault payouts" };
    const room = stakeRoom(roomId);
    const chain = await stakeChain();
    const roomShard = await roomShardFor(room, chain.relayer.address);
    return await distributeAndPay(chain, roomShard, async (_env, record) => derivedPlayer(room.roomId, record.session), stakeBuyInUnits(room.roomId));
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message.slice(0, 400) : "Distribution failed" };
  }
}
