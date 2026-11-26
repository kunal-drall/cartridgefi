"use client";

import * as React from "react";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  USDC_UNIT,
  computePoolAndFeeDistribution,
  type CartridgeManifestV2,
} from "@cartridgefi/shared-types";
import { ActionButton, GlassPill, LivePulseDot } from "@cartridgefi/ui-system";
import { formatAtomicUsdc } from "@/app/(console)/_components/ConsoleVaultContext";

export type WalletPreviewFrameMode =
  | "standalone"
  | "solflare"
  | "phantom"
  | "backpack";

interface WalletChromeMeta {
  id: WalletPreviewFrameMode;
  buttonId: string;
  label: string;
  brandTitle: string;
  accentHex: string;
  borderClass: string;
  badgeClass: string;
  partnerFeeVault: string;
}

const FRAME_MODES: readonly WalletChromeMeta[] = [
  {
    id: "standalone",
    buttonId: "frame-standalone",
    label: "Standalone Web",
    brandTitle: "CartridgeFi Web Console",
    accentHex: "#00F59B",
    borderClass: "border-[#00F59B]/40",
    badgeClass: "border-[#00F59B]/40 bg-[#00F59B]/15 text-[#00F59B]",
    partnerFeeVault: "",
  },
  {
    id: "solflare",
    buttonId: "frame-solflare",
    label: "Solflare",
    brandTitle: "Solflare Mobile · Games Sheet",
    accentHex: "#FFB020",
    borderClass: "border-[#FFB020]/50",
    badgeClass: "border-[#FFB020]/45 bg-[#FFB020]/15 text-[#FCD34D]",
    partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
  },
  {
    id: "phantom",
    buttonId: "frame-phantom",
    label: "Phantom",
    brandTitle: "Phantom · Explore Mini-App Sheet",
    accentHex: "#8B5CF6",
    borderClass: "border-[#8B5CF6]/50",
    badgeClass: "border-[#8B5CF6]/45 bg-[#8B5CF6]/15 text-[#C4B5FD]",
    partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot2,
  },
  {
    id: "backpack",
    buttonId: "frame-backpack",
    label: "Backpack",
    brandTitle: "Backpack xNFT · Market Arcade",
    accentHex: "#00D4FF",
    borderClass: "border-[#00D4FF]/50",
    badgeClass: "border-[#00D4FF]/45 bg-[#00D4FF]/15 text-[#67E8F9]",
    partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot3,
  },
];

export interface WalletDeckPreviewProps {
  manifest: CartridgeManifestV2;
  playableHref: string;
}

