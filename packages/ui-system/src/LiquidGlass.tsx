"use client";

import * as React from "react";

export type SignalTone = "neutral" | "emerald" | "violet" | "cyan" | "amber";

const TONE_BADGE_CLASSES: Record<SignalTone, string> = {
  neutral: "border-[#303642] bg-[#171a20] text-[#d1d5db]",
  emerald: "border-[#10b981]/30 bg-[#10b981]/10 text-[#34d399]",
  violet: "border-[#3b82f6]/30 bg-[#2563eb]/12 text-[#93c5fd]",
  cyan: "border-[#303642] bg-[#171a20] text-[#e5e7eb]",
  amber: "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#fbbf24]",
};

const TONE_DOT_CLASSES: Record<SignalTone, string> = {
  neutral: "bg-[#9ca3af]",
  emerald: "bg-[#10b981]",
  violet: "bg-[#3b82f6]",
  cyan: "bg-[#60a5fa]",
  amber: "bg-[#f59e0b]",
};

export interface GlassCardProps {
  id?: string;
  as?: "div" | "article" | "section" | "aside";
  variant?: "elevated" | "subtle" | "stage";
  accent?: SignalTone | "none";
  className?: string;
  children: React.ReactNode;
}

/**
 * Clean flat structural panel (retains exported name for @cartridgefi/react compatibility).
 */
export function GlassCard({
  id,
  as: Tag = "div",
  variant = "elevated",
  className = "",
  children,
}: GlassCardProps): React.JSX.Element {
  const surfaceClass =
    variant === "subtle"
      ? "border border-[#22262e] bg-[#0e1014]"
      : variant === "stage"
        ? "border border-[#303642] bg-[#111317]"
        : "border border-[#22262e] bg-[#111317]";

  return (
    <Tag id={id} className={`relative overflow-hidden rounded-lg ${surfaceClass} ${className}`}>
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
      ? "px-1.5 py-0.5 text-[11px]"
      : size === "md"
        ? "px-2.5 py-1 text-xs"
        : "px-2 py-0.5 text-xs";

  return (
    <span
      id={id}
      className={`inline-flex items-center gap-1.5 rounded border font-medium ${sizeClass} ${TONE_BADGE_CLASSES[tone]} ${className}`}
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
  const color = TONE_DOT_CLASSES[tone];
  const dim = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";

  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${dim} ${color} ${className}`}
    />
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
      ? "h-8 px-3 text-xs gap-1.5 rounded-md"
      : size === "lg"
        ? "h-10 px-4 text-sm gap-2 rounded-md"
        : "h-9 px-3.5 text-xs gap-2 rounded-md";

  const variantClass =
    variant === "emerald"
      ? "bg-[#2563eb] text-white font-medium border border-[#3b82f6] hover:bg-[#1d4ed8]"
      : variant === "glass"
        ? "bg-[#171a20] text-[#f3f4f6] font-medium border border-[#303642] hover:bg-[#1d2129] hover:border-[#3f4756]"
        : "bg-transparent text-[#d1d5db] font-medium border border-[#22262e] hover:bg-[#171a20] hover:text-white";

  const displayClass = /\bhidden\b/.test(className) ? "" : "inline-flex";
  const sharedClass = `${displayClass} cf-btn items-center justify-center whitespace-nowrap shrink-0 touch-manipulation select-none active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b0c0e] disabled:pointer-events-none disabled:opacity-45 ${sizeClass} ${variantClass} ${className}`;

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
      ? "text-2xl sm:text-3xl font-semibold tracking-tight"
      : size === "lg"
        ? "text-xl sm:text-2xl font-semibold tracking-tight"
        : size === "sm"
          ? "text-xs font-medium"
          : "text-base font-semibold";

  const valueColor =
    tone === "emerald"
      ? "text-[#34d399]"
      : tone === "amber"
        ? "text-[#fbbf24]"
        : "text-[#f3f4f6]";

  return (
    <div id={id} className={`flex flex-col gap-0.5 min-w-0 ${className}`}>
      <span className="text-[11px] font-medium text-[#9ca3af]">{label}</span>
      <span className={`font-mono tabular-nums ${valueSize} ${valueColor}`}>{value}</span>
      {sublabel ? (
        <span className="text-[11px] text-[#6b7280] leading-snug">{sublabel}</span>
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
  badge = "CLI",
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
      }, 1800);
    } catch {
      setCopied(true);
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 1800);
    }
  };

  return (
    <div className={`flex w-full sm:w-auto max-w-full min-w-0 flex-col items-start gap-1 ${className}`}>
      <button
        id={id}
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        aria-label={`Copy command ${command}`}
        className="cf-btn group flex w-full sm:w-auto max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-[#303642] bg-[#111317] px-3 h-9 text-left touch-manipulation hover:border-[#3f4756] hover:bg-[#171a20] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
      >
        <span className="shrink-0 rounded bg-[#171a20] border border-[#303642] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#9ca3af]">
          {badge}
        </span>
        <code
          translate="no"
          className="min-w-0 flex-1 truncate font-mono text-xs text-[#f3f4f6] tabular-nums"
        >
          <span className="mr-1.5 text-[#6b7280] select-none">$</span>
          {command}
        </code>
        <span
          aria-live="polite"
          className={`ml-1 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${
            copied ? "text-[#34d399]" : "text-[#9ca3af] group-hover:text-white"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
      {helperText ? (
        <span className="text-[11px] text-[#6b7280]">{helperText}</span>
      ) : null}
    </div>
  );
}
