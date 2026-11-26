import * as React from "react";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  ENGINE_GUARDRAILS,
  MAGICBLOCK_CONSTANTS,
} from "@cartridgefi/shared-types";
import { GlassCard, GlassPill } from "@cartridgefi/ui-system";

const SEVEN_CHAINS = [
  "Solana",
  "Base",
  "Ethereum",
  "Arbitrum",
  "BNB",
  "Monad",
  "Polygon",
] as const;

export function WalletBentoSection(): React.JSX.Element {
  return (
    <section
      id="wallet-bento"
      aria-labelledby="wallet-bento-heading"
      className="scroll-mt-24 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24"
    >
      <div className="max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <GlassPill tone="emerald" size="xs">
            Consumer-Grade Onboarding · Institutional Liquidity
          </GlassPill>
          <span className="font-mono text-xs text-slate-400">
            Zero Seed Phrases · Non-Custodial Session Keys
          </span>
        </div>
        <h2
          id="wallet-bento-heading"
          className="font-display text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl text-balance"
        >
          7 chains and Apple Pay in. Instant Solana speed out.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
          Every game built on CartridgeFi inherits unified cross-chain cash onboarding, sponsored
          gas, pre-wired Solana venues, and a portable cross-game skill passport out of the box.
        </p>
      </div>

      {/* Asymmetric 12-Col Bento Grid (7+5, 4+8, 6+6 on lg; clean single-column on 390px mobile) */}
      <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Card 1 (7 cols): Unified Cash Across 7 Chains */}
        <GlassCard id="bento-card-7-chains" accent="emerald" className="p-6 lg:col-span-7">
          <div className="flex items-center justify-between gap-2">
            <GlassPill tone="emerald" size="xs">
              Unified Cash Vault
            </GlassPill>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              &lt; 2.0s Intent Settlement
            </span>
          </div>
          <h3 className="mt-3 font-display text-xl font-bold text-white">
            Unified cash across 7 chains into canonical Solana USDC.
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Deposit from Solana, Base, Ethereum, Arbitrum, BNB Chain, Monad, or Polygon—settled
            automatically into one canonical Solana USDC balance with zero bridge tabs.
          </p>

          {/* Vector 7-Chain Intent Funnel Schematic */}
          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {SEVEN_CHAINS.map((chain) => (
                <span
                  key={chain}
                  translate="no"
                  className="rounded-lg border border-white/10 bg-[#0D121D] px-2.5 py-1 font-mono text-[11px] font-medium text-slate-200"
                >
                  {chain}
                </span>
              ))}
            </div>
            <svg
              viewBox="0 0 560 56"
              fill="none"
              aria-hidden="true"
              className="my-2 h-11 w-full"
            >
              <path
                d="M40 6 C40 30, 260 24, 280 48 M120 6 C120 28, 265 26, 280 48 M200 6 C200 26, 270 28, 280 48 M280 6 L280 48 M360 6 C360 26, 290 28, 280 48 M440 6 C440 28, 295 26, 280 48 M520 6 C520 30, 300 24, 280 48"
                stroke="rgba(0, 245, 155, 0.42)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="280" cy="48" r="5" fill="#00F59B" />
            </svg>
            <div className="flex items-center justify-between rounded-xl border border-[#00F59B]/30 bg-[#00F59B]/10 px-3.5 py-2 font-mono text-xs tabular-nums">
              <span className="font-semibold text-[#00F59B]">
                Canonical Solana USDC Vault
              </span>
              <span translate="no" className="text-slate-200">
                100% 1:1 Backed
              </span>
            </div>
          </div>
        </GlassCard>

        {/* Card 2 (5 cols): 10-Second Apple Pay & Passkeys */}
        <GlassCard id="bento-card-passkey-applepay" accent="cyan" className="p-6 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <GlassPill tone="cyan" size="xs">
              Biometric Onboarding
            </GlassPill>
            <span className="font-mono text-xs text-slate-400 tabular-nums">~10s First Match</span>
          </div>
          <h3 className="mt-3 font-display text-xl font-bold text-white">
            Passkey FaceID sign-in with Apple Pay &amp; Google Pay.
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Hardware-bound WebAuthn passkeys pair with Apple Pay, Google Pay, and debit top-ups so
            mainstream players join an arena as fast as downloading a mobile game.
          </p>

          {/* Biometric Passkey + Contactless Wave Schematic */}
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#00D4FF]/35 bg-[#00D4FF]/10">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M8 4H6C4.9 4 4 4.9 4 6V8M16 4H18C19.1 4 20 4.9 20 6V8M8 20H6C4.9 20 4 19.1 4 18V16M16 20H18C19.1 20 20 19.1 20 18V16"
                    stroke="#00D4FF"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M9.5 10V11M14.5 10V11M9.5 15C10.3 15.8 11.1 16.2 12 16.2C12.9 16.2 13.7 15.8 14.5 15"
                    stroke="#E2E8F0"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div>
                <div className="font-display text-sm font-bold text-white">
                  WebAuthn Smart Account
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  Apple Pay · Google Pay · Debit
                </div>
              </div>
            </div>
            <span className="rounded-lg border border-[#00F59B]/35 bg-[#00F59B]/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-[#00F59B] tabular-nums">
              0 Seed Words
            </span>
          </div>
        </GlassCard>

        {/* Card 3 (4 cols): Gas Covered, Zero Popups */}
        <GlassCard id="bento-card-zero-popups" accent="violet" className="p-6 lg:col-span-4">
          <div className="flex items-center justify-between gap-2">
            <GlassPill tone="violet" size="xs">
              Kora + Session Keys
            </GlassPill>
            <span className="font-mono text-xs text-[#00F59B] tabular-nums">0.00 SOL Gas</span>
          </div>
          <h3 className="mt-3 font-display text-xl font-bold text-white">
            Gas covered. Zero wallet popups mid-round.
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Kora fee sponsorship (<code translate="no" className="font-mono text-slate-300">{CARTRIDGE_DEVNET_AUTHORITIES.koraSponsor.slice(0, 6)}…</code>) covers L1 rent while MagicBlock Session Keys (<code translate="no" className="font-mono text-slate-300">{MAGICBLOCK_CONSTANTS.sessionKeyProgramId.slice(0, 6)}…</code>) sign 60fps moves silently.
          </p>

          <div className="mt-5 space-y-2 rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-3.5 font-mono text-[11px] tabular-nums">
            <div className="flex items-center justify-between text-slate-300">
              <span>1. Join Match</span>
              <span className="text-[#00F59B]">1 Tap · Kora Sponsored</span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span>2. 60s Arena Moves</span>
              <span className="text-[#C4B5FD]">0 Popups · 10ms ER</span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span>3. L1 Vault Claim</span>
              <span className="text-[#FFB020]">Atomic Magic Action</span>
            </div>
          </div>
        </GlassCard>

        {/* Card 4 (8 cols): All Venues Pre-Wired */}
        <GlassCard id="bento-card-venue-router" accent="emerald" className="p-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <GlassPill tone="emerald" size="xs">
              Canonical Venue Router
            </GlassPill>
            <span translate="no" className="font-mono text-xs text-slate-400">
              cartridge-vault-router · {CARTRIDGE_PROGRAM_IDS.vaultRouter.slice(0, 10)}…
            </span>
          </div>
          <h3 className="mt-3 font-display text-xl font-bold text-white">
            Tokenized stocks, perps, and Kalshi predictions pre-wired in one SDK call.
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Game creators never integrate DEX aggregators or margin engines manually. Declare
            symbols in <code className="font-mono text-slate-200">marketUniverse</code> and
            CartridgeFi routes net delta and prize claims non-custodially.
          </p>

          {/* 3-Venue Router Micro-Schematic */}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold text-[#00F59B]">
                  TOKENIZED EQUITIES
                </span>
                <span className="font-mono text-[10px] text-slate-500">Jupiter V2</span>
              </div>
              <div translate="no" className="mt-2 font-mono text-sm font-bold text-white">
                NVDAx · SPYx · ANTx · TSLAx
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Fractional SPL stock vault settlement on every winning podium.
              </p>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold text-[#00D4FF]">
                  PERPETUALS &amp; CLOB
                </span>
                <span className="font-mono text-[10px] text-slate-500">Phoenix + Jup</span>
              </div>
              <div translate="no" className="mt-2 font-mono text-sm font-bold text-white">
                SOL-PERP · BTC-PERP
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Pyth 10^8 oracle feeds with 15s staleness &amp; 150 bps confidence guards.
              </p>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold text-[#FFB020]">
                  PREDICTION MARKETS
                </span>
                <span className="font-mono text-[10px] text-slate-500">DFlow / Kalshi</span>
              </div>
              <div translate="no" className="mt-2 font-mono text-sm font-bold text-white">
                FOMC · Earnings · Sports
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Regulated binary event outcomes wired as Brier &amp; carry multipliers.
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Card 5 (6 cols): Portable Market ELO Passport */}
        <GlassCard id="bento-card-elo-passport" accent="amber" className="p-6 lg:col-span-6">
          <div className="flex items-center justify-between gap-2">
            <GlassPill tone="amber" size="xs">
              Cross-Game Skill Identity
            </GlassPill>
            <span translate="no" className="font-mono text-xs text-slate-400">
              {CARTRIDGE_PROGRAM_IDS.passport.slice(0, 10)}…
            </span>
          </div>
          <h3 className="mt-3 font-display text-xl font-bold text-white">
            Portable Market ELO Passport across every game and wallet.
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Computed in deterministic <code className="font-mono text-slate-200">10^9</code>{" "}
            fixed-point Taylor arithmetic (<code className="font-mono text-slate-200">K = 12</code>{" "}
            Paper, <code className="font-mono text-slate-200">K = 32</code> Live) tracking your
            Sharpe, Brier calibration, and lifetime Earned Stock Vault units.
          </p>

          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-[11px] text-slate-400">Verified On-Chain Rating</div>
                <div className="font-mono text-2xl font-bold text-[#FFB020] tabular-nums">
                  1,482 ELO
                </div>
              </div>
              <div className="text-right font-mono text-xs tabular-nums">
                <div className="text-[#00F59B]">Best Sharpe: +2.84</div>
                <div className="text-slate-400">Brier Calibration: 0.918</div>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[74%] rounded-full bg-[#FFB020]" />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-500 tabular-nums">
              <span>1,000 Rookie</span>
              <span>1,200 Seed</span>
              <span className="text-[#FFB020]">1,482 Quant Tier</span>
              <span>1,800 Grandmaster</span>
            </div>
          </div>
        </GlassCard>

        {/* Card 6 (6 cols): Bounded Session Envelopes */}
        <GlassCard id="bento-card-session-envelopes" accent="neutral" className="p-6 lg:col-span-6">
          <div className="flex items-center justify-between gap-2">
            <GlassPill tone="neutral" size="xs">
              Player Protection By Design
            </GlassPill>
            <span className="font-mono text-xs text-[#00F59B] tabular-nums">
              Max Leverage &lt;= {ENGINE_GUARDRAILS.maxLiveLeverage}x
            </span>
          </div>
          <h3 className="mt-3 font-display text-xl font-bold text-white">
            100% free Paper Mode or strictly bounded Live Session Envelopes.
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Practice every cartridge free in Paper Mode, or step into Live USDC arenas with hard
            on-chain session caps ($10–$250 envelope, max {ENGINE_GUARDRAILS.maxLiveLeverage}x
            leverage) and zero cascading wallet liquidations.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[#00F59B]/25 bg-[#050609]/90 p-3.5">
              <div className="font-mono text-[10px] font-semibold text-[#00F59B]">
                PAPER ARENA MODE
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
                $0.00 Risk
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Real Pyth ticks, K=12 ELO progression, VRF bonus drops.
              </div>
            </div>

            <div className="rounded-2xl border border-white/12 bg-[#050609]/90 p-3.5">
              <div className="font-mono text-[10px] font-semibold text-[#00D4FF]">
                LIVE BOUNDED ENVELOPE
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
                $10–$250 Cap
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Hard &lt;= {ENGINE_GUARDRAILS.maxLiveLeverage}x ceiling, K=32 ELO, xStock payouts.
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}
