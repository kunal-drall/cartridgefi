import * as React from "react";

export interface BrandMarkProps {
  className?: string;
  size?: number;
  illuminated?: boolean;
  title?: string;
}

export interface BrandLockupProps {
  id?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  clearspace?: boolean;
  illuminated?: boolean;
  subtitle?: string;
}

const LOCKUP_DIMENSIONS = {
  sm: { markSize: 13, textClass: "text-xs", padStyle: "4px 8px", gapClass: "gap-1.5" },
  md: { markSize: 15, textClass: "text-xs", padStyle: "6px 10px", gapClass: "gap-2" },
  lg: { markSize: 18, textClass: "text-sm", padStyle: "8px 12px", gapClass: "gap-2.5" },
} as const;

/**
 * Official 3-bar Solana vector mark in restrained optical monochrome.
 */
export function SolanaLogoMark({
  className = "",
  size = 15,
  title = "Solana",
}: BrandMarkProps): React.JSX.Element {
  const width = Math.round((size * 397.7) / 311.7);

  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 397.7 311.7"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={`shrink-0 select-none ${className}`}
    >
      <g fill="currentColor" className="text-[#d1d5db]">
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
        <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
      </g>
    </svg>
  );
}

export function SolanaLockup({
  id,
  className = "",
  size = "md",
  clearspace = true,
  subtitle,
}: BrandLockupProps): React.JSX.Element {
  const spec = LOCKUP_DIMENSIONS[size];
  return (
    <span
      id={id}
      translate="no"
      style={clearspace ? { padding: spec.padStyle } : undefined}
      className={`inline-flex items-center ${spec.gapClass} rounded-md ${className}`}
    >
      <SolanaLogoMark size={spec.markSize} />
      <span className="inline-flex flex-col leading-none">
        <span className={`font-medium text-[#e5e7eb] ${spec.textClass}`}>Solana</span>
        {subtitle ? (
          <span className="mt-0.5 font-mono text-[10px] text-[#9ca3af]">{subtitle}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Clean monochrome isometric enclave cube mark for MagicBlock ER & TEE.
 */
export function MagicBlockLogoMark({
  className = "",
  size = 15,
  title = "MagicBlock",
}: BrandMarkProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={`shrink-0 select-none ${className}`}
    >
      <path d="M18 3L31.5 10.75L18 18.5L4.5 10.75L18 3Z" fill="#e5e7eb" />
      <path d="M4.5 10.75L18 18.5V33L4.5 25.25V10.75Z" fill="#9ca3af" />
      <path d="M18 18.5L31.5 10.75V25.25L18 33V18.5Z" fill="#6b7280" />
      <path d="M18 8.75L24.75 12.6L18 16.45L11.25 12.6L18 8.75Z" fill="#0b0c0e" />
      <path d="M18 10.5L22.5 13.1L18 15.7L13.5 13.1L18 10.5Z" fill="#f3f4f6" />
    </svg>
  );
}

export function MagicBlockLockup({
  id,
  className = "",
  size = "md",
  clearspace = true,
  subtitle,
}: BrandLockupProps): React.JSX.Element {
  const spec = LOCKUP_DIMENSIONS[size];
  return (
    <span
      id={id}
      translate="no"
      style={clearspace ? { padding: spec.padStyle } : undefined}
      className={`inline-flex items-center ${spec.gapClass} rounded-md ${className}`}
    >
      <MagicBlockLogoMark size={spec.markSize} />
      <span className="inline-flex flex-col leading-none">
        <span className={`font-medium text-[#e5e7eb] ${spec.textClass}`}>MagicBlock</span>
        {subtitle ? (
          <span className="mt-0.5 font-mono text-[10px] text-[#9ca3af]">{subtitle}</span>
        ) : null}
      </span>
    </span>
  );
}

export interface CartridgeFiLogoProps {
  id?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  showTag?: boolean;
}

/**
 * Clean geometric CartridgeFi mark + restrained institutional wordmark.
 */
export function CartridgeFiLogo({
  id,
  className = "",
  size = "md",
  showTag = false,
}: CartridgeFiLogoProps): React.JSX.Element {
  const markPx = size === "sm" ? 20 : size === "lg" ? 26 : 22;
  const wordClass =
    size === "sm" ? "text-sm" : size === "lg" ? "text-base" : "text-[15px]";

  return (
    <span
      id={id}
      translate="no"
      className={`inline-flex items-center gap-2 select-none ${className}`}
    >
      <svg
        width={markPx}
        height={markPx}
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="CartridgeFi"
        className="shrink-0"
      >
        <rect
          x="2"
          y="2"
          width="24"
          height="24"
          rx="5"
          fill="#171a20"
          stroke="#303642"
          strokeWidth="1.5"
        />
        <path
          d="M8 9.5H17.5L20 12V19.5H8V9.5Z"
          stroke="#f3f4f6"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <rect x="10.5" y="13" width="7" height="2" fill="#3b82f6" />
        <rect x="10.5" y="16.5" width="2" height="3" fill="#9ca3af" />
        <rect x="13.5" y="16.5" width="2" height="3" fill="#9ca3af" />
      </svg>

      <span className="inline-flex items-center gap-1.5">
        <span className={`font-semibold tracking-[-0.02em] text-[#f3f4f6] ${wordClass}`}>
          CartridgeFi
        </span>
        {showTag ? (
          <span className="rounded border border-[#303642] bg-[#171a20] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#9ca3af]">
            DEVNET
          </span>
        ) : null}
      </span>
    </span>
  );
}
