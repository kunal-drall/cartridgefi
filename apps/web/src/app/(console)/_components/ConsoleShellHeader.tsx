"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet } from "lucide-react";
import { cn, shortenAddress } from "@/lib/utils";
import { WalletConnectButton } from "@/components/wallet/WalletConnect";
import {
  formatAtomicUsdc,
  formatSolLamports,
  useConsoleVault,
} from "./ConsoleVaultContext";

const WORKSPACE_TABS: readonly {
  id: string;
  href: string;
  label: string;
  mobileLabel: string;
}[] = [
  {
    id: "console-tab-borel",
    href: "/",
    label: "Borel",
    mobileLabel: "Borel",
  },
  {
    id: "console-tab-protocol",
    href: "/protocol",
    label: "Protocol",
    mobileLabel: "Protocol",
  },
];

export function ConsoleShellHeader(): React.JSX.Element {
  const pathname = usePathname();
  const {
    cashUsdcAtomic,
    onchainSolLamports,
    playerWallet,
    connectedBrowserWalletName,
    openCashier,
  } = useConsoleVault();

  return (
    <header className="sticky top-0 z-40 border-b border-[#22262e] bg-[#0b0c0e]">
      <div className="flex h-11 items-center justify-between gap-3 px-3">
        <div className="flex items-center gap-5 min-w-0">
          <Link
            id="console-home-logo-link"
            href="/"
            aria-label="Borel home"
            className="shrink-0 rounded py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
          >
            <span className="inline-flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-[-0.03em] text-[#f3f4f6]">
                Borel
              </span>
              <span className="rounded-[3px] border border-[#303642] px-1 font-mono text-[10px] text-[#9ca3af]">
                devnet
              </span>
            </span>
          </Link>

          {/* Desktop Navigation Tabs */}
          <nav
            aria-label="Workspace Navigation"
            className="hidden md:flex items-center gap-1"
          >
            {WORKSPACE_TABS.map((tab) => {
              const isActive =
                tab.href === "/"
                  ? pathname === "/" || pathname.startsWith("/play/borel")
                  : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.id}
                  id={tab.id}
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "cf-btn rounded-md px-2.5 py-1.5 text-xs font-medium",
                    isActive
                      ? "bg-[#171a20] text-[#f3f4f6] border border-[#303642]"
                      : "text-[#9ca3af] border border-transparent hover:bg-[#171a20]/60 hover:text-[#e5e7eb]",
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Live Network Readout & Wallet / Margin Control */}
        <div className="flex items-center gap-2 shrink-0">
          <WalletConnectButton />
          <button
            id="console-vault-cashier-btn"
            type="button"
            onClick={openCashier}
            className="cf-btn inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#303642] bg-[#171a20] px-2.5 py-1.5 font-mono text-xs font-medium text-[#f3f4f6] hover:bg-[#1d2129] active:scale-[0.97] tabular-nums"
          >
            <Wallet className="h-3.5 w-3.5 text-[#3b82f6]" />
            <span>{formatAtomicUsdc(cashUsdcAtomic)}</span>
            <span className="rounded-[3px] bg-[#f59e0b]/15 px-1 font-sans text-[10px] text-[#fbbf24]">
              paper
            </span>
            <span className="hidden sm:inline border-l border-[#303642] pl-2 text-[#9ca3af]">
              {onchainSolLamports > 0n
                ? formatSolLamports(onchainSolLamports)
                : playerWallet
                  ? shortenAddress(playerWallet, 4, 4)
                  : "Session Key"}
            </span>
            {connectedBrowserWalletName ? (
              <span className="hidden lg:inline rounded bg-[#2563eb]/20 px-1.5 py-0.5 font-sans text-[10px] text-[#93c5fd]">
                {connectedBrowserWalletName}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* Compact Mobile Workspace Tab Strip */}
      <nav
        aria-label="Mobile Workspace Navigation"
        className="flex items-center gap-1 overflow-x-auto border-t border-[#22262e] bg-[#0e1014] px-3 py-1.5 md:hidden"
      >
        {WORKSPACE_TABS.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/" || pathname.startsWith("/play/borel")
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={`mob-${tab.id}`}
              href={tab.href}
              className={cn(
                "shrink-0 rounded px-2.5 py-1 text-xs font-medium",
                isActive
                  ? "bg-[#2563eb] text-white"
                  : "text-[#9ca3af] hover:text-white",
              )}
            >
              {tab.mobileLabel}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
