"use client";

import * as React from "react";
import { formatUnits } from "./facts";

type MarketRow = {
  symbol: string;
  assetClass: string;
  sourceName: string;
  liquidityUsd: number | null;
};

type MarketsResponse = {
  ok: boolean;
  fetchedAtIso: string;
  markets: MarketRow[];
};

type LiveState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; asOf: string; rows: { symbol: string; millions: string }[] };

/** Integer-only USD -> "$3.72M" (hundredths of a million, rounded once at the API boundary). */
function toMillions(usd: number): string {
  const hundredthsOfMillion = BigInt(Math.round(usd / 10_000));
  return formatUnits(hundredthsOfMillion, 2, 2);
}

export function LiveLiquidity({ style }: { style?: React.CSSProperties }) {
  const [state, setState] = React.useState<LiveState>({ status: "loading" });

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/markets", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MarketsResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        const rows = data.markets
          .filter((m) => m.assetClass === "SOLANA_XSTOCK" && typeof m.liquidityUsd === "number" && m.liquidityUsd > 0)
          .map((m) => ({ symbol: m.symbol, millions: toMillions(m.liquidityUsd as number) }));
        if (!data.ok || rows.length === 0) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", asOf: data.fetchedAtIso, rows });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.status !== "ready") {
    return <div data-live-state={state.status} style={{ display: "none" }} />;
  }

  return (
    <div data-live-state="ready" style={style}>
      <span style={{ color: "#a3aab6" }}>Live xStocks pool liquidity on Solana</span>
      {state.rows.map((row) => (
        <span key={row.symbol} style={{ color: "#f3f4f6" }}>
          {row.symbol} <span style={{ color: "#22c08a" }}>${row.millions}M</span>
        </span>
      ))}
      <span style={{ color: "#6b7280" }}>
        Raydium via DexScreener · as of {state.asOf.slice(0, 10)} {state.asOf.slice(11, 19)} UTC
      </span>
    </div>
  );
}
