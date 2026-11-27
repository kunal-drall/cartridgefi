import * as React from "react";
import type { Metadata } from "next";
import { ProtocolExecutionConsole } from "@/protocol/ProtocolExecutionConsole";

export const metadata: Metadata = {
  title: "Protocol Inspector & Live Execution Console",
  description:
    "Live Solana Devnet and MagicBlock Ephemeral Rollup / Intel TDX program inspector with Borsh-decoded accounts and Solscan transaction proofs.",
};

export default function ProtocolPage(): React.JSX.Element {
  return <ProtocolExecutionConsole />;
}
