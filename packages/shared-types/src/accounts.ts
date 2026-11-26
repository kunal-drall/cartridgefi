/**
 * Canonical Anchor PDA seed constants, on-chain account TypeScript interfaces,
 * and zero-copy binary WebSocket telemetry frame codecs (`ws-mesh` <-> `@cartridgefi/sdk`).
 */

export const PDA_SEEDS = {
  engineConfig: "engine_config",
  cartridge: "cartridge",
  roomShard: "room_shard",
  playerStance: "player_stance",
  sessionEnvelope: "session_envelope",
  roomVault: "room_vault",
  passport: "passport",
} as const;

export enum ScoringFormulaCode {
  DirectionNeutralRelReturn = 0,
  DrawdownPenalizedSharpe = 1,
  KalshiBrierCalibration = 2,
  MultiStageCarryComposite = 3,
}

export enum ActionBindingModeCode {
  ConvictionWeights = 0,
  ThreeLaneStance = 1,
  SectorTurf = 2,
  MultiStageCarry = 3,
}

export enum RoomPhaseCode {
  LobbyOpen = 0,
  FogOfWar = 1,
  Showdown = 2,
  SettledCommitted = 3,
  RetryGrace = 4,
}

export interface EngineConfigAccountSpec {
  adminMultisig: string;
  platformFeeAccount: string;
  privateBetaMode: boolean;
  maxRoomPoolUsdc: bigint;
  maxGlobalTvlUsdc: bigint;
  currentGlobalTvlUsdc: bigint;
  paused: boolean;
  bump: number;
}

export interface CartridgeManifestAccountSpec {
  slugHash: Uint8Array; // [u8; 32]
  creator: string;
  creatorFeeVault: string;
  creatorShareBps: number;
  genreCode: number;
  durationSecs: number;
  fogOfWarBps: number;
  maxRebalances: number;
  scoringFormula: ScoringFormulaCode;
  actionBindingMode: ActionBindingModeCode;
  allowedFeedsMerkleRoot: Uint8Array; // [u8; 32]
  manifestUri: string;
  totalRoomsCreated: bigint;
  bump: number;
}

export interface RoomShardAccountSpec {
  eventId: Uint8Array; // [u8; 32]
  shardIndex: number;
  cartridgeManifest: string;
  authority: string;
  phase: RoomPhaseCode;
  isPrivateFog: boolean;
  playerCount: number;
  startTs: bigint;
  unsealTs: bigint;
  endTs: bigint;
  roomPoolUsdc: bigint;
  vrfSeed: Uint8Array; // [u8; 32]
  vrfFulfilled: boolean;
  publicRankDigest: Uint8Array; // [u8; 32]
  bump: number;
}

export interface PlayerStanceAccountSpec {
  roomShard: string;
  player: string;
  ephemeralSessionKey: string;
  sessionExpiryTs: bigint;
  moveCount: number;
  /** Encrypted inside Private ER TEE (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`) while `phase === FogOfWar`. */
  weightsBps: [number, number, number, number];
  kalshiBinaryCall: number; // 0 = unset, 1 = NO, 2 = YES
  entryPrices8: [bigint, bigint, bigint, bigint];
  finalScoreScaled: bigint;
  rank: number;
  claimed: boolean;
  bump: number;
}

export interface MarketPassportAccountSpec {
  owner: string;
  eloScaled: bigint; // i128 scaled by 10^9
  eligibilityBitmask: number;
  matchesPlayed: number;
  winsCount: number;
  bestSharpeScaled: bigint;
  bestBrierScaled: bigint;
  earnedNvdaUnits: bigint;
  earnedSpyUnits: bigint;
  earnedAntUnits: bigint;
  earnedUsdcUnits: bigint;
  bump: number;
}

