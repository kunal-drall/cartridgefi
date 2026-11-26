"use client";

import * as React from "react";
import {
  CARTRIDGE_PROGRAM_IDS,
  MAGICBLOCK_CONSTANTS,
} from "@cartridgefi/shared-types";
import {
  ActionButton,
  CartridgeFiLogo,
  GlassCard,
  GlassPill,
  MagicBlockLockup,
  SolanaLockup,
  TabularMetric,
} from "@cartridgefi/ui-system";

interface StackNodeSpec {
  id: string;
  plane: "SOLANA_L1" | "MAGICBLOCK_ER";
  name: string;
  programId: string;
  latencySla: string;
  pdaSeeds: string;
  description: string;
  invariant: string;
}

const STACK_NODES: readonly StackNodeSpec[] = [
  {
    id: "cartridge-registry",
    plane: "SOLANA_L1",
    name: "cartridge-registry",
    programId: CARTRIDGE_PROGRAM_IDS.registry,
    latencySla: "~150ms Alpenglow L1",
    pdaSeeds: '["engine_config"] · ["cartridge", slug_hash]',
    description:
      "Stores immutable CartridgeManifest v2.0 PDAs, allowed Pyth oracle Merkle roots, and creator 50% fee vault bindings.",
    invariant: "Enforces <= 5000 bps creator share and anti-casino compliance flags.",
  },
  {
    id: "cartridge-vault-router",
    plane: "SOLANA_L1",
    name: "cartridge-vault-router",
    programId: CARTRIDGE_PROGRAM_IDS.vaultRouter,
    latencySla: "Atomic L1 Magic Action",
    pdaSeeds: '["room_vault", room_shard] · ["session_envelope", user]',
    description:
      "Custodies bounded room USDC pools on Solana L1 and routes winner payouts into NVDAx, ANTx, SPYx, or USDC via Jupiter V2, Phoenix, and DFlow.",
    invariant: "sum(winnerPayouts) + platformFee + creatorFee <= roomPoolUsdc.",
  },
  {
    id: "cartridge-passport",
    plane: "SOLANA_L1",
    name: "cartridge-passport",
    programId: CARTRIDGE_PROGRAM_IDS.passport,
    latencySla: "Cross-Game Persistent",
    pdaSeeds: '["passport", player_pubkey]',
    description:
      "Portable cross-game player skill passport storing 10^9 fixed-point Market ELO, Sharpe, Brier score, and Earned Stock Vault totals.",
    invariant: "Geo-eligibility bitmask enforces automatic USDC fallback when required.",
  },
  {
    id: "cartridge-er-room",
    plane: "MAGICBLOCK_ER",
    name: "cartridge-er-room",
    programId: CARTRIDGE_PROGRAM_IDS.erRoom,
    latencySla: "10ms Ephemeral Rollup Tick",
    pdaSeeds: '["room_shard", event_id, idx] · ["player_stance", shard, user]',
    description:
      "Unified multi-genre 10ms game state machine powering Borel (#001), Pulse Runner (#002), Vice Bourse (#003), and every Vibe Studio cartridge.",
    invariant: "Session keys can mutate stance weights only—zero vault withdrawal authority.",
  },
  {
    id: "magicblock-delegation",
    plane: "MAGICBLOCK_ER",
    name: "Delegation Program",
    programId: MAGICBLOCK_CONSTANTS.delegationProgramId,
    latencySla: "Zero-Copy L1 <-> ER",
    pdaSeeds: "MagicBlock Canonical Delegation Account",
    description:
      "Delegates Solana L1 RoomShard and PlayerStance PDAs into the 10ms Ephemeral Rollup and commits settled winners back via Magic Actions.",
    invariant: "L1 state ownership deterministically restores upon commit_and_undelegate.",
  },
  {
    id: "magicblock-tee-acl",
    plane: "MAGICBLOCK_ER",
    name: "Private ER TEE Permission",
    programId: MAGICBLOCK_CONSTANTS.permissionProgramId,
    latencySla: "10ms Intel TDX Enclave",
    pdaSeeds: "ACL Enclave Permission Group",
    description:
      "Hardware-encrypts rival position weights inside Intel TDX memory during the 75% Fog-of-War window before unsealing at T - 15s Showdown.",
    invariant: "Eliminates copy-trading, wallet stalking, and front-running during active play.",
  },
  {
    id: "magicblock-vrf",
    plane: "MAGICBLOCK_ER",
    name: "Ephemeral VRF + Crank",
    programId: MAGICBLOCK_CONSTANTS.vrfProgramId,
    latencySla: "< 10ms Verifiable Seed",
    pdaSeeds: `Queue: ${MAGICBLOCK_CONSTANTS.defaultEphemeralVrfQueue.slice(0, 12)}…`,
    description:
      "Provides sub-10ms verifiable randomness strictly for procedural runner geometry, exact score tie-breaks, and free sponsor bonus drops.",
    invariant: "Never used to randomize paid financial principal or house-edge odds.",
  },
];

