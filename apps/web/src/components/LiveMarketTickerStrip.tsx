"use client";

import * as React from "react";
import type {
  LiveKalshiContract,
  LiveSpotOrEquityMarket,
} from "@/lib/live-markets";
import { cn, formatSignedPct, formatUsd } from "@/lib/utils";
import type { ChartSymbol } from "./LiveMarketChart";

export interface LiveMarketTickerStripProps {
  markets: readonly LiveSpotOrEquityMarket[];
  kalshiContracts: readonly LiveKalshiContract[];
  selectedSymbol?: ChartSymbol;
  onSelectSymbol?: (sym: ChartSymbol) => void;
}

export function LiveMarketTickerStrip({
  markets,
  kalshiContracts,
  selectedSymbol,
  onSelectSymbol,
}: LiveMarketTickerStripProps): React.JSX.Element {
  const topKalshi = kalshiContracts.slice(0, 2);

  return (
    <div className="w-full border-b border-[#22262e] bg-[#0e1014] overflow-x-auto">
      <div className="mx-auto flex h-9 max-w-[1600px] items-center gap-4 px-4 font-mono text-xs whitespace-nowrap">
        {markets.length === 0 ? (
          <span className="text-[#6b7280]">Connecting to live market feeds…</span>
        ) : (
          markets.map((m) => {
            const isUp = m.change24hPct >= 0;
            const isActive = selectedSymbol === m.symbol;
            return (
              <button
                key={m.symbol}
                type="button"
                onClick={() => onSelectSymbol?.(m.symbol)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors tabular-nums",
                  isActive
                    ? "bg-[#171a20] text-white"
                    : "text-[#d1d5db] hover:bg-[#171a20]",
                )}
              >
                <span className="font-semibold text-[#f3f4f6]">{m.symbol}</span>
                <span>{formatUsd(m.priceUsd, 2)}</span>
                <span className={isUp ? "text-[#34d399]" : "text-[#f87171]"}>
                  {formatSignedPct(m.change24hPct)}
                </span>
              </button>
            );
          })
        )}

        {topKalshi.map((k) => (
          <a
            key={k.ticker}
            href={k.kalshiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden xl:inline-flex items-center gap-1.5 border-l border-[#22262e] pl-4 text-[#9ca3af] hover:text-[#f3f4f6] tabular-nums"
          >
            <span className="text-[#d1d5db]">{k.ticker}</span>
            <span className="truncate max-w-[160px] font-sans text-[11px] text-[#9ca3af]">
              {k.subtitle}
            </span>
            <span className="text-[#34d399]">
              {(k.lastPrice * 100).toFixed(0)}¢
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
