"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Copy } from "lucide-react";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  USDC_UNIT,
  computePoolAndFeeDistribution,
  type CartridgeManifestV2,
} from "@cartridgefi/shared-types";
import { formatAtomicUsdc } from "@/app/(console)/_components/ConsoleVaultContext";
import { cn, shortenAddress } from "@/lib/utils";
import { toast } from "sonner";

export type WalletPreviewFrameMode =
  | "standalone"
  | "solflare"
  | "phantom"
  | "backpack";

interface WalletChromeMeta {
  id: WalletPreviewFrameMode;
  buttonId: string;
  label: string;
  brandTitle: string;
  partnerFeeVault: string;
}

const FRAME_MODES: readonly WalletChromeMeta[] = [
  {
    id: "standalone",
    buttonId: "frame-standalone",
    label: "Direct Web",
    brandTitle: "Direct Web (50% / 50% Split)",
    partnerFeeVault: "",
  },
  {
    id: "solflare",
    buttonId: "frame-solflare",
    label: "Solflare",
    brandTitle: "Solflare Partner Sheet (40% / 30% / 30%)",
    partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
  },
  {
    id: "phantom",
    buttonId: "frame-phantom",
    label: "Phantom",
    brandTitle: "Phantom Mini-App Sheet (40% / 30% / 30%)",
    partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot2,
  },
  {
    id: "backpack",
    buttonId: "frame-backpack",
    label: "Backpack",
    brandTitle: "Backpack xNFT Sheet (40% / 30% / 30%)",
    partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot3,
  },
];

export interface WalletDeckPreviewProps {
  manifest: CartridgeManifestV2;
  playableHref: string;
}

export function WalletDeckPreview({
  manifest,
  playableHref,
}: WalletDeckPreviewProps): React.JSX.Element {
  const [frameMode, setFrameMode] =
    React.useState<WalletPreviewFrameMode>("solflare");

  const activeFrame =
    FRAME_MODES.find((f) => f.id === frameMode) ?? FRAME_MODES[0]!;
  const isPartnerSheet = frameMode !== "standalone";

  const splitSim = React.useMemo(() => {
    const sampleRoomPool = 200n * USDC_UNIT;
    return computePoolAndFeeDistribution({
      roomPoolUsdc: sampleRoomPool,
      totalFeeBps: 250,
      creatorShareBps: manifest.metadata.creatorFeeShareBps,
      partnerWalletActive: isPartnerSheet,
      playerScores: [
        { player: "p1", scoreScaled: 240_000_000n },
        { player: "p2", scoreScaled: 110_000_000n },
        { player: "p3", scoreScaled: 20_000_000n },
      ],
    });
  }, [isPartnerSheet, manifest.metadata.creatorFeeShareBps]);

  const deckEmbedSnippet = isPartnerSheet
    ? `import { CartridgeDeck } from "@cartridgefi/react";

export function PartnerEmbed() {
  return (
    <CartridgeDeck
      partnerId="${activeFrame.id}"
      partnerFeeVault="${activeFrame.partnerFeeVault}"
      defaultCartridgeSlug="${manifest.metadata.slug}"
      defaultFrameMode="${activeFrame.id}"
    />
  );
}`
    : `import { CartridgeDeck } from "@cartridgefi/react";

export function StandaloneEmbed() {
  return (
    <CartridgeDeck
      defaultCartridgeSlug="${manifest.metadata.slug}"
      defaultFrameMode="standalone"
    />
  );
}`;

  return (
    <section
      id="studio-wallet-preview-stage"
      className="rounded-lg border border-[#22262e] bg-[#111317] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#22262e] pb-3">
        <div>
          <h2 className="text-xs font-semibold text-[#f3f4f6]">
            &lt;CartridgeDeck/&gt; Partner Wallet Fee-Split Inspector
          </h2>
          <p className="mt-0.5 text-[11px] text-[#9ca3af]">
            Deterministic fee distribution across partner wallets, manifest creators, and protocol treasury.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {FRAME_MODES.map((m) => (
            <button
              key={m.id}
              id={m.buttonId}
              type="button"
              onClick={() => setFrameMode(m.id)}
              className={cn(
                "cf-btn cursor-pointer rounded border px-2.5 py-1 text-xs font-medium",
                frameMode === m.id
                  ? "border-[#3b82f6] bg-[#2563eb]/20 text-white"
                  : "border-[#303642] bg-[#171a20] text-[#9ca3af] hover:text-white",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Fee Split Breakdown */}
        <div className="space-y-2.5 lg:col-span-6">
          <div className="rounded-md border border-[#22262e] bg-[#0b0c0e] p-3 text-xs">
            <div className="flex items-center justify-between font-medium text-[#e5e7eb]">
              <span>{activeFrame.brandTitle}</span>
              <span className="font-mono text-[#9ca3af] tabular-nums">
                $200.00 Pool ($5.00 Fee)
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 font-mono tabular-nums">
              <div className="rounded border border-[#22262e] bg-[#111317] p-2">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Partner ({isPartnerSheet ? "40%" : "0%"})
                </div>
                <div className="mt-0.5 font-semibold text-[#93c5fd]">
                  {formatAtomicUsdc(splitSim.partnerFeeUsdc)}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#111317] p-2">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Creator ({isPartnerSheet ? "30%" : "50%"})
                </div>
                <div className="mt-0.5 font-semibold text-[#34d399]">
                  {formatAtomicUsdc(splitSim.creatorFeeUsdc)}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#111317] p-2">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Protocol ({isPartnerSheet ? "30%" : "50%"})
                </div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  {formatAtomicUsdc(splitSim.platformFeeUsdc)}
                </div>
              </div>
            </div>

            {activeFrame.partnerFeeVault ? (
              <div className="mt-2.5 flex items-center justify-between border-t border-[#22262e] pt-2 font-mono text-[11px] text-[#6b7280]">
                <span>Partner Vault PDA</span>
                <span className="text-[#9ca3af]">
                  {shortenAddress(activeFrame.partnerFeeVault, 6, 6)}
                </span>
              </div>
            ) : null}
          </div>

          <Link
            href={playableHref}
            className="cf-btn inline-flex h-8 items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
          >
            <span>Test Compiled Manifest in Terminal</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Clean React SDK Snippet */}
        <div className="lg:col-span-6">
          <div className="rounded-md border border-[#22262e] bg-[#0b0c0e] p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-[#9ca3af]">
              <span className="font-mono">@cartridgefi/react</span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(deckEmbedSnippet);
                    toast.success("Copied <CartridgeDeck/> snippet");
                  } catch {
                    // Ignore
                  }
                }}
                className="cf-btn inline-flex cursor-pointer items-center gap-1 rounded border border-[#303642] bg-[#171a20] px-2 py-0.5 text-[11px] text-[#d1d5db] hover:text-white"
              >
                <Copy className="h-3 w-3" />
                Copy TSX
              </button>
            </div>
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-[#d1d5db]">
              <code>{deckEmbedSnippet}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