/**
 * Compact 48-byte binary WebSocket WorldPulse frame (`ws-mesh` -> browser WebWorker / SDK):
 *   byte 0:      magic = 0xCF
 *   byte 1:      version = 2
 *   byte 2:      phase (RoomPhaseCode)
 *   byte 3:      assetIndex (0=SOL-PERP, 1=NVDAx, 2=SPYx, 3=KALSHI-FED)
 *   bytes 4..12: timestampMs (u64 little-endian)
 *   bytes 12..20: price8 (i64 little-endian, 10^8 Pyth scale)
 *   bytes 20..24: velocityBps (i32 little-endian)
 *   bytes 24..28: volatilitySigmaMilli (u32 little-endian, e.g. 2500 = 2.500 sigma)
 *   bytes 28..32: countdownRemainingMs (u32 little-endian)
 *   bytes 32..36: playerRank (u16 LE) + totalPlayers (u16 LE)
 *   bytes 36..44: topLeaderScoreScaled (i64 LE, 10^9 scale)
 *   bytes 44..48: activeRoomsCount (u16 LE) + flags (u16 LE: bit0 = isFogEncrypted, bit1 = vrfVerified)
 */
export const WORLD_PULSE_FRAME_BYTES = 48;
export const WORLD_PULSE_MAGIC = 0xcf;
export const WORLD_PULSE_VERSION = 2;

export interface WorldPulseFrame {
  phase: RoomPhaseCode;
  assetIndex: number;
  timestampMs: bigint;
  price8: bigint;
  velocityBps: number;
  volatilitySigmaMilli: number;
  countdownRemainingMs: number;
  playerRank: number;
  totalPlayers: number;
  topLeaderScoreScaled: bigint;
  activeRoomsCount: number;
  isFogEncrypted: boolean;
  vrfVerified: boolean;
}

export function encodeWorldPulseFrame(frame: WorldPulseFrame): Uint8Array {
  const buf = new ArrayBuffer(WORLD_PULSE_FRAME_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, WORLD_PULSE_MAGIC);
  view.setUint8(1, WORLD_PULSE_VERSION);
  view.setUint8(2, frame.phase & 0xff);
  view.setUint8(3, frame.assetIndex & 0xff);
  view.setBigUint64(4, frame.timestampMs, true);
  view.setBigInt64(12, frame.price8, true);
  view.setInt32(20, frame.velocityBps, true);
  view.setUint32(24, frame.volatilitySigmaMilli, true);
  view.setUint32(28, frame.countdownRemainingMs, true);
  view.setUint16(32, frame.playerRank, true);
  view.setUint16(34, frame.totalPlayers, true);
  view.setBigInt64(36, frame.topLeaderScoreScaled, true);
  view.setUint16(44, frame.activeRoomsCount, true);
  const flags = (frame.isFogEncrypted ? 1 : 0) | (frame.vrfVerified ? 2 : 0);
  view.setUint16(46, flags, true);
  return new Uint8Array(buf);
}

export function decodeWorldPulseFrame(bytes: Uint8Array): WorldPulseFrame {
  if (bytes.byteLength < WORLD_PULSE_FRAME_BYTES) {
    throw new Error(
      `Invalid WorldPulseFrame byte length: expected ${WORLD_PULSE_FRAME_BYTES}, got ${bytes.byteLength}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, WORLD_PULSE_FRAME_BYTES);
  const magic = view.getUint8(0);
  const version = view.getUint8(1);
  if (magic !== WORLD_PULSE_MAGIC || version !== WORLD_PULSE_VERSION) {
    throw new Error(`Invalid WorldPulseFrame header: magic=${magic}, version=${version}`);
  }
  const flags = view.getUint16(46, true);
  return {
    phase: view.getUint8(2) as RoomPhaseCode,
    assetIndex: view.getUint8(3),
    timestampMs: view.getBigUint64(4, true),
    price8: view.getBigInt64(12, true),
    velocityBps: view.getInt32(20, true),
    volatilitySigmaMilli: view.getUint32(24, true),
    countdownRemainingMs: view.getUint32(28, true),
    playerRank: view.getUint16(32, true),
    totalPlayers: view.getUint16(34, true),
    topLeaderScoreScaled: view.getBigInt64(36, true),
    activeRoomsCount: view.getUint16(44, true),
    isFogEncrypted: (flags & 1) === 1,
    vrfVerified: (flags & 2) === 2,
  };
}
