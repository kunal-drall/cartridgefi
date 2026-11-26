import * as React from "react";
import type { Metadata } from "next";
import { VibeStudioConsole } from "@/studio/VibeStudioConsole";

export const metadata: Metadata = {
  title: "Vibe Studio & Wallet SDK — Prompt-to-CartridgeManifest v2.0 IDE",
  description:
    "Compile natural-language market games into CartridgeManifest v2.0 PDAs, simulate 500 market ticks, deploy to Solana Devnet, and preview inside Solflare, Phantom, or Backpack with a 50% creator fee split.",
};

function VibeStudioFallback(): React.JSX.Element {
  return (
    <div className="cf-glass rounded-2xl p-6 font-mono text-xs text-slate-300">
      Loading CartridgeFi Vibe Studio Compiler…
    </div>
  );
}

export default function VibeStudioPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<VibeStudioFallback />}>
      <VibeStudioConsole />
    </React.Suspense>
  );
}