export function ArchitectureSchematicSection(): React.JSX.Element {
  const [selectedNodeId, setSelectedNodeId] = React.useState<string>("cartridge-er-room");
  const [copiedProgram, setCopiedProgram] = React.useState<boolean>(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const selectedNode =
    STACK_NODES.find((n) => n.id === selectedNodeId) ?? STACK_NODES[3]!;

  const solanaNodes = STACK_NODES.filter((n) => n.plane === "SOLANA_L1");
  const magicblockNodes = STACK_NODES.filter((n) => n.plane === "MAGICBLOCK_ER");

  const handleCopyAddress = async (): Promise<void> => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selectedNode.programId);
      }
    } catch {
      // Clipboard API unavailable in non-HTTPS headless contexts
    }
    setCopiedProgram(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopiedProgram(false), 1800);
  };

  return (
    <>
      <section
        id="engine-stack"
        aria-labelledby="engine-stack-heading"
        className="scroll-mt-24 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24"
      >
        {/* Monumental Oversized Tabular Stat Bar */}
        <div className="grid grid-cols-2 gap-4 rounded-3xl border border-white/10 bg-[#0A0D14] p-6 sm:p-8 lg:grid-cols-4">
          <TabularMetric
            id="stat-er-ticks"
            label="MagicBlock Private ER Ticks"
            value="10ms"
            sublabel="Real-time Intel TDX enclave state"
            tone="emerald"
            size="xl"
          />
          <TabularMetric
            id="stat-solana-finality"
            label="Solana Alpenglow Finality"
            value="~150ms"
            sublabel="Canonical L1 USDC & xStock vaults"
            tone="cyan"
            size="xl"
          />
          <TabularMetric
            id="stat-unified-chains"
            label="Unified Into Solana USDC"
            value="7 Chains"
            sublabel="+ Apple Pay, Google Pay & Passkeys"
            tone="neutral"
            size="xl"
          />
          <TabularMetric
            id="stat-creator-split"
            label="Creator Builder-Fee Split"
            value="50%"
            sublabel="Automated Private Payments routing"
            tone="amber"
            size="xl"
          />
        </div>

        {/* Architecture Heading */}
        <div className="mt-16 max-w-3xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <GlassPill tone="violet" size="xs">
              Verified On-Chain Topology
            </GlassPill>
            <span className="font-mono text-xs text-slate-400">
              Click any program node to inspect PDAs &amp; Devnet Explorer
            </span>
          </div>
          <h2
            id="engine-stack-heading"
            className="font-display text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl text-balance"
          >
            10ms ticks in Private ERs. Finalized on Solana.
          </h2>
        </div>

        {/* Interactive Dual-Plane Solana x MagicBlock Schematic */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-8">
            {/* Plane 1: MagicBlock Real-Time Plane */}
            <GlassCard id="schematic-plane-magicblock" accent="violet" className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                <MagicBlockLockup
                  id="schematic-magicblock-lockup"
                  size="md"
                  clearspace
                  subtitle="Ephemeral Rollup · Private TEE · VRF · Scheduled Crank"
                />
                <GlassPill tone="violet" size="xs">
                  10ms Gameplay Execution Plane
                </GlassPill>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {magicblockNodes.map((node) => {
                  const active = node.id === selectedNode.id;
                  return (
                    <button
                      key={node.id}
                      id={`stack-node-${node.id}`}
                      type="button"
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`cursor-pointer rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] ${
                        active
                          ? "border-[#8B5CF6] bg-[#8B5CF6]/15"
                          : "border-white/10 bg-[#050609]/85 hover:border-white/25"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          translate="no"
                          className="font-mono text-xs font-bold text-white"
                        >
                          {node.name}
                        </span>
                        <span className="font-mono text-[10px] text-[#C4B5FD] tabular-nums">
                          {node.latencySla}
                        </span>
                      </div>
                      <div
                        translate="no"
                        className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums"
                      >
                        {node.programId.slice(0, 12)}…{node.programId.slice(-6)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </GlassCard>

            {/* Bi-Directional Delegation & Magic Actions Conduit SVG */}
            <div
              aria-hidden="true"
              className="flex items-center justify-center gap-4 px-4 font-mono text-[11px] text-slate-400"
            >
              <span className="text-[#C4B5FD]">L1 -&gt; ER State Delegation</span>
              <svg width="120" height="24" viewBox="0 0 120 24" fill="none">
                <path
                  d="M20 4V20M20 20L15 15M20 20L25 15M100 20V4M100 4L95 9M100 4L105 9"
                  stroke="#00F59B"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[#00F59B]">Magic Actions Atomic L1 Settlement</span>
            </div>

            {/* Plane 2: Solana L1 Canonical Settlement Plane */}
            <GlassCard id="schematic-plane-solana" accent="emerald" className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                <SolanaLockup
                  id="schematic-solana-lockup"
                  size="md"
                  clearspace
                  subtitle="Unified Cash Vault · Jupiter V2 xStocks · Phoenix · DFlow"
                />
                <GlassPill tone="emerald" size="xs">
                  Canonical L1 Asset &amp; Identity Plane
                </GlassPill>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {solanaNodes.map((node) => {
                  const active = node.id === selectedNode.id;
                  return (
                    <button
                      key={node.id}
                      id={`stack-node-${node.id}`}
                      type="button"
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`cursor-pointer rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                        active
                          ? "border-[#00F59B] bg-[#00F59B]/15"
                          : "border-white/10 bg-[#050609]/85 hover:border-white/25"
                      }`}
                    >
                      <div
                        translate="no"
                        className="font-mono text-xs font-bold text-white"
                      >
                        {node.name}
                      </div>
                      <div
                        translate="no"
                        className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums"
                      >
                        {node.programId.slice(0, 8)}…{node.programId.slice(-6)}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-[#00F59B]">
                        {node.latencySla}
                      </div>
                    </button>
                  );
                })}
              </div>
            </GlassCard>
          </div>

          {/* Right (4 cols): Live Program & Invariant Inspector */}
          <GlassCard
            id="stack-node-inspector"
            variant="stage"
            accent="cyan"
            className="flex flex-col justify-between p-6 lg:col-span-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <GlassPill
                  tone={selectedNode.plane === "MAGICBLOCK_ER" ? "violet" : "emerald"}
                  size="xs"
                >
                  {selectedNode.plane === "MAGICBLOCK_ER"
                    ? "MagicBlock ER Layer"
                    : "Solana L1 Layer"}
                </GlassPill>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {selectedNode.latencySla}
                </span>
              </div>

              <h3
                translate="no"
                className="mt-3 font-mono text-xl font-bold text-white"
              >
                {selectedNode.name}
              </h3>

              <div className="mt-3 rounded-xl border border-white/10 bg-[#050609] p-3">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Verified Program Address</span>
                  <button
                    id="inspector-copy-program-id"
                    type="button"
                    onClick={() => {
                      void handleCopyAddress();
                    }}
                    className="cursor-pointer font-mono text-[10px] font-semibold text-[#00D4FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
                  >
                    {copiedProgram ? "Copied" : "Copy ID"}
                  </button>
                </div>
                <div
                  translate="no"
                  className="mt-1 break-all font-mono text-xs text-slate-200 tabular-nums"
                >
                  {selectedNode.programId}
                </div>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-slate-300">
                {selectedNode.description}
              </p>

              <div className="mt-4 space-y-2.5 rounded-xl border border-white/[0.08] bg-[#050609]/85 p-3.5 text-xs">
                <div>
                  <span className="font-mono text-[10px] uppercase text-slate-500">
                    PDA Seeds / Queue
                  </span>
                  <div
                    translate="no"
                    className="mt-0.5 font-mono text-[11px] text-[#00D4FF]"
                  >
                    {selectedNode.pdaSeeds}
                  </div>
                </div>
                <div className="border-t border-white/[0.07] pt-2">
                  <span className="font-mono text-[10px] uppercase text-slate-500">
                    Enforced Security Invariant
                  </span>
                  <div className="mt-0.5 text-xs text-slate-300">
                    {selectedNode.invariant}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-2">
              <ActionButton
                id="inspector-solana-explorer-link"
                href={`https://explorer.solana.com/address/${selectedNode.programId}?cluster=devnet`}
                target="_blank"
                variant="ghost"
                size="sm"
                className="w-full"
              >
                Inspect on Solana Devnet Explorer
              </ActionButton>
            </div>
          </GlassCard>
        </div>

        {/* Explicit Skill-Only / Non-Custodial / Zero-Loot-Box Compliance Strip */}
        <div
          id="compliance-safety-strip"
          className="mt-12 rounded-2xl border border-[#00F59B]/20 bg-[#080C14] p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] pb-3">
            <span className="font-mono text-xs font-semibold text-[#00F59B]">
              SKILL-FIRST FINANCIAL PHYSICS · PLAYER SAFETY &amp; REGULATORY DISCIPLINE
            </span>
            <span className="font-mono text-xs text-slate-400">
              FCA / SEC DEP Anti-Gamification Guardrails Enforced On-Chain
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs leading-relaxed text-slate-400">
            <div>
              <strong className="block text-slate-200">Zero Loot Boxes or Paid Spins</strong>
              Manifest compiler hard-blocks roulette, slot, and paid randomizer mechanics. VRF is
              restricted to tie-breaks and free drops.
            </div>
            <div>
              <strong className="block text-slate-200">Non-Custodial Session Isolation</strong>
              Ephemeral session keys expire automatically and cannot transfer vault USDC or equity
              tokens out of your wallet.
            </div>
            <div>
              <strong className="block text-slate-200">Direction-Neutral Skill Scoring</strong>
              Relative-return, drawdown-penalized Sharpe, and Brier calibration reward forecasting
              precision in bull and bear regimes alike.
            </div>
            <div>
              <strong className="block text-slate-200">Geo-Safe Canonical USDC Fallback</strong>
              Tokenized stock prize claims verify passport eligibility bits and settle cleanly in
              Solana USDC wherever equities are restricted.
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 7: GLOBAL FOOTER WITH 1.5X CLEARSPACE OFFICIAL LOCKUPS */}
      <footer
        id="site-footer"
        className="border-t border-white/[0.08] bg-[#050609] py-14"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <CartridgeFiLogo id="footer-brand-logo" size="lg" showTag />
              <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
                The universal Entertainment Finance Game Engine on Solana and MagicBlock Private
                Ephemeral Rollups—proven live by Borel (Game #001) and Pulse Runner (Game #002).
              </p>

              {/* Official Co-Branding Trust Bar with strict 1.5x clearspace */}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <div className="rounded-xl border border-white/10 bg-[#0A0D14]">
                  <SolanaLockup
                    id="footer-solana-lockup"
                    size="sm"
                    clearspace
                    subtitle="Canonical L1 Settlement"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0A0D14]">
                  <MagicBlockLockup
                    id="footer-magicblock-lockup"
                    size="sm"
                    clearspace
                    subtitle="10ms Private ER Engine"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
              <div>
                <h3 className="font-display text-sm font-bold text-white">
                  Playable Cartridges
                </h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-400">
                  <li>
                    <a
                      id="footer-link-borel"
                      href="/play/borel"
                      className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                    >
                      Borel (#001 — Game-Day Arena)
                    </a>
                  </li>
                  <li>
                    <a
                      id="footer-link-pulse-runner"
                      href="/play/pulse-runner"
                      className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                    >
                      Pulse Runner (#002 — 3-Lane)
                    </a>
                  </li>
                  <li>
                    <a
                      id="footer-link-studio"
                      href="/studio"
                      className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                    >
                      Web Vibe-Coding Studio
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-display text-sm font-bold text-white">
                  Engine &amp; SDK
                </h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-400">
                  <li>
                    <a
                      id="footer-link-wallet-bento"
                      href="#wallet-bento"
                      className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                    >
                      7-Chain Unified Cash
                    </a>
                  </li>
                  <li>
                    <a
                      id="footer-link-creator-studio"
                      href="#creator-studio"
                      className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                    >
                      50% Creator Split &amp; MCP
                    </a>
                  </li>
                  <li>
                    <a
                      id="footer-link-engine-stack"
                      href="#engine-stack"
                      className="hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                    >
                      Architecture Schematic
                    </a>
                  </li>
                </ul>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <h3 className="font-display text-sm font-bold text-white">
                  Devnet Programs
                </h3>
                <ul className="mt-3 space-y-2 font-mono text-[11px] text-slate-400 tabular-nums">
                  {[
                    { label: "Registry", addr: CARTRIDGE_PROGRAM_IDS.registry },
                    { label: "ER Room", addr: CARTRIDGE_PROGRAM_IDS.erRoom },
                    { label: "Vault Router", addr: CARTRIDGE_PROGRAM_IDS.vaultRouter },
                    { label: "Passport", addr: CARTRIDGE_PROGRAM_IDS.passport },
                  ].map((prog) => (
                    <li key={prog.label}>
                      <a
                        id={`footer-explorer-${prog.label.toLowerCase().replace(/\s+/g, "-")}`}
                        href={`https://explorer.solana.com/address/${prog.addr}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#00F59B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
                      >
                        {prog.label}: {prog.addr.slice(0, 6)}…{prog.addr.slice(-4)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-6 text-xs text-slate-500">
            <span>
              CartridgeFi Protocol v2.0 · Non-custodial skill-based financial game infrastructure.
            </span>
            <span className="font-mono tabular-nums">
              Solana Devnet · MagicBlock Private ER (ACLseoPoyC…2XQnp1)
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
