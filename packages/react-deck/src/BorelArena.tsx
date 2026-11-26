"use client";

import * as React from "react";
import {
  CartridgeClient,
  CARTRIDGE_DEVNET_AUTHORITIES,
  type ClaimAssetSymbol,
  type ClaimStockPrizeReceipt,
  type EnrichedMarketPulse,
} from "@cartridgefi/sdk";
import {
  ActionButton,
  GlassCard,
  GlassPill,
  LivePulseDot,
  ShowdownFlipCard,
  TabularMetric,
  type ConvictionAllocationLeg,
} from "@cartridgefi/ui-system";

export interface BorelArenaProps {
  id?: string;
  cartridgeSlug?: string;
  partnerId?: string;
  partnerFeeVault?: string;
  mode?: "PAPER" | "LIVE";
  compact?: boolean;
  apiBaseUrl?: string;
  wsUrl?: string;
  fullArenaHref?: string;
  className?: string;
}

interface ConvictionPreset {
  id: string;
  label: string;
  weightsBps: readonly [number, number, number, number];
  kalshiCall: 1 | 2;
}

const CONVICTION_PRESETS: readonly ConvictionPreset[] = [
  {
    id: "ai-momentum",
    label: "AI + SOL Long (50/35/15)",
    weightsBps: [5_000, 3_500, 1_500, 0],
    kalshiCall: 2,
  },
  {
    id: "delta-hedge",
    label: "SOL Short / NVDAx Long (-45/+40/+15)",
    weightsBps: [-4_500, 4_000, 1_500, 0],
    kalshiCall: 2,
  },
  {
    id: "macro-shield",
    label: "Macro SPYx Anchor (+25/+25/+50)",
    weightsBps: [2_500, 2_500, 5_000, 0],
    kalshiCall: 1,
  },
];

const CLAIM_MENU: readonly ClaimAssetSymbol[] = ["NVDAx", "ANTx", "SPYx", "USDC"];

function formatBpsPercent(bps: number): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "-" : "";
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  return rem === 0 ? `${sign}${whole}%` : `${sign}${whole}.${rem.toString().padStart(2, "0")}%`;
}

