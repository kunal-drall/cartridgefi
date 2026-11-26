import {
  generateKeyPairSigner,
  getBase58Decoder,
  getBase58Encoder,
  signBytes,
  verifySignature,
  type Address,
  type KeyPairSigner,
  type SignatureBytes,
} from "@solana/kit";
import { SESSION_DURATION, TOKEN_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-kit";
import {
  CARTRIDGE_PROGRAM_IDS,
  ENGINE_GUARDRAILS,
  MAGICBLOCK_CONSTANTS,
} from "@cartridgefi/shared-types";
import { normalizeToSolanaAddress, utf8ToBytes } from "./pda-and-deploy.js";

export const ALLOWED_SESSION_ACTION_TYPES = [
  "PLAYER_LANE_SWITCH",
  "SUBMIT_CONVICTION_WEIGHTS",
  "CALL_KALSHI_CATALYST",
  "PORTAL_GATE_PASS",
  "CLAIM_DISTRICT_TURF",
  "SUBMIT_BRACKET_FORECAST",
  "TRIGGER_SHOWDOWN_UNSEAL",
] as const;

export type AllowedSessionActionType = (typeof ALLOWED_SESSION_ACTION_TYPES)[number];

const FORBIDDEN_CUSTODY_PROGRAMS = new Set<string>([
  TOKEN_PROGRAM_ID,
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  CARTRIDGE_PROGRAM_IDS.vaultRouter,
  "11111111111111111111111111111111", // System Program lamport transfer guard
]);

const FORBIDDEN_ACTION_KEYWORDS = [
  "SPL_VAULT_TRANSFER",
  "WITHDRAW",
  "TRANSFER_USDC",
  "DRAIN",
  "CLOSE_VAULT",
  "SET_AUTHORITY",
] as const;

export interface SessionEnvelopeConfig {
  ownerWallet: string;
  roomShardPda: string;
  /** Maximum atomic USDC exposure authorized for this session (`<= 500_000_000n` = 500 USDC). */
  maxUsdcAtomic: bigint;
  /** Maximum integer leverage (`1..5`, strictly enforced `<= 5x`). */
  maxLeverage: number;
  /** Session lifetime in seconds (`30..86400`, defaults to `3600`s). */
  ttlSecs?: number;
  mode: "PAPER" | "LIVE";
  allowedActions?: readonly AllowedSessionActionType[];
}

export interface SessionActionPayload {
  actionType: AllowedSessionActionType | string;
  /** Additional atomic USDC margin committed by this action (defaults to `0n` for zero-cost stance updates). */
  additionalUsdcAtomic?: bigint;
  /** Requested integer leverage for this stance (`1..5`). */
  requestedLeverage?: number;
  /** Target program ID; defaults to `CARTRIDGE_PROGRAM_IDS.erRoom` and blocks SPL Token / Vault Router custody transfers. */
  targetProgramId?: string;
  /** Action-specific deterministic data (e.g. lane, weightsBps, kalshiCall). */
  data: Record<string, string | number | boolean | readonly number[]>;
}

export interface SignedSessionActionEnvelope {
  sessionPubkey: Address;
  ownerWallet: Address;
  roomShardPda: Address;
  sessionKeyProgramId: string;
  erRoomProgramId: string;
  sequence: number;
  signedAtSecs: bigint;
  expiresAtSecs: bigint;
  committedUsdcAtomic: string;
  maxUsdcAtomic: string;
  canonicalMessage: string;
  signatureBase58: string;
}

/**
 * Zero-Popup Ephemeral Session Signer backed by WebCrypto Ed25519 (`@solana/kit` `generateKeyPairSigner`).
 * Enforces strict action scope (gameplay ER stance instructions only — never SPL vault transfers),
 * `<= 5x` leverage cap, bounded USDC exposure cap, and TTL expiry.
 */
export class MagicBlockSessionSigner {
  readonly signer: KeyPairSigner;
  readonly ownerWallet: Address;
  readonly roomShardPda: Address;
  readonly maxUsdcAtomic: bigint;
  readonly maxLeverage: number;
  readonly mode: "PAPER" | "LIVE";
  readonly createdAtSecs: bigint;
  readonly expiresAtSecs: bigint;
  private readonly allowedActions: ReadonlySet<string>;
  private committedUsdcAtomic: bigint = 0n;
  private sequence: number = 0;
  private revoked: boolean = false;

  private constructor(params: {
    signer: KeyPairSigner;
    ownerWallet: Address;
    roomShardPda: Address;
    maxUsdcAtomic: bigint;
    maxLeverage: number;
    mode: "PAPER" | "LIVE";
    createdAtSecs: bigint;
    expiresAtSecs: bigint;
    allowedActions: ReadonlySet<string>;
  }) {
    this.signer = params.signer;
    this.ownerWallet = params.ownerWallet;
    this.roomShardPda = params.roomShardPda;
    this.maxUsdcAtomic = params.maxUsdcAtomic;
    this.maxLeverage = params.maxLeverage;
    this.mode = params.mode;
    this.createdAtSecs = params.createdAtSecs;
    this.expiresAtSecs = params.expiresAtSecs;
    this.allowedActions = params.allowedActions;
  }

  static async create(
    config: SessionEnvelopeConfig,
    nowUnixSecs: bigint = BigInt(Math.floor(Date.now() / 1000)),
  ): Promise<MagicBlockSessionSigner> {
    if (config.maxUsdcAtomic < 0n) {
      throw new Error("SessionEnvelope maxUsdcAtomic cannot be negative.");
    }
    if (config.maxUsdcAtomic > ENGINE_GUARDRAILS.betaMaxRoomPoolUsdc) {
      throw new Error(
        `SessionEnvelope maxUsdcAtomic (${config.maxUsdcAtomic}) exceeds beta room cap (${ENGINE_GUARDRAILS.betaMaxRoomPoolUsdc}).`,
      );
    }
    if (
      !Number.isInteger(config.maxLeverage) ||
      config.maxLeverage < 1 ||
      config.maxLeverage > ENGINE_GUARDRAILS.maxLiveLeverage
    ) {
      throw new Error(
        `SessionEnvelope maxLeverage (${config.maxLeverage}) violates hard ceiling (1x..${ENGINE_GUARDRAILS.maxLiveLeverage}x).`,
      );
    }

    const defaultTtlSecs = Math.min(3_600, Math.max(60, Math.floor(SESSION_DURATION / 1000) || 3_600));
    const ttlSecs = config.ttlSecs ?? defaultTtlSecs;
    if (!Number.isInteger(ttlSecs) || ttlSecs < 30 || ttlSecs > 86_400) {
      throw new Error("SessionEnvelope ttlSecs must be an integer between 30 and 86400 seconds.");
    }

    const requestedActions = config.allowedActions ?? ALLOWED_SESSION_ACTION_TYPES;
    if (requestedActions.length === 0) {
      throw new Error("SessionEnvelope allowedActions must contain at least one ER gameplay action.");
    }
    const allowedSet = new Set<string>();
    for (const act of requestedActions) {
      const upper = act.toUpperCase();
      for (const forbidden of FORBIDDEN_ACTION_KEYWORDS) {
        if (upper.includes(forbidden)) {
          throw new Error(`SessionEnvelope cannot authorize custody/transfer action: ${act}`);
        }
      }
      if (!(ALLOWED_SESSION_ACTION_TYPES as readonly string[]).includes(act)) {
        throw new Error(`Unsupported SessionEnvelope action scope: ${act}`);
      }
      allowedSet.add(act);
    }

    const ownerWallet = normalizeToSolanaAddress(config.ownerWallet);
    const roomShardPda = normalizeToSolanaAddress(config.roomShardPda);
    const signer = await generateKeyPairSigner();

    return new MagicBlockSessionSigner({
      signer,
      ownerWallet,
      roomShardPda,
      maxUsdcAtomic: config.mode === "PAPER" ? 0n : config.maxUsdcAtomic,
      maxLeverage: config.maxLeverage,
      mode: config.mode,
      createdAtSecs: nowUnixSecs,
      expiresAtSecs: nowUnixSecs + BigInt(ttlSecs),
      allowedActions: allowedSet,
    });
  }

  get sessionPubkey(): Address {
    return this.signer.address;
  }

  get remainingUsdcAtomic(): bigint {
    return this.maxUsdcAtomic - this.committedUsdcAtomic;
  }

  get signedCount(): number {
    return this.sequence;
  }

  get isRevoked(): boolean {
    return this.revoked;
  }

  isExpired(nowUnixSecs: bigint = BigInt(Math.floor(Date.now() / 1000))): boolean {
    return nowUnixSecs >= this.expiresAtSecs;
  }

  revoke(): void {
    this.revoked = true;
  }

  /**
   * Validates that an incoming game action obeys session revocation, TTL, target program isolation,
   * action whitelist, leverage guard (`<= maxLeverage <= 5x`), and USDC spending cap.
   */
  assertCanExecuteAction(
    payload: SessionActionPayload,
    nowUnixSecs: bigint = BigInt(Math.floor(Date.now() / 1000)),
  ): void {
    if (this.revoked) {
      throw new Error("Session key has been revoked.");
    }
    if (this.isExpired(nowUnixSecs)) {
      throw new Error(
        `Session key expired at ${this.expiresAtSecs.toString()} (now=${nowUnixSecs.toString()}).`,
      );
    }

    const targetProgram = payload.targetProgramId ?? CARTRIDGE_PROGRAM_IDS.erRoom;
    if (FORBIDDEN_CUSTODY_PROGRAMS.has(targetProgram) || targetProgram !== CARTRIDGE_PROGRAM_IDS.erRoom) {
      throw new Error(
        `Session key scope violation: target program ${targetProgram} is forbidden. Session keys can only invoke cartridge-er-room (${CARTRIDGE_PROGRAM_IDS.erRoom}), never SPL Token or Vault Router custody instructions.`,
      );
    }

    const upperAction = payload.actionType.toUpperCase();
    for (const forbidden of FORBIDDEN_ACTION_KEYWORDS) {
      if (upperAction.includes(forbidden)) {
        throw new Error(
          `Session key scope violation: custody/transfer action '${payload.actionType}' is strictly prohibited.`,
        );
      }
    }

    if (!this.allowedActions.has(payload.actionType)) {
      throw new Error(
        `Action '${payload.actionType}' is outside this session key's authorized scope.`,
      );
    }

    const lev = payload.requestedLeverage ?? 1;
    if (!Number.isInteger(lev) || lev < 1 || lev > this.maxLeverage || lev > ENGINE_GUARDRAILS.maxLiveLeverage) {
      throw new Error(
        `Requested leverage (${lev}x) exceeds session cap (${this.maxLeverage}x / protocol max ${ENGINE_GUARDRAILS.maxLiveLeverage}x).`,
      );
    }

    const deltaUsdc = payload.additionalUsdcAtomic ?? 0n;
    if (deltaUsdc < 0n) {
      throw new Error("additionalUsdcAtomic cannot be negative.");
    }
    if (this.mode === "PAPER" && deltaUsdc > 0n) {
      throw new Error("Paper-mode session keys cannot commit live USDC exposure.");
    }
    if (this.committedUsdcAtomic + deltaUsdc > this.maxUsdcAtomic) {
      throw new Error(
        `Session USDC cap exceeded: committed ${this.committedUsdcAtomic.toString()} + requested ${deltaUsdc.toString()} > cap ${this.maxUsdcAtomic.toString()}.`,
      );
    }
  }

  /**
   * Signs an in-game ER action with WebCrypto Ed25519 in < 1ms without triggering any wallet popup.
   */
  async signSessionAction(
    payload: SessionActionPayload,
    nowUnixSecs: bigint = BigInt(Math.floor(Date.now() / 1000)),
  ): Promise<SignedSessionActionEnvelope> {
    this.assertCanExecuteAction(payload, nowUnixSecs);

    const deltaUsdc = payload.additionalUsdcAtomic ?? 0n;
    this.committedUsdcAtomic += deltaUsdc;
    this.sequence += 1;

    const canonicalPayload = {
      v: 2,
      seq: this.sequence,
      owner: this.ownerWallet,
      session: this.signer.address,
      roomShard: this.roomShardPda,
      erProgram: CARTRIDGE_PROGRAM_IDS.erRoom,
      actionType: payload.actionType,
      additionalUsdcAtomic: deltaUsdc.toString(),
      requestedLeverage: payload.requestedLeverage ?? 1,
      ts: nowUnixSecs.toString(),
      exp: this.expiresAtSecs.toString(),
      data: payload.data,
    };
    const canonicalMessage = JSON.stringify(canonicalPayload);
    const messageBytes = utf8ToBytes(canonicalMessage);
    const sigBytes = await signBytes(this.signer.keyPair.privateKey, messageBytes);
    const signatureBase58 = getBase58Decoder().decode(sigBytes);

    return {
      sessionPubkey: this.signer.address,
      ownerWallet: this.ownerWallet,
      roomShardPda: this.roomShardPda,
      sessionKeyProgramId: MAGICBLOCK_CONSTANTS.sessionKeyProgramId,
      erRoomProgramId: CARTRIDGE_PROGRAM_IDS.erRoom,
      sequence: this.sequence,
      signedAtSecs: nowUnixSecs,
      expiresAtSecs: this.expiresAtSecs,
      committedUsdcAtomic: this.committedUsdcAtomic.toString(),
      maxUsdcAtomic: this.maxUsdcAtomic.toString(),
      canonicalMessage,
      signatureBase58,
    };
  }

  /**
   * Verifies an Ed25519 signed session envelope against this session signer's public key.
   */
  async verifyActionSignature(envelope: SignedSessionActionEnvelope): Promise<boolean> {
    if (envelope.sessionPubkey !== this.signer.address) {
      return false;
    }
    const sigRaw = getBase58Encoder().encode(envelope.signatureBase58);
    if (sigRaw.byteLength !== 64) {
      return false;
    }
    const msgBytes = utf8ToBytes(envelope.canonicalMessage);
    return verifySignature(
      this.signer.keyPair.publicKey,
      sigRaw as SignatureBytes,
      msgBytes,
    );
  }
}
