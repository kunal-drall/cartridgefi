"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CARTRIDGE_PROGRAM_IDS } from "@cartridgefi/shared-types";
import {
  CartridgeFiLogo,
  GlassPill,
  LivePulseDot,
  MagicBlockLogoMark,
} from "@cartridgefi/ui-system";
import {
  formatAtomicUsdc,
  formatEloInteger,
  formatShareUnits6,
  useConsoleVault,
} from "./ConsoleVaultContext";

const CONSOLE_TABS: readonly {
  id: string;
  href: string;
  shortCode: string;
  label: string;
  mobileLabel: string;
}[] = [
  {
    id: "console-tab-protocol",
    href: "/protocol",
    shortCode: "RPC",
    label: "Protocol Inspector & Live Execution Console",
    mobileLabel: "Protocol",
  },
  {
    id: "console-tab-borel",
    href: "/play/borel",
    shortCode: "#001",
    label: "Reference Harness #001 (Protocol Integration Demo)",
    mobileLabel: "#001 Harness",
  },
  {
    id: "console-tab-pulse-runner",
    href: "/play/pulse-runner",
    shortCode: "#002",
    label: "Reference Harness #002: Pulse Runner",
    mobileLabel: "#002 Runner",
  },
  {
    id: "console-tab-studio",
    href: "/studio",
    shortCode: "IDE",
    label: "Vibe Studio & Wallet SDK",
    mobileLabel: "Studio",
  },
];

export function ConsoleShellHeader(): React.JSX.Element {
  const pathname = usePathname();
  const {
    cashUsdcAtomic,
    earnedStocks,
    marketEloScaled,
    sessionKeyActive,
    openCashier,
  } = useConsoleVault();

  const totalStockUnits = earnedStocks.NVDAx + earnedStocks.ANTx + earnedStocks.SPYx + earnedStocks.TSLAx;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#050609]/88 backdrop-blur-2xl">
      <div className="mx-auto max-w-[1440px] px-3 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Brand Logo -> Landing */}
          <div className="flex items-center gap-3">
            <Link
              id="console-home-logo-link"
              href="/"
              aria-label="Return to CartridgeFi Landing Page"
              className="rounded-xl p-1 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            >
              <CartridgeFiLogo size="sm" showTag />
            </Link>

            {/* Live MagicBlock Private ER Latency Pill */}
            <GlassPill
              id="console-per-latency-pill"
              tone="violet"
              size="xs"
              className="hidden xl:inline-flex font-mono tabular-nums"
            >
              <MagicBlockLogoMark size={12} illuminated />
              <span>10ms PER · {CARTRIDGE_PROGRAM_IDS.erRoom.slice(0, 8)}…</span>
            </GlassPill>

            {/* Session Key Zero-Popup Status Badge */}
            <GlassPill
              id="console-session-key-badge"
              tone={sessionKeyActive ? "emerald" : "amber"}
              size="xs"
              className="hidden lg:inline-flex font-mono tabular-nums"
            >
              <LivePulseDot tone={sessionKeyActive ? "emerald" : "amber"} size="sm" />
              <span>0 Popups · Kora Gasless</span>
            </GlassPill>
          </div>

          {/* Unified Cash & Earned Stock Vault Balance Pill */}
          <div className="flex items-center gap-2">
            <span
              id="console-passport-elo-pill"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#0A0D14] px-2.5 py-1.5 font-mono text-xs text-slate-200 tabular-nums"
            >
              <span className="text-slate-400">ELO</span>
              <span className="font-bold text-[#00D4FF]">
                {formatEloInteger(marketEloScaled)}
              </span>
            </span>

            <button
              id="console-vault-cashier-btn"
              type="button"
              onClick={openCashier}
              className="cf-glass inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 font-mono text-xs font-semibold text-white tabular-nums touch-manipulation transition-colors hover:border-[#00F59B]/45 hover:bg-[#151B2B]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            >
              <LivePulseDot tone="emerald" size="sm" />
              <span>{formatAtomicUsdc(cashUsdcAtomic)}</span>
              <span className="hidden md:inline text-slate-400">·</span>
              <span className="hidden md:inline text-[#00F59B]">
                +{formatShareUnits6(totalStockUnits, 2)} xStocks
              </span>
            </button>
          </div>
        </div>

        {/* 1-Click Cartridge Switcher Bar */}
        <nav
          aria-label="Console Cartridge Switcher"
          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2"
        >
          <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4 lg:flex lg:w-auto lg:flex-wrap lg:gap-2">
            {CONSOLE_TABS.map((tab) => {
              const isActive =
                pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.id}
                  id={tab.id}
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-center text-[11px] font-semibold touch-manipulation transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] sm:px-3.5 sm:text-xs ${
                    isActive
                      ? "border-[#00F59B]/55 bg-[#00F59B]/14 text-white shadow-[inset_0_1px_0_0_rgba(0,245,155,0.28)]"
                      : "border-white/10 bg-[#0A0D14]/85 text-slate-300 hover:border-white/22 hover:text-white"
                  }`}
                >
                  {isActive ? <LivePulseDot tone="emerald" size="sm" /> : null}
                  <span className="truncate lg:hidden">{tab.mobileLabel}</span>
                  <span className="hidden lg:inline">{tab.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Mobile / Compact Telemetry Strip */}
          <div className="flex w-full items-center justify-between gap-2 font-mono text-[10px] text-slate-400 tabular-nums lg:hidden">
            <span translate="no">
              10ms PER · {CARTRIDGE_PROGRAM_IDS.erRoom.slice(0, 8)}…
            </span>
            <span className="text-[#00F59B]">0 Popups · Kora Gasless</span>
          </div>
        </nav>
      </div>
    </header>
  );
}
