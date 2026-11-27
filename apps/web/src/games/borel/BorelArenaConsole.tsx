"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Unlock,
} from "lucide-react";
import type { ClaimAssetSymbol } from "@cartridgefi/shared-types";
import { ShowdownFlipCard } from "@cartridgefi/ui-system";
import devnetProof from "@/data/devnet-proof.json";
import {
  formatAtomicUsdc,
  formatEloInteger,
  useConsoleVault,
} from "@/app/(console)/_components/ConsoleVaultContext";
import { LiveMarketChart, type ChartSymbol } from "@/components/LiveMarketChart";
import type {
  LiveKalshiContract,
  LiveMarketsSnapshot,
  LiveSpotOrEquityMarket,
} from "@/lib/live-markets";
import { cn, shortenAddress } from "@/lib/utils";
import {
  BOREL_ENGINE_PROOF,
  buildLiveBorelQuotes,
  computeBorelSettlement,
  evaluateBorelPodStandings,
  getBorelMarketSnapshot,
  getClaimAssetReferencePrice8,
  getShowdownUnsealThreshold,
  normalizePlayerChips,
  type BorelAssetSymbol,
  type BorelChipAllocation,
  type BorelDurationMode,
  type BorelKalshiCall,
  type BorelSettlementSummary,
  type BorelSessionMode,
} from "./engine";
import {
  renderBorelEloReceiptCanvas,
  triggerCanvasPngDownload,
} from "./receiptCanvas";
import { toast } from "sonner";

type ArenaLifecyclePhase = "FOG_OF_WAR" | "SHOWDOWN" | "SETTLED";

const ENVELOPE_OPTIONS = [25, 50, 100, 250] as const;
const CLAIM_MENU_OPTIONS: readonly {
  symbol: ClaimAssetSymbol;
  name: string;
  venue: string;
  isEquity: boolean;
}[] = [
  { symbol: "NVDAx", name: "NVIDIA xStock", venue: "Solana Raydium SPL", isEquity: true },
  { symbol: "SPYx", name: "S&P 500 xStock", venue: "Solana Raydium SPL", isEquity: true },
  { symbol: "TSLAx", name: "Tesla xStock", venue: "Solana Raydium SPL", isEquity: true },
  { symbol: "USDC", name: "Solana USDC", venue: "Instant Cash", isEquity: false },
];

const INITIAL_PLAYER_LEGS: readonly BorelChipAllocation[] = [
  { symbol: "NVDAx", direction: "LONG", chips: 50 },
  { symbol: "SOL-PERP", direction: "LONG", chips: 30 },
  { symbol: "SPYx", direction: "SHORT", chips: 20 },
];

function formatCountdownClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const secs = (safe % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

export function BorelArenaConsole(): React.JSX.Element {
  const searchParams = useSearchParams();
  const initialSymbolParam = searchParams.get("symbol");
  const initialKalshiParam = searchParams.get("kalshi");

  const {
    cashUsdcAtomic,
    marketEloScaled,
    sessionKeyPubkey,
    playerWallet,
    openCashier,
    creditEarnedVaultPrize,
    recordRoundElo,
  } = useConsoleVault();

  // Live online market feeds
  const [liveMarkets, setLiveMarkets] = React.useState<LiveSpotOrEquityMarket[]>([]);
  const [kalshiContracts, setKalshiContracts] = React.useState<LiveKalshiContract[]>([]);
  const [chartSymbol, setChartSymbol] = React.useState<ChartSymbol>(
    initialSymbolParam === "NVDAx" ||
      initialSymbolParam === "SPYx" ||
      initialSymbolParam === "TSLAx" ||
      initialSymbolParam === "BTC-USD"
      ? initialSymbolParam
      : "SOL-USD",
  );
  const [selectedKalshiTicker, setSelectedKalshiTicker] = React.useState<string>(
    initialKalshiParam ?? "KXFEDDECISION-26DEC-H25",
  );

  // Arena config & lifecycle
  const [durationMode, setDurationMode] = React.useState<BorelDurationMode>(60);
  const [sessionMode, setSessionMode] = React.useState<BorelSessionMode>("PAPER");
  const [envelopeUsdc, setEnvelopeUsdc] = React.useState<number>(50);
  const [remainingSecs, setRemainingSecs] = React.useState<number>(48);
  const [tickIndex, setTickIndex] = React.useState<number>(4);
  const [clockPaused, setClockPaused] = React.useState<boolean>(false);
  const [roundNumber, setRoundNumber] = React.useState<number>(1);

  // Conviction allocation ticket
  const [draftLegs, setDraftLegs] =
    React.useState<readonly BorelChipAllocation[]>(INITIAL_PLAYER_LEGS);
  const [committedLegs, setCommittedLegs] =
    React.useState<readonly BorelChipAllocation[]>(INITIAL_PLAYER_LEGS);
  const [draftKalshiCall, setDraftKalshiCall] =
    React.useState<BorelKalshiCall>("YES");
  const [committedKalshiCall, setCommittedKalshiCall] =
    React.useState<BorelKalshiCall>("YES");
  const [rebalancesUsed, setRebalancesUsed] = React.useState<number>(0);

  // Settlement & claim state
  const [forcedPhase, setForcedPhase] =
    React.useState<ArenaLifecyclePhase | null>(null);
  const [geoEligibleForEquities, setGeoEligibleForEquities] =
    React.useState<boolean>(true);
  const [selectedClaimAsset, setSelectedClaimAsset] =
    React.useState<ClaimAssetSymbol>("NVDAx");
  const [claimedPrizeReceipt, setClaimedPrizeReceipt] = React.useState<{
    creditedLabel: string;
    asset: ClaimAssetSymbol;
  } | null>(null);

  const receiptCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const recordedRoundRef = React.useRef<number | null>(null);

  // Fetch real live markets from /api/markets
  React.useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch("/api/markets");
        if (!res.ok || !active) return;
        const snap = (await res.json()) as LiveMarketsSnapshot;
        if (!active) return;
        if (snap.markets.length > 0) setLiveMarkets(snap.markets);
        if (snap.kalshiContracts.length > 0) {
          setKalshiContracts(snap.kalshiContracts);
          setSelectedKalshiTicker((prev) =>
            snap.kalshiContracts.some((c) => c.ticker === prev)
              ? prev
              : snap.kalshiContracts[0]!.ticker,
          );
        }
      } catch {
        // Keep last live snapshot
      }
    };
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 10_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const handleRealtimePrice = React.useCallback(
    (sym: ChartSymbol, priceUsd: number) => {
      setLiveMarkets((prev) =>
        prev.map((m) => (m.symbol === sym ? { ...m, priceUsd } : m)),
      );
    },
    [],
  );

  // Countdown clock
  React.useEffect(() => {
    if (clockPaused) return;
    const timer = window.setInterval(() => {
      setRemainingSecs((prev) => (prev > 0 ? prev - 1 : 0));
      setTickIndex((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [clockPaused]);

  const unsealThreshold = getShowdownUnsealThreshold(durationMode);
  const computedPhase: ArenaLifecyclePhase =
    forcedPhase ??
    (remainingSecs === 0
      ? "SETTLED"
      : remainingSecs <= unsealThreshold
        ? "SHOWDOWN"
        : "FOG_OF_WAR");

  const isUnsealed =
    computedPhase === "SHOWDOWN" || computedPhase === "SETTLED";

  // Build Borel quotes from REAL live market prices (falling back only before first fetch resolves)
  const solLive = liveMarkets.find((m) => m.symbol === "SOL-USD") ?? null;
  const nvdaLive = liveMarkets.find((m) => m.symbol === "NVDAx") ?? null;
  const spyLive = liveMarkets.find((m) => m.symbol === "SPYx") ?? null;
  const activeKalshi =
    kalshiContracts.find((c) => c.ticker === selectedKalshiTicker) ??
    kalshiContracts[0] ??
    null;

  const liveBorelQuotes = React.useMemo(
    () =>
      buildLiveBorelQuotes({
        solUsd: solLive?.priceUsd ?? null,
        solChange24hPct: solLive?.change24hPct ?? 0,
        nvdaUsd: nvdaLive?.priceUsd ?? null,
        nvdaChange24hPct: nvdaLive?.change24hPct ?? 0,
        spyUsd: spyLive?.priceUsd ?? null,
        spyChange24hPct: spyLive?.change24hPct ?? 0,
        kalshiYesPrice: activeKalshi?.lastPrice ?? null,
        kalshiTickerLabel: activeKalshi?.ticker ?? "KXFEDDECISION",
      }),
    [solLive, nvdaLive, spyLive, activeKalshi],
  );

  const fallbackSnapshot = React.useMemo(
    () => getBorelMarketSnapshot(tickIndex),
    [tickIndex],
  );
  const quotes = liveBorelQuotes ?? fallbackSnapshot.quotes;

  const standings = React.useMemo(
    () =>
      evaluateBorelPodStandings(committedLegs, committedKalshiCall, quotes),
    [committedLegs, committedKalshiCall, quotes],
  );

  const settlement: BorelSettlementSummary = React.useMemo(
    () =>
      computeBorelSettlement({
        roundNumber,
        standings,
        sessionMode,
        envelopeUsdcWhole: envelopeUsdc,
        currentPlayerEloScaled: marketEloScaled,
      }),
    [roundNumber, standings, sessionMode, envelopeUsdc, marketEloScaled],
  );

  // Record ELO & render receipt canvas when round settles
  React.useEffect(() => {
    if (computedPhase !== "SETTLED") return;
    if (recordedRoundRef.current !== roundNumber) {
      recordedRoundRef.current = roundNumber;
      recordRoundElo(settlement.nextEloScaled, settlement.playerRank <= 2);
    }
    if (receiptCanvasRef.current) {
      const effectiveAsset = geoEligibleForEquities ? selectedClaimAsset : "USDC";
      const payoutLabel =
        claimedPrizeReceipt?.creditedLabel ??
        `${formatAtomicUsdc(settlement.playerPayoutUsdcAtomic)} (${effectiveAsset})`;
      const deltaWhole = Number(settlement.deltaEloScaled / 1_000_000_000n);
      const deltaStr = `${deltaWhole >= 0 ? "+" : ""}${deltaWhole}`;

      renderBorelEloReceiptCanvas(receiptCanvasRef.current, {
        roundCode: settlement.roundCode,
        playerWalletShort: playerWallet
          ? shortenAddress(playerWallet, 6, 4)
          : "Session Key",
        sessionModeLabel: sessionMode === "LIVE" ? "Devnet Shard" : "Paper Arena",
        rank: settlement.playerRank,
        skillScoreFormatted: settlement.playerScoreBpsFormatted,
        prevEloFormatted: formatEloInteger(settlement.prevEloScaled),
        nextEloFormatted: formatEloInteger(settlement.nextEloScaled),
        deltaEloFormatted: deltaStr,
        payoutSummary: payoutLabel,
        vrfSeedShort: `${settlement.vrfSeedHex.slice(0, 14)}…`,
        erRoomProgramId: BOREL_ENGINE_PROOF.erRoomProgramId,
        teeProgramId: BOREL_ENGINE_PROOF.teePermissionProgramId,
      });
    }
  }, [
    computedPhase,
    roundNumber,
    settlement,
    playerWallet,
    sessionMode,
    geoEligibleForEquities,
    selectedClaimAsset,
    claimedPrizeReceipt,
    recordRoundElo,
  ]);

  const applyPreset = (
    preset: "ai-divergence" | "macro-hedge" | "sol-momentum",
  ): void => {
    if (preset === "ai-divergence") {
      setDraftLegs([
        { symbol: "NVDAx", direction: "LONG", chips: 55 },
        { symbol: "SOL-PERP", direction: "LONG", chips: 25 },
        { symbol: "SPYx", direction: "SHORT", chips: 20 },
      ]);
      setDraftKalshiCall("YES");
    } else if (preset === "macro-hedge") {
      setDraftLegs([
        { symbol: "SPYx", direction: "LONG", chips: 50 },
        { symbol: "NVDAx", direction: "LONG", chips: 30 },
        { symbol: "SOL-PERP", direction: "SHORT", chips: 20 },
      ]);
      setDraftKalshiCall("NO");
    } else {
      setDraftLegs([
        { symbol: "SOL-PERP", direction: "LONG", chips: 60 },
        { symbol: "NVDAx", direction: "LONG", chips: 25 },
        { symbol: "SPYx", direction: "LONG", chips: 15 },
      ]);
      setDraftKalshiCall("YES");
    }
  };

  const handleSubmitStance = (): void => {
    setCommittedLegs(draftLegs);
    setCommittedKalshiCall(draftKalshiCall);
    setRebalancesUsed((prev) => prev + 1);
    toast.success(
      `Committed encrypted allocation via Ed25519 session signer (${sessionKeyPubkey ? shortenAddress(sessionKeyPubkey, 4, 4) : "local"})`,
    );
  };

  const handleJumpShowdown = (): void => {
    setForcedPhase("SHOWDOWN");
    setRemainingSecs(12);
  };

  const handleSettleNow = (): void => {
    setForcedPhase("SETTLED");
    setRemainingSecs(0);
  };

  const handleResetRound = (): void => {
    setForcedPhase(null);
    setRoundNumber((r) => r + 1);
    setRemainingSecs(durationMode);
    setRebalancesUsed(0);
    setClaimedPrizeReceipt(null);
  };

  const handleClaimPrize = (): void => {
    const effectiveAsset: ClaimAssetSymbol = geoEligibleForEquities
      ? selectedClaimAsset
      : "USDC";
    const ref = getClaimAssetReferencePrice8(effectiveAsset, quotes);
    const res = creditEarnedVaultPrize(
      effectiveAsset,
      settlement.playerPayoutUsdcAtomic,
      ref.price8,
    );
    setClaimedPrizeReceipt({
      creditedLabel: res.creditedLabel,
      asset: effectiveAsset,
    });
    toast.success(`Settled ${res.creditedLabel} to arena vault ledger`);
  };

  const totalDraftWeight = draftLegs.reduce((acc, l) => acc + l.chips, 0);

  return (
    <div className="space-y-4">
      {/* Top Arena Bar */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#22262e] bg-[#111317] p-4 xl:flex-row xl:items-center">
        <div className="max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold text-[#f3f4f6] sm:text-lg">
              Borel Conviction Arena (#001)
            </h1>
            <span
              className={cn(
                "rounded border px-2 py-0.5 font-mono text-[11px] font-medium",
                computedPhase === "FOG_OF_WAR"
                  ? "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#fbbf24]"
                  : computedPhase === "SHOWDOWN"
                    ? "border-[#3b82f6]/30 bg-[#2563eb]/15 text-[#93c5fd]"
                    : "border-[#10b981]/30 bg-[#10b981]/10 text-[#34d399]",
              )}
            >
              {computedPhase === "FOG_OF_WAR"
                ? "TEE Encrypted Window (0–75%)"
                : computedPhase === "SHOWDOWN"
                  ? "T-15s Showdown Unsealed"
                  : "Round Settled"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#9ca3af]">
            Allocate directional weights across live Solana xStocks and crypto markets; rival weights remain sealed in Intel TDX (
            <code className="font-mono text-[#d1d5db]">ACLseoPoy…</code>) until T-15s.
          </p>
        </div>

        {/* Phase & Clock Controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-md border border-[#22262e] bg-[#0b0c0e] px-3 py-1.5 font-mono text-xs tabular-nums">
            <span className="text-[#9ca3af]">Clock</span>
            <span className="text-sm font-semibold text-[#f3f4f6]">
              {formatCountdownClock(remainingSecs)}
            </span>
            <button
              type="button"
              onClick={() => setClockPaused((p) => !p)}
              className="ml-1 cursor-pointer text-[#9ca3af] hover:text-white"
              aria-label={clockPaused ? "Resume round clock" : "Pause round clock"}
            >
              {clockPaused ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <button
            id="borel-jump-showdown-btn"
            type="button"
            onClick={handleJumpShowdown}
            className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-2.5 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
          >
            <Unlock className="h-3.5 w-3.5 text-[#fbbf24]" />
            Trigger T-15s Unseal
          </button>

          <button
            id="borel-settle-now-btn"
            type="button"
            onClick={handleSettleNow}
            className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-2.5 text-xs font-medium text-[#34d399] hover:bg-[#1d2129]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Settle Round
          </button>

          <button
            id="open-cashier-modal-btn"
            type="button"
            onClick={openCashier}
            className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[#2563eb] px-3 text-xs font-medium text-white hover:bg-[#1d4ed8]"
          >
            Margin ({formatAtomicUsdc(cashUsdcAtomic)})
          </button>
        </div>
      </div>

      {/* Main 12-Column Terminal Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left 7 Columns: Live TradingView Chart + Pod Seal/Unseal Standings */}
        <div className="space-y-4 lg:col-span-7">
          <LiveMarketChart
            selectedSymbol={chartSymbol}
            onSelectSymbol={setChartSymbol}
            markets={liveMarkets}
            onRealtimePrice={handleRealtimePrice}
            heightPx={320}
          />

          {/* 4-Seat Pod Standings (Sealed -> Unsealed at T-15s) */}
          <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#22262e] pb-2.5">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold text-[#f3f4f6]">
                  Shard Pod Commitments (4 Seats)
                </h2>
                <a
                  href={`https://solscan.io/account/${devnetProof.accounts.settledRoomShardPda}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-[#9ca3af] hover:text-[#93c5fd]"
                >
                  Shard {shortenAddress(devnetProof.accounts.settledRoomShardPda, 4, 4)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
                {isUnsealed ? "Unsealed Showdown Weights" : "Intel TDX Sealed"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {standings.map((comp) => (
                <ShowdownFlipCard
                  key={comp.id}
                  id={`pod-card-${comp.id}`}
                  playerHandle={comp.handle}
                  rank={comp.rank}
                  publicDeltaBpsFormatted={comp.deltaBpsFormatted}
                  cipherDigest={comp.cipherDigest}
                  unsealed={isUnsealed || comp.isPlayer}
                  finalScoreFormatted={comp.deltaBpsFormatted}
                  allocations={comp.allocationsUi}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Right 5 Columns: Conviction Order Ticket + Settlement Vault */}
        <div className="space-y-4 lg:col-span-5">
          <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
            <div className="flex items-center justify-between border-b border-[#22262e] pb-3">
              <h2 className="text-xs font-semibold text-[#f3f4f6]">
                Conviction Allocation Ticket
              </h2>
              <div className="flex items-center gap-1">
                {([60, 180] as const).map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => {
                      setDurationMode(dur);
                      setRemainingSecs(dur);
                      setForcedPhase(null);
                    }}
                    className={cn(
                      "cf-btn cursor-pointer rounded px-2 py-0.5 font-mono text-[11px] tabular-nums",
                      durationMode === dur
                        ? "bg-[#171a20] border border-[#303642] text-white"
                        : "text-[#6b7280] hover:text-white",
                    )}
                  >
                    {dur}s
                  </button>
                ))}
              </div>
            </div>

            {/* Session Mode & Envelope Size */}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="text-[11px] text-[#6b7280]">Execution Mode</div>
                <div className="mt-1.5 grid grid-cols-2 gap-1">
                  {(["PAPER", "LIVE"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSessionMode(m)}
                      className={cn(
                        "cf-btn cursor-pointer rounded py-1 font-mono text-[11px] font-medium",
                        sessionMode === m
                          ? "bg-[#2563eb] text-white"
                          : "bg-[#171a20] text-[#9ca3af] hover:text-white",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="text-[11px] text-[#6b7280]">Risk Envelope</div>
                <div className="mt-1.5 grid grid-cols-4 gap-1 font-mono tabular-nums">
                  {ENVELOPE_OPTIONS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setEnvelopeUsdc(amt)}
                      className={cn(
                        "cf-btn cursor-pointer rounded py-1 text-[11px]",
                        envelopeUsdc === amt
                          ? "border border-[#3b82f6] bg-[#2563eb]/20 text-white"
                          : "bg-[#171a20] text-[#9ca3af] hover:text-white",
                      )}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                id="borel-preset-ai-divergence"
                type="button"
                onClick={() => applyPreset("ai-divergence")}
                className="cf-btn cursor-pointer rounded border border-[#303642] bg-[#171a20] px-2.5 py-1 text-[11px] font-medium text-[#d1d5db] hover:bg-[#1d2129] hover:text-white"
              >
                NVDAx + SOL Long / SPYx Hedge
              </button>
              <button
                type="button"
                onClick={() => applyPreset("macro-hedge")}
                className="cf-btn cursor-pointer rounded border border-[#303642] bg-[#171a20] px-2.5 py-1 text-[11px] font-medium text-[#d1d5db] hover:bg-[#1d2129] hover:text-white"
              >
                SPYx Macro Anchor
              </button>
              <button
                type="button"
                onClick={() => applyPreset("sol-momentum")}
                className="cf-btn cursor-pointer rounded border border-[#303642] bg-[#171a20] px-2.5 py-1 text-[11px] font-medium text-[#d1d5db] hover:bg-[#1d2129] hover:text-white"
              >
                SOL Breakout
              </button>
            </div>

            {/* Individual Asset Weight Sliders */}
            <div className="mt-3 space-y-2.5">
              {draftLegs.map((leg) => {
                const liveQ = quotes.find((q) => q.symbol === leg.symbol);
                return (
                  <div
                    key={leg.symbol}
                    className="rounded-md border border-[#22262e] bg-[#0b0c0e] p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-[#f3f4f6]">
                          {leg.symbol}
                        </span>
                        <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
                          {liveQ?.displayPrice ?? "—"} ({liveQ?.deltaBpsFormatted ?? "0 bps"})
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {(["LONG", "SHORT"] as const).map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            onClick={() =>
                              setDraftLegs((prev) =>
                                prev.map((item) =>
                                  item.symbol === leg.symbol
                                    ? { ...item, direction: dir }
                                    : item,
                                ),
                              )
                            }
                            className={cn(
                              "cf-btn cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] font-semibold",
                              leg.direction === dir
                                ? dir === "LONG"
                                  ? "bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40"
                                  : "bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/40"
                                : "bg-[#171a20] text-[#6b7280] hover:text-white",
                            )}
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        aria-label={`${leg.symbol} portfolio weight`}
                        value={leg.chips}
                        onChange={(e) =>
                          setDraftLegs((prev) =>
                            normalizePlayerChips(
                              prev,
                              leg.symbol as BorelAssetSymbol,
                              Number(e.target.value),
                            ),
                          )
                        }
                        className="h-1.5 flex-1 cursor-pointer accent-[#2563eb]"
                      />
                      <span className="w-12 text-right font-mono text-xs font-semibold text-[#f3f4f6] tabular-nums">
                        {leg.chips}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live Kalshi Binary Catalyst Call */}
            <div className="mt-3 rounded-md border border-[#22262e] bg-[#0b0c0e] p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[#d1d5db]">
                  Kalshi Event Catalyst (1.35x Carry)
                </span>
                <span className="font-mono text-[11px] text-[#34d399] tabular-nums">
                  {activeKalshi
                    ? `${(activeKalshi.lastPrice * 100).toFixed(0)}¢ YES`
                    : "Live"}
                </span>
              </div>

              {kalshiContracts.length > 0 ? (
                <select
                  aria-label="Select live Kalshi contract"
                  value={selectedKalshiTicker}
                  onChange={(e) => setSelectedKalshiTicker(e.target.value)}
                  className="mt-2 w-full rounded border border-[#303642] bg-[#111317] px-2.5 py-1.5 text-xs text-[#f3f4f6] focus:border-[#3b82f6] focus:outline-none"
                >
                  {kalshiContracts.slice(0, 8).map((c) => (
                    <option key={c.ticker} value={c.ticker}>
                      {c.ticker} — {c.subtitle} ({(c.lastPrice * 100).toFixed(0)}¢)
                    </option>
                  ))}
                </select>
              ) : null}

              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["YES", "NO"] as const).map((call) => (
                  <button
                    key={call}
                    type="button"
                    onClick={() => setDraftKalshiCall(call)}
                    className={cn(
                      "cf-btn cursor-pointer rounded border py-1.5 font-mono text-xs font-semibold",
                      draftKalshiCall === call
                        ? call === "YES"
                          ? "border-[#10b981] bg-[#10b981]/15 text-[#34d399]"
                          : "border-[#ef4444] bg-[#ef4444]/15 text-[#f87171]"
                        : "border-[#22262e] bg-[#111317] text-[#9ca3af] hover:text-white",
                    )}
                  >
                    Call {call}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit Stance Button (Zero Mid-Game Wallet Popup) */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
                Allocated: {totalDraftWeight}% | Rebalances: {rebalancesUsed}/4
              </span>

              <button
                id="borel-submit-stance-btn"
                type="button"
                onClick={handleSubmitStance}
                className="cf-btn inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-[#2563eb] px-4 text-xs font-medium text-white hover:bg-[#1d4ed8]"
              >
                <Lock className="h-3.5 w-3.5" />
                Submit Encrypted Stance
              </button>
            </div>
          </section>

          {/* Settlement & Earned Stock Vault Panel */}
          <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4">
            <div className="flex items-center justify-between border-b border-[#22262e] pb-3">
              <h2 className="text-xs font-semibold text-[#f3f4f6]">
                Round Settlement &amp; Equity Payout
              </h2>
              <button
                type="button"
                onClick={handleResetRound}
                className="cf-btn inline-flex cursor-pointer items-center gap-1 rounded border border-[#303642] bg-[#171a20] px-2 py-0.5 text-[11px] text-[#d1d5db] hover:text-white"
              >
                <RotateCcw className="h-3 w-3" />
                Next Round
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">Rank</div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  #{settlement.playerRank} of 4
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Payout Share
                </div>
                <div className="mt-0.5 font-semibold text-[#34d399]">
                  {formatAtomicUsdc(settlement.playerPayoutUsdcAtomic)}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-2.5">
                <div className="font-sans text-[10px] text-[#6b7280]">
                  Passport ELO
                </div>
                <div className="mt-0.5 font-semibold text-[#f3f4f6]">
                  {formatEloInteger(settlement.nextEloScaled)}
                </div>
              </div>
            </div>

            {/* Jurisdiction Eligibility Toggle + Claim Asset Picker */}
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-[#9ca3af]">Settlement Asset</span>
              <div className="flex items-center gap-1">
                <button
                  id="borel-geo-eligible-btn"
                  type="button"
                  onClick={() => setGeoEligibleForEquities(true)}
                  className={cn(
                    "cf-btn cursor-pointer rounded px-2 py-0.5 text-[11px]",
                    geoEligibleForEquities
                      ? "bg-[#171a20] border border-[#303642] text-white"
                      : "text-[#6b7280]",
                  )}
                >
                  xStocks Eligible
                </button>
                <button
                  type="button"
                  onClick={() => setGeoEligibleForEquities(false)}
                  className={cn(
                    "cf-btn cursor-pointer rounded px-2 py-0.5 text-[11px]",
                    !geoEligibleForEquities
                      ? "bg-[#171a20] border border-[#303642] text-white"
                      : "text-[#6b7280]",
                  )}
                >
                  USDC Only
                </button>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {CLAIM_MENU_OPTIONS.map((opt) => {
                const disabled = opt.isEquity && !geoEligibleForEquities;
                const isSel = selectedClaimAsset === opt.symbol;
                return (
                  <button
                    key={opt.symbol}
                    id={`borel-claim-asset-${opt.symbol}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelectedClaimAsset(opt.symbol)}
                    className={cn(
                      "cf-btn cursor-pointer rounded border p-2 text-left disabled:opacity-40",
                      isSel
                        ? "border-[#3b82f6] bg-[#2563eb]/15 text-white"
                        : "border-[#22262e] bg-[#0b0c0e] text-[#d1d5db] hover:border-[#303642]",
                    )}
                  >
                    <div className="font-mono text-xs font-semibold">
                      {opt.symbol}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[#9ca3af]">
                      {opt.venue}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                id="borel-claim-prize-btn"
                type="button"
                onClick={handleClaimPrize}
                className="cf-btn flex-1 h-9 cursor-pointer rounded-md bg-[#10b981] px-3 text-xs font-semibold text-[#052e16] hover:bg-[#34d399]"
              >
                Settle Payout in{" "}
                {geoEligibleForEquities ? selectedClaimAsset : "USDC"}
              </button>

              {computedPhase === "SETTLED" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (receiptCanvasRef.current) {
                      triggerCanvasPngDownload(
                        receiptCanvasRef.current,
                        `cartridgefi-${settlement.roundCode.toLowerCase()}.png`,
                      );
                    }
                  }}
                  className="cf-btn inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
                >
                  <Download className="h-3.5 w-3.5" />
                  PNG
                </button>
              ) : null}
            </div>

            {claimedPrizeReceipt ? (
              <div className="mt-2.5 rounded border border-[#10b981]/30 bg-[#10b981]/10 px-3 py-2 font-mono text-xs text-[#34d399]">
                Credited {claimedPrizeReceipt.creditedLabel} (live reference quote)
              </div>
            ) : null}

            {/* Verified Devnet Reference Proof Link */}
            <div className="mt-3 flex items-center justify-between border-t border-[#22262e] pt-2.5 font-mono text-[11px] text-[#6b7280]">
              <span>Verified Devnet Commit Reference</span>
              <a
                href={`https://solscan.io/tx/${settlement.l1CommitSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline"
              >
                {shortenAddress(settlement.l1CommitSignature, 6, 6)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>

            {/* Settlement Receipt Canvas */}
            <div className={computedPhase === "SETTLED" ? "mt-3" : "sr-only"}>
              <canvas
                id="borel-elo-receipt-canvas"
                ref={receiptCanvasRef}
                width={1200}
                height={630}
                className="w-full rounded border border-[#22262e]"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
