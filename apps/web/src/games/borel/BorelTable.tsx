"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ExternalLink, Lock, Shield, Repeat2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import devnetProof from "@/data/devnet-proof.json";
import {
  BOREL_MARKETS,
  ROOM_DURATION_MS,
  type BorelMarket,
  type Conviction,
  type Direction,
  type LegIndex,
  type LockedHand,
  type PivotAction,
  type PivotKind,
  type RoomMode,
  type StakeMode,
} from "@/lib/borel/types";
import {
  handCommitment,
  handScoreE9,
  legScoreE9,
  rankByScore,
  validateHand,
} from "@/lib/borel/scoring";
import { usePythPrices } from "@/lib/borel/pyth";
import { useBorelIdentity } from "@/lib/wallet/identity";
import { cn } from "@/lib/utils";
import { TokenIcon } from "@/components/TokenIcon";
import { PACER_PROFILES, buildPacerHand, type PriceBookE9 } from "./pacers";
import {
  EQUITY_MARKETS,
  MARKET_SHORT,
  formatClock,
  formatPriceE9,
  formatScorePctPrecise,
  shortHash,
} from "./format";
import { HandReceipt, type LegOutcome, type ReceiptLeg } from "./HandReceipt";
import { HowToPlay, PhaseGuide } from "./HowToPlay";
import { LiveLadder, SeatAvatar, Sparkline, seatName, type LadderRow } from "./LiveLadder";
import type { MatrixSeat } from "./EnclaveStateMatrix";
import {
  chainJoin,
  chainLock,
  chainPivot,
  chainSettle,
  chainTieBreakSeed,
  type ChainOutcome,
} from "./chain";

const EnclaveStateMatrix = dynamic(() => import("./EnclaveStateMatrix"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#0a0d14]" />,
});

type TablePhase = "DRAFT" | "SEALED" | "SHOWDOWN";

const HOW_TO_SEEN_KEY = "borel:how-to-seen:v1";

interface DraftLeg {
  market: BorelMarket;
  direction: Direction;
  conviction: Conviction;
}

interface Seat {
  id: string;
  label: string;
  strategy: string;
  isYou: boolean;
  hand: LockedHand;
  pivot?: PivotAction;
}

interface ReceiptEntry {
  label: string;
  outcome: ChainOutcome;
}

const DEFAULT_DRAFT: readonly DraftLeg[] = [
  { market: "SOL/USD", direction: "LONG", conviction: 3 },
  { market: "BTC/USD", direction: "LONG", conviction: 2 },
  { market: "ETH/USD", direction: "SHORT", conviction: 1 },
];

const MODE_LABEL: Record<RoomMode, string> = { BLITZ_3M: "Blitz 3m", MACRO_15M: "Macro 15m" };
const ER_ROOM_SOLSCAN = devnetProof.programs.cartridgeErRoom.solscanUrl;

function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function outcomeOf(scoreE9: bigint): LegOutcome {
  if (scoreE9 > 0n) return "WIN";
  if (scoreE9 < 0n) return "LOSS";
  return "FLAT";
}

function scoreTone(scoreE9: bigint): string {
  if (scoreE9 > 0n) return "text-[#34d399]";
  if (scoreE9 < 0n) return "text-[#f87171]";
  return "text-[#d1d5db]";
}

/* ------------------------------------------------------------------------ */

function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  idPrefix,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  idPrefix: string;
  labels: Record<T, string>;
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0b0c0e] p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          id={`${idPrefix}-${opt.toLowerCase()}`}
          type="button"
          disabled={disabled}
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
          className={cn(
            "cf-btn h-8 cursor-pointer rounded-md px-2 font-mono text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:text-[12px]",
            value === opt ? "bg-[#1d2129] text-[#f3f4f6]" : "text-[#6b7280] hover:text-[#d1d5db]",
          )}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

function FeedBadge({
  market,
  status,
}: {
  market: BorelMarket;
  status: "live" | "stale" | "closed" | "error" | undefined;
}): React.JSX.Element | null {
  if (status === "live" || status === undefined) {
    return EQUITY_MARKETS.has(market) && status === undefined ? (
      <span className="font-mono text-[10px] text-[#6b7280]">connecting</span>
    ) : null;
  }
  return (
    <span
      className={cn(
        "rounded border px-1 font-mono text-[10px]",
        status === "error"
          ? "border-[#ef4444]/40 text-[#f87171]"
          : "border-[#f59e0b]/40 text-[#fbbf24]",
      )}
    >
      {status}
    </span>
  );
}

const TOKEN_SYMBOL: Partial<Record<BorelMarket, string>> = {
  "SOL/USD": "SOL",
  "BTC/USD": "BTC",
  "NVDAx/USD": "NVDAX",
  "SPY/USD": "SPYX",
};

function MarketMark({ market, size = 14 }: { market: BorelMarket; size?: number }): React.JSX.Element {
  const symbol = TOKEN_SYMBOL[market];
  if (symbol) return <TokenIcon symbol={symbol} size={size} />;
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#303642] bg-[#171a20] font-mono font-semibold leading-none text-[#d1d5db]"
      style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.5)) }}
    >
      E
    </span>
  );
}

type FeedStatus = "live" | "stale" | "closed" | "error";

function unavailableReason(market: BorelMarket, status: FeedStatus | undefined): string | null {
  if (status === "closed") return `${MARKET_SHORT[market]} closed outside US hours`;
  if (status === "error") return `${MARKET_SHORT[market]} feed unavailable`;
  if (status === "stale") return `${MARKET_SHORT[market]} price stale`;
  return null;
}

/* ------------------------------------------------------------------------ */

