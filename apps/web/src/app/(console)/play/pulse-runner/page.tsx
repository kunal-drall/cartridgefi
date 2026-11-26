import * as React from "react";
import type { Metadata } from "next";
import { PulseRunnerConsole } from "@/games/pulse-runner/PulseRunnerConsole";

export const metadata: Metadata = {
  title: "Play Pulse Runner (#002) — 60fps 3-Lane Volatility Arcade",
  description:
    "Play Pulse Runner (#002), a 60fps 3-lane arcade volatility runner bound to live Pyth feeds, Kalshi 1.5x portal gates, and the exact same cartridge-er-room contract as Borel.",
};

export default function PulseRunnerPlayPage(): React.JSX.Element {
  return <PulseRunnerConsole />;
}
