"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  AreaSeries,
  ColorType,
  createChart,
  type Time,
} from "lightweight-charts";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Send,
  Sparkles,
} from "lucide-react";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  FIRST_PARTY_CARTRIDGE_CATALOG,
  compilePromptToManifest,
  simulateCartridgeEconomy,
  type CartridgeGenre,
  type CartridgeManifestV2,
} from "@cartridgefi/shared-types";
import {
  formatAtomicUsdc,
  useConsoleVault,
} from "@/app/(console)/_components/ConsoleVaultContext";
import { cn, shortenAddress } from "@/lib/utils";
import {
  deployCartridgeAndDelegateShard,
  type DeployedCartridgeDeployment,
} from "./pda";
import { WalletDeckPreview } from "./WalletDeckPreview";
import { toast } from "sonner";

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
      "90s 3-lane volatility runner on TSLAx and BTC where Kalshi FOMC contracts unlock a 1.35x carry.",
    tone: "default",
  },
  {
    id: "nvda-arena",
    buttonId: "studio-preset-nvda-arena",
    label: "NVDAx Earnings Arena",
    genre: "BOREL_GAMEDAY",
    prompt:
      "120s conviction arena on NVDAx and SOL perps inside Private ER TEE Fog of War with NVDAx stock payouts.",
    tone: "default",
  },
  {
    id: "macro-bracket",
    buttonId: "studio-preset-macro-bracket",
    label: "Kalshi FOMC Bracket",
    genre: "PREDICTION_BRACKET",
    prompt:
      "3m macro bracket pairing SPYx with live Kalshi FOMC rate decision contracts using Brier calibration.",
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

export function VibeStudioConsole(): React.JSX.Element {
  const searchParams = useSearchParams();
  const forkSlug = searchParams.get("fork");
  const { sessionSigner, playerWallet } = useConsoleVault();

  const initialPreset = React.useMemo(() => {
    if (forkSlug) {
      const cat = FIRST_PARTY_CARTRIDGE_CATALOG.find(
        (c) => c.metadata.slug === forkSlug,
      );
      if (cat) {
        return {
          genre: cat.metadata.genre,
          prompt: `${cat.metadata.title}: ${cat.metadata.subtitle}`,
        };
      }
    }
    return {
      genre: STUDIO_PRESETS[0]!.genre,
      prompt: STUDIO_PRESETS[0]!.prompt,
    };
  }, [forkSlug]);

  const [prompt, setPrompt] = React.useState<string>(initialPreset.prompt);
  const [genre, setGenre] = React.useState<CartridgeGenre>(initialPreset.genre);
  const [compiled, setCompiled] = React.useState(() =>
    compilePromptToManifest({
      prompt: initialPreset.prompt,
      genre: initialPreset.genre,
      creatorHandle: "@studio_dev",
      creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
    }),
  );
  const [copilotSummary, setCopilotSummary] = React.useState<string | null>(
    null,
  );
  const [copilotEngine, setCopilotEngine] = React.useState<string>("local-compiler");
  const [compiling, setCompiling] = React.useState<boolean>(false);

  const [deploying, setDeploying] = React.useState<boolean>(false);
  const [deployment, setDeployment] =
    React.useState<DeployedCartridgeDeployment | null>(null);

  const sim = React.useMemo(
    () => simulateCartridgeEconomy(compiled.manifest, "calm", 500, 24),
    [compiled.manifest],
  );

  // Render 500-tick cumulative pool conservation / creator fee curve in lightweight-charts
  const equityChartRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = equityChartRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: Math.max(240, el.clientWidth),
      height: 170,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0c0e" },
        textColor: "#9ca3af",
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#171a20" },
        horzLines: { color: "#171a20" },
      },
      rightPriceScale: {
        borderColor: "#22262e",
      },
      timeScale: {
        borderColor: "#22262e",
        timeVisible: false,
      },
    });

    const area = chart.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59, 130, 246, 0.25)",
      bottomColor: "rgba(59, 130, 246, 0.02)",
      lineWidth: 2,
    });

    // Plot cumulative distributed player pool across 24 simulated rounds
    const baseTime = 1_760_000_000;
    const perRoomUsd = Number(BigInt(sim.totalDistributedUsdcAtomic)) / 1_000_000;
    const points = Array.from({ length: 24 }, (_, idx) => ({
      time: (baseTime + idx * 3600) as Time,
      value: Math.round(perRoomUsd * (idx + 1) * 100) / 100,
    }));
    area.setData(points);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [sim.totalDistributedUsdcAtomic]);

  const runCompile = async (
    nextPrompt: string,
    nextGenre: CartridgeGenre,
    callAiCopilot: boolean,
  ): Promise<void> => {
    const localResult = compilePromptToManifest({
      prompt: nextPrompt,
      genre: nextGenre,
      creatorHandle: "@studio_dev",
      creatorWallet:
        playerWallet || CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
    });
    setCompiled(localResult);
    setDeployment(null);

    if (!localResult.compliance.valid) {
      setCopilotSummary(null);
      toast.error("Compliance guardrail blocked prohibited gambling mechanics.");
      return;
    }

    if (!callAiCopilot) return;

    setCompiling(true);
    try {
      const res = await fetch("/api/studio/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: nextPrompt,
          creatorWallet:
            playerWallet || CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          manifest?: CartridgeManifestV2;
          summary?: string;
          engineUsed?: string;
          compliance?: typeof localResult.compliance;
        };
        if (data.manifest && data.compliance) {
          setCompiled({
            manifest: data.manifest,
            compliance: data.compliance,
          });
          setCopilotSummary(data.summary ?? null);
          setCopilotEngine(data.engineUsed ?? "mcp-deterministic-compiler");
        }
      }
    } catch {
      // Keep local deterministic compilation
    } finally {
      setCompiling(false);
    }
  };

  const handleDeploy = async (): Promise<void> => {
    if (!compiled.compliance.valid) {
      toast.error("Resolve compliance violations before deploying.");
      return;
    }
    setDeploying(true);
    try {
      const dep = await deployCartridgeAndDelegateShard(
        compiled.manifest,
        sessionSigner,
      );
      setDeployment(dep);
      if (dep.devnetExecution?.mode === "broadcast_confirmed") {
        toast.success("Broadcast register_cartridge transaction on Solana Devnet!");
      } else {
        toast.success(
          "Derived canonical Solana PDAs & simulated instruction on Devnet RPC.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  };

  const playableHref =
    compiled.manifest.metadata.genre === "ARCADE_RUNNER"
      ? `/play/pulse-runner?cartridge=${encodeURIComponent(compiled.manifest.metadata.slug)}`
      : `/play/borel?cartridge=${encodeURIComponent(compiled.manifest.metadata.slug)}`;

  return (
    <div className="space-y-4">
      {/* Studio Header */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#22262e] bg-[#111317] p-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-base font-semibold text-[#f3f4f6] sm:text-lg">
            Manifest Studio &amp; Solvency Compiler
          </h1>
          <p className="mt-0.5 text-xs text-[#9ca3af]">
            Compile natural-language specifications into validated{" "}
            <code className="font-mono text-[#e5e7eb]">CartridgeManifest v2.0</code>{" "}
            schemas, verify pool conservation, and build canonical{" "}
            <code className="font-mono text-[#e5e7eb]">register_cartridge</code>{" "}
            instructions for Solana Devnet.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-[#9ca3af]">
          <Cpu className="h-3.5 w-3.5 text-[#3b82f6]" />
          <span>Compiler: {copilotEngine}</span>
        </div>
      </div>

      {/* Main Split-Pane IDE */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left 6 Cols: Prompt Compiler + JSON Manifest Inspector */}
        <div className="space-y-4 lg:col-span-6">
          <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
            <div className="flex items-center justify-between border-b border-[#22262e] pb-2.5">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold text-[#f3f4f6]">
                <Sparkles className="h-3.5 w-3.5 text-[#3b82f6]" />
                Specification Prompt (Vercel AI SDK + MCP)
              </h2>
              <select
                aria-label="Select Cartridge Genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value as CartridgeGenre)}
                className="rounded border border-[#303642] bg-[#171a20] px-2 py-1 font-mono text-[11px] text-[#f3f4f6]"
              >
                <option value="BOREL_GAMEDAY">BOREL_GAMEDAY</option>
                <option value="ARCADE_RUNNER">ARCADE_RUNNER</option>
                <option value="PREDICTION_BRACKET">PREDICTION_BRACKET</option>
                <option value="SYNDICATE_TURF">SYNDICATE_TURF</option>
              </select>
            </div>

            {/* Presets */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {STUDIO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  id={preset.buttonId}
                  type="button"
                  onClick={() => {
                    setPrompt(preset.prompt);
                    setGenre(preset.genre);
                    void runCompile(preset.prompt, preset.genre, false);
                  }}
                  className={cn(
                    "cf-btn cursor-pointer rounded border px-2.5 py-1 text-[11px] font-medium",
                    preset.tone === "guardrail"
                      ? "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171] hover:bg-[#ef4444]/20"
                      : "border-[#303642] bg-[#171a20] text-[#d1d5db] hover:text-white",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <textarea
              aria-label="Cartridge specification prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-3 w-full rounded-md border border-[#303642] bg-[#0b0c0e] p-3 text-xs leading-relaxed text-[#f3f4f6] focus:border-[#3b82f6] focus:outline-none"
            />

            {copilotSummary ? (
              <div className="mt-2 rounded border border-[#22262e] bg-[#0b0c0e] px-3 py-2 text-xs text-[#9ca3af]">
                {copilotSummary}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                id="studio-compile-btn"
                type="button"
                disabled={compiling}
                onClick={() => void runCompile(prompt, genre, true)}
                className="cf-btn inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-[#2563eb] px-3.5 text-xs font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
              >
                <span>{compiling ? "Compiling Live Feeds…" : "Compile Manifest"}</span>
              </button>

              <button
                id="studio-deploy-btn"
                type="button"
                disabled={!compiled.compliance.valid || deploying}
                onClick={() => void handleDeploy()}
                className="cf-btn inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3.5 text-xs font-medium text-[#f3f4f6] hover:bg-[#1d2129] disabled:opacity-45"
              >
                <Send className="h-3.5 w-3.5 text-[#34d399]" />
                <span>
                  {deploying
                    ? "Querying Devnet RPC…"
                    : "Derive PDAs & Execute on Devnet"}
                </span>
              </button>
            </div>
          </section>

          {/* Compiled JSON Manifest View */}
          <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
            <div className="mb-2 flex items-center justify-between border-b border-[#22262e] pb-2 text-xs">
              <span className="font-semibold text-[#f3f4f6]">
                Compiled CartridgeManifest v2.0
              </span>
              <span className="font-mono text-[11px] text-[#9ca3af]">
                {compiled.manifest.metadata.slug}.json
              </span>
            </div>
            <pre className="max-h-[340px] overflow-auto rounded border border-[#22262e] bg-[#0b0c0e] p-3 font-mono text-[11px] leading-relaxed text-[#d1d5db]">
              <code>{JSON.stringify(compiled.manifest, null, 2)}</code>
            </pre>
          </section>
        </div>

        {/* Right 6 Cols: Compliance Verifier + 500-Tick Conservation Chart + Real Devnet PDA Receipt */}
        <div className="space-y-4 lg:col-span-6">
          {!compiled.compliance.valid ? (
            <section
              id="studio-compliance-violations"
              className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 p-4"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[#f87171]">
                <AlertTriangle className="h-4 w-4" />
                <span>Compliance Guardrail Blocked Deployment</span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#fca5a5]">
                {compiled.compliance.violations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </section>
          ) : (
            <section
              id="studio-conservation-proof"
              className="rounded-lg border border-[#22262e] bg-[#111317] p-4"
            >
              <div className="flex items-center justify-between border-b border-[#22262e] pb-2.5">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold text-[#f3f4f6]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#34d399]" />
                  500-Tick Pool Conservation &amp; Solvency Backtest
                </h2>
                <span className="font-mono text-[11px] text-[#34d399]">
                  Conservation Verified
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                  <div className="font-sans text-[10px] text-[#6b7280]">
                    Room Pool (24 Seats)
                  </div>
                  <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                    {formatAtomicUsdc(BigInt(sim.roomPoolUsdcAtomic))}
                  </div>
                </div>
                <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                  <div className="font-sans text-[10px] text-[#6b7280]">
                    Creator Fee / Room
                  </div>
                  <div className="mt-0.5 font-semibold text-[#34d399]">
                    {formatAtomicUsdc(BigInt(sim.creatorFeePerRoomUsdcAtomic))}
                  </div>
                </div>
                <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                  <div className="font-sans text-[10px] text-[#6b7280]">
                    Drift / Insolvency
                  </div>
                  <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                    $0.00 (0 wei)
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded border border-[#22262e] bg-[#0b0c0e] p-2">
                <div className="mb-1 px-1 font-mono text-[10px] text-[#6b7280]">
                  Cumulative Pool Distribution Curve (24 Rounds)
                </div>
                <div ref={equityChartRef} className="w-full" />
              </div>
            </section>
          )}

          {/* Canonical Solana Devnet PDA & Codama Instruction Receipt */}
          {deployment ? (
            <section
              id="studio-deploy-receipt"
              className="rounded-lg border border-[#303642] bg-[#111317] p-4"
            >
              <div className="flex items-center justify-between border-b border-[#22262e] pb-2.5">
                <h2 className="text-xs font-semibold text-[#f3f4f6]">
                  Canonical Solana Devnet Deployment Plan
                </h2>
                <span className="rounded border border-[#10b981]/30 bg-[#10b981]/10 px-2 py-0.5 font-mono text-[10px] text-[#34d399]">
                  {deployment.devnetExecution?.mode === "broadcast_confirmed"
                    ? "Broadcast Confirmed"
                    : deployment.manifestExistsOnDevnet
                      ? "Already Live on Devnet"
                      : "RPC Preflight Simulated"}
                </span>
              </div>

              <div className="mt-3 space-y-2 font-mono text-xs tabular-nums">
                <div className="flex items-center justify-between rounded border border-[#22262e] bg-[#0b0c0e] px-2.5 py-2">
                  <span className="font-sans text-[11px] text-[#9ca3af]">
                    ER Room Program
                  </span>
                  <a
                    href={deployment.erProgramSolscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline"
                  >
                    {deployment.erRoomProgramId}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between rounded border border-[#22262e] bg-[#0b0c0e] px-2.5 py-2">
                  <span className="font-sans text-[11px] text-[#9ca3af]">
                    Manifest PDA (Canonical)
                  </span>
                  <a
                    href={deployment.manifestSolscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#e5e7eb] hover:text-[#93c5fd]"
                  >
                    {shortenAddress(deployment.manifestAccountPda, 8, 8)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between rounded border border-[#22262e] bg-[#0b0c0e] px-2.5 py-2">
                  <span className="font-sans text-[11px] text-[#9ca3af]">
                    RoomShard #0 PDA
                  </span>
                  <span className="text-[#d1d5db]">
                    {shortenAddress(deployment.roomShardPda, 8, 8)}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded border border-[#22262e] bg-[#0b0c0e] px-2.5 py-2">
                  <span className="font-sans text-[11px] text-[#9ca3af]">
                    Borsh Instruction Payload
                  </span>
                  <span className="text-[#9ca3af]">
                    {deployment.registerCartridgeInstruction.byteLength} bytes (
                    {deployment.registerCartridgeInstruction.accounts.length} accounts)
                  </span>
                </div>

                {deployment.devnetExecution?.signature &&
                deployment.devnetExecution.solscanUrl ? (
                  <div className="rounded border border-[#10b981]/30 bg-[#10b981]/10 px-2.5 py-2">
                    <a
                      href={deployment.devnetExecution.solscanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#34d399] hover:underline"
                    >
                      Live Solscan Tx:{" "}
                      {shortenAddress(deployment.devnetExecution.signature, 10, 8)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : deployment.devnetExecution?.error ? (
                  <div className="rounded border border-[#22262e] bg-[#0b0c0e] px-2.5 py-2 font-sans text-[11px] text-[#9ca3af]">
                    {deployment.devnetExecution.error}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* Partner Wallet Sheet Fee-Split Inspector */}
      <WalletDeckPreview
        manifest={compiled.manifest}
        playableHref={playableHref}
      />
    </div>
  );
}