export function WalletDeckPreview({
  manifest,
  playableHref,
}: WalletDeckPreviewProps): React.JSX.Element {
  const [frameMode, setFrameMode] =
    React.useState<WalletPreviewFrameMode>("solflare");
  const [previewStanceIdx, setPreviewStanceIdx] = React.useState<number>(1);
  const [previewUnsealed, setPreviewUnsealed] = React.useState<boolean>(false);
  const [copiedDeckCode, setCopiedDeckCode] = React.useState<boolean>(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const activeFrame =
    FRAME_MODES.find((f) => f.id === frameMode) ?? FRAME_MODES[0]!;
  const isPartnerSheet = frameMode !== "standalone";

  const splitSim = React.useMemo(() => {
    const sampleRoomPool = 200n * USDC_UNIT; // $200 USDC room pool
    return computePoolAndFeeDistribution({
      roomPoolUsdc: sampleRoomPool,
      totalFeeBps: 250, // 2.50% = $5.00 builder pool
      creatorShareBps: manifest.metadata.creatorFeeShareBps,
      partnerWalletActive: isPartnerSheet,
      playerScores: [
        { player: "p1", scoreScaled: 240_000_000n },
        { player: "p2", scoreScaled: 110_000_000n },
        { player: "p3", scoreScaled: 20_000_000n },
      ],
    });
  }, [isPartnerSheet, manifest.metadata.creatorFeeShareBps]);

  const deckEmbedSnippet = React.useMemo(() => {
    if (!isPartnerSheet) {
      return `<CartridgeDeck
  cartridgeSlug="${manifest.metadata.slug}"
  revenueSplitMode="DIRECT_50_50"
  allowPaperMode
/>`;
    }
    return `<CartridgeDeck
  cartridgeSlug="${manifest.metadata.slug}"
  partnerId="${frameMode}"
  partnerFeeVault="${activeFrame.partnerFeeVault}"
  revenueSplitMode="PARTNER_40_30_30"
  allowPaperMode
/>`;
  }, [activeFrame.partnerFeeVault, frameMode, isPartnerSheet, manifest.metadata.slug]);

  const handleCopyEmbedSnippet = async (): Promise<void> => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deckEmbedSnippet);
      }
    } catch {
      // Non-HTTPS fallback
    }
    setCopiedDeckCode(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopiedDeckCode(false), 2000);
  };

  const stanceChoices =
    manifest.metadata.genre === "ARCADE_RUNNER"
      ? ["SHORT -1.0x", "USDC SHIELD", "LONG +1.0x"]
      : manifest.metadata.genre === "SYNDICATE_TURF"
        ? ["Silicon Turf", "Anthropic Vault", "Fed Plaza"]
        : ["+60% Primary", "Pair Hedge", "YES Catalyst"];

  const primaryAssets = manifest.marketUniverse.map((m) => m.symbol).slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <GlassPill tone="cyan" size="xs">
              &lt;CartridgeDeck/&gt; Wallet SDK Previewer
            </GlassPill>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {isPartnerSheet
                ? "40% Wallet · 30% Creator · 30% Engine"
                : "50% Creator · 50% Engine"}
            </span>
          </div>
          <h3 className="mt-1.5 font-display text-lg font-bold text-white">
            1-Click Partner Wallet Sheet Morph
          </h3>
        </div>

        {/* 4 Frame Mode Buttons */}
        <div
          role="group"
          aria-label="Wallet SDK Preview Frame"
          className="flex flex-wrap items-center gap-1.5"
        >
          {FRAME_MODES.map((item) => {
            const active = item.id === frameMode;
            return (
              <button
                key={item.id}
                id={item.buttonId}
                type="button"
                aria-pressed={active}
                onClick={() => setFrameMode(item.id)}
                className={`cursor-pointer rounded-xl border px-3 py-1.5 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                  active
                    ? item.badgeClass
                    : "border-white/10 bg-[#050609] text-slate-300 hover:border-white/25 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Revenue Attribution Strip */}
      <div
        id="studio-partner-split-bar"
        className="grid grid-cols-1 gap-2 rounded-xl border border-white/[0.08] bg-[#050609] p-3 font-mono text-xs tabular-nums sm:grid-cols-3"
      >
        <div>
          <div className="text-[10px] text-slate-400">
            Partner Wallet ({isPartnerSheet ? "40%" : "0%"})
          </div>
          <div className="mt-0.5 font-bold text-[#67E8F9]">
            {formatAtomicUsdc(splitSim.partnerFeeUsdc)} / $200 room
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">
            Creator Vault ({isPartnerSheet ? "30%" : "50%"})
          </div>
          <div className="mt-0.5 font-bold text-[#FFB020]">
            {formatAtomicUsdc(splitSim.creatorFeeUsdc)} / $200 room
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">
            Engine Protocol ({isPartnerSheet ? "30%" : "50%"})
          </div>
          <div className="mt-0.5 font-bold text-[#00F59B]">
            {formatAtomicUsdc(splitSim.platformFeeUsdc)} / $200 room
          </div>
        </div>
      </div>

      {/* Morphing Preview Stage: Full Standalone vs Authentic 390px Mobile Wallet Bottom Sheet */}
      <div
        id="studio-wallet-preview-stage"
        data-frame-mode={frameMode}
        className="rounded-2xl border border-white/[0.08] bg-[#050609]/95 p-3 sm:p-5"
      >
        <div
          className={
            isPartnerSheet
              ? `mx-auto w-full max-w-[390px] overflow-hidden rounded-[28px] border-2 ${activeFrame.borderClass} bg-[#080B12] shadow-[0_24px_60px_-15px_rgba(0,0,0,0.85)]`
              : "w-full overflow-hidden rounded-2xl border border-white/12 bg-[#0A0D14]"
          }
        >
          {/* Mobile Wallet Status & Sheet Chrome when Partner Wallet Selected */}
          {isPartnerSheet ? (
            <div className="border-b border-white/[0.08] bg-[#050609] px-4 pb-3 pt-2.5">
              {/* Mobile Top Status Bar */}
              <div className="flex items-center justify-between font-mono text-[10px] text-slate-400 tabular-nums">
                <span>9:41</span>
                <span className="h-1.5 w-16 rounded-full bg-white/15" aria-hidden="true" />
                <span>5G · 100%</span>
              </div>

              {/* Wallet App Top Bar */}
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold ${activeFrame.badgeClass}`}>
                  {activeFrame.brandTitle}
                </span>
                <span translate="no" className="font-mono text-[10px] text-slate-400">
                  40% partnerFeeVault
                </span>
              </div>

              {/* Bottom Sheet Handle */}
              <div className="mt-3 flex justify-center" aria-hidden="true">
                <span className="h-1 w-10 rounded-full bg-white/25" />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#050609] px-4 py-2.5 font-mono text-[11px] text-slate-300">
              <span>{activeFrame.brandTitle}</span>
              <span className="text-[#00F59B]">Direct 50% Creator Split</span>
            </div>
          )}

          {/* Embedded Playable Mini-Cartridge Body */}
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <LivePulseDot tone="emerald" size="sm" />
                  <span className="font-mono text-[10px] text-[#00F59B] tabular-nums">
                    {manifest.magicblockRoomConfig.tickIntervalMs}ms PER ·{" "}
                    {manifest.magicblockRoomConfig.durationSecs}s
                  </span>
                </div>
                <h4 className="mt-1 truncate font-display text-base font-bold text-white">
                  {manifest.metadata.title}
                </h4>
              </div>
              <span
                translate="no"
                className="shrink-0 rounded-md border border-white/10 bg-[#050609] px-2 py-0.5 font-mono text-[10px] text-slate-300"
              >
                {manifest.metadata.genre}
              </span>
            </div>

            {/* Market Universe Pills */}
            <div className="flex flex-wrap gap-1.5">
              {primaryAssets.map((sym) => (
                <span
                  key={sym}
                  translate="no"
                  className="rounded-md border border-white/10 bg-[#050609] px-2 py-0.5 font-mono text-[10px] text-slate-200"
                >
                  {sym}
                </span>
              ))}
              <span className="rounded-md border border-[#8B5CF6]/35 bg-[#8B5CF6]/12 px-2 py-0.5 font-mono text-[10px] text-[#C4B5FD]">
                {previewUnsealed ? "SHOWDOWN UNSEALED" : "TEE FOG SEALED"}
              </span>
            </div>

            {/* Interactive Action Binding Controls inside Preview */}
            <div className="grid grid-cols-3 gap-1.5">
              {stanceChoices.map((choice, idx) => {
                const selected = previewStanceIdx === idx;
                return (
                  <button
                    key={choice}
                    id={`studio-preview-stance-${idx}`}
                    type="button"
                    onClick={() => setPreviewStanceIdx(idx)}
                    className={`cursor-pointer rounded-xl border px-2 py-2 text-center font-mono text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                      selected
                        ? "border-[#00F59B] bg-[#00F59B]/15 text-[#00F59B]"
                        : "border-white/10 bg-[#050609] text-slate-300 hover:border-white/25"
                    }`}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#050609] px-3 py-2 font-mono text-[11px] tabular-nums">
              <span className="text-slate-300">
                Prizes:{" "}
                <strong translate="no" className="text-[#00F59B]">
                  {manifest.scoringAndPrizes.claimMenuAssets.join(" · ")}
                </strong>
              </span>
              <button
                id="studio-preview-toggle-unseal-btn"
                type="button"
                onClick={() => setPreviewUnsealed((prev) => !prev)}
                className="cursor-pointer rounded-lg border border-[#FFB020]/40 bg-[#FFB020]/12 px-2 py-0.5 text-[10px] font-semibold text-[#FCD34D] hover:bg-[#FFB020]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020]"
              >
                {previewUnsealed ? "Re-seal Fog" : "Test Unseal"}
              </button>
            </div>

            {isPartnerSheet ? (
              <div
                translate="no"
                className="truncate rounded-lg border border-white/[0.06] bg-[#050609]/80 px-2.5 py-1.5 font-mono text-[10px] text-slate-400 tabular-nums"
              >
                partnerFeeVault: {activeFrame.partnerFeeVault}
              </div>
            ) : null}

            <div className="flex items-center gap-2 pt-1">
              <ActionButton
                id="studio-preview-play-full-btn"
                href={playableHref}
                variant="emerald"
                size="sm"
                className="flex-1"
              >
                Open Full Console
              </ActionButton>
              <button
                id="studio-copy-deck-code-btn"
                type="button"
                onClick={() => {
                  void handleCopyEmbedSnippet();
                }}
                className="cursor-pointer rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 font-mono text-[11px] font-medium text-slate-200 transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
              >
                {copiedDeckCode ? "Copied JSX" : "Copy <CartridgeDeck/>"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
