// Borel stakes & payouts: on-chain building blocks for cartridge_vault_router + cartridge_passport.
// Isomorphic and package-only (no "@/" aliases, no relative imports) so the app server
// (server-stakes.ts, app/api/borel/stake|claim) and scripts/prove-stakes-devnet.ts run the SAME code.
//
// Money path (all amounts are u64 test-USDC base units, 6 decimals; no floating point):
//   stake   open_session_envelope: staking wallet ATA (funder) → room vault token PDA. The room authority
//           (relayer) co-signs; the program enforces the fixed buy-in and the 8-seat cap.
//   settle  distribute_pool_and_fees: fee → platformFeeAccount (+ creator vault at creator_share_bps),
//           per-player payout_usdc + rank written into each SessionRiskEnvelope (Harmonic Shapley)
//   claim   claim_prize: vault → the funder's (staking wallet's) ATA; the program pins the destination owner
//   elo     cartridge_passport.record_elo_and_vault_credit on the funder's MarketPassport, bound to the settled
//           envelope, with an on-chain MatchCredit receipt per (wallet, room)
//   refund  refund_unsettled_room: authority-only, principal back to each funder for an undistributed room
// "player" is the RoomShard PlayerStance key (server-derived in the app), so the envelope PDA
// [session_envelope, room_shard, player] pairs with the stance at distribute time.
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getUtf8Encoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import type {
  Address,
  Base64EncodedBytes,
  Base64EncodedWireTransaction,
  Instruction,
  KeyPairSigner,
  Rpc,
  Signature,
  SolanaRpcApiMainnet,
  Transaction,
  TransactionSigner,
} from "@solana/kit";
import {
  CARTRIDGE_PROGRAM_IDS,
  cartridgeErRoom,
  cartridgePassport,
  cartridgeRegistry,
  cartridgeVaultRouter,
} from "@cartridgefi/codama-clients";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
export const MEMO_PROGRAM_ID = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const COMPUTE_BUDGET_PROGRAM_ID = address("ComputeBudget111111111111111111111111111111");

export const VAULT_ROUTER_PROGRAM_ID = address(CARTRIDGE_PROGRAM_IDS.vaultRouter);
export const ER_ROOM_PROGRAM_ID = address(CARTRIDGE_PROGRAM_IDS.erRoom);
export const REGISTRY_PROGRAM_ID = address(CARTRIDGE_PROGRAM_IDS.registry);
export const PASSPORT_PROGRAM_ID = address(CARTRIDGE_PROGRAM_IDS.passport);

export const SCALE_9 = 1_000_000_000n;
/** Protocol fee per staked room (1.00%); with creator_share_bps = 0 all of it lands in platformFeeAccount. */
export const STAKE_FEE_BPS = 100;
/**
 * One fixed buy-in per room tier (test-USDC base units). Payouts are rank-only (Harmonic Shapley), so equal
 * principals are what make them fair (audit H2). Enforced at build time and again on every envelope before
 * distribute_pool_and_fees; the vault-router upgrade enforces it on-chain (docs/specs/STAKES_ONCHAIN_FIXES.md).
 */
export const STAKE_BUY_IN_UNITS = { BLITZ_3M: 10_000_000n, MACRO_15M: 25_000_000n } as const;

/** Fixed buy-in for a room id ("BLITZ_3M-DEVNET-123-S" → 10 test-USDC), or null for an unknown tier. */
export function stakeBuyInUnits(roomId: string): bigint | null {
  if (roomId.startsWith("BLITZ_3M-")) return STAKE_BUY_IN_UNITS.BLITZ_3M;
  if (roomId.startsWith("MACRO_15M-")) return STAKE_BUY_IN_UNITS.MACRO_15M;
  return null;
}
/** distribute_pool_and_fees takes 2 accounts per player in one legacy/v0 tx (no ALT): the vault's on-chain seat cap. */
export const MAX_STAKED_PLAYERS_PER_ROOM = 8;
/** vault_router leverage is 1..=5; Borel stakes are unlevered. */
export const STAKE_LEVERAGE = 1;
/** 8 disc + SessionRiskEnvelope::INIT_SPACE v2 (32·3 + 8 + 1 + 8 + 2 + 1 + 1 + 32 + 1 + 32 funder + 1 refunded). */
export const SESSION_ENVELOPE_SPACE = 191n;
/** Pre-upgrade (v1) SessionRiskEnvelope length: legacy envelopes are migrated before they can be refunded. */
export const SESSION_ENVELOPE_V1_SPACE = 158;
/** RoomShard.phase == SettledCommitted (cartridge_er_room::RoomPhase index 3). */
export const ROOM_PHASE_SETTLED_COMMITTED = 3;
/**
 * Fee-routing manifest for staked Borel rooms (relayer = creator, creator_share_bps = 0,
 * creator_fee_vault = relayer's test-USDC ATA). initialize_room_vault reads only creator_share_bps and
 * creator_fee_vault from it; the arena manifests use a non-token creator vault PDA and cannot back a vault.
 */
export const STAKE_FEE_MANIFEST_SLUG = "borel-stakes-fee-routing-v1";

const addressEncoder = getAddressEncoder();
const utf8 = getUtf8Encoder();

// ---------------------------------------------------------------------------
// Request authentication (isomorphic): the player's ephemeral session key signs the stake intent
// ---------------------------------------------------------------------------

export const STAKE_AUTH_MAX_TTL_MS = 120_000;

export function stakeAuthMessage(fields: {
  roomId: string;
  sessionPubkey: string;
  walletAddress: string;
  amountUnits: bigint;
  expiresAt: number;
}): Uint8Array {
  return new TextEncoder().encode(
    `borel-stake:v1:${fields.roomId}|${fields.sessionPubkey}|${fields.walletAddress}|${fields.amountUnits.toString()}|${fields.expiresAt}`,
  );
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

export async function deriveAta(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [addressEncoder.encode(owner), addressEncoder.encode(TOKEN_PROGRAM_ID), addressEncoder.encode(mint)],
  });
  return ata;
}

