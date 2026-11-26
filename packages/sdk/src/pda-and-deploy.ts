import {
  address,
  createNoopSigner,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  isAddress,
  type Address,
} from "@solana/kit";
import { cartridgeErRoom, cartridgeRegistry } from "@cartridgefi/codama-clients";
import {
  CARTRIDGE_PROGRAM_IDS,
  MAGICBLOCK_CONSTANTS,
  PDA_SEEDS,
  USDC_UNIT,
  validateManifestCompliance,
  type CartridgeManifestV2,
} from "@cartridgefi/shared-types";

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Universal Web-isomorphic FIPS 180-4 SHA-256 implementation (zero `node:crypto` dependency so SDK bundles cleanly in Browser, Edge, and Node).
 */
export function sha256Sync(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const byteLen = data.byteLength;
  const bitLenHi = Math.floor(byteLen / 0x20000000);
  const bitLenLo = (byteLen << 3) >>> 0;

  const paddedLen = (((byteLen + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(data, 0);
  padded[byteLen] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLen - 8, bitLenHi, false);
  paddedView.setUint32(paddedLen - 4, bitLenLo, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = paddedView.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const w16 = w[i - 16] ?? 0;
      const w7 = w[i - 7] ?? 0;
      const s0 = (rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 = (rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10)) >>> 0;
      w[i] = (w16 + s0 + w7 + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const ki = SHA256_K[i] ?? 0;
      const wi = w[i] ?? 0;
      const temp1 = (h + S1 + ch + ki + wi) >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

const textEncoder = new TextEncoder();

export function utf8ToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function bytesToHex(bytes: Readonly<Uint8Array>): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Resolves a string into a strict `@solana/kit` `Address`, hashing synthetic test handles deterministically if off-spec.
 */
export function normalizeToSolanaAddress(candidate: string): Address {
  const trimmed = candidate.trim();
  if (isAddress(trimmed)) {
    return address(trimmed);
  }
  const hashed = sha256Sync(utf8ToBytes(`cartridgefi:addr:${trimmed}`));
  return getAddressDecoder().decode(hashed);
}

/**
 * Derives the canonical `creator_vault` PDA on `cartridge-vault-router` (`6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT`).
 */
export async function deriveCreatorFeeVaultPda(creatorWallet: string): Promise<Address> {
  const creatorAddress = normalizeToSolanaAddress(creatorWallet);
  const [creatorVaultPda] = await getProgramDerivedAddress({
    programAddress: address(CARTRIDGE_PROGRAM_IDS.vaultRouter),
    seeds: [utf8ToBytes("creator_vault"), getAddressEncoder().encode(creatorAddress)],
  });
  return creatorVaultPda;
}

export interface SerializedInstructionPayload {
  programAddress: string;
  accounts: {
    address: string;
    role: number;
  }[];
  dataHex: string;
  byteLength: number;
}

export interface DeriveDeploymentOptions {
  shardIndex?: number;
  authorityAddress?: string;
  creatorFeeVaultAddress?: string;
  roomPoolUsdcAtomic?: bigint;
  startTs?: bigint;
  crankTaskId?: bigint;
  network?: "devnet" | "mainnet-beta";
  studioBaseUrl?: string;
}

export interface CartridgeDeploymentPlan {
  roomId: string;
  slug: string;
  slugHashHex: string;
  eventIdHex: string;
  shardIndex: number;
  network: "devnet" | "mainnet-beta";
  creatorAddress: Address;
  authorityAddress: Address;
  engineConfigPda: Address;
  cartridgeManifestPda: Address;
  cartridgeManifestBump: number;
  roomShardPda: Address;
  roomShardBump: number;
  roomVaultPda: Address;
  creatorFeeVaultPda: Address;
  registryProgramId: string;
  erRoomProgramId: string;
  vaultRouterProgramId: string;
  delegationProgramId: string;
  permissionProgramId: string;
  manifestExplorerUrl: string;
  roomShardExplorerUrl: string;
  playableStudioUrl: string;
  registerCartridgeInstruction: SerializedInstructionPayload;
  initializeRoomShardInstruction: SerializedInstructionPayload;
}

function mapGenreToCode(genre: CartridgeManifestV2["metadata"]["genre"]): number {
  switch (genre) {
    case "BOREL_GAMEDAY":
      return 0;
    case "ARCADE_RUNNER":
      return 1;
    case "SYNDICATE_TURF":
      return 2;
    case "PREDICTION_BRACKET":
      return 3;
  }
}

function mapScoringFormula(
  formula: CartridgeManifestV2["scoringAndPrizes"]["primaryFormula"],
): cartridgeRegistry.ScoringFormula {
  switch (formula) {
    case "DIRECTION_NEUTRAL_REL_RETURN":
      return cartridgeRegistry.ScoringFormula.DirectionNeutralRelReturn;
    case "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL":
      return cartridgeRegistry.ScoringFormula.DrawdownPenalizedSharpe;
    case "KALSHI_BRIER_CALIBRATION":
      return cartridgeRegistry.ScoringFormula.KalshiBrierCalibration;
    case "MULTI_STAGE_CARRY_COMPOSITE":
      return cartridgeRegistry.ScoringFormula.MultiStageCarryComposite;
  }
}

function mapActionBindingMode(manifest: CartridgeManifestV2): {
  mode: cartridgeRegistry.ActionBindingMode;
  maxRebalances: number;
} {
  const primary = manifest.actionBindings[0];
  if (!primary) {
    return { mode: cartridgeRegistry.ActionBindingMode.ConvictionWeights, maxRebalances: 3 };
  }
  switch (primary.bindingType) {
    case "CONVICTION_WEIGHT_VECTOR":
      return {
        mode: cartridgeRegistry.ActionBindingMode.ConvictionWeights,
        maxRebalances: primary.maxRebalances,
      };
    case "CONTINUOUS_STANCE_VECTOR":
      return {
        mode: cartridgeRegistry.ActionBindingMode.ThreeLaneStance,
        maxRebalances: 120,
      };
    case "SECTOR_TURF_CAPTURE":
      return {
        mode: cartridgeRegistry.ActionBindingMode.SectorTurf,
        maxRebalances: 12,
      };
    case "BINARY_OUTCOME_CALL":
      return {
        mode: cartridgeRegistry.ActionBindingMode.MultiStageCarry,
        maxRebalances: 4,
      };
  }
}

function encodeFixed96ManifestUri(uri: string): Uint8Array {
  const raw = utf8ToBytes(uri);
  const out = new Uint8Array(96);
  out.set(raw.subarray(0, 96), 0);
  return out;
}

/**
 * Validates a `CartridgeManifest v2.0`, derives canonical Solana PDAs across `cartridge-registry`,
 * `cartridge-er-room`, and `cartridge-vault-router`, and builds typed Codama instruction payloads.
 */
export async function deriveCartridgeDeploymentPlan(
  manifest: CartridgeManifestV2,
  options: DeriveDeploymentOptions = {},
): Promise<CartridgeDeploymentPlan> {
  const compliance = validateManifestCompliance(manifest);
  if (!compliance.valid) {
    throw new Error(`Manifest compliance failed: ${compliance.violations.join(" | ")}`);
  }

  const network = options.network ?? "devnet";
  const shardIndex = options.shardIndex ?? 0;
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex > 65_535) {
    throw new Error("shardIndex must be a uint16 integer in [0, 65535]");
  }

  const creatorAddress = normalizeToSolanaAddress(manifest.metadata.creatorWallet);
  const authorityAddress = options.authorityAddress
    ? normalizeToSolanaAddress(options.authorityAddress)
    : creatorAddress;

  const slugHash = sha256Sync(utf8ToBytes(manifest.metadata.slug));
  const eventId = sha256Sync(utf8ToBytes(`${manifest.metadata.slug}:shard:${shardIndex}`));
  const feedFingerprints = manifest.marketUniverse
    .map((m) => `${m.alias}:${m.venue}:${m.pythFeedId ?? m.mint ?? m.marketId ?? m.symbol}`)
    .sort()
    .join("|");
  const allowedFeedsMerkleRoot = sha256Sync(utf8ToBytes(feedFingerprints));

  const registryProgramAddress = address(CARTRIDGE_PROGRAM_IDS.registry);
  const vaultRouterProgramAddress = address(CARTRIDGE_PROGRAM_IDS.vaultRouter);
  const addrEncoder = getAddressEncoder();

  const [engineConfigPda] = await cartridgeRegistry.findEngineConfigPda({
    programAddress: registryProgramAddress,
  });
  const [cartridgeManifestPda, cartridgeManifestBump] = await getProgramDerivedAddress({
    programAddress: registryProgramAddress,
    seeds: [utf8ToBytes(PDA_SEEDS.cartridge), slugHash],
  });
  const [roomShardPda, roomShardBump] = await cartridgeErRoom.findRoomShardPda({
    eventId,
    shardIndex,
  });
  const [roomVaultPda] = await getProgramDerivedAddress({
    programAddress: vaultRouterProgramAddress,
    seeds: [utf8ToBytes(PDA_SEEDS.roomVault), addrEncoder.encode(roomShardPda)],
  });
  const [derivedCreatorVaultPda] = await getProgramDerivedAddress({
    programAddress: vaultRouterProgramAddress,
    seeds: [utf8ToBytes("creator_vault"), addrEncoder.encode(creatorAddress)],
  });

  const creatorFeeVaultPda = options.creatorFeeVaultAddress
    ? normalizeToSolanaAddress(options.creatorFeeVaultAddress)
    : derivedCreatorVaultPda;

  const { mode: actionBindingMode, maxRebalances } = mapActionBindingMode(manifest);
  const manifestUriBytes = encodeFixed96ManifestUri(
    `https://spec.cartridgefi.com/v2/manifests/${manifest.metadata.slug}.json`,
  );

  const registerIx = cartridgeRegistry.getRegisterCartridgeInstruction({
    creator: createNoopSigner(creatorAddress),
    creatorFeeVault: creatorFeeVaultPda,
    engineConfig: engineConfigPda,
    cartridgeManifest: cartridgeManifestPda,
    slugHash,
    creatorShareBps: manifest.metadata.creatorFeeShareBps,
    genreCode: mapGenreToCode(manifest.metadata.genre),
    durationSecs: manifest.magicblockRoomConfig.durationSecs,
    fogOfWarBps: manifest.magicblockRoomConfig.fogOfWarBps,
    maxRebalances,
    scoringFormula: mapScoringFormula(manifest.scoringAndPrizes.primaryFormula),
    actionBindingMode,
    allowedFeedsMerkleRoot,
    manifestUri: manifestUriBytes,
  });

  const defaultPoolAtomic =
    BigInt(manifest.onboardingAndSession.liveSessionEnvelopeUsdc.minUsdc) * 24n * USDC_UNIT;
  const roomPoolUsdcAtomic = options.roomPoolUsdcAtomic ?? defaultPoolAtomic;
  const startTs = options.startTs ?? BigInt(Math.floor(Date.now() / 1000));
  const crankTaskId = options.crankTaskId ?? BigInt(shardIndex + 1);

  const initShardIx = cartridgeErRoom.getInitializeRoomShardInstruction({
    authority: createNoopSigner(authorityAddress),
    cartridgeManifest: cartridgeManifestPda,
    roomShard: roomShardPda,
    eventId,
    shardIndex,
    startTs,
    roomPoolUsdc: roomPoolUsdcAtomic,
    crankTaskId,
  });

  const clusterQuery = network === "devnet" ? "?cluster=devnet" : "";
  const studioBaseUrl = (options.studioBaseUrl ?? "https://play.cartridgefi.com").replace(/\/+$/, "");
  const roomId = `${manifest.metadata.slug}-r${(shardIndex + 1).toString().padStart(4, "0")}`;

  return {
    roomId,
    slug: manifest.metadata.slug,
    slugHashHex: bytesToHex(slugHash),
    eventIdHex: bytesToHex(eventId),
    shardIndex,
    network,
    creatorAddress,
    authorityAddress,
    engineConfigPda,
    cartridgeManifestPda,
    cartridgeManifestBump,
    roomShardPda,
    roomShardBump,
    roomVaultPda,
    creatorFeeVaultPda,
    registryProgramId: CARTRIDGE_PROGRAM_IDS.registry,
    erRoomProgramId: CARTRIDGE_PROGRAM_IDS.erRoom,
    vaultRouterProgramId: CARTRIDGE_PROGRAM_IDS.vaultRouter,
    delegationProgramId: MAGICBLOCK_CONSTANTS.delegationProgramId,
    permissionProgramId: MAGICBLOCK_CONSTANTS.permissionProgramId,
    manifestExplorerUrl: `https://explorer.solana.com/address/${cartridgeManifestPda}${clusterQuery}`,
    roomShardExplorerUrl: `https://explorer.solana.com/address/${roomShardPda}${clusterQuery}`,
    playableStudioUrl: `${studioBaseUrl}/arena?cartridge=${encodeURIComponent(manifest.metadata.slug)}&room=${encodeURIComponent(roomId)}`,
    registerCartridgeInstruction: {
      programAddress: registerIx.programAddress,
      accounts: registerIx.accounts.map((a) => ({
        address: a.address,
        role: a.role,
      })),
      dataHex: bytesToHex(new Uint8Array(registerIx.data)),
      byteLength: registerIx.data.byteLength,
    },
    initializeRoomShardInstruction: {
      programAddress: initShardIx.programAddress,
      accounts: initShardIx.accounts.map((a) => ({
        address: a.address,
        role: a.role,
      })),
      dataHex: bytesToHex(new Uint8Array(initShardIx.data)),
      byteLength: initShardIx.data.byteLength,
    },
  };
}
