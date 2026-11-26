"use client";

import * as React from "react";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  SOLANA_CANONICAL_MINTS,
  SUPPORTED_DEPOSIT_CHAINS,
  compilePromptToManifest,
  computeDirectionNeutralRelativeReturn,
  formatScaledBigInt,
  type SupportedDepositChain,
} from "@cartridgefi/shared-types";
import {
  ActionButton,
  GlassCard,
  GlassPill,
  LivePulseDot,
  ShowdownFlipCard,
  type ConvictionAllocationLeg,
} from "@cartridgefi/ui-system";

type StageTabId = "borel" | "pulse-runner" | "vice-bourse" | "prompt-custom";
type RunnerLane = "LANE_LEFT" | "LANE_CENTER" | "LANE_RIGHT";
type BorelThesisPresetId = "nvda-divergence" | "dovish-breakout" | "defensive-spread";

interface BorelThesisPreset {
  id: BorelThesisPresetId;
  label: string;
  summary: string;
  nvdaWeightScaled: bigint;
  solWeightScaled: bigint;
  kalshiCall: "YES · 1.35x" | "NO · 1.00x";
}

const BOREL_PRESETS: readonly BorelThesisPreset[] = [
  {
    id: "nvda-divergence",
    label: "+60% NVDAx / -40% SOL",
    summary: "Long AI earnings beat vs short perp beta + YES Fed Cut",
    nvdaWeightScaled: 600_000_000n,
    solWeightScaled: -400_000_000n,
    kalshiCall: "YES · 1.35x",
  },
  {
    id: "dovish-breakout",
    label: "+55% SOL / +45% NVDAx",
    summary: "Full risk-on liquidity impulse + YES Fed Cut",
    nvdaWeightScaled: 450_000_000n,
    solWeightScaled: 550_000_000n,
    kalshiCall: "YES · 1.35x",
  },
  {
    id: "defensive-spread",
    label: "-50% NVDAx / +50% SOL",
    summary: "Mean-reversion rotation spread + NO Fed Cut",
    nvdaWeightScaled: -500_000_000n,
    solWeightScaled: 500_000_000n,
    kalshiCall: "NO · 1.00x",
  },
];

const RIVAL_CIPHER_ALLOCATIONS: readonly ConvictionAllocationLeg[] = [
  { symbol: "NVDAx", label: "+55% LONG", barWidthPct: 72, tone: "emerald" },
  { symbol: "SOL-PERP", label: "-35% SHORT", barWidthPct: 48, tone: "amber" },
  { symbol: "FED-CUT", label: "YES 1.35x", barWidthPct: 86, tone: "cyan" },
];

const RIVAL_MACRO_ALLOCATIONS: readonly ConvictionAllocationLeg[] = [
  { symbol: "SOL-PERP", label: "+70% LONG", barWidthPct: 82, tone: "emerald" },
  { symbol: "SPYx", label: "-30% SHORT", barWidthPct: 40, tone: "amber" },
  { symbol: "FED-CUT", label: "NO 1.00x", barWidthPct: 34, tone: "cyan" },
];

// Deterministic 12-step integer price offsets (in 10^8 Pyth scale) — zero Math.random()
const DETERMINISTIC_SOL_PRICES_8: readonly bigint[] = [
  19_428_000_000n,
  19_414_000_000n,
  19_398_000_000n,
  19_405_000_000n,
  19_382_000_000n,
  19_369_000_000n,
  19_391_000_000n,
  19_419_000_000n,
  19_442_000_000n,
  19_436_000_000n,
  19_411_000_000n,
  19_395_000_000n,
];

const DETERMINISTIC_NVDA_PRICES_8: readonly bigint[] = [
  14_682_000_000n,
  14_704_000_000n,
  14_731_000_000n,
  14_748_000_000n,
  14_775_000_000n,
  14_792_000_000n,
  14_784_000_000n,
  14_809_000_000n,
  14_826_000_000n,
  14_818_000_000n,
  14_841_000_000n,
  14_855_000_000n,
];

const CHAIN_DISPLAY_META: Record<
  SupportedDepositChain,
  { label: string; routeSeconds: string; sourceAsset: string }
