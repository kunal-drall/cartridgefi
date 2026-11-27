import * as React from "react";
import type { Metadata } from "next";
import { BorelProtocolInspector } from "@/protocol/BorelProtocolInspector";

export const metadata: Metadata = {
  title: "Protocol Inspector",
  description:
    "Live Solana devnet, MagicBlock Private ER / TEE, VRF and Pyth telemetry behind Borel sealed-conviction market showdowns.",
};

export default function ProtocolPage(): React.JSX.Element {
  return <BorelProtocolInspector />;
}
