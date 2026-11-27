"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import type { ReceiptLeg } from "./HandReceipt";
import { FOCUS_RING, formatScorePctPrecise, scoreToneClass } from "./format";

export interface OutcomeTier {
  readonly label: string;
  readonly copy: string;
  /** Text colour of the rank numeral and stamp. */
  readonly ink: string;
  /** Border / stamp ring colour. */
  readonly ring: string;
}

/** Plain-language result tier for a final rank; colour carries the outcome, copy repeats it. */
export function outcomeTier(rank: number, totalSeats: number): OutcomeTier {
  if (rank === 1) {
    return { label: "Took the table", copy: "Best read in the room.", ink: "#fbbf24", ring: "#f59e0b" };
  }
  if (rank <= 3) {
    return { label: "Podium", copy: "Top three at the bell.", ink: "#34d399", ring: "#10b981" };
  }
  if (rank === totalSeats) {
    return { label: "Last seat", copy: "The market had other plans.", ink: "#f87171", ring: "#ef4444" };
  }
  return { label: "Mid-table", copy: "Close. One better call and you climb.", ink: "#e5e7eb", ring: "#3b82f6" };
}

const TILE: Record<ReceiptLeg["outcome"], { glyph: string; cls: string; word: string }> = {
  WIN: { glyph: "▲", cls: "border-[#10b981] bg-[#0d2a20] text-[#34d399]", word: "up" },
  LOSS: { glyph: "▼", cls: "border-[#ef4444] bg-[#2a1214] text-[#f87171]", word: "down" },
  FLAT: { glyph: "■", cls: "border-[#303642] bg-[#15181f] text-[#9ca3af]", word: "flat" },
};

const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * The 00:00 climax: a full-screen beat that flips your three outcome tiles, stamps the rank and
 * then hands back to the table. Tap, Esc or the button dismisses it; it also leaves on its own.
 */
export function UnsealMoment({
  rank,
  totalSeats,
  scoreE9,
  legs,
  onClose,
}: {
  rank: number;
  totalSeats: number;
  scoreE9: bigint;
  legs: readonly ReceiptLeg[];
  onClose: () => void;
}): React.JSX.Element {
  const reduce = useReducedMotion() ?? false;
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const tier = outcomeTier(rank, totalSeats);
  const ordered = [...legs].sort((a, b) => a.conviction - b.conviction);
  const beat = Math.max(0, totalSeats - rank);

  React.useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const timer = window.setTimeout(onClose, 7_000);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [onClose]);

  const t = (delay: number): { duration: number; delay: number; ease: typeof EASE } =>
    reduce ? { duration: 0, delay: 0, ease: EASE } : { duration: 0.55, delay, ease: EASE };

  return (
    <motion.div
      id="borel-unseal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="borel-unseal-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#050609]/90 px-4 backdrop-blur-md"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.25 }}
      onClick={onClose}
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center" onClick={(e) => e.stopPropagation()}>
        <motion.p
          className="font-mono text-[13px] font-medium uppercase tracking-[0.18em] text-[#fbbf24]"
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(0)}
        >
          00:00 · hands unsealed
        </motion.p>

        <div className="mt-6 flex gap-3" aria-label="Your three calls, lowest card first">
          {ordered.map((leg, i) => {
            const tile = TILE[leg.outcome];
            return (
              <div key={leg.conviction} className="flex flex-col items-center gap-1.5 [perspective:700px]">
                <motion.div
                  className={cn(
                    "flex h-[76px] w-[64px] items-center justify-center rounded-xl border-2 font-mono text-[34px] leading-none",
                    tile.cls,
                  )}
                  initial={reduce ? false : { rotateY: 180, opacity: 0.2 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.25 + i * 0.16, ease: EASE }}
                  aria-label={`${leg.conviction}x leg ${tile.word}`}
                >
                  {tile.glyph}
                </motion.div>
                <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
                  {leg.conviction}x{leg.conviction === 3 ? " sniper" : ""}
                </span>
              </div>
            );
          })}
        </div>

        <motion.div
          className="mt-6 flex items-baseline gap-2"
          initial={reduce ? false : { opacity: 0, scale: 1.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 18, delay: 0.85 }}
        >
          <span
            id="borel-unseal-title"
            className="font-mono text-[88px] font-semibold leading-[0.9] tracking-[-0.05em] tabular-nums"
            style={{ color: tier.ink }}
          >
            #{rank}
          </span>
          <span className="text-[15px] text-[#9ca3af]">of {totalSeats}</span>
        </motion.div>

        <motion.span
          className="mt-3 rounded-full border px-3 py-1 font-mono text-[12px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: tier.ink, borderColor: tier.ring }}
          initial={reduce ? false : { opacity: 0, scale: 0.85, rotate: -4 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={t(1.1)}
        >
          {tier.label}
        </motion.span>

        <motion.div
          className="mt-4 space-y-1"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(1.3)}
        >
          <div className={cn("font-mono text-[28px] font-semibold leading-none tabular-nums", scoreToneClass(scoreE9))}>
            {formatScorePctPrecise(scoreE9)}
          </div>
          <p className="text-[14px] text-[#d1d5db]">
            {tier.copy} You beat {beat} of {totalSeats - 1} rival{totalSeats - 1 === 1 ? "" : "s"}.
          </p>
        </motion.div>

        <motion.button
          ref={buttonRef}
          id="borel-unseal-continue"
          type="button"
          onClick={onClose}
          className={cn(
            "cf-btn mt-7 h-12 w-full cursor-pointer rounded-lg bg-[#2563eb] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-[#1d4ed8]",
            FOCUS_RING,
          )}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(1.5)}
        >
          See every hand
        </motion.button>
      </div>
    </motion.div>
  );
}
