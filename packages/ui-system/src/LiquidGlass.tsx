"use client";

import * as React from "react";

export type SignalTone = "neutral" | "emerald" | "violet" | "cyan" | "amber";

const TONE_ACCENT_BAR: Record<SignalTone, string> = {
  neutral: "bg-white/15",
  emerald: "bg-[#00F59B]",
  violet: "bg-[#8B5CF6]",
  cyan: "bg-[#00D4FF]",
  amber: "bg-[#FFB020]",
};

const TONE_PILL_CLASSES: Record<SignalTone, string> = {
  neutral: "border-white/10 bg-[#111520]/80 text-slate-200",
  emerald: "border-[#00F59B]/30 bg-[#00F59B]/10 text-[#00F59B]",
  violet: "border-[#8B5CF6]/35 bg-[#8B5CF6]/12 text-[#C4B5FD]",
  cyan: "border-[#00D4FF]/35 bg-[#00D4FF]/10 text-[#67E8F9]",
  amber: "border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FCD34D]",
};

const TONE_DOT_CLASSES: Record<SignalTone, { core: string; ring: string }> = {
  neutral: { core: "bg-slate-300", ring: "bg-slate-300/40" },
  emerald: { core: "bg-[#00F59B]", ring: "bg-[#00F59B]/40" },
  violet: { core: "bg-[#8B5CF6]", ring: "bg-[#8B5CF6]/45" },
  cyan: { core: "bg-[#00D4FF]", ring: "bg-[#00D4FF]/40" },
  amber: { core: "bg-[#FFB020]", ring: "bg-[#FFB020]/45" },
};

export interface GlassCardProps {
  id?: string;
  as?: "div" | "article" | "section" | "aside";
  variant?: "elevated" | "subtle" | "stage";
  accent?: SignalTone | "none";
  className?: string;
  children: React.ReactNode;
}

