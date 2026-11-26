import * as React from "react";
import type { Metadata } from "next";
import { ProtocolExecutionConsole } from "@/protocol/ProtocolExecutionConsole";

export const metadata: Metadata = {
  title: "Protocol Inspector & Live Execution Console — CartridgeFi Protocol",
  description:
    "Live Solana Devnet Program IDs, MagicBlock Ephemeral Rollup & Intel TDX Private ER latency probes, VRF verification, canonical platformFeeAccount SPL fee counter, and clickable Solscan proofs.",
};

function ProtocolConsoleFallback(): React.JSX.Element {
  return (
    <div className="cf-glass rounded-2xl p-6 font-mono text-xs text-slate-300">
      Loading CartridgeFi Protocol Execution Console…
    </div>
  );
}

export default function ProtocolPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<ProtocolConsoleFallback />}>
      <ProtocolExecutionConsole />
    </React.Suspense>
  );
}