> = {
  solana: { label: "Solana", routeSeconds: "0.4s", sourceAsset: "Native USDC / SOL" },
  base: { label: "Base", routeSeconds: "1.6s", sourceAsset: "Base USDC -> Solana USDC" },
  ethereum: { label: "Ethereum", routeSeconds: "2.4s", sourceAsset: "Mainnet USDC -> Solana USDC" },
  arbitrum: { label: "Arbitrum", routeSeconds: "1.8s", sourceAsset: "Arb USDC -> Solana USDC" },
  bnb: { label: "BNB", routeSeconds: "2.1s", sourceAsset: "BNB USDT -> Solana USDC" },
  monad: { label: "Monad", routeSeconds: "1.4s", sourceAsset: "Monad USDC -> Solana USDC" },
  polygon: { label: "Polygon", routeSeconds: "1.9s", sourceAsset: "Polygon USDC -> Solana USDC" },
};

const VICE_DISTRICTS = [
  {
    id: "silicon-coast",
    name: "Silicon Coast",
    symbol: "NVDAx",
    controllingSyndicate: "@nvda_cartel",
    turfCapturePct: 78,
    vaultPoolUsdc: "480.00",
    heistWindow: "04:12 remaining",
  },
  {
    id: "anthropic-tower",
    name: "Anthropic Tower",
    symbol: "ANTx",
    controllingSyndicate: "@frontier_dao",
    turfCapturePct: 64,
    vaultPoolUsdc: "395.00",
    heistWindow: "06:45 remaining",
  },
  {
    id: "fed-plaza",
    name: "Fed Macro Plaza",
    symbol: "KALSHI-FED-CUT",
    controllingSyndicate: "@fomc_desk",
    turfCapturePct: 91,
    vaultPoolUsdc: "500.00",
    heistWindow: "Unsealing T-30s",
  },
] as const;

function formatPythPrice8(price8: bigint): string {
  const whole = price8 / 100_000_000n;
  const cents = ((price8 % 100_000_000n) / 1_000_000n).toString().padStart(2, "0");
  return `${whole.toString()}.${cents}`;
}

