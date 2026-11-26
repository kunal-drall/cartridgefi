"use client";

import * as React from "react";
import { USDC_UNIT } from "@cartridgefi/shared-types";
import {
  ActionButton,
  GlassCard,
  GlassPill,
  LivePulseDot,
  TabularMetric,
} from "@cartridgefi/ui-system";
import {
  formatShareUnits6,
  useConsoleVault,
} from "@/app/(console)/_components/ConsoleVaultContext";
import { formatPrice8Usd } from "@/games/borel/engine";
import {
  PULSE_RUNNER_ENGINE_PROOF,
  createInitialRunnerState,
  stepPulseRunnerWorld,
  stepRunnerLaneRelative,
  switchRunnerLane,
  type MarketRegimeTape,
  type PulseRunnerRunState,
  type PulseRunnerWindowDebugState,
  type RunnerLaneId,
} from "./engine";
import { renderPulseRunnerFrame } from "./renderer";

declare global {
  interface Window {
    __PULSE_RUNNER_STATE__?: PulseRunnerWindowDebugState;
  }
}

interface HudTelemetrySnapshot {
  isRunning: boolean;
  remainingSecs: number;
  distanceMeters: number;
  activeLane: RunnerLaneId;
  regimeTape: MarketRegimeTape;
  solPriceFormatted: string;
  nvdaPriceFormatted: string;
  velocityBps: number;
  volatilitySigmaFormatted: string;
  rawSwipes: number;
  nettedCheckpoints: number;
  nextCheckpointInSecs: number;
  kalshiCarryActive: boolean;
  kalshiPortalsPassed: number;
  boostersCollected: number;
  barriersDodged: number;
  sharpeScoreFormatted: string;
  fps: number;
}

function extractHudSnapshot(
  state: PulseRunnerRunState,
  fps: number,
): HudTelemetrySnapshot {
  return {
    isRunning: state.isRunning,
    remainingSecs: Math.ceil(state.remainingSecs),
    distanceMeters: Math.floor(state.distanceMeters),
    activeLane: state.activeLane,
    regimeTape: state.regimeTape,
    solPriceFormatted: formatPrice8Usd(state.solPrice8),
    nvdaPriceFormatted: formatPrice8Usd(state.nvdaPrice8),
    velocityBps: state.velocityBps,
    volatilitySigmaFormatted: `${(state.volatilitySigmaMilli / 1000).toFixed(2)}σ`,
    rawSwipes: state.rawSwipes,
    nettedCheckpoints: state.nettedCheckpoints,
    nextCheckpointInSecs: Math.max(1, Math.ceil(state.nextCheckpointInSecs)),
    kalshiCarryActive: state.kalshiCarryActive,
    kalshiPortalsPassed: state.kalshiPortalsPassed,
    boostersCollected: state.boostersCollected,
    barriersDodged: state.barriersDodged,
    sharpeScoreFormatted: state.sharpeScoreFormatted,
    fps,
  };
}

