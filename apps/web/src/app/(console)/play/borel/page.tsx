import * as React from "react";
import type { Metadata } from "next";
import { BorelArenaConsole } from "@/games/borel/BorelArenaConsole";

export const metadata: Metadata = {
  title: "Play BOREL (#001) — Game-Day & Blind Conviction Blitz Arena",
  description:
    "Play Borel (#001), CartridgeFi's flagship multiplayer Game-Day & Blind Conviction Blitz arena on Solana and MagicBlock Private ER TEEs with zero wallet popups.",
};

function BorelArenaFallback(): React.JSX.Element {
  return (
    <div className="cf-glass rounded-2xl p-6 font-mono text-xs text-slate-300">
      Initializing Borel Private ER Pod…
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