function DraftCard({
  index,
  leg,
  takenMarkets,
  pricesE9,
  status,
  onChange,
  onAssignConviction,
}: {
  index: LegIndex;
  leg: DraftLeg;
  takenMarkets: ReadonlySet<BorelMarket>;
  pricesE9: PriceBookE9;
  status: Partial<Record<BorelMarket, "live" | "stale" | "closed" | "error">>;
  onChange: (next: DraftLeg) => void;
  onAssignConviction: (conviction: Conviction) => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-3 p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 font-mono text-[11px] font-semibold text-[#9ca3af] tabular-nums">
            {index + 1}
          </span>
          <MarketMark market={leg.market} size={20} />
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[#f3f4f6]">{leg.market}</span>
          <FeedBadge market={leg.market} status={status[leg.market]} />
        </div>
        <span className="shrink-0 font-mono text-[13px] text-[#d1d5db] tabular-nums [font-variant-numeric:tabular-nums_slashed-zero]">
          {formatPriceE9(pricesE9[leg.market])}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={`Leg ${index + 1} market`}>
        {BOREL_MARKETS.map((m) => {
          const taken = takenMarkets.has(m) && leg.market !== m;
          const feed = status[m];
          const blocked = feed === "closed" || feed === "error";
          const reason = unavailableReason(m, feed);
          return (
            <button
              key={m}
              id={`borel-leg-${index}-market-${MARKET_SHORT[m].toLowerCase()}`}
              type="button"
              disabled={taken || (blocked && leg.market !== m)}
              aria-pressed={leg.market === m}
              title={reason ?? (taken ? "Used by another leg" : m)}
              onClick={() => onChange({ ...leg, market: m })}
              className={cn(
                "cf-btn flex h-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border font-mono text-[10px] font-medium leading-none disabled:cursor-not-allowed disabled:opacity-25",
                leg.market === m
                  ? "border-[#3b82f6] bg-[#2563eb]/15 text-[#f3f4f6] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "border-white/[0.07] bg-[#0d1017] text-[#9ca3af] hover:border-white/20",
                feed === "stale" && leg.market !== m ? "opacity-60" : "",
              )}
            >
              <MarketMark market={m} size={18} />
              <span>{MARKET_SHORT[m]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto grid grid-cols-[1fr_auto] gap-2">
        <div className="grid grid-cols-2 rounded-lg border border-white/[0.07] bg-[#0d1017] p-0.5" role="group" aria-label={`Leg ${index + 1} direction`}>
          {(["LONG", "SHORT"] as const).map((d) => (
            <button
              key={d}
              id={`borel-leg-${index}-${d.toLowerCase()}`}
              type="button"
              aria-pressed={leg.direction === d}
              onClick={() => onChange({ ...leg, direction: d })}
              className={cn(
                "cf-btn h-10 cursor-pointer rounded-md font-mono text-[12px] font-semibold",
                leg.direction === d
                  ? d === "LONG"
                    ? "bg-[#10b981]/15 text-[#34d399] shadow-[inset_0_0_0_1px_rgba(16,185,129,0.45)]"
                    : "bg-[#ef4444]/15 text-[#f87171] shadow-[inset_0_0_0_1px_rgba(239,68,68,0.45)]"
                  : "text-[#6b7280] hover:text-[#d1d5db]",
              )}
            >
              {d === "LONG" ? "▲ Long" : "▼ Short"}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label={`Leg ${index + 1} conviction card`}>
          {([1, 2, 3] as const).map((c) => (
            <button
              key={c}
              id={`borel-leg-${index}-card-${c}`}
              type="button"
              aria-pressed={leg.conviction === c}
              onClick={() => onAssignConviction(c)}
              className={cn(
                "cf-btn h-11 w-11 cursor-pointer rounded-lg border font-mono text-[13px] font-semibold tabular-nums",
                leg.conviction === c
                  ? c === 3
                    ? "border-[#f59e0b] bg-[#f59e0b]/15 text-[#fbbf24]"
                    : "border-[#3b82f6] bg-[#2563eb]/20 text-[#f3f4f6]"
                  : "border-white/[0.07] bg-[#0d1017] text-[#6b7280] hover:text-[#d1d5db]",
              )}
            >
              {c}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveLegCard({
  index,
  leg,
  scoreE9,
  nowPriceE9,
  pivot,
  revealed,
}: {
  index: number;
  leg: LockedHand[number];
  scoreE9: bigint;
  nowPriceE9: bigint | undefined;
  pivot?: PivotAction;
  revealed: boolean;
}): React.JSX.Element {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { rotateY: revealed ? 180 : -180, opacity: 0.3 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: revealed ? 0.9 : 0.7, delay: index * 0.1, ease: [0.23, 1, 0.32, 1] }}
      style={{ transformPerspective: 900 }}
      className={cn(
        "flex h-full flex-col justify-between gap-1.5 rounded-xl border p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] sm:p-3.5",
        revealed ? "border-[#3b82f6]/45 bg-[#0c1220]" : "border-[#f59e0b]/30 bg-[#0c0f16]",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-mono text-[10px] font-medium sm:text-[11px]",
            revealed ? "text-[#93c5fd]" : "text-[#fbbf24]",
          )}
        >
          {revealed ? null : <Lock className="h-3 w-3" />}
          Leg {index + 1}
        </span>
        <span
          className={cn(
            "rounded border px-1 font-mono text-[10px] font-semibold tabular-nums sm:text-[11px]",
            leg.conviction === 3 ? "border-[#f59e0b]/60 text-[#fbbf24]" : "border-white/15 text-[#d1d5db]",
          )}
        >
          {leg.conviction}x
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <MarketMark market={leg.market} size={20} />
        <span className="truncate text-[13px] font-semibold text-[#f3f4f6] sm:text-sm">{MARKET_SHORT[leg.market]}</span>
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-[11px] font-semibold",
            leg.direction === "LONG" ? "text-[#34d399]" : "text-[#f87171]",
          )}
          aria-label={leg.direction}
        >
          {leg.direction === "LONG" ? "▲" : "▼"}
        </span>
      </div>
      <div className={cn("font-mono text-[17px] font-semibold leading-none tabular-nums sm:text-2xl", scoreTone(scoreE9))}>
        {formatScorePctPrecise(scoreE9)}
      </div>
      <div className="truncate font-mono text-[10px] text-[#6b7280] tabular-nums">
        {pivot ? (pivot.kind === "FLIP" ? "Flipped" : "Shielded") : revealed ? "out" : "now"}{" "}
        <span className="text-[#9ca3af]">{formatPriceE9(nowPriceE9)}</span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------ */

function ReceiptLine({ entry }: { entry: ReceiptEntry }): React.JSX.Element {
  const o = entry.outcome;
  return (
    <li className="flex items-center justify-between gap-3 border-t border-[#22262e] py-2 font-mono text-[11px] first:border-t-0">
      <span className="text-[#d1d5db]">{entry.label}</span>
      {o.kind === "receipt" ? (
        <a
          href={o.receipt.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#93c5fd] tabular-nums hover:underline"
        >
          {o.receipt.cluster === "magicblock-er" ? "ER" : "Devnet"} {shortHash(o.receipt.signature, 5, 5)}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      ) : o.kind === "unfunded" ? (
        <span className="text-[#fbbf24]">relayer unfunded · paper</span>
      ) : o.kind === "paper" ? (
        <span className="text-[#6b7280]">paper · not broadcast</span>
      ) : o.kind === "info" ? (
        <span className="text-[#6b7280]">{o.message}</span>
      ) : (
        <span className="text-[#f87171]">{o.message}</span>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------------ */

export function BorelTable(): React.JSX.Element {
  const { pricesE9, status, publishTimeMs } = usePythPrices(BOREL_MARKETS);
  const { connectedWallet } = useBorelIdentity();
  const youLabel = connectedWallet ? shortHash(connectedWallet, 4, 4) : "You";

  const [mode, setMode] = React.useState<RoomMode>("BLITZ_3M");
  const [stake, setStake] = React.useState<StakeMode>("PAPER");
  const [phase, setPhase] = React.useState<TablePhase>("DRAFT");
  const [howToOpen, setHowToOpen] = React.useState<boolean>(false);
  // First visit shows the rules; read storage after mount so server and client markup match.
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(HOW_TO_SEEN_KEY) === null) setHowToOpen(true);
    } catch {
      setHowToOpen(true);
    }
  }, []);
  const closeHowTo = React.useCallback(() => {
    setHowToOpen(false);
    try {
      window.localStorage.setItem(HOW_TO_SEEN_KEY, "1");
    } catch {
      // Storage unavailable (private mode): the button still reopens the rules.
    }
  }, []);
  const [roomSerial, setRoomSerial] = React.useState<number>(1);
  const [draft, setDraft] = React.useState<readonly DraftLeg[]>(DEFAULT_DRAFT);
  const [sealing, setSealing] = React.useState<boolean>(false);
  const [seats, setSeats] = React.useState<readonly Seat[]>([]);
  const [commitment, setCommitment] = React.useState<string>("");
  const [endsAtMs, setEndsAtMs] = React.useState<number>(0);
  /** DEVNET only: server lock time (epoch ms); 0 while the room clock is local (PAPER). */
  const [lockAtMs, setLockAtMs] = React.useState<number>(0);
  const [nowMs, setNowMs] = React.useState<number>(0);
  const [pivotLeg, setPivotLeg] = React.useState<LegIndex>(0);
  const [receipts, setReceipts] = React.useState<readonly ReceiptEntry[]>([]);
  const [rankAtSeal, setRankAtSeal] = React.useState<Readonly<Record<string, number>>>({});
  const [finalPrices, setFinalPrices] = React.useState<PriceBookE9 | null>(null);
  const [vrfSeed, setVrfSeed] = React.useState<string>("");
  const [seedSource, setSeedSource] = React.useState<string | null>(null);
  const [roomId, setRoomId] = React.useState<string | null>(null);

  // First observed price per market: the deterministic baseline for momentum pacers.
  const baselineRef = React.useRef<Partial<Record<BorelMarket, bigint>>>({});
  React.useEffect(() => {
    for (const m of BOREL_MARKETS) {
      const p = pricesE9[m];
      if (p !== undefined && baselineRef.current[m] === undefined) baselineRef.current[m] = p;
    }
  }, [pricesE9]);

  // Room clock (only ticks while sealed).
  React.useEffect(() => {
    if (phase !== "SEALED") return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const durationMs = ROOM_DURATION_MS[mode];
  const remainingMs = phase === "SEALED" ? Math.max(0, endsAtMs - nowMs) : phase === "DRAFT" ? durationMs : 0;
  const livePrices: PriceBookE9 = finalPrices ?? pricesE9;

  const you = seats.find((s) => s.isYou);
  const ranked = React.useMemo(() => {
    const rows = seats.map((s) => ({
      id: s.id,
      seat: s,
      scoreE9: handScoreE9(s.hand, livePrices, s.pivot),
    }));
    return rankByScore(rows, vrfSeed);
  }, [seats, livePrices, vrfSeed]);
  const youRow = ranked.find((r) => r.seat.isYou);

  // Per-seat score history (1e9 fixed-point) drives the ladder sparklines while the room is live.
  const [history, setHistory] = React.useState<Readonly<Record<string, readonly bigint[]>>>({});
  React.useEffect(() => {
    if (phase !== "SEALED") return;
    setHistory((prev) => {
      const next: Record<string, readonly bigint[]> = {};
      for (const r of ranked) {
        const series = prev[r.id] ?? [];
        next[r.id] = series.length > 0 && series[series.length - 1] === r.scoreE9 ? series : [...series, r.scoreE9].slice(-120);
      }
      return next;
    });
  }, [ranked, phase]);

  const pushReceipt = React.useCallback((label: string, outcome: ChainOutcome) => {
    setReceipts((prev) => [...prev, { label, outcome }]);
  }, []);

  const runShowdown = React.useCallback(() => {
    setFinalPrices({ ...pricesE9 });
    setPhase("SHOWDOWN");
    if (stake === "DEVNET") {
      void (async () => {
        let o = await chainSettle(roomId);
        // Absorb small client/server clock skew: the relayer only settles once the room reaches 00:00.
        for (let attempt = 0; attempt < 3 && o.kind === "error" && o.message.includes("00:00"); attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          o = await chainSettle(roomId);
        }
        pushReceipt("Settle room", o);
        const seed = await chainTieBreakSeed(roomId);
        if (seed) {
          setVrfSeed(seed.seed);
          setSeedSource(seed.source);
        }
      })();
    }
  }, [pricesE9, stake, roomId, pushReceipt]);

  const serverClock = stake === "DEVNET" && lockAtMs > 0;
  React.useEffect(() => {
    const graceMs = serverClock ? 1_500 : 0;
    if (phase === "SEALED" && endsAtMs > 0 && nowMs >= endsAtMs + graceMs) runShowdown();
  }, [phase, endsAtMs, nowMs, runShowdown, serverClock]);

  const validation = validateHand(draft);
  const takenMarkets = React.useMemo(() => new Set(draft.map((l) => l.market)), [draft]);
  const missingPrice = draft.find((l) => pricesE9[l.market] === undefined);
  const closedLeg = draft.find((l) => status[l.market] === "closed");

  const updateLeg = (index: LegIndex, next: DraftLeg): void => {
    setDraft((prev) => prev.map((l, i) => (i === index ? next : l)));
  };

  const assignConviction = (index: LegIndex, conviction: Conviction): void => {
    setDraft((prev) => {
      const current = prev[index]?.conviction ?? conviction;
      return prev.map((l, i) => {
        if (i === index) return { ...l, conviction };
        if (l.conviction === conviction) return { ...l, conviction: current };
        return l;
      });
    });
  };

  const handleSeal = async (): Promise<void> => {
    if (!validation.ok || missingPrice || sealing) return;
    setSealing(true);
    try {
      const sealPrices: PriceBookE9 = { ...pricesE9 };
      const lockedYou: LockedHand = [
        { ...draft[0]!, entryPriceE9: sealPrices[draft[0]!.market] ?? 0n },
        { ...draft[1]!, entryPriceE9: sealPrices[draft[1]!.market] ?? 0n },
        { ...draft[2]!, entryPriceE9: sealPrices[draft[2]!.market] ?? 0n },
      ];
      const salt = randomSaltHex();
      const digest = await handCommitment(
        [draft[0]!, draft[1]!, draft[2]!],
        salt,
      );
      const nextSeats: Seat[] = [
        { id: "you", label: "You", strategy: "Your sealed hand", isYou: true, hand: lockedYou },
        ...PACER_PROFILES.map((p) => ({
          id: p.id,
          label: p.label,
          strategy: p.strategy,
          isYou: false,
          hand: buildPacerHand(p, baselineRef.current, sealPrices),
        })),
      ];
      const startRanks = rankByScore(
        nextSeats.map((s) => ({ id: s.id, scoreE9: 0n })),
        "",
      );
      setRankAtSeal(Object.fromEntries(startRanks.map((r) => [r.id, r.rank])));
      setSeats(nextSeats);
      setHistory({});
      setCommitment(digest);
      setReceipts([]);
      setFinalPrices(null);
      setVrfSeed("");
      setSeedSource(null);
      const start = Date.now();
      setNowMs(start);
      setEndsAtMs(start + durationMs);
      setLockAtMs(0);
      setPhase("SEALED");

      if (stake === "DEVNET") {
        const joined = await chainJoin(mode);
        pushReceipt("Join room", joined.outcome);
        if (joined.roomId) setRoomId(joined.roomId);
        if (joined.vrfSeed) setVrfSeed(joined.vrfSeed);
        if (joined.clock) {
          // DEVNET rooms run on the server schedule: seal before lockAt, pivot until endsAt, settle after.
          setEndsAtMs(joined.clock.endsAt);
          setLockAtMs(joined.clock.lockAt);
        }
        if (joined.clock && Date.now() >= joined.clock.lockAt) {
          pushReceipt("Lock hand", { kind: "error", message: "Lock window closed for this room" });
        } else {
          pushReceipt("Lock hand", await chainLock(joined.roomId, lockedYou, digest, salt));
        }
      } else {
        pushReceipt("Lock hand", { kind: "paper" });
      }
    } finally {
      setSealing(false);
    }
  };

  const pivotLocked = serverClock && (nowMs < lockAtMs || nowMs >= endsAtMs);

  const handlePivot = (kind: PivotKind): void => {
    if (!you || you.pivot || phase !== "SEALED") return;
    if (serverClock && (Date.now() < lockAtMs || Date.now() >= endsAtMs)) return;
    const leg = you.hand[pivotLeg];
    const price = pricesE9[leg.market];
    if (price === undefined) return;
    const action: PivotAction = { legIndex: pivotLeg, kind, priceE9: price, atMs: Date.now() };
    setSeats((prev) => prev.map((s) => (s.isYou ? { ...s, pivot: action } : s)));
    if (stake === "DEVNET") {
      void chainPivot(roomId, pivotLeg, kind).then((o) => pushReceipt(`Pivot · ${kind}`, o));
    } else {
      pushReceipt(`Pivot · ${kind}`, { kind: "paper" });
    }
  };

  const handleNextRoom = (): void => {
    setPhase("DRAFT");
    setSeats([]);
    setCommitment("");
    setFinalPrices(null);
    setReceipts([]);
    setRoomId(null);
    setLockAtMs(0);
    setRoomSerial((n) => n + 1);
  };

  const roomCode = roomId ? shortHash(roomId, 4, 4) : `BRL-${roomSerial.toString().padStart(3, "0")}`;
  const liveFeeds = BOREL_MARKETS.filter((m) => status[m] === "live").length;
  const latestPublish = Math.max(0, ...BOREL_MARKETS.map((m) => publishTimeMs[m] ?? 0));
  const unfunded = receipts.some((r) => r.outcome.kind === "unfunded");
  const revealedAll = phase === "SHOWDOWN";

  // Seats keep a stable left-to-right order so the voxel lattice never reshuffles on rank changes.
  const matrixSeats: MatrixSeat[] = React.useMemo(
    () =>
      seats
        .map((seat) => ranked.find((r) => r.id === seat.id))
        .filter((row): row is (typeof ranked)[number] => row !== undefined)
        .map((row) => ({
        id: row.id,
        label: row.seat.isYou ? youLabel : row.seat.label.replace("Pacer · ", ""),
        sublabel: `#${row.rank} ${formatScorePctPrecise(row.scoreE9)}`,
        isYou: row.seat.isYou,
        revealed: row.seat.isYou || revealedAll,
        seed: `${row.id}:${commitment}`,
        legs: row.seat.hand.map((leg, i) => {
          const now = livePrices[leg.market];
          const s =
            now === undefined
              ? 0n
              : legScoreE9(leg, now, row.seat.pivot?.legIndex === i ? row.seat.pivot : undefined);
          return {
            direction: leg.direction,
            conviction: leg.conviction,
            winning: s === 0n ? null : s > 0n,
          };
        }),
      })),
    [seats, ranked, revealedAll, commitment, livePrices, youLabel],
  );

  const receiptLegs: ReceiptLeg[] = you
    ? you.hand.map((leg, i) => {
        const now = livePrices[leg.market];
        const pivot = you.pivot?.legIndex === i ? you.pivot : undefined;
        const s = now === undefined ? 0n : legScoreE9(leg, now, pivot);
        return {
          conviction: leg.conviction,
          outcome: pivot?.kind === "SHIELD" ? "FLAT" : outcomeOf(s),
          pivot: pivot?.kind,
        };
      })
    : [];
  const settleReceipt = [...receipts].reverse().find((r) => r.outcome.kind === "receipt");

  /* ---------------------------------------------------------------- */

  const progressPct =
    phase === "SEALED" ? Math.min(100, Math.max(0, ((durationMs - remainingMs) / durationMs) * 100)) : phase === "SHOWDOWN" ? 100 : 0;
  const finalStretch = phase === "SEALED" && remainingMs <= 15_000;

  const header = (
    <section className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0d14] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[26px] font-bold leading-[0.98] tracking-[-0.035em] text-[#f3f4f6]">Borel</h1>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em]",
                phase === "DRAFT"
                  ? "border-white/15 text-[#9ca3af]"
                  : phase === "SEALED"
                    ? "border-[#f59e0b]/40 text-[#fbbf24]"
                    : "border-[#3b82f6]/50 text-[#93c5fd]",
              )}
            >
              {phase === "DRAFT" ? "Drafting" : phase === "SEALED" ? "Sealed · live" : "Showdown"}
            </span>
          </div>
          <p className="mt-1.5 truncate font-mono text-[11px] text-[#6b7280] tabular-nums">
            Room <span id="borel-room-code" className="text-[#d1d5db]">{roomCode}</span> · {MODE_LABEL[mode]} ·{" "}
            {ranked.length || PACER_PROFILES.length + 1} seats · {stake === "PAPER" ? "Paper" : "Devnet"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b7280]">
            {phase === "DRAFT" ? "Round" : phase === "SEALED" ? "Bell in" : "Final"}
          </div>
          <div
            id="borel-clock"
            role="timer"
            aria-live="off"
            className={cn(
              "font-mono text-[34px] font-semibold leading-none tabular-nums [font-variant-numeric:tabular-nums_slashed-zero] sm:text-[40px]",
              finalStretch ? "text-[#fbbf24]" : "text-[#f3f4f6]",
            )}
          >
            {formatClock(remainingMs)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
        <div className={cn("min-w-0 flex-wrap items-center gap-2", phase === "DRAFT" ? "flex" : "hidden sm:flex")}>
        <Segmented
          idPrefix="borel-mode"
          options={["BLITZ_3M", "MACRO_15M"] as const}
          labels={MODE_LABEL}
          value={mode}
          onChange={setMode}
          disabled={phase !== "DRAFT"}
        />
        <Segmented
          idPrefix="borel-stake"
          options={["PAPER", "DEVNET"] as const}
          labels={{ PAPER: "Paper", DEVNET: "Devnet" }}
          value={stake}
          onChange={setStake}
          disabled={phase !== "DRAFT"}
        />
        </div>
        {phase === "DRAFT" ? null : (
          <span className="font-mono text-[11px] text-[#6b7280] sm:hidden">Settings locked until next room</span>
        )}
        <button
          id="borel-howto-open"
          type="button"
          onClick={() => setHowToOpen(true)}
          aria-label="How to play"
          className="ml-auto h-9 shrink-0 cursor-pointer rounded-lg border border-white/10 px-3 text-xs font-medium text-[#d1d5db] transition-colors hover:border-[#3b82f6] hover:text-[#f3f4f6]"
        >
          <span className="sm:hidden">Rules</span>
          <span className="hidden sm:inline">How to play</span>
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.04]" aria-hidden="true">
        <motion.div
          className={cn("h-full", finalStretch ? "bg-[#f59e0b]" : phase === "SHOWDOWN" ? "bg-[#3b82f6]" : "bg-[#34d399]")}
          initial={false}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.3, ease: "linear" }}
        />
      </div>
    </section>
  );

  const statebar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-white/[0.06] bg-[#0b0c0e] px-3 py-2 font-mono text-[11px] text-[#9ca3af] tabular-nums">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", liveFeeds > 0 ? "bg-[#10b981]" : "bg-[#6b7280]")} />
        Pyth {liveFeeds}/{BOREL_MARKETS.length} live
      </span>
      <span className="hidden sm:inline">
        {latestPublish > 0
          ? `last publish ${new Date(latestPublish).toISOString().slice(11, 19)} UTC`
          : "awaiting first publish"}
      </span>
      <a
        id="borel-devnet-badge"
        href={ER_ROOM_SOLSCAN}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline"
      >
        Devnet · ER room program
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
      <span id="borel-tiebreak-seed" className="hidden md:inline">
        Tie-break seed{" "}
        {vrfSeed
          ? `${shortHash(vrfSeed, 6, 4)}${seedSource ? ` · ${seedSource}` : ""}`
          : stake === "DEVNET"
            ? "published at settle"
            : "seat-id hash (paper)"}
      </span>
      {unfunded ? (
        <span id="borel-unfunded-banner" className="text-[#fbbf24]">
          Devnet relayer unfunded — playing on paper
        </span>
      ) : null}
    </div>
  );

  const ladderRows: LadderRow[] = ranked.map((row) => ({
    id: row.id,
    rank: row.rank,
    scoreE9: row.scoreE9,
    label: row.seat.isYou ? youLabel : row.seat.label,
    strategy: row.seat.strategy,
    isYou: row.seat.isYou,
    hand: row.seat.hand,
    pivot: row.seat.pivot,
  }));

  const lobby = (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0d14] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#f3f4f6]">At the table</h2>
        <span className="font-mono text-[11px] text-[#6b7280] tabular-nums">{PACER_PROFILES.length + 1} seats</span>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        <li className="flex items-center gap-3 bg-[#0f1726] px-4 py-2.5">
          <SeatAvatar id="you" label="You" size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[13px] font-semibold text-[#f3f4f6] tabular-nums">{youLabel}</div>
            <div className="text-[11px] text-[#6b7280]">Drafting your hand</div>
          </div>
          <span className="font-mono text-[10px] text-[#93c5fd]">YOU</span>
        </li>
        {PACER_PROFILES.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <SeatAvatar id={p.id} label={p.label} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-[#d1d5db]">{seatName(p.label)}</div>
              <div className="truncate text-[11px] text-[#6b7280]">{p.strategy}</div>
            </div>
            <span className="font-mono text-[10px] text-[#6b7280]">PACER</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-white/[0.05] px-4 py-2.5 text-[11px] leading-relaxed text-[#6b7280]">
        Pacers are deterministic bots that lock their hands from the same live prices at your seal.
      </p>
    </section>
  );

  const matrix =
    phase === "DRAFT" ? null : (
      <section className="relative h-[220px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0d14] sm:h-[260px]">
        <EnclaveStateMatrix seats={matrixSeats} />
        <span className="pointer-events-none absolute left-3 top-2.5 font-mono text-[11px] text-[#9ca3af]">
          Enclave seat state ·{" "}
          <span className={revealedAll ? "text-[#93c5fd]" : "text-[#fbbf24]"}>
            {revealedAll ? "unsealed" : "rival hands sealed"}
          </span>
        </span>
      </section>
    );

  const legCards = (
    <div className={cn("grid gap-2 sm:gap-3", phase === "DRAFT" ? "grid-cols-1 xl:grid-cols-3" : "grid-cols-3")}>
      {([0, 1, 2] as const).map((i) => {
        const sealedLeg = you?.hand[i];
        const legPivot = you?.pivot?.legIndex === i ? you.pivot : undefined;
        const legScore =
          sealedLeg && livePrices[sealedLeg.market] !== undefined
            ? legScoreE9(sealedLeg, livePrices[sealedLeg.market]!, legPivot)
            : 0n;
        if (phase !== "DRAFT" && sealedLeg) {
          return (
            <div key={`${phase}-${i}`} id={`borel-leg-${i}`} className="h-[132px] sm:h-[176px]" data-sealed={phase === "SEALED" ? "true" : "false"}>
              <LiveLegCard
                index={i}
                leg={sealedLeg}
                scoreE9={legScore}
                nowPriceE9={livePrices[sealedLeg.market]}
                pivot={legPivot}
                revealed={phase === "SHOWDOWN"}
              />
            </div>
          );
        }
        return (
          <div
            key={`draft-${i}`}
            id={`borel-leg-${i}`}
            data-sealed="false"
            className="rounded-xl border border-white/[0.08] bg-[#0a0d14] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            <DraftCard
              index={i}
              leg={draft[i]!}
              takenMarkets={takenMarkets}
              pricesE9={pricesE9}
              status={status}
              onChange={(next) => updateLeg(i, next)}
              onAssignConviction={(c) => assignConviction(i, c)}
            />
          </div>
        );
      })}
    </div>
  );

  const handCards = (
    <section aria-label="Your hand" className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#f3f4f6]">
          {phase === "DRAFT" ? "Draft your hand" : phase === "SEALED" ? "Your sealed hand" : "Your hand · face-up"}
        </h2>
        <span className="truncate font-mono text-[11px] text-[#6b7280] tabular-nums">
          {phase === "DRAFT"
            ? "3 markets · long or short · 1x 2x 3x"
            : youRow
              ? `Total ${formatScorePctPrecise(youRow.scoreE9)} · #${youRow.rank}`
              : ""}
        </span>
      </div>
      {phase === "DRAFT" ? (
        <p id="borel-feed-notes" className="min-h-4 font-mono text-[11px] text-[#6b7280]">
          {BOREL_MARKETS.map((m) => unavailableReason(m, status[m]))
            .filter((r): r is string => r !== null)
            .join(" · ") || "All five Pyth feeds live"}
        </p>
      ) : null}
      {legCards}
    </section>
  );

  const commitmentStrip =
    phase === "DRAFT" ? null : (
      <div
        id="borel-commitment"
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] bg-[#0b0c0e] px-3 py-2 font-mono text-[11px] text-[#9ca3af]"
      >
        <span>
          Commitment <span className="text-[#d1d5db] tabular-nums">{shortHash(commitment, 10, 10)}</span>
        </span>
        <span>sha256(hand ‖ salt) · revealed at 00:00</span>
      </div>
    );

  const draftMessage = !validation.ok
    ? validation.reason
    : missingPrice
      ? `Waiting for a live ${missingPrice.market} price`
      : closedLeg
        ? `${closedLeg.market} market is closed; it will score flat until it reopens`
        : "Hand is valid. Sealing publishes only its sha256 commitment.";

  const primaryBtn =
    "cf-btn inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-6 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_24px_-12px_rgba(37,99,235,0.8)] hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50";

  const actionBar = (
    <div className="fixed inset-x-0 bottom-7 z-40 border-t border-white/[0.08] bg-[rgba(10,13,20,0.94)] px-4 pb-3 pt-3 shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl lg:static lg:z-auto lg:rounded-xl lg:border lg:bg-[#0a0d14] lg:p-4 lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] lg:backdrop-blur-none">
      {phase === "DRAFT" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="font-mono text-[11px] leading-snug text-[#9ca3af]" aria-live="polite">
            {draftMessage}
          </p>
          <button
            id="borel-seal-btn"
            type="button"
            onClick={() => void handleSeal()}
            disabled={!validation.ok || Boolean(missingPrice) || sealing}
            className={cn(primaryBtn, "w-full shrink-0 sm:w-auto")}
          >
            <Lock className="h-4 w-4" />
            {sealing ? "Sealing…" : "Seal hand"}
          </button>
        </div>
      ) : phase === "SEALED" && you ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-[#f3f4f6]">
              Pivot <span className="font-normal text-[#6b7280]">· {you.pivot ? "spent" : "one use"}</span>
            </span>
            {stake === "PAPER" ? (
              <button
                id="borel-force-showdown-btn"
                type="button"
                onClick={runShowdown}
                className="cf-btn h-8 cursor-pointer rounded-md px-1 font-mono text-[11px] text-[#9ca3af] underline decoration-white/20 underline-offset-4 hover:text-[#f3f4f6]"
              >
                Ring the bell now
              </button>
            ) : null}
          </div>
          {you.pivot ? (
            <p id="borel-pivot-spent" className="font-mono text-xs text-[#9ca3af] tabular-nums">
              {you.pivot.kind === "FLIP" ? "Flipped" : "Shielded"} leg {you.pivot.legIndex + 1} (
              {you.hand[you.pivot.legIndex].market}) at {formatPriceE9(you.pivot.priceE9)}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Pivot leg">
                {([0, 1, 2] as const).map((i) => (
                  <button
                    key={i}
                    id={`borel-pivot-leg-${i}`}
                    type="button"
                    aria-pressed={pivotLeg === i}
                    onClick={() => setPivotLeg(i)}
                    className={cn(
                      "cf-btn flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border font-mono text-[12px] tabular-nums",
                      pivotLeg === i
                        ? "border-[#3b82f6] bg-[#2563eb]/15 text-[#f3f4f6]"
                        : "border-white/[0.08] bg-[#0d1017] text-[#9ca3af] hover:border-white/20",
                    )}
                  >
                    <MarketMark market={you.hand[i].market} size={16} />
                    {MARKET_SHORT[you.hand[i].market]} {you.hand[i].conviction}x
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  id="borel-pivot-flip-btn"
                  type="button"
                  onClick={() => handlePivot("FLIP")}
                  disabled={pivotLocked}
                  className="cf-btn inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#171a20] text-[13px] font-semibold text-[#f3f4f6] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-[#1d2129] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Repeat2 className="h-4 w-4" />
                  Flip
                </button>
                <button
                  id="borel-pivot-shield-btn"
                  type="button"
                  onClick={() => handlePivot("SHIELD")}
                  disabled={pivotLocked}
                  className="cf-btn inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#171a20] text-[13px] font-semibold text-[#f3f4f6] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-[#1d2129] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Shield className="h-4 w-4" />
                  Shield
                </button>
              </div>
              <p className="mt-2 hidden text-[11px] leading-relaxed text-[#6b7280] lg:block">
                {serverClock && nowMs < lockAtMs
                  ? `Devnet room starts in ${Math.ceil((lockAtMs - nowMs) / 1000)}s — pivots open at the lock.`
                  : "Flip banks the move so far and reverses the leg. Shield banks it and parks the leg in cash."}
              </p>
            </>
          )}
        </div>
      ) : phase === "SHOWDOWN" && youRow ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 font-mono tabular-nums">
            <div className="text-[11px] text-[#6b7280]">Final</div>
            <div className="text-[15px] font-semibold text-[#f3f4f6]">
              #{youRow.rank} of {ranked.length}{" "}
              <span className={scoreTone(youRow.scoreE9)}>{formatScorePctPrecise(youRow.scoreE9)}</span>
            </div>
          </div>
          <button id="borel-next-room-btn" type="button" onClick={handleNextRoom} className={primaryBtn}>
            Next room
          </button>
        </div>
      ) : null}
    </div>
  );

  const receiptsPanel =
    receipts.length > 0 ? (
      <section className="rounded-xl border border-white/[0.08] bg-[#0a0d14] px-4 py-3">
        <h2 className="mb-1 text-sm font-semibold text-[#f3f4f6]">Lock receipts</h2>
        <ul id="borel-lock-receipts">
          {receipts.map((r, i) => (
            <ReceiptLine key={`${r.label}-${i}`} entry={r} />
          ))}
        </ul>
      </section>
    ) : null;

  const won = youRow ? youRow.rank <= 3 : false;
  const showdown =
    phase === "SHOWDOWN" && youRow ? (
      <motion.section
        id="borel-showdown"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className={cn(
          "relative overflow-hidden rounded-xl border bg-[#0a0d14] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
          won ? "border-[#f59e0b]/40" : "border-[#3b82f6]/35",
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#9ca3af]">Showdown · 00:00</div>
            <div className="mt-2 flex items-baseline gap-3">
              <span
                className={cn(
                  "font-mono text-[56px] font-semibold leading-[0.9] tracking-[-0.04em] tabular-nums",
                  youRow.rank === 1 ? "text-[#fbbf24]" : "text-[#f3f4f6]",
                )}
              >
                #{youRow.rank}
              </span>
              <span className="text-sm text-[#9ca3af]">of {ranked.length} seats</span>
            </div>
            <p className="mt-2 text-[13px] text-[#d1d5db]">
              {youRow.rank === 1
                ? "You took the table. Every hand is face-up and final prices are frozen at the bell."
                : won
                  ? "Podium finish. Every hand is face-up and final prices are frozen at the bell."
                  : "Every hand is face-up. Final prices are frozen at the bell."}
            </p>
          </div>
          <div className="sm:text-right">
            <div className="font-mono text-[11px] text-[#6b7280]">Hand score</div>
            <div className={cn("font-mono text-[28px] font-semibold leading-none tabular-nums", scoreTone(youRow.scoreE9))}>
              {formatScorePctPrecise(youRow.scoreE9)}
            </div>
            <Sparkline points={history.you ?? []} width={140} height={32} className="mt-2 sm:ml-auto" />
          </div>
        </div>
      </motion.section>
    ) : null;

  const receiptBlock =
    phase === "SHOWDOWN" && youRow ? (
      <HandReceipt
        roomCode={roomCode}
        modeLabel={MODE_LABEL[mode]}
        stakeLabel={stake === "PAPER" ? "Paper" : "Devnet"}
        rank={youRow.rank}
        totalSeats={ranked.length}
        scoreE9={youRow.scoreE9}
        legs={receiptLegs}
        commitment={commitment}
        playerLabel={connectedWallet ? youLabel : undefined}
        explorerUrl={settleReceipt?.outcome.kind === "receipt" ? settleReceipt.outcome.receipt.explorerUrl : undefined}
        signature={settleReceipt?.outcome.kind === "receipt" ? settleReceipt.outcome.receipt.signature : undefined}
      />
    ) : null;

  // Live: hand + pivot first on phones; showdown: the unsealed ladder is the payoff, so it leads.
  const ladderColumn = (
    <div className="space-y-3 lg:col-span-7 lg:col-start-1 lg:row-start-1">
      <LiveLadder
        rows={ladderRows}
        history={history}
        rankAtSeal={rankAtSeal}
        revealed={revealedAll}
        phaseNote={revealedAll ? "Final · all hands face-up" : "Hands sealed until 00:00"}
      />
      {matrix}
    </div>
  );

  return (
    <div className={cn("space-y-3", phase === "SEALED" ? "pb-44 lg:pb-0" : "pb-28 lg:pb-0")}>
      <HowToPlay open={howToOpen} onClose={closeHowTo} />
      {header}
      <PhaseGuide phase={phase} />
      {statebar}
      {phase === "DRAFT" ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-8">
            {handCards}
            {actionBar}
          </div>
          <div className="lg:col-span-4">{lobby}</div>
        </div>
      ) : (
        <>
          {showdown}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            {phase === "SHOWDOWN" ? ladderColumn : null}
            <div className="space-y-3 lg:col-span-5 lg:col-start-8 lg:row-start-1">
              {handCards}
              {actionBar}
              {commitmentStrip}
              {receiptBlock}
              {receiptsPanel}
            </div>
            {phase === "SHOWDOWN" ? null : ladderColumn}
          </div>
        </>
      )}
    </div>
  );
}
