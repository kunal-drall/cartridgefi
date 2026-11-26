"use client";

import * as React from "react";
import { CARTRIDGE_DEVNET_AUTHORITIES, ENGINE_GUARDRAILS } from "@cartridgefi/sdk";
import { ActionButton, GlassCard, GlassPill, LivePulseDot } from "@cartridgefi/ui-system";
import { BorelArena } from "./BorelArena.js";

export type WalletFrameMode = "standalone" | "solflare" | "phantom" | "backpack";

export interface CartridgeDeckProps {
  id?: string;
  partnerId?: string;
  partnerFeeVault?: string;
  defaultCartridgeSlug?: string;
  defaultFrameMode?: WalletFrameMode;
  fullArenaBaseUrl?: string;
  apiBaseUrl?: string;
  wsUrl?: string;
  className?: string;
}

interface WalletChromeMeta {
  mode: WalletFrameMode;
  label: string;
  partnerId: string;
  headerBadge: string;
  accentHex: string;
  defaultVault: string;
}

const WALLET_FRAME_OPTIONS: readonly WalletChromeMeta[] = [
  {
    mode: "solflare",
    label: "Solflare",
    partnerId: "solflare-mobile",
    headerBadge: "Solflare · Explore Deck",
    accentHex: "#FFB020",
    defaultVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
  },
  {
    mode: "phantom",
    label: "Phantom",
    partnerId: "phantom-miniapp",
    headerBadge: "Phantom · In-Wallet Arena",
    accentHex: "#8B5CF6",
    defaultVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot2,
  },
  {
    mode: "backpack",
    label: "Backpack",
    partnerId: "backpack-xnft",
    headerBadge: "Backpack · Executable Deck",
    accentHex: "#00D4FF",
    defaultVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot3,
  },
  {
    mode: "standalone",
    label: "Standalone Web",
    partnerId: "first-party-studio",
    headerBadge: "cartridgefi.com · Direct Stage",
    accentHex: "#00F59B",
    defaultVault: "",
  },
];

const CARTRIDGE_SLUGS: readonly { slug: string; label: string }[] = [
  { slug: "borel-macro-blitz-001", label: "Borel #001 · Blitz Arena" },
  { slug: "pulse-runner-nvda-sol", label: "Pulse Runner #002 · 3-Lane" },
];

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * `<CartridgeDeck />` — Drop-in 15-line React & Partner Wallet Embed SDK.
 * Includes an interactive Wallet Frame Switcher (`Solflare`, `Phantom`, `Backpack`, `Standalone Web`),
 * live `40% Partner Wallet / 30% Creator / 30% Engine` builder fee attribution badge,
 * playable mini-Borel conviction allocation + 3D Showdown unseal, and 1-click deep link to full arena.
 */
