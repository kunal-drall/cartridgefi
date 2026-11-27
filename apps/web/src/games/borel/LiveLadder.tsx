"use client";

import * as React from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { LockedHand, PivotAction } from "@/lib/borel/types";
import { TokenIcon } from "@/components/TokenIcon";
import { cn } from "@/lib/utils";
import { MARKET_SHORT, displaySign, formatScorePctPrecise, formatTestUsdcCompact, scoreToneClass } from "./format";

/** Seat identity tones: restrained, distinct, and never neon. */
const SEAT_TONES: Readonly<Record<string, { ring: string; fill: string; text: string }>> = {
  you: { ring: "#3b82f6", fill: "#13213a", text: "#bfdbfe" },
  "pacer-momentum": { ring: "#5b8a72", fill: "#14201b", text: "#a7d4bc" },
  "pacer-contrarian": { ring: "#a07a4a", fill: "#211a12", text: "#e5c79f" },
  "pacer-index": { ring: "#6b7a99", fill: "#171b25", text: "#c3cbe0" },
  "pacer-crypto-beta": { ring: "#4f8a96", fill: "#121f22", text: "#a5d3dc" },
  "pacer-pair": { ring: "#8a6b8f", fill: "#1e1720", text: "#d6bfd9" },
  "pacer-laggard": { ring: "#8f6a63", fill: "#201715", text: "#dcbcb5" },
};
const FALLBACK_TONE = { ring: "#4b5563", fill: "#15181f", text: "#d1d5db" };

const TOKEN_FOR_SHORT: Readonly<Record<string, string>> = {
  SOL: "SOL",
  BTC: "BTC",
  ETH: "ETH",
  NVDAx: "NVDAX",
  SPY: "SPYX",
};

export function seatName(label: string): string {
  return label.replace("Pacer · ", "");
}

export function SeatAvatar({
  id,
  label,
  size = 36,
}: {
  id: string;
  label: string;
  size?: number;
}): React.JSX.Element {
  const tone = SEAT_TONES[id] ?? FALLBACK_TONE;
  const words = seatName(label).split(/\s+/);
  const initials =
    id === "you" ? "You" : (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2)).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.02em]"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * (id === "you" ? 0.3 : 0.36)),
        background: tone.fill,
        color: tone.text,
        boxShadow: `inset 0 0 0 1.5px ${tone.ring}, inset 0 1px 0 rgba(255,255,255,0.12)`,
      }}
    >
      {initials}
    </span>
  );
}

/** Mini market glyph used on face-up ladder cards. */
export function MarketGlyph({ short, size = 14 }: { short: string; size?: number }): React.JSX.Element {
  const symbol = TOKEN_FOR_SHORT[short];
  if (symbol) return <TokenIcon symbol={symbol} size={size} />;
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#3a4150] bg-[#1a1e27] font-mono font-semibold leading-none text-[#c7ccd6]"
      style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.5)) }}
    >
      {short.slice(0, 1)}
    </span>
  );
}

/**
 * Score sparkline drawn from the recorded score history (1e9 fixed-point, bigint).
 * Integer math maps each sample onto the pixel grid; only the final pixel is a JS number.
 */
