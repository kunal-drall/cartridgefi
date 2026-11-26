import { absBigInt, BPS_DENOMINATOR } from "@cartridgefi/shared-types";
import type { AllowedSessionActionType } from "./session-signer.js";

export type NettingPolicyMode = "NET_AT_CHECKPOINTS_30S" | "NET_ON_ENTRY_AND_SETTLEMENT";

export type LaneState = "LANE_LEFT" | "LANE_CENTER" | "LANE_RIGHT";

export type KalshiBinaryCallCode = 0 | 1 | 2; // 0 = unset, 1 = NO, 2 = YES

export type StanceVector4Bps = [number, number, number, number];

export type StanceActionInput =
  | {
      state: LaneState;
      laneWeightBps?: number;
    }
  | {
      weightsBps: readonly [number, number, number, number];
      kalshiBinaryCall?: KalshiBinaryCallCode;
      kalshiProbBps?: number;
    }
  | {
      call: "YES" | "NO" | KalshiBinaryCallCode;
      forecastProbBps?: number;
    }
  | {
      districtIndex: 0 | 1 | 2 | 3;
      convictionBps?: number;
    };

export interface NettedVenueOrderBatch {
  batchId: number;
  reason: "ENTRY" | "CHECKPOINT_30S" | "SETTLEMENT";
  timestampMs: bigint;
  previousSettledVectorBps: StanceVector4Bps;
  nextSettledVectorBps: StanceVector4Bps;
  netVenueDeltaBps: StanceVector4Bps;
  kalshiBinaryCall: KalshiBinaryCallCode;
  kalshiProbBps: number;
  grossMovesCollapsedInBatch: number;
}

export interface StanceNettingMetrics {
  nettingPolicy: NettingPolicyMode;
  checkpointIntervalMs: bigint;
  rawGameActionsCount: number;
  nettedVenueOrdersCount: number;
  savedPredatorySwapsCount: number;
  pendingUnflushedMovesCount: number;
  currentStanceVectorBps: StanceVector4Bps;
  lastSettledVenueVectorBps: StanceVector4Bps;
  pendingNetDeltaBps: StanceVector4Bps;
  kalshiBinaryCall: KalshiBinaryCallCode;
  kalshiProbBps: number;
  batches: readonly NettedVenueOrderBatch[];
}

export interface StanceActionResult {
  metrics: StanceNettingMetrics;
  autoFlushedBatch: NettedVenueOrderBatch | null;
}

function assertValidStanceVectorBps(vec: readonly [number, number, number, number]): StanceVector4Bps {
  let grossSumBps = 0n;
  const out: StanceVector4Bps = [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) {
    const leg = vec[i] ?? 0;
    if (!Number.isInteger(leg) || leg < -10_000 || leg > 10_000) {
      throw new Error(`Stance leg[${i}] (${leg}) must be an integer within [-10000, +10000] bps.`);
    }
    grossSumBps += absBigInt(BigInt(leg));
    out[i] = leg;
  }
  if (grossSumBps > BPS_DENOMINATOR) {
    throw new Error(
      `Gross conviction weight ${grossSumBps.toString()} bps exceeds ${BPS_DENOMINATOR.toString()} bps (1.0x normalized cap).`,
    );
  }
  return out;
}

function computeDeltaVector(
  current: StanceVector4Bps,
  settled: StanceVector4Bps,
): StanceVector4Bps {
  return [
    current[0] - settled[0],
    current[1] - settled[1],
    current[2] - settled[2],
    current[3] - settled[3],
  ];
}

function isNonZeroVector(vec: StanceVector4Bps): boolean {
  return vec[0] !== 0 || vec[1] !== 0 || vec[2] !== 0 || vec[3] !== 0;
}

/**
 * Deterministic ER Stance Netting Engine.
 * Buffers 60fps / 10ms in-game reflex actions (`PLAYER_LANE_SWITCH`, `SUBMIT_CONVICTION_WEIGHTS`,
 * `CALL_KALSHI_CATALYST`, `CLAIM_DISTRICT_TURF`) into compact integer bps Stance Vectors and nets
 * them only at 30-second checkpoints or entry/settlement — eliminating predatory per-move swap churn.
 */
