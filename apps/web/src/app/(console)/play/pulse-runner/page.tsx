import * as React from "react";
import type { Metadata } from "next";
import { PulseRunnerConsole } from "@/games/pulse-runner/PulseRunnerConsole";

export const metadata: Metadata = {
  title: "Pulse Runner — Continuous Stance Netting (#002)",
  description:
    "60fps 3-lane market runner driven by live SOL-USD WebSocket ticks and Solana Raydium NVDAx prices against the shared CartridgeFi ER Room program.",
};

export default function PulseRunnerPlayPage(): React.JSX.Element {
  return <PulseRunnerConsole />;
}
