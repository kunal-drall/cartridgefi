import { getBase58Decoder, signBytes, type KeyPairSigner } from "@solana/kit";
import {
  DELEGATION_PROGRAM_ID,
  getAuthToken,
  PERMISSION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-kit";
import {
  decodeWorldPulseFrame,
  encodeWorldPulseFrame,
  formatScaledBigInt,
  MAGICBLOCK_CONSTANTS,
  RoomPhaseCode,
  WORLD_PULSE_FRAME_BYTES,
  type WorldPulseFrame,
} from "@cartridgefi/shared-types";
import { normalizeToSolanaAddress, utf8ToBytes } from "./pda-and-deploy.js";

export interface MagicBlockRouterConfig {
  routerHttpUrl?: string;
  routerWsUrl?: string;
  teeBaseEndpoint?: string;
  teeEndpointTemplate?: string;
  privatePaymentsUrl?: string;
  wsMeshUrl?: string;
  requestTimeoutMs?: number;
}

export interface RouterDelegationStatus {
  account: string;
  isDelegated: boolean;
  fqdn: string;
  delegationProgramId: string;
  permissionProgramId: string;
  delegationSlot: number | null;
  source: "magicblock_router" | "standalone_fallback";
}

export interface PrivateTeeChallengeBundle {
  pubkey: string;
  timestampMs: bigint;
  challengeMessage: string;
  teeLoginUrl: string;
  teeRpcUrlTemplate: string;
  privatePaymentsUrl: string;
  permissionProgramId: string;
}

export interface AuthenticatedTeeSession {
  pubkey: string;
  authToken: string;
  teeEndpoint: string;
  privatePaymentsUrl: string;
  expiresAtMs: bigint;
  source: "magicblock_tee" | "offline_signed_token";
}

export interface EnrichedMarketPulse {
  symbol: string;
  assetIndex: number;
  phase: "LOBBY_OPEN" | "FOG_OF_WAR" | "SHOWDOWN" | "SETTLED_COMMITTED" | "RETRY_GRACE";
  phaseCode: RoomPhaseCode;
  price8: bigint;
  priceFormatted: string;
  velocityBps: number;
  volatilitySigmaMilli: number;
  countdownRemainingMs: number;
  playerRank: number;
  rankDelta: number;
  totalPlayers: number;
  topLeaderScoreScaled: bigint;
  topLeaderScoreFormatted: string;
  activeRoomsCount: number;
  isFogEncrypted: boolean;
  vrfVerified: boolean;
  timestampMs: bigint;
}

export interface WorldPulseStreamOptions {
  roomId?: string;
  cartridgeSlug?: string;
  wsUrl?: string;
  /** Forces local deterministic 48-byte binary frame simulation without attempting WebSocket connection. */
  forceStandaloneSimulation?: boolean;
  /** Interval for deterministic fallback ticks (default `250` ms). */
  simulationIntervalMs?: number;
  /** Initial seed for deterministic standalone fallback. */
  simulationSeed?: bigint;
}

export interface WorldPulseSubscription {
  readonly mode: () => "ws_mesh" | "standalone_simulation";
  close: () => void;
}

const ASSET_INDEX_SYMBOLS = ["SOL-PERP", "NVDAx", "SPYx", "KALSHI-FED-CUT"] as const;

function phaseCodeToLabel(code: RoomPhaseCode): EnrichedMarketPulse["phase"] {
  switch (code) {
    case RoomPhaseCode.LobbyOpen:
      return "LOBBY_OPEN";
    case RoomPhaseCode.FogOfWar:
      return "FOG_OF_WAR";
    case RoomPhaseCode.Showdown:
      return "SHOWDOWN";
    case RoomPhaseCode.SettledCommitted:
      return "SETTLED_COMMITTED";
    case RoomPhaseCode.RetryGrace:
      return "RETRY_GRACE";
    default:
      return "FOG_OF_WAR";
  }
}

function formatPrice8(price8: bigint): string {
  // Convert 10^8 Pyth integer into 10^9 FP_SCALE (multiply by 10n) and format with zero floats
  return formatScaledBigInt(price8 * 10n, 2);
}

function nextSimU64(state: bigint): { nextState: bigint; value: bigint } {
  let x = state & 0xffff_ffff_ffff_ffffn;
  if (x === 0n) x = 0x9e37_79b9_7f4a_7c15n;
  x ^= x >> 12n;
  x ^= (x << 25n) & 0xffff_ffff_ffff_ffffn;
  x ^= x >> 27n;
  const value = (x * 0x2545_f491_4f6c_dd1dn) & 0xffff_ffff_ffff_ffffn;
  return { nextState: x, value };
}

interface JsonRpcDelegationResponse {
  result?: {
    isDelegated?: boolean;
    fqdn?: string;
    delegationRecord?: {
      delegationSlot?: number;
    };
  };
  error?: {
    message?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonRpcDelegationResponse(raw: unknown): JsonRpcDelegationResponse {
  if (!isRecord(raw)) {
    return {};
  }
  const out: JsonRpcDelegationResponse = {};
  if (isRecord(raw.result)) {
    const resObj = raw.result;
    let slot: number | undefined;
    if (isRecord(resObj.delegationRecord) && typeof resObj.delegationRecord.delegationSlot === "number") {
      slot = resObj.delegationRecord.delegationSlot;
    }
    out.result = {
      isDelegated: typeof resObj.isDelegated === "boolean" ? resObj.isDelegated : undefined,
      fqdn: typeof resObj.fqdn === "string" ? resObj.fqdn : undefined,
      delegationRecord: slot !== undefined ? { delegationSlot: slot } : undefined,
    };
  }
  if (isRecord(raw.error) && typeof raw.error.message === "string") {
    out.error = { message: raw.error.message };
  }
  return out;
}

/**
 * MagicBlock Router, Private ER TEE Challenge/Auth Builder, and 48-Byte Binary `WorldPulseFrame` Streamer.
 */
export class MagicBlockRouterClient {
  readonly routerHttpUrl: string;
  readonly routerWsUrl: string;
  readonly teeBaseEndpoint: string;
  readonly teeEndpointTemplate: string;
  readonly privatePaymentsUrl: string;
  readonly wsMeshUrl: string;
  readonly requestTimeoutMs: number;

  constructor(config: MagicBlockRouterConfig = {}) {
    const envRouterHttp =
      typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL : undefined;
    const envTeeBase =
      typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_MAGICBLOCK_TEE_URL : undefined;
    const envWsMesh =
      typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_WS_MESH_URL : undefined;

    this.routerHttpUrl =
      config.routerHttpUrl ?? envRouterHttp ?? MAGICBLOCK_CONSTANTS.devnetRouterHttp;
    this.routerWsUrl = config.routerWsUrl ?? MAGICBLOCK_CONSTANTS.devnetRouterWs;
    this.teeBaseEndpoint =
      config.teeBaseEndpoint ?? envTeeBase ?? MAGICBLOCK_CONSTANTS.devnetTeeBaseEndpoint;
    this.teeEndpointTemplate =
      config.teeEndpointTemplate ?? MAGICBLOCK_CONSTANTS.devnetTeeEndpointTemplate;
    this.privatePaymentsUrl =
      config.privatePaymentsUrl ?? MAGICBLOCK_CONSTANTS.privatePaymentsApiUrl;
    this.wsMeshUrl = config.wsMeshUrl ?? envWsMesh ?? "ws://localhost:8788/ws";
    this.requestTimeoutMs = config.requestTimeoutMs ?? 2_500;
  }

  /**
   * Queries `getDelegationStatus` on `https://devnet-router.magicblock.app` with fast timeout
   * and deterministic standalone fallback when running in offline/sandboxed environments.
   */
  async getDelegationStatus(
    accountPubkey: string,
    signal?: AbortSignal,
  ): Promise<RouterDelegationStatus> {
    const normalized = normalizeToSolanaAddress(accountPubkey);
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    try {
      const response = await fetch(this.routerHttpUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getDelegationStatus",
          params: [normalized],
        }),
        signal: combinedSignal,
      });

      if (response.ok) {
        const parsed = parseJsonRpcDelegationResponse(await response.json());
        if (!parsed.error && parsed.result) {
          return {
            account: normalized,
            isDelegated: Boolean(parsed.result.isDelegated),
            fqdn: parsed.result.fqdn ?? this.teeBaseEndpoint,
            delegationProgramId: DELEGATION_PROGRAM_ID,
            permissionProgramId: PERMISSION_PROGRAM_ID,
            delegationSlot: parsed.result.delegationRecord?.delegationSlot ?? null,
            source: "magicblock_router",
          };
        }
      }
    } catch {
      // Offline or sandboxed environment: return deterministic standalone delegation status
    }

    return {
      account: normalized,
      isDelegated: true,
      fqdn: this.teeBaseEndpoint,
      delegationProgramId: DELEGATION_PROGRAM_ID,
      permissionProgramId: PERMISSION_PROGRAM_ID,
      delegationSlot: 0,
      source: "standalone_fallback",
    };
  }

  /**
   * Constructs Private ER TEE challenge/login metadata (`{pubkey}` + `{timestamp}`) and Private Payments URLs.
   */
  buildPrivateTeeChallengeUrl(params: {
    pubkey: string;
    timestampMs?: bigint;
  }): PrivateTeeChallengeBundle {
    const normalized = normalizeToSolanaAddress(params.pubkey);
    const timestampMs = params.timestampMs ?? BigInt(Date.now());
    const challengeMessage = `CartridgeFi Private ER TEE Login :: pubkey=${normalized} :: timestamp=${timestampMs.toString()}`;
    const teeLoginUrl = `${this.teeBaseEndpoint}/auth/login?pubkey=${encodeURIComponent(normalized)}&timestamp=${timestampMs.toString()}`;

    return {
      pubkey: normalized,
      timestampMs,
      challengeMessage,
      teeLoginUrl,
      teeRpcUrlTemplate: this.teeEndpointTemplate,
      privatePaymentsUrl: this.privatePaymentsUrl,
      permissionProgramId: PERMISSION_PROGRAM_ID,
    };
  }

  buildAuthenticatedTeeEndpoint(authToken: string): string {
    const cleanToken = authToken.trim();
    if (!cleanToken) {
      throw new Error("authToken cannot be empty");
    }
    return this.teeEndpointTemplate.replace("{authToken}", encodeURIComponent(cleanToken));
  }

  /**
   * Authenticates an ephemeral signer against MagicBlock Private ER TEE (`getAuthToken`),
   * falling back to a locally signed Ed25519 bearer token in offline/standalone environments.
   */
  async authenticatePrivateTeeSession(signer: KeyPairSigner): Promise<AuthenticatedTeeSession> {
    try {
      const auth = await Promise.race([
        getAuthToken(
          this.teeBaseEndpoint,
          signer.address,
          async (message: Uint8Array) => {
            const sig = await signBytes(signer.keyPair.privateKey, message);
            return new Uint8Array(sig);
          },
        ),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("TEE auth timeout")), this.requestTimeoutMs);
          if (typeof timer === "object" && "unref" in timer) {
            timer.unref();
          }
        }),
      ]);

      return {
        pubkey: signer.address,
        authToken: auth.token,
        teeEndpoint: this.buildAuthenticatedTeeEndpoint(auth.token),
        privatePaymentsUrl: this.privatePaymentsUrl,
        expiresAtMs: BigInt(auth.expiresAt),
        source: "magicblock_tee",
      };
    } catch {
      const nowMs = BigInt(Date.now());
      const challenge = this.buildPrivateTeeChallengeUrl({
        pubkey: signer.address,
        timestampMs: nowMs,
      });
      const sigBytes = await signBytes(
        signer.keyPair.privateKey,
        utf8ToBytes(challenge.challengeMessage),
      );
      const sigBase58 = getBase58Decoder().decode(sigBytes);
      const offlineToken = `cftee_${signer.address.slice(0, 12)}_${nowMs.toString()}_${sigBase58.slice(0, 24)}`;
      return {
        pubkey: signer.address,
        authToken: offlineToken,
        teeEndpoint: this.buildAuthenticatedTeeEndpoint(offlineToken),
        privatePaymentsUrl: this.privatePaymentsUrl,
        expiresAtMs: nowMs + 3_600_000n,
        source: "offline_signed_token",
      };
    }
  }

  enrichWorldPulseFrame(frame: WorldPulseFrame, previousRank: number | null): EnrichedMarketPulse {
    const symbol = ASSET_INDEX_SYMBOLS[frame.assetIndex % ASSET_INDEX_SYMBOLS.length] ?? "SOL-PERP";
    const rankDelta = previousRank === null ? 0 : previousRank - frame.playerRank;

    return {
      symbol,
      assetIndex: frame.assetIndex,
      phase: phaseCodeToLabel(frame.phase),
      phaseCode: frame.phase,
      price8: frame.price8,
      priceFormatted: formatPrice8(frame.price8),
      velocityBps: frame.velocityBps,
      volatilitySigmaMilli: frame.volatilitySigmaMilli,
      countdownRemainingMs: frame.countdownRemainingMs,
      playerRank: frame.playerRank,
      rankDelta,
      totalPlayers: frame.totalPlayers,
      topLeaderScoreScaled: frame.topLeaderScoreScaled,
      topLeaderScoreFormatted: formatScaledBigInt(frame.topLeaderScoreScaled, 4),
      activeRoomsCount: frame.activeRoomsCount,
      isFogEncrypted: frame.isFogEncrypted,
      vrfVerified: frame.vrfVerified,
      timestampMs: frame.timestampMs,
    };
  }

  /**
   * Subscribes to 48-byte binary `WorldPulseFrame` telemetry from `ws-mesh` (`ws://localhost:8788/ws`),
   * automatically falling back to a deterministic 48-byte binary simulator if `ws-mesh` is unreachable.
   */
  subscribeWorldPulse(
    options: WorldPulseStreamOptions,
    onPulse: (frame: WorldPulseFrame, enriched: EnrichedMarketPulse) => void,
  ): WorldPulseSubscription {
    let closed = false;
    let activeMode: "ws_mesh" | "standalone_simulation" = "ws_mesh";
    let simTimer: ReturnType<typeof setInterval> | null = null;
    let connectGuardTimer: ReturnType<typeof setTimeout> | null = null;
    let wsInstance: WebSocket | null = null;
    let previousRank: number | null = null;

    const intervalMs = Math.max(16, options.simulationIntervalMs ?? 250);
    let prngState = options.simulationSeed ?? 0x4346_5f50_554c_5345n;
    const basePrices8: [bigint, bigint, bigint, bigint] = [
      18_640_000_000n,
      14_280_000_000n,
      59_820_000_000n,
      64_500_000n,
    ];
    let tickCounter = 0;

    const dispatchBinaryBytes = (bytes: Uint8Array): void => {
      if (closed || bytes.byteLength < WORLD_PULSE_FRAME_BYTES) {
        return;
      }
      const decoded = decodeWorldPulseFrame(bytes);
      const enriched = this.enrichWorldPulseFrame(decoded, previousRank);
      previousRank = decoded.playerRank;
      onPulse(decoded, enriched);
    };

    const startSimulation = (): void => {
      if (closed || simTimer !== null) {
        return;
      }
      activeMode = "standalone_simulation";
      const emitSyntheticTick = (): void => {
        if (closed) return;
        const step = nextSimU64(prngState);
        prngState = step.nextState;
        const assetIndex = tickCounter % 4;
        const centered = BigInt(Number(step.value % 61n) - 30);
        const currentBase = basePrices8[assetIndex] ?? 18_640_000_000n;
        const updatedPrice8 = currentBase + (currentBase * centered) / 25_000n;
        basePrices8[assetIndex] = updatedPrice8 > 1_000_000n ? updatedPrice8 : 1_000_000n;

        const totalCycleTicks = 240;
        const cyclePos = tickCounter % totalCycleTicks;
        const remainingMs = Math.max(0, (totalCycleTicks - cyclePos) * 250);
        const isShowdown = remainingMs <= 15_000;
        const phase = isShowdown ? RoomPhaseCode.Showdown : RoomPhaseCode.FogOfWar;
        const velocityBps = Number(centered) * 2;
        const volatilitySigmaMilli = 1_450 + Number(step.value % 1_850n);
        const playerRank = 1 + Number(step.value % 6n);

        const syntheticFrame: WorldPulseFrame = {
          phase,
          assetIndex,
          timestampMs: BigInt(Date.now()),
          price8: basePrices8[assetIndex] ?? 18_640_000_000n,
          velocityBps,
          volatilitySigmaMilli,
          countdownRemainingMs: remainingMs,
          playerRank,
          totalPlayers: 24,
          topLeaderScoreScaled: 142_500_000n + BigInt(tickCounter) * 250_000n,
          activeRoomsCount: 4,
          isFogEncrypted: !isShowdown,
          vrfVerified: isShowdown,
        };
        tickCounter += 1;

        // Round-trip through canonical 48-byte binary codec so standalone matches ws-mesh wire format 100%
        const encoded = encodeWorldPulseFrame(syntheticFrame);
        dispatchBinaryBytes(encoded);
      };

      // Opportunistically seed live SOL/USD price from MagicBlock Devnet ER Pricing Oracle
      if (typeof fetch !== "undefined") {
        void fetch("https://devnet-us.magicblock.app", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [
              "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
              { encoding: "base64" },
            ],
          }),
          signal: AbortSignal.timeout(2_000),
        })
          .then((r) => r.json())
          .then((payload: unknown) => {
            const b64 = (
              payload as {
                result?: { value?: { data?: [string, string] } | null };
              }
            )?.result?.value?.data?.[0];
            if (typeof b64 === "string" && typeof atob === "function") {
              const bin = atob(b64);
              if (bin.length >= 82) {
                const bytes = new Uint8Array(bin.length);
                for (let idx = 0; idx < bin.length; idx++) {
                  bytes[idx] = bin.charCodeAt(idx);
                }
                const view = new DataView(bytes.buffer);
                const msgOffset = bytes[40] === 0 ? 42 : 41;
                const liveSolPrice8 = view.getBigInt64(msgOffset + 32, true);
                if (liveSolPrice8 > 1_000_000n) {
                  basePrices8[0] = liveSolPrice8;
                }
              }
            }
          })
          .catch(() => {
            // Silent deterministic fallback when offline
          });
      }

      emitSyntheticTick();
      simTimer = setInterval(emitSyntheticTick, intervalMs);
    };

    const canAttemptWebSocket = (): { allowed: boolean; url: URL | null } => {
      if (options.forceStandaloneSimulation || typeof WebSocket === "undefined") {
        return { allowed: false, url: null };
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(options.wsUrl ?? this.wsMeshUrl);
      } catch {
        return { allowed: false, url: null };
      }
      if (typeof window !== "undefined" && window.location) {
        const pageIsHttps = window.location.protocol === "https:";
        const pageHost = window.location.hostname;
        const pageIsLocal = pageHost === "localhost" || pageHost === "127.0.0.1";
        const targetIsLocal =
          parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";

        // Prevent Mixed Content SecurityError or doomed localhost connection attempts on Vercel/HTTPS
        if ((pageIsHttps && parsedUrl.protocol === "ws:") || (!pageIsLocal && targetIsLocal)) {
          return { allowed: false, url: null };
        }
      }
      return { allowed: true, url: parsedUrl };
    };

    const wsCheck = canAttemptWebSocket();
    if (!wsCheck.allowed || wsCheck.url === null) {
      startSimulation();
    } else {
      const targetUrl = wsCheck.url;
      if (options.roomId) {
        targetUrl.searchParams.set("room", options.roomId);
      }
      if (options.cartridgeSlug) {
        targetUrl.searchParams.set("slug", options.cartridgeSlug);
      }

      try {
        const ws = new WebSocket(targetUrl.toString());
        ws.binaryType = "arraybuffer";
        wsInstance = ws;

        connectGuardTimer = setTimeout(() => {
          if (!closed && ws.readyState !== WebSocket.OPEN) {
            try {
              ws.close();
            } catch {
              // ignore close error
            }
            startSimulation();
          }
        }, 800);
        if (typeof connectGuardTimer === "object" && "unref" in connectGuardTimer) {
          connectGuardTimer.unref();
        }

        ws.addEventListener("open", () => {
          if (connectGuardTimer !== null) {
            clearTimeout(connectGuardTimer);
            connectGuardTimer = null;
          }
          activeMode = "ws_mesh";
        });

        ws.addEventListener("message", (ev: MessageEvent<unknown>) => {
          if (closed) return;
          if (ev.data instanceof ArrayBuffer) {
            dispatchBinaryBytes(new Uint8Array(ev.data));
          } else if (ArrayBuffer.isView(ev.data)) {
            dispatchBinaryBytes(
              new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength),
            );
          }
        });

        ws.addEventListener("error", () => {
          if (!closed) {
            startSimulation();
          }
        });

        ws.addEventListener("close", () => {
          if (!closed) {
            startSimulation();
          }
        });
      } catch {
        startSimulation();
      }
    }

    return {
      mode: () => activeMode,
      close: () => {
        closed = true;
        if (connectGuardTimer !== null) {
          clearTimeout(connectGuardTimer);
          connectGuardTimer = null;
        }
        if (simTimer !== null) {
          clearInterval(simTimer);
          simTimer = null;
        }
        if (wsInstance !== null) {
          try {
            wsInstance.close();
          } catch {
            // ignore close error
          }
          wsInstance = null;
        }
      },
    };
  }
}