export function BorelArena({
  id = "cf-borel-arena-embed",
  cartridgeSlug = "borel-macro-blitz-001",
  partnerId = "first-party-studio",
  partnerFeeVault,
  mode = "PAPER",
  compact = false,
  apiBaseUrl,
  wsUrl,
  fullArenaHref,
  className = "",
}: BorelArenaProps): React.JSX.Element {
  const clientRef = React.useRef<CartridgeClient | null>(null);
  const [sessionPubkey, setSessionPubkey] = React.useState<string>("Initializing…");
  const [pulse, setPulse] = React.useState<EnrichedMarketPulse | null>(null);
  const [selectedPresetId, setSelectedPresetId] = React.useState<string>("ai-momentum");
  const [weightsBps, setWeightsBps] = React.useState<[number, number, number, number]>([
    5_000, 3_500, 1_500, 0,
  ]);
  const [kalshiCall, setKalshiCall] = React.useState<1 | 2>(2);
  const [unsealed, setUnsealed] = React.useState<boolean>(false);
  const [vrfProofShort, setVrfProofShort] = React.useState<string>("Vrf1RNUj…UwGz");
  const [rawMovesCount, setRawMovesCount] = React.useState<number>(0);
  const [nettedOrdersCount, setNettedOrdersCount] = React.useState<number>(0);
  const [statusNote, setStatusNote] = React.useState<string>(
    "Private ER TEE session ready — zero wallet popups.",
  );
  const [selectedClaimAsset, setSelectedClaimAsset] = React.useState<ClaimAssetSymbol>("NVDAx");
  const [claimReceipt, setClaimReceipt] = React.useState<ClaimStockPrizeReceipt | null>(null);

  React.useEffect(() => {
    let active = true;
    let unsubscribePulse: (() => void) | null = null;

    void (async () => {
      const connected = await CartridgeClient.connect({
        cartridgeSlug,
        partnerId,
        partnerFeeVault,
        playerWallet: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot3,
        mode,
        apiBaseUrl,
        wsUrl,
        simulationIntervalMs: 400,
      });

      if (!active) {
        connected.disconnect();
        return;
      }

      clientRef.current = connected;
      setSessionPubkey(connected.activeSessionPubkey);
      unsubscribePulse = connected.onMarketPulse((nextPulse) => {
        if (active) {
          setPulse(nextPulse);
        }
      });
    })();

    return () => {
      active = false;
      unsubscribePulse?.();
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [cartridgeSlug, partnerId, partnerFeeVault, mode, apiBaseUrl, wsUrl]);

  const handleSelectPreset = (preset: ConvictionPreset): void => {
    setSelectedPresetId(preset.id);
    setWeightsBps([
      preset.weightsBps[0],
      preset.weightsBps[1],
      preset.weightsBps[2],
      preset.weightsBps[3],
    ]);
    setKalshiCall(preset.kalshiCall);
  };

  const handleLockStance = async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    const receipt = await client.emitAction("SUBMIT_CONVICTION_WEIGHTS", {
      weightsBps,
      kalshiBinaryCall: kalshiCall,
      kalshiProbBps: kalshiCall === 2 ? 6_800 : 3_200,
    });
    setRawMovesCount(receipt.nettingMetrics.rawGameActionsCount);
    setNettedOrdersCount(receipt.nettingMetrics.nettedVenueOrdersCount);
    setStatusNote(
      `Signed seq #${receipt.signedEnvelope.sequence} in <10ms via Session Key (${receipt.signedEnvelope.sessionPubkey.slice(0, 8)}…)`,
    );
  };

  const handleToggleShowdown = async (): Promise<void> => {
    if (unsealed) {
      setUnsealed(false);
      setStatusNote("Re-sealed Private ER TEE Fog-of-War preview.");
      return;
    }
    const client = clientRef.current;
    if (!client) {
      setUnsealed(true);
      return;
    }
    const unsealRes = await client.triggerShowdownUnseal();
    setVrfProofShort(`${unsealRes.vrfProofHex.slice(0, 8)}…${unsealRes.vrfProofHex.slice(-4)}`);
    setNettedOrdersCount(client.netting.getTelemetry().nettedVenueOrdersCount);
    setUnsealed(true);
    setStatusNote("T-15s Showdown unsealed — rival allocations verified via MagicBlock VRF.");
  };

  const handleClaimPrize = async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    const receipt = await client.claimStockPrize(selectedClaimAsset);
    setClaimReceipt(receipt);
    setStatusNote(
      `Settled ${receipt.deliveredUnitsFormatted} ${receipt.settledAsset} via ${receipt.routingVenue} · ELO ${receipt.updatedEloFormatted}`,
    );
  };

  const allocations: readonly ConvictionAllocationLeg[] = [
    {
      symbol: "SOL-PERP",
      label: formatBpsPercent(weightsBps[0]),
      barWidthPct: Math.max(10, Math.floor(Math.abs(weightsBps[0]) / 100)),
      tone: weightsBps[0] >= 0 ? "emerald" : "amber",
    },
    {
      symbol: "NVDAx",
      label: formatBpsPercent(weightsBps[1]),
      barWidthPct: Math.max(10, Math.floor(Math.abs(weightsBps[1]) / 100)),
      tone: "cyan",
    },
    {
      symbol: "SPYx",
      label: formatBpsPercent(weightsBps[2]),
      barWidthPct: Math.max(10, Math.floor(Math.abs(weightsBps[2]) / 100)),
      tone: "emerald",
    },
  ];

  const countdownSecs = pulse ? Math.max(1, Math.floor(pulse.countdownRemainingMs / 1000)) : 45;
  const sigmaFormatted = pulse
    ? `${Math.floor(pulse.volatilitySigmaMilli / 1000)}.${(pulse.volatilitySigmaMilli % 1000)
        .toString()
        .padStart(3, "0")}σ`
    : "1.820σ";

  return (
    <GlassCard
      id={id}
      variant="stage"
      accent={unsealed ? "emerald" : "violet"}
      className={`p-4 sm:p-5 text-slate-100 ${className}`}
    >
      {/* Live ER Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <GlassPill tone={unsealed ? "amber" : "violet"} size="xs">
            <LivePulseDot tone={unsealed ? "amber" : "violet"} size="sm" />
            {unsealed ? "SHOWDOWN T-15S" : "PRIVATE TEE FOG"}
          </GlassPill>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            {pulse ? `${pulse.symbol} $${pulse.priceFormatted}` : "SOL-PERP $186.40"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[#00D4FF] tabular-nums">
            {sigmaFormatted}
          </span>
          <span className="rounded-md border border-white/10 bg-[#111520] px-2 py-0.5 font-mono text-xs font-semibold text-slate-100 tabular-nums">
            00:{countdownSecs.toString().padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Conviction Vector Controls */}
      <div className={`mt-4 grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Blind Conviction Stance
            </span>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              Session {sessionPubkey.slice(0, 6)}…
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {CONVICTION_PRESETS.map((preset) => {
              const isSelected = selectedPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  id={`${id}-preset-${preset.id}`}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                    isSelected
                      ? "border-[#00F59B]/45 bg-[#00F59B]/10 text-white"
                      : "border-white/10 bg-[#0D111A] text-slate-300 hover:border-white/20"
                  }`}
                >
                  <span className="font-medium">{preset.label}</span>
                  <span className="font-mono text-[10px] text-[#00F59B] tabular-nums">
                    100% Cap
                  </span>
                </button>
              );
            })}
          </div>

          {/* Kalshi Catalyst Multiplier Gate */}
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#050609]/80 px-3 py-2">
            <span className="font-mono text-[11px] text-slate-300">
              KALSHI-FED-CUT (1.35x Carry)
            </span>
            <div className="inline-flex gap-1.5">
              <button
                id={`${id}-kalshi-yes`}
                type="button"
                onClick={() => setKalshiCall(2)}
                className={`cursor-pointer rounded-lg border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                  kalshiCall === 2
                    ? "border-[#00F59B]/50 bg-[#00F59B]/15 text-[#00F59B]"
                    : "border-white/10 bg-white/[0.03] text-slate-400"
                }`}
              >
                YES 64¢
              </button>
              <button
                id={`${id}-kalshi-no`}
                type="button"
                onClick={() => setKalshiCall(1)}
                className={`cursor-pointer rounded-lg border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                  kalshiCall === 1
                    ? "border-[#FFB020]/50 bg-[#FFB020]/15 text-[#FFB020]"
                    : "border-white/10 bg-white/[0.03] text-slate-400"
                }`}
              >
                NO 36¢
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              id={`${id}-lock-stance-btn`}
              variant="emerald"
              size="sm"
              onClick={() => {
                void handleLockStance();
              }}
              className="flex-1"
            >
              Lock TEE Stance (0 Gas)
            </ActionButton>
            <ActionButton
              id={`${id}-showdown-btn`}
              variant="glass"
              size="sm"
              onClick={() => {
                void handleToggleShowdown();
              }}
            >
              {unsealed ? "Re-Seal Fog" : "Unseal Showdown"}
            </ActionButton>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#050609]/70 p-2.5">
            <TabularMetric
              label="ER Game Moves"
              value={String(rawMovesCount)}
              sublabel="Zero-popup Ed25519"
              tone="cyan"
              size="sm"
            />
            <TabularMetric
              label="Netted Venue Orders"
              value={String(nettedOrdersCount)}
              sublabel="Zero churn swaps"
              tone="emerald"
              size="sm"
            />
          </div>
        </div>

        {/* 3D Showdown Flip Card + Stock Claim Bar */}
        <div className="flex flex-col justify-between gap-3">
          <ShowdownFlipCard
            id={`${id}-flip-card`}
            playerHandle="@You · Borel Blitz"
            rank={1}
            publicDeltaBpsFormatted="+184 bps"
            cipherDigest="0x9f4c…e82a"
            unsealed={unsealed}
            finalScoreFormatted="+0.1842"
            vrfProofShort={vrfProofShort}
            allocations={allocations}
            onToggleUnseal={() => {
              void handleToggleShowdown();
            }}
          />

          {/* Earned Stock Vault Claim Selector */}
          <div className="rounded-xl border border-white/10 bg-[#050609]/85 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-300">
                Earned Stock Prize Menu
              </span>
              <div className="inline-flex gap-1">
                {CLAIM_MENU.map((sym) => (
                  <button
                    key={sym}
                    id={`${id}-claim-asset-${sym.toLowerCase()}`}
                    type="button"
                    onClick={() => setSelectedClaimAsset(sym)}
                    className={`cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      selectedClaimAsset === sym
                        ? "border-[#00D4FF]/50 bg-[#00D4FF]/15 text-[#67E8F9]"
                        : "border-white/10 bg-white/[0.03] text-slate-400"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <ActionButton
                id={`${id}-claim-prize-btn`}
                variant="ghost"
                size="sm"
                onClick={() => {
                  void handleClaimPrize();
                }}
              >
                Claim {selectedClaimAsset}
              </ActionButton>
              {fullArenaHref ? (
                <ActionButton
                  id={`${id}-open-full-arena`}
                  variant="glass"
                  size="sm"
                  href={fullArenaHref}
                >
                  Full Arena ↗
                </ActionButton>
              ) : null}
            </div>

            {claimReceipt ? (
              <p className="mt-2 font-mono text-[11px] text-[#00F59B] tabular-nums">
                Delivered {claimReceipt.deliveredUnitsFormatted} {claimReceipt.settledAsset} · Mint{" "}
                {claimReceipt.settledMint.slice(0, 6)}… · ELO {claimReceipt.updatedEloFormatted}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <p className="mt-3 truncate font-mono text-[11px] text-slate-400 tabular-nums">
        {statusNote}
      </p>
    </GlassCard>
  );
}