export function GlassCard({
  id,
  as: Tag = "div",
  variant = "elevated",
  accent = "none",
  className = "",
  children,
}: GlassCardProps): React.JSX.Element {
  const surfaceClass =
    variant === "subtle"
      ? "cf-glass-subtle"
      : variant === "stage"
        ? "border border-white/10 bg-[#0A0D14] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_28px_72px_-20px_rgba(0,0,0,0.78)]"
        : "cf-glass";

  return (
    <Tag id={id} className={`relative overflow-hidden rounded-2xl ${surfaceClass} ${className}`}>
      {accent !== "none" ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-80 ${TONE_ACCENT_BAR[accent]}`}
        />
      ) : null}
      {children}
    </Tag>
  );
}

export interface GlassPillProps {
  id?: string;
  tone?: SignalTone;
  size?: "xs" | "sm" | "md";
  className?: string;
  children: React.ReactNode;
}

export function GlassPill({
  id,
  tone = "neutral",
  size = "sm",
  className = "",
  children,
}: GlassPillProps): React.JSX.Element {
  const sizeClass =
    size === "xs"
      ? "px-2 py-0.5 text-[11px]"
      : size === "md"
        ? "px-3.5 py-1.5 text-xs"
        : "px-2.5 py-1 text-xs";

  return (
    <span
      id={id}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)] backdrop-blur-md ${sizeClass} ${TONE_PILL_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export interface LivePulseDotProps {
  tone?: SignalTone;
  size?: "sm" | "md";
  className?: string;
}

export function LivePulseDot({
  tone = "emerald",
  size = "sm",
  className = "",
}: LivePulseDotProps): React.JSX.Element {
  const palette = TONE_DOT_CLASSES[tone];
  const dim = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";

  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex ${dim} shrink-0 items-center justify-center ${className}`}
    >
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:animate-none ${palette.ring}`}
      />
      <span className={`relative inline-flex ${dim} rounded-full ${palette.core}`} />
    </span>
  );
}

export interface ActionButtonProps {
  id: string;
  variant?: "emerald" | "glass" | "ghost";
  size?: "sm" | "md" | "lg";
  href?: string;
  target?: "_blank" | "_self";
  rel?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export function ActionButton({
  id,
  variant = "emerald",
  size = "md",
  href,
  target,
  rel,
  type = "button",
  disabled = false,
  onClick,
  ariaLabel,
  className = "",
  children,
}: ActionButtonProps): React.JSX.Element {
  const sizeClass =
    size === "sm"
      ? "h-9 px-3.5 text-xs gap-1.5 rounded-xl"
      : size === "lg"
        ? "h-12 px-6 text-sm gap-2.5 rounded-2xl"
        : "h-10 px-4 text-sm gap-2 rounded-xl";

  const variantClass =
    variant === "emerald"
      ? "bg-[#00F59B] text-[#050609] font-semibold border border-[#00F59B] shadow-[0_0_28px_-6px_rgba(0,245,155,0.5)] hover:bg-[#2EFFB0] hover:border-[#2EFFB0]"
      : variant === "glass"
        ? "cf-glass text-slate-100 font-medium hover:border-white/20 hover:bg-[#181E2E]/85 hover:text-white"
        : "border border-white/12 bg-white/[0.03] text-slate-200 font-medium hover:border-white/25 hover:bg-white/[0.08] hover:text-white";

  const displayClass = /\bhidden\b/.test(className) ? "" : "inline-flex";
  const sharedClass = `${displayClass} items-center justify-center whitespace-nowrap shrink-0 touch-manipulation select-none transition-[background-color,border-color,color,transform,box-shadow] duration-150 active:translate-y-[0.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050609] disabled:pointer-events-none disabled:opacity-50 ${sizeClass} ${variantClass} ${className}`;

  if (href) {
    return (
      <a
        id={id}
        href={href}
        target={target}
        rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
        aria-label={ariaLabel}
        onClick={onClick}
        className={sharedClass}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      id={id}
      type={type}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`cursor-pointer ${sharedClass}`}
    >
      {children}
    </button>
  );
}

export interface TabularMetricProps {
  id?: string;
  label: string;
  value: string;
  sublabel?: string;
  tone?: SignalTone;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function TabularMetric({
  id,
  label,
  value,
  sublabel,
  tone = "neutral",
  size = "md",
  className = "",
}: TabularMetricProps): React.JSX.Element {
  const valueSize =
    size === "xl"
      ? "text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight"
      : size === "lg"
        ? "text-2xl sm:text-3xl font-bold tracking-tight"
        : size === "sm"
          ? "text-sm font-semibold"
          : "text-lg sm:text-xl font-semibold";

  const valueColor =
    tone === "emerald"
      ? "text-[#00F59B]"
      : tone === "violet"
        ? "text-[#C4B5FD]"
        : tone === "cyan"
          ? "text-[#00D4FF]"
          : tone === "amber"
            ? "text-[#FFB020]"
            : "text-slate-50";

  return (
    <div id={id} className={`flex flex-col gap-1 min-w-0 ${className}`}>
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <span className={`font-mono tabular-nums ${valueSize} ${valueColor}`}>{value}</span>
      {sublabel ? (
        <span className="text-xs text-slate-400 leading-snug">{sublabel}</span>
      ) : null}
    </div>
  );
}

export interface CopyTerminalPillProps {
  id: string;
  command: string;
  badge?: string;
  helperText?: string;
  className?: string;
}

export function CopyTerminalPill({
  id,
  command,
  badge = "AGENT SKILL",
  helperText,
  className = "",
}: CopyTerminalPillProps): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (): Promise<void> => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      }
      setCopied(true);
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setCopied(true);
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  };

  return (
    <div className={`flex w-full sm:w-auto max-w-full min-w-0 flex-col items-start gap-1.5 ${className}`}>
      <button
        id={id}
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        aria-label={`Copy command ${command}`}
        className="cf-glass group flex w-full sm:w-auto max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-2xl px-3 sm:px-3.5 h-12 text-left touch-manipulation transition-[border-color,background-color,box-shadow] duration-150 hover:border-[#00D4FF]/40 hover:bg-[#151B2B]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050609]"
      >
        <span className="shrink-0 rounded-md border border-[#00D4FF]/35 bg-[#00D4FF]/12 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-[#00D4FF]">
          {badge}
        </span>
        <code
          translate="no"
          className="min-w-0 flex-1 truncate font-mono text-xs sm:text-[13px] text-slate-100 tabular-nums"
        >
          <span className="mr-1.5 text-[#00D4FF] select-none">$</span>
          {command}
        </code>
        <span
          aria-live="polite"
          className={`ml-1 inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[11px] font-medium transition-colors duration-150 ${
            copied
              ? "border-[#00F59B]/40 bg-[#00F59B]/15 text-[#00F59B]"
              : "border-white/10 bg-white/[0.04] text-slate-300 group-hover:border-white/20 group-hover:text-white"
          }`}
        >
          {copied ? (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3.5 8.5L6.5 11.5L12.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="5.5"
                  y="5.5"
                  width="8"
                  height="8"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M10.5 5.5V3.75C10.5 3.06 9.94 2.5 9.25 2.5H3.75C3.06 2.5 2.5 3.06 2.5 3.75V9.25C2.5 9.94 3.06 10.5 3.75 10.5H5.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
              Copy
            </>
          )}
        </span>
      </button>
      {helperText ? (
        <span className="pl-1 text-[11px] text-slate-400">{helperText}</span>
      ) : null}
    </div>
  );
}
