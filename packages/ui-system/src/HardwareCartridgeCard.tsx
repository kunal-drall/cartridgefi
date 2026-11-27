import * as React from "react";
import type { CartridgeGenre } from "@cartridgefi/shared-types";
import { ActionButton, GlassPill } from "./LiquidGlass.js";

export interface HardwareCartridgeCardProps {
  id: string;
  slotCode: string;
  slug: string;
  title: string;
  subtitle: string;
  genre: CartridgeGenre;
  engineTarget: string;
  creatorHandle: string;
  creatorFeeShareBps: number;
  concurrentPlayers: number;
  creatorEarnedUsdcFormatted: string;
  tickIntervalMs: number;
  durationSecs: number;
  isPrivateTee: boolean;
  assets: readonly string[];
  playHref: string;
  forkHref: string;
  badgeLabel?: string;
  className?: string;
}

const GENRE_LABELS: Record<CartridgeGenre, string> = {
  BOREL_GAMEDAY: "Conviction Arena",
  ARCADE_RUNNER: "Volatility Runner",
  SYNDICATE_TURF: "Sector Allocation",
  PREDICTION_BRACKET: "Event Bracket",
};

export function HardwareCartridgeCard({
  id,
  slotCode,
  slug,
  title,
  subtitle,
  genre,
  engineTarget,
  creatorHandle,
  creatorFeeShareBps,
  tickIntervalMs,
  durationSecs,
  isPrivateTee,
  assets,
  playHref,
  forkHref,
  className = "",
}: HardwareCartridgeCardProps): React.JSX.Element {
  const creatorPct = Math.round(creatorFeeShareBps / 100);

  return (
    <article
      id={id}
      className={`flex flex-col justify-between rounded-lg border border-[#22262e] bg-[#111317] p-4 ${className}`}
    >
      <div>
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#22262e] pb-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium text-[#9ca3af] tabular-nums">
              {slotCode}
            </span>
            <GlassPill tone="neutral" size="xs">
              {GENRE_LABELS[genre]}
            </GlassPill>
          </div>
          <span className="font-mono text-[11px] text-[#6b7280] tabular-nums">
            {tickIntervalMs}ms / {durationSecs}s
          </span>
        </div>

        <h3 className="text-sm font-semibold text-[#f3f4f6]">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-[#9ca3af] line-clamp-2">{subtitle}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {assets.map((symbol) => (
            <span
              key={symbol}
              translate="no"
              className="rounded border border-[#22262e] bg-[#0b0c0e] px-1.5 py-0.5 font-mono text-[11px] text-[#d1d5db] tabular-nums"
            >
              {symbol}
            </span>
          ))}
          {isPrivateTee ? (
            <span className="rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#fbbf24]">
              TEE Encrypted
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[#22262e]">
        <div className="mb-3 flex items-center justify-between text-[11px] text-[#9ca3af]">
          <span className="font-mono">{creatorHandle}</span>
          <span className="font-mono tabular-nums">
            {engineTarget} ({creatorPct}% fee split)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton
            id={`cartridge-play-${slug}`}
            href={playHref}
            variant="emerald"
            size="sm"
            className="flex-1"
          >
            Open Terminal
          </ActionButton>
          <ActionButton
            id={`cartridge-fork-${slug}`}
            href={forkHref}
            variant="ghost"
            size="sm"
          >
            Inspect Manifest
          </ActionButton>
        </div>
      </div>
    </article>
  );
}