export function HeroConsoleStage(): React.JSX.Element {
  const [activeTab, setActiveTab] = React.useState<StageTabId>("borel");
  const [remainingSecs, setRemainingSecs] = React.useState<number>(38);
  const [manualUnsealOverride, setManualUnsealOverride] = React.useState<boolean | null>(null);
  const [tickStep, setTickStep] = React.useState<number>(0);
  const [borelPresetId, setBorelPresetId] = React.useState<BorelThesisPresetId>("nvda-divergence");
  const [activeLane, setActiveLane] = React.useState<RunnerLane>("LANE_RIGHT");
  const [activeDistrictId, setActiveDistrictId] = React.useState<string>("silicon-coast");
  const [selectedChain, setSelectedChain] = React.useState<SupportedDepositChain>("base");

  // Deterministic 1s tick loop mounted strictly on client to prevent SSR hydration mismatch
  React.useEffect(() => {
    const interval = setInterval(() => {
      setRemainingSecs((prev) => (prev <= 1 ? 60 : prev - 1));
      setTickStep((prev) => (prev + 1) % DETERMINISTIC_SOL_PRICES_8.length);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isShowdownUnsealed =
    manualUnsealOverride !== null ? manualUnsealOverride : remainingSecs <= 15;

  const solPrice8 = DETERMINISTIC_SOL_PRICES_8[tickStep] ?? 19_428_000_000n;
  const nvdaPrice8 = DETERMINISTIC_NVDA_PRICES_8[tickStep] ?? 14_682_000_000n;
  const entrySol8 = DETERMINISTIC_SOL_PRICES_8[0] ?? 19_428_000_000n;
  const entryNvda8 = DETERMINISTIC_NVDA_PRICES_8[0] ?? 14_682_000_000n;

  const activePreset =
    BOREL_PRESETS.find((p) => p.id === borelPresetId) ?? BOREL_PRESETS[0]!;

  const playerScoreScaled = computeDirectionNeutralRelativeReturn(
    [
      {
        weightScaled: activePreset.nvdaWeightScaled,
        entryPrice: entryNvda8,
        exitPrice: nvdaPrice8,
      },
      {
        weightScaled: activePreset.solWeightScaled,
        entryPrice: entrySol8,
        exitPrice: solPrice8,
      },
    ],
    500_000_000n,
  );
  const playerBpsScaled = playerScoreScaled * 10_000n;
  const playerBpsSign = playerBpsScaled >= 0n ? "+" : "";
  const playerBpsFormatted = `${playerBpsSign}${formatScaledBigInt(playerBpsScaled, 1)} bps`;

  const previewPromptCompile = React.useMemo(
    () =>
      compilePromptToManifest({
        prompt:
          "Cyberpunk 3-lane TSLAx and BTC sprint with Kalshi Fed Cut 1.5x portal boost",
        genre: "ARCADE_RUNNER",
        creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
        creatorHandle: "@studio-dev",
      }),
    [],
  );

  const selectedDistrict =
    VICE_DISTRICTS.find((d) => d.id === activeDistrictId) ?? VICE_DISTRICTS[0];
  const chainInfo = CHAIN_DISPLAY_META[selectedChain];

  return (
    <div className="mt-10 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
      {/* LEFT / PRIMARY CONSOLE DECK (8 cols on desktop) */}
      <GlassCard
        id="hero-console-deck"
        variant="stage"
        accent="emerald"
        className="flex flex-col justify-between p-4 sm:p-6 lg:col-span-8"
      >
        <div>
          {/* Cartridge Switcher Tabs */}
          <div
            role="tablist"
            aria-label="Live Engine Cartridge Switcher"
            className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.08] pb-4"
          >
            <button
              id="hero-tab-borel"
              role="tab"
              type="button"
              aria-selected={activeTab === "borel"}
              onClick={() => setActiveTab("borel")}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                activeTab === "borel"
                  ? "border-[#00F59B]/45 bg-[#00F59B]/12 text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              <LivePulseDot tone="emerald" size="sm" />
              <span>Game #001: BOREL (Game-Day Arena)</span>
            </button>

            <button
              id="hero-tab-pulse-runner"
              role="tab"
              type="button"
              aria-selected={activeTab === "pulse-runner"}
              onClick={() => setActiveTab("pulse-runner")}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                activeTab === "pulse-runner"
                  ? "border-[#00D4FF]/45 bg-[#00D4FF]/12 text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M2.5 11.5L5 2.5M7 11.5V2.5M11.5 11.5L9 2.5"
                  stroke="#00D4FF"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span>Game #002: Pulse Runner</span>
            </button>

            <button
              id="hero-tab-vice-bourse"
              role="tab"
              type="button"
              aria-selected={activeTab === "vice-bourse"}
              onClick={() => setActiveTab("vice-bourse")}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                activeTab === "vice-bourse"
                  ? "border-[#FFB020]/45 bg-[#FFB020]/12 text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M7 1.75L12 4.6V9.4L7 12.25L2 9.4V4.6L7 1.75Z"
                  stroke="#FFB020"
                  strokeWidth="1.4"
                />
              </svg>
              <span>Game #003: Vice Bourse</span>
            </button>

            <button
              id="hero-tab-prompt-custom"
              role="tab"
              type="button"
              aria-selected={activeTab === "prompt-custom"}
              onClick={() => setActiveTab("prompt-custom")}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                activeTab === "prompt-custom"
                  ? "border-[#8B5CF6]/45 bg-[#8B5CF6]/15 text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M3 4.5L6 7L3 9.5M7.5 9.5H11"
                  stroke="#C4B5FD"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Prompt Your Own</span>
            </button>
          </div>

          {/* Unified Engine Telemetry & Clock Strip */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#050609]/90 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
              <span translate="no" className="text-slate-300">
                NVDAx <span className="font-semibold text-[#00F59B]">${formatPythPrice8(nvdaPrice8)}</span>
              </span>
              <span className="text-slate-700" aria-hidden="true">
                |
              </span>
              <span translate="no" className="text-slate-300">
                SOL-PERP <span className="font-semibold text-slate-100">${formatPythPrice8(solPrice8)}</span>
              </span>
              <span className="text-slate-700" aria-hidden="true">
                |
              </span>
              <span translate="no" className="text-slate-300">
                KALSHI FED <span className="font-semibold text-[#00D4FF]">68¢ YES</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                id="hero-stage-clock"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${
                  isShowdownUnsealed
                    ? "border-[#FFB020]/45 bg-[#FFB020]/15 text-[#FCD34D]"
                    : "border-[#8B5CF6]/40 bg-[#8B5CF6]/15 text-[#C4B5FD]"
                }`}
              >
                {isShowdownUnsealed
                  ? `T - ${Math.min(15, remainingSecs).toString().padStart(2, "0")}s · SHOWDOWN`
                  : `T - ${remainingSecs.toString().padStart(2, "0")}s · TEE FOG`}
              </span>

              <button
                id="hero-unseal-showdown-btn"
                type="button"
                onClick={() =>
                  setManualUnsealOverride((prev) =>
                    prev === null ? !isShowdownUnsealed : !prev,
                  )
                }
                className="cursor-pointer rounded-lg border border-[#FFB020]/40 bg-[#FFB020]/12 px-2.5 py-1 font-mono text-[11px] font-semibold text-[#FCD34D] transition-colors hover:bg-[#FFB020]/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020]"
              >
                {isShowdownUnsealed ? "Re-seal 45s Fog" : "Unseal 15s Showdown Now"}
              </button>
            </div>
          </div>

          {/* ACTIVE TAB VIEWPORT */}
          {activeTab === "borel" ? (
            <div id="hero-panel-borel" role="tabpanel" className="mt-4 space-y-4">
              {/* Player's Own Live Conviction Pod */}
              <div className="rounded-2xl border border-[#00F59B]/25 bg-[#0C121B]/90 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <GlassPill tone="emerald" size="xs">
                      YOU · SESSION KEY ACTIVE
                    </GlassPill>
                    <span className="font-mono text-xs text-slate-400">
                      0 Wallet Popups · Direction-Neutral Skill (S_rel)
                    </span>
                  </div>
                  <span
                    id="hero-player-live-score"
                    className="font-mono text-sm font-bold text-[#00F59B] tabular-nums"
                  >
                    Rank #1 · {playerBpsFormatted}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {BOREL_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      id={`hero-preset-${preset.id}`}
                      type="button"
                      onClick={() => setBorelPresetId(preset.id)}
                      className={`cursor-pointer rounded-xl border px-3 py-1.5 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                        borelPresetId === preset.id
                          ? "border-[#00F59B]/50 bg-[#00F59B]/15 text-[#00F59B] font-semibold"
                          : "border-white/10 bg-[#050609]/80 text-slate-300 hover:border-white/25"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <span className="ml-auto font-mono text-[11px] text-[#00D4FF] tabular-nums">
                    Kalshi Gate: {activePreset.kalshiCall}
                  </span>
                </div>
              </div>

              {/* 2 Rival Pods with 380ms 3D Spring Flip */}
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                <ShowdownFlipCard
                  id="hero-rival-card-1"
                  playerHandle="@cipher_quant"
                  rank={2}
                  publicDeltaBpsFormatted="+14.2 bps"
                  cipherDigest="0x8f3a…c91e"
                  unsealed={isShowdownUnsealed}
                  finalScoreFormatted="+14.2 bps"
                  allocations={RIVAL_CIPHER_ALLOCATIONS}
                  onToggleUnseal={() =>
                    setManualUnsealOverride(!isShowdownUnsealed)
                  }
                />
                <ShowdownFlipCard
                  id="hero-rival-card-2"
                  playerHandle="@sol_macro"
                  rank={3}
                  publicDeltaBpsFormatted="-6.8 bps"
                  cipherDigest="0x41b0…77d2"
                  unsealed={isShowdownUnsealed}
                  finalScoreFormatted="-6.8 bps"
                  allocations={RIVAL_MACRO_ALLOCATIONS}
                  onToggleUnseal={() =>
                    setManualUnsealOverride(!isShowdownUnsealed)
                  }
                />
              </div>
            </div>
          ) : null}

          {activeTab === "pulse-runner" ? (
            <div id="hero-panel-pulse-runner" role="tabpanel" className="mt-4 space-y-4">
              <div className="rounded-2xl border border-[#00D4FF]/30 bg-[#080D16] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-display text-base font-bold text-white">
                      Pulse Runner: 3-Lane Volatility Reflex Track
                    </span>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Same <code className="font-mono text-slate-200">cartridge-er-room</code>{" "}
                      contract (<code className="font-mono text-slate-200">{CARTRIDGE_PROGRAM_IDS.erRoom.slice(0, 8)}…</code>), bound to{" "}
                      <code className="font-mono text-slate-200">CONTINUOUS_STANCE_VECTOR</code> lane physics.
                    </p>
                  </div>
                  <GlassPill tone="cyan" size="xs">
                    PHASER 3 · 60 FPS
                  </GlassPill>
                </div>

                {/* Interactive 3-Lane Perspective Track */}
                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  {(
                    [
                      {
                        lane: "LANE_LEFT",
                        btnId: "hero-lane-left",
                        title: "Left Lane · SHORT",
                        weight: "-10,000 bps (-1.0x)",
                        accent: "amber",
                      },
                      {
                        lane: "LANE_CENTER",
                        btnId: "hero-lane-center",
                        title: "Center · USDC SHIELD",
                        weight: "0 bps (Drawdown Safe)",
                        accent: "cyan",
                      },
                      {
                        lane: "LANE_RIGHT",
                        btnId: "hero-lane-right",
                        title: "Right Lane · LONG",
                        weight: "+10,000 bps (+1.0x)",
                        accent: "emerald",
                      },
                    ] as const
                  ).map((item) => {
                    const selected = activeLane === item.lane;
                    return (
                      <button
                        key={item.lane}
                        id={item.btnId}
                        type="button"
                        onClick={() => setActiveLane(item.lane)}
                        className={`flex cursor-pointer flex-col items-center justify-between rounded-xl border p-3.5 text-center transition-[border-color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                          selected
                            ? "border-[#00F59B] bg-[#00F59B]/12 -translate-y-0.5"
                            : "border-white/10 bg-[#050609]/85 hover:border-white/25"
                        }`}
                      >
                        <span className="font-mono text-[10px] uppercase text-slate-400">
                          {selected ? "RUNNER LOCKED" : "CLICK TO SHIFT"}
                        </span>
                        <div className="my-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/12 bg-[#0B101B]">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M12 4L19 19L12 15.5L5 19L12 4Z"
                              fill={selected ? "#00F59B" : "#475569"}
                            />
                          </svg>
                        </div>
                        <span className="font-display text-xs font-bold text-slate-100">
                          {item.title}
                        </span>
                        <span className="mt-1 font-mono text-[11px] text-[#00D4FF] tabular-nums">
                          {item.weight}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#050609] px-3.5 py-2.5">
                  <span className="font-mono text-xs text-slate-300 tabular-nums">
                    Active Stance: <strong className="text-[#00F59B]">{activeLane}</strong> · Kalshi Portal Carry: <strong className="text-[#00D4FF]">1.50x</strong>
                  </span>
                  <ActionButton
                    id="hero-launch-pulse-runner"
                    href="/play/pulse-runner"
                    variant="emerald"
                    size="sm"
                  >
                    Play Pulse Runner (#002)
                  </ActionButton>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "vice-bourse" ? (
            <div id="hero-panel-vice-bourse" role="tabpanel" className="mt-4 space-y-4">
              <div className="rounded-2xl border border-[#FFB020]/30 bg-[#0B0E17] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-display text-base font-bold text-white">
                      Vice Bourse: Open-World Sector Turf Wars
                    </span>
                    <p className="mt-0.5 text-xs text-slate-400">
                      10-minute Private ER TEE Vault Heists backed by{" "}
                      <code className="font-mono text-slate-200">NVDAx</code>,{" "}
                      <code className="font-mono text-slate-200">ANTx</code>, and{" "}
                      <code className="font-mono text-slate-200">KALSHI-FED-CUT</code>.
                    </p>
                  </div>
                  <GlassPill tone="amber" size="xs">
                    THREE.JS · SECTOR_TURF_CAPTURE
                  </GlassPill>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {VICE_DISTRICTS.map((district) => {
                    const isSelected = district.id === selectedDistrict.id;
                    return (
                      <button
                        key={district.id}
                        id={`hero-district-${district.id}`}
                        type="button"
                        onClick={() => setActiveDistrictId(district.id)}
                        className={`cursor-pointer rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                          isSelected
                            ? "border-[#FFB020]/55 bg-[#FFB020]/12"
                            : "border-white/10 bg-[#050609]/85 hover:border-white/22"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span translate="no" className="font-mono text-[11px] font-semibold text-[#FFB020]">
                            {district.symbol}
                          </span>
                          <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                            {district.turfCapturePct}% Turf
                          </span>
                        </div>
                        <div className="mt-1.5 font-display text-sm font-bold text-white">
                          {district.name}
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            style={{ width: `${district.turfCapturePct}%` }}
                            className="h-full rounded-full bg-[#FFB020]"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-400 tabular-nums">
                          <span translate="no">{district.controllingSyndicate}</span>
                          <span>${district.vaultPoolUsdc}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#050609] px-3.5 py-2.5">
                  <span className="font-mono text-xs text-slate-300 tabular-nums">
                    Selected District: <strong className="text-[#FFB020]">{selectedDistrict.name}</strong> · Vault Pool: <strong className="text-white">${selectedDistrict.vaultPoolUsdc} USDC</strong> ({selectedDistrict.heistWindow})
                  </span>
                  <ActionButton
                    id="hero-fork-vice-bourse"
                    href="/studio?fork=vice-bourse-syndicate"
                    variant="ghost"
                    size="sm"
                  >
                    Inspect Turf Manifest
                  </ActionButton>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "prompt-custom" ? (
            <div id="hero-panel-prompt-custom" role="tabpanel" className="mt-4 space-y-3">
              <div className="rounded-2xl border border-[#8B5CF6]/35 bg-[#0A0D16] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-[#C4B5FD]">
                    PROMPT -&gt; CARTRIDGEMANIFEST V2.0 PDA (4 SECONDS)
                  </span>
                  <GlassPill tone="emerald" size="xs">
                    {previewPromptCompile.compliance.valid
                      ? "FCA / SKILL-ONLY VERIFIED"
                      : "CHECK FAILED"}
                  </GlassPill>
                </div>
                <p className="mt-2 rounded-xl border border-white/10 bg-[#050609] px-3.5 py-2.5 font-mono text-xs text-slate-200">
                  “Cyberpunk 3-lane TSLAx and BTC sprint with Kalshi Fed Cut 1.5x portal boost”
                </p>
                <pre className="mt-3 max-h-44 overflow-auto rounded-xl border border-white/[0.07] bg-[#050609]/95 p-3 font-mono text-[11px] leading-relaxed text-slate-300 tabular-nums">
                  {JSON.stringify(
                    {
                      slug: previewPromptCompile.manifest.metadata.slug,
                      creatorFeeShareBps:
                        previewPromptCompile.manifest.metadata.creatorFeeShareBps,
                      privacyMode:
                        previewPromptCompile.manifest.magicblockRoomConfig.privacyMode,
                      markets: previewPromptCompile.manifest.marketUniverse.map(
                        (m) => `${m.symbol} (${m.venue})`,
                      ),
                      claimMenuAssets:
                        previewPromptCompile.manifest.scoringAndPrizes.claimMenuAssets,
                    },
                    null,
                    2,
                  )}
                </pre>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">
                    Deploys against canonical{" "}
                    <code className="font-mono text-slate-200">cartridge-registry</code> (
                    <code className="font-mono text-slate-200">
                      {CARTRIDGE_PROGRAM_IDS.registry.slice(0, 8)}…
                    </code>
                    )
                  </span>
                  <ActionButton
                    id="hero-open-vibe-studio"
                    href="/studio"
                    variant="emerald"
                    size="sm"
                  >
                    Compile in Vibe Studio
                  </ActionButton>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Bottom Console Hardware Footer Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3 text-[11px] text-slate-400">
          <span className="font-mono tabular-nums">
            ER Program:{" "}
            <span translate="no" className="text-slate-200">
              {CARTRIDGE_PROGRAM_IDS.erRoom.slice(0, 10)}…{CARTRIDGE_PROGRAM_IDS.erRoom.slice(-6)}
            </span>
          </span>
          <span className="font-mono tabular-nums text-slate-300">
            Session Risk Cap: &lt;= 5x · Zero Liquidation Debt · Paper or Live USDC
          </span>
        </div>
      </GlassCard>

      {/* RIGHT / FLOATING HANDHELD 7-CHAIN CASH & EARNED STOCK VAULT CARD (4 cols on desktop) */}
      <GlassCard
        id="hero-unified-vault-card"
        as="aside"
        accent="cyan"
        className="flex flex-col justify-between p-5 lg:col-span-4"
      >
        <div>
          {/* Mobile Hardware Notch Header */}
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#00F59B]" aria-hidden="true" />
              <span className="font-mono text-[11px] font-semibold text-slate-200">
                UNIFIED CASH &amp; STOCK VAULT
              </span>
            </div>
            <span className="rounded-md border border-white/10 bg-[#050609] px-2 py-0.5 font-mono text-[10px] text-[#00F59B]">
              Passkey · 0 Gas
            </span>
          </div>

          {/* Canonical Solana USDC Balance */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-[#050609]/90 p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Canonical Solana USDC</span>
              <span translate="no" className="font-mono text-[10px] text-slate-500">
                {SOLANA_CANONICAL_MINTS.USDC.slice(0, 6)}…{SOLANA_CANONICAL_MINTS.USDC.slice(-4)}
              </span>
            </div>
            <div
              id="hero-vault-usdc-balance"
              className="mt-1 font-mono text-3xl font-bold tracking-tight text-white tabular-nums"
            >
              $1,284.50
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="font-mono text-[#00F59B] tabular-nums">
                +$142.50 Last Borel Podium
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-white/12 bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-slate-200">
                Apple Pay · Instant
              </span>
            </div>
          </div>

          {/* Interactive 7-Chain Deposit Selector */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">7-Chain Auto-Settlement</span>
              <span className="font-mono text-[11px] text-[#00D4FF] tabular-nums">
                ~{chainInfo.routeSeconds} -&gt; USDC
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUPPORTED_DEPOSIT_CHAINS.map((chain) => {
                const active = selectedChain === chain;
                return (
                  <button
                    key={chain}
                    id={`hero-chain-pill-${chain}`}
                    type="button"
                    onClick={() => setSelectedChain(chain)}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                      active
                        ? "border-[#00D4FF]/55 bg-[#00D4FF]/15 text-white font-semibold"
                        : "border-white/10 bg-[#050609]/70 text-slate-400 hover:border-white/25 hover:text-slate-200"
                    }`}
                  >
                    {CHAIN_DISPLAY_META[chain].label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 rounded-xl border border-white/[0.06] bg-[#050609]/75 px-3 py-2 font-mono text-[11px] text-slate-300 tabular-nums">
              {chainInfo.sourceAsset} · Kora $0 Gas
            </div>
          </div>

          {/* Earned Stock Vault (RFS #3) Holdings */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Earned Stock Vault (RFS #3)</span>
              <span className="font-mono text-[10px] text-slate-400">Jupiter V2 xStocks</span>
            </div>
            <div className="space-y-1.5">
              {[
                {
                  symbol: "NVDAx",
                  shares: "4.28 sh",
                  usd: "$628.39",
                  mint: SOLANA_CANONICAL_MINTS.NVDAx,
                },
                {
                  symbol: "ANTx",
                  shares: "6.40 sh",
                  usd: "$396.80",
                  mint: SOLANA_CANONICAL_MINTS.ANTx,
                },
                {
                  symbol: "SPYx",
                  shares: "1.15 sh",
                  usd: "$684.25",
                  mint: SOLANA_CANONICAL_MINTS.SPYx,
                },
              ].map((holding) => (
                <div
                  key={holding.symbol}
                  className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#050609]/80 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      translate="no"
                      className="font-mono text-xs font-semibold text-slate-100"
                    >
                      {holding.symbol}
                    </span>
                    <span translate="no" className="font-mono text-[10px] text-slate-500">
                      {holding.mint.slice(0, 5)}…
                    </span>
                  </div>
                  <div className="text-right font-mono text-xs tabular-nums">
                    <span className="text-slate-300">{holding.shares}</span>
                    <span className="ml-2 font-semibold text-[#00F59B]">{holding.usd}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 pt-2">
          <ActionButton
            id="hero-vault-enter-arena"
            href="/play/borel"
            variant="glass"
            size="md"
            className="w-full"
          >
            Enter Paper or Live Arena
          </ActionButton>
        </div>
      </GlassCard>
    </div>
  );
}
