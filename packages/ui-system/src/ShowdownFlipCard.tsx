"use client";

import * as React from "react";

export interface ConvictionAllocationLeg {
  symbol: string;
  label: string;
  /** Magnitude 0..100 for proportional visual bar width. */
  barWidthPct: number;
  tone: "emerald" | "amber" | "cyan";
}

export interface ShowdownFlipCardProps {
  id: string;
  playerHandle: string;
  rank: number;
  publicDeltaBpsFormatted: string;
  cipherDigest: string;
  teeProgramShort?: string;
  unsealed: boolean;
  finalScoreFormatted: string;
  vrfProofShort?: string;
  allocations: readonly ConvictionAllocationLeg[];
  onToggleUnseal?: () => void;
  className?: string;
}

const CIPHER_WIDTHS = ["w-4/5", "w-3/5", "w-2/3"] as const;

/**
 * GPU-composited 380ms 3D spring flip card (`cubic-bezier(0.22, 1, 0.36, 1)`)
 * transitioning from MagicBlock Private ER TEE Fog-of-War (`ACLseoPoyC...`)
 * to the T - 15s Showdown unsealed conviction vector.
 */
export function ShowdownFlipCard({
  id,
  playerHandle,
  rank,
  publicDeltaBpsFormatted,
  cipherDigest,
  teeProgramShort = "ACLseoPoyC…2XQnp1",
  unsealed,
  finalScoreFormatted,
  vrfProofShort = "Vrf1RNUj…UwGz",
  allocations,
  onToggleUnseal,
  className = "",
}: ShowdownFlipCardProps): React.JSX.Element {
  return (
    <div id={id} className={`cf-flip-stage w-full ${className}`}>
      <div
        data-unsealed={unsealed ? "true" : "false"}
        className="cf-flip-inner grid w-full grid-cols-1"
      >
        {/* FRONT FACE: Private ER TEE Encrypted Fog-of-War */}
        <div
          style={{ gridArea: "1 / 1" }}
          aria-hidden={unsealed}
          className="cf-flip-face flex flex-col justify-between rounded-2xl border border-[#8B5CF6]/35 bg-[#0C0F19]/95 p-4 shadow-[inset_0_1px_0_0_rgba(139,92,246,0.28),0_18px_40px_-14px_rgba(0,0,0,0.75)]"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#8B5CF6]/40 bg-[#8B5CF6]/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4B5FD]">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <rect
                    x="2"
                    y="5.2"
                    width="8"
                    height="5.5"
                    rx="1.2"
                    stroke="currentColor"
                    strokeWidth="1.25"
                  />
                  <path
                    d="M3.75 5.2V3.7C3.75 2.46 4.76 1.45 6 1.45C7.24 1.45 8.25 2.46 8.25 3.7V5.2"
                    stroke="currentColor"
                    strokeWidth="1.25"
                  />
                </svg>
                TEE FOG · {teeProgramShort}
              </span>
              <span className="font-mono text-xs font-semibold text-slate-200 tabular-nums">
                #{rank} · {publicDeltaBpsFormatted}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span translate="no" className="font-display text-sm font-bold text-slate-100">
                {playerHandle}
              </span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {cipherDigest}
              </span>
            </div>

            {/* Redacted TEE Cipher Allocation Bars */}
            <div className="mt-3 space-y-2 rounded-xl border border-white/[0.06] bg-[#050609]/90 p-3">
              {CIPHER_WIDTHS.map((widthClass, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] text-slate-500 select-none">
                    LEG_0{idx + 1}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className={`h-full ${widthClass} rounded-full bg-[#8B5CF6]/35`}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-[#C4B5FD]/80 select-none">
                    SEALED
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
            <span>Zero copy-trade weight leakage</span>
            {onToggleUnseal ? (
              <button
                id={`${id}-unseal-btn`}
                type="button"
                onClick={onToggleUnseal}
                className="cursor-pointer rounded-lg border border-[#FFB020]/35 bg-[#FFB020]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#FFB020] transition-colors hover:bg-[#FFB020]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020]"
              >
                Unseal T-15s
              </button>
            ) : (
              <span className="font-mono text-[10px] text-[#FFB020] tabular-nums">
                Unseals T - 15s
              </span>
            )}
          </div>
        </div>

        {/* BACK FACE: T - 15s Unsealed Showdown Conviction Vector */}
        <div
          style={{ gridArea: "1 / 1" }}
          aria-hidden={!unsealed}
          className="cf-flip-back flex flex-col justify-between rounded-2xl border border-[#00F59B]/40 bg-[#0B1218]/95 p-4 shadow-[inset_0_1px_0_0_rgba(0,245,155,0.28),0_18px_40px_-14px_rgba(0,0,0,0.75)]"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFB020]/45 bg-[#FFB020]/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[#FCD34D]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FFB020]" aria-hidden="true" />
                SHOWDOWN UNSEALED
              </span>
              <span className="font-mono text-xs font-bold text-[#00F59B] tabular-nums">
                #{rank} · {finalScoreFormatted}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span translate="no" className="font-display text-sm font-bold text-white">
                {playerHandle}
              </span>
              <span
                translate="no"
                className="inline-flex items-center gap-1 rounded border border-[#00F59B]/25 bg-[#00F59B]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#00F59B]"
              >
                VRF {vrfProofShort}
              </span>
            </div>

            {/* Revealed Conviction Weights */}
            <div className="mt-3 space-y-2 rounded-xl border border-white/[0.08] bg-[#050609]/90 p-3">
              {allocations.map((leg) => {
                const barColor =
                  leg.tone === "amber"
                    ? "bg-[#FFB020]"
                    : leg.tone === "cyan"
                      ? "bg-[#00D4FF]"
                      : "bg-[#00F59B]";
                const textColor =
                  leg.tone === "amber"
                    ? "text-[#FCD34D]"
                    : leg.tone === "cyan"
                      ? "text-[#67E8F9]"
                      : "text-[#00F59B]";

                return (
                  <div key={leg.symbol} className="flex items-center justify-between gap-2.5">
                    <span
                      translate="no"
                      className="w-20 truncate font-mono text-[11px] font-medium text-slate-200"
                    >
                      {leg.symbol}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        style={{ width: `${Math.max(8, Math.min(100, leg.barWidthPct))}%` }}
                        className={`h-full rounded-full ${barColor}`}
                      />
                    </div>
                    <span
                      translate="no"
                      className={`w-20 text-right font-mono text-[11px] font-semibold tabular-nums ${textColor}`}
                    >
                      {leg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 pt-1 text-[11px] text-slate-300">
            <span className="font-mono text-[10px] text-slate-400">
              Committed to Solana L1 via Magic Actions
            </span>
            {onToggleUnseal ? (
              <button
                id={`${id}-reseal-btn`}
                type="button"
                onClick={onToggleUnseal}
                className="cursor-pointer rounded-lg border border-white/15 bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] font-medium text-slate-200 transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
              >
                Re-seal Fog
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