export class StanceNettingEngine {
  readonly nettingPolicy: NettingPolicyMode;
  readonly checkpointIntervalMs: bigint;

  private rawGameActionsCount: number = 0;
  private nettedVenueOrdersCount: number = 0;
  private pendingMovesSinceFlush: number = 0;
  private lastCheckpointMs: bigint;
  private currentVectorBps: StanceVector4Bps = [0, 0, 0, 0];
  private settledVectorBps: StanceVector4Bps = [0, 0, 0, 0];
  private kalshiCall: KalshiBinaryCallCode = 0;
  private settledKalshiCall: KalshiBinaryCallCode = 0;
  private kalshiProbBps: number = 5_000;
  private readonly batches: NettedVenueOrderBatch[] = [];

  constructor(options?: {
    nettingPolicy?: NettingPolicyMode;
    checkpointIntervalMs?: bigint;
    initialTimestampMs?: bigint;
  }) {
    this.nettingPolicy = options?.nettingPolicy ?? "NET_AT_CHECKPOINTS_30S";
    this.checkpointIntervalMs = options?.checkpointIntervalMs ?? 30_000n;
    if (this.checkpointIntervalMs <= 0n) {
      throw new Error("checkpointIntervalMs must be > 0n");
    }
    this.lastCheckpointMs = options?.initialTimestampMs ?? BigInt(Date.now());
  }

  recordAction(
    event: AllowedSessionActionType,
    input: StanceActionInput,
    timestampMs: bigint = BigInt(Date.now()),
  ): StanceActionResult {
    switch (event) {
      case "PLAYER_LANE_SWITCH": {
        if (!("state" in input)) {
          throw new Error("PLAYER_LANE_SWITCH requires { state: 'LANE_LEFT' | 'LANE_CENTER' | 'LANE_RIGHT' }");
        }
        const magnitude = input.laneWeightBps ?? 10_000;
        if (!Number.isInteger(magnitude) || magnitude < 0 || magnitude > 10_000) {
          throw new Error("laneWeightBps must be an integer in [0, 10000]");
        }
        if (input.state === "LANE_LEFT") {
          this.currentVectorBps = [-magnitude, 0, 0, 0];
        } else if (input.state === "LANE_CENTER") {
          this.currentVectorBps = [0, 0, 0, 0];
        } else if (input.state === "LANE_RIGHT") {
          this.currentVectorBps = [magnitude, 0, 0, 0];
        } else {
          throw new Error(`Invalid lane state: ${String(input.state)}`);
        }
        break;
      }

      case "SUBMIT_CONVICTION_WEIGHTS": {
        if (!("weightsBps" in input)) {
          throw new Error("SUBMIT_CONVICTION_WEIGHTS requires { weightsBps: [w0, w1, w2, w3] }");
        }
        this.currentVectorBps = assertValidStanceVectorBps(input.weightsBps);
        if (input.kalshiBinaryCall !== undefined) {
          this.kalshiCall = input.kalshiBinaryCall;
        }
        if (input.kalshiProbBps !== undefined) {
          this.setKalshiProbBps(input.kalshiProbBps);
        }
        break;
      }

      case "CALL_KALSHI_CATALYST":
      case "PORTAL_GATE_PASS":
      case "SUBMIT_BRACKET_FORECAST": {
        if (!("call" in input)) {
          throw new Error(`${event} requires { call: 'YES' | 'NO' | 0 | 1 | 2 }`);
        }
        if (input.call === "YES" || input.call === 2) {
          this.kalshiCall = 2;
        } else if (input.call === "NO" || input.call === 1) {
          this.kalshiCall = 1;
        } else {
          this.kalshiCall = 0;
        }
        if (input.forecastProbBps !== undefined) {
          this.setKalshiProbBps(input.forecastProbBps);
        }
        break;
      }

      case "CLAIM_DISTRICT_TURF": {
        if (!("districtIndex" in input)) {
          throw new Error("CLAIM_DISTRICT_TURF requires { districtIndex: 0 | 1 | 2 | 3 }");
        }
        const conviction = input.convictionBps ?? 10_000;
        if (!Number.isInteger(conviction) || conviction < -10_000 || conviction > 10_000) {
          throw new Error("convictionBps must be an integer in [-10000, +10000]");
        }
        const next: StanceVector4Bps = [0, 0, 0, 0];
        next[input.districtIndex] = conviction;
        this.currentVectorBps = assertValidStanceVectorBps(next);
        break;
      }

      case "TRIGGER_SHOWDOWN_UNSEAL": {
        break;
      }
    }

    this.rawGameActionsCount += 1;
    this.pendingMovesSinceFlush += 1;

    let autoFlushedBatch: NettedVenueOrderBatch | null = null;
    if (
      this.nettingPolicy === "NET_AT_CHECKPOINTS_30S" &&
      timestampMs - this.lastCheckpointMs >= this.checkpointIntervalMs
    ) {
      autoFlushedBatch = this.flushCheckpoint("CHECKPOINT_30S", timestampMs);
    }

    return {
      metrics: this.getTelemetry(),
      autoFlushedBatch,
    };
  }

