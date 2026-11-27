"use client";

import * as React from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { ExternalLink, Radio } from "lucide-react";
import type {
  LiveCandlesResponse,
  LiveSpotOrEquityMarket,
  OhlcvBar,
} from "@/lib/live-markets";
import { cn, formatCompactUsd, formatSignedPct, formatUsd } from "@/lib/utils";

export type ChartSymbol = "SOL-USD" | "BTC-USD" | "NVDAx" | "SPYx" | "TSLAx";
export type ChartInterval = "5m" | "15m" | "1h";

const SYMBOLS: readonly { id: ChartSymbol; label: string; tag: string }[] = [
  { id: "SOL-USD", label: "SOL-USD", tag: "Perp / Spot" },
  { id: "NVDAx", label: "NVDAx", tag: "xStock SPL" },
  { id: "SPYx", label: "SPYx", tag: "xStock SPL" },
  { id: "TSLAx", label: "TSLAx", tag: "xStock SPL" },
  { id: "BTC-USD", label: "BTC-USD", tag: "Perp / Spot" },
];

const INTERVALS: readonly ChartInterval[] = ["5m", "15m", "1h"];

export interface LiveMarketChartProps {
  selectedSymbol: ChartSymbol;
  onSelectSymbol?: (symbol: ChartSymbol) => void;
  markets: readonly LiveSpotOrEquityMarket[];
  onRealtimePrice?: (symbol: ChartSymbol, priceUsd: number) => void;
  heightPx?: number;
  className?: string;
}

