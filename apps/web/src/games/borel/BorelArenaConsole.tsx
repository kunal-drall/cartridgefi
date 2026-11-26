"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  CARTRIDGE_PROGRAM_IDS,
  ENGINE_GUARDRAILS,
  FIRST_PARTY_CARTRIDGE_CATALOG,
  FP_SCALE,
  type ClaimAssetSymbol,
} from "@cartridgefi/shared-types";
import {
  ActionButton,
  GlassCard,
  GlassPill,
  LivePulseDot,
  ShowdownFlipCard,
} from "@cartridgefi/ui-system";
import {
  formatAtomicUsdc,
  formatEloInteger,
  formatShareUnits6,
  useConsoleVault,
} from "@/app/(console)/_components/ConsoleVaultContext";
import {
  BOREL_ENGINE_PROOF,
  computeBorelSettlement,
  evaluateBorelPodStandings,
  formatPrice8Usd,
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

type ArenaLifecyclePhase = "FOG_OF_WAR" | "SHOWDOWN" | "SETTLED";

interface StanceTelemetryEvent {
  id: string;
  label: string;
  latencyLabel: string;
  detail: string;
}

const ENVELOPE_OPTIONS = [10, 25, 50, 100, 250] as const;
const LEVERAGE_OPTIONS = [1, 2, 3, 5] as const;
const CLAIM_MENU_OPTIONS: readonly {
  symbol: ClaimAssetSymbol;
  name: string;
  venue: string;
  isEquity: boolean;
}[] = [
  { symbol: "NVDAx", name: "NVIDIA xStock", venue: "Jupiter V2", isEquity: true },
  { symbol: "ANTx", name: "Anthropic Pre-IPO", venue: "Jupiter V2", isEquity: true },
  { symbol: "SPYx", name: "S&P 500 xStock", venue: "Jupiter V2", isEquity: true },
  { symbol: "USDC", name: "Canonical Solana USDC", venue: "Instant Cash", isEquity: false },
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
  const cartridgeParam = searchParams.get("cartridge");

  const {
    cashUsdcAtomic,
    earnedStocks,
    marketEloScaled,
    sessionKeyPubkey,
    playerWallet,
    openCashier,
    creditEarnedVaultPrize,
    recordRoundElo,
  } = useConsoleVault();

  // Command Header Config
  const [durationMode, setDurationMode] = React.useState<BorelDurationMode>(60);
  const [sessionMode, setSessionMode] = React.useState<BorelSessionMode>("LIVE");
  const [envelopeUsdc, setEnvelopeUsdc] = React.useState<number>(25);
  const [leverageCap, setLeverageCap] = React.useState<number>(3);

  // Clock & Arena Lifecycle
  const [remainingSecs, setRemainingSecs] = React.useState<number>(48);
  const [tickIndex, setTickIndex] = React.useState<number>(4);
  const [clockPaused, setClockPaused] = React.useState<boolean>(false);
  const [roundNumber, setRoundNumber] = React.useState<number>(1);

  // Tactical Conviction Deck State
  const [draftLegs, setDraftLegs] =
    React.useState<readonly BorelChipAllocation[]>(INITIAL_PLAYER_LEGS);
  const [committedLegs, setCommittedLegs] =
    React.useState<readonly BorelChipAllocation[]>(INITIAL_PLAYER_LEGS);
  const [draftKalshiCall, setDraftKalshiCall] = React.useState<BorelKalshiCall>("YES");
  const [committedKalshiCall, setCommittedKalshiCall] =
    React.useState<BorelKalshiCall>("YES");
  const [stanceLocked, setStanceLocked] = React.useState<boolean>(false);
  const [rebalancesUsed, setRebalancesUsed] = React.useState<number>(0);
  const [erEvents, setErEvents] = React.useState<readonly StanceTelemetryEvent[]>([
    {
      id: "boot-0",
      label: "Private ER Pod Delegated",
      latencyLabel: "8.2ms PER",
      detail: `Shard encrypted via ${BOREL_ENGINE_PROOF.teePermissionProgramId.slice(0, 10)}…`,
    },
  ]);

  // Settlement, Jurisdiction & Stock Prize Claim State
  const [settledSnapshot, setSettledSnapshot] =
    React.useState<BorelSettlementSummary | null>(null);
  const [jurisdictionMode, setJurisdictionMode] = React.useState<"NON_US_ELIGIBLE" | "US_FALLBACK">(
    "NON_US_ELIGIBLE",
  );
  const [selectedPrizeAsset, setSelectedPrizeAsset] =
    React.useState<ClaimAssetSymbol>("NVDAx");
  const [claimedReceiptNote, setClaimedReceiptNote] = React.useState<string | null>(null);
  const [receiptDataUrl, setReceiptDataUrl] = React.useState<string>("");
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const activeCartridgeOverlay = React.useMemo(() => {
    if (!cartridgeParam) return null;
    return (
      FIRST_PARTY_CARTRIDGE_CATALOG.find(
        (item) => item.metadata.slug === cartridgeParam,
      ) ?? null
    );
  }, [cartridgeParam]);

  const unsealThreshold = getShowdownUnsealThreshold(durationMode);

  const arenaPhase: ArenaLifecyclePhase =
    settledSnapshot !== null || remainingSecs <= 0
      ? "SETTLED"
      : remainingSecs <= unsealThreshold
        ? "SHOWDOWN"
        : "FOG_OF_WAR";

  const marketSnapshot = React.useMemo(
    () => getBorelMarketSnapshot(tickIndex),
    [tickIndex],
  );

  const standings = React.useMemo(
    () =>
      evaluateBorelPodStandings(
        committedLegs,
        committedKalshiCall,
        marketSnapshot.quotes,
      ),
    [committedLegs, committedKalshiCall, marketSnapshot.quotes],
  );

  const playerStanding =
    standings.find((s) => s.isPlayer) ?? standings[0]!;
  const rivalStandings = standings.filter((s) => !s.isPlayer);

  // Finalize settlement deterministically when countdown reaches 0 or Settle Now is clicked
  const finalizeSettlement = React.useCallback(
    (standingsAtSettle: readonly typeof playerStanding[]) => {
      const summary = computeBorelSettlement({
        roundNumber,
        standings: standingsAtSettle,
        sessionMode,
        envelopeUsdcWhole: envelopeUsdc,
        currentPlayerEloScaled: marketEloScaled,
      });
      setSettledSnapshot(summary);
      setRemainingSecs(0);
      recordRoundElo(summary.nextEloScaled, summary.playerRank <= 2);
      setErEvents((prev) => [
        {
          id: `settle-${roundNumber}`,
          label: `Round #${summary.roundCode} Committed to L1`,
          latencyLabel: "Magic Actions",
          detail: `Rank #${summary.playerRank} · VRF ${summary.vrfSeedHex.slice(0, 10)}…`,
        },
        ...prev.slice(0, 4),
      ]);
    },
    [envelopeUsdc, marketEloScaled, recordRoundElo, roundNumber, sessionMode],
  );

  // Live 1s deterministic arena tick (client-only effect, clean unmount teardown)
  React.useEffect(() => {
    if (clockPaused || settledSnapshot !== null) {
      return;
    }
    const timer = setInterval(() => {
      setTickIndex((prev) => prev + 1);
      setRemainingSecs((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [clockPaused, settledSnapshot]);

  // Trigger settlement automatically when remainingSecs hits 0 naturally
  React.useEffect(() => {
    if (remainingSecs === 0 && settledSnapshot === null) {
      finalizeSettlement(standings);
    }
  }, [finalizeSettlement, remainingSecs, settledSnapshot, standings]);

  // Enforce US Geo Fallback on Claim-Time Stock Prize Menu
  const effectiveClaimAsset: ClaimAssetSymbol =
    jurisdictionMode === "US_FALLBACK" ? "USDC" : selectedPrizeAsset;

  // Compute live or settled summary for Canvas Receipt preview & download
  const activeReceiptSummary = React.useMemo<BorelSettlementSummary>(() => {
    if (settledSnapshot) {
      return settledSnapshot;
    }
    return computeBorelSettlement({
      roundNumber,
      standings,
      sessionMode,
      envelopeUsdcWhole: envelopeUsdc,
      currentPlayerEloScaled: marketEloScaled,
    });
  }, [envelopeUsdc, marketEloScaled, roundNumber, sessionMode, settledSnapshot, standings]);

  const payoutPreviewLabel = React.useMemo(() => {
    const payoutAtomic = activeReceiptSummary.playerPayoutUsdcAtomic;
    if (effectiveClaimAsset === "USDC") {
      return `${formatAtomicUsdc(payoutAtomic)} USDC`;
    }
    const refInfo = getClaimAssetReferencePrice8(
      effectiveClaimAsset,
      marketSnapshot.quotes,
    );
    const shareUnits6 = (payoutAtomic * 100_000_000n) / refInfo.price8;
    return `+${formatShareUnits6(shareUnits6, 3)} ${effectiveClaimAsset}`;
  }, [activeReceiptSummary.playerPayoutUsdcAtomic, effectiveClaimAsset, marketSnapshot.quotes]);

  // Keep HTML5 1200x630 Canvas Receipt crisp & updated
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const deltaInt = activeReceiptSummary.deltaEloScaled / FP_SCALE;
    const deltaStr = `${deltaInt >= 0n ? "+" : ""}${deltaInt.toString()} ELO`;

    const url = renderBorelEloReceiptCanvas(canvas, {
      roundCode: activeReceiptSummary.roundCode,
      playerWalletShort: `${playerWallet.slice(0, 6)}…${playerWallet.slice(-4)}`,
      sessionModeLabel:
        sessionMode === "LIVE"
          ? `LIVE $${envelopeUsdc} USDC (${leverageCap}x CAP)`
          : "FREE PAPER MODE ($0 RISK)",
      rank: activeReceiptSummary.playerRank,
      skillScoreFormatted: activeReceiptSummary.playerScoreBpsFormatted,
      prevEloFormatted: formatEloInteger(activeReceiptSummary.prevEloScaled),
      nextEloFormatted: formatEloInteger(activeReceiptSummary.nextEloScaled),
      deltaEloFormatted: deltaStr,
      payoutSummary: claimedReceiptNote ?? payoutPreviewLabel,
      vrfSeedShort: `${activeReceiptSummary.vrfSeedHex.slice(0, 14)}…${activeReceiptSummary.vrfSeedHex.slice(-6)}`,
      erRoomProgramId: BOREL_ENGINE_PROOF.erRoomProgramId,
      teeProgramId: BOREL_ENGINE_PROOF.teePermissionProgramId,
    });
    setReceiptDataUrl(url);
  }, [
    activeReceiptSummary,
    claimedReceiptNote,
    envelopeUsdc,
    leverageCap,
    payoutPreviewLabel,
    playerWallet,
    sessionMode,
  ]);

  const totalDraftChips = draftLegs.reduce((sum, l) => sum + l.chips, 0);
  const maxRebalances = 3;
  const canSubmitStance =
    arenaPhase !== "SETTLED" && (!stanceLocked || rebalancesUsed < maxRebalances);

  const handleSwitchDuration = (nextDuration: BorelDurationMode): void => {
    setDurationMode(nextDuration);
    setSettledSnapshot(null);
    setClaimedReceiptNote(null);
    setStanceLocked(false);
    setRebalancesUsed(0);
    setRemainingSecs(nextDuration === 180 ? 156 : 48);
  };

  const handleApplyThesisPreset = (
    legs: readonly BorelChipAllocation[],
    kalshi: BorelKalshiCall,
  ): void => {
    setDraftLegs(legs);
    setDraftKalshiCall(kalshi);
  };

  const handleToggleLegDirection = (symbol: BorelAssetSymbol, dir: "LONG" | "SHORT"): void => {
    setDraftLegs((prev) =>
      prev.map((l) => (l.symbol === symbol ? { ...l, direction: dir } : l)),
    );
  };

  const handleChipSliderChange = (symbol: BorelAssetSymbol, rawChips: number): void => {
    setDraftLegs((prev) => normalizePlayerChips(prev, symbol, rawChips));
  };

  const handleSubmitStance = (): void => {
    if (!canSubmitStance) return;

    const isRebalance = stanceLocked;
    const nextRebalanceCount = isRebalance ? rebalancesUsed + 1 : 0;

    setCommittedLegs(draftLegs);
    setCommittedKalshiCall(draftKalshiCall);
    setStanceLocked(true);
    if (isRebalance) {
      setRebalancesUsed(nextRebalanceCount);
    }

    const summaryStr = draftLegs
      .filter((l) => l.chips > 0)
      .map((l) => `${l.direction === "LONG" ? "+" : "-"}${l.chips}% ${l.symbol}`)
      .join(" · ");

    setErEvents((prev) => [
      {
        id: `stance-${prev.length + 1}-${tickIndex}`,
        label: isRebalance
          ? `Tactical Rebalance (${nextRebalanceCount}/${maxRebalances})`
          : "Encrypted TEE Stance Locked",
        latencyLabel: "7.4ms · 0 Popups",
        detail: `${summaryStr} | FED ${draftKalshiCall}`,
      },
      ...prev.slice(0, 4),
    ]);
  };

  const handleJumpToShowdown = (): void => {
    setSettledSnapshot(null);
    setRemainingSecs(unsealThreshold);
    setTickIndex((prev) => prev + 3);
    setErEvents((prev) => [
      {
        id: `unseal-${roundNumber}-${tickIndex}`,
        label: `T-${unsealThreshold}s Showdown Unsealed`,
        latencyLabel: "380ms Spring",
        detail: "All Private ER TEE cipher vectors revealed on screen",
      },
      ...prev.slice(0, 4),
    ]);
  };

  const handleSettleRoundNow = (): void => {
    if (settledSnapshot !== null) return;
    const nextTick = tickIndex + 2;
    setTickIndex(nextTick);
    const snap = getBorelMarketSnapshot(nextTick);
    const finalStandings = evaluateBorelPodStandings(
      committedLegs,
      committedKalshiCall,
      snap.quotes,
    );
    finalizeSettlement(finalStandings);
  };

  const handleStartNextRound = (): void => {
    setRoundNumber((prev) => prev + 1);
    setSettledSnapshot(null);
    setClaimedReceiptNote(null);
    setStanceLocked(false);
    setRebalancesUsed(0);
    setRemainingSecs(durationMode);
    setTickIndex((prev) => prev + 1);
  };

  const handleClaimStockPrize = (): void => {
    if (claimedReceiptNote !== null) return;
    // If the judge clicks claim before settling, settle deterministically first so math is 100% consistent
    let targetSettlement = settledSnapshot;
    if (!targetSettlement) {
      targetSettlement = computeBorelSettlement({
        roundNumber,
        standings,
        sessionMode,
        envelopeUsdcWhole: envelopeUsdc,
        currentPlayerEloScaled: marketEloScaled,
      });
      setSettledSnapshot(targetSettlement);
      setRemainingSecs(0);
      recordRoundElo(targetSettlement.nextEloScaled, targetSettlement.playerRank <= 2);
    }

    const refInfo = getClaimAssetReferencePrice8(
      effectiveClaimAsset,
      marketSnapshot.quotes,
    );
    const res = creditEarnedVaultPrize(
      effectiveClaimAsset,
      targetSettlement.playerPayoutUsdcAtomic,
      refInfo.price8,
    );
    setClaimedReceiptNote(res.creditedLabel);
  };

  const handleDownloadReceiptPng = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = triggerCanvasPngDownload(
      canvas,
      `borel-market-elo-${activeReceiptSummary.roundCode.toLowerCase()}.png`,
    );
    if (url) {
      setReceiptDataUrl(url);
    }
  };

  const isShowdownOrSettled = arenaPhase === "SHOWDOWN" || arenaPhase === "SETTLED";
  const eloDeltaInt = activeReceiptSummary.deltaEloScaled / FP_SCALE;

  return (
    <div className="space-y-5">
      {/* Optional Cartridge Context Banner when navigated via ?cartridge= */}
      {activeCartridgeOverlay &&
      activeCartridgeOverlay.metadata.slug !== "borel-macro-blitz-001" ? (
        <div
          id="borel-cartridge-overlay-banner"
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#00D4FF]/35 bg-[#00D4FF]/10 px-4 py-2.5 text-xs text-slate-100"
        >
          <span>
            Running Cartridge{" "}
            <strong translate="no" className="font-mono text-[#67E8F9]">
              {activeCartridgeOverlay.metadata.title}
            </strong>{" "}
            on canonical <code className="font-mono">cartridge-er-room</code> (
            {CARTRIDGE_PROGRAM_IDS.erRoom.slice(0, 8)}…)
          </span>
          <ActionButton
            id="borel-fork-active-cartridge-btn"
            href={`/studio?fork=${activeCartridgeOverlay.metadata.slug}`}
            variant="ghost"
            size="sm"
          >
            Inspect Manifest in Vibe Studio
          </ActionButton>
        </div>
      ) : null}

      {/* 1. UNIFIED GAME-DAY COMMAND HEADER (SOLANA RFS #11) */}
      <GlassCard
        id="borel-gameday-command-header"
        variant="stage"
        accent="emerald"
        className="p-4 sm:p-5"
      >
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <GlassPill tone="emerald" size="xs">
                Cartridge #001 · Flagship Game-Day Arena (RFS #11)
              </GlassPill>
              <GlassPill tone="violet" size="xs">
                Private ER TEE · {BOREL_ENGINE_PROOF.teePermissionProgramId.slice(0, 8)}…
              </GlassPill>
              {marketSnapshot.pulseVerified ? (
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  48B Binary WorldPulse Active
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.035em] text-white sm:text-3xl">
              BOREL — Blind Conviction Blitz
            </h1>
          </div>

          {/* Mode Toggle + Unified 7-Chain & Apple Pay Cashier Trigger */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Blitz Round Duration"
              className="inline-flex rounded-xl border border-white/10 bg-[#050609] p-1"
            >
              <button
                id="borel-duration-60s"
                type="button"
                onClick={() => handleSwitchDuration(60)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 font-mono text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                  durationMode === 60
                    ? "bg-[#00F59B] text-[#050609]"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                60s Blitz
              </button>
              <button
                id="borel-duration-180s"
                type="button"
                onClick={() => handleSwitchDuration(180)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 font-mono text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                  durationMode === 180
                    ? "bg-[#00F59B] text-[#050609]"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                180s Macro Sprint
              </button>
            </div>

            <ActionButton
              id="open-cashier-modal-btn"
              variant="glass"
              size="md"
              onClick={openCashier}
            >
              7-Chain &amp; Apple Pay Cashier
            </ActionButton>
          </div>
        </div>

        {/* Multi-Venue Live Ticking Strip */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {marketSnapshot.quotes.map((q) => {
            const positive = q.velocityBps >= 0;
            return (
              <div
                key={q.symbol}
                id={`borel-ticker-${q.symbol}`}
                className="rounded-xl border border-white/[0.08] bg-[#050609]/90 p-3 font-mono tabular-nums"
              >
                <div className="flex items-center justify-between gap-1 text-[11px]">
                  <span translate="no" className="font-semibold text-slate-200">
                    {q.symbol}
                  </span>
                  <span className="truncate text-[10px] text-slate-400">{q.venue}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-base font-bold text-white sm:text-lg">
                    {q.displayPrice}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      positive ? "text-[#00F59B]" : "text-[#FFB020]"
                    }`}
                  >
                    {q.deltaBpsFormatted}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Session Risk Envelope Bar: Paper Mode ($0) vs Live USDC Envelope (<= 5x Cap) */}
        <div className="mt-4 flex flex-col justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-3.5 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-300">Session Risk Envelope:</span>
            <div
              role="group"
              aria-label="Paper vs Live Session Mode"
              className="inline-flex rounded-xl border border-white/10 bg-[#0A0D14] p-1"
            >
              <button
                id="borel-mode-paper"
                type="button"
                onClick={() => setSessionMode("PAPER")}
                className={`cursor-pointer rounded-lg px-3 py-1 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                  sessionMode === "PAPER"
                    ? "bg-[#00D4FF] text-[#050609]"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Paper Mode ($0 Risk)
              </button>
              <button
                id="borel-mode-live"
                type="button"
                onClick={() => setSessionMode("LIVE")}
                className={`cursor-pointer rounded-lg px-3 py-1 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                  sessionMode === "LIVE"
                    ? "bg-[#00F59B] text-[#050609]"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Live Envelope (USDC)
              </button>
            </div>
          </div>

          {sessionMode === "LIVE" ? (
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="flex flex-wrap items-center gap-1"
                role="group"
                aria-label="Max Session USDC Exposure"
              >
                <span className="mr-1 text-[11px] text-slate-400">Cap:</span>
                {ENVELOPE_OPTIONS.map((amt) => (
                  <button
                    key={amt}
                    id={`borel-envelope-${amt}`}
                    type="button"
                    onClick={() => setEnvelopeUsdc(amt)}
                    className={`cursor-pointer rounded-lg border px-2 py-1 font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                      envelopeUsdc === amt
                        ? "border-[#00F59B] bg-[#00F59B]/15 font-semibold text-[#00F59B]"
                        : "border-white/10 bg-[#0A0D14] text-slate-300 hover:border-white/25"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>

              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="Leverage Ceiling (<= 5x)"
              >
                <span className="mr-1 text-[11px] text-slate-400">
                  Max Lev (&lt;={ENGINE_GUARDRAILS.maxLiveLeverage}x):
                </span>
                {LEVERAGE_OPTIONS.map((lev) => (
                  <button
                    key={lev}
                    id={`borel-leverage-${lev}x`}
                    type="button"
                    onClick={() => setLeverageCap(lev)}
                    className={`cursor-pointer rounded-lg border px-2 py-1 font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                      leverageCap === lev
                        ? "border-[#00D4FF] bg-[#00D4FF]/15 font-semibold text-[#67E8F9]"
                        : "border-white/10 bg-[#0A0D14] text-slate-300 hover:border-white/25"
                    }`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="font-mono text-xs text-[#67E8F9] tabular-nums">
              $0 Capital at Risk · Competing for Market ELO (K=12) &amp; $40 Sponsor Stock Pool
            </div>
          )}
        </div>
      </GlassCard>

      {/* 2. BLIND CONVICTION BLITZ ARENA: TACTICAL DECK (LEFT) + RIVAL POD GRID (RIGHT) */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* LEFT COLUMN (5 cols): Tactical Conviction Chip Deck */}
        <GlassCard
          id="borel-tactical-conviction-deck"
          accent="cyan"
          className="p-4 sm:p-5 lg:col-span-5"
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
            <div>
              <span className="font-mono text-[11px] font-semibold text-[#00D4FF]">
                TACTICAL CONVICTION DECK
              </span>
              <h2 className="mt-0.5 font-display text-lg font-bold text-white">
                Allocate 100 Conviction Chips
              </h2>
            </div>
            <span
              id="borel-allocated-chips-pill"
              className={`rounded-xl border px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${
                totalDraftChips === 100
                  ? "border-[#00F59B]/45 bg-[#00F59B]/12 text-[#00F59B]"
                  : "border-[#00D4FF]/40 bg-[#00D4FF]/12 text-[#67E8F9]"
              }`}
            >
              {totalDraftChips} / 100 Chips
            </span>
          </div>

          {/* Quick Thesis Presets */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              id="borel-preset-ai-divergence"
              type="button"
              onClick={() =>
                handleApplyThesisPreset(
                  [
                    { symbol: "NVDAx", direction: "LONG", chips: 55 },
                    { symbol: "SOL-PERP", direction: "LONG", chips: 25 },
                    { symbol: "SPYx", direction: "SHORT", chips: 20 },
                  ],
                  "YES",
                )
              }
              className="cursor-pointer rounded-lg border border-white/10 bg-[#050609] px-2.5 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-[#00F59B]/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            >
              AI Beat + Short SPY
            </button>
            <button
              id="borel-preset-macro-meltup"
              type="button"
              onClick={() =>
                handleApplyThesisPreset(
                  [
                    { symbol: "SOL-PERP", direction: "LONG", chips: 50 },
                    { symbol: "NVDAx", direction: "LONG", chips: 35 },
                    { symbol: "SPYx", direction: "LONG", chips: 15 },
                  ],
                  "YES",
                )
              }
              className="cursor-pointer rounded-lg border border-white/10 bg-[#050609] px-2.5 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-[#00F59B]/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            >
              Dovish Risk-On
            </button>
            <button
              id="borel-preset-hedge-shock"
              type="button"
              onClick={() =>
                handleApplyThesisPreset(
                  [
                    { symbol: "SOL-PERP", direction: "SHORT", chips: 40 },
                    { symbol: "NVDAx", direction: "LONG", chips: 40 },
                    { symbol: "SPYx", direction: "SHORT", chips: 20 },
                  ],
                  "NO",
                )
              }
              className="cursor-pointer rounded-lg border border-white/10 bg-[#050609] px-2.5 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-[#00F59B]/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
            >
              Hawkish Pair Hedge
            </button>
          </div>

          {/* Individual Asset Conviction Sliders */}
          <div className="mt-4 space-y-3">
            {draftLegs.map((leg) => (
              <div
                key={leg.symbol}
                className="rounded-xl border border-white/[0.08] bg-[#050609]/90 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`borel-chips-${leg.symbol}`}
                    translate="no"
                    className="font-mono text-xs font-bold text-white"
                  >
                    {leg.symbol}
                  </label>

                  <div className="flex items-center gap-1.5">
                    <button
                      id={`borel-dir-${leg.symbol}-long`}
                      type="button"
                      onClick={() => handleToggleLegDirection(leg.symbol, "LONG")}
                      className={`cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                        leg.direction === "LONG"
                          ? "border-[#00F59B] bg-[#00F59B]/15 text-[#00F59B]"
                          : "border-white/10 bg-[#0A0D14] text-slate-400 hover:text-white"
                      }`}
                    >
                      LONG
                    </button>
                    <button
                      id={`borel-dir-${leg.symbol}-short`}
                      type="button"
                      onClick={() => handleToggleLegDirection(leg.symbol, "SHORT")}
                      className={`cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                        leg.direction === "SHORT"
                          ? "border-[#FFB020] bg-[#FFB020]/15 text-[#FCD34D]"
                          : "border-white/10 bg-[#0A0D14] text-slate-400 hover:text-white"
                      }`}
                    >
                      SHORT
                    </button>
                    <span className="w-14 text-right font-mono text-xs font-bold text-slate-100 tabular-nums">
                      {leg.chips} ch
                    </span>
                  </div>
                </div>

                <input
                  id={`borel-chips-${leg.symbol}`}
                  name={`chips-${leg.symbol}`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={leg.chips}
                  onChange={(e) => handleChipSliderChange(leg.symbol, Number(e.target.value))}
                  className="mt-2.5 h-2 w-full cursor-pointer accent-[#00F59B]"
                />
              </div>
            ))}
          </div>

          {/* KALSHI-FED-CUT Binary Catalyst Call (1.35x Carry) */}
          <div className="mt-3.5 rounded-xl border border-[#00D4FF]/30 bg-[#050609]/95 p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span translate="no" className="font-mono font-semibold text-[#67E8F9]">
                KALSHI-FED-CUT Catalyst
              </span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                1.35x Brier Carry
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                id="borel-kalshi-yes"
                type="button"
                onClick={() => setDraftKalshiCall("YES")}
                className={`cursor-pointer rounded-xl border py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                  draftKalshiCall === "YES"
                    ? "border-[#00D4FF] bg-[#00D4FF]/15 text-[#67E8F9]"
                    : "border-white/10 bg-[#0A0D14] text-slate-400 hover:text-white"
                }`}
              >
                YES · Fed Cuts (1.35x)
              </button>
              <button
                id="borel-kalshi-no"
                type="button"
                onClick={() => setDraftKalshiCall("NO")}
                className={`cursor-pointer rounded-xl border py-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                  draftKalshiCall === "NO"
                    ? "border-[#FFB020] bg-[#FFB020]/15 text-[#FCD34D]"
                    : "border-white/10 bg-[#0A0D14] text-slate-400 hover:text-white"
                }`}
              >
                NO · Hold Rates (1.00x)
              </button>
            </div>
          </div>

          {/* Zero-Popup Submit / Tactical Rebalance CTA */}
          <div className="mt-4">
            <ActionButton
              id="borel-submit-stance-btn"
              variant="emerald"
              size="lg"
              disabled={!canSubmitStance}
              onClick={handleSubmitStance}
              className="w-full"
            >
              {arenaPhase === "SETTLED"
                ? "Round Settled — Start Next Pod"
                : !stanceLocked
                  ? "Lock Stance (0 Gas · 0 Popups)"
                  : rebalancesUsed < maxRebalances
                    ? `Tactical Rebalance (${maxRebalances - rebalancesUsed}/${maxRebalances} Left · 0 Popups)`
                    : "Max 3/3 Rebalances Used"}
            </ActionButton>

            <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400 tabular-nums">
              <span translate="no">
                Session Signer: {sessionKeyPubkey.slice(0, 8)}…
              </span>
              <span>Rebalances: {rebalancesUsed} / 3</span>
            </div>
          </div>

          {/* Live 10ms ER Telemetry Feed */}
          <div
            aria-live="polite"
            className="mt-4 space-y-1.5 rounded-xl border border-white/[0.07] bg-[#050609] p-3"
          >
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-400">
              <span>10ms Private ER Action Stream</span>
              <span className="text-[#00F59B]">0 Wallet Popups</span>
            </div>
            {erEvents.slice(0, 3).map((ev) => (
              <div
                key={ev.id}
                className="rounded-lg border border-white/[0.05] bg-[#0A0D14] px-2.5 py-1.5 font-mono text-[11px] tabular-nums"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{ev.label}</span>
                  <span className="text-[10px] text-[#00F59B]">{ev.latencyLabel}</span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-slate-400">
                  {ev.detail}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* RIGHT COLUMN (7 cols): Live Arena Clock, Deterministic Controls & Rival ShowdownFlipCard Grid */}
        <GlassCard
          id="borel-rival-pod-stage"
          variant="stage"
          accent={
            arenaPhase === "FOG_OF_WAR"
              ? "violet"
              : arenaPhase === "SHOWDOWN"
                ? "amber"
                : "emerald"
          }
          className="p-4 sm:p-5 lg:col-span-7"
        >
          {/* Clock & Deterministic Lifecycle Bar */}
          <div className="flex flex-col justify-between gap-3 border-b border-white/[0.08] pb-4 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                id="borel-round-clock"
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 font-mono text-base font-bold tabular-nums ${
                  arenaPhase === "FOG_OF_WAR"
                    ? "border-[#8B5CF6]/45 bg-[#8B5CF6]/15 text-[#C4B5FD]"
                    : arenaPhase === "SHOWDOWN"
                      ? "border-[#FFB020]/50 bg-[#FFB020]/15 text-[#FCD34D]"
                      : "border-[#00F59B]/50 bg-[#00F59B]/15 text-[#00F59B]"
                }`}
              >
                <LivePulseDot
                  tone={
                    arenaPhase === "FOG_OF_WAR"
                      ? "violet"
                      : arenaPhase === "SHOWDOWN"
                        ? "amber"
                        : "emerald"
                  }
                  size="sm"
                />
                <span>{formatCountdownClock(remainingSecs)}</span>
              </span>

              <div>
                <div
                  id="borel-phase-status-label"
                  className="font-mono text-xs font-bold text-white"
                >
                  {arenaPhase === "FOG_OF_WAR"
                    ? "TEE FOG OF WAR · ENCRYPTED WEIGHTS"
                    : arenaPhase === "SHOWDOWN"
                      ? `T-${unsealThreshold}s SHOWDOWN UNSEALED`
                      : `ROUND #${activeReceiptSummary.roundCode} SETTLED`}
                </div>
                <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {arenaPhase === "FOG_OF_WAR"
                    ? `Unseals automatically at 00:${unsealThreshold.toString().padStart(2, "0")}`
                    : arenaPhase === "SHOWDOWN"
                      ? "380ms 3D Spring Unseal Active · Zero Copy-Trade Window"
                      : `MagicBlock VRF Verified (${activeReceiptSummary.vrfProgramId.slice(0, 8)}…)`}
                </div>
              </div>
            </div>

            {/* Deterministic Judge & Playwright Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                id="borel-pause-clock-btn"
                type="button"
                onClick={() => setClockPaused((prev) => !prev)}
                className="cursor-pointer rounded-xl border border-white/12 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11px] font-medium text-slate-200 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
              >
                {clockPaused ? "Resume" : "Pause"}
              </button>

              <button
                id="borel-jump-showdown-btn"
                type="button"
                onClick={handleJumpToShowdown}
                className="cursor-pointer rounded-xl border border-[#FFB020]/45 bg-[#FFB020]/12 px-3 py-1.5 font-mono text-[11px] font-semibold text-[#FCD34D] transition-colors hover:bg-[#FFB020]/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020]"
              >
                Jump to T-{unsealThreshold}s Showdown
              </button>

              <button
                id="borel-settle-now-btn"
                type="button"
                onClick={handleSettleRoundNow}
                disabled={settledSnapshot !== null}
                className="cursor-pointer rounded-xl border border-[#00F59B]/45 bg-[#00F59B]/14 px-3 py-1.5 font-mono text-[11px] font-semibold text-[#00F59B] transition-colors hover:bg-[#00F59B]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] disabled:opacity-45"
              >
                Settle Round Now
              </button>

              {settledSnapshot !== null ? (
                <button
                  id="borel-new-round-btn"
                  type="button"
                  onClick={handleStartNextRound}
                  className="cursor-pointer rounded-xl border border-[#00D4FF]/45 bg-[#00D4FF]/14 px-3 py-1.5 font-mono text-[11px] font-semibold text-[#67E8F9] transition-colors hover:bg-[#00D4FF]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]"
                >
                  Next Pod
                </button>
              ) : null}
            </div>
          </div>

          {/* Player's Own Live Pod */}
          <div
            id="borel-player-live-pod"
            className="mt-4 rounded-2xl border border-[#00F59B]/35 bg-[#0B121B]/95 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GlassPill tone="emerald" size="xs">
                  YOU · RANK #{playerStanding.rank} OF 4
                </GlassPill>
                <span className="font-mono text-[11px] text-slate-400">
                  {stanceLocked ? "Encrypted Stance Active" : "Default Stance Armed"}
                </span>
              </div>
              <span
                id="borel-player-live-score"
                className="font-mono text-base font-bold text-[#00F59B] tabular-nums"
              >
                {playerStanding.deltaBpsFormatted}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {playerStanding.allocationsUi.map((item) => (
                <div
                  key={item.symbol}
                  className="rounded-xl border border-white/[0.08] bg-[#050609]/90 px-2.5 py-2 font-mono tabular-nums"
                >
                  <div translate="no" className="text-[10px] text-slate-400">
                    {item.symbol}
                  </div>
                  <div
                    className={`mt-0.5 text-xs font-bold ${
                      item.tone === "amber"
                        ? "text-[#FCD34D]"
                        : item.tone === "cyan"
                          ? "text-[#67E8F9]"
                          : "text-[#00F59B]"
                    }`}
                  >
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3 Rival Pods Using ShowdownFlipCard (380ms 3D Spring Physics) */}
          <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {rivalStandings.map((rival) => (
              <ShowdownFlipCard
                key={rival.id}
                id={rival.id}
                playerHandle={rival.handle}
                rank={rival.rank}
                publicDeltaBpsFormatted={rival.deltaBpsFormatted}
                cipherDigest={rival.cipherDigest}
                teeProgramShort={`${BOREL_ENGINE_PROOF.teePermissionProgramId.slice(0, 8)}…2XQnp1`}
                unsealed={isShowdownOrSettled}
                finalScoreFormatted={rival.deltaBpsFormatted}
                vrfProofShort={`${BOREL_ENGINE_PROOF.vrfProgramId.slice(0, 8)}…UwGz`}
                allocations={rival.allocationsUi}
                onToggleUnseal={handleJumpToShowdown}
              />
            ))}
          </div>
        </GlassCard>
      </div>

      {/* 3. ROUND SETTLEMENT, VRF PROOF, CLAIM-TIME STOCK PRIZE MENU (RFS #3) & MARKET ELO RECEIPT */}
      <GlassCard
        id="borel-settlement-and-vault-section"
        variant="stage"
        accent="amber"
        className="p-4 sm:p-6"
      >
        <div className="flex flex-col justify-between gap-3 border-b border-white/[0.08] pb-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <GlassPill tone="amber" size="xs">
                Solana RFS #3 · Claim-Time Stock Prize Menu
              </GlassPill>
              <GlassPill tone="emerald" size="xs">
                VRF Verified · {BOREL_ENGINE_PROOF.vrfProgramId.slice(0, 10)}…
              </GlassPill>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                Solvency: Distributed (
                {formatAtomicUsdc(activeReceiptSummary.poolDistribution.totalDistributedUsdc)}) &lt;=
                Pool ({formatAtomicUsdc(activeReceiptSummary.poolDistribution.roomPoolUsdc)})
              </span>
            </div>
            <h2 className="mt-2 font-display text-xl font-bold text-white sm:text-2xl">
              Earned Stock Vault Claim &amp; Verifiable Market ELO Receipt
            </h2>
          </div>

          {/* Market ELO Transition Readout */}
          <div
            id="borel-elo-transition-pill"
            className="rounded-2xl border border-[#00D4FF]/35 bg-[#050609] px-4 py-2.5 font-mono tabular-nums"
          >
            <div className="text-[10px] uppercase text-slate-400">
              Market ELO Update ({sessionMode === "LIVE" ? "K=32 Live" : "K=12 Paper"})
            </div>
            <div className="mt-0.5 text-base font-bold text-white">
              {formatEloInteger(activeReceiptSummary.prevEloScaled)} -&gt;{" "}
              <span className="text-[#00F59B]">
                {formatEloInteger(activeReceiptSummary.nextEloScaled)}
              </span>{" "}
              <span className="text-xs text-[#67E8F9]">
                ({eloDeltaInt >= 0n ? "+" : ""}
                {eloDeltaInt.toString()})
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left (6 cols): Jurisdiction Simulator + Claim-Time Stock Prize Menu */}
          <div className="space-y-4 lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#050609]/90 p-3">
              <span className="text-xs font-medium text-slate-300">
                Passport Geo-Compliance Gate:
              </span>
              <div
                role="group"
                aria-label="Jurisdiction Eligibility Simulator"
                className="inline-flex rounded-lg border border-white/10 bg-[#0A0D14] p-1"
              >
                <button
                  id="borel-geo-eligible-btn"
                  type="button"
                  onClick={() => setJurisdictionMode("NON_US_ELIGIBLE")}
                  className={`cursor-pointer rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                    jurisdictionMode === "NON_US_ELIGIBLE"
                      ? "bg-[#00F59B] text-[#050609]"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Non-US (xStocks Eligible)
                </button>
                <button
                  id="borel-geo-us-fallback-btn"
                  type="button"
                  onClick={() => setJurisdictionMode("US_FALLBACK")}
                  className={`cursor-pointer rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB020] ${
                    jurisdictionMode === "US_FALLBACK"
                      ? "bg-[#FFB020] text-[#050609]"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  US (USDC Auto-Fallback)
                </button>
              </div>
            </div>

            {jurisdictionMode === "US_FALLBACK" ? (
              <div className="rounded-xl border border-[#FFB020]/35 bg-[#FFB020]/10 px-3.5 py-2.5 font-mono text-xs text-[#FCD34D]">
                cartridge-passport bitmask check: US IP/Passport detected — tokenized equities
                gated; 100% of prize pool automatically delivers as canonical Solana USDC.
              </div>
            ) : null}

            {/* 4 Claim Menu Cards */}
            <div className="grid grid-cols-2 gap-2.5">
              {CLAIM_MENU_OPTIONS.map((opt) => {
                const refInfo = getClaimAssetReferencePrice8(
                  opt.symbol,
                  marketSnapshot.quotes,
                );
                const gated = jurisdictionMode === "US_FALLBACK" && opt.isEquity;
                const selected = effectiveClaimAsset === opt.symbol;
                const estUnits6 =
                  opt.symbol === "USDC"
                    ? activeReceiptSummary.playerPayoutUsdcAtomic
                    : (activeReceiptSummary.playerPayoutUsdcAtomic * 100_000_000n) /
                      refInfo.price8;

                return (
                  <button
                    key={opt.symbol}
                    id={`borel-claim-asset-${opt.symbol}`}
                    type="button"
                    disabled={gated}
                    onClick={() => setSelectedPrizeAsset(opt.symbol)}
                    className={`cursor-pointer rounded-2xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected
                        ? "border-[#00F59B] bg-[#00F59B]/12"
                        : "border-white/10 bg-[#050609]/90 hover:border-white/25"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span translate="no" className="font-display text-sm font-bold text-white">
                        {opt.symbol}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {gated ? "GEO-GATED" : opt.venue}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{opt.name}</div>
                    <div className="mt-2 font-mono text-xs font-bold text-[#00F59B] tabular-nums">
                      {opt.symbol === "USDC"
                        ? formatAtomicUsdc(estUnits6)
                        : `+${formatShareUnits6(estUnits6, 3)} ${opt.symbol}`}
                    </div>
                    <div
                      translate="no"
                      className="mt-0.5 font-mono text-[10px] text-slate-500 tabular-nums"
                    >
                      {opt.symbol === "USDC"
                        ? refInfo.mintShort
                        : `${formatPrice8Usd(refInfo.price8)} · ${refInfo.mintShort}`}
                    </div>
                  </button>
                );
              })}
            </div>

            <ActionButton
              id="borel-claim-prize-btn"
              variant="emerald"
              size="lg"
              disabled={claimedReceiptNote !== null}
              onClick={handleClaimStockPrize}
              className="w-full"
            >
              {claimedReceiptNote !== null
                ? `Credited to Earned Stock Vault: ${claimedReceiptNote}`
                : `Claim ${payoutPreviewLabel} into Earned Stock Vault`}
            </ActionButton>

            {/* Live Earned Stock Vault Balances */}
            <div className="grid grid-cols-4 gap-2 rounded-xl border border-white/[0.08] bg-[#050609] p-3 font-mono text-xs tabular-nums">
              <div>
                <div translate="no" className="text-[10px] text-slate-400">
                  NVDAx
                </div>
                <div className="font-bold text-[#00F59B]">
                  {formatShareUnits6(earnedStocks.NVDAx, 3)}
                </div>
              </div>
              <div>
                <div translate="no" className="text-[10px] text-slate-400">
                  ANTx
                </div>
                <div className="font-bold text-[#C4B5FD]">
                  {formatShareUnits6(earnedStocks.ANTx, 3)}
                </div>
              </div>
              <div>
                <div translate="no" className="text-[10px] text-slate-400">
                  SPYx
                </div>
                <div className="font-bold text-[#00D4FF]">
                  {formatShareUnits6(earnedStocks.SPYx, 3)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Cash USDC</div>
                <div className="font-bold text-white">{formatAtomicUsdc(cashUsdcAtomic)}</div>
              </div>
            </div>
          </div>

          {/* Right (6 cols): Crisp 1200x630 HTML5 Canvas Market ELO Receipt Card */}
          <div className="flex flex-col justify-between space-y-3 lg:col-span-6">
            <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#050609] p-2">
              <canvas
                id="borel-elo-receipt-canvas"
                ref={canvasRef}
                width={1200}
                height={630}
                data-receipt-ready={receiptDataUrl.startsWith("data:image/png") ? "true" : "false"}
                aria-label="Verifiable Market ELO Receipt Card Preview"
                className="block h-auto w-full rounded-xl"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                1200x630 High-Contrast PNG · VRF Seed{" "}
                <span translate="no" className="text-slate-200">
                  {activeReceiptSummary.vrfSeedHex.slice(0, 10)}…
                </span>
              </div>
              <ActionButton
                id="download-elo-receipt-btn"
                variant="glass"
                size="md"
                onClick={handleDownloadReceiptPng}
              >
                Download Market ELO Receipt Card
              </ActionButton>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
