import * as React from "react";
import type { CartridgeGenre } from "@cartridgefi/shared-types";
import { ActionButton, GlassPill, LivePulseDot } from "./LiquidGlass.js";

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

const GENRE_LABELS: Record<CartridgeGenre, { label: string; tone: "emerald" | "cyan" | "amber" | "violet" }> = {
  BOREL_GAMEDAY: { label: "Game-Day Arena", tone: "emerald" },
  ARCADE_RUNNER: { label: "Arcade Runner", tone: "cyan" },
  SYNDICATE_TURF: { label: "Syndicate Turf", tone: "amber" },
  PREDICTION_BRACKET: { label: "Prediction Bracket", tone: "violet" },
};

const CONTACT_PINS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * Precision-milled dark anodized hardware cartridge card (`cf-cartridge-shell`)
 * with CNC grip ridges, live tabular telemetry, asset universe pills, and gold/silver contact pins.
 */
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
  concurrentPlayers,
  creatorEarnedUsdcFormatted,
  tickIntervalMs,
  durationSecs,
  isPrivateTee,
  assets,
  playHref,
  forkHref,
  badgeLabel,
  className = "",
}: HardwareCartridgeCardProps): React.JSX.Element {
  const genreInfo = GENRE_LABELS[genre];
  const formattedPlayers = new Intl.NumberFormat("en-US").format(concurrentPlayers);
  const creatorPct = Math.round(creatorFeeShareBps / 100);

  return (
    <article
      id={id}
      className={`cf-cartridge-shell group relative flex flex-col justify-between overflow-hidden rounded-2xl p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-white/22 ${className}`}
    >
      {/* Top CNC-machined grip notch & ridges */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-[#050609] px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-200 tabular-nums">
              {slotCode}
            </span>
            <GlassPill tone={genreInfo.tone} size="xs">
              {genreInfo.label}
            </GlassPill>
          </div>

          {/* Physical grip ridges */}
          <div className="flex items-center gap-2">
            {badgeLabel ? (
              <span className="font-mono text-[10px] font-medium text-slate-400">
                {badgeLabel}
              </span>
            ) : null}
            <div aria-hidden="true" className="hidden sm:flex flex-col gap-[3px] opacity-60">
              <span className="block h-[2px] w-7 rounded-full bg-white/25" />
              <span className="block h-[2px] w-7 rounded-full bg-white/18" />
              <span className="block h-[2px] w-7 rounded-full bg-white/12" />
            </div>
          </div>
        </div>

        {/* Title & Subtitle */}
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span translate="no" className="font-mono text-slate-300">
              {creatorHandle}
            </span>
            <span className="font-mono tabular-nums text-slate-400">
              {engineTarget} · {tickIntervalMs}ms · {durationSecs}s
            </span>
          </div>
          <h3 className="font-display text-xl font-bold tracking-[-0.03em] text-slate-50 leading-tight">
            {title}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-400 line-clamp-2">
            {subtitle}
          </p>
        </div>

        {/* Venue / Asset Pills */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {assets.map((symbol) => (
            <span
              key={symbol}
              translate="no"
              className="rounded-md border border-white/10 bg-[#050609]/90 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-200 tabular-nums"
            >
              {symbol}
            </span>
          ))}
          {isPrivateTee ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-[#8B5CF6]/35 bg-[#8B5CF6]/12 px-2 py-0.5 font-mono text-[10px] font-medium text-[#C4B5FD]">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3.8 5.2V3.8C3.8 2.58 4.78 1.6 6 1.6C7.22 1.6 8.2 2.58 8.2 3.8V5.2" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              TEE Fog
            </span>
          ) : null}
        </div>
      </div>

      {/* Live Telemetry Well + CTAs + Contact Pins */}
      <div>
        <div className="mb-4 grid grid-cols-2 gap-2.5 rounded-xl border border-white/[0.08] bg-[#050609]/85 p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <LivePulseDot tone="emerald" size="sm" />
              <span>Playing Now</span>
            </div>
            <div
              id={`${id}-players`}
              className="mt-1 font-mono text-sm font-semibold text-slate-50 tabular-nums"
            >
              {formattedPlayers}
            </div>
          </div>

          <div className="min-w-0 border-l border-white/[0.08] pl-2.5">
            <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400">
              <span>Creator ({creatorPct}%)</span>
            </div>
            <div
              id={`${id}-creator-fees`}
              className="mt-1 truncate font-mono text-sm font-semibold text-[#FFB020] tabular-nums"
            >
              {creatorEarnedUsdcFormatted.startsWith("$")
                ? creatorEarnedUsdcFormatted
                : `$${creatorEarnedUsdcFormatted}`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ActionButton
            id={`cartridge-play-${slug}`}
            href={playHref}
            variant="emerald"
            size="sm"
            className="flex-1"
          >
            Play Cartridge
          </ActionButton>
          <ActionButton
            id={`cartridge-fork-${slug}`}
            href={forkHref}
            variant="ghost"
            size="sm"
            className="shrink-0"
          >
            Fork in Studio
          </ActionButton>
        </div>

        {/* Hardware Edge-Connector Contact Pins Bar */}
        <div
          aria-hidden="true"
          className="mt-4 flex items-center justify-between gap-1 rounded-md border border-white/[0.07] bg-[#050609] px-2.5 py-1.5"
        >
          {CONTACT_PINS.map((pin) => (
            <span
              key={pin}
              className={`h-2 flex-1 rounded-[2px] transition-colors duration-200 ${
                pin % 4 === 0
                  ? "bg-[#FFB020]/70 group-hover:bg-[#FFB020]"
                  : pin % 3 === 0
                    ? "bg-[#00F59B]/55 group-hover:bg-[#00F59B]"
                    : "bg-slate-600/60 group-hover:bg-slate-400/80"
              }`}
            />
          ))}
        </div>
      </div>
    </article>
  );
}