  private setKalshiProbBps(probBps: number): void {
    if (!Number.isInteger(probBps) || probBps < 0 || probBps > 10_000) {
      throw new Error("kalshiProbBps must be an integer in [0, 10000]");
    }
    this.kalshiProbBps = probBps;
  }

  /**
   * Computes the net difference between current buffered ER stance and last venue-settled vector.
   * Only emits a venue order batch if the net delta is non-zero (or Kalshi binary call changed),
   * collapsing hundreds of intra-window lane switches into at most 1 venue order.
   */
  flushCheckpoint(
    reason: "ENTRY" | "CHECKPOINT_30S" | "SETTLEMENT",
    timestampMs: bigint = BigInt(Date.now()),
  ): NettedVenueOrderBatch | null {
    this.lastCheckpointMs = timestampMs;
    const netDelta = computeDeltaVector(this.currentVectorBps, this.settledVectorBps);
    const kalshiChanged = this.kalshiCall !== this.settledKalshiCall;
    const collapsedMoves = this.pendingMovesSinceFlush;
    this.pendingMovesSinceFlush = 0;

    if (!isNonZeroVector(netDelta) && !kalshiChanged) {
      return null;
    }

    const previousSettled: StanceVector4Bps = [...this.settledVectorBps];
    const nextSettled: StanceVector4Bps = [...this.currentVectorBps];
    this.settledVectorBps = nextSettled;
    this.settledKalshiCall = this.kalshiCall;
    this.nettedVenueOrdersCount += 1;

    const batch: NettedVenueOrderBatch = {
      batchId: this.nettedVenueOrdersCount,
      reason,
      timestampMs,
      previousSettledVectorBps: previousSettled,
      nextSettledVectorBps: nextSettled,
      netVenueDeltaBps: netDelta,
      kalshiBinaryCall: this.kalshiCall,
      kalshiProbBps: this.kalshiProbBps,
      grossMovesCollapsedInBatch: collapsedMoves,
    };
    this.batches.push(batch);
    return batch;
  }

  getTelemetry(): StanceNettingMetrics {
    const currentCopy: StanceVector4Bps = [...this.currentVectorBps];
    const settledCopy: StanceVector4Bps = [...this.settledVectorBps];
    return {
      nettingPolicy: this.nettingPolicy,
      checkpointIntervalMs: this.checkpointIntervalMs,
      rawGameActionsCount: this.rawGameActionsCount,
      nettedVenueOrdersCount: this.nettedVenueOrdersCount,
      savedPredatorySwapsCount: Math.max(0, this.rawGameActionsCount - this.nettedVenueOrdersCount),
      pendingUnflushedMovesCount: this.pendingMovesSinceFlush,
      currentStanceVectorBps: currentCopy,
      lastSettledVenueVectorBps: settledCopy,
      pendingNetDeltaBps: computeDeltaVector(currentCopy, settledCopy),
      kalshiBinaryCall: this.kalshiCall,
      kalshiProbBps: this.kalshiProbBps,
      batches: [...this.batches],
    };
  }
}
