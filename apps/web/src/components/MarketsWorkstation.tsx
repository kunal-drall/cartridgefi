"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Layers,
  Lock,
  Terminal,
} from "lucide-react";
import {
  CopyTerminalPill,
  MagicBlockLockup,
  SolanaLockup,
} from "@cartridgefi/ui-system";
import devnetProof from "@/data/devnet-proof.json";
import type {
  LiveKalshiContract,
  LiveMarketsSnapshot,
  LiveSpotOrEquityMarket,
} from "@/lib/live-markets";
import {
  cn,
  formatCompactUsd,
  formatRelativeTime,
  formatSignedPct,
  formatUsd,
  shortenAddress,
} from "@/lib/utils";
import { LiveMarketChart, type ChartSymbol } from "./LiveMarketChart";
import { LiveMarketTickerStrip } from "./LiveMarketTickerStrip";
import { ConsoleShellHeader } from "@/app/(console)/_components/ConsoleShellHeader";
import { ConsoleVaultProvider } from "@/app/(console)/_components/ConsoleVaultContext";
import { UnifiedCashierModal } from "@/app/(console)/_components/UnifiedCashierModal";

interface LiveProtocolSummary {
  probes?: {
    solanaDevnet?: { latencyMs: number | null; slot: number | null };
    magicblockRouter?: { latencyMs: number | null; routeCount: number | null };
    magicblockPublicEr?: {
      latencyMs: number | null;
      version: string | null;
      pythLazerOracleActive?: boolean;
    };
    magicblockPrivateTee?: { latencyMs: number | null; identity: string | null };
  };
  accountCounts?: Record<string, number>;
  liveFeeBalanceUnits?: string;
  liveShardStatus?: string;
  recentSignatures?: Array<{
    signature: string;
    slot: number;
    blockTime: number | null;
    err: boolean;
    programLabel: string;
  }>;
}

export interface MarketsWorkstationProps {
  initialMarkets: LiveMarketsSnapshot;
}