export function CartridgeDeck({
  id = "cf-cartridge-deck",
  partnerId,
  partnerFeeVault,
  defaultCartridgeSlug = "borel-macro-blitz-001",
  defaultFrameMode = "solflare",
  fullArenaBaseUrl = "/arena",
  apiBaseUrl,
  wsUrl,
  className = "",
}: CartridgeDeckProps): React.JSX.Element {
  const [frameMode, setFrameMode] = React.useState<WalletFrameMode>(defaultFrameMode);
  const [activeSlug, setActiveSlug] = React.useState<string>(defaultCartridgeSlug);

  const frameMeta =
    WALLET_FRAME_OPTIONS.find((item) => item.mode === frameMode) ?? WALLET_FRAME_OPTIONS[0]!;

  const isPartnerWalletMode =
    frameMode !== "standalone" || Boolean(partnerFeeVault && partnerFeeVault.trim().length > 0);
  const effectivePartnerId = partnerId ?? frameMeta.partnerId;
  const effectivePartnerVault = isPartnerWalletMode
    ? partnerFeeVault?.trim() || frameMeta.defaultVault || CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1
    : undefined;

  const partnerPct = Math.floor(ENGINE_GUARDRAILS.partnerWalletShareBps / 100);
  const partnerCreatorPct = Math.floor(ENGINE_GUARDRAILS.partnerCreatorShareBps / 100);
  const partnerEnginePct = Math.floor(ENGINE_GUARDRAILS.partnerEngineShareBps / 100);

  const deepLinkHref = `${fullArenaBaseUrl}?cartridge=${encodeURIComponent(activeSlug)}&partner=${encodeURIComponent(effectivePartnerId)}`;

  return (
    <section id={id} className={`w-full space-y-4 ${className}`}>
      {/* Top Control Bar: Wallet Frame Switcher + Builder Fee Attribution Badge */}
      <GlassCard variant="elevated" accent="cyan" className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Wallet Embed Frame Mode">
            {WALLET_FRAME_OPTIONS.map((opt) => {
              const active = opt.mode === frameMode;
              return (
                <button
                  key={opt.mode}
                  id={`${id}-frame-${opt.mode}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFrameMode(opt.mode)}
                  className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "border-[#00F59B]/50 bg-[#00F59B]/15 text-[#00F59B]"
                      : "border-white/10 bg-[#0B0E17] text-slate-300 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Live Builder Fee Attribution Badge */}
          <div className="flex flex-wrap items-center gap-2">
            {isPartnerWalletMode && effectivePartnerVault ? (
              <GlassPill id={`${id}-fee-split-badge`} tone="emerald" size="sm">
                <LivePulseDot tone="emerald" size="sm" />
                <span className="font-mono tabular-nums">
                  {partnerPct}% Partner Wallet / {partnerCreatorPct}% Creator / {partnerEnginePct}% Engine
                </span>
                <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-slate-200 tabular-nums">
                  {shortenAddress(effectivePartnerVault)}
                </span>
              </GlassPill>
            ) : (
              <GlassPill id={`${id}-fee-split-badge`} tone="cyan" size="sm">
                <LivePulseDot tone="cyan" size="sm" />
                <span className="font-mono tabular-nums">
                  50% Creator / 50% CartridgeFi Engine (5000 / 5000 bps)
                </span>
              </GlassPill>
            )}
          </div>
        </div>

        {/* Cartridge Picker + 1-Click Deep Link */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {CARTRIDGE_SLUGS.map((item) => {
              const selected = activeSlug === item.slug;
              return (
                <button
                  key={item.slug}
                  id={`${id}-slug-${item.slug}`}
                  type="button"
                  onClick={() => setActiveSlug(item.slug)}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    selected
                      ? "border-[#00D4FF]/45 bg-[#00D4FF]/12 text-[#67E8F9]"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <ActionButton
            id={`${id}-deep-link-btn`}
            variant="emerald"
            size="sm"
            href={deepLinkHref}
          >
            Launch Full Arena ↗
          </ActionButton>
        </div>
      </GlassCard>

      {/* Authentic Mobile Wallet Sheet Chrome vs Standalone Web Stage */}
      {frameMode !== "standalone" ? (
        <div className="mx-auto w-full max-w-[430px] rounded-[28px] border border-white/15 bg-[#050609] p-3 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.9)]">
          {/* Mobile Status + Wallet Sheet Chrome Header */}
          <div className="mb-2.5 rounded-2xl border border-white/10 bg-[#0B0F1A] px-3.5 py-2.5">
            <div className="flex items-center justify-between font-mono text-[10px] text-slate-400 tabular-nums">
              <span>9:41</span>
              <span className="h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
              <span>5G · USDC</span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: frameMeta.accentHex }}
                  className="inline-block h-2.5 w-2.5 rounded-full"
                />
                <span className="text-xs font-semibold text-white">{frameMeta.headerBadge}</span>
              </div>
              <span className="rounded-md border border-white/10 bg-[#050609] px-2 py-0.5 font-mono text-[10px] text-[#00F59B] tabular-nums">
                $250.00 USDC
              </span>
            </div>
          </div>

          <BorelArena
            id={`${id}-mobile-arena`}
            cartridgeSlug={activeSlug}
            partnerId={effectivePartnerId}
            partnerFeeVault={effectivePartnerVault}
            compact={true}
            apiBaseUrl={apiBaseUrl}
            wsUrl={wsUrl}
            fullArenaHref={deepLinkHref}
          />

          {/* Mobile Wallet Bottom Sheet Bar */}
          <div className="mt-2.5 flex items-center justify-between rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 font-mono text-[10px] text-slate-400 tabular-nums">
            <span>Vault: {shortenAddress(effectivePartnerVault ?? "")}</span>
            <span className="text-[#00F59B]">40% Builder Revenue Active</span>
          </div>
        </div>
      ) : (
        <BorelArena
          id={`${id}-standalone-arena`}
          cartridgeSlug={activeSlug}
          partnerId={effectivePartnerId}
          partnerFeeVault={effectivePartnerVault}
          compact={false}
          apiBaseUrl={apiBaseUrl}
          wsUrl={wsUrl}
          fullArenaHref={deepLinkHref}
        />
      )}
    </section>
  );
}
