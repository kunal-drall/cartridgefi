import {
  CARTRIDGE_PROGRAM_IDS,
  MAGICBLOCK_CONSTANTS,
  PULSE_RUNNER_MANIFEST,
  computeDrawdownPenalizedSharpe,
  fpMul,
  formatScaledBigInt,
} from "@cartridgefi/shared-types";

export type RunnerLaneId = "LANE_LEFT" | "LANE_CENTER" | "LANE_RIGHT";
export type TrackObjectKind =
  | "LIQUIDATION_BARRIER"
  | "MOMENTUM_BOOSTER"
  | "KALSHI_PORTAL";
export type MarketRegimeTape = "NORMAL_FLOW" | "VOLATILITY_SPIKE";

export interface TrackObject {
  id: number;
  kind: TrackObjectKind;
  lane: RunnerLaneId;
  /** Depth along perspective track: 1.0 = horizon, 0.12 = player ship plane, < 0 = passed. */
  z: number;
  resolved: boolean;
  label: string;
}

export interface RunnerFlashFeedback {
  text: string;
  tone: "emerald" | "cyan" | "danger" | "amber";
  ttlSecs: number;
}

export interface PulseRunnerRunState {
  isRunning: boolean;
  elapsedSecs: number;
  remainingSecs: number;
  distanceMeters: number;
  activeLane: RunnerLaneId;
  /** Smooth visual horizontal coordinate in [-1, +1] for 60fps Canvas interpolation. */
  visualLaneX: number;
  regimeTape: MarketRegimeTape;
  solPrice8: bigint;
  nvdaPrice8: bigint;
  velocityBps: number;
  /** Volatility sigma scaled by 1000 (e.g. 1850 = 1.85 sigma, 3200 = 3.20 sigma). */
  volatilitySigmaMilli: number;
  trackSpeedMultiplierMilli: number;
  rawSwipes: number;
  nettedCheckpoints: number;
  nextCheckpointInSecs: number;
  kalshiCarryActive: boolean;
  kalshiPortalsPassed: number;
  boostersCollected: number;
  barriersDodged: number;
  barriersHit: number;
  prngState: bigint;
  nextObjectId: number;
  spawnCooldownSecs: number;
  sampleAccumulatorSecs: number;
  objects: TrackObject[];
  stepReturnsScaled: bigint[];
  cumulativeReturnScaled: bigint;
  peakReturnScaled: bigint;
  maxDrawdownScaled: bigint;
  sharpeScoreScaled: bigint;
  sharpeScoreFormatted: string;
  flash: RunnerFlashFeedback | null;
}

export interface PulseRunnerWindowDebugState {
  isRunning: boolean;
  fps: number;
  frameCount: number;
  activeLane: RunnerLaneId;
  rawSwipes: number;
  nettedCheckpoints: number;
  sharpeScoreFormatted: string;
  sharpeScoreScaled: string;
  kalshiCarryActive: boolean;
  distanceMeters: number;
  volatilitySigma: string;
  programId: string;
}

const LANE_ORDER: readonly RunnerLaneId[] = [
  "LANE_LEFT",
  "LANE_CENTER",
  "LANE_RIGHT",
];

export function laneToTargetX(lane: RunnerLaneId): number {
  if (lane === "LANE_LEFT") return -1;
  if (lane === "LANE_RIGHT") return 1;
  return 0;
}

function nextPrngU64(state: bigint): { nextState: bigint; value: bigint } {
  let x = state & 0xffff_ffff_ffff_ffffn;
  if (x === 0n) {
    x = 0x9f4c_7e21_b8a0_3d65n;
  }
  x ^= x >> 12n;
  x ^= (x << 25n) & 0xffff_ffff_ffff_ffffn;
  x ^= x >> 27n;
  const value = (x * 0x2545_f491_4f6c_dd1dn) & 0xffff_ffff_ffff_ffffn;
  return { nextState: x, value };
}