export async function findSessionEnvelopePda(roomShard: Address, player: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: VAULT_ROUTER_PROGRAM_ID,
    seeds: [utf8.encode("session_envelope"), addressEncoder.encode(roomShard), addressEncoder.encode(player)],
  });
  return pda;
}

export async function findVaultPdas(roomShard: Address): Promise<{ roomVault: Address; vaultUsdcToken: Address }> {
  const [[roomVault], [vaultUsdcToken]] = await Promise.all([
    cartridgeVaultRouter.findRoomVaultPda({ roomShard }),
    cartridgeVaultRouter.findVaultUsdcTokenPda({ roomShard }),
  ]);
  return { roomVault, vaultUsdcToken };
}

export async function findPassportPda(owner: Address): Promise<Address> {
  const [pda] = await cartridgePassport.findPassportPda({ owner });
  return pda;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer));
}

export async function findStakeFeeManifestPda(): Promise<{ manifest: Address; slugHash: Uint8Array }> {
  const slugHash = await sha256(utf8.encode(STAKE_FEE_MANIFEST_SLUG) as Uint8Array);
  const [manifest] = await getProgramDerivedAddress({
    programAddress: REGISTRY_PROGRAM_ID,
    seeds: [utf8.encode("cartridge"), slugHash],
  });
  return { manifest, slugHash };
}

// ---------------------------------------------------------------------------
// Low-level instructions (signer objects attached on metas so kit collects them)
// ---------------------------------------------------------------------------

function signerMeta(signer: TransactionSigner, writable: boolean) {
  return {
    address: signer.address,
    role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
    signer,
  };
}

export function computeUnitLimitIx(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM_ID, data };
}

export function memoIx(text: string): Instruction {
  return { programAddress: MEMO_PROGRAM_ID, data: new Uint8Array(utf8.encode(text)) };
}

export function systemTransferIx(from: TransactionSigner, to: Address, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM_ID,
    accounts: [signerMeta(from, true), { address: to, role: AccountRole.WRITABLE }],
    data,
  };
}

export function createAtaIdempotentIx(payer: TransactionSigner, ata: Address, owner: Address, mint: Address): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      signerMeta(payer, true),
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  };
}

export function transferCheckedIx(
  source: Address,
  mint: Address,
  destination: Address,
  owner: TransactionSigner,
  amount: bigint,
  decimals: number,
): Instruction {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  data[9] = decimals;
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: destination, role: AccountRole.WRITABLE },
      signerMeta(owner, false),
    ],
    data,
  };
}

export function mintToIx(mint: Address, destination: Address, authority: TransactionSigner, amount: bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 7;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      signerMeta(authority, false),
    ],
    data,
  };
}

/** Closes an emptied token account, returning its rent to `destination` (the relayer). */
export function closeAccountIx(account: Address, destination: Address, owner: TransactionSigner): Instruction {
  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: account, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      signerMeta(owner, false),
    ],
    data: new Uint8Array([9]),
  };
}

// ---------------------------------------------------------------------------
// Chain context
// ---------------------------------------------------------------------------

export interface StakeChain {
  rpc: Rpc<SolanaRpcApiMainnet>;
  /** Fee payer for every Borel transaction; vault authority, PassportConfig admin and test-USDC mint authority. */
  relayer: KeyPairSigner;
  mint: Address;
  decimals: number;
  platformFeeAccount: Address;
  /** Signs + sends a relayer-fee-paid tx (signers attached on metas) and resolves once confirmed. */
  send: (label: string, instructions: Instruction[]) => Promise<string>;
  /** Keyed MAC over memo bodies so stake / ELO markers cannot be forged by third parties. */
  mac: (body: string) => string;
}

export interface StakeReceipt {
  label: string;
  signature: string;
}

async function fetchRaw(rpc: Rpc<SolanaRpcApiMainnet>, addresses: Address[]): Promise<({ owner: Address; data: Uint8Array } | null)[]> {
  const res = await rpc.getMultipleAccounts(addresses, { encoding: "base64", commitment: "confirmed" }).send();
  return res.value.map((acc) => (acc ? { owner: acc.owner, data: new Uint8Array(getBase64Encoder().encode(acc.data[0])) } : null));
}

