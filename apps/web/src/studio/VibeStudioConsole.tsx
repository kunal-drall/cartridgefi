"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  FIRST_PARTY_CARTRIDGE_CATALOG,
  compilePromptToManifest,
  simulateCartridgeEconomy,
  type CartridgeGenre,
  type VolatilityRegime,
} from "@cartridgefi/shared-types";
import {
  ActionButton,
  CopyTerminalPill,
  GlassCard,
  GlassPill,
  LivePulseDot,
} from "@cartridgefi/ui-system";
import { formatAtomicUsdc } from "@/app/(console)/_components/ConsoleVaultContext";
import {
  deployCartridgeAndDelegateShard,
  type DeployedCartridgeDeployment,
} from "./pda";
import { WalletDeckPreview } from "./WalletDeckPreview";

interface StudioPresetChip {
  id: string;
  buttonId: string;
  label: string;
  genre: CartridgeGenre;
  prompt: string;
  tone: "default" | "guardrail";
}

const STUDIO_PRESETS: readonly StudioPresetChip[] = [
  {
    id: "tsla-runner",
    buttonId: "studio-preset-tsla-runner",
    label: "TSLAx + BTC 3-Lane Runner",
    genre: "ARCADE_RUNNER",
    prompt:
      "90s cyberpunk 3-lane volatility sprint on TSLAx and BTC where Kalshi Fed Cut gates unlock a 1.5x skill carry.",
    tone: "default",
  },
  {
    id: "nvda-arena",
    buttonId: "studio-preset-nvda-arena",
    label: "NVDAx Game-Day Blitz",
    genre: "BOREL_GAMEDAY",
    prompt:
      "60s Game-Day earnings conviction arena on NVDAx and SOL perps inside Private ER TEE Fog of War with NVDAx stock payouts.",
    tone: "default",
  },
  {
    id: "ant-turf",
    buttonId: "studio-preset-ant-turf",
    label: "Anthropic ANTx Turf Heist",
    genre: "SYNDICATE_TURF",
    prompt:
      "5m open-world syndicate turf capture across Anthropic ANTx and SOL districts with 50% creator builder fee split.",
    tone: "default",
  },
  {
    id: "anti-casino",
    buttonId: "studio-preset-anti-casino",
    label: "Test Anti-Casino Guardrail",
    genre: "BOREL_GAMEDAY",
    prompt:
      "Add paid loot box spin and casino jackpot roulette multiplier on SOL perps with trade streak nudge.",
    tone: "guardrail",
  },
];

const GENRE_OPTIONS: readonly { id: CartridgeGenre; label: string }[] = [
  { id: "BOREL_GAMEDAY", label: "BOREL_GAMEDAY" },
  { id: "ARCADE_RUNNER", label: "ARCADE_RUNNER" },
  { id: "SYNDICATE_TURF", label: "SYNDICATE_TURF" },
  { id: "PREDICTION_BRACKET", label: "PREDICTION_BRACKET" },
];

function resolveInitialTemplate(paramValue: string | null): {
  genre: CartridgeGenre;
  prompt: string;
  handle: string;
} {
  if (paramValue) {
    const clean = paramValue.trim();
    const matchedCatalog = FIRST_PARTY_CARTRIDGE_CATALOG.find(
      (c) => c.metadata.slug === clean,
    );
    if (matchedCatalog) {
      return {
        genre: matchedCatalog.metadata.genre,
        prompt: `${matchedCatalog.metadata.title} — ${matchedCatalog.metadata.subtitle}`,
        handle: matchedCatalog.metadata.creatorHandle,
      };
    }
    const upper = clean.toUpperCase();
    if (
      upper === "BOREL_GAMEDAY" ||
      upper === "ARCADE_RUNNER" ||
      upper === "SYNDICATE_TURF" ||
      upper === "PREDICTION_BRACKET"
    ) {
      const preset = STUDIO_PRESETS.find((p) => p.genre === upper) ?? STUDIO_PRESETS[0]!;
      return {
        genre: upper,
        prompt: preset.prompt,
        handle: "@vibe-creator",
      };
    }
  }

  return {
    genre: STUDIO_PRESETS[0]!.genre,
    prompt: STUDIO_PRESETS[0]!.prompt,
    handle: "@vibe-creator",
  };
}

