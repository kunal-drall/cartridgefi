import * as React from "react";
import type { Metadata } from "next";
import { VibeStudioConsole } from "@/studio/VibeStudioConsole";

export const metadata: Metadata = {
  title: "Manifest Studio & Solvency Compiler",
  description:
    "Compile CartridgeManifest v2 specifications with Vercel AI SDK and MCP tools, verify 500-tick pool conservation, and execute register_cartridge on Solana Devnet.",
};

function StudioFallback(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-[#22262e] bg-[#111317] p-6 font-mono text-xs text-[#9ca3af]">
      Loading Manifest Studio…
    </div>
  );
}

export default function StudioPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<StudioFallback />}>
      <VibeStudioConsole />
    </React.Suspense>
  );
}
