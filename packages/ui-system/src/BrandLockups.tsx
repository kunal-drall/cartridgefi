import * as React from "react";

export interface BrandMarkProps {
  className?: string;
  size?: number;
  /** Forces illuminated active/hover palette even at rest. */
  illuminated?: boolean;
  title?: string;
}

export interface BrandLockupProps {
  id?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Enforces 1.5x mark clearspace padding around the lockup per brand guidelines. */
  clearspace?: boolean;
  illuminated?: boolean;
  subtitle?: string;
}

const LOCKUP_DIMENSIONS = {
  sm: { markSize: 15, textClass: "text-xs", padStyle: "6px 10px", gapClass: "gap-2" },
  md: { markSize: 18, textClass: "text-sm", padStyle: "9px 14px", gapClass: "gap-2.5" },
  lg: { markSize: 22, textClass: "text-base", padStyle: "12px 18px", gapClass: "gap-3" },
} as const;

/**
 * Official 3-bar angled Solana vector mark (397.7 x 311.7 canonical geometry).
 * Optical monochrome #E2E8F0 at rest; illuminates authentic #9945FF -> #14F195 gradient on hover.
 */
export function SolanaLogoMark({
  className = "",
  size = 18,
  illuminated = false,
  title = "Solana",
}: BrandMarkProps): React.JSX.Element {
  const rawId = React.useId();
  const gradId = `solana-grad-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
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
      <defs>
        <linearGradient
          id={gradId}
          x1="360.88"
          y1="351.46"
          x2="141.21"
          y2="-69.29"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="52%" stopColor="#49A8CA" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>

      <g
        fill="#E2E8F0"
        className={
          illuminated
            ? "opacity-0"
            : "opacity-100 transition-opacity duration-200 group-hover/solana:opacity-0 group-hover:opacity-0"
        }
      >
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
        <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
      </g>

      <g
        fill={`url(#${gradId})`}
        className={
          illuminated
            ? "opacity-100"
            : "opacity-0 transition-opacity duration-200 group-hover/solana:opacity-100 group-hover:opacity-100"
        }
      >
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
        <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
      </g>
    </svg>
  );
}

/**
 * Horizontal Solana lockup with official 3-bar mark, geometric wordmark, and 1.5x clearspace wrapper.
 */