export function LiveMarketChart({
  selectedSymbol,
  onSelectSymbol,
  markets,
  onRealtimePrice,
  heightPx = 330,
  className,
}: LiveMarketChartProps): React.JSX.Element {
  const [interval, setIntervalState] = React.useState<ChartInterval>("5m");
  const [bars, setBars] = React.useState<OhlcvBar[]>([]);
  const [sourceLabel, setSourceLabel] = React.useState<string>("Loading OHLCV…");
  const [loading, setLoading] = React.useState<boolean>(true);
  const [wsConnected, setWsConnected] = React.useState<boolean>(false);
  const [liveTickPrice, setLiveTickPrice] = React.useState<number | null>(null);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastBarRef = React.useRef<OhlcvBar | null>(null);
  const onRealtimePriceRef = React.useRef(onRealtimePrice);
  onRealtimePriceRef.current = onRealtimePrice;

  const activeMarket = markets.find((m) => m.symbol === selectedSymbol);

  // Reset live tick override when symbol changes
  React.useEffect(() => {
    setLiveTickPrice(null);
  }, [selectedSymbol]);

  // Initialize TradingView lightweight-charts v5 instance
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: Math.max(260, el.clientWidth),
      height: heightPx,
      layout: {
        background: { type: ColorType.Solid, color: "#111317" },
        textColor: "#9ca3af",
        fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1a1d24" },
        horzLines: { color: "#1a1d24" },
      },
      crosshair: {
        vertLine: { color: "#383f4d", labelBackgroundColor: "#2563eb" },
        horzLine: { color: "#383f4d", labelBackgroundColor: "#2563eb" },
      },
      rightPriceScale: {
        borderColor: "#22262e",
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#22262e",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        chart.applyOptions({ width: Math.floor(rect.width) });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [heightPx]);

  // Fetch real OHLCV candles whenever symbol or interval changes
  React.useEffect(() => {
    let active = true;
    setLoading(true);

    const load = async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/candles?symbol=${encodeURIComponent(selectedSymbol)}&interval=${encodeURIComponent(interval)}`,
        );
        if (!res.ok || !active) return;
        const payload = (await res.json()) as LiveCandlesResponse;
        if (!active) return;

        setBars(payload.bars);
        setSourceLabel(payload.source);
        setLoading(false);

        if (payload.bars.length > 0 && candleSeriesRef.current && volumeSeriesRef.current) {
          candleSeriesRef.current.setData(
            payload.bars.map((b) => ({
              time: b.time as Time,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
            })),
          );
          volumeSeriesRef.current.setData(
            payload.bars.map((b) => ({
              time: b.time as Time,
              value: b.volume,
              color:
                b.close >= b.open
                  ? "rgba(16, 185, 129, 0.24)"
                  : "rgba(239, 68, 68, 0.24)",
            })),
          );
          lastBarRef.current = payload.bars[payload.bars.length - 1] ?? null;
          chartRef.current?.timeScale().fitContent();
        }
      } catch {
        if (active) {
          setLoading(false);
          setSourceLabel("Feed temporarily unreachable");
        }
      }
    };

    void load();
    const pollId = window.setInterval(() => {
      void load();
    }, 20_000);

    return () => {
      active = false;
      window.clearInterval(pollId);
    };
  }, [selectedSymbol, interval]);

  // Real-time browser WebSocket trade feed from Coinbase Exchange for SOL-USD / BTC-USD
  React.useEffect(() => {
    if (selectedSymbol !== "SOL-USD" && selectedSymbol !== "BTC-USD") {
      setWsConnected(false);
      return;
    }
    if (typeof WebSocket === "undefined") return;

    let closed = false;
    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket("wss://ws-feed.exchange.coinbase.com");
      socket.onopen = () => {
        if (closed || !socket) return;
        setWsConnected(true);
        socket.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [selectedSymbol],
            channels: ["ticker"],
          }),
        );
      };

      socket.onmessage = (evt) => {
        if (closed) return;
        try {
          const msg = JSON.parse(String(evt.data)) as {
            type?: string;
            product_id?: string;
            price?: string;
          };
          if (msg.type === "ticker" && msg.product_id === selectedSymbol && msg.price) {
            const p = Number(msg.price);
            if (!Number.isFinite(p) || p <= 0) return;
            setLiveTickPrice(p);
            onRealtimePriceRef.current?.(selectedSymbol, p);

            const cur = lastBarRef.current;
            if (cur && candleSeriesRef.current) {
              const updated: OhlcvBar = {
                ...cur,
                high: Math.max(cur.high, p),
                low: Math.min(cur.low, p),
                close: p,
              };
              lastBarRef.current = updated;
              candleSeriesRef.current.update({
                time: updated.time as Time,
                open: updated.open,
                high: updated.high,
                low: updated.low,
                close: updated.close,
              });
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onerror = () => {
        if (!closed) setWsConnected(false);
      };
      socket.onclose = () => {
        if (!closed) setWsConnected(false);
      };
    } catch {
      setWsConnected(false);
    }

    return () => {
      closed = true;
      setWsConnected(false);
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close();
        } catch {
          // Ignore close race
        }
      }
    };
  }, [selectedSymbol]);

  const displayedPrice =
    liveTickPrice ??
    activeMarket?.priceUsd ??
    bars[bars.length - 1]?.close ??
    null;

  const chgPct = activeMarket?.change24hPct ?? 0;

  return (
    <div className={cn("flex flex-col border border-[#22262e] bg-[#111317] rounded-lg overflow-hidden", className)}>
      {/* Top Instrument Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#22262e] px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {SYMBOLS.map((sym) => {
            const isSel = sym.id === selectedSymbol;
            return (
              <button
                key={sym.id}
                id={`chart-symbol-${sym.id}`}
                type="button"
                onClick={() => onSelectSymbol?.(sym.id)}
                className={cn(
                  "cf-btn cursor-pointer rounded px-2.5 py-1 font-mono text-xs font-medium tabular-nums",
                  isSel
                    ? "bg-[#2563eb] text-white"
                    : "bg-transparent text-[#9ca3af] hover:bg-[#171a20] hover:text-[#f3f4f6]",
                )}
              >
                {sym.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              id={`chart-interval-${iv}`}
              type="button"
              onClick={() => setIntervalState(iv)}
              className={cn(
                "cf-btn cursor-pointer rounded px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums",
                interval === iv
                  ? "border border-[#303642] bg-[#171a20] text-[#f3f4f6]"
                  : "text-[#6b7280] hover:text-[#d1d5db]",
              )}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* Live Quote Readout Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#22262e] bg-[#0e1014] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-lg font-semibold text-[#f3f4f6] tabular-nums">
            {displayedPrice !== null ? formatUsd(displayedPrice, 2) : "—"}
          </span>
          {activeMarket ? (
            <span
              className={cn(
                "font-mono text-xs font-medium tabular-nums",
                chgPct >= 0 ? "text-[#34d399]" : "text-[#f87171]",
              )}
            >
              {formatSignedPct(chgPct)} (24h)
            </span>
          ) : null}
          {activeMarket && activeMarket.volume24hUsd > 0 ? (
            <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
              Vol {formatCompactUsd(activeMarket.volume24hUsd)}
            </span>
          ) : null}
          {activeMarket?.liquidityUsd ? (
            <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
              Pool Liq {formatCompactUsd(activeMarket.liquidityUsd)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-[#9ca3af]">
          {wsConnected ? (
            <span className="inline-flex items-center gap-1 text-[#34d399]">
              <Radio className="h-3 w-3" />
              WS Live
            </span>
          ) : null}
          <span className="truncate max-w-[220px]">{sourceLabel}</span>
          {activeMarket?.sourceUrl ? (
            <a
              href={activeMarket.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[#9ca3af] hover:text-white"
              title="Open external market venue"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>

      {/* Canvas Container */}
      <div className="relative w-full bg-[#111317]" style={{ height: `${heightPx}px` }}>
        <div ref={containerRef} className="h-full w-full" />
        {loading && bars.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#111317]/80 font-mono text-xs text-[#9ca3af]">
            Loading live OHLCV candles…
          </div>
        ) : null}
      </div>
    </div>
  );
}
