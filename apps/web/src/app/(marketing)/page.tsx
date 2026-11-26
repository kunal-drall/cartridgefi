import * as React from "react";
import {
  ActionButton,
  CopyTerminalPill,
  MagicBlockLockup,
  Navbar,
  SolanaLockup,
} from "@cartridgefi/ui-system";
import { ArchitectureSchematicSection } from "./_components/ArchitectureSchematicSection";
import { BorelSpotlightSection } from "./_components/BorelSpotlightSection";
import { CartridgeWallSection } from "./_components/CartridgeWallSection";
import { CreatorStudioSection } from "./_components/CreatorStudioSection";
import { HeroConsoleStage } from "./_components/HeroConsoleStage";
import { UI_SYSTEM_TAILWIND_SAFELIST } from "./_components/ui-safelist";
import { WalletBentoSection } from "./_components/WalletBentoSection";

// Reference safelist count at module scope so Tailwind v4 scans ui-system utility classes
void UI_SYSTEM_TAILWIND_SAFELIST.length;

export default function CartridgeFiLandingPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[#050609] text-slate-50">
      {/* Accessible Skip Link */}
      <a
        id="skip-to-main-content"
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-xl focus:bg-[#00F59B] focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:font-bold focus:text-[#050609]"
      >
        Skip to main content
      </a>

      {/* Section 0: Sticky Liquid Glass Header */}
      <Navbar activeErRooms={42} tickLatencyMs={10} />

      <main id="main-content">
        {/* Section 1: Dual-Mode Hero + Interactive Console & 7-Chain Vault Stage */}
        <section
          id="hero-section"
          aria-labelledby="hero-display-headline"
          className="relative mx-auto max-w-7xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14 lg:pt-16 lg:pb-24"
        >
          {/* Subtle architectural top specular rule — zero purple-blue blobs or stock grids */}
          <div className="flex flex-col items-start">
            {/* Above-the-Fold Co-Branded Solana x MagicBlock Architecture Trust Pill */}
            <div
              id="hero-architecture-trust-pill"
              className="cf-glass group inline-flex flex-wrap items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-white/20"
            >
              <span className="inline-flex items-center gap-1">
                <SolanaLockup id="hero-solana-lockup" size="sm" clearspace={false} className="px-1.5 py-0.5" />
                <span className="text-slate-300">Settled on Solana</span>
              </span>

              <span className="px-1 text-slate-600" aria-hidden="true">
                ·
              </span>

              <span className="inline-flex items-center gap-1">
                <MagicBlockLockup
                  id="hero-magicblock-lockup"
                  size="sm"
                  clearspace={false}
                  className="px-1.5 py-0.5"
                />
                <span className="text-slate-300">10ms Real-Time Engine by MagicBlock</span>
              </span>

              <span className="ml-1 hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#050609]/85 px-2.5 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums">
                <span className="text-[#00D4FF]">Alpenglow ~150ms</span>
                <span className="text-slate-600" aria-hidden="true">
                  |
                </span>
                <span className="text-[#00F59B]">Private ER 10ms</span>
              </span>
            </div>

            {/* Single Canonical <h1> on Page */}
            <h1
              id="hero-display-headline"
              className="mt-6 max-w-4xl font-display text-4xl font-bold tracking-[-0.035em] text-white sm:text-6xl lg:text-[72px] text-balance"
            >
              the game engine for real markets.
            </h1>

            <p className="mt-5 max-w-[700px] text-base leading-relaxed text-slate-400 sm:text-lg">
              Technical Entertainment Finance Protocol (
              <span className="font-mono text-slate-200">Infra + DeFi + Privacy</span>) uniting
              MagicBlock Ephemeral Rollups, Intel TDX Private ERs, VRF, and eSPL private fee
              routing into{" "}
              <span className="font-mono text-slate-200 tabular-nums">10ms</span> non-custodial
              state machines—verified live on Solana Devnet via{" "}
              <strong className="font-semibold text-white">
                Borel: Reference Harness #001 (Protocol Integration Demo)
              </strong>
              .
            </p>

            {/* Prominent MagicBlock Blitz v10 Protocol Inspector Banner */}
            <a
              id="hero-protocol-inspector-banner"
              href="/protocol"
              className="mt-5 inline-flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-[#00F59B]/35 bg-[#00F59B]/[0.08] px-3.5 py-2 font-mono text-xs text-slate-100 transition-colors hover:border-[#00F59B]/65 hover:bg-[#00F59B]/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            >
              <span className="rounded-md bg-[#00F59B] px-1.5 py-0.5 text-[10px] font-bold text-[#050609]">
                LIVE DEVNET PROOF
              </span>
              <span className="font-semibold text-white">
                Open Protocol Inspector &amp; Live Execution Console (/protocol)
              </span>
              <span className="text-[#00F59B]" aria-hidden="true">
                -&gt;
              </span>
            </a>

            {/* Primary & Secondary CTA Cluster */}
            <div className="mt-6 flex w-full max-w-full min-w-0 flex-wrap items-start gap-3.5">
              <div className="flex w-full sm:w-auto max-w-full min-w-0 flex-col gap-1.5">
                <ActionButton
                  id="hero-primary-protocol-console"
                  href="/protocol"
                  variant="emerald"
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <span>Protocol Execution Console</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M3.5 8H12.5M12.5 8L8.5 4M12.5 8L8.5 12"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </ActionButton>
                <span className="pl-1 font-mono text-[11px] leading-snug text-slate-400 break-words">
                  4 Live Devnet Programs · Delegations &amp; VRF · Private eSPL Fees
                </span>
              </div>

              <div className="flex w-full sm:w-auto max-w-full min-w-0 flex-col gap-1.5">
                <ActionButton
                  id="hero-primary-play-borel"
                  href="/play/borel"
                  variant="glass"
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <span>Reference Harness #001 (Borel)</span>
                </ActionButton>
                <span className="pl-1 font-mono text-[11px] leading-snug text-slate-400 break-words">
                  Protocol Integration Demo · Session Keys · TEE Fog-of-War
                </span>
              </div>

              <CopyTerminalPill
                id="hero-copy-skill-cmd"
                command="npx skills add cartridgefi/skill"
                badge="SKILL.MD + MCP"
                helperText="Copy for Claude Code, Cursor, or Codex"
              />
            </div>
          </div>

          {/* Interactive Dual-Device Console & 7-Chain Vault Stage */}
          <HeroConsoleStage />
        </section>

        {/* Section 2: Flagship Spotlight — BOREL (#001) */}
        <BorelSpotlightSection />

        {/* Section 3: Living Wall of Cartridges */}
        <CartridgeWallSection />

        {/* Section 4: Unified 7-Chain Wallet & Liquidity Bento (#wallet-bento) */}
        <WalletBentoSection />

        {/* Section 5: Build With Prompts, Agents, or Code */}
        <CreatorStudioSection />

        {/* Section 6 & 7: Monumental Telemetry, Solana x MagicBlock Architecture Schematic (#engine-stack), Compliance Strip & Footer */}
        <ArchitectureSchematicSection />
      </main>
    </div>
  );
}
