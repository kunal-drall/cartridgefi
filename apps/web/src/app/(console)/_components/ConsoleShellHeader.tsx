"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet } from "lucide-react";
import { CartridgeFiLogo } from "@cartridgefi/ui-system";
import { cn, shortenAddress } from "@/lib/utils";
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
    id: "console-tab-markets",
    href: "/",
    label: "Markets",
    mobileLabel: "Markets",
  },
  {
    id: "console-tab-borel",
    href: "/play/borel",
    label: "Borel Arena",
    mobileLabel: "Borel",
  },
  {
    id: "console-tab-pulse-runner",
    href: "/play/pulse-runner",
    label: "Pulse Runner",
    mobileLabel: "Runner",
  },
  {
    id: "console-tab-studio",
    href: "/studio",
    label: "Manifest Studio",
    mobileLabel: "Studio",
  },
  {
    id: "console-tab-protocol",
    href: "/protocol",
    label: "Protocol Explorer",
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

  const [devnetSlot, setDevnetSlot] = React.useState<number | null>(null);
  const [devnetLatency, setDevnetLatency] = React.useState<number | null>(null);

  React.useEffect(() => {
    let active = true;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch("/api/protocol-telemetry");
        if (!res.ok || !active) return;
        const json = (await res.json()) as {
          probes?: {
            solanaDevnet?: { slot?: number | null; latencyMs?: number | null };
          };
        };
        if (!active) return;
        setDevnetSlot(json.probes?.solanaDevnet?.slot ?? null);
        setDevnetLatency(json.probes?.solanaDevnet?.latencyMs ?? null);
      } catch {
        // Silent retry on next interval
      }
    };
    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 15_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-[#22262e] bg-[#0b0c0e]">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-5 min-w-0">
          <Link
            id="console-home-logo-link"
            href="/"
            aria-label="CartridgeFi Markets Home"
            className="shrink-0 rounded py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
          >
            <CartridgeFiLogo size="sm" showTag />
          </Link>

          {/* Desktop Navigation Tabs */}
          <nav
            aria-label="Workspace Navigation"
            className="hidden md:flex items-center gap-1"
          >
            {WORKSPACE_TABS.map((tab) => {
              const isActive =
                tab.href === "/"
                  ? pathname === "/"
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
          <Link
            href="/protocol"
            className="hidden xl:inline-flex items-center gap-2 rounded-md border border-[#22262e] bg-[#111317] px-2.5 py-1 font-mono text-[11px] text-[#9ca3af] hover:border-[#303642] hover:text-[#e5e7eb] tabular-nums"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                devnetSlot !== null ? "bg-[#10b981]" : "bg-[#f59e0b]",
              )}
            />
            <span>
              {devnetSlot !== null
                ? `Slot ${devnetSlot.toLocaleString()}`
                : "Devnet RPC"}
            </span>
            {devnetLatency !== null ? (
              <span className="text-[#6b7280]">{devnetLatency}ms</span>
            ) : null}
          </Link>

          <button
            id="console-vault-cashier-btn"
            type="button"
            onClick={openCashier}
            className="cf-btn inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#303642] bg-[#171a20] px-2.5 py-1.5 font-mono text-xs font-medium text-[#f3f4f6] hover:bg-[#1d2129] active:scale-[0.97] tabular-nums"
          >
            <Wallet className="h-3.5 w-3.5 text-[#3b82f6]" />
            <span>{formatAtomicUsdc(cashUsdcAtomic)}</span>
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
              ? pathname === "/"
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
