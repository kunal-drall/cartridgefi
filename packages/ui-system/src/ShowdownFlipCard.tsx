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

const CIPHER_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"] as const;

/**
 * Cryptographic TEE Commitment Seal-to-Unseal Order Card (`data-unsealed="true" | "false"`).
 * Zero purple glow; clean matte carbon surfaces with hardware-attested commitment digest.
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
        {/* FRONT FACE: Sealed TEE Commitment */}
        <div
          style={{ gridArea: "1 / 1" }}
          aria-hidden={unsealed}
          className="cf-flip-face flex flex-col justify-between rounded-lg border border-[#22262e] bg-[#111317] p-3.5"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-2 py-0.5 font-mono text-[10px] font-medium text-[#fbbf24]">
                SEALED ({teeProgramShort})
              </span>
              <span className="font-mono text-xs font-medium text-[#d1d5db] tabular-nums">
                Rank #{rank} ({publicDeltaBpsFormatted})
              </span>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span translate="no" className="text-xs font-semibold text-[#f3f4f6]">
                {playerHandle}
              </span>
              <span className="font-mono text-[11px] text-[#6b7280] tabular-nums">
                {cipherDigest}
              </span>
            </div>

            <div className="mt-2.5 space-y-1.5 rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
              {CIPHER_WIDTHS.map((widthClass, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] text-[#6b7280] select-none">
                    Leg 0{idx + 1}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-[#171a20]">
                    <div className={`h-full ${widthClass} bg-[#303642]`} />
                  </div>
                  <span className="font-mono text-[10px] text-[#9ca3af] select-none">
                    ENCRYPTED
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-[#6b7280]">
            <span>Weights hidden in Intel TDX enclave</span>
            {onToggleUnseal ? (
              <button
                id={`${id}-unseal-btn`}
                type="button"
                onClick={onToggleUnseal}
                className="cf-btn cursor-pointer rounded border border-[#303642] bg-[#171a20] px-2 py-0.5 font-mono text-[10px] font-medium text-[#e5e7eb] hover:bg-[#1d2129] active:scale-[0.97]"
              >
                Unseal T-15s
              </button>
            ) : (
              <span className="font-mono text-[10px] text-[#9ca3af] tabular-nums">
                Unseals T-15s
              </span>
            )}
          </div>
        </div>

        {/* BACK FACE: Unsealed Conviction Weights */}
        <div
          style={{ gridArea: "1 / 1" }}
          aria-hidden={!unsealed}
          className="cf-flip-back flex flex-col justify-between rounded-lg border border-[#303642] bg-[#111317] p-3.5"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded border border-[#10b981]/30 bg-[#10b981]/10 px-2 py-0.5 font-mono text-[10px] font-medium text-[#34d399]">
                UNSEALED AT T-15S
              </span>
              <span className="font-mono text-xs font-semibold text-[#34d399] tabular-nums">
                Rank #{rank} ({finalScoreFormatted})
              </span>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span translate="no" className="text-xs font-semibold text-[#f3f4f6]">
                {playerHandle}
              </span>
              <span
                translate="no"
                className="rounded border border-[#22262e] bg-[#0b0c0e] px-1.5 py-0.5 font-mono text-[10px] text-[#9ca3af]"
              >
                VRF {vrfProofShort}
              </span>
            </div>

            <div className="mt-2.5 space-y-1.5 rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
              {allocations.map((leg) => {
                const isShort = leg.label.trim().startsWith("-");
                const barColor = isShort
                  ? "bg-[#ef4444]"
                  : leg.tone === "amber"
                    ? "bg-[#f59e0b]"
                    : "bg-[#10b981]";
                const textColor = isShort
                  ? "text-[#f87171]"
                  : leg.tone === "amber"
                    ? "text-[#fbbf24]"
                    : "text-[#34d399]";

                return (
                  <div key={leg.symbol} className="flex items-center justify-between gap-2.5">
                    <span
                      translate="no"
                      className="w-20 truncate font-mono text-[11px] font-medium text-[#d1d5db]"
                    >
                      {leg.symbol}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-[#171a20]">
                      <div
                        style={{ width: `${Math.max(8, Math.min(100, leg.barWidthPct))}%` }}
                        className={`h-full ${barColor}`}
                      />
                    </div>
                    <span
                      translate="no"
                      className={`w-20 text-right font-mono text-[11px] font-medium tabular-nums ${textColor}`}
                    >
                      {leg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-[#6b7280]">
            <span className="font-mono text-[10px]">Settled on Solana Devnet L1</span>
            {onToggleUnseal ? (
              <button
                id={`${id}-reseal-btn`}
                type="button"
                onClick={onToggleUnseal}
                className="cf-btn cursor-pointer rounded border border-[#303642] bg-[#171a20] px-2 py-0.5 font-mono text-[10px] font-medium text-[#d1d5db] hover:bg-[#1d2129] active:scale-[0.97]"
              >
                Seal view
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
