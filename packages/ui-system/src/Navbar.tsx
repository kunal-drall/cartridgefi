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
  { id: "nav-link-borel", href: "/play/borel", label: "Play Borel (#001)" },
  { id: "nav-link-pulse-runner", href: "/play/pulse-runner", label: "Pulse Runner (#002)" },
  { id: "nav-link-studio", href: "/studio", label: "Vibe Studio" },
  { id: "nav-link-wallet", href: "#wallet-bento", label: "7-Chain Wallet" },
  { id: "nav-link-engine", href: "#engine-stack", label: "Engine Stack" },
] as const;

/**
 * Shared floating Liquid Glass Header with live ER room telemetry, desktop links,
 * accessible mobile navigation sheet, Launch Studio ghost pill, and Play Borel Live CTA.
 */
export function Navbar({
  activeErRooms = 42,
  tickLatencyMs = 10,
  className = "",
}: NavbarProps): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header
      id="site-navbar"
      className={`sticky top-0 z-50 w-full px-3 pt-3 sm:px-6 ${className}`}
    >
      <div className="cf-glass mx-auto flex max-w-7xl items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 sm:px-5">
        {/* Brand */}
        <a
          id="nav-brand-home"
          href="/"
          className="rounded-lg py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050609]"
        >
          <CartridgeFiLogo size="md" showTag />
        </a>

        {/* Desktop Nav */}
        <nav aria-label="Primary" className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((item) => (
            <a
              key={item.id}
              id={item.id}
              href={item.href}
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Right Telemetry + CTAs */}
        <div className="flex items-center gap-2">
          <div
            id="nav-active-er-rooms"
            className="hidden md:inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#050609]/80 px-3 py-1 font-mono text-[11px] text-slate-300 tabular-nums"
          >
            <LivePulseDot tone="emerald" size="sm" />
            <span>{activeErRooms} ER Rooms</span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-[#00F59B]">{tickLatencyMs}ms</span>
          </div>

          <ActionButton
            id="nav-cta-studio"
            href="/studio"
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Launch Studio
          </ActionButton>

          <ActionButton
            id="nav-cta-play-borel"
            href="/play/borel"
            variant="emerald"
            size="sm"
          >
            Play Borel Live
          </ActionButton>

          <button
            id="nav-mobile-toggle"
            type="button"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            aria-controls="nav-mobile-drawer"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-slate-200 transition-colors hover:bg-white/[0.1] lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
          >
            {mobileOpen ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2.5 4.5H13.5M2.5 8H13.5M2.5 11.5H13.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Accessible Mobile Navigation Panel */}
      {mobileOpen ? (
        <nav
          id="nav-mobile-drawer"
          aria-label="Mobile Primary"
          className="cf-glass mx-auto mt-2 max-w-7xl rounded-2xl p-3 lg:hidden"
        >
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((item) => (
              <a
                key={`mobile-${item.id}`}
                id={`mobile-${item.id}`}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
              >
                <span>{item.label}</span>
                <span className="font-mono text-xs text-slate-500" aria-hidden="true">
                  -&gt;
                </span>
              </a>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
            <span className="inline-flex items-center gap-2 font-mono text-xs text-slate-300 tabular-nums">
              <LivePulseDot tone="emerald" size="sm" />
              {activeErRooms} Active ER Rooms · {tickLatencyMs}ms
            </span>
            <ActionButton
              id="mobile-nav-cta-studio"
              href="/studio"
              variant="ghost"
              size="sm"
            >
              Launch Studio
            </ActionButton>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
