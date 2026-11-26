"use client";

import * as React from "react";
import {
  FP_SCALE,
  MAGICBLOCK_CONSTANTS,
  SOLANA_CANONICAL_MINTS,
  formatScaledBigInt,
} from "@cartridgefi/shared-types";
import { ActionButton, GlassCard, GlassPill } from "@cartridgefi/ui-system";

type SpotlightClaimAsset = "NVDAx" | "ANTx" | "SPYx" | "USDC";

interface ClaimAssetQuote {
  symbol: SpotlightClaimAsset;
  name: string;
  mint: string;
  /** Deterministic reference price in 10^9 fixed-point USD for exact bigint share output. */
  unitPriceScaled: bigint;
  routeLabel: string;
}

const PRIZE_POOL_WIN_SCALED = 142_500_000_000n; // $142.50 USDC scaled by 10^9

const CLAIM_ASSET_QUOTES: readonly ClaimAssetQuote[] = [
  {
    symbol: "NVDAx",
    name: "NVIDIA Tokenized Equity",
    mint: SOLANA_CANONICAL_MINTS.NVDAx,
    unitPriceScaled: 146_820_000_000n,
    routeLabel: "Magic Actions -> Jupiter V2 -> Earned Stock Vault",
  },
  {
    symbol: "ANTx",
    name: "Anthropic Pre-IPO / Index Basket",
    mint: SOLANA_CANONICAL_MINTS.ANTx,
    unitPriceScaled: 62_000_000_000n,
    routeLabel: "Magic Actions -> Jupiter V2 -> Earned Stock Vault",
  },
  {
    symbol: "SPYx",
    name: "S&P 500 Tokenized ETF",
    mint: SOLANA_CANONICAL_MINTS.SPYx,
    unitPriceScaled: 595_000_000_000n,
    routeLabel: "Magic Actions -> Jupiter V2 -> Earned Stock Vault",
  },
  {
    symbol: "USDC",
    name: "Canonical Solana USD Coin",
    mint: SOLANA_CANONICAL_MINTS.USDC,
    unitPriceScaled: 1_000_000_000n,
    routeLabel: "Direct Atomic L1 Vault Transfer (Universal Geo Fallback)",
  },
];