export function VibeStudioConsole(): React.JSX.Element {
  const searchParams = useSearchParams();
  const templateOrForkParam =
    searchParams.get("template") ?? searchParams.get("fork");

  const initialSeed = React.useMemo(
    () => resolveInitialTemplate(templateOrForkParam),
    [templateOrForkParam],
  );

  const [selectedGenre, setSelectedGenre] = React.useState<CartridgeGenre>(
    initialSeed.genre,
  );
  const [promptText, setPromptText] = React.useState<string>(initialSeed.prompt);
  const [creatorHandle, setCreatorHandle] = React.useState<string>(
    initialSeed.handle,
  );
  const [creatorWallet, setCreatorWallet] = React.useState<string>(
    CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
  );
  const [volatilityRegime, setVolatilityRegime] =
    React.useState<VolatilityRegime>("calm");
  const [compileCount, setCompileCount] = React.useState<number>(1);

  const [isDeploying, setIsDeploying] = React.useState<boolean>(false);
  const [deployment, setDeployment] =
    React.useState<DeployedCartridgeDeployment | null>(null);
  const [copiedManifest, setCopiedManifest] = React.useState<boolean>(false);
  const [copiedShareLink, setCopiedShareLink] = React.useState<boolean>(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync if URL ?template= or ?fork= changes
  React.useEffect(() => {
    setSelectedGenre(initialSeed.genre);
    setPromptText(initialSeed.prompt);
    setCreatorHandle(initialSeed.handle);
    setDeployment(null);
  }, [initialSeed]);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const safeWallet =
    creatorWallet.trim().length >= 32
      ? creatorWallet.trim()
      : CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper;
  const safeHandle =
    creatorHandle.trim().length >= 2 ? creatorHandle.trim() : "@vibe-creator";

  const compiled = React.useMemo(
    () =>
      compilePromptToManifest({
        prompt: promptText,
        genre: selectedGenre,
        creatorWallet: safeWallet,
        creatorHandle: safeHandle,
      }),
    [promptText, safeHandle, safeWallet, selectedGenre],
  );

  // Pre-compute both Calm & VIX-35 Crash 500-tick BigInt simulation reports
  const calmReport = React.useMemo(
    () => simulateCartridgeEconomy(compiled.manifest, "calm", 500, 24),
    [compiled.manifest],
  );
  const crashReport = React.useMemo(
    () => simulateCartridgeEconomy(compiled.manifest, "crash_vix35", 500, 24),
    [compiled.manifest],
  );

  const activeSimReport =
    volatilityRegime === "crash_vix35" ? crashReport : calmReport;

  const handleCompileAndSimulate = (): void => {
    setCompileCount((prev) => prev + 1);
    setDeployment(null);
  };

  const handleDeployToDevnet = async (): Promise<void> => {
    if (!compiled.compliance.valid) return;
    setIsDeploying(true);
    try {
      const result = await deployCartridgeAndDelegateShard(compiled.manifest);
      setDeployment(result);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleCopyManifestJson = async (): Promise<void> => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          JSON.stringify(compiled.manifest, null, 2),
        );
      }
    } catch {
      // Non-HTTPS fallback
    }
    setCopiedManifest(true);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedManifest(false), 2000);
  };

  const handleCopyShareLink = async (playablePath: string): Promise<void> => {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${playablePath}`
        : `https://cartridgefi.com${playablePath}`;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // Non-HTTPS fallback
    }
    setCopiedShareLink(true);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedShareLink(false), 2000);
  };

  const defaultPlayableHref =
    deployment?.playablePath ??
    (compiled.manifest.metadata.genre === "ARCADE_RUNNER"
      ? "/play/pulse-runner"
      : `/play/borel?cartridge=${encodeURIComponent(compiled.manifest.metadata.slug)}`);

  return (
    <div className="space-y-6">
      {/* Studio Top Banner */}
      <GlassCard
        id="vibe-studio-header-card"
        variant="stage"
        accent="emerald"
        className="p-4 sm:p-6"
      >
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <GlassPill tone="emerald" size="xs">
                Hosted Web Vibe-Coding Studio
              </GlassPill>
              <GlassPill tone="amber" size="xs">
                50% Creator Builder Fee Vault
              </GlassPill>
              <GlassPill tone="cyan" size="xs">
                Zero Custom Rust Contracts
              </GlassPill>
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.035em] text-white sm:text-3xl">
              Prompt-to-CartridgeManifest v2.0 IDE &amp; Wallet SDK Previewer
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
              Compile natural-language game mechanics into schema-verified{" "}
              <code className="font-mono text-slate-200">CartridgeManifest v2.0</code> PDAs,
              stress-test 500 deterministic fixed-point ticks across Calm &amp; VIX-35 Crash
              regimes, deploy to Solana Devnet, and preview inside Solflare, Phantom, or Backpack.
            </p>
          </div>

          <CopyTerminalPill
            id="studio-header-copy-skill"
            command="npx skills add cartridgefi/skill"
            badge="AGENT SKILL"
          />
        </div>
      </GlassCard>

      {/* TWO-COLUMN STUDIO IDE */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN (6 COLS): PROMPT & GENRE CHASSIS COMPILER */}
        <GlassCard
          id="studio-compiler-column"
          accent="emerald"
          className="space-y-4 p-4 sm:p-6 lg:col-span-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <div>
              <span className="font-mono text-[11px] font-semibold text-[#00F59B]">
                1. PROMPT &amp; GENRE CHASSIS COMPILER
              </span>
              <h2 className="mt-0.5 font-display text-lg font-bold text-white">
                Configure Cartridge Physics
              </h2>
            </div>

            <span
              id="studio-compliance-badge"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${
                compiled.compliance.valid
                  ? "border-[#00F59B]/45 bg-[#00F59B]/15 text-[#00F59B]"
                  : "border-[#FF4560]/50 bg-[#FF4560]/15 text-[#FF4560]"
              }`}
            >
              {compiled.compliance.valid
                ? "FCA/SEC DEP Clean · <= 5x Leverage · 50% Creator Split"
                : "COMPLIANCE HARD-BLOCK"}
            </span>
          </div>

          {/* Genre Chassis Selector */}
          <div>
            <span className="block text-xs font-medium text-slate-300">
              Select Base Genre Chassis
            </span>
            <div
              role="group"
              aria-label="Cartridge Genre Chassis"
              className="mt-2 grid grid-cols-2 gap-2"
            >
              {GENRE_OPTIONS.map((g) => {
                const active = selectedGenre === g.id;
                return (
                  <button
                    key={g.id}
                    id={`studio-genre-${g.id}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedGenre(g.id);
                      setDeployment(null);
                    }}
                    className={`cursor-pointer rounded-xl border px-3 py-2 text-left font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                      active
                        ? "border-[#00F59B] bg-[#00F59B]/14 text-[#00F59B]"
                        : "border-white/10 bg-[#050609]/90 text-slate-300 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Creator Handle & Creator Wallet Inputs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="studio-creator-handle-input"
                className="block text-xs font-medium text-slate-300"
              >
                Creator Handle
              </label>
              <input
                id="studio-creator-handle-input"
                name="creatorHandle"
                type="text"
                value={creatorHandle}
                onChange={(e) => setCreatorHandle(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="@vibe-creator…"
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-[#050609] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus-visible:border-[#00F59B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
              />
            </div>

            <div>
              <label
                htmlFor="studio-creator-wallet-input"
                className="block text-xs font-medium text-slate-300"
              >
                Creator Fee Wallet (50% Split)
              </label>
              <input
                id="studio-creator-wallet-input"
                name="creatorWallet"
                type="text"
                value={creatorWallet}
                onChange={(e) => setCreatorWallet(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="Solana base58 pubkey…"
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-[#050609] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus-visible:border-[#00F59B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
              />
            </div>
          </div>

          {/* Preset Prompt Chips (including Anti-Casino Guardrail Test) */}
          <div>
            <span className="block text-xs font-medium text-slate-300">
              Quick Prompt Templates &amp; Compliance Guardrail Test
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STUDIO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  id={preset.buttonId}
                  type="button"
                  onClick={() => {
                    setSelectedGenre(preset.genre);
                    setPromptText(preset.prompt);
                    setDeployment(null);
                  }}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                    preset.tone === "guardrail"
                      ? "border-[#FF4560]/45 bg-[#FF4560]/12 text-[#FF8FA0] hover:bg-[#FF4560]/22"
                      : "border-white/10 bg-[#050609] text-slate-300 hover:border-[#00F59B]/40 hover:text-white"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Natural-Language Game Prompt Textarea */}
          <div>
            <label
              htmlFor="studio-prompt-input"
              className="block text-xs font-medium text-slate-300"
            >
              Natural-Language Game Mechanics &amp; Asset Prompt
            </label>
            <textarea
              id="studio-prompt-input"
              name="studioPrompt"
              rows={3}
              value={promptText}
              onChange={(e) => {
                setPromptText(e.target.value);
                setDeployment(null);
              }}
              autoComplete="off"
              placeholder="Describe your market game twist, duration (60s/180s), and assets (SOL, BTC, NVDAx, TSLAx, ANTx)…"
              className="mt-1.5 w-full rounded-xl border border-white/12 bg-[#050609] p-3 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus-visible:border-[#00F59B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            />
          </div>

          {/* Inline Compliance Guardrail Violations */}
          {!compiled.compliance.valid ? (
            <div
              id="studio-compliance-violations"
              role="alert"
              className="rounded-xl border border-[#FF4560]/50 bg-[#FF4560]/12 p-3.5 font-mono text-xs leading-relaxed text-[#FF8FA0]"
            >
              <div className="font-bold text-[#FF4560]">
                Engine Compliance Gate Blocked Compilation:
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {compiled.compliance.violations.map((v, idx) => (
                  <li key={idx}>{v}</li>
                ))}
              </ul>
              <div className="mt-2 text-[11px] text-slate-300">
                Fix: Remove paid loot boxes, roulette spins, or trade-streak nudges—or select a
                skill-first preset chip above.
              </div>
            </div>
          ) : null}

          <ActionButton
            id="studio-compile-btn"
            variant="emerald"
            size="lg"
            onClick={handleCompileAndSimulate}
            className="w-full"
          >
            Compile &amp; Simulate (500 Ticks · Build #{compileCount})
          </ActionButton>

          {/* Live CartridgeManifest v2.0 JSON Inspector */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-mono font-semibold text-slate-300">
                Compiled CartridgeManifest v2.0 JSON
              </span>
              <button
                id="studio-copy-manifest-btn"
                type="button"
                onClick={() => {
                  void handleCopyManifestJson();
                }}
                className="cursor-pointer rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-200 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
              >
                {copiedManifest ? "Copied JSON" : "Copy Manifest"}
              </button>
            </div>
            <pre
              id="studio-manifest-json"
              className="max-h-72 overflow-auto rounded-2xl border border-white/[0.08] bg-[#050609] p-3.5 font-mono text-[11px] leading-relaxed text-slate-300 tabular-nums"
            >
              {JSON.stringify(compiled.manifest, null, 2)}
            </pre>
          </div>
        </GlassCard>

        {/* RIGHT COLUMN (6 COLS): 500-TICK SIMULATION, DEVNET DEPLOY & <CartridgeDeck/> PREVIEWER */}
        <div className="space-y-6 lg:col-span-6">
          {/* 500-Tick WASM/BigInt Simulation & 1-Click On-Chain Deploy */}
          <GlassCard
            id="studio-simulation-and-deploy-card"
            variant="stage"
            accent="amber"
            className="space-y-4 p-4 sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
              <div>
                <span className="font-mono text-[11px] font-semibold text-[#FFB020]">
                  2. 500-TICK BIGINT SIMULATION &amp; ON-CHAIN DEPLOY
                </span>
                <h2 className="mt-0.5 font-display text-lg font-bold text-white">
                  Solvency Proof &amp; Devnet Delegation
                </h2>
              </div>

              <div
                role="group"
                aria-label="Simulation Volatility Regime"
                className="inline-flex rounded-xl border border-white/10 bg-[#050609] p-1"
              >
                <button
                  id="studio-regime-calm"
                  type="button"
                  onClick={() => setVolatilityRegime("calm")}
                  className={`cursor-pointer rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                    volatilityRegime === "calm"
                      ? "bg-[#00D4FF] text-[#050609]"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Calm Regime
                </button>
                <button
                  id="studio-regime-crash"
                  type="button"
                  onClick={() => setVolatilityRegime("crash_vix35")}
                  className={`cursor-pointer rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                    volatilityRegime === "crash_vix35"
                      ? "bg-[#FFB020] text-[#050609]"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Crash VIX 35 Regime
                </button>
              </div>
            </div>

            {/* P90 / Median / P10 + Projected Creator Fees */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-white/[0.08] bg-[#050609] p-3 font-mono tabular-nums">
                <div className="text-[10px] text-slate-400">p90 Skill Score</div>
                <div
                  id="studio-sim-p90"
                  className="mt-1 text-sm font-bold text-[#00F59B]"
                >
                  {activeSimReport.p90ScoreFormatted}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#050609] p-3 font-mono tabular-nums">
                <div className="text-[10px] text-slate-400">Median Score</div>
                <div
                  id="studio-sim-median"
                  className="mt-1 text-sm font-bold text-white"
                >
                  {activeSimReport.medianScoreFormatted}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#050609] p-3 font-mono tabular-nums">
                <div className="text-[10px] text-slate-400">p10 Score</div>
                <div
                  id="studio-sim-p10"
                  className="mt-1 text-sm font-bold text-slate-300"
                >
                  {activeSimReport.p10ScoreFormatted}
                </div>
              </div>
              <div className="rounded-xl border border-[#FFB020]/30 bg-[#050609] p-3 font-mono tabular-nums">
                <div className="text-[10px] text-slate-400">Est. Creator / Mo</div>
                <div
                  id="studio-sim-creator-monthly"
                  className="mt-1 text-sm font-bold text-[#FFB020]"
                >
                  ${activeSimReport.projectedMonthlyCreatorFeeUsdcFormatted}
                </div>
              </div>
            </div>

            {/* Payout Conservation Invariant Banner */}
            <div
              id="studio-conservation-proof"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#00F59B]/35 bg-[#00F59B]/10 px-3.5 py-2.5 font-mono text-xs tabular-nums"
            >
              <span className="font-semibold text-[#00F59B]">
                {activeSimReport.payoutConservationVerified
                  ? "Verified: Distributed <= Pool (100% Solvency Conserved)"
                  : "Solvency Check Failed"}
              </span>
              <span className="text-slate-200">
                {formatAtomicUsdc(BigInt(activeSimReport.totalDistributedUsdcAtomic))} /{" "}
                {formatAtomicUsdc(BigInt(activeSimReport.roomPoolUsdcAtomic))} USDC
              </span>
            </div>

            {/* Deploy CTA */}
            <ActionButton
              id="studio-deploy-btn"
              variant="emerald"
              size="lg"
              disabled={!compiled.compliance.valid || isDeploying}
              onClick={() => {
                void handleDeployToDevnet();
              }}
              className="w-full"
            >
              {!compiled.compliance.valid
                ? "Resolve Compliance Violation to Deploy"
                : isDeploying
                  ? "Minting Manifest PDA & Delegating ER Shard…"
                  : "Deploy Cartridge to Solana Devnet + Delegate ER Shard"}
            </ActionButton>

            {/* Live Deployed PDA & Explorer Receipt */}
            <div aria-live="polite">
              {deployment ? (
                <div
                  id="studio-deploy-receipt"
                  className="space-y-3 rounded-2xl border border-[#00F59B]/45 bg-[#050609]/95 p-4 font-mono text-xs tabular-nums"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-bold text-[#00F59B]">
                      <LivePulseDot tone="emerald" size="sm" />
                      Cartridge Registered &amp; ER Room Delegated (Devnet)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Tx: {deployment.txSignature.slice(0, 12)}…
                    </span>
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-[#0A0D14] p-3 text-[11px]">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-slate-400">CartridgeManifestAccount PDA:</span>
                      <span translate="no" className="break-all text-slate-100">
                        {deployment.manifestAccountPda}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-slate-400">Delegated RoomShard PDA:</span>
                      <span translate="no" className="break-all text-[#00D4FF]">
                        {deployment.roomShardPda}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-slate-400">creatorFeeVault (50% Split):</span>
                      <span translate="no" className="break-all text-[#FFB020]">
                        {deployment.creatorFeeVaultPda}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-slate-400">ER Room Program ID:</span>
                      <span translate="no" className="break-all text-[#00F59B]">
                        {deployment.erRoomProgramId}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-slate-400">MagicBlock Delegation:</span>
                      <span translate="no" className="break-all text-[#C4B5FD]">
                        {deployment.delegationProgramId}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <ActionButton
                      id="studio-launch-deployed-link"
                      href={deployment.playablePath}
                      variant="emerald"
                      size="sm"
                    >
                      Play Deployed Cartridge
                    </ActionButton>

                    <button
                      id="studio-share-link-btn"
                      type="button"
                      onClick={() => {
                        void handleCopyShareLink(deployment.playablePath);
                      }}
                      className="cursor-pointer rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 font-mono text-xs text-slate-200 hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
                    >
                      {copiedShareLink ? "Share Link Copied!" : "Copy Shareable Play Link"}
                    </button>

                    <a
                      id="studio-explorer-registry-link"
                      href={deployment.registryExplorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-white/12 px-3 py-2 font-mono text-xs text-[#67E8F9] hover:border-[#00D4FF]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
                    >
                      Devnet Registry Explorer ↗
                    </a>
                  </div>
                </div>
              ) : null}
            </div>
          </GlassCard>

          {/* 1-Click <CartridgeDeck/> Wallet SDK Frame Previewer */}
          <GlassCard
            id="studio-wallet-deck-card"
            accent="cyan"
            className="p-4 sm:p-6"
          >
            <WalletDeckPreview
              manifest={compiled.manifest}
              playableHref={defaultPlayableHref}
            />
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