export function PulseRunnerConsole(): React.JSX.Element {
  const {
    earnedStocks,
    sessionKeyPubkey,
    creditEarnedVaultPrize,
    openCashier,
  } = useConsoleVault();

  const runRef = React.useRef<PulseRunnerRunState>(
    createInitialRunnerState("NORMAL_FLOW"),
  );
  const canvasWrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const canvasSizeRef = React.useRef<{ width: number; height: number; dpr: number }>({
    width: 840,
    height: 440,
    dpr: 1,
  });
  const pointerStartRef = React.useRef<{ x: number; width: number } | null>(null);
  const fpsRef = React.useRef<number>(60);
  const frameCountRef = React.useRef<number>(0);

  const [hud, setHud] = React.useState<HudTelemetrySnapshot>(() =>
    extractHudSnapshot(runRef.current, 60),
  );
  const [claimedRewardLabel, setClaimedRewardLabel] = React.useState<string | null>(
    null,
  );

  const syncHudImmediate = React.useCallback(() => {
    setHud(extractHudSnapshot(runRef.current, fpsRef.current));
  }, []);

  // High-DPI ResizeObserver (zero layout reads during React render)
  React.useEffect(() => {
    const wrap = canvasWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const updateCanvasResolution = (cssW: number): void => {
      const safeW = Math.max(280, Math.floor(cssW));
      const safeH = safeW < 520 ? 340 : 440;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(safeW * dpr);
      canvas.height = Math.floor(safeH * dpr);
      canvas.style.height = `${safeH}px`;
      canvasSizeRef.current = { width: safeW, height: safeH, dpr };
    };

    updateCanvasResolution(wrap.clientWidth || 840);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        updateCanvasResolution(entry.contentRect.width);
      }
    });
    observer.observe(wrap);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Keyboard ArrowLeft / ArrowRight / A / D / Space Controls
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
        event.preventDefault();
        stepRunnerLaneRelative(runRef.current, -1);
        syncHudImmediate();
      } else if (
        event.key === "ArrowRight" ||
        event.key === "d" ||
        event.key === "D"
      ) {
        event.preventDefault();
        stepRunnerLaneRelative(runRef.current, 1);
        syncHudImmediate();
      } else if (
        event.key === "ArrowUp" ||
        event.key === "w" ||
        event.key === "W" ||
        event.key === "s" ||
        event.key === "S"
      ) {
        event.preventDefault();
        switchRunnerLane(runRef.current, "LANE_CENTER");
        syncHudImmediate();
      } else if (event.key === " ") {
        event.preventDefault();
        runRef.current.isRunning = !runRef.current.isRunning;
        syncHudImmediate();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [syncHudImmediate]);

  // 60fps requestAnimationFrame Loop + window.__PULSE_RUNNER_STATE__ exposure
  React.useEffect(() => {
    let rafId = 0;
    let prevTime = performance.now();
    let fpsWindowStart = prevTime;
    let framesInWindow = 0;
    let lastHudSync = prevTime;

    const mediaReduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const tick = (now: number): void => {
      const dtSecs = Math.min(0.05, Math.max(0.001, (now - prevTime) / 1000));
      prevTime = now;

      frameCountRef.current += 1;
      framesInWindow += 1;
      if (now - fpsWindowStart >= 500) {
        fpsRef.current = Math.max(
          1,
          Math.round((framesInWindow * 1000) / (now - fpsWindowStart)),
        );
        framesInWindow = 0;
        fpsWindowStart = now;
      }

      const state = runRef.current;
      stepPulseRunnerWorld(state, dtSecs);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const { width, height, dpr } = canvasSizeRef.current;
          renderPulseRunnerFrame(
            ctx,
            width,
            height,
            dpr,
            state,
            fpsRef.current,
            mediaReduced.matches,
          );
        }
      }

      window.__PULSE_RUNNER_STATE__ = {
        isRunning: state.isRunning,
        fps: fpsRef.current,
        frameCount: frameCountRef.current,
        activeLane: state.activeLane,
        rawSwipes: state.rawSwipes,
        nettedCheckpoints: state.nettedCheckpoints,
        sharpeScoreFormatted: state.sharpeScoreFormatted,
        sharpeScoreScaled: state.sharpeScoreScaled.toString(),
        kalshiCarryActive: state.kalshiCarryActive,
        distanceMeters: Math.floor(state.distanceMeters),
        volatilitySigma: (state.volatilitySigmaMilli / 1000).toFixed(2),
        programId: PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId,
      };

      if (now - lastHudSync >= 100) {
        lastHudSync = now;
        setHud(extractHudSnapshot(state, fpsRef.current));
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      delete window.__PULSE_RUNNER_STATE__;
    };
  }, []);

  const handleSelectLane = (lane: RunnerLaneId): void => {
    switchRunnerLane(runRef.current, lane);
    syncHudImmediate();
  };

  const handleTogglePlay = (): void => {
    if (runRef.current.remainingSecs <= 0) {
      runRef.current = createInitialRunnerState(runRef.current.regimeTape);
      setClaimedRewardLabel(null);
    } else {
      runRef.current.isRunning = !runRef.current.isRunning;
    }
    syncHudImmediate();
  };

  const handleResetRun = (nextTape?: MarketRegimeTape): void => {
    const tape = nextTape ?? runRef.current.regimeTape;
    runRef.current = createInitialRunnerState(tape);
    setClaimedRewardLabel(null);
    syncHudImmediate();
  };

  const handleCanvasPointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ): void => {
    pointerStartRef.current = {
      x: event.nativeEvent.offsetX,
      width: canvasSizeRef.current.width,
    };
  };

  const handleCanvasPointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ): void => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;

    const dx = event.nativeEvent.offsetX - start.x;
    if (Math.abs(dx) >= 28) {
      stepRunnerLaneRelative(runRef.current, dx > 0 ? 1 : -1);
      syncHudImmediate();
      return;
    }

    // Tap zone: Left 1/3 -> LANE_LEFT, Middle 1/3 -> LANE_CENTER, Right 1/3 -> LANE_RIGHT
    const ratio = event.nativeEvent.offsetX / Math.max(1, start.width);
    if (ratio < 0.34) {
      handleSelectLane("LANE_LEFT");
    } else if (ratio > 0.66) {
      handleSelectLane("LANE_RIGHT");
    } else {
      handleSelectLane("LANE_CENTER");
    }
  };

  const handleSettleAndClaimSprint = (): void => {
    if (claimedRewardLabel !== null) return;
    runRef.current.nettedCheckpoints += 1;
    const rewardUsdcAtomic = 18n * USDC_UNIT; // $18.00 sprint podium pool share
    const res = creditEarnedVaultPrize(
      "NVDAx",
      rewardUsdcAtomic,
      runRef.current.nvdaPrice8,
    );
    setClaimedRewardLabel(res.creditedLabel);
    syncHudImmediate();
  };

  return (
    <div className="space-y-5">
      {/* 1. GENRE PROOF #002 COMMAND HEADER & SAME-CONTRACT ENGINE PROOF */}
      <GlassCard
        id="pulse-runner-header-card"
        variant="stage"
        accent="cyan"
        className="p-4 sm:p-5"
      >
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <GlassPill tone="cyan" size="xs">
                Cartridge #002 · 3-Lane Arcade Genre Proof
              </GlassPill>
              <span
                id="runner-program-id-proof"
                translate="no"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#00F59B]/35 bg-[#00F59B]/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#00F59B] tabular-nums"
              >
                <LivePulseDot tone="emerald" size="sm" />
                Same ER Contract: {PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId}
              </span>
            </div>

            <h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.035em] text-white sm:text-3xl">
              PULSE RUNNER — 3-Lane Volatility Sprint
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Proves casual 60fps reflex gameplay drives non-custodial directional &amp; Kalshi
              carry stances on the exact same parameterized Anchor program as Borel (#001)—with zero
              custom Rust contracts and zero swap churn.
            </p>
          </div>

          {/* Sprint Controls & Volatility Regime Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Pyth Volatility Regime"
              className="inline-flex rounded-xl border border-white/10 bg-[#050609] p-1"
            >
              <button
                id="runner-tape-normal"
                type="button"
                onClick={() => handleResetRun("NORMAL_FLOW")}
                className={`cursor-pointer rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                  hud.regimeTape === "NORMAL_FLOW"
                    ? "bg-[#00D4FF] text-[#050609]"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Live Flow
              </button>
              <button
                id="runner-tape-spike"
                type="button"
                onClick={() => handleResetRun("VOLATILITY_SPIKE")}
                className={`cursor-pointer rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                  hud.regimeTape === "VOLATILITY_SPIKE"
                    ? "bg-[#FFB020] text-[#050609]"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Sigma &gt; 2.5x Spike
              </button>
            </div>

            <ActionButton
              id="runner-toggle-play-btn"
              variant="emerald"
              size="md"
              onClick={handleTogglePlay}
            >
              {hud.remainingSecs <= 0
                ? "Start New Sprint"
                : hud.isRunning
                  ? "Pause Sprint"
                  : "Resume Sprint"}
            </ActionButton>

            <ActionButton
              id="runner-reset-btn"
              variant="ghost"
              size="md"
              onClick={() => handleResetRun()}
            >
              Reset
            </ActionButton>
          </div>
        </div>
      </GlassCard>

      {/* 2. MAIN 60FPS CANVAS STAGE (8 COLS) + ENGINE PROOF & STANCE NETTING HUD (4 COLS) */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <GlassCard
          id="pulse-runner-canvas-stage"
          variant="stage"
          accent="emerald"
          className="p-3 sm:p-4 lg:col-span-8"
        >
          {/* Top Stage Telemetry Bar */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#050609] px-3 py-2 font-mono text-xs tabular-nums">
            <div className="flex flex-wrap items-center gap-3">
              <span translate="no" className="text-slate-300">
                SOL-PERP <strong className="text-white">{hud.solPriceFormatted}</strong>
              </span>
              <span translate="no" className="text-slate-300">
                NVDAx <strong className="text-[#00F59B]">{hud.nvdaPriceFormatted}</strong>
              </span>
              <span className="text-slate-400">
                Vel{" "}
                <strong
                  className={hud.velocityBps >= 0 ? "text-[#00F59B]" : "text-[#FFB020]"}
                >
                  {hud.velocityBps >= 0 ? "+" : ""}
                  {hud.velocityBps} bps
                </strong>
              </span>
              <span className="text-[#00D4FF]">Vol {hud.volatilitySigmaFormatted}</span>
            </div>

            <div className="flex items-center gap-2">
              {hud.kalshiCarryActive ? (
                <span className="rounded-md border border-[#FFB020]/45 bg-[#FFB020]/15 px-2 py-0.5 text-[11px] font-bold text-[#FCD34D]">
                  KALSHI 1.5x CARRY
                </span>
              ) : null}
              <span
                id="runner-clock-pill"
                className="rounded-lg border border-white/12 bg-[#0A0D14] px-2.5 py-0.5 font-bold text-white"
              >
                {hud.remainingSecs}s
              </span>
            </div>
          </div>

          {/* High-DPI 60fps HTML5 Canvas2D Track */}
          <div
            ref={canvasWrapRef}
            className="w-full overflow-hidden rounded-2xl border border-white/12 bg-[#050609]"
          >
            <canvas
              id="pulse-runner-canvas"
              ref={canvasRef}
              onPointerDown={handleCanvasPointerDown}
              onPointerUp={handleCanvasPointerUp}
              aria-label="Pulse Runner 60fps 3-Lane Volatility Track — use Left/Right arrows, A/D keys, or lane buttons below"
              className="block w-full cursor-pointer touch-manipulation select-none"
            />
          </div>

          {/* Thumb-Zone Mobile & Desktop 3-Lane Stance Switcher Buttons */}
          <div
            role="group"
            aria-label="3-Lane Stance Controls"
            className="mt-3 grid grid-cols-3 gap-2 sm:gap-3"
          >
            <button
              id="runner-lane-left"
              type="button"
              onClick={() => handleSelectLane("LANE_LEFT")}
              className={`cursor-pointer rounded-2xl border p-3 text-left touch-manipulation transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                hud.activeLane === "LANE_LEFT"
                  ? "border-[#FFB020] bg-[#FFB020]/16 text-white shadow-[inset_0_1px_0_0_rgba(255,176,32,0.3)]"
                  : "border-white/10 bg-[#050609]/90 text-slate-300 hover:border-white/25"
              }`}
            >
              <div className="font-mono text-[10px] font-semibold uppercase text-[#FFB020]">
                Left · A / ←
              </div>
              <div className="mt-0.5 font-display text-xs font-bold text-white sm:text-sm">
                SHORT STANCE
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums sm:text-[11px]">
                -1.0x SOL-PERP
              </div>
            </button>

            <button
              id="runner-lane-center"
              type="button"
              onClick={() => handleSelectLane("LANE_CENTER")}
              className={`cursor-pointer rounded-2xl border p-3 text-center touch-manipulation transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                hud.activeLane === "LANE_CENTER"
                  ? "border-[#00D4FF] bg-[#00D4FF]/16 text-white shadow-[inset_0_1px_0_0_rgba(0,212,255,0.3)]"
                  : "border-white/10 bg-[#050609]/90 text-slate-300 hover:border-white/25"
              }`}
            >
              <div className="font-mono text-[10px] font-semibold uppercase text-[#00D4FF]">
                Center · W / Shield
              </div>
              <div className="mt-0.5 font-display text-xs font-bold text-white sm:text-sm">
                USDC SHIELD
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums sm:text-[11px]">
                0.0x · Liq Safe
              </div>
            </button>

            <button
              id="runner-lane-right"
              type="button"
              onClick={() => handleSelectLane("LANE_RIGHT")}
              className={`cursor-pointer rounded-2xl border p-3 text-right touch-manipulation transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                hud.activeLane === "LANE_RIGHT"
                  ? "border-[#00F59B] bg-[#00F59B]/16 text-white shadow-[inset_0_1px_0_0_rgba(0,245,155,0.3)]"
                  : "border-white/10 bg-[#050609]/90 text-slate-300 hover:border-white/25"
              }`}
            >
              <div className="font-mono text-[10px] font-semibold uppercase text-[#00F59B]">
                Right · D / →
              </div>
              <div className="mt-0.5 font-display text-xs font-bold text-white sm:text-sm">
                LONG STANCE
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums sm:text-[11px]">
                +1.0x SOL &amp; NVDAx
              </div>
            </button>
          </div>
        </GlassCard>

        {/* RIGHT COLUMN (4 COLS): Engine Proof HUD, Sharpe Score & Stance Netting Counter */}
        <GlassCard
          id="pulse-runner-hud-card"
          accent="emerald"
          className="space-y-4 p-4 sm:p-5 lg:col-span-4"
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <span className="font-mono text-xs font-semibold text-[#00F59B]">
              ENGINE TELEMETRY HUD
            </span>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {hud.fps} FPS · 10ms ER
            </span>
          </div>

          <div className="rounded-2xl border border-[#00F59B]/30 bg-[#050609]/95 p-4">
            <TabularMetric
              id="runner-sharpe-score-metric"
              label="Drawdown-Penalized Sharpe (S_sharpe · BigInt)"
              value={hud.sharpeScoreFormatted}
              sublabel={
                hud.kalshiCarryActive
                  ? "1.5x Kalshi Fed Cut Portal Carry Active"
                  : "Pass a Cyan Kalshi Gate for 1.5x Carry"
              }
              tone="emerald"
              size="lg"
            />
          </div>

          {/* Stance Netting Counter (Anti-Churn Proof) */}
          <div
            id="runner-stance-netting-box"
            className="rounded-2xl border border-[#00D4FF]/35 bg-[#050609]/95 p-4 font-mono tabular-nums"
          >
            <div className="flex items-center justify-between text-[11px] text-[#67E8F9]">
              <span className="font-semibold">STANCE NETTING ENGINE</span>
              <span>0 Swap Churn</span>
            </div>
            <div className="mt-2 text-sm font-bold text-white">
              Raw Swipes: <span className="text-[#00F59B]">{hud.rawSwipes}</span> -&gt; Netted
              Venue Checkpoints:{" "}
              <span className="text-[#00D4FF]">{hud.nettedCheckpoints}</span>
            </div>
            <p className="mt-1.5 font-sans text-xs leading-relaxed text-slate-400">
              Every lane shift updates your Stance Vector at 0 gas inside MagicBlock ER. Non-custodial
              Jupiter/Phoenix routing nets strictly at checkpoints (next in{" "}
              <span className="font-mono text-slate-200">{hud.nextCheckpointInSecs}s</span>).
            </p>
          </div>

          {/* Run Counters */}
          <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
            <div className="rounded-xl border border-white/[0.08] bg-[#050609] p-2.5">
              <div className="text-[10px] text-slate-400">Boosters</div>
              <div className="mt-0.5 text-sm font-bold text-[#00F59B]">
                {hud.boostersCollected}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#050609] p-2.5">
              <div className="text-[10px] text-slate-400">Liq Dodged</div>
              <div className="mt-0.5 text-sm font-bold text-[#00D4FF]">
                {hud.barriersDodged}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#050609] p-2.5">
              <div className="text-[10px] text-slate-400">Kalshi Gates</div>
              <div className="mt-0.5 text-sm font-bold text-[#FFB020]">
                {hud.kalshiPortalsPassed}
              </div>
            </div>
          </div>

          {/* Settle Sprint into Shared Earned Stock Vault */}
          <div className="space-y-2 border-t border-white/[0.08] pt-3">
            <ActionButton
              id="runner-settle-claim-btn"
              variant="emerald"
              size="md"
              disabled={claimedRewardLabel !== null}
              onClick={handleSettleAndClaimSprint}
              className="w-full"
            >
              {claimedRewardLabel !== null
                ? `Vault Credited: ${claimedRewardLabel}`
                : "Settle Sprint -> Claim NVDAx to Vault"}
            </ActionButton>

            <div className="flex items-center justify-between font-mono text-[11px] text-slate-400 tabular-nums">
              <span translate="no">
                Vault NVDAx: {formatShareUnits6(earnedStocks.NVDAx, 3)} sh
              </span>
              <button
                id="runner-open-vault-btn"
                type="button"
                onClick={openCashier}
                className="cursor-pointer text-[#00D4FF] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
              >
                Open Vault
              </button>
            </div>
          </div>

          {/* Shared Program Proof Footer */}
          <div className="rounded-xl border border-white/[0.07] bg-[#050609] p-3 font-mono text-[11px] text-slate-400 tabular-nums">
            <div>
              Session Signer:{" "}
              <span translate="no" className="text-slate-200">
                {sessionKeyPubkey.slice(0, 10)}… (0 Popups)
              </span>
            </div>
            <div className="mt-1">
              cartridge-er-room:{" "}
              <span translate="no" className="text-[#00F59B]">
                {PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId.slice(0, 12)}…
                {PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId.slice(-6)}
              </span>
            </div>
            <div className="mt-2">
              <ActionButton
                id="runner-fork-studio-link"
                href="/studio?template=pulse-runner-nvda-sol"
                variant="ghost"
                size="sm"
                className="w-full"
              >
                Fork Pulse Runner Manifest in Vibe Studio
              </ActionButton>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
