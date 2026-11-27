import * as React from "react";
import type { Metadata } from "next";
import { BorelArenaConsole } from "@/games/borel/BorelArenaConsole";

export const metadata: Metadata = {
  title: "Borel Conviction Arena (#001)",
  description:
    "Multi-asset conviction terminal on Solana and MagicBlock Private ER TEE with live TradingView charts, Kalshi event contracts, and tokenized equity settlement.",
};

function BorelArenaFallback(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-[#22262e] bg-[#111317] p-6 font-mono text-xs text-[#9ca3af]">
      Loading Borel Conviction Arena…
    </div>
  );
}

export default function BorelPlayPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<BorelArenaFallback />}>
      <BorelArenaConsole />
    </React.Suspense>
  );
}
