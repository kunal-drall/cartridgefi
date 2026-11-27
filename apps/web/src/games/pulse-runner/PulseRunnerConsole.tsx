"use client";

import * as React from "react";
import { ExternalLink, Pause, Play, Radio, RotateCcw } from "lucide-react";
import { USDC_UNIT } from "@cartridgefi/shared-types";
import { useConsoleVault } from "@/app/(console)/_components/ConsoleVaultContext";
import { formatPrice8Usd } from "@/games/borel/engine";
import type { LiveMarketsSnapshot } from "@/lib/live-markets";
import { cn, shortenAddress } from "@/lib/utils";
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
import { toast } from "sonner";

declare global {
  interface Window {
    __PULSE_RUNNER_STATE__?: PulseRunnerWindowDebugState;
  }
}

interface HudSnapshot {
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
  boostersCollected: number;
  barriersDodged: number;
  sharpeScoreFormatted: string;
  fps: number;
}

function extractHud(state: PulseRunnerRunState, fps: number): HudSnapshot {
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
    boostersCollected: state.boostersCollected,
    barriersDodged: state.barriersDodged,
    sharpeScoreFormatted: state.sharpeScoreFormatted,
    fps,
  };
}

export function PulseRunnerConsole(): React.JSX.Element {
  const { sessionKeyPubkey, creditEarnedVaultPrize } = useConsoleVault();

  const runRef = React.useRef<PulseRunnerRunState>(
    createInitialRunnerState("NORMAL_FLOW"),
  );
  // Live price overrides fed by real Coinbase WebSocket + Solana DexScreener
  const livePricesRef = React.useRef<{
    solPrice8: bigint | null;
    nvdaPrice8: bigint | null;
    lastSolUsd: number | null;
    velocityBps: number | null;
  }>({
    solPrice8: null,
    nvdaPrice8: null,
    lastSolUsd: null,
    velocityBps: null,
  });

  const canvasWrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const canvasSizeRef = React.useRef<{
    width: number;
    height: number;
    dpr: number;
  }>({
    width: 840,
    height: 420,
    dpr: 1,
  });
  const fpsRef = React.useRef<number>(60);
  const frameCountRef = React.useRef<number>(0);

  const [hud, setHud] = React.useState<HudSnapshot>(() =>
    extractHud(runRef.current, 60),
  );
  const [wsLive, setWsLive] = React.useState<boolean>(false);
  const [settledLabel, setSettledLabel] = React.useState<string | null>(null);

  const syncHud = React.useCallback(() => {
    setHud(extractHud(runRef.current, fpsRef.current));
  }, []);

  // Fetch real live NVDAx & SOL-USD prices + open Coinbase WebSocket
  React.useEffect(() => {
    let closed = false;
    const fetchInitial = async (): Promise<void> => {
      try {
        const res = await fetch("/api/markets");
        if (!res.ok || closed) return;
        const snap = (await res.json()) as LiveMarketsSnapshot;
        const sol = snap.markets.find((m) => m.symbol === "SOL-USD");
        const nvda = snap.markets.find((m) => m.symbol === "NVDAx");
        if (sol && sol.priceUsd > 0) {
          livePricesRef.current.solPrice8 = BigInt(
            Math.round(sol.priceUsd * 1e8),
          );
          livePricesRef.current.lastSolUsd = sol.priceUsd;
          runRef.current.solPrice8 = livePricesRef.current.solPrice8;
        }
        if (nvda && nvda.priceUsd > 0) {
          livePricesRef.current.nvdaPrice8 = BigInt(
            Math.round(nvda.priceUsd * 1e8),
          );
          runRef.current.nvdaPrice8 = livePricesRef.current.nvdaPrice8;
        }
      } catch {
        // Keep last valid quote
      }
    };
    void fetchInitial();
    const pollId = window.setInterval(() => {
      void fetchInitial();
    }, 10_000);

    let ws: WebSocket | null = null;
    if (typeof WebSocket !== "undefined") {
      try {
        ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
        ws.onopen = () => {
          if (closed || !ws) return;
          setWsLive(true);
          ws.send(
            JSON.stringify({
              type: "subscribe",
              product_ids: ["SOL-USD"],
              channels: ["ticker"],
            }),
          );
        };
        ws.onmessage = (evt) => {
          if (closed) return;
          try {
            const msg = JSON.parse(String(evt.data)) as {
              type?: string;
              price?: string;
            };
            if (msg.type === "ticker" && msg.price) {
              const p = Number(msg.price);
              if (Number.isFinite(p) && p > 0) {
                const prev = livePricesRef.current.lastSolUsd ?? p;
                const vel = Math.round(((p - prev) / prev) * 100_000);
                livePricesRef.current.lastSolUsd = p;
                livePricesRef.current.solPrice8 = BigInt(Math.round(p * 1e8));
                livePricesRef.current.velocityBps = vel;
              }
            }
          } catch {
            // Ignore malformed frame
          }
        };
        ws.onclose = () => {
          if (!closed) setWsLive(false);
        };
        ws.onerror = () => {
          if (!closed) setWsLive(false);
        };
      } catch {
        setWsLive(false);
      }
    }

    return () => {
      closed = true;
      window.clearInterval(pollId);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close();
        } catch {
          // Ignore close error
        }
      }
    };
  }, []);

  // ResizeObserver for canvas
  React.useEffect(() => {
    const wrap = canvasWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const updateSize = (cssW: number): void => {
      const safeW = Math.max(280, Math.floor(cssW));
      const safeH = safeW < 520 ? 320 : 410;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(safeW * dpr);
      canvas.height = Math.floor(safeH * dpr);
      canvas.style.height = `${safeH}px`;
      canvasSizeRef.current = { width: safeW, height: safeH, dpr };
    };

    updateSize(wrap.clientWidth || 840);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) updateSize(rect.width);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Keyboard controls
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
        event.preventDefault();
        stepRunnerLaneRelative(runRef.current, -1);
        syncHud();
      } else if (
        event.key === "ArrowRight" ||
        event.key === "d" ||
        event.key === "D"
      ) {
        event.preventDefault();
        stepRunnerLaneRelative(runRef.current, 1);
        syncHud();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [syncHud]);

  // 60fps requestAnimationFrame loop separated from React 10Hz HUD updates
  React.useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();
    let lastHudSync = lastTs;
    let framesSinceFps = 0;
    let lastFpsSample = lastTs;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const loop = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      framesSinceFps += 1;

      if (now - lastFpsSample >= 500) {
        fpsRef.current = Math.max(
          24,
          Math.min(120, Math.round((framesSinceFps * 1000) / (now - lastFpsSample))),
        );
        framesSinceFps = 0;
        lastFpsSample = now;
      }

      frameCountRef.current += 1;
      stepPulseRunnerWorld(runRef.current, dt);

      // Inject real live prices into run state after deterministic world step
      if (livePricesRef.current.solPrice8 !== null) {
        runRef.current.solPrice8 = livePricesRef.current.solPrice8;
      }
      if (livePricesRef.current.nvdaPrice8 !== null) {
        runRef.current.nvdaPrice8 = livePricesRef.current.nvdaPrice8;
      }
      if (livePricesRef.current.velocityBps !== null) {
        runRef.current.velocityBps = livePricesRef.current.velocityBps;
      }

      // Expose deterministic debug state for verification
      window.__PULSE_RUNNER_STATE__ = {
        isRunning: runRef.current.isRunning,
        fps: fpsRef.current,
        frameCount: frameCountRef.current,
        activeLane: runRef.current.activeLane,
        rawSwipes: runRef.current.rawSwipes,
        nettedCheckpoints: runRef.current.nettedCheckpoints,
        sharpeScoreFormatted: runRef.current.sharpeScoreFormatted,
        sharpeScoreScaled: runRef.current.sharpeScoreScaled.toString(),
        kalshiCarryActive: runRef.current.kalshiCarryActive,
        distanceMeters: Math.floor(runRef.current.distanceMeters),
        volatilitySigma: `${(runRef.current.volatilitySigmaMilli / 1000).toFixed(2)}`,
        programId: PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId,
      };

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        const { width, height, dpr } = canvasSizeRef.current;
        renderPulseRunnerFrame(
          ctx,
          width,
          height,
          dpr,
          runRef.current,
          fpsRef.current,
          reducedMotion,
        );
      }

      if (now - lastHudSync >= 100) {
        lastHudSync = now;
        setHud(extractHud(runRef.current, fpsRef.current));
      }

      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const handleSelectLane = (lane: RunnerLaneId): void => {
    switchRunnerLane(runRef.current, lane);
    window.__PULSE_RUNNER_STATE__ = {
      isRunning: runRef.current.isRunning,
      fps: fpsRef.current,
      frameCount: frameCountRef.current,
      activeLane: runRef.current.activeLane,
      rawSwipes: runRef.current.rawSwipes,
      nettedCheckpoints: runRef.current.nettedCheckpoints,
      sharpeScoreFormatted: runRef.current.sharpeScoreFormatted,
      sharpeScoreScaled: runRef.current.sharpeScoreScaled.toString(),
      kalshiCarryActive: runRef.current.kalshiCarryActive,
      distanceMeters: Math.floor(runRef.current.distanceMeters),
      volatilitySigma: `${(runRef.current.volatilitySigmaMilli / 1000).toFixed(2)}`,
      programId: PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId,
    };
    syncHud();
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#22262e] bg-[#111317] p-4 xl:flex-row xl:items-center">
        <div className="max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold text-[#f3f4f6] sm:text-lg">
              Pulse Runner: Continuous Stance Netting (#002)
            </h1>
            {wsLive ? (
              <span className="inline-flex items-center gap-1 rounded border border-[#10b981]/30 bg-[#10b981]/10 px-2 py-0.5 font-mono text-[11px] text-[#34d399]">
                <Radio className="h-3 w-3" />
                SOL-USD WS Live
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[#9ca3af]">
            Demonstrates continuous 3-lane stance inputs netted every 30s against the shared{" "}
            <code
              id="runner-program-id-proof"
              className="font-mono text-[#e5e7eb]"
            >
              {PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId}
            </code>{" "}
            Solana Devnet program.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(["NORMAL_FLOW", "VOLATILITY_SPIKE"] as const).map((regime) => (
            <button
              key={regime}
              type="button"
              onClick={() => {
                runRef.current = createInitialRunnerState(regime);
                if (livePricesRef.current.solPrice8) {
                  runRef.current.solPrice8 = livePricesRef.current.solPrice8;
                }
                if (livePricesRef.current.nvdaPrice8) {
                  runRef.current.nvdaPrice8 = livePricesRef.current.nvdaPrice8;
                }
                setSettledLabel(null);
                syncHud();
              }}
              className={cn(
                "cf-btn cursor-pointer rounded-md border px-2.5 py-1.5 text-xs font-medium",
                hud.regimeTape === regime
                  ? "border-[#3b82f6] bg-[#2563eb]/20 text-white"
                  : "border-[#303642] bg-[#171a20] text-[#9ca3af] hover:text-white",
              )}
            >
              {regime === "NORMAL_FLOW" ? "Standard Volatility" : "High-Sigma Stress"}
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              runRef.current.isRunning = !runRef.current.isRunning;
              syncHud();
            }}
            className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-2.5 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
          >
            {hud.isRunning ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Resume
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              runRef.current = createInitialRunnerState(hud.regimeTape);
              setSettledLabel(null);
              syncHud();
            }}
            className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-2.5 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left 8 Cols: 60fps Canvas + Tactile 3-Lane Stance Switcher */}
        <div className="space-y-3 lg:col-span-8">
          <div
            ref={canvasWrapRef}
            className="overflow-hidden rounded-lg border border-[#22262e] bg-[#111317]"
          >
            <canvas ref={canvasRef} className="block w-full" />
          </div>

          {/* 3-Lane Stance Controls */}
          <div className="grid grid-cols-3 gap-2">
            <button
              id="runner-lane-left"
              type="button"
              onClick={() => handleSelectLane("LANE_LEFT")}
              className={cn(
                "cf-btn cursor-pointer rounded-md border p-3 text-left",
                hud.activeLane === "LANE_LEFT"
                  ? "border-[#ef4444] bg-[#ef4444]/15 text-white"
                  : "border-[#22262e] bg-[#111317] text-[#d1d5db] hover:border-[#303642]",
              )}
            >
              <div className="font-mono text-xs font-semibold text-[#f87171]">
                SHORT (-1.0x)
              </div>
              <div className="mt-0.5 text-[11px] text-[#9ca3af]">
                SOL-USD Inverse Delta
              </div>
            </button>

            <button
              id="runner-lane-center"
              type="button"
              onClick={() => handleSelectLane("LANE_CENTER")}
              className={cn(
                "cf-btn cursor-pointer rounded-md border p-3 text-left",
                hud.activeLane === "LANE_CENTER"
                  ? "border-[#3b82f6] bg-[#2563eb]/15 text-white"
                  : "border-[#22262e] bg-[#111317] text-[#d1d5db] hover:border-[#303642]",
              )}
            >
              <div className="font-mono text-xs font-semibold text-[#93c5fd]">
                NEUTRAL (0.0x)
              </div>
              <div className="mt-0.5 text-[11px] text-[#9ca3af]">
                USDC Drawdown Shield
              </div>
            </button>

            <button
              id="runner-lane-right"
              type="button"
              onClick={() => handleSelectLane("LANE_RIGHT")}
              className={cn(
                "cf-btn cursor-pointer rounded-md border p-3 text-left",
                hud.activeLane === "LANE_RIGHT"
                  ? "border-[#10b981] bg-[#10b981]/15 text-white"
                  : "border-[#22262e] bg-[#111317] text-[#d1d5db] hover:border-[#303642]",
              )}
            >
              <div className="font-mono text-xs font-semibold text-[#34d399]">
                LONG (+1.0x)
              </div>
              <div className="mt-0.5 text-[11px] text-[#9ca3af]">
                NVDAx + SOL-USD Long
              </div>
            </button>
          </div>
        </div>

        {/* Right 4 Cols: Live Feed Telemetry & Stance Netting Inspector */}
        <div className="space-y-4 lg:col-span-4">
          <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
            <h2 className="border-b border-[#22262e] pb-2.5 text-xs font-semibold text-[#f3f4f6]">
              Live Market Feed &amp; Netting State
            </h2>

            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs tabular-nums">
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  SOL-USD (Live)
                </div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  {hud.solPriceFormatted}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  NVDAx (Solana DEX)
                </div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  {hud.nvdaPriceFormatted}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Raw Stance Shifts
                </div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  {hud.rawSwipes} (0 Popups)
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  30s Netted Batches
                </div>
                <div className="mt-0.5 font-semibold text-[#34d399]">
                  {hud.nettedCheckpoints} (next {hud.nextCheckpointInSecs}s)
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Risk-Adjusted Sharpe
                </div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  {hud.sharpeScoreFormatted}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Remaining Window
                </div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  {hud.remainingSecs}s
                </div>
              </div>
            </div>

            <div className="mt-3 rounded border border-[#22262e] bg-[#0b0c0e] p-3 text-xs text-[#9ca3af]">
              <div className="flex items-center justify-between">
                <span>Session Signer</span>
                <span className="font-mono text-[#d1d5db]">
                  {sessionKeyPubkey ? shortenAddress(sessionKeyPubkey, 6, 4) : "Generating…"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between border-t border-[#22262e] pt-1.5">
                <span>Shared ER Program</span>
                <a
                  href={`https://solscan.io/account/${PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[#93c5fd] hover:underline"
                >
                  {shortenAddress(PULSE_RUNNER_ENGINE_PROOF.erRoomProgramId, 6, 4)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const res = creditEarnedVaultPrize(
                  "NVDAx",
                  12n * USDC_UNIT,
                  runRef.current.nvdaPrice8,
                );
                setSettledLabel(res.creditedLabel);
                toast.success(`Settled ${res.creditedLabel} from runner session`);
              }}
              className="cf-btn mt-3 h-9 w-full cursor-pointer rounded-md bg-[#2563eb] px-3 text-xs font-medium text-white hover:bg-[#1d4ed8]"
            >
              Settle Session Reward (NVDAx)
            </button>

            {settledLabel ? (
              <div className="mt-2 rounded border border-[#10b981]/30 bg-[#10b981]/10 px-3 py-2 font-mono text-xs text-[#34d399]">
                Credited {settledLabel}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