export function Sparkline({
  points,
  width = 72,
  height = 24,
  className,
}: {
  points: readonly bigint[];
  width?: number;
  height?: number;
  className?: string;
}): React.JSX.Element {
  const last = points.length > 0 ? points[points.length - 1]! : 0n;
  const lastSign = displaySign(last);
  const stroke = lastSign > 0 ? "#34d399" : lastSign < 0 ? "#f87171" : "#7d8590";
  if (points.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="#2a2f39" strokeDasharray="2 3" />
      </svg>
    );
  }
  let lo = 0n;
  let hi = 0n;
  for (const p of points) {
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  const span = hi - lo === 0n ? 1n : hi - lo;
  const pad = 2;
  const h = BigInt((height - pad * 2) * 1000);
  const step = (width - 2) / (points.length - 1);
  const ys = points.map((p) => pad + Number(((hi - p) * h) / span) / 1000);
  const zeroY = pad + Number(((hi - 0n) * h) / span) / 1000;
  const d = ys.map((y, i) => `${i === 0 ? "M" : "L"}${(1 + i * step).toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${d} L${(1 + (points.length - 1) * step).toFixed(1)} ${zeroY.toFixed(1)} L1 ${zeroY.toFixed(1)} Z`;
  const gradId = `spark-${stroke.slice(1)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="#2a2f39" strokeDasharray="2 3" />
      <path d={area} fill={`url(#${gradId})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={1 + (points.length - 1) * step} cy={ys[ys.length - 1]} r={2} fill={stroke} />
    </svg>
  );
}

/** One ladder hand card: sealed back until the showdown flips it face-up. */
function HandChip({
  leg,
  faceUp,
  delay,
}: {
  leg: LockedHand[number];
  faceUp: boolean;
  delay: number;
}): React.JSX.Element {
  const reduce = useReducedMotion();
  const short = MARKET_SHORT[leg.market];
  return (
    <div className="h-10 w-8 [perspective:600px] sm:w-10">
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        initial={false}
        animate={{ rotateY: faceUp ? 0 : 180 }}
        transition={reduce ? { duration: 0 } : { duration: 0.7, delay, ease: [0.23, 1, 0.32, 1] }}
      >
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-md border bg-[#0f131b] [backface-visibility:hidden]",
            leg.direction === "LONG" ? "border-[#10b981]/45" : "border-[#ef4444]/45",
          )}
        >
          <MarketGlyph short={short} size={14} />
          <span
            className={cn(
              "font-mono text-[9px] font-semibold leading-none tabular-nums",
              leg.direction === "LONG" ? "text-[#34d399]" : "text-[#f87171]",
            )}
          >
            {leg.direction === "LONG" ? "▲" : "▼"}
            {leg.conviction}x
          </span>
        </div>
        <div className="absolute inset-0 rounded-md border border-[#f59e0b]/30 bg-[repeating-linear-gradient(135deg,#171a22_0_3px,#10131a_3px_6px)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <span className="absolute inset-0 m-auto h-1.5 w-1.5 rounded-full bg-[#f59e0b]/50" />
        </div>
      </motion.div>
    </div>
  );
}

export interface LadderRow {
  id: string;
  rank: number;
  scoreE9: bigint;
  label: string;
  strategy: string;
  isYou: boolean;
  hand: LockedHand;
  pivot?: PivotAction;
  /** Your real test-USDC stake in this room (base units, 6 decimals), when one confirmed. */
  stakeUnits?: bigint;
}

/** Your latest rank move while sealed; `key` changes on every move so the row flash replays. */
export interface RankMove {
  readonly key: number;
  readonly direction: "up" | "down";
  readonly rank: number;
}

export function LiveLadder({
  rows,
  history,
  rankAtSeal,
  revealed,
  phaseNote,
  youMove,
}: {
  rows: readonly LadderRow[];
  history: Readonly<Record<string, readonly bigint[]>>;
  rankAtSeal: Readonly<Record<string, number>>;
  revealed: boolean;
  phaseNote: string;
  youMove?: RankMove | null;
}): React.JSX.Element {
  const reduce = useReducedMotion();
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  return (
    <section
      id="borel-ladder"
      aria-label="Rank ladder"
      className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0d14] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-[#f3f4f6]">Rank ladder</h2>
          {revealed ? null : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#10b981]/30 px-2 py-0.5 font-mono text-[10px] text-[#34d399]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34d399] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#34d399]" />
              </span>
              LIVE
            </span>
          )}
        </div>
        <span className="truncate font-mono text-[11px] text-[#7d8590]">{phaseNote}</span>
      </div>
      <LayoutGroup>
        <ol className="divide-y divide-white/[0.05]">
          {sorted.map((row, index) => {
            const start = rankAtSeal[row.id] ?? row.rank;
            const moved = start - row.rank;
            const faceUp = row.isYou || revealed;
            const name = row.isYou ? row.label : seatName(row.label);
            return (
              <motion.li
                key={row.id}
                layout={reduce ? false : "position"}
                transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
                id={row.isYou ? "borel-ladder-you" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4",
                  row.isYou ? "bg-[#0f1726]" : "bg-[#0a0d14]",
                )}
              >
                {row.isYou ? <span className="absolute inset-y-0 left-0 w-[3px] bg-[#3b82f6]" aria-hidden="true" /> : null}
                {row.isYou && youMove && !reduce ? (
                  <motion.span
                    key={youMove.key}
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-0",
                      youMove.direction === "up" ? "bg-[#10b981]" : "bg-[#ef4444]",
                    )}
                    initial={{ opacity: 0.22 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
                  />
                ) : null}
                <span
                  className={cn(
                    "w-6 shrink-0 text-center font-mono text-base font-semibold tabular-nums sm:w-7",
                    row.rank === 1 ? "text-[#fbbf24]" : "text-[#e5e7eb]",
                  )}
                >
                  {row.rank}
                </span>
                <SeatAvatar id={row.id} label={row.label} size={34} />
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-[13px]", row.isYou ? "font-semibold text-[#f3f4f6]" : "font-medium text-[#d1d5db]")}>
                    {name}
                  </div>
                  <div className="flex min-w-0 items-center gap-1 text-[11px] text-[#7d8590]">
                    {row.stakeUnits !== undefined ? (
                      <span
                        id="borel-ladder-stake"
                        className="shrink-0 rounded border border-[#f59e0b]/45 bg-[#f59e0b]/10 px-1 font-mono text-[10px] font-semibold leading-4 text-[#fbbf24] tabular-nums"
                        title="Your test-USDC stake in this room"
                      >
                        {formatTestUsdcCompact(row.stakeUnits)} USDC
                      </span>
                    ) : null}
                    <span className="truncate">
                      {row.isYou
                        ? revealed
                          ? "Your hand"
                          : "Your sealed hand"
                        : revealed
                          ? row.strategy
                          : "Pacer · hand sealed"}
                    </span>
                  </div>
                </div>
                <Sparkline points={history[row.id] ?? []} className="hidden shrink-0 sm:block" />
                <div className="flex shrink-0 gap-0.5 sm:gap-1" aria-label={faceUp ? "Hand face-up" : "Hand sealed"}>
                  {row.hand.map((leg, i) => (
                    <HandChip key={i} leg={leg} faceUp={faceUp} delay={revealed && !row.isYou ? 0.15 + index * 0.12 + i * 0.07 : 0} />
                  ))}
                </div>
                <div className="w-[70px] shrink-0 text-right sm:w-[84px]">
                  <div
                    className={cn(
                      "font-mono text-[13px] font-semibold tabular-nums [font-variant-numeric:tabular-nums_slashed-zero]",
                      scoreToneClass(row.scoreE9),
                    )}
                  >
                    {formatScorePctPrecise(row.scoreE9)}
                  </div>
                  <div
                    className={cn(
                      "font-mono text-[10px] tabular-nums",
                      moved > 0 ? "text-[#34d399]" : moved < 0 ? "text-[#f87171]" : "text-[#7d8590]",
                    )}
                  >
                    {moved > 0 ? `▲ ${moved}` : moved < 0 ? `▼ ${-moved}` : "—"} from #{start}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>
    </section>
  );
}