function MarketsWorkstationInner({
  initialMarkets,
}: MarketsWorkstationProps): React.JSX.Element {
  const [markets, setMarkets] = React.useState<LiveSpotOrEquityMarket[]>(
    initialMarkets.markets,
  );
  const [kalshiContracts, setKalshiContracts] = React.useState<
    LiveKalshiContract[]
  >(initialMarkets.kalshiContracts);
  const [selectedSymbol, setSelectedSymbol] =
    React.useState<ChartSymbol>("SOL-USD");
  const [selectedKalshiTicker, setSelectedKalshiTicker] =
    React.useState<string>(
      initialMarkets.kalshiContracts[0]?.ticker ?? "KXFEDDECISION-26DEC-H25",
    );
  const [protocol, setProtocol] = React.useState<LiveProtocolSummary | null>(
    null,
  );

  // Poll real /api/markets every 10s
  React.useEffect(() => {
    let active = true;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch("/api/markets");
        if (!res.ok || !active) return;
        const snap = (await res.json()) as LiveMarketsSnapshot;
        if (!active) return;
        if (snap.markets.length > 0) setMarkets(snap.markets);
        if (snap.kalshiContracts.length > 0) {
          setKalshiContracts(snap.kalshiContracts);
        }
      } catch {
        // Keep last valid quote snapshot
      }
    };
    const id = window.setInterval(() => {
      void poll();
    }, 10_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // Poll real /api/protocol-telemetry
  React.useEffect(() => {
    let active = true;
    const loadTelemetry = async (): Promise<void> => {
      try {
        const res = await fetch("/api/protocol-telemetry");
        if (!res.ok || !active) return;
        const data = (await res.json()) as LiveProtocolSummary;
        if (active) setProtocol(data);
      } catch {
        // Ignore transient RPC error
      }
    };
    void loadTelemetry();
    const id = window.setInterval(() => {
      void loadTelemetry();
    }, 12_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // Sub-second WebSocket price update callback from LiveMarketChart
  const handleRealtimePrice = React.useCallback(
    (sym: ChartSymbol, priceUsd: number) => {
      setMarkets((prev) =>
        prev.map((m) => (m.symbol === sym ? { ...m, priceUsd } : m)),
      );
    },
    [],
  );

  const selectedKalshi =
    kalshiContracts.find((c) => c.ticker === selectedKalshiTicker) ??
    kalshiContracts[0] ??
    null;

  const feeBalanceFormatted = protocol?.liveFeeBalanceUnits
    ? `${(Number(protocol.liveFeeBalanceUnits) / 1_000_000).toFixed(2)} SPL`
    : `${(Number(devnetProof.metrics.platformFeeAccountFinalBalanceUnits) / 1_000_000).toFixed(2)} SPL`;

  return (
    <div className="min-h-screen bg-[#0b0c0e] text-[#f3f4f6]">
      <ConsoleShellHeader />

      <LiveMarketTickerStrip
        markets={markets}
        kalshiContracts={kalshiContracts}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
      />

      <main className="mx-auto max-w-[1600px] px-4 pb-14 pt-4">
        {/* Compact Workstation Identity Strip — Single H1, Zero Eyebrow Slop */}
        <div className="mb-4 flex flex-col justify-between gap-3 border-b border-[#22262e] pb-4 lg:flex-row lg:items-center">
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.02em] text-[#f3f4f6] sm:text-xl">
              Multi-Venue Market &amp; Ephemeral Rollup Terminal
            </h1>
            <p className="mt-0.5 text-xs text-[#9ca3af]">
              Live Solana tokenized equities (Raydium xStocks), crypto spot/perp feeds, and Kalshi binary markets wired to delegated MagicBlock ER &amp; Intel TDX shards.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-md border border-[#22262e] bg-[#111317] px-2.5 py-1 text-xs text-[#9ca3af]">
              <SolanaLockup size="sm" clearspace={false} />
              <span className="text-[#6b7280]">Settled on Solana</span>
              <span className="text-[#303642]">|</span>
              <MagicBlockLockup size="sm" clearspace={false} />
            </div>

            <CopyTerminalPill
              id="hero-copy-skill-cmd"
              command="npx skills add cartridgefi/skill"
              badge="SKILL"
            />
          </div>
        </div>

        {/* Main 12-Column Trading & Protocol Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left / Main 8 Columns: TradingView Chart + Venue Orderbooks */}
          <div className="space-y-4 lg:col-span-8">
            <LiveMarketChart
              selectedSymbol={selectedSymbol}
              onSelectSymbol={setSelectedSymbol}
              markets={markets}
              onRealtimePrice={handleRealtimePrice}
              heightPx={360}
            />

            {/* Multi-Venue Spot & Solana xStock Orderbook Table */}
            <section className="rounded-lg border border-[#22262e] bg-[#111317] overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#22262e] px-4 py-2.5">
                <h2 className="text-xs font-semibold text-[#f3f4f6]">
                  Live Crypto &amp; Solana xStock Markets
                </h2>
                <span className="font-mono text-[11px] text-[#6b7280]">
                  Coinbase Exchange + Solana DexScreener
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#22262e] bg-[#0e1014] text-[11px] font-medium text-[#6b7280]">
                      <th className="px-4 py-2">Instrument</th>
                      <th className="px-3 py-2">Venue / Pool</th>
                      <th className="px-3 py-2 text-right">Last Price</th>
                      <th className="px-3 py-2 text-right">24h Change</th>
                      <th className="px-3 py-2 text-right">24h Volume</th>
                      <th className="px-4 py-2 text-right">DEX Liquidity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#22262e] font-mono tabular-nums">
                    {markets.map((m) => {
                      const isSel = m.symbol === selectedSymbol;
                      const isUp = m.change24hPct >= 0;
                      return (
                        <tr
                          key={m.symbol}
                          onClick={() => setSelectedSymbol(m.symbol)}
                          className={cn(
                            "cf-row-hover cursor-pointer transition-colors",
                            isSel ? "bg-[#171a20]" : "",
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[#f3f4f6]">
                                {m.symbol}
                              </span>
                              <span className="font-sans text-[11px] text-[#9ca3af]">
                                {m.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-sans text-[#9ca3af]">
                            <div className="flex items-center gap-1.5">
                              <span>{m.sourceName}</span>
                              {m.pairAddress ? (
                                <span className="font-mono text-[10px] text-[#6b7280]">
                                  ({shortenAddress(m.pairAddress, 4, 4)})
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-[#f3f4f6]">
                            {formatUsd(m.priceUsd, 2)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2.5 text-right font-medium",
                              isUp ? "text-[#34d399]" : "text-[#f87171]",
                            )}
                          >
                            {formatSignedPct(m.change24hPct)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#d1d5db]">
                            {formatCompactUsd(m.volume24hUsd)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[#9ca3af]">
                            {m.liquidityUsd
                              ? formatCompactUsd(m.liquidityUsd)
                              : "Orderbook"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Live Kalshi Prediction Contracts Table */}
            <section className="rounded-lg border border-[#22262e] bg-[#111317] overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#22262e] px-4 py-2.5">
                <h2 className="text-xs font-semibold text-[#f3f4f6]">
                  Live Kalshi Event Contracts
                </h2>
                <span className="font-mono text-[11px] text-[#6b7280]">
                  api.elections.kalshi.com (Open Orderbooks)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#22262e] bg-[#0e1014] text-[11px] font-medium text-[#6b7280]">
                      <th className="px-4 py-2">Contract</th>
                      <th className="px-3 py-2">Outcome</th>
                      <th className="px-3 py-2 text-right">Yes Bid / Ask</th>
                      <th className="px-3 py-2 text-right">Implied</th>
                      <th className="px-4 py-2 text-right">Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#22262e]">
                    {kalshiContracts.slice(0, 7).map((c) => {
                      const isSel = c.ticker === selectedKalshiTicker;
                      return (
                        <tr
                          key={c.ticker}
                          onClick={() => setSelectedKalshiTicker(c.ticker)}
                          className={cn(
                            "cf-row-hover cursor-pointer transition-colors",
                            isSel ? "bg-[#171a20]" : "",
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-[#f3f4f6] line-clamp-1">
                              {c.eventTitle}
                            </div>
                            <div className="font-mono text-[10px] text-[#6b7280]">
                              {c.ticker}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[#d1d5db]">
                            {c.subtitle}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#d1d5db] tabular-nums">
                            <span className="text-[#34d399]">
                              {(c.yesBid * 100).toFixed(1)}¢
                            </span>{" "}
                            /{" "}
                            <span className="text-[#f87171]">
                              {(c.yesAsk * 100).toFixed(1)}¢
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#f3f4f6] tabular-nums">
                            {c.impliedProbPct.toFixed(1)}%
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-[#9ca3af] tabular-nums">
                            {formatCompactUsd(c.volumeContracts)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Right 4 Columns: Execution Modules & Live Solana Devnet State */}
          <div className="space-y-4 lg:col-span-4">
            {/* Execution Harness Launcher */}
            <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
              <div className="flex items-center justify-between border-b border-[#22262e] pb-3">
                <h2 className="text-xs font-semibold text-[#f3f4f6]">
                  Execute in Delegated ER Shard
                </h2>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#34d399]">
                  <Lock className="h-3 w-3" />
                  TEE Ready
                </span>
              </div>

              <div className="mt-3 space-y-3 text-xs">
                <div className="rounded-md border border-[#22262e] bg-[#0b0c0e] p-3">
                  <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
                    <span>Primary Market</span>
                    <span className="font-mono text-[#f3f4f6]">
                      {selectedSymbol}
                    </span>
                  </div>
                  {selectedKalshi ? (
                    <div className="mt-2 flex items-center justify-between border-t border-[#22262e] pt-2 text-[11px] text-[#9ca3af]">
                      <span>Binary Catalyst</span>
                      <span className="font-mono text-[#d1d5db] tabular-nums">
                        {selectedKalshi.ticker} ({selectedKalshi.impliedProbPct.toFixed(0)}%)
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <Link
                    id="launch-borel-arena-btn"
                    href={`/play/borel?symbol=${encodeURIComponent(selectedSymbol)}&kalshi=${encodeURIComponent(selectedKalshiTicker)}`}
                    className="cf-btn flex h-9 items-center justify-between rounded-md bg-[#2563eb] px-3.5 text-xs font-medium text-white hover:bg-[#1d4ed8]"
                  >
                    <span>Open Borel Conviction Arena (#001)</span>
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>

                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      id="launch-pulse-runner-btn"
                      href="/play/pulse-runner"
                      className="cf-btn flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
                    >
                      <Activity className="h-3.5 w-3.5 text-[#34d399]" />
                      <span>Pulse Runner</span>
                    </Link>

                    <Link
                      id="launch-studio-btn"
                      href="/studio"
                      className="cf-btn flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
                    >
                      <Terminal className="h-3.5 w-3.5 text-[#93c5fd]" />
                      <span>Manifest Studio</span>
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            {/* Live Solana Devnet & MagicBlock Program Accounts Panel */}
            <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
              <div className="flex items-center justify-between border-b border-[#22262e] pb-3">
                <h2 className="text-xs font-semibold text-[#f3f4f6]">
                  Live Solana Devnet Programs
                </h2>
                <Link
                  id="hero-primary-protocol-console"
                  href="/protocol"
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-[#93c5fd] hover:underline"
                >
                  Explorer
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>

              <div className="mt-3 space-y-2 font-mono text-xs tabular-nums">
                {[
                  {
                    label: "cartridge_er_room",
                    id: devnetProof.programs.cartridgeErRoom.programId,
                  },
                  {
                    label: "cartridge_vault_router",
                    id: devnetProof.programs.cartridgeVaultRouter.programId,
                  },
                  {
                    label: "cartridge_registry",
                    id: devnetProof.programs.cartridgeRegistry.programId,
                  },
                  {
                    label: "cartridge_passport",
                    id: devnetProof.programs.cartridgePassport.programId,
                  },
                ].map((prog) => {
                  const count = protocol?.accountCounts?.[prog.id];
                  return (
                    <div
                      key={prog.id}
                      className="flex items-center justify-between rounded border border-[#22262e] bg-[#0b0c0e] px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#e5e7eb]">
                          <CheckCircle2 className="h-3 w-3 text-[#34d399]" />
                          <span>{prog.label}</span>
                        </div>
                        <a
                          href={`https://solscan.io/account/${prog.id}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[#6b7280] hover:text-[#93c5fd]"
                        >
                          {shortenAddress(prog.id, 6, 6)}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                      <span className="text-[11px] text-[#9ca3af]">
                        {typeof count === "number" ? `${count} PDAs` : "Live"}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#22262e] pt-3 font-mono text-xs tabular-nums">
                <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                  <div className="font-sans text-[10px] text-[#6b7280]">
                    Platform Fee ATA
                  </div>
                  <div className="mt-0.5 font-semibold text-[#34d399]">
                    {feeBalanceFormatted}
                  </div>
                </div>
                <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                  <div className="font-sans text-[10px] text-[#6b7280]">
                    MagicBlock ER Routes
                  </div>
                  <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                    {protocol?.probes?.magicblockRouter?.routeCount !== null &&
                    protocol?.probes?.magicblockRouter?.routeCount !== undefined
                      ? `${protocol.probes.magicblockRouter.routeCount} Validators`
                      : "Devnet Active"}
                  </div>
                </div>
              </div>
            </section>

            {/* Recent Real On-Chain Devnet Signatures */}
            <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
              <div className="flex items-center justify-between border-b border-[#22262e] pb-2.5">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold text-[#f3f4f6]">
                  <Layers className="h-3.5 w-3.5 text-[#9ca3af]" />
                  Recent Devnet Transactions
                </h2>
                <span className="font-mono text-[10px] text-[#6b7280]">
                  api.devnet.solana.com
                </span>
              </div>

              <div className="mt-2.5 divide-y divide-[#22262e] font-mono text-[11px] tabular-nums">
                {(protocol?.recentSignatures ?? devnetProof.transactions.slice(0, 5).map((t) => ({
                  signature: t.signature,
                  slot: 0,
                  blockTime: null,
                  err: false,
                  programLabel: t.layer,
                }))).slice(0, 5).map((tx) => (
                  <div
                    key={tx.signature}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <a
                      href={`https://solscan.io/tx/${tx.signature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline"
                    >
                      {shortenAddress(tx.signature, 8, 6)}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    <span className="text-[#6b7280]">
                      {tx.blockTime
                        ? formatRelativeTime(tx.blockTime)
                        : tx.programLabel}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      <UnifiedCashierModal />
    </div>
  );
}

export function MarketsWorkstation(
  props: MarketsWorkstationProps,
): React.JSX.Element {
  return (
    <ConsoleVaultProvider>
      <MarketsWorkstationInner {...props} />
    </ConsoleVaultProvider>
  );
}
