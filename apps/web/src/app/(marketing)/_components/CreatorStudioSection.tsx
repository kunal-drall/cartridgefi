"use client";

import * as React from "react";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  USDC_UNIT,
  compilePromptToManifest,
  computePoolAndFeeDistribution,
  simulateCartridgeEconomy,
  type CartridgeGenre,
  type VolatilityRegime,
} from "@cartridgefi/shared-types";
import {
  ActionButton,
  CopyTerminalPill,
  GlassCard,
  GlassPill,
} from "@cartridgefi/ui-system";

type BuilderModeTab = "vibe-studio" | "agentic-sdk";
type CodeSubTab = "skill-mcp" | "ts-sdk" | "wallet-deck";

const PROMPT_PRESETS: readonly {
  id: string;
  label: string;
  genre: CartridgeGenre;
  prompt: string;
}[] = [
  {
    id: "tsla-runner",
    label: "TSLAx + BTC 3-Lane Runner",
    genre: "ARCADE_RUNNER",
    prompt:
      "Create a 90s 3-lane cyberpunk runner on TSLAx and BTC where Kalshi Fed Cut gates give a 1.5x score multiplier.",
  },
  {
    id: "ant-heist",
    label: "Anthropic ANTx Turf Heist",
    genre: "SYNDICATE_TURF",
    prompt:
      "5m open-world syndicate turf heist across Anthropic ANTx and SOL perps inside Private ER TEE Fog of War.",
  },
  {
    id: "nvda-gameday",
    label: "NVDAx Earnings Blitz",
    genre: "BOREL_GAMEDAY",
    prompt:
      "60s Game-Day earnings conviction blitz on NVDAx and SOL with Kalshi beat catalyst and xStock payouts.",
  },
];

const CODE_SNIPPETS: Record<CodeSubTab, { title: string; filename: string; code: string }> = {
  "skill-mcp": {
    title: "Claude Code / Cursor Agent Skill + @cartridgefi/mcp",
    filename: ".mcp.json + terminal",
    code: `# 1. Install CartridgeFi Skill & MCP Server into Claude Code / Cursor
$ npx skills add cartridgefi/skill

// 2. .mcp.json — exposes compile_manifest, simulate_economy & register_cartridge
{
  "mcpServers": {
    "cartridgefi": {
      "command": "npx",
      "args": ["-y", "@cartridgefi/mcp@latest"],
      "env": {
        "SOLANA_RPC_URL": "https://rpc.magicblock.app/devnet",
        "MAGICBLOCK_ROUTER_URL": "https://devnet-router.magicblock.app"
      }
    }
  }
}`,
  },
  "ts-sdk": {
    title: "@cartridgefi/sdk — 18-Line Multiplayer Engine Binding",
    filename: "arena-client.ts",
    code: `import { CartridgeEngineClient } from "@cartridgefi/sdk";
import { BOREL_GAMEDAY_MANIFEST } from "@cartridgefi/shared-types";

const engine = new CartridgeEngineClient({
  routerHttp: "https://devnet-router.magicblock.app",
  teeEndpoint: "https://devnet-tee.magicblock.app",
});

// Zero-popup Kora-sponsored MagicBlock Session Key sign-in
const session = await engine.joinRoom({
  manifest: BOREL_GAMEDAY_MANIFEST,
  mode: "LIVE",
  envelopeUsdc: 25_000_000n, // 25 USDC (6 decimals)
});

await session.submitConvictionWeights([6000, -4000, 0, 0], "YES");
session.subscribeWorldPulse((frame) => {
  console.log("10ms ER Rank:", frame.playerRank, "Fog:", frame.isFogEncrypted);
});`,
  },
  "wallet-deck": {
    title: "<CartridgeDeck/> — 15-Line Partner Wallet Embed (40% Fee Share)",
    filename: "PartnerWalletSheet.tsx",
    code: `import { CartridgeDeck } from "@cartridgefi/react";

export function PartnerWalletGamesTab({ userWallet }: { userWallet: string }) {
  return (
    <CartridgeDeck
      userWallet={userWallet}
      defaultCartridgeSlug="borel-macro-blitz-001"
      partnerFeeVault="7JdpFNAHqeoaYnnS9G1DY9qCyN33UBRyaySfANCHjFRa"
      revenueSplitMode="PARTNER_40_30_30" // 40% Wallet · 30% Creator · 30% Engine
      allowPaperMode
      maxSessionEnvelopeUsdc={100}
      onPrizeClaimed={(txSig, asset) => console.log("Claimed", asset, txSig)}
    />
  );
}`,
  },
};