function hasDiscriminator(data: Uint8Array, disc: ArrayLike<number>): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i += 1) if (data[i] !== disc[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Vault setup (relayer-only, idempotent)
// ---------------------------------------------------------------------------

export async function creatorFeeVaultFor(chain: StakeChain): Promise<Address> {
  return deriveAta(chain.relayer.address, chain.mint);
}

/**
 * Registers the fee-routing manifest (once) and initializes the room vault (once per RoomShard) with the
 * room's fixed buy-in and the 8-seat cap, both enforced on-chain by open_session_envelope.
 */
export async function ensureRoomVault(chain: StakeChain, roomShard: Address, buyInUnits: bigint): Promise<StakeReceipt[]> {
  const { manifest, slugHash } = await findStakeFeeManifestPda();
  const { roomVault } = await findVaultPdas(roomShard);
  const creatorFeeVault = await creatorFeeVaultFor(chain);
  const [manifestAcc, vaultAcc, creatorVaultAcc] = await fetchRaw(chain.rpc, [manifest, roomVault, creatorFeeVault]);
  if (vaultAcc) {
    if (vaultAcc.owner !== VAULT_ROUTER_PROGRAM_ID) throw new Error(`Room vault ${roomVault} has an unexpected owner`);
    return [];
  }
  const ixs: Instruction[] = [computeUnitLimitIx(400_000)];
  if (!creatorVaultAcc) ixs.push(createAtaIdempotentIx(chain.relayer, creatorFeeVault, chain.relayer.address, chain.mint));
  if (!manifestAcc) {
    const uri = new Uint8Array(96);
    uri.set(utf8.encode(`https://cartridgefi.com/borel/manifests/${STAKE_FEE_MANIFEST_SLUG}`).slice(0, 96));
    ixs.push(
      await cartridgeRegistry.getRegisterCartridgeInstructionAsync({
        creator: chain.relayer,
        creatorFeeVault,
        cartridgeManifest: manifest,
        slugHash,
        creatorShareBps: 0,
        genreCode: 0,
        durationSecs: 180,
        fogOfWarBps: 7500,
        maxRebalances: 2,
        scoringFormula: cartridgeRegistry.ScoringFormula.DirectionNeutralRelReturn,
        actionBindingMode: cartridgeRegistry.ActionBindingMode.ConvictionWeights,
        allowedFeedsMerkleRoot: await sha256(utf8.encode("SOL/USD|BTC/USD|ETH/USD|NVDAx/USD") as Uint8Array),
        manifestUri: uri,
      }),
    );
  }
  ixs.push(
    await cartridgeVaultRouter.getInitializeRoomVaultInstructionAsync({
      authority: chain.relayer,
      roomShard,
      cartridgeManifest: manifest,
      usdcMint: chain.mint,
      platformFeeAccount: chain.platformFeeAccount,
      creatorFeeVault,
      totalFeeBps: STAKE_FEE_BPS,
      partnerWalletActive: false,
      buyInUsdc: buyInUnits,
      maxEnvelopes: MAX_STAKED_PLAYERS_PER_ROOM,
    }),
  );
  const label = `cartridge_vault_router.initialize_room_vault (buy-in ${buyInUnits.toString()} units, ${MAX_STAKED_PLAYERS_PER_ROOM} seats, fee ${STAKE_FEE_BPS} bps → platformFeeAccount)${manifestAcc ? "" : " + register fee-routing manifest"}`;
  return [{ label, signature: await chain.send(label, ixs) }];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type RoomVaultState = ReturnType<ReturnType<typeof cartridgeVaultRouter.getRoomVaultDecoder>["decode"]>;
export type EnvelopeState = ReturnType<ReturnType<typeof cartridgeVaultRouter.getSessionRiskEnvelopeDecoder>["decode"]>;
export type StanceState = ReturnType<ReturnType<typeof cartridgeErRoom.getPlayerStanceDecoder>["decode"]>;
export type EngineConfigState = ReturnType<ReturnType<typeof cartridgeRegistry.getEngineConfigDecoder>["decode"]>;

export async function readRoomVault(chain: StakeChain, roomShard: Address): Promise<{ address: Address; state: RoomVaultState } | null> {
  const { roomVault } = await findVaultPdas(roomShard);
  const [acc] = await fetchRaw(chain.rpc, [roomVault]);
  if (!acc || acc.owner !== VAULT_ROUTER_PROGRAM_ID || !hasDiscriminator(acc.data, cartridgeVaultRouter.ROOM_VAULT_DISCRIMINATOR)) return null;
  return { address: roomVault, state: cartridgeVaultRouter.getRoomVaultDecoder().decode(acc.data) };
}

export async function readEngineConfig(chain: StakeChain): Promise<EngineConfigState> {
  const [engineConfig] = await cartridgeRegistry.findEngineConfigPda();
  const [acc] = await fetchRaw(chain.rpc, [engineConfig]);
  if (!acc || acc.owner !== REGISTRY_PROGRAM_ID) throw new Error("EngineConfig not found on-chain");
  return cartridgeRegistry.getEngineConfigDecoder().decode(acc.data);
}

export async function readEnvelope(chain: StakeChain, envelope: Address): Promise<EnvelopeState | null> {
  const [acc] = await fetchRaw(chain.rpc, [envelope]);
  if (!acc || acc.owner !== VAULT_ROUTER_PROGRAM_ID || !hasDiscriminator(acc.data, cartridgeVaultRouter.SESSION_RISK_ENVELOPE_DISCRIMINATOR)) return null;
  return cartridgeVaultRouter.getSessionRiskEnvelopeDecoder().decode(acc.data);
}

function memcmpFilter(offset: bigint, bytes: Uint8Array) {
  return {
    memcmp: {
      offset,
      bytes: getBase64Decoder().decode(bytes) as Base64EncodedBytes,
      encoding: "base64" as const,
    },
  };
}

async function programAccountsForRoom(
  chain: StakeChain,
  program: Address,
  discriminator: ArrayLike<number>,
  roomShard: Address,
): Promise<{ address: Address; data: Uint8Array }[]> {
  const res = await chain.rpc
    .getProgramAccounts(program, {
      encoding: "base64",
      commitment: "confirmed",
      filters: [memcmpFilter(0n, Uint8Array.from(discriminator)), memcmpFilter(8n, addressEncoder.encode(roomShard) as Uint8Array)],
    })
    .send();
  return res.map((r) => ({ address: r.pubkey, data: new Uint8Array(getBase64Encoder().encode(r.account.data[0])) }));
}

export async function listRoomEnvelopes(chain: StakeChain, roomShard: Address): Promise<{ address: Address; state: EnvelopeState }[]> {
  const rows = await programAccountsForRoom(chain, VAULT_ROUTER_PROGRAM_ID, cartridgeVaultRouter.SESSION_RISK_ENVELOPE_DISCRIMINATOR, roomShard);
  const decoder = cartridgeVaultRouter.getSessionRiskEnvelopeDecoder();
  return rows.map((r) => ({ address: r.address, state: decoder.decode(r.data) })).sort((a, b) => (a.address < b.address ? -1 : 1));
}

/** Only stances committed back to L1 (owner = cartridge_er_room) are returned; delegated ones are skipped. */
export async function listRoomStances(chain: StakeChain, roomShard: Address): Promise<{ address: Address; state: StanceState }[]> {
  const rows = await programAccountsForRoom(chain, ER_ROOM_PROGRAM_ID, cartridgeErRoom.PLAYER_STANCE_DISCRIMINATOR, roomShard);
  const decoder = cartridgeErRoom.getPlayerStanceDecoder();
  return rows.map((r) => ({ address: r.address, state: decoder.decode(r.data) })).sort((a, b) => (a.address < b.address ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Stake memo (authenticated record binding envelope → session key + staking wallet)
// ---------------------------------------------------------------------------

export interface StakeRecord {
  session: string;
  wallet: Address;
  units: bigint;
  signature: string;
}

const B58 = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const STAKE_MEMO_RE = new RegExp(`^borel:v1:stake:(${B58}):(${B58}):(${B58}):(\\d{1,20})$`);

export function stakeMemoBody(roomShard: Address, session: string, wallet: Address, units: bigint): string {
  return `borel:v1:stake:${roomShard}:${session}:${wallet}:${units.toString()}`;
}

function memoEntries(memoField: string | null): string[] {
  if (!memoField) return [];
  return memoField
    .split("; ")
    .map((part) => part.replace(/^\[\d+\]\s*/, "").trim())
    .filter((t) => t.startsWith("borel:v1:"));
}

function verifiedMemoBody(chain: StakeChain, text: string): string | null {
  const at = text.lastIndexOf(":h=");
  if (at < 0) return null;
  const body = text.slice(0, at);
  return chain.mac(body) === text.slice(at + 3) ? body : null;
}

/** Upper bound on signature pages scanned per account (1,000 per page). Junk-tx flooding beyond it fails closed. */
const MAX_SIGNATURE_PAGES = 20;

/** Every signature touching `account`, OLDEST first (paged through the full history). */
async function allSignaturesOldestFirst(chain: StakeChain, account: Address): Promise<{ signature: string; memo: string | null; failed: boolean }[]> {
  const out: { signature: string; memo: string | null; failed: boolean }[] = [];
  let before: Signature | undefined;
  for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
    const sigs = await chain.rpc
      .getSignaturesForAddress(account, { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) })
      .send();
    for (const s of sigs) out.push({ signature: s.signature, memo: s.memo, failed: s.err !== null });
    if (sigs.length < 1000) return out.reverse();
    before = sigs[sigs.length - 1]?.signature;
  }
  throw new Error(`More than ${MAX_SIGNATURE_PAGES * 1000} signatures on ${account}; refusing to guess its history`);
}

const feePayerCache = new Map<string, string | null>();

/** Fee payer (account key 0) of a confirmed transaction; cached because confirmed transactions are immutable. */
async function feePayerOf(chain: StakeChain, signature: string): Promise<string | null> {
  const hit = feePayerCache.get(signature);
  if (hit !== undefined) return hit;
  const tx = await chain.rpc
    .getTransaction(signature as Signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" })
    .send();
  const payer = tx ? String(tx.transaction.message.accountKeys[0] ?? "") || null : null;
  if (tx) {
    if (feePayerCache.size > 20_000) feePayerCache.clear();
    feePayerCache.set(signature, payer);
  }
  return payer;
}

/** Relayer-MAC'd memo bodies in relayer-fee-paid transactions touching `account`, oldest first. */
async function relayerMemosFor(chain: StakeChain, account: Address, accept: (body: string) => boolean): Promise<{ body: string; signature: string }[]> {
  const out: { body: string; signature: string }[] = [];
  for (const s of await allSignaturesOldestFirst(chain, account)) {
    if (s.failed) continue;
    const bodies = memoEntries(s.memo).map((t) => verifiedMemoBody(chain, t)).filter((b): b is string => b !== null && accept(b));
    if (bodies.length === 0) continue;
    // A copied memo inside a third-party transaction carries a valid MAC; only the relayer's own transactions count.
    if ((await feePayerOf(chain, s.signature)) !== chain.relayer.address) continue;
    for (const body of bodies) out.push({ body, signature: s.signature });
  }
  return out;
}

/**
 * The stake record of an envelope: the OLDEST relayer-fee-paid transaction touching it that carries a valid
 * stake memo for this room (the envelope-creating stake tx). Callers still check that the record's session
 * derives the envelope's player key.
 */
export async function findStakeRecord(chain: StakeChain, roomShard: Address, envelope: Address): Promise<StakeRecord | null> {
  const [first] = await relayerMemosFor(chain, envelope, (body) => STAKE_MEMO_RE.exec(body)?.[1] === roomShard);
  if (!first) return null;
  const m = STAKE_MEMO_RE.exec(first.body) as RegExpExecArray;
  return { session: m[2] as string, wallet: address(m[3] as string), units: BigInt(m[4] as string), signature: first.signature };
}

// ---------------------------------------------------------------------------
// Stake transaction (wallet signs once; relayer pays every fee and every rent)
// ---------------------------------------------------------------------------

export interface BuildStakeArgs {
  roomShard: Address;
  /** PlayerStance key: must sign open_session_envelope (server-derived in the app). */
  player: TransactionSigner;
  /** Staking wallet: a NoopSigner on the server (the browser wallet signs later), a KeyPairSigner in scripts. */
  wallet: TransactionSigner;
  /** Session client key recorded in the stake memo (lets settle map the envelope back to its wallet). */
  session: string;
  ephemeralSessionKey: Address;
  amountUnits: bigint;
}

export interface BuiltStake {
  transaction: Transaction;
  lastValidBlockHeight: bigint;
  envelope: Address;
  walletAta: Address;
  passportInitialized: boolean;
}

export async function buildStakeTransaction(chain: StakeChain, args: BuildStakeArgs): Promise<BuiltStake> {
  const { roomVault, vaultUsdcToken } = await findVaultPdas(args.roomShard);
  const envelope = await findSessionEnvelopePda(args.roomShard, args.player.address);
  const [walletAta, walletPassport] = await Promise.all([deriveAta(args.wallet.address, chain.mint), findPassportPda(args.wallet.address)]);
  const [passportAcc] = await fetchRaw(chain.rpc, [walletPassport]);

  const ixs: Instruction[] = [
    computeUnitLimitIx(400_000),
    // The staking wallet deposits directly (funder); the relayer co-signs as room authority and pays the envelope rent.
    await cartridgeVaultRouter.getOpenSessionEnvelopeInstructionAsync({
      player: args.player,
      roomVault,
      roomAuthority: chain.relayer,
      funder: args.wallet,
      usdcMint: chain.mint,
      vaultUsdcToken,
      funderUsdcAta: walletAta,
      sessionEnvelope: envelope,
      principalUsdc: args.amountUnits,
      leverage: STAKE_LEVERAGE,
      ephemeralSessionKey: args.ephemeralSessionKey,
    }),
  ];
  const passportInitialized = passportAcc === null;
  if (passportInitialized) {
    ixs.push(
      await cartridgePassport.getInitializePassportInstructionAsync({
        payer: chain.relayer,
        owner: args.wallet,
        passport: walletPassport,
      }),
    );
  }
  const body = stakeMemoBody(args.roomShard, args.session, args.wallet.address, args.amountUnits);
  ixs.push(memoIx(`${body}:h=${chain.mac(body)}`));

  const { value: blockhash } = await chain.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(chain.relayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  // Nothing is signed here: the wallet signs first, then the server adds relayer + player signatures at
  // submit (after re-checking the room clock), so a built transaction cannot be broadcast late (audit L1).
  const transaction = compileTransaction(message);
  return { transaction, lastValidBlockHeight: blockhash.lastValidBlockHeight, envelope, walletAta, passportInitialized };
}

/** Adds the relayer (fee payer) and player signatures to a wallet-signed stake; throws unless fully signed. */
export async function finalizeStakeTransaction(chain: StakeChain, transaction: Transaction, player: KeyPairSigner): Promise<Transaction> {
  const signed = await partiallySignTransaction([chain.relayer.keyPair, player.keyPair], transaction);
  for (const [signer, sig] of Object.entries(signed.signatures)) {
    if (!sig) throw new Error(`Stake transaction is missing the signature of ${signer}`);
  }
  return signed;
}

const CONFIRM_TIMEOUT_MS = 60_000;

/** Sends an already fully-signed wire transaction and waits for `confirmed` (tolerates transient RPC errors). */
export async function sendSignedAndConfirm(rpc: Rpc<SolanaRpcApiMainnet>, transaction: Transaction): Promise<string> {
  const signature = getSignatureFromTransaction(transaction);
  const wire: Base64EncodedWireTransaction = getBase64EncodedWireTransaction(transaction);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3n }).send();
      break;
    } catch (err) {
      const text = String(err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : err);
      if (/already been processed/i.test(text)) break;
      if (attempt >= 3 || !/429|Too Many Requests|fetch failed|ECONNRESET|timeout/i.test(text)) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    let status: { err: unknown; confirmationStatus: string | null } | null = null;
    try {
      const { value } = await rpc.getSignatureStatuses([signature as Signature], { searchTransactionHistory: true }).send();
      status = value[0] ?? null;
    } catch {
      continue; // rate limited / transient: poll again
    }
    if (status?.err) throw new Error(`Transaction ${signature} failed on-chain: ${JSON.stringify(status.err, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`);
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return signature;
  }
  throw new Error(`Timed out waiting for confirmation of ${signature}`);
}

// ---------------------------------------------------------------------------
// Settlement: distribute_pool_and_fees → claim_prize (pushed to wallets) → record_elo_and_vault_credit
// ---------------------------------------------------------------------------

/** Resolves the signer for an envelope's player key + the wallet that staked it (null → cannot pay out). */
export type PlayerResolver = (
  envelope: { address: Address; state: EnvelopeState },
  record: StakeRecord,
) => Promise<KeyPairSigner | null>;

export interface PlayerPayout {
  envelope: Address;
  player: Address;
  wallet: Address | null;
  principalUnits: bigint;
  payoutUnits: bigint;
  rank: number;
  claimed: boolean;
  eloRecorded: boolean;
}

export type DistributionOutcome =
  | { status: "no-stakes"; reason: string }
  | { status: "pending"; reason: string }
  | { status: "blocked"; reason: string }
  | {
      status: "ok";
      roomShard: Address;
      roomVault: Address;
      poolUnits: bigint;
      feeUnits: bigint;
      platformFeeAccount: Address;
      receipts: StakeReceipt[];
      players: PlayerPayout[];
      errors: string[];
    };

/** Fee split as computed on-chain (creator_share_bps = 0, no partner): everything to platformFeeAccount. */
export function protocolFeeUnits(poolUnits: bigint, totalFeeBps: number, creatorShareBps: number): { total: bigint; platform: bigint; creator: bigint } {
  const total = (poolUnits * BigInt(totalFeeBps)) / 10_000n;
  const creator = (total * BigInt(creatorShareBps)) / 10_000n;
  return { total, platform: total - creator, creator };
}

async function distributeIx(chain: StakeChain, vault: RoomVaultState, roomShard: Address, roomVault: Address, pairs: { stance: Address; envelope: Address }[]): Promise<Instruction> {
  const ix = await cartridgeVaultRouter.getDistributePoolAndFeesInstructionAsync({
    authority: chain.relayer,
    roomVault,
    roomShard,
    usdcMint: vault.usdcMint,
    vaultUsdcToken: vault.vaultUsdcToken,
    platformFeeAccount: vault.platformFeeAccount,
    creatorFeeVault: vault.creatorFeeVault,
  });
  return {
    programAddress: ix.programAddress,
    data: ix.data,
    accounts: [
      ...ix.accounts,
      ...pairs.flatMap((p) => [
        { address: p.stance, role: AccountRole.READONLY },
        { address: p.envelope, role: AccountRole.WRITABLE },
      ]),
    ],
  };
}

/** True for envelopes opened before the vault-router upgrade (no funder recorded on-chain). */
function hasFunder(state: EnvelopeState): boolean {
  return state.funder !== SYSTEM_PROGRAM_ID;
}

/** claim_prize straight into the funder's (staking wallet's) ATA: the program pins the destination owner. */
export async function claimToWallet(
  chain: StakeChain,
  roomShard: Address,
  envelope: { address: Address; state: EnvelopeState },
  player: KeyPairSigner,
): Promise<StakeReceipt> {
  if (!hasFunder(envelope.state)) throw new Error(`Envelope ${envelope.address} has no funder (pre-upgrade layout)`);
  const wallet = envelope.state.funder;
  const { roomVault, vaultUsdcToken } = await findVaultPdas(roomShard);
  const walletAta = await deriveAta(wallet, chain.mint);
  const payout = envelope.state.payoutUsdc;
  const ixs: Instruction[] = [
    computeUnitLimitIx(300_000),
    createAtaIdempotentIx(chain.relayer, walletAta, wallet, chain.mint),
    await cartridgeVaultRouter.getClaimPrizeInstructionAsync({
      player,
      roomVault,
      sessionEnvelope: envelope.address,
      usdcMint: chain.mint,
      desiredMint: chain.mint,
      vaultUsdcToken,
      playerDestinationAta: walletAta,
      xstockUnitsOut: 0n,
    }),
  ];
  const label = `cartridge_vault_router.claim_prize rank ${envelope.state.rank}: ${payout.toString()} units → wallet ${wallet}`;
  return { label, signature: await chain.send(label, ixs) };
}

/** On-chain ELO idempotency receipt (audit M2): MatchCredit PDA ["match_credit", wallet, room_shard]. */
export async function findMatchCreditPda(wallet: Address, roomShard: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PASSPORT_PROGRAM_ID,
    seeds: [utf8.encode("match_credit"), addressEncoder.encode(wallet), addressEncoder.encode(roomShard)],
  });
  return pda;
}

export function placementScoreScaled(rank: number, playerCount: number): bigint {
  if (playerCount <= 1) return SCALE_9;
  const r = BigInt(Math.max(1, Math.min(rank, playerCount)));
  const n = BigInt(playerCount);
  return ((n - r) * SCALE_9) / (n - 1n);
}

/**
 * Settles a staked room through the vault router. Idempotent: re-running after a partial failure only
 * performs what is missing (distribute once, claims for unclaimed winners, ELO once per wallet per room).
 */
export async function distributeAndPay(
  chain: StakeChain,
  roomShard: Address,
  resolvePlayer: PlayerResolver,
  /** Fixed room buy-in: every paired envelope must hold exactly this principal (null skips the check). */
  expectedPrincipalUnits: bigint | null,
): Promise<DistributionOutcome> {
  const vault = await readRoomVault(chain, roomShard);
  if (!vault) return { status: "no-stakes", reason: "No room vault: nobody staked in this room" };
  const receipts: StakeReceipt[] = [];
  const errors: string[] = [];

  if (!vault.state.settled) {
    const [shardAcc] = await fetchRaw(chain.rpc, [roomShard]);
    if (!shardAcc) return { status: "blocked", reason: "RoomShard account not found" };
    if (shardAcc.owner !== ER_ROOM_PROGRAM_ID) {
      return { status: "pending", reason: "RoomShard is still delegated to the MagicBlock ER; settle_and_commit_shard has not returned it to L1" };
    }
    const shard = cartridgeErRoom.getRoomShardDecoder().decode(shardAcc.data);
    if (Number(shard.phase) !== ROOM_PHASE_SETTLED_COMMITTED) {
      return { status: "pending", reason: `RoomShard phase ${String(shard.phase)} is not SettledCommitted (3)` };
    }
    if (shard.playerCount !== shard.evaluatedCount) {
      return { status: "pending", reason: `Only ${shard.evaluatedCount}/${shard.playerCount} stances evaluated` };
    }
    const [stances, envelopes] = await Promise.all([listRoomStances(chain, roomShard), listRoomEnvelopes(chain, roomShard)]);
    const evaluated = stances.filter((s) => s.state.evaluated);
    const byEnvelope = new Map(envelopes.map((e) => [e.address, e]));
    const pairs: { stance: Address; envelope: Address }[] = [];
    const unstaked: string[] = [];
    for (const s of evaluated) {
      const env = await findSessionEnvelopePda(roomShard, s.state.player);
      if (byEnvelope.has(env)) pairs.push({ stance: s.address, envelope: env });
      else unstaked.push(s.state.player);
    }
    if (unstaked.length > 0 || pairs.length !== shard.playerCount) {
      return {
        status: "blocked",
        reason: `distribute_pool_and_fees needs a SessionRiskEnvelope for every counted player: ${pairs.length} staked of ${shard.playerCount} counted (unstaked stance players: ${unstaked.join(", ") || "none"}; evaluated stances on L1: ${evaluated.length})`,
      };
    }
    if (expectedPrincipalUnits !== null) {
      const off = envelopes.filter((e) => pairs.some((p) => p.envelope === e.address) && e.state.principalUsdc !== expectedPrincipalUnits);
      if (off.length > 0) {
        return {
          status: "blocked",
          reason: `Envelope principal differs from the room buy-in ${expectedPrincipalUnits}: ${off.map((e) => `${e.address}=${e.state.principalUsdc}`).join(", ")}`,
        };
      }
    }
    // Every paired envelope must come from a relayer-built stake whose session derives its player key: an
    // outsider who opened an envelope for their own stance is refused rather than paid (audit C1, app side).
    for (const p of pairs) {
      const env = byEnvelope.get(p.envelope)!;
      const record = await findStakeRecord(chain, roomShard, p.envelope);
      const signer = record ? await resolvePlayer(env, record) : null;
      if (!signer || signer.address !== env.state.player) {
        return { status: "blocked", reason: `Envelope ${p.envelope} was not opened by a relayer-built stake; refusing to distribute` };
      }
    }
    if (pairs.length > MAX_STAKED_PLAYERS_PER_ROOM) {
      return { status: "blocked", reason: `${pairs.length} staked players exceed the single-transaction distribution cap (${MAX_STAKED_PLAYERS_PER_ROOM})` };
    }
    const fee = protocolFeeUnits(vault.state.roomPoolUsdc, vault.state.totalFeeBps, vault.state.creatorShareBps);
    const label = `cartridge_vault_router.distribute_pool_and_fees: pool ${vault.state.roomPoolUsdc.toString()} units, fee ${fee.platform.toString()} units → platformFeeAccount, ${pairs.length} payouts written`;
    receipts.push({
      label,
      signature: await chain.send(label, [computeUnitLimitIx(600_000), await distributeIx(chain, vault.state, roomShard, vault.address, pairs)]),
    });
  }

  const settledVault = (await readRoomVault(chain, roomShard)) ?? vault;
  const envelopes = await listRoomEnvelopes(chain, roomShard);
  const fee = protocolFeeUnits(settledVault.state.roomPoolUsdc, settledVault.state.totalFeeBps, settledVault.state.creatorShareBps);

  // Resolve player signers once; the wallet is the funder recorded on the envelope itself.
  const resolved: { env: { address: Address; state: EnvelopeState }; record: StakeRecord | null; signer: KeyPairSigner | null }[] = [];
  for (const env of envelopes) {
    let match: { record: StakeRecord; signer: KeyPairSigner } | null = null;
    const record = await findStakeRecord(chain, roomShard, env.address);
    if (record && record.wallet === env.state.funder) {
      const signer = await resolvePlayer(env, record);
      if (signer && signer.address === env.state.player) match = { record, signer };
    }
    if (!match) errors.push(`Envelope ${env.address}: no relayer stake record from funder ${env.state.funder} whose session derives player ${env.state.player}`);
    resolved.push({ env, record: match?.record ?? null, signer: match?.signer ?? null });
  }

  // Claims (push to wallets). Each claim is its own tx so one failure does not block the others.
  for (const r of resolved) {
    if (!r.env.state.settled || r.env.state.claimed || r.env.state.refunded || r.env.state.payoutUsdc === 0n) continue;
    if (!r.record || !r.signer) continue; // reported above; payout stays claimable in the vault
    try {
      receipts.push(await claimToWallet(chain, roomShard, r.env, r.signer));
    } catch (err) {
      errors.push(`claim ${r.env.address}: ${err instanceof Error ? err.message.slice(0, 200) : "failed"}`);
    }
  }

  // ELO on each funder's MarketPassport, once per (room, wallet): the MatchCredit receipt makes a repeat fail on-chain.
  const withWallet = resolved.filter((r) => r.record !== null && r.env.state.settled && !r.env.state.refunded);
  const passports = await Promise.all(withWallet.map((r) => findPassportPda(r.env.state.funder)));
  const credits = await Promise.all(withWallet.map((r) => findMatchCreditPda(r.env.state.funder, roomShard)));
  const passportAccs = await fetchRaw(chain.rpc, passports);
  const creditAccs = credits.length > 0 ? await fetchRaw(chain.rpc, credits) : [];
  const elos: bigint[] = [];
  passportAccs.forEach((acc) => {
    if (acc && acc.owner === PASSPORT_PROGRAM_ID && hasDiscriminator(acc.data, cartridgePassport.MARKET_PASSPORT_DISCRIMINATOR)) {
      elos.push(cartridgePassport.getMarketPassportDecoder().decode(acc.data).eloScaled);
    }
  });
  const meanElo = elos.length > 0 ? elos.reduce((a, b) => a + b, 0n) / BigInt(elos.length) : 1_200n * SCALE_9;
  const roomMeanEloScaled = meanElo < 100n * SCALE_9 ? 100n * SCALE_9 : meanElo;
  const eloDone = new Set<string>();
  for (let i = 0; i < withWallet.length; i += 1) {
    const r = withWallet[i]!;
    const wallet = r.env.state.funder;
    const passport = passports[i]!;
    if (!passportAccs[i]) {
      errors.push(`ELO ${wallet}: MarketPassport ${passport} missing`);
      continue;
    }
    if (creditAccs[i]) {
      eloDone.add(r.env.address);
      continue;
    }
    const rank = r.env.state.rank;
    try {
      const label = `cartridge_passport.record_elo_and_vault_credit wallet ${wallet}: rank ${rank}/${envelopes.length}, credit ${r.env.state.payoutUsdc.toString()} units`;
      receipts.push({
        label,
        signature: await chain.send(label, [
          await cartridgePassport.getRecordEloAndVaultCreditInstructionAsync({
            authority: chain.relayer,
            passport,
            payer: chain.relayer,
            matchCredit: credits[i]!,
            sessionEnvelope: r.env.address,
            roomMeanEloScaled,
            placementScoreScaled: placementScoreScaled(rank, envelopes.length),
            isLiveMode: true,
            // The program binds both to the settled envelope (rank 1 ⇔ win, credit = payout).
            isWin: rank === 1,
            sharpeScoreScaled: null,
            brierScoreScaled: null,
            assetCreditKind: cartridgePassport.AssetCreditKind.Usdc,
            assetCreditUnits: r.env.state.payoutUsdc,
            roomShard,
          }),
        ]),
      });
      eloDone.add(r.env.address);
    } catch (err) {
      errors.push(`ELO ${wallet}: ${err instanceof Error ? err.message.slice(0, 200) : "failed"}`);
    }
  }

  const finalEnvelopes = await listRoomEnvelopes(chain, roomShard);
  return {
    status: "ok",
    roomShard,
    roomVault: settledVault.address,
    poolUnits: settledVault.state.roomPoolUsdc,
    feeUnits: fee.platform,
    platformFeeAccount: settledVault.state.platformFeeAccount,
    receipts,
    players: finalEnvelopes.map((e) => {
      return {
        envelope: e.address,
        player: e.state.player,
        wallet: hasFunder(e.state) ? e.state.funder : null,
        principalUnits: e.state.principalUsdc,
        payoutUnits: e.state.payoutUsdc,
        rank: e.state.rank,
        claimed: e.state.claimed,
        eloRecorded: eloDone.has(e.address),
      };
    }),
    errors,
  };
}

// ---------------------------------------------------------------------------
// Refunds (authority-only): undistributed rooms return each principal to its funder
// ---------------------------------------------------------------------------

/** refund_unsettled_room pairs per transaction (2 accounts each, plus ATA creates). */
const REFUND_PAIRS_PER_TX = 4;

/**
 * Refunds every unrefunded envelope of an undistributed room (vault must be v2: migrate legacy vaults first).
 * Destination = the funder's ATA, or the player key's ATA for envelopes opened before the upgrade. Idempotent:
 * refunded envelopes are skipped on-chain and here; a vault with no envelopes is simply marked settled.
 */
export async function refundRoom(chain: StakeChain, roomShard: Address): Promise<StakeReceipt[]> {
  const vault = await readRoomVault(chain, roomShard);
  if (!vault) throw new Error(`No v2 room vault for ${roomShard}`);
  if (vault.state.settled) return [];
  const envelopes = (await listRoomEnvelopes(chain, roomShard)).filter((e) => !e.state.refunded);
  const receipts: StakeReceipt[] = [];
  const base = {
    authority: chain.relayer,
    roomVault: vault.address,
    usdcMint: vault.state.usdcMint,
    vaultUsdcToken: vault.state.vaultUsdcToken,
  };
  const batches: { address: Address; state: EnvelopeState }[][] = [];
  for (let i = 0; i < envelopes.length; i += REFUND_PAIRS_PER_TX) batches.push(envelopes.slice(i, i + REFUND_PAIRS_PER_TX));
  if (batches.length === 0) batches.push([]);
  for (const batch of batches) {
    const ixs: Instruction[] = [computeUnitLimitIx(400_000)];
    const pairs: { envelope: Address; destination: Address }[] = [];
    for (const e of batch) {
      const owner = hasFunder(e.state) ? e.state.funder : e.state.player;
      const destination = await deriveAta(owner, vault.state.usdcMint);
      ixs.push(createAtaIdempotentIx(chain.relayer, destination, owner, vault.state.usdcMint));
      pairs.push({ envelope: e.address, destination });
    }
    const ix = await cartridgeVaultRouter.getRefundUnsettledRoomInstructionAsync(base);
    ixs.push({
      programAddress: ix.programAddress,
      data: ix.data,
      accounts: [
        ...ix.accounts,
        ...pairs.flatMap((p) => [
          { address: p.envelope, role: AccountRole.WRITABLE },
          { address: p.destination, role: AccountRole.WRITABLE },
        ]),
      ],
    });
    const total = batch.reduce((a, e) => a + e.state.principalUsdc, 0n);
    const label = `cartridge_vault_router.refund_unsettled_room: ${batch.length} envelope(s), ${total.toString()} units → funders`;
    receipts.push({ label, signature: await chain.send(label, ixs) });
  }
  return receipts;
}

/** Raw (layout-agnostic) envelope rows of a room: legacy v1 envelopes cannot be decoded with the v2 decoder. */
export async function listRawRoomEnvelopes(chain: StakeChain, roomShard: Address): Promise<{ address: Address; data: Uint8Array }[]> {
  const rows = await programAccountsForRoom(chain, VAULT_ROUTER_PROGRAM_ID, cartridgeVaultRouter.SESSION_RISK_ENVELOPE_DISCRIMINATOR, roomShard);
  return rows.sort((a, b) => (a.address < b.address ? -1 : 1));
}

/**
 * migrate_room_vault_v2 for a pre-upgrade vault: reallocates the vault and all of its v1 envelopes (passed as
 * remaining accounts) to the v2 layout, sets the buy-in / seat cap and counts the envelopes. No-op when the
 * vault already has the v2 layout.
 */
export async function migrateLegacyVault(chain: StakeChain, roomShard: Address, buyInUnits: bigint): Promise<StakeReceipt[]> {
  const { roomVault } = await findVaultPdas(roomShard);
  const [acc] = await fetchRaw(chain.rpc, [roomVault]);
  if (!acc || acc.owner !== VAULT_ROUTER_PROGRAM_ID) throw new Error(`Room vault ${roomVault} not found`);
  if (acc.data.length !== 8 + 287) return [];
  const legacy = (await listRawRoomEnvelopes(chain, roomShard)).filter((r) => r.data.length === SESSION_ENVELOPE_V1_SPACE);
  const ix = cartridgeVaultRouter.getMigrateRoomVaultV2Instruction({
    authority: chain.relayer,
    roomVault,
    buyInUsdc: buyInUnits,
    maxEnvelopes: MAX_STAKED_PLAYERS_PER_ROOM,
  });
  const label = `cartridge_vault_router.migrate_room_vault_v2: vault ${roomVault} + ${legacy.length} legacy envelope(s) → v2 layout`;
  const signature = await chain.send(label, [
    computeUnitLimitIx(400_000),
    {
      programAddress: ix.programAddress,
      data: ix.data,
      accounts: [...ix.accounts, ...legacy.map((r) => ({ address: r.address, role: AccountRole.WRITABLE }))],
    },
  ]);
  return [{ label, signature }];
}
