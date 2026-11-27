"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Conviction, Direction } from "@/lib/borel/types";
import { cn } from "@/lib/utils";

export interface MatrixLeg {
  readonly direction: Direction;
  readonly conviction: Conviction;
  /** Live P&L sign of the leg: true = up, false = down, null = flat. */
  readonly winning: boolean | null;
}

export interface MatrixSeat {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string;
  readonly isYou: boolean;
  /** Revealed seats show their hand; sealed seats render cipher noise keyed by `seed`. */
  readonly revealed: boolean;
  readonly seed: string;
  readonly legs: readonly MatrixLeg[];
}

/** Cells per conviction step: a 3x card stacks 12 cells, a 1x card 4. */
const CELLS_PER_CONVICTION = 4;
const MAX_CELLS = 3 * CELLS_PER_CONVICTION;

/** FNV-1a: deterministic cipher-noise phase per seat/leg/cell (no Math.random, SSR-stable). */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function revealedTone(leg: MatrixLeg): string {
  if (leg.winning === null) return "bg-[#4b5563]";
  return leg.winning ? "bg-[#34d399]" : "bg-[#f87171]";
}

function SeatColumn({ seat, order, reduce }: { seat: MatrixSeat; order: number; reduce: boolean }): React.JSX.Element {
  const seed = hashString(seat.seed);
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <div className="flex items-end gap-[3px] sm:gap-1">
        {seat.legs.map((leg, legIndex) => {
          // Sealed stacks are cipher noise: their height is keyed by the seed, never by the real card.
          const lit = seat.revealed
            ? leg.conviction * CELLS_PER_CONVICTION
            : CELLS_PER_CONVICTION + (hashString(`${seat.seed}:${legIndex}`) % (MAX_CELLS - CELLS_PER_CONVICTION + 1));
          return (
            <div key={legIndex} className="flex flex-col-reverse gap-[3px]">
              {Array.from({ length: MAX_CELLS }, (_, cell) => {
                const filled = cell < lit;
                if (!seat.revealed) {
                  const phase = (seed ^ hashString(`${legIndex}:${cell}`)) % 1000;
                  return (
                    <span
                      key={cell}
                      className={cn(
                        "block h-[5px] w-[7px] rounded-[1.5px] sm:h-[6px] sm:w-[9px]",
                        filled ? "bg-[#f59e0b] motion-safe:animate-[borel-cipher_2.4s_ease-in-out_infinite]" : "bg-white/[0.035]",
                      )}
                      style={filled ? { opacity: 0.18 + (phase % 5) * 0.09, animationDelay: `${-phase * 2.4}ms` } : undefined}
                    />
                  );
                }
                return (
                  <motion.span
                    key={cell}
                    className={cn(
                      "block h-[5px] w-[7px] rounded-[1.5px] sm:h-[6px] sm:w-[9px]",
                      filled ? revealedTone(leg) : "bg-white/[0.035]",
                    )}
                    initial={reduce || seat.isYou ? false : { opacity: 0, scale: 0.4 }}
                    animate={{ opacity: filled ? 0.35 + (cell / MAX_CELLS) * 0.65 : 1, scale: 1 }}
                    transition={{ duration: 0.35, delay: 0.2 + order * 0.1 + legIndex * 0.05 + cell * 0.02 }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex max-w-full flex-col items-center leading-tight">
        <span className={cn("max-w-full truncate font-mono text-[10px] sm:text-[11px]", seat.isYou ? "text-[#f3f4f6]" : "text-[#9ca3af]")}>
          {seat.label}
        </span>
        <span
          className={cn(
            "max-w-full truncate font-mono text-[9px] tabular-nums sm:text-[10px]",
            seat.revealed ? "text-[#7d8590]" : "text-[#fbbf24]/80",
          )}
        >
          {seat.sublabel}
        </span>
      </div>
    </div>
  );
}

/**
 * Enclave seat lattice: every seat's hand as a column of voxel stacks (height = conviction).
 * Sealed rival hands render as deterministic amber cipher noise; at the showdown they resolve
 * into green/red stacks seat by seat. Pure DOM, so it renders identically with or without WebGL.
 */
export default function EnclaveStateMatrix({ seats }: { seats: readonly MatrixSeat[] }): React.JSX.Element {
  const reduce = useReducedMotion() ?? false;
  return (
    <div className="absolute inset-0 flex flex-col justify-end px-3 pb-3 pt-9 sm:px-5 sm:pb-4" aria-hidden="true">
      <style>{"@keyframes borel-cipher{0%,100%{opacity:.16}50%{opacity:.7}}"}</style>
      <div className="pointer-events-none absolute inset-x-0 bottom-[52px] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent sm:bottom-[58px]" />
      <div className="flex items-end justify-between gap-1 sm:gap-3">
        {seats.map((seat, i) => (
          <SeatColumn key={seat.id} seat={seat} order={i} reduce={reduce} />
        ))}
      </div>
    </div>
  );
}