function formatAtomicUsdcCurrency(atomic: bigint): string {
  const whole = atomic / USDC_UNIT;
  const cents = ((atomic % USDC_UNIT) / 10_000n).toString().padStart(2, "0");
  return `$${new Intl.NumberFormat("en-US").format(whole)}.${cents}`;
}

export function CreatorStudioSection(): React.JSX.Element {
  const [activeMode, setActiveMode] = React.useState<BuilderModeTab>("vibe-studio");
  const [promptText, setPromptText] = React.useState<string>(PROMPT_PRESETS[0]!.prompt);
  const [selectedGenre, setSelectedGenre] = React.useState<CartridgeGenre>("ARCADE_RUNNER");
  const [volatilityRegime, setVolatilityRegime] = React.useState<VolatilityRegime>("calm");

  // Revenue Calculator State
  const [dailyRooms, setDailyRooms] = React.useState<number>(80);
  const [avgPoolUsdc, setAvgPoolUsdc] = React.useState<number>(200);
  const [partnerWalletActive, setPartnerWalletActive] = React.useState<boolean>(false);

  // Code Workbench State
  const [codeTab, setCodeTab] = React.useState<CodeSubTab>("skill-mcp");
  const [copiedCode, setCopiedCode] = React.useState<boolean>(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const compiledResult = React.useMemo(
    () =>
      compilePromptToManifest({
        prompt: promptText,
        genre: selectedGenre,
        creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
        creatorHandle: "@vibe-architect",
      }),
    [promptText, selectedGenre],
  );

  const simulationReport = React.useMemo(
    () =>
      simulateCartridgeEconomy(
        compiledResult.manifest,
        volatilityRegime,
        500,
        24,
      ),
    [compiledResult.manifest, volatilityRegime],
  );

  const feeDistribution = React.useMemo(() => {
    const roomPoolAtomic = BigInt(avgPoolUsdc) * USDC_UNIT;
    const perRoom = computePoolAndFeeDistribution({
      roomPoolUsdc: roomPoolAtomic,
      totalFeeBps: 250, // 2.50% builder + protocol fee
      creatorShareBps: 5000, // 50% creator share
      partnerWalletActive,
      playerScores: [
        { player: "p1", scoreScaled: 300_000_000n },
        { player: "p2", scoreScaled: 150_000_000n },
        { player: "p3", scoreScaled: 50_000_000n },
      ],
    });

    const monthlyRooms = BigInt(dailyRooms) * 30n;
    const annualRooms = BigInt(dailyRooms) * 365n;

    return {
      perRoomCreatorAtomic: perRoom.creatorFeeUsdc,
      monthlyCreatorAtomic: perRoom.creatorFeeUsdc * monthlyRooms,
      annualCreatorAtomic: perRoom.creatorFeeUsdc * annualRooms,
      monthlyPartnerAtomic: perRoom.partnerFeeUsdc * monthlyRooms,
      monthlyEngineAtomic: perRoom.platformFeeUsdc * monthlyRooms,
      perRoomWinnerPrizeAtomic: perRoom.netPrizePoolUsdc,
    };
  }, [avgPoolUsdc, dailyRooms, partnerWalletActive]);

  const handleCopySnippet = async (): Promise<void> => {
    const text = CODE_SNIPPETS[codeTab].code;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Clipboard API unavailable in non-HTTPS headless contexts
    }
    setCopiedCode(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <section
      id="creator-studio"
      aria-labelledby="creator-studio-heading"
      className="scroll-mt-24 border-t border-white/[0.06] bg-[#0A0D14]/60 py-20 lg:py-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <GlassPill tone="amber" size="xs">
                Creator Economy · 50% Builder Fee Split
              </GlassPill>
              <GlassPill tone="cyan" size="xs">
                Web Vibe Studio + MCP + SDK
              </GlassPill>
            </div>
            <h2
              id="creator-studio-heading"
              className="font-display text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl text-balance"
            >
              Vibe-code in 60 seconds, or drop into Claude Code and Unity. Keep 50% of the fees.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
              Compile a compliant{" "}
              <code className="font-mono text-slate-200">CartridgeManifest v2.0</code> PDA in
              seconds without touching Rust—and earn 50% of net venue builder fees on every room
              settled by your players.
            </p>
          </div>

          {/* Dual Creation Mode Tabs */}
          <div
            role="tablist"
            aria-label="Creation Workflow Mode"
            className="inline-flex rounded-2xl border border-white/10 bg-[#050609] p-1.5"
          >
            <button
              id="creator-tab-vibe"
              role="tab"
              type="button"
              aria-selected={activeMode === "vibe-studio"}
              onClick={() => setActiveMode("vibe-studio")}
              className={`cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                activeMode === "vibe-studio"
                  ? "bg-[#00F59B] text-[#050609]"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              1. Web Vibe Studio &amp; Fee Calculator
            </button>
            <button
              id="creator-tab-agentic"
              role="tab"
              type="button"
              aria-selected={activeMode === "agentic-sdk"}
              onClick={() => setActiveMode("agentic-sdk")}
              className={`cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                activeMode === "agentic-sdk"
                  ? "bg-[#00D4FF] text-[#050609]"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              2. Agentic MCP, Skills &amp; &lt;CartridgeDeck/&gt;
            </button>
          </div>
        </div>

        {/* TAB 1: LIVE PROMPT COMPILER + 50% CREATOR FEE CALCULATOR */}
        {activeMode === "vibe-studio" ? (
          <div
            id="creator-panel-vibe"
            role="tabpanel"
            className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12"
          >
            {/* Left (7 cols): Live Prompt-to-CartridgeManifest Compiler + 500-Tick WASM/BigInt Simulator */}
            <GlassCard id="vibe-compiler-card" accent="emerald" className="p-6 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-[#00F59B]">
                  LIVE BROWSER COMPILER · @cartridgefi/shared-types
                </span>
                <span
                  id="vibe-compliance-badge"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                    compiledResult.compliance.valid
                      ? "border-[#00F59B]/40 bg-[#00F59B]/15 text-[#00F59B]"
                      : "border-[#FF4560]/45 bg-[#FF4560]/15 text-[#FF4560]"
                  }`}
                >
                  {compiledResult.compliance.valid
                    ? "SKILL-ONLY COMPLIANT"
                    : "COMPLIANCE HARD-BLOCK"}
                </span>
              </div>

              {/* Preset Chips */}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    id={`vibe-preset-${preset.id}`}
                    type="button"
                    onClick={() => {
                      setPromptText(preset.prompt);
                      setSelectedGenre(preset.genre);
                    }}
                    className="cursor-pointer rounded-lg border border-white/10 bg-[#050609]/85 px-2.5 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-[#00F59B]/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Accessible Prompt Input */}
              <div className="mt-3">
                <label
                  htmlFor="vibe-prompt-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Describe your market game mechanics in plain English
                </label>
                <textarea
                  id="vibe-prompt-input"
                  name="vibePrompt"
                  rows={3}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  autoComplete="off"
                  placeholder="Create a 90s 3-lane runner on TSLAx and BTC with Kalshi gates…"
                  className="mt-1.5 w-full rounded-xl border border-white/12 bg-[#050609] p-3 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus-visible:border-[#00F59B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                />
              </div>

              {/* Genre & Stress-Test Volatility Controls */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Target genre">
                  {(
                    [
                      "BOREL_GAMEDAY",
                      "ARCADE_RUNNER",
                      "SYNDICATE_TURF",
                      "PREDICTION_BRACKET",
                    ] as const
                  ).map((g) => (
                    <button
                      key={g}
                      id={`vibe-genre-${g}`}
                      type="button"
                      onClick={() => setSelectedGenre(g)}
                      className={`cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                        selectedGenre === g
                          ? "border-[#00F59B]/50 bg-[#00F59B]/15 text-[#00F59B]"
                          : "border-white/10 bg-[#050609] text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    id="vibe-regime-calm"
                    type="button"
                    onClick={() => setVolatilityRegime("calm")}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                      volatilityRegime === "calm"
                        ? "border-[#00D4FF]/50 bg-[#00D4FF]/15 text-[#00D4FF] font-semibold"
                        : "border-white/10 bg-[#050609] text-slate-400"
                    }`}
                  >
                    500-Tick Calm
                  </button>
                  <button
                    id="vibe-regime-crash"
                    type="button"
                    onClick={() => setVolatilityRegime("crash_vix35")}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                      volatilityRegime === "crash_vix35"
                        ? "border-[#FFB020]/50 bg-[#FFB020]/15 text-[#FFB020] font-semibold"
                        : "border-white/10 bg-[#050609] text-slate-400"
                    }`}
                  >
                    VIX-35 Crash Stress
                  </button>
                </div>
              </div>

              {!compiledResult.compliance.valid ? (
                <div
                  role="alert"
                  className="mt-3 rounded-xl border border-[#FF4560]/40 bg-[#FF4560]/10 p-3 font-mono text-xs text-[#FF8FA0]"
                >
                  {compiledResult.compliance.violations.join(" ")}
                </div>
              ) : null}

              {/* 500-Tick Deterministic Simulation Telemetry */}
              <div className="mt-4 grid grid-cols-3 gap-2.5 rounded-xl border border-white/[0.08] bg-[#050609]/90 p-3 font-mono tabular-nums">
                <div>
                  <div className="text-[10px] text-slate-400">P90 Skill Score</div>
                  <div className="mt-0.5 text-sm font-bold text-[#00F59B]">
                    {simulationReport.p90ScoreFormatted}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Median Skill Score</div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-200">
                    {simulationReport.medianScoreFormatted}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Solvency Invariant</div>
                  <div className="mt-0.5 text-sm font-bold text-[#00D4FF]">
                    {simulationReport.payoutConservationVerified ? "100% CONSERVED" : "FAILED"}
                  </div>
                </div>
              </div>

              {/* Compiled Manifest JSON Inspector */}
              <pre className="mt-3 max-h-52 overflow-auto rounded-xl border border-white/[0.08] bg-[#050609] p-3.5 font-mono text-[11px] leading-relaxed text-slate-300 tabular-nums">
                {JSON.stringify(
                  {
                    manifestVersion: compiledResult.manifest.manifestVersion,
                    metadata: {
                      slug: compiledResult.manifest.metadata.slug,
                      genre: compiledResult.manifest.metadata.genre,
                      engineTarget: compiledResult.manifest.metadata.engineTarget,
                      creatorFeeShareBps:
                        compiledResult.manifest.metadata.creatorFeeShareBps,
                    },
                    magicblockRoomConfig: compiledResult.manifest.magicblockRoomConfig,
                    marketUniverse: compiledResult.manifest.marketUniverse.map((u) => ({
                      symbol: u.symbol,
                      venue: u.venue,
                    })),
                    scoringAndPrizes: compiledResult.manifest.scoringAndPrizes,
                  },
                  null,
                  2,
                )}
              </pre>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-xs text-slate-400">
                  Registry PDA:{" "}
                  <span translate="no" className="text-slate-200">
                    {CARTRIDGE_PROGRAM_IDS.registry.slice(0, 10)}…
                  </span>
                </span>
                <ActionButton
                  id="vibe-open-full-studio"
                  href="/studio"
                  variant="emerald"
                  size="md"
                >
                  Open in Full Vibe Studio
                </ActionButton>
              </div>
            </GlassCard>

            {/* Right (5 cols): Interactive 50% Creator Revenue Split Calculator */}
            <GlassCard
              id="creator-fee-calculator-card"
              accent="amber"
              className="flex flex-col justify-between p-6 lg:col-span-5"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <GlassPill tone="amber" size="xs">
                    Exact BigInt Fee Conservation
                  </GlassPill>
                  <span className="font-mono text-xs text-slate-400 tabular-nums">
                    250 bps Builder Pool
                  </span>
                </div>

                <h3 className="mt-3 font-display text-xl font-bold text-white">
                  50% Creator Revenue Split Calculator
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Every settled room routes builder fees atomically via MagicBlock Private Payments.
                  Toggle between Direct launch (50% Creator / 50% Engine) and Partner Wallet embed
                  (40% Wallet / 30% Creator / 30% Engine).
                </p>

                {/* Split Mode Toggle */}
                <div
                  role="group"
                  aria-label="Fee split distribution mode"
                  className="mt-4 grid grid-cols-2 gap-2"
                >
                  <button
                    id="fee-mode-direct"
                    type="button"
                    onClick={() => setPartnerWalletActive(false)}
                    className={`cursor-pointer rounded-xl border py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                      !partnerWalletActive
                        ? "border-[#FFB020] bg-[#FFB020]/15 text-[#FCD34D]"
                        : "border-white/10 bg-[#050609] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Direct · 50% / 50%
                  </button>
                  <button
                    id="fee-mode-partner"
                    type="button"
                    onClick={() => setPartnerWalletActive(true)}
                    className={`cursor-pointer rounded-xl border py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                      partnerWalletActive
                        ? "border-[#00D4FF] bg-[#00D4FF]/15 text-[#67E8F9]"
                        : "border-white/10 bg-[#050609] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Wallet Deck · 40/30/30
                  </button>
                </div>

                {/* Sliders */}
                <div className="mt-5 space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="slider-daily-rooms" className="font-medium text-slate-300">
                        Daily Settled Rooms
                      </label>
                      <span className="font-mono font-semibold text-white tabular-nums">
                        {dailyRooms} rooms / day
                      </span>
                    </div>
                    <input
                      id="slider-daily-rooms"
                      name="dailyRooms"
                      type="range"
                      min={10}
                      max={500}
                      step={10}
                      value={dailyRooms}
                      onChange={(e) => setDailyRooms(Number(e.target.value))}
                      className="mt-2 h-2 w-full cursor-pointer accent-[#00F59B]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="slider-room-pool" className="font-medium text-slate-300">
                        Avg Room Pool (USDC)
                      </label>
                      <span className="font-mono font-semibold text-white tabular-nums">
                        ${avgPoolUsdc} USDC
                      </span>
                    </div>
                    <input
                      id="slider-room-pool"
                      name="avgPoolUsdc"
                      type="range"
                      min={50}
                      max={500}
                      step={25}
                      value={avgPoolUsdc}
                      onChange={(e) => setAvgPoolUsdc(Number(e.target.value))}
                      className="mt-2 h-2 w-full cursor-pointer accent-[#FFB020]"
                    />
                  </div>
                </div>

                {/* Computed Revenue Output */}
                <div className="mt-5 rounded-2xl border border-[#FFB020]/30 bg-[#050609]/95 p-4">
                  <div className="text-xs text-slate-400">
                    Projected 30-Day Creator Payout ({partnerWalletActive ? "30%" : "50%"} Share)
                  </div>
                  <div
                    id="calc-monthly-creator-usdc"
                    className="mt-1 font-mono text-3xl font-bold text-[#FFB020] tabular-nums"
                  >
                    {formatAtomicUsdcCurrency(feeDistribution.monthlyCreatorAtomic)}
                    <span className="ml-1.5 text-xs font-normal text-slate-400">/ mo</span>
                  </div>

                  <div className="mt-3 space-y-1.5 border-t border-white/[0.08] pt-3 font-mono text-xs tabular-nums">
                    <div className="flex justify-between text-slate-300">
                      <span>Annualized Creator Run-Rate</span>
                      <span className="font-semibold text-[#00F59B]">
                        {formatAtomicUsdcCurrency(feeDistribution.annualCreatorAtomic)}/yr
                      </span>
                    </div>
                    {partnerWalletActive ? (
                      <div className="flex justify-between text-[#67E8F9]">
                        <span>Partner Wallet 30-Day Share (40%)</span>
                        <span className="font-semibold">
                          {formatAtomicUsdcCurrency(feeDistribution.monthlyPartnerAtomic)}/mo
                        </span>
                      </div>
                    ) : null}
                    <div className="flex justify-between text-slate-400">
                      <span>Per-Room Creator Fee</span>
                      <span>
                        {formatAtomicUsdcCurrency(feeDistribution.perRoomCreatorAtomic)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Winner Shapley Pool (97.50%)</span>
                      <span>
                        {formatAtomicUsdcCurrency(feeDistribution.perRoomWinnerPrizeAtomic)}/room
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-2 text-[11px] text-slate-400">
                Settled directly into your{" "}
                <code className="font-mono text-slate-300">creatorFeeVault</code> SPL token account
                with zero manual invoicing.
              </div>
            </GlassCard>
          </div>
        ) : (
          /* TAB 2: AGENTIC MCP, SKILLS & <CartridgeDeck/> SDK WORKBENCH */
          <div id="creator-panel-agentic" role="tabpanel" className="mt-10">
            <GlassCard id="agentic-sdk-workbench" accent="cyan" className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="SDK Code Examples">
                  <button
                    id="code-tab-skill-mcp"
                    role="tab"
                    type="button"
                    aria-selected={codeTab === "skill-mcp"}
                    onClick={() => setCodeTab("skill-mcp")}
                    className={`cursor-pointer rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                      codeTab === "skill-mcp"
                        ? "border-[#00D4FF]/55 bg-[#00D4FF]/15 text-[#67E8F9]"
                        : "border-white/10 bg-[#050609] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    SKILL.md + @cartridgefi/mcp
                  </button>
                  <button
                    id="code-tab-ts-sdk"
                    role="tab"
                    type="button"
                    aria-selected={codeTab === "ts-sdk"}
                    onClick={() => setCodeTab("ts-sdk")}
                    className={`cursor-pointer rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                      codeTab === "ts-sdk"
                        ? "border-[#00D4FF]/55 bg-[#00D4FF]/15 text-[#67E8F9]"
                        : "border-white/10 bg-[#050609] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    @cartridgefi/sdk (18 lines)
                  </button>
                  <button
                    id="code-tab-wallet-deck"
                    role="tab"
                    type="button"
                    aria-selected={codeTab === "wallet-deck"}
                    onClick={() => setCodeTab("wallet-deck")}
                    className={`cursor-pointer rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                      codeTab === "wallet-deck"
                        ? "border-[#00D4FF]/55 bg-[#00D4FF]/15 text-[#67E8F9]"
                        : "border-white/10 bg-[#050609] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    &lt;CartridgeDeck/&gt; Wallet Embed (15 lines)
                  </button>
                </div>

                <button
                  id="creator-copy-code-btn"
                  type="button"
                  onClick={() => {
                    void handleCopySnippet();
                  }}
                  className="cursor-pointer rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2 font-mono text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
                >
                  {copiedCode ? "Copied Snippet" : `Copy ${CODE_SNIPPETS[codeTab].filename}`}
                </button>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span>{CODE_SNIPPETS[codeTab].title}</span>
                  <span translate="no" className="font-mono text-slate-500">
                    {CODE_SNIPPETS[codeTab].filename}
                  </span>
                </div>
                <pre className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#050609] p-4 font-mono text-xs leading-relaxed text-slate-200 tabular-nums">
                  <code>{CODE_SNIPPETS[codeTab].code}</code>
                </pre>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                <CopyTerminalPill
                  id="agentic-workbench-copy-skill"
                  command="npx skills add cartridgefi/skill"
                  badge="CLAUDE / CURSOR"
                />
                <ActionButton
                  id="agentic-open-studio-cta"
                  href="/studio"
                  variant="emerald"
                  size="md"
                >
                  Launch Web Vibe Studio
                </ActionButton>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </section>
  );
}