export function createInitialRunnerState(
  regimeTape: MarketRegimeTape = "NORMAL_FLOW",
): PulseRunnerRunState {
  const initialReturns: bigint[] = [12_000_000n, 18_000_000n, 9_000_000n];
  const initialSharpe = computeDrawdownPenalizedSharpe(
    initialReturns,
    0n,
    350_000_000n,
  );

  return {
    isRunning: true,
    elapsedSecs: 0,
    remainingSecs: PULSE_RUNNER_MANIFEST.magicblockRoomConfig.durationSecs,
    distanceMeters: 0,
    activeLane: "LANE_RIGHT",
    visualLaneX: 1,
    regimeTape,
    solPrice8: 19_480_000_000n,
    nvdaPrice8: 14_820_000_000n,
    velocityBps: 18,
    volatilitySigmaMilli: regimeTape === "VOLATILITY_SPIKE" ? 3150 : 1720,
    trackSpeedMultiplierMilli: regimeTape === "VOLATILITY_SPIKE" ? 1750 : 1240,
    rawSwipes: 1,
    nettedCheckpoints: 1, // Initial entry netted checkpoint
    nextCheckpointInSecs: 15,
    kalshiCarryActive: false,
    kalshiPortalsPassed: 0,
    boostersCollected: 0,
    barriersDodged: 0,
    barriersHit: 0,
    prngState: 0x9f4c_7e21_b8a0_3d65n,
    nextObjectId: 4,
    spawnCooldownSecs: 0.55,
    sampleAccumulatorSecs: 0,
    objects: [
      {
        id: 1,
        kind: "MOMENTUM_BOOSTER",
        lane: "LANE_RIGHT",
        z: 0.52,
        resolved: false,
        label: "+SOL/NVDAx",
      },
      {
        id: 2,
        kind: "LIQUIDATION_BARRIER",
        lane: "LANE_LEFT",
        z: 0.76,
        resolved: false,
        label: "LIQ WALL",
      },
      {
        id: 3,
        kind: "KALSHI_PORTAL",
        lane: "LANE_CENTER",
        z: 0.94,
        resolved: false,
        label: "YES FED CUT · 1.5x",
      },
    ],
    stepReturnsScaled: initialReturns,
    cumulativeReturnScaled: 39_000_000n,
    peakReturnScaled: 39_000_000n,
    maxDrawdownScaled: 0n,
    sharpeScoreScaled: initialSharpe,
    sharpeScoreFormatted: formatScaledBigInt(initialSharpe, 3),
    flash: {
      text: "10ms ER Session Armed · 0 Wallet Popups",
      tone: "emerald",
      ttlSecs: 2.2,
    },
  };
}

export function switchRunnerLane(
  state: PulseRunnerRunState,
  targetLane: RunnerLaneId,
): void {
  if (state.activeLane === targetLane) {
    return;
  }
  state.activeLane = targetLane;
  state.rawSwipes += 1;
}

export function stepRunnerLaneRelative(
  state: PulseRunnerRunState,
  delta: -1 | 1,
): void {
  const currentIdx = LANE_ORDER.indexOf(state.activeLane);
  const nextIdx = Math.max(0, Math.min(2, currentIdx + delta));
  const target = LANE_ORDER[nextIdx] ?? "LANE_CENTER";
  switchRunnerLane(state, target);
}

function recordStepReturn(state: PulseRunnerRunState, rawReturnScaled: bigint): void {
  const effectiveReturn =
    state.kalshiCarryActive && rawReturnScaled > 0n
      ? fpMul(rawReturnScaled, 1_500_000_000n)
      : rawReturnScaled;

  state.stepReturnsScaled.push(effectiveReturn);
  if (state.stepReturnsScaled.length > 64) {
    state.stepReturnsScaled.shift();
  }

  state.cumulativeReturnScaled += effectiveReturn;
  if (state.cumulativeReturnScaled > state.peakReturnScaled) {
    state.peakReturnScaled = state.cumulativeReturnScaled;
  }
  const currentDd = state.peakReturnScaled - state.cumulativeReturnScaled;
  if (currentDd > state.maxDrawdownScaled) {
    state.maxDrawdownScaled = currentDd;
  }

  state.sharpeScoreScaled = computeDrawdownPenalizedSharpe(
    state.stepReturnsScaled,
    state.maxDrawdownScaled,
    350_000_000n,
  );
  state.sharpeScoreFormatted = formatScaledBigInt(state.sharpeScoreScaled, 3);
}

