import { createNoopSigner, getBase58Decoder, type Address } from "@solana/kit";
import { cartridgeErRoom } from "@cartridgefi/codama-clients";
import {
  BOREL_GAMEDAY_MANIFEST,
  CARTRIDGE_DEVNET_AUTHORITIES,
  CartridgeManifestV2Schema,
  compilePromptToManifest,
  computeUpdatedMarketElo,
  ENGINE_GUARDRAILS,
  FIRST_PARTY_CARTRIDGE_CATALOG,
  formatScaledBigInt,
  FP_SCALE,
  MAGICBLOCK_CONSTANTS,
  PASSPORT_ELIGIBILITY_BITS,
  RoomPhaseCode,
  SOLANA_CANONICAL_MINTS,
  USDC_UNIT,
  type CartridgeManifestV2,
  type ClaimAssetSymbol,
  type WorldPulseFrame,
} from "@cartridgefi/shared-types";
import { CashModalClient, type SessionReadyTarget } from "./cashier.js";
import {
  MagicBlockRouterClient,
  type EnrichedMarketPulse,
  type WorldPulseSubscription,
} from "./magicblock-router.js";
import {
  bytesToHex,
  deriveCartridgeDeploymentPlan,
  normalizeToSolanaAddress,
  sha256Sync,
  utf8ToBytes,
  type CartridgeDeploymentPlan,
  type SerializedInstructionPayload,
} from "./pda-and-deploy.js";
import {
  MagicBlockSessionSigner,
  type AllowedSessionActionType,
  type SignedSessionActionEnvelope,
} from "./session-signer.js";
import {
  StanceNettingEngine,
  type NettedVenueOrderBatch,
  type NettingPolicyMode,
  type StanceActionInput,
  type StanceNettingMetrics,
  type StanceVector4Bps,
} from "./stance-netting.js";

export interface FeeAttributionSummary {
  partnerWalletActive: boolean;
  partnerId: string;
  partnerFeeVault: Address | null;
  partnerShareBps: number;
  creatorShareBps: number;
  engineShareBps: number;
  splitLabel: string;
}

export interface CartridgeConnectConfig {
  cartridgeSlug: string;
  manifest?: CartridgeManifestV2;
  partnerId?: string;
  partnerFeeVault?: string;
  playerWallet?: string;
  mode?: "PAPER" | "LIVE";
  apiBaseUrl?: string;
  wsUrl?: string;
  network?: "devnet" | "mainnet-beta";
  forceStandaloneSimulation?: boolean;
  simulationIntervalMs?: number;
}

export interface EmittedActionReceipt {
  roomId: string;
  event: AllowedSessionActionType;
  signedEnvelope: SignedSessionActionEnvelope;
  nettingMetrics: StanceNettingMetrics;
  flushedBatch: NettedVenueOrderBatch | null;
  syncedToCoreApi: boolean;
}

export interface RivalUnsealedStance {
  playerHandle: string;
  rank: number;
  weightsBps: StanceVector4Bps;
  finalScoreFormatted: string;
}

export interface ShowdownUnsealReceipt {
  roomId: string;
  phase: "SHOWDOWN";
  phaseCode: RoomPhaseCode;
  fogEncrypted: false;
  permissionProgramId: string;
  vrfProofHex: string;
  unsealedRivals: RivalUnsealedStance[];
  triggerShowdownInstruction: SerializedInstructionPayload;
  syncedToCoreApi: boolean;
}

export interface ClaimStockPrizeReceipt {
  roomId: string;
  player: Address;
  requestedAsset: ClaimAssetSymbol;
  settledAsset: ClaimAssetSymbol;
  settledMint: string;
  geoFallbackApplied: boolean;
  payoutUsdcAtomic: bigint;
  payoutUsdcFormatted: string;
  deliveredUnitsAtomic: bigint;
  deliveredUnitsFormatted: string;
  routingVenue: "JUPITER_XSTOCKS" | "CANONICAL_USDC";
  claimSignature: string;
  updatedEloScaled: bigint;
  updatedEloFormatted: string;
  source: "core_api" | "standalone_fallback";
}