export function SolanaLockup({
  id,
  className = "",
  size = "md",
  clearspace = true,
  illuminated = false,
  subtitle,
}: BrandLockupProps): React.JSX.Element {
  const spec = LOCKUP_DIMENSIONS[size];
  return (
    <span
      id={id}
      translate="no"
      style={clearspace ? { padding: spec.padStyle } : undefined}
      className={`group/solana inline-flex items-center ${spec.gapClass} rounded-lg transition-colors duration-200 ${className}`}
    >
      <SolanaLogoMark size={spec.markSize} illuminated={illuminated} />
      <span className="inline-flex flex-col leading-none">
        <span
          className={`font-display font-bold tracking-[0.12em] uppercase transition-colors duration-200 ${spec.textClass} ${
            illuminated
              ? "text-white"
              : "text-[#E2E8F0] group-hover/solana:text-white group-hover:text-white"
          }`}
        >
          SOLANA
        </span>
        {subtitle ? (
          <span className="mt-1 font-mono text-[10px] tracking-normal text-slate-400">
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Isometric modular enclave cube mark for MagicBlock Ephemeral Rollups & Private ER TEE.
 * Optical monochrome #E2E8F0 at rest; illuminates crisp white + #8B5CF6 TEE enclave edge on hover.
 */
export function MagicBlockLogoMark({
  className = "",
  size = 18,
  illuminated = false,
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
      {/* Rest state monochrome isometric cube */}
      <g
        className={
          illuminated
            ? "opacity-0"
            : "opacity-100 transition-opacity duration-200 group-hover/magicblock:opacity-0 group-hover:opacity-0"
        }
      >
        <path d="M18 3L31.5 10.75L18 18.5L4.5 10.75L18 3Z" fill="#E2E8F0" />
        <path d="M4.5 10.75L18 18.5V33L4.5 25.25V10.75Z" fill="#CBD5E1" fillOpacity="0.82" />
        <path d="M18 18.5L31.5 10.75V25.25L18 33V18.5Z" fill="#94A3B8" fillOpacity="0.68" />
        <path
          d="M18 8.75L24.75 12.6L18 16.45L11.25 12.6L18 8.75Z"
          fill="#050609"
          fillOpacity="0.72"
        />
        <path
          d="M18 10.5L22.5 13.1L18 15.7L13.5 13.1L18 10.5Z"
          fill="#E2E8F0"
        />
      </g>

      {/* Hover / illuminated state with crisp white + #8B5CF6 TEE edge light */}
      <g
        className={
          illuminated
            ? "opacity-100"
            : "opacity-0 transition-opacity duration-200 group-hover/magicblock:opacity-100 group-hover:opacity-100"
        }
      >
        <path d="M18 3L31.5 10.75L18 18.5L4.5 10.75L18 3Z" fill="#FFFFFF" />
        <path d="M4.5 10.75L18 18.5V33L4.5 25.25V10.75Z" fill="#E2E8F0" />
        <path d="M18 18.5L31.5 10.75V25.25L18 33V18.5Z" fill="#8B5CF6" fillOpacity="0.85" />
        <path
          d="M18 3L31.5 10.75V25.25L18 33L4.5 25.25V10.75L18 3Z"
          stroke="#8B5CF6"
          strokeWidth="1.4"
        />
        <path
          d="M18 8.75L24.75 12.6L18 16.45L11.25 12.6L18 8.75Z"
          fill="#050609"
        />
        <path
          d="M18 10.3L22.8 13.05L18 15.8L13.2 13.05L18 10.3Z"
          fill="#8B5CF6"
        />
      </g>
    </svg>
  );
}

/**
 * Horizontal MagicBlock lockup with isometric enclave cube mark + wordmark and 1.5x clearspace wrapper.
 */
export function MagicBlockLockup({
  id,
  className = "",
  size = "md",
  clearspace = true,
  illuminated = false,
  subtitle,
}: BrandLockupProps): React.JSX.Element {
  const spec = LOCKUP_DIMENSIONS[size];
  return (
    <span
      id={id}
      translate="no"
      style={clearspace ? { padding: spec.padStyle } : undefined}
      className={`group/magicblock inline-flex items-center ${spec.gapClass} rounded-lg transition-colors duration-200 ${className}`}
    >
      <MagicBlockLogoMark size={spec.markSize} illuminated={illuminated} />
      <span className="inline-flex flex-col leading-none">
        <span
          className={`font-display font-bold tracking-[-0.025em] transition-colors duration-200 ${spec.textClass} ${
            illuminated
              ? "text-white"
              : "text-[#E2E8F0] group-hover/magicblock:text-white group-hover:text-white"
          }`}
        >
          MagicBlock
        </span>
        {subtitle ? (
          <span className="mt-1 font-mono text-[10px] tracking-normal text-slate-400">
            {subtitle}
          </span>
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
 * Precision-milled hardware cartridge-slot mark + CartridgeFi wordmark.
 */
export function CartridgeFiLogo({
  id,
  className = "",
  size = "md",
  showTag = false,
}: CartridgeFiLogoProps): React.JSX.Element {
  const markPx = size === "sm" ? 24 : size === "lg" ? 34 : 28;
  const wordClass =
    size === "sm" ? "text-base" : size === "lg" ? "text-xl" : "text-[17px]";

  return (
    <span
      id={id}
      translate="no"
      className={`inline-flex items-center gap-2.5 select-none ${className}`}
    >
      <svg
        width={markPx}
        height={markPx}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="CartridgeFi Hardware Mark"
        className="shrink-0"
      >
        <path
          d="M6 6.5C6 5.11929 7.11929 4 8.5 4H24.3787C25.0417 4 25.6776 4.26339 26.1464 4.73223L30.2678 8.85355C30.7366 9.32239 31 9.95827 31 10.6213V29.5C31 30.8807 29.8807 32 28.5 32H8.5C7.11929 32 6 30.8807 6 29.5V6.5Z"
          fill="#111520"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1.5"
        />
        <rect x="10" y="7.5" width="11" height="2" rx="1" fill="rgba(255,255,255,0.28)" />
        <rect
          x="10"
          y="13"
          width="16.5"
          height="9"
          rx="2"
          fill="#050609"
          stroke="rgba(0,245,155,0.45)"
          strokeWidth="1.2"
        />
        <rect x="12.5" y="16.2" width="8.5" height="2.6" rx="1.3" fill="#00F59B" />
        <circle cx="23.5" cy="17.5" r="1.4" fill="#00F59B" />
        <rect x="10.5" y="25.5" width="2.4" height="4.2" rx="0.8" fill="#00F59B" />
        <rect x="14.8" y="25.5" width="2.4" height="4.2" rx="0.8" fill="#E2E8F0" fillOpacity="0.65" />
        <rect x="19.1" y="25.5" width="2.4" height="4.2" rx="0.8" fill="#E2E8F0" fillOpacity="0.65" />
        <rect x="23.4" y="25.5" width="2.4" height="4.2" rx="0.8" fill="#FFB020" />
      </svg>

      <span className="inline-flex items-baseline gap-1.5">
        <span className={`font-display font-bold tracking-[-0.035em] text-slate-50 ${wordClass}`}>
          Cartridge<span className="text-[#00F59B]">Fi</span>
        </span>
        {showTag ? (
          <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-400">
            v2.0
          </span>
        ) : null}
      </span>
    </span>
  );
}