/**
 * Steps deterministic 3-lane financial world physics forward by `dtSecs`.
 * Pure rules module — zero browser or canvas dependencies.
 */
export function stepPulseRunnerWorld(
  state: PulseRunnerRunState,
  dtSecsRaw: number,
): void {
  // Smooth visual lane interpolation even if paused so UI feels instant
  const targetX = laneToTargetX(state.activeLane);
  const lerpAlpha = Math.min(1, dtSecsRaw * 16);
  state.visualLaneX += (targetX - state.visualLaneX) * lerpAlpha;

  if (!state.isRunning || state.remainingSecs <= 0) {
    return;
  }

  const dt = Math.max(0.001, Math.min(0.05, dtSecsRaw));
  state.elapsedSecs += dt;
  state.remainingSecs = Math.max(0, state.remainingSecs - dt);

  if (state.flash) {
    state.flash.ttlSecs -= dt;
    if (state.flash.ttlSecs <= 0) {
      state.flash = null;
    }
  }

  // Checkpoint stance netting every 15s (zero swap churn regardless of swipe count)
  state.nextCheckpointInSecs -= dt;
  if (state.nextCheckpointInSecs <= 0) {
    state.nettedCheckpoints += 1;
    state.nextCheckpointInSecs = 15;
    state.flash = {
      text: `Stance Netted (#${state.nettedCheckpoints}) · ${state.rawSwipes} Swipes -> ${state.nettedCheckpoints} Venue Orders`,
      tone: "cyan",
      ttlSecs: 2.0,
    };
  }

  // Deterministic Pyth market pulse every 0.45s
  state.sampleAccumulatorSecs += dt;
  if (state.sampleAccumulatorSecs >= 0.45) {
    state.sampleAccumulatorSecs = 0;
    const r = nextPrngU64(state.prngState);
    state.prngState = r.nextState;

    const spikeMode = state.regimeTape === "VOLATILITY_SPIKE";
    const amp = spikeMode ? 46 : 20;
    const rawCentered = Number(r.value % 201n) - 100; // [-100, +100]
    const velBps = Math.round((rawCentered * amp) / 100) + (spikeMode ? -4 : 5);
    state.velocityBps = velBps;

    const absVel = Math.abs(velBps);
    state.volatilitySigmaMilli =
      (spikeMode ? 2650 : 1450) + absVel * (spikeMode ? 24 : 18);
    state.trackSpeedMultiplierMilli = Math.min(
      2450,
      1050 + Math.round(state.volatilitySigmaMilli * 0.42),
    );

    state.solPrice8 =
      state.solPrice8 + (state.solPrice8 * BigInt(velBps)) / 100_000n;
    state.nvdaPrice8 =
      state.nvdaPrice8 + (state.nvdaPrice8 * BigInt(Math.round(velBps * 0.8))) / 100_000n;

    // Continuous directional stance carry vs live Pyth velocity
    if (state.activeLane === "LANE_CENTER") {
      // Neutral USDC Shield: 0 directional exposure, slight positive stability carry
      recordStepReturn(state, 3_500_000n);
    } else {
      const stanceSign = state.activeLane === "LANE_RIGHT" ? 1n : -1n;
      const directionalRet = stanceSign * BigInt(velBps) * 1_200_000n;
      recordStepReturn(state, directionalRet);
    }
  }

  const speedFactor = state.trackSpeedMultiplierMilli / 1000;
  state.distanceMeters += dt * 42 * speedFactor;

  // Spawn track obstacles & portals driven by volatilitySigmaMilli
  state.spawnCooldownSecs -= dt;
  if (state.spawnCooldownSecs <= 0) {
    const rKind = nextPrngU64(state.prngState);
    state.prngState = rKind.nextState;
    const rLane = nextPrngU64(state.prngState);
    state.prngState = rLane.nextState;

    const roll = Number(rKind.value % 100n);
    const laneIdx = Number(rLane.value % 3n);
    const chosenLane = LANE_ORDER[laneIdx] ?? "LANE_CENTER";

    const highVol = state.volatilitySigmaMilli >= 2500;
    let kind: TrackObjectKind = "MOMENTUM_BOOSTER";
    let label = "+MOMENTUM";
    let spawnLane: RunnerLaneId = chosenLane;

    if (roll < 20) {
      kind = "KALSHI_PORTAL";
      label = "YES FED CUT · 1.5x";
    } else if (roll < (highVol ? 68 : 48)) {
      kind = "LIQUIDATION_BARRIER";
      label = highVol ? "SIGMA LIQ TRAIN" : "LIQ BARRIER";
      // Liquidation barriers spawn in directional outer rails or random lane; Center Shield always protects
      spawnLane = laneIdx === 1 ? (state.velocityBps < 0 ? "LANE_RIGHT" : "LANE_LEFT") : chosenLane;
    } else {
      kind = "MOMENTUM_BOOSTER";
      spawnLane = state.velocityBps >= 0 ? "LANE_RIGHT" : "LANE_LEFT";
      label = spawnLane === "LANE_RIGHT" ? "+LONG ALPHA" : "+SHORT ALPHA";
    }

    state.objects.push({
      id: state.nextObjectId,
      kind,
      lane: spawnLane,
      z: 1.02,
      resolved: false,
      label,
    });
    state.nextObjectId += 1;
    state.spawnCooldownSecs = highVol ? 0.48 : 0.68;
  }

  // Advance objects along perspective track & resolve collisions at player plane (z ~ 0.12)
  const zVelocity = dt * 0.48 * speedFactor;
  for (const obj of state.objects) {
    const prevZ = obj.z;
    obj.z -= zVelocity;

    if (!obj.resolved && prevZ >= 0.12 && obj.z <= 0.14) {
      obj.resolved = true;
      if (obj.lane === state.activeLane) {
        if (obj.kind === "LIQUIDATION_BARRIER") {
          if (state.activeLane === "LANE_CENTER") {
            state.barriersDodged += 1;
            recordStepReturn(state, 8_000_000n);
            state.flash = {
              text: "USDC Shield Absorbed Liquidation Shock (+0 Drawdown)",
              tone: "cyan",
              ttlSecs: 1.5,
            };
          } else {
            state.barriersHit += 1;
            recordStepReturn(state, -48_000_000n);
            state.flash = {
              text: "Liquidation Barrier Hit — Shift Center to Shield!",
              tone: "danger",
              ttlSecs: 1.5,
            };
          }
        } else if (obj.kind === "MOMENTUM_BOOSTER") {
          state.boostersCollected += 1;
          recordStepReturn(state, 32_000_000n);
          state.flash = {
            text: state.kalshiCarryActive
              ? "Momentum Rail +48 bps (1.5x Kalshi Carry)"
              : "Momentum Rail Collected (+32 bps)",
            tone: "emerald",
            ttlSecs: 1.3,
          };
        } else if (obj.kind === "KALSHI_PORTAL") {
          state.kalshiCarryActive = true;
          state.kalshiPortalsPassed += 1;
          recordStepReturn(state, 40_000_000n);
          state.flash = {
            text: "Kalshi Portal Gate Passed · 1.5x Carry Multiplier Active!",
            tone: "cyan",
            ttlSecs: 2.0,
          };
        }
      } else if (obj.kind === "LIQUIDATION_BARRIER") {
        state.barriersDodged += 1;
      }
    }
  }

  // Prune off-screen objects
  if (state.objects.length > 0) {
    state.objects = state.objects.filter((o) => o.z > -0.08);
  }

  if (state.remainingSecs <= 0) {
    state.isRunning = false;
    state.nettedCheckpoints += 1;
    state.flash = {
      text: "90s Volatility Sprint Complete · Ready to Settle to Stock Vault",
      tone: "amber",
      ttlSecs: 5.0,
    };
  }
}

export const PULSE_RUNNER_ENGINE_PROOF = {
  erRoomProgramId: CARTRIDGE_PROGRAM_IDS.erRoom,
  registryProgramId: CARTRIDGE_PROGRAM_IDS.registry,
  sessionKeyProgramId: MAGICBLOCK_CONSTANTS.sessionKeyProgramId,
  vrfProgramId: MAGICBLOCK_CONSTANTS.vrfProgramId,
} as const;