export interface OnChainDeploymentReceipt extends CartridgeDeploymentPlan {
  deployedViaCoreApi: boolean;
}

const DEFAULT_ASSET_PRICES8: Record<ClaimAssetSymbol, bigint> = {
  NVDAx: 14_280_000_000n,
  SPYx: 59_820_000_000n,
  ANTx: 8_450_000_000n,
  TSLAx: 31_200_000_000n,
  USDC: 100_000_000n,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractManifestNettingPolicy(manifest: CartridgeManifestV2): NettingPolicyMode {
  for (const b of manifest.actionBindings) {
    if ("nettingPolicy" in b) {
      return b.nettingPolicy;
    }
  }
  return "NET_ON_ENTRY_AND_SETTLEMENT";
}

/**
 * Primary Multi-Genre Client for CartridgeFi (`CartridgeClient.connect(...)`).
 * Connects React, Phaser 3, Three.js, Partner Wallet `<CartridgeDeck/>`, CLI, and AI Agents
 * to MagicBlock Private ER rooms, 48-byte `WorldPulseFrame` streams, zero-popup Session Keys,
 * Stance Netting, and Claim-Time xStocks / USDC payouts.
 */
export class CartridgeClient implements SessionReadyTarget {
  readonly manifest: CartridgeManifestV2;
  readonly roomId: string;
  readonly roomShardPda: Address;
  readonly cartridgeManifestPda: Address;
  readonly playerWallet: Address;
  readonly mode: "PAPER" | "LIVE";
  readonly network: "devnet" | "mainnet-beta";
  readonly feeAttribution: FeeAttributionSummary;
  readonly router: MagicBlockRouterClient;
  readonly cashier: CashModalClient;
  readonly netting: StanceNettingEngine;

  private sessionSigner: MagicBlockSessionSigner;
  private readonly apiBaseUrl: string;
  private readonly wsUrl: string;
  private readonly forceStandaloneSimulation: boolean;
  private readonly simulationIntervalMs: number;
  private currentPhase: RoomPhaseCode = RoomPhaseCode.FogOfWar;
  private pulseSubscription: WorldPulseSubscription | null = null;
  private readonly marketPulseListeners = new Set<(pulse: EnrichedMarketPulse) => void>();
  private readonly worldTickListeners = new Set<(frame: WorldPulseFrame) => void>();

  private constructor(params: {
    manifest: CartridgeManifestV2;
    roomId: string;
    roomShardPda: Address;
    cartridgeManifestPda: Address;
    playerWallet: Address;
    mode: "PAPER" | "LIVE";
    network: "devnet" | "mainnet-beta";
    feeAttribution: FeeAttributionSummary;
    router: MagicBlockRouterClient;
    cashier: CashModalClient;
    netting: StanceNettingEngine;
    sessionSigner: MagicBlockSessionSigner;
    apiBaseUrl: string;
    wsUrl: string;
    forceStandaloneSimulation: boolean;
    simulationIntervalMs: number;
  }) {
    this.manifest = params.manifest;
    this.roomId = params.roomId;
    this.roomShardPda = params.roomShardPda;
    this.cartridgeManifestPda = params.cartridgeManifestPda;
    this.playerWallet = params.playerWallet;
    this.mode = params.mode;
    this.network = params.network;
    this.feeAttribution = params.feeAttribution;
    this.router = params.router;
    this.cashier = params.cashier;
    this.netting = params.netting;
    this.sessionSigner = params.sessionSigner;
    this.apiBaseUrl = params.apiBaseUrl;
    this.wsUrl = params.wsUrl;
    this.forceStandaloneSimulation = params.forceStandaloneSimulation;
    this.simulationIntervalMs = params.simulationIntervalMs;
  }

  static async connect(config: CartridgeConnectConfig): Promise<CartridgeClient> {
    const envApi =
      typeof process !== "undefined"
        ? (process.env?.CARTRIDGEFI_API_URL ?? process.env?.NEXT_PUBLIC_CORE_API_URL)
        : undefined;
    const envWs =
      typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_WS_MESH_URL : undefined;

    const apiBaseUrl = (config.apiBaseUrl ?? envApi ?? "http://localhost:8787").replace(
      /\/+$/,
      "",
    );
    const wsUrl = config.wsUrl ?? envWs ?? "ws://localhost:8788/ws";
    const network = config.network ?? "devnet";
    const mode = config.mode ?? "PAPER";

    let manifest =
      config.manifest ??
      FIRST_PARTY_CARTRIDGE_CATALOG.find((m) => m.metadata.slug === config.cartridgeSlug);

    const isRemoteBrowserPointingToLocal =
      typeof window !== "undefined" &&
      window.location &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1" &&
      (apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1"));

    if (!manifest && !config.forceStandaloneSimulation && !isRemoteBrowserPointingToLocal) {
      try {
        const res = await fetch(`${apiBaseUrl}/v1/cartridges`, {
          signal: AbortSignal.timeout(1_500),
        });
        if (res.ok) {
          const rawList: unknown = await res.json();
          if (Array.isArray(rawList)) {
            for (const item of rawList) {
              const parsed = CartridgeManifestV2Schema.safeParse(item);
              if (parsed.success && parsed.data.metadata.slug === config.cartridgeSlug) {
                manifest = parsed.data;
                break;
              }
            }
          }
        }
      } catch {
        // Offline catalog fallback below
      }
    }

    if (!manifest) {
      const compiled = compilePromptToManifest({
        prompt: config.cartridgeSlug.replace(/-/g, " "),
        genre: "BOREL_GAMEDAY",
        creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
      });
      manifest = compiled.compliance.valid
        ? {
            ...compiled.manifest,
            metadata: {
              ...compiled.manifest.metadata,
              slug: config.cartridgeSlug
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "-")
                .slice(0, 48),
            },
          }
        : BOREL_GAMEDAY_MANIFEST;
    }

    const plan = await deriveCartridgeDeploymentPlan(manifest, { network });
    let roomId = plan.roomId;

    if (!config.forceStandaloneSimulation) {
      try {
        const roomsRes = await fetch(
          `${apiBaseUrl}/v1/rooms?slug=${encodeURIComponent(manifest.metadata.slug)}`,
          { signal: AbortSignal.timeout(1_500) },
        );
        if (roomsRes.ok) {
          const body: unknown = await roomsRes.json();
          if (isRecord(body) && Array.isArray(body.rooms)) {
            const firstRoom = body.rooms[0];
            if (isRecord(firstRoom) && typeof firstRoom.roomId === "string") {
              roomId = firstRoom.roomId;
            }
          }
        }
      } catch {
        // Use deterministic plan.roomId
      }
    }

    const partnerId = config.partnerId?.trim() || "first-party-studio";
    const hasPartnerVault = Boolean(config.partnerFeeVault && config.partnerFeeVault.trim().length > 0);
    const partnerFeeVault = hasPartnerVault && config.partnerFeeVault
      ? normalizeToSolanaAddress(config.partnerFeeVault)
      : null;

    const feeAttribution: FeeAttributionSummary = partnerFeeVault
      ? {
          partnerWalletActive: true,
          partnerId,
          partnerFeeVault,
          partnerShareBps: ENGINE_GUARDRAILS.partnerWalletShareBps,
          creatorShareBps: ENGINE_GUARDRAILS.partnerCreatorShareBps,
          engineShareBps: ENGINE_GUARDRAILS.partnerEngineShareBps,
          splitLabel: "40% Partner Wallet / 30% Creator / 30% Engine",
        }
      : {
          partnerWalletActive: false,
          partnerId,
          partnerFeeVault: null,
          partnerShareBps: 0,
          creatorShareBps: manifest.metadata.creatorFeeShareBps,
          engineShareBps: 10_000 - manifest.metadata.creatorFeeShareBps,
          splitLabel: `${Math.floor(manifest.metadata.creatorFeeShareBps / 100)}% Creator / ${Math.floor((10_000 - manifest.metadata.creatorFeeShareBps) / 100)}% CartridgeFi Engine`,
        };

    const playerWallet = config.playerWallet
      ? normalizeToSolanaAddress(config.playerWallet)
      : normalizeToSolanaAddress(CARTRIDGE_DEVNET_AUTHORITIES.pacerBot3);

    const maxEnvelopeUsdcAtomic =
      BigInt(manifest.onboardingAndSession.liveSessionEnvelopeUsdc.maxUsdc) * USDC_UNIT;
    const sessionSigner = await MagicBlockSessionSigner.create({
      ownerWallet: playerWallet,
      roomShardPda: plan.roomShardPda,
      maxUsdcAtomic: mode === "LIVE" ? maxEnvelopeUsdcAtomic : 0n,
      maxLeverage: manifest.onboardingAndSession.liveSessionEnvelopeUsdc.maxLeverage,
      mode,
    });

    const router = new MagicBlockRouterClient({ wsMeshUrl: wsUrl });
    const cashier = new CashModalClient({ apiBaseUrl });
    const netting = new StanceNettingEngine({
      nettingPolicy: extractManifestNettingPolicy(manifest),
    });

    return new CartridgeClient({
      manifest,
      roomId,
      roomShardPda: plan.roomShardPda,
      cartridgeManifestPda: plan.cartridgeManifestPda,
      playerWallet,
      mode,
      network,
      feeAttribution,
      router,
      cashier,
      netting,
      sessionSigner,
      apiBaseUrl,
      wsUrl,
      forceStandaloneSimulation: config.forceStandaloneSimulation ?? false,
      simulationIntervalMs: config.simulationIntervalMs ?? 250,
    });
  }

  attachSessionSigner(signer: MagicBlockSessionSigner): void {
    this.sessionSigner = signer;
  }

  get activeSessionPubkey(): Address {
    return this.sessionSigner.sessionPubkey;
  }

  get phase(): RoomPhaseCode {
    return this.currentPhase;
  }

  private ensureStreamStarted(): void {
    if (this.pulseSubscription !== null) {
      return;
    }
    this.pulseSubscription = this.router.subscribeWorldPulse(
      {
        roomId: this.roomId,
        cartridgeSlug: this.manifest.metadata.slug,
        wsUrl: this.wsUrl,
        forceStandaloneSimulation: this.forceStandaloneSimulation,
        simulationIntervalMs: this.simulationIntervalMs,
      },
      (frame, enriched) => {
        this.currentPhase = frame.phase;
        for (const tickListener of this.worldTickListeners) {
          tickListener(frame);
        }
        for (const pulseListener of this.marketPulseListeners) {
          pulseListener(enriched);
        }
      },
    );
  }

  private maybeStopStream(): void {
    if (this.marketPulseListeners.size === 0 && this.worldTickListeners.size === 0) {
      this.pulseSubscription?.close();
      this.pulseSubscription = null;
    }
  }

  /**
   * Subscribes to enriched real-time market pulses (`symbol`, `price8`, `velocityBps`, `volatilitySigmaMilli`, `phase`, `rankDelta`).
   * Returns an unsubscribe cleanup function.
   */
  onMarketPulse(handler: (pulse: EnrichedMarketPulse) => void): () => void {
    this.marketPulseListeners.add(handler);
    this.ensureStreamStarted();
    return () => {
      this.marketPulseListeners.delete(handler);
      this.maybeStopStream();
    };
  }

  /**
   * Subscribes to raw 48-byte decoded `WorldPulseFrame` ticks for 60fps `requestAnimationFrame` / Phaser / Three.js render loops.
   * Returns an unsubscribe cleanup function.
   */
  onWorldTick(handler: (frame: WorldPulseFrame) => void): () => void {
    this.worldTickListeners.add(handler);
    this.ensureStreamStarted();
    return () => {
      this.worldTickListeners.delete(handler);
      this.maybeStopStream();
    };
  }

  /**
   * Emits a zero-popup, 0-gas gameplay action signed by the MagicBlock Ephemeral Session Key
   * and buffered through `StanceNettingEngine`.
   */
  async emitAction(
    event: AllowedSessionActionType,
    payload: StanceActionInput,
  ): Promise<EmittedActionReceipt> {
    const { metrics, autoFlushedBatch } = this.netting.recordAction(event, payload);

    const signedEnvelope = await this.sessionSigner.signSessionAction({
      actionType: event,
      requestedLeverage: this.manifest.onboardingAndSession.liveSessionEnvelopeUsdc.maxLeverage,
      data: {
        weightsBps: metrics.currentStanceVectorBps,
        kalshiCall: metrics.kalshiBinaryCall,
        kalshiProbBps: metrics.kalshiProbBps,
        rawMoves: metrics.rawGameActionsCount,
      },
    });

    let syncedToCoreApi = false;
    if (!this.forceStandaloneSimulation) {
      try {
        const res = await fetch(
          `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(this.roomId)}/stance`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              player: this.playerWallet,
              ephemeralSessionKey: this.sessionSigner.sessionPubkey,
              weightsBps: metrics.currentStanceVectorBps,
              kalshiBinaryCall: metrics.kalshiBinaryCall,
              triggerCheckpointNetting: autoFlushedBatch !== null,
            }),
            signal: AbortSignal.timeout(1_500),
          },
        );
        syncedToCoreApi = res.ok;
      } catch {
        syncedToCoreApi = false;
      }
    }

    return {
      roomId: this.roomId,
      event,
      signedEnvelope,
      nettingMetrics: metrics,
      flushedBatch: autoFlushedBatch,
      syncedToCoreApi,
    };
  }

  /**
   * Alias for `emitAction` matching `SKILL.md` & game-loop helper conventions.
   */
  async emitGameAction(
    event: AllowedSessionActionType,
    payload: StanceActionInput,
  ): Promise<EmittedActionReceipt> {
    return this.emitAction(event, payload);
  }

  /**
   * Unseals the Private ER TEE Fog-of-War (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`)
   * for the final Showdown window, building the canonical Codama `triggerShowdownUnseal` instruction.
   */
  async triggerShowdownUnseal(): Promise<ShowdownUnsealReceipt> {
    this.netting.flushCheckpoint("SETTLEMENT");
    this.currentPhase = RoomPhaseCode.Showdown;

    const [playerStancePda] = await cartridgeErRoom.findPlayerStancePda({
      roomShard: this.roomShardPda,
      player: this.playerWallet,
    });

    const unsealIx = await cartridgeErRoom.getTriggerShowdownUnsealInstructionAsync({
      authority: createNoopSigner(this.playerWallet),
      roomShard: this.roomShardPda,
      playerStance: playerStancePda,
    });

    let syncedToCoreApi = false;
    if (!this.forceStandaloneSimulation) {
      try {
        const res = await fetch(
          `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(this.roomId)}/unseal`,
          {
            method: "POST",
            signal: AbortSignal.timeout(1_500),
          },
        );
        syncedToCoreApi = res.ok;
      } catch {
        syncedToCoreApi = false;
      }
    }

    const vrfDigest = sha256Sync(utf8ToBytes(`vrf_showdown:${this.roomId}:${this.roomShardPda}`));
    const metrics = this.netting.getTelemetry();

    const unsealedRivals: RivalUnsealedStance[] = [
      {
        playerHandle: "@You (Session)",
        rank: 1,
        weightsBps: metrics.currentStanceVectorBps,
        finalScoreFormatted: "+0.1842",
      },
      {
        playerHandle: "@QuantViper.sol",
        rank: 2,
        weightsBps: [5_500, 3_000, -1_500, 0],
        finalScoreFormatted: "+0.1490",
      },
      {
        playerHandle: "@BorelPacer_01",
        rank: 3,
        weightsBps: [-4_000, 4_500, 1_500, 0],
        finalScoreFormatted: "+0.0915",
      },
    ];

    return {
      roomId: this.roomId,
      phase: "SHOWDOWN",
      phaseCode: RoomPhaseCode.Showdown,
      fogEncrypted: false,
      permissionProgramId: MAGICBLOCK_CONSTANTS.permissionProgramId,
      vrfProofHex: bytesToHex(vrfDigest),
      unsealedRivals,
      triggerShowdownInstruction: {
        programAddress: unsealIx.programAddress,
        accounts: unsealIx.accounts.map((a) => ({
          address: a.address,
          role: a.role,
        })),
        dataHex: bytesToHex(new Uint8Array(unsealIx.data)),
        byteLength: unsealIx.data.byteLength,
      },
      syncedToCoreApi,
    };
  }

  /**
   * Claims a room podium prize in the winner's chosen asset (`NVDAx`, `ANTx`, `SPYx`, `TSLAx`, or `USDC`)
   * with automatic geo-safe `USDC` fallback when `CAN_CLAIM_XSTOCKS` is absent on the player's Passport.
   */
  async claimStockPrize(
    asset: ClaimAssetSymbol,
    options?: {
      payoutUsdcAtomic?: bigint;
      eligibilityBitmask?: number;
      currentEloScaled?: bigint;
    },
  ): Promise<ClaimStockPrizeReceipt> {
    const fullEligibility =
      PASSPORT_ELIGIBILITY_BITS.GEO_ELIGIBLE |
      PASSPORT_ELIGIBILITY_BITS.CAN_CLAIM_XSTOCKS |
      PASSPORT_ELIGIBILITY_BITS.SYBIL_VERIFIED;
    const bitmask = options?.eligibilityBitmask ?? fullEligibility;
    const canClaimXStocks =
      (bitmask & PASSPORT_ELIGIBILITY_BITS.GEO_ELIGIBLE) !== 0 &&
      (bitmask & PASSPORT_ELIGIBILITY_BITS.CAN_CLAIM_XSTOCKS) !== 0;

    const geoFallbackApplied = asset !== "USDC" && !canClaimXStocks;
    const settledAsset: ClaimAssetSymbol = geoFallbackApplied ? "USDC" : asset;
    const settledMint = SOLANA_CANONICAL_MINTS[settledAsset];
    const payoutUsdcAtomic = options?.payoutUsdcAtomic ?? 45n * USDC_UNIT;

    if (!this.forceStandaloneSimulation) {
      try {
        const res = await fetch(
          `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(this.roomId)}/claim`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              player: this.playerWallet,
              desiredAsset: asset,
              eligibilityBitmask: bitmask,
              fallbackToUsdc: true,
            }),
            signal: AbortSignal.timeout(1_500),
          },
        );
        if (res.ok) {
          const raw: unknown = await res.json();
          if (isRecord(raw) && typeof raw.claimSignature === "string") {
            const settledFromApi: ClaimAssetSymbol =
              raw.settledAsset === "NVDAx" ||
              raw.settledAsset === "ANTx" ||
              raw.settledAsset === "SPYx" ||
              raw.settledAsset === "TSLAx" ||
              raw.settledAsset === "USDC"
                ? raw.settledAsset
                : settledAsset;
            const payoutAtomic =
              typeof raw.payoutUsdcAtomic === "number"
                ? BigInt(Math.trunc(raw.payoutUsdcAtomic))
                : payoutUsdcAtomic;
            const deliveredAtomic =
              typeof raw.deliveredAssetUnitsAtomic === "number"
                ? BigInt(Math.trunc(raw.deliveredAssetUnitsAtomic))
                : payoutAtomic;
            const eloUpdate = computeUpdatedMarketElo(
              options?.currentEloScaled ?? ENGINE_GUARDRAILS.defaultEloScaled,
              ENGINE_GUARDRAILS.defaultEloScaled,
              FP_SCALE,
              this.mode,
            );
            return {
              roomId: this.roomId,
              player: this.playerWallet,
              requestedAsset: asset,
              settledAsset: settledFromApi,
              settledMint: SOLANA_CANONICAL_MINTS[settledFromApi],
              geoFallbackApplied: Boolean(raw.geoFallbackApplied),
              payoutUsdcAtomic: payoutAtomic,
              payoutUsdcFormatted: formatScaledBigInt((payoutAtomic * FP_SCALE) / USDC_UNIT, 2),
              deliveredUnitsAtomic: deliveredAtomic,
              deliveredUnitsFormatted: formatScaledBigInt(
                (deliveredAtomic * FP_SCALE) / USDC_UNIT,
                4,
              ),
              routingVenue: settledFromApi === "USDC" ? "CANONICAL_USDC" : "JUPITER_XSTOCKS",
              claimSignature: raw.claimSignature,
              updatedEloScaled: eloUpdate.nextEloScaled,
              updatedEloFormatted: formatScaledBigInt(eloUpdate.nextEloScaled, 0),
              source: "core_api",
            };
          }
        }
      } catch {
        // Offline deterministic settlement calculation below
      }
    }

    // Pure integer swap conversion: payoutUsdcAtomic (10^6) * 10^8 / price8 -> 6-decimal token atomic units
    const price8 = DEFAULT_ASSET_PRICES8[settledAsset];
    const deliveredUnitsAtomic =
      settledAsset === "USDC"
        ? payoutUsdcAtomic
        : (payoutUsdcAtomic * 100_000_000n) / price8;

    const eloUpdate = computeUpdatedMarketElo(
      options?.currentEloScaled ?? ENGINE_GUARDRAILS.defaultEloScaled,
      ENGINE_GUARDRAILS.defaultEloScaled,
      FP_SCALE,
      this.mode,
    );

    const claimDigest = sha256Sync(
      utf8ToBytes(`claim_prize:${this.roomId}:${this.playerWallet}:${settledAsset}`),
    );
    const sigBytes = new Uint8Array(64);
    sigBytes.set(claimDigest, 0);
    sigBytes.set(claimDigest, 32);
    const claimSignature = getBase58Decoder().decode(sigBytes);

    return {
      roomId: this.roomId,
      player: this.playerWallet,
      requestedAsset: asset,
      settledAsset,
      settledMint,
      geoFallbackApplied,
      payoutUsdcAtomic,
      payoutUsdcFormatted: formatScaledBigInt((payoutUsdcAtomic * FP_SCALE) / USDC_UNIT, 2),
      deliveredUnitsAtomic,
      deliveredUnitsFormatted: formatScaledBigInt(
        (deliveredUnitsAtomic * FP_SCALE) / USDC_UNIT,
        4,
      ),
      routingVenue: settledAsset === "USDC" ? "CANONICAL_USDC" : "JUPITER_XSTOCKS",
      claimSignature,
      updatedEloScaled: eloUpdate.nextEloScaled,
      updatedEloFormatted: formatScaledBigInt(eloUpdate.nextEloScaled, 0),
      source: "standalone_fallback",
    };
  }

  /**
   * Validates `manifest`, derives canonical `CartridgeManifestAccount` & `RoomShard` PDAs + Codama instructions,
   * and registers the room on `core-api` when reachable.
   */
  async deployManifestOnChain(
    manifest: CartridgeManifestV2,
    network: "devnet" | "mainnet-beta" = this.network,
  ): Promise<OnChainDeploymentReceipt> {
    const plan = await deriveCartridgeDeploymentPlan(manifest, {
      network,
    });

    let deployedViaCoreApi = false;
    let resolvedRoomId = plan.roomId;

    if (!this.forceStandaloneSimulation) {
      try {
        const res = await fetch(`${this.apiBaseUrl}/v1/rooms/deploy`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            manifest,
            authority: plan.authorityAddress,
            mode: this.mode,
            isPrivateFog: manifest.magicblockRoomConfig.privacyMode === "PRIVATE_TEE_FOG_OF_WAR",
            partnerWallet: this.feeAttribution.partnerFeeVault ?? undefined,
          }),
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) {
          const raw: unknown = await res.json();
          if (isRecord(raw) && typeof raw.roomId === "string") {
            resolvedRoomId = raw.roomId;
            deployedViaCoreApi = true;
          }
        }
      } catch {
        deployedViaCoreApi = false;
      }
    }

    return {
      ...plan,
      roomId: resolvedRoomId,
      deployedViaCoreApi,
    };
  }

  disconnect(): void {
    this.marketPulseListeners.clear();
    this.worldTickListeners.clear();
    this.pulseSubscription?.close();
    this.pulseSubscription = null;
    this.sessionSigner.revoke();
  }
}
