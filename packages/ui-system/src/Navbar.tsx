"use client";

import * as React from "react";
import { CartridgeFiLogo } from "./BrandLockups.js";
import { ActionButton, LivePulseDot } from "./LiquidGlass.js";

export interface NavbarProps {
  activeErRooms?: number;
  tickLatencyMs?: number;
  className?: string;
}

const NAV_LINKS = [
  { id: "nav-link-terminal", href: "/", label: "Markets" },
  { id: "nav-link-borel", href: "/play/borel", label: "Borel Arena" },
  { id: "nav-link-pulse-runner", href: "/play/pulse-runner", label: "Pulse Runner" },
  { id: "nav-link-studio", href: "/studio", label: "Manifest Studio" },
  { id: "nav-link-protocol", href: "/protocol", label: "Protocol Explorer" },
] as const;

export function Navbar({
  tickLatencyMs,
  className = "",
}: NavbarProps): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header
      id="site-navbar"
      className={`sticky top-0 z-50 w-full border-b border-[#22262e] bg-[#0b0c0e] ${className}`}
    >
      <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-3 px-4">
        <a
          id="nav-brand-home"
          href="/"
          className="rounded py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
        >
          <CartridgeFiLogo size="sm" showTag />
        </a>

        <nav aria-label="Primary" className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((item) => (
            <a
              key={item.id}
              id={item.id}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[#9ca3af] transition-colors duration-150 hover:bg-[#171a20] hover:text-[#f3f4f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {typeof tickLatencyMs === "number" ? (
            <div
              id="nav-active-er-rooms"
              className="hidden md:inline-flex items-center gap-1.5 rounded border border-[#22262e] bg-[#111317] px-2.5 py-1 font-mono text-[11px] text-[#9ca3af] tabular-nums"
            >
              <LivePulseDot tone="emerald" size="sm" />
              <span>Solana Devnet</span>
              <span className="text-[#34d399]">{tickLatencyMs}ms</span>
            </div>
          ) : null}

          <ActionButton
            id="nav-cta-protocol"
            href="/protocol"
            variant="emerald"
            size="sm"
          >
            Protocol Explorer
          </ActionButton>

          <button
            id="nav-mobile-toggle"
            type="button"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            aria-controls="nav-mobile-drawer"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="cf-btn inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[#303642] bg-[#171a20] text-[#d1d5db] lg:hidden"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {mobileOpen ? (
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2.5 4.5H13.5M2.5 8H13.5M2.5 11.5H13.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <nav
          id="nav-mobile-drawer"
          aria-label="Mobile Primary"
          className="border-t border-[#22262e] bg-[#111317] px-4 py-2.5 lg:hidden"
        >
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((item) => (
              <a
                key={`mobile-${item.id}`}
                id={`mobile-${item.id}`}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-3 py-2 text-xs font-medium text-[#d1d5db] hover:bg-[#171a20] hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