export function BorelSpotlightSection(): React.JSX.Element {
  const [selectedAsset, setSelectedAsset] = React.useState<SpotlightClaimAsset>("NVDAx");

  const activeQuote =
    CLAIM_ASSET_QUOTES.find((q) => q.symbol === selectedAsset) ?? CLAIM_ASSET_QUOTES[0]!;

  // Exact bigint division: sharesScaled = (prizeScaled * 10^9) / unitPriceScaled
  const sharesOutScaled = (PRIZE_POOL_WIN_SCALED * FP_SCALE) / activeQuote.unitPriceScaled;
  const sharesFormatted = formatScaledBigInt(
    sharesOutScaled,
    selectedAsset === "USDC" ? 2 : 4,
  );

  return (
    <section
      id="borel-spotlight"
      aria-labelledby="borel-spotlight-heading"
      className="scroll-mt-24 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24"
    >
      <div className="max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <GlassPill tone="emerald" size="xs">
            First-Party Flagship · Game #001
          </GlassPill>
          <span className="font-mono text-xs text-slate-400">
            Solana RFS #11 + RFS #3 + RFS #7 Live Execution
          </span>
        </div>
        <h2
          id="borel-spotlight-heading"
          className="font-display text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl text-balance"
        >
          Meet Borel: Game-Day Mode for stocks, perps, and predictions.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
          Named after Émile Borel, founder of strategic game theory. Borel unites real-time Kalshi
          prediction catalysts, Solana perpetuals, and tokenized equities inside 60-second to
          Game-Day arenas where thesis skill—never wallet size or copy-trade bots—wins the pool.
        </p>
      </div>

      {/* Asymmetric 12-Col Architecture: 7-col Dual Pillar Stack + 5-col Interactive Stock Claim Simulator */}
      <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          {/* Pillar 1: Unified Game-Day Screen (RFS #11) */}
          <GlassCard id="borel-pillar-gameday" accent="emerald" className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <GlassPill tone="emerald" size="xs">
                RFS #11 · Unified Game-Day Screen
              </GlassPill>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                Formula: S_rel (Direction-Neutral)
              </span>
            </div>
            <h3 className="mt-3 font-display text-xl font-bold text-white">
              One arena uniting Kalshi outcomes, Phoenix perps, and xStocks.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Express multi-leg macro or earnings conviction in a single move—allocate across{" "}
              <code className="font-mono text-slate-200">NVDAx</code>,{" "}
              <code className="font-mono text-slate-200">SPYx</code>, and{" "}
              <code className="font-mono text-slate-200">SOL-PERP</code> while calling a binary{" "}
              <code className="font-mono text-slate-200">DFLOW_KALSHI</code> catalyst for up to a{" "}
              <span className="font-mono text-[#00F59B] tabular-nums">1.35x</span> score carry.
            </p>

            {/* Schematic Venue Vector Strip */}
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {[
                {
                  venue: "JUPITER_XSTOCKS",
                  instruments: "NVDAx · SPYx · ANTx",
                  role: "Spot Tokenized Equities",
                },
                {
                  venue: "PHOENIX_PERP",
                  instruments: "SOL-PERP · BTC-PERP",
                  role: "Sub-Second CLOB Perps",
                },
                {
                  venue: "DFLOW_KALSHI",
                  instruments: "FOMC · Earnings Gates",
                  role: "SPL Outcome Multipliers",
                },
              ].map((leg) => (
                <div
                  key={leg.venue}
                  className="rounded-xl border border-white/[0.08] bg-[#050609]/85 p-3"
                >
                  <div translate="no" className="font-mono text-[10px] font-semibold text-[#00D4FF]">
                    {leg.venue}
                  </div>
                  <div
                    translate="no"
                    className="mt-1 font-mono text-xs font-semibold text-slate-100"
                  >
                    {leg.instruments}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{leg.role}</div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Pillar 2: MagicBlock Private ER TEE Fog-of-War */}
          <GlassCard id="borel-pillar-tee-fog" accent="violet" className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <GlassPill tone="violet" size="xs">
                Intel TDX Enclave · Anti-Copy-Trading
              </GlassPill>
              <span translate="no" className="font-mono text-xs text-slate-400">
                {MAGICBLOCK_CONSTANTS.permissionProgramId.slice(0, 10)}…
              </span>
            </div>
            <h3 className="mt-3 font-display text-xl font-bold text-white">
              75% hardware-encrypted Fog of War. 15-second live Showdown unseal.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              On public chains, sharks and MEV bots copy-trade top wallets in milliseconds. Inside
              MagicBlock Private Ephemeral Rollups, rival conviction weights stay sealed inside an
              Intel TDX enclave until the final 15-second Showdown unseals every card on screen.
            </p>

            {/* 60s Round Phase Timeline Schematic */}
            <div className="mt-4 rounded-xl border border-white/[0.08] bg-[#050609]/90 p-3.5">
              <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                <span className="text-[#C4B5FD]">00s — 45s · TEE FOG OF WAR (75%)</span>
                <span className="text-[#FFB020]">45s — 60s · SHOWDOWN (25%)</span>
              </div>
              <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full w-3/4 bg-[#8B5CF6]" />
                <div className="h-full w-1/4 bg-[#FFB020]" />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-slate-400 tabular-nums">
                <span>Public sees rank delta only (+14.2 bps)</span>
                <span className="text-[#00F59B]">60s -&gt; Atomic Solana L1 Payout + VRF Drop</span>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Pillar 3: Interactive Earned Stock Vault Claim Simulator (RFS #3) */}
        <GlassCard
          id="borel-pillar-earned-stock"
          accent="amber"
          className="flex flex-col justify-between p-6 lg:col-span-5"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <GlassPill tone="amber" size="xs">
                RFS #3 · Win the Event, Own the Stock
              </GlassPill>
              <span className="font-mono text-xs text-slate-400">Non-Custodial</span>
            </div>

            <h3 className="mt-3 font-display text-xl font-bold text-white">
              Claim arena winnings directly as real tokenized equities.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Turn market conviction into long-term equity ownership. Choose your payout asset at
              settlement—Magic Actions atomically routes your Shapley prize share into fractional{" "}
              <code className="font-mono text-slate-200">xStocks</code> or canonical{" "}
              <code className="font-mono text-slate-200">USDC</code>.
            </p>

            {/* Interactive Claim Asset Switcher */}
            <div className="mt-5 rounded-2xl border border-white/10 bg-[#050609]/95 p-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Simulated #1 Shapley Podium Win</span>
                <span className="font-mono font-semibold text-white tabular-nums">
                  $142.50 USDC Value
                </span>
              </div>

              <div
                role="group"
                aria-label="Select prize payout asset"
                className="mt-3 grid grid-cols-4 gap-1.5"
              >
                {CLAIM_ASSET_QUOTES.map((item) => {
                  const active = selectedAsset === item.symbol;
                  return (
                    <button
                      key={item.symbol}
                      id={`claim-asset-${item.symbol}`}
                      type="button"
                      onClick={() => setSelectedAsset(item.symbol)}
                      className={`cursor-pointer rounded-xl border py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                        active
                          ? "border-[#00F59B] bg-[#00F59B]/15 text-[#00F59B]"
                          : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                      }`}
                    >
                      {item.symbol}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-white/[0.08] bg-[#0B0F1A] p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-slate-400">Vault Settlement Output</span>
                  <span translate="no" className="font-mono text-[10px] text-slate-500">
                    Mint: {activeQuote.mint.slice(0, 6)}…{activeQuote.mint.slice(-4)}
                  </span>
                </div>
                <div
                  id="borel-claim-preview-output"
                  className="mt-1.5 font-mono text-2xl font-bold text-[#00F59B] tabular-nums"
                >
                  {sharesFormatted} {activeQuote.symbol}
                </div>
                <div className="mt-1 text-xs text-slate-300">{activeQuote.name}</div>
                <div className="mt-2 border-t border-white/[0.07] pt-2 font-mono text-[11px] text-slate-400">
                  {activeQuote.routeLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="font-mono text-xs text-slate-400">
              Geo-safe: auto-falls back to USDC if restricted
            </span>
            <ActionButton
              id="borel-spotlight-play-cta"
              href="/play/borel"
              variant="emerald"
              size="md"
            >
              Launch Borel Arena
            </ActionButton>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}
