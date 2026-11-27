"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ExternalLink, Lock, Shield, Repeat2 } from "lucide-react";
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
const LADDER_ROW_PX = 56;
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
    <div className="inline-flex rounded-md border border-[#22262e] bg-[#0b0c0e] p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          id={`${idPrefix}-${opt.toLowerCase()}`}
          type="button"
          disabled={disabled}
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
          className={cn(
            "cf-btn h-7 cursor-pointer rounded px-2.5 font-mono text-[11px] font-medium disabled:cursor-not-allowed",
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
    <div className="flex h-full flex-col justify-between gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#9ca3af]">Leg {index + 1}</span>
        <div className="flex gap-1" role="group" aria-label={`Leg ${index + 1} conviction card`}>
          {([1, 2, 3] as const).map((c) => (
            <button
              key={c}
              id={`borel-leg-${index}-card-${c}`}
              type="button"
              aria-pressed={leg.conviction === c}
              onClick={() => onAssignConviction(c)}
              className={cn(
                "cf-btn h-7 w-9 cursor-pointer rounded border font-mono text-[11px] font-semibold tabular-nums",
                leg.conviction === c
                  ? c === 3
                    ? "border-[#f59e0b] bg-[#f59e0b]/15 text-[#fbbf24]"
                    : "border-[#3b82f6] bg-[#2563eb]/20 text-[#f3f4f6]"
                  : "border-[#22262e] text-[#6b7280] hover:text-[#d1d5db]",
              )}
            >
              {c}x
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="grid grid-cols-5 gap-1">
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
                  "cf-btn flex h-8 cursor-pointer items-center justify-center gap-1 rounded border font-mono text-[10px] leading-none disabled:cursor-not-allowed disabled:opacity-30",
                  leg.market === m
                    ? "border-[#3b82f6] bg-[#2563eb]/15 text-[#f3f4f6]"
                    : "border-[#22262e] text-[#9ca3af] hover:border-[#303642]",
                  feed === "stale" && leg.market !== m ? "opacity-60" : "",
                )}
              >
                <MarketMark market={m} size={12} />
                <span>{MARKET_SHORT[m]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <MarketMark market={leg.market} size={16} />
            <span className="font-mono text-sm font-semibold text-[#f3f4f6]">{leg.market}</span>
            <FeedBadge market={leg.market} status={status[leg.market]} />
          </div>
          <div className="mt-0.5 font-mono text-xs text-[#9ca3af] tabular-nums">
            {formatPriceE9(pricesE9[leg.market])}
          </div>
        </div>
        <div className="inline-flex rounded-md border border-[#22262e] p-0.5">
          {(["LONG", "SHORT"] as const).map((d) => (
            <button
              key={d}
              id={`borel-leg-${index}-${d.toLowerCase()}`}
              type="button"
              aria-pressed={leg.direction === d}
              onClick={() => onChange({ ...leg, direction: d })}
              className={cn(
                "cf-btn h-7 cursor-pointer rounded px-2 font-mono text-[11px] font-semibold",
                leg.direction === d
                  ? d === "LONG"
                    ? "bg-[#10b981]/15 text-[#34d399]"
                    : "bg-[#ef4444]/15 text-[#f87171]"
                  : "text-[#6b7280] hover:text-[#d1d5db]",
              )}
            >
              {d === "LONG" ? "▲ Long" : "▼ Short"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SealedFace({
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
  return (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            revealed ? "text-[#93c5fd]" : "text-[#fbbf24]",
          )}
        >
          {revealed ? null : <Lock className="h-3 w-3" />}
          Leg {index + 1}
        </span>
        <span
          className={cn(
            "rounded border px-1.5 font-mono text-[11px] font-semibold tabular-nums",
            leg.conviction === 3
              ? "border-[#f59e0b]/60 text-[#fbbf24]"
              : "border-[#303642] text-[#d1d5db]",
          )}
          title={leg.conviction === 3 ? "Sniper card" : undefined}
        >
          {leg.conviction}x
        </span>
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            "truncate font-mono text-sm font-semibold",
            leg.direction === "LONG" ? "text-[#34d399]" : "text-[#f87171]",
          )}
        >
          {leg.direction === "LONG" ? "▲" : "▼"}{" "}
          <span className="inline-flex items-center gap-1.5 align-middle text-[#f3f4f6]">
            <MarketMark market={leg.market} size={14} />
            {leg.market}
          </span>
        </div>
        <div className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", scoreTone(scoreE9))}>
          {formatScorePctPrecise(scoreE9)}
        </div>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-[11px] tabular-nums">
          <span className="text-[#6b7280]">in</span>
          <span className="truncate text-[#9ca3af]">{formatPriceE9(leg.entryPriceE9)}</span>
          <span className="text-[#6b7280]">{revealed ? "out" : "now"}</span>
          <span className="truncate text-[#d1d5db]">{formatPriceE9(nowPriceE9)}</span>
        </div>
      </div>
      <div className="truncate font-mono text-[10px] text-[#6b7280]">
        {pivot
          ? pivot.kind === "FLIP"
            ? "Flipped mid-round"
            : "Shielded mid-round"
          : revealed
            ? "Face-up at showdown"
            : "Only you see this"}
      </div>
    </div>
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

  const [mode, setMode] = React.useState<RoomMode>("BLITZ_3M");
  const [stake, setStake] = React.useState<StakeMode>("PAPER");
  const [phase, setPhase] = React.useState<TablePhase>("DRAFT");
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
        label: row.seat.isYou ? "You" : row.seat.label.replace("Pacer · ", ""),
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
    [seats, ranked, revealedAll, commitment, livePrices],
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

  const header = (
    <section className="flex flex-col gap-3 rounded-lg border border-[#22262e] bg-[#0a0d14] p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-[-0.018em] text-[#f3f4f6]">Borel</h1>
          <span className="text-sm text-[#9ca3af]">Sealed-conviction live market showdown</span>
        </div>
        <p className="mt-1 font-mono text-[11px] text-[#6b7280] tabular-nums">
          Room <span id="borel-room-code" className="text-[#d1d5db]">{roomCode}</span> ·{" "}
          {MODE_LABEL[mode]} · {ranked.length || PACER_PROFILES.length + 1} seats ·{" "}
          {stake === "PAPER" ? "Paper room" : "Devnet room"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
        <div
          id="borel-clock"
          role="timer"
          aria-live="off"
          className={cn(
            "w-[92px] text-right font-mono text-3xl font-semibold tabular-nums [font-variant-numeric:tabular-nums_slashed-zero]",
            phase === "SEALED" && remainingMs <= 15_000 ? "text-[#fbbf24]" : "text-[#f3f4f6]",
          )}
        >
          {formatClock(remainingMs)}
        </div>
      </div>
    </section>
  );

  const statebar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-[#22262e] bg-[#0b0c0e] px-3 py-2 font-mono text-[11px] text-[#9ca3af] tabular-nums">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", liveFeeds > 0 ? "bg-[#10b981]" : "bg-[#6b7280]")} />
        Pyth {liveFeeds}/{BOREL_MARKETS.length} live
      </span>
      <span>
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
      <span id="borel-tiebreak-seed">
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

  const ladder = (
    <section
      id="borel-ladder"
      className="rounded-lg border border-[#22262e] bg-[#0a0d14]"
      aria-label="Rank ladder"
    >
      <div className="flex items-center justify-between border-b border-[#22262e] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#f3f4f6]">Rank ladder</h2>
        <span className="font-mono text-[11px] text-[#6b7280]">
          {phase === "SHOWDOWN" ? "Final · all hands face-up" : phase === "SEALED" ? "Hands sealed until 00:00" : "Seats open"}
        </span>
      </div>
      {phase === "DRAFT" ? (
        <ul className="divide-y divide-[#22262e]">
          {PACER_PROFILES.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-xs text-[#d1d5db]">{p.label}</span>
              <span className="truncate text-right text-[11px] text-[#6b7280]">{p.strategy}</span>
            </li>
          ))}
          <li className="px-4 py-2.5 text-[11px] text-[#6b7280]">
            Pacers are deterministic bots that lock their hands from the same live prices at your seal.
          </li>
        </ul>
      ) : (
        <ol className="relative" style={{ height: ranked.length * LADDER_ROW_PX }}>
          {ranked.map((row) => {
            const start = rankAtSeal[row.id] ?? row.rank;
            const moved = start - row.rank;
            const faceUp = row.seat.isYou || revealedAll;
            return (
              <li
                key={row.id}
                id={row.seat.isYou ? "borel-ladder-you" : undefined}
                className={cn(
                  "absolute inset-x-0 top-0 flex items-center gap-2 border-b border-[#22262e] px-3 transition-transform sm:gap-3 sm:px-4 duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                  row.seat.isYou ? "bg-[#111723]" : "",
                )}
                style={{ height: LADDER_ROW_PX, transform: `translateY(${(row.rank - 1) * LADDER_ROW_PX}px)` }}
              >
                <span className="w-6 shrink-0 font-mono text-sm font-semibold text-[#f3f4f6] tabular-nums sm:w-7">
                  #{row.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-xs", row.seat.isYou ? "font-semibold text-[#f3f4f6]" : "text-[#d1d5db]")}>
                    {row.seat.isYou ? row.seat.label : row.seat.label.replace("Pacer · ", "")}
                  </div>
                  <div className="truncate text-[10px] text-[#6b7280]">
                    {row.seat.isYou
                      ? revealedAll
                        ? "Your hand"
                        : "Your sealed hand"
                      : revealedAll
                        ? `Pacer · ${row.seat.strategy}`
                        : "Pacer · hand sealed"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5 sm:gap-1" aria-label={faceUp ? "Hand face-up" : "Hand sealed"}>
                  {row.seat.hand.map((leg, i) => (
                    <span
                      key={i}
                      className={cn(
                        "flex h-8 w-8 flex-col items-center justify-center rounded border font-mono text-[9px] leading-none transition-colors duration-300 sm:w-9",
                        faceUp
                          ? leg.direction === "LONG"
                            ? "border-[#10b981]/40 text-[#34d399]"
                            : "border-[#ef4444]/40 text-[#f87171]"
                          : "border-[#f59e0b]/30 bg-[repeating-linear-gradient(135deg,#15181f_0_3px,#0f1218_3px_6px)] text-transparent",
                      )}
                    >
                      {faceUp ? (
                        <>
                          <span>{MARKET_SHORT[leg.market].replace("NVDAx", "NVDA")}</span>
                          <span className="mt-0.5 text-[#9ca3af]">
                            {leg.direction === "LONG" ? "▲" : "▼"}
                            {leg.conviction}x
                          </span>
                        </>
                      ) : (
                        "·"
                      )}
                    </span>
                  ))}
                </div>
                <div className="w-[76px] shrink-0 text-right sm:w-[92px]">
                  <div className={cn("font-mono text-xs font-semibold tabular-nums", scoreTone(row.scoreE9))}>
                    {formatScorePctPrecise(row.scoreE9)}
                  </div>
                  <div
                    className={cn(
                      "font-mono text-[10px] tabular-nums",
                      moved > 0 ? "text-[#34d399]" : moved < 0 ? "text-[#f87171]" : "text-[#6b7280]",
                    )}
                  >
                    #{start} → #{row.rank}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );

  const matrix =
    phase === "DRAFT" ? null : (
      <section className="relative h-[260px] overflow-hidden rounded-lg border border-[#22262e] bg-[#0a0d14] sm:h-[240px]">
        <EnclaveStateMatrix seats={matrixSeats} />
        <span className="pointer-events-none absolute left-3 top-2.5 font-mono text-[11px] text-[#9ca3af]">
          Seat state ·{" "}
          <span className={revealedAll ? "text-[#93c5fd]" : "text-[#fbbf24]"}>
            {revealedAll ? "unsealed" : "rival hands sealed"}
          </span>
        </span>
      </section>
    );

  const handCards = (
    <section aria-label="Your hand" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#f3f4f6]">
          {phase === "DRAFT" ? "Draft your hand" : "Your hand"}
        </h2>
        <span className="hidden font-mono text-[11px] text-[#6b7280] sm:inline">
          {phase === "DRAFT" ? "3 markets · long or short · 1x 2x 3x once each" : "Only you can see this"}
        </span>
      </div>
      {phase === "DRAFT" ? (
        <p id="borel-feed-notes" className="min-h-4 font-mono text-[11px] text-[#6b7280]">
          {BOREL_MARKETS.map((m) => unavailableReason(m, status[m]))
            .filter((r): r is string => r !== null)
            .join(" · ") || "All five Pyth feeds live"}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {([0, 1, 2] as const).map((i) => {
          const sealedLeg = you?.hand[i];
          const flipped = phase === "SEALED" && sealedLeg !== undefined;
          const legPivot = you?.pivot?.legIndex === i ? you.pivot : undefined;
          const legScore =
            sealedLeg && livePrices[sealedLeg.market] !== undefined
              ? legScoreE9(sealedLeg, livePrices[sealedLeg.market]!, legPivot)
              : 0n;
          return (
            <div
              key={i}
              id={`borel-leg-${i}`}
              className={cn(
                "[perspective:1200px]",
                phase === "DRAFT" ? "h-[212px]" : "h-[176px] md:h-[212px]",
              )}
            >
              <div
                className={cn(
                  "relative h-full w-full transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] [transform-style:preserve-3d] motion-reduce:transition-none",
                  flipped ? "[transform:rotateY(180deg)]" : "",
                )}
                data-sealed={flipped ? "true" : "false"}
              >
                <div
                  className={cn(
                    "absolute inset-0 rounded-lg border bg-[#0a0d14] [backface-visibility:hidden]",
                    phase === "SHOWDOWN" ? "border-[#3b82f6]/40" : "border-[#22262e]",
                  )}
                >
                  {phase === "SHOWDOWN" && sealedLeg ? (
                    <SealedFace
                      index={i}
                      leg={sealedLeg}
                      scoreE9={legScore}
                      nowPriceE9={livePrices[sealedLeg.market]}
                      pivot={legPivot}
                      revealed
                    />
                  ) : (
                    <DraftCard
                      index={i}
                      leg={draft[i]!}
                      takenMarkets={takenMarkets}
                      pricesE9={pricesE9}
                      status={status}
                      onChange={(next) => updateLeg(i, next)}
                      onAssignConviction={(c) => assignConviction(i, c)}
                    />
                  )}
                </div>
                <div className="absolute inset-0 rounded-lg border border-[#f59e0b]/35 bg-[#0c0f16] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  {sealedLeg ? (
                    <SealedFace
                      index={i}
                      leg={sealedLeg}
                      scoreE9={legScore}
                      nowPriceE9={livePrices[sealedLeg.market]}
                      pivot={legPivot}
                      revealed={false}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {phase === "DRAFT" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-[#9ca3af]" aria-live="polite">
            {!validation.ok
              ? validation.reason
              : missingPrice
                ? `Waiting for a live ${missingPrice.market} price`
                : closedLeg
                  ? `${closedLeg.market} market is closed; it will score flat until it reopens`
                  : "Hand is valid. Sealing publishes only its sha256 commitment."}
          </p>
          <button
            id="borel-seal-btn"
            type="button"
            onClick={() => void handleSeal()}
            disabled={!validation.ok || Boolean(missingPrice) || sealing}
            className="cf-btn inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-[#2563eb] px-5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            {sealing ? "Sealing…" : "Seal hand"}
          </button>
        </div>
      ) : (
        <div
          id="borel-commitment"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#22262e] bg-[#0b0c0e] px-3 py-2 font-mono text-[11px] text-[#9ca3af]"
        >
          <span>
            Commitment <span className="text-[#d1d5db] tabular-nums">{shortHash(commitment, 10, 10)}</span>
          </span>
          <span>sha256(hand ‖ salt) · revealed at 00:00</span>
        </div>
      )}
    </section>
  );

  const pivotControl =
    phase === "SEALED" && you ? (
      <section className="rounded-lg border border-[#22262e] bg-[#0a0d14] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#f3f4f6]">Pivot</h2>
          <span className="font-mono text-[11px] text-[#6b7280]">{you.pivot ? "Spent" : "One use"}</span>
        </div>
        {you.pivot ? (
          <p id="borel-pivot-spent" className="mt-2 font-mono text-xs text-[#9ca3af] tabular-nums">
            {you.pivot.kind === "FLIP" ? "Flipped" : "Shielded"} leg {you.pivot.legIndex + 1} (
            {you.hand[you.pivot.legIndex].market}) at {formatPriceE9(you.pivot.priceE9)}
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-1" role="group" aria-label="Pivot leg">
              {([0, 1, 2] as const).map((i) => (
                <button
                  key={i}
                  id={`borel-pivot-leg-${i}`}
                  type="button"
                  aria-pressed={pivotLeg === i}
                  onClick={() => setPivotLeg(i)}
                  className={cn(
                    "cf-btn h-8 cursor-pointer rounded border font-mono text-[11px]",
                    pivotLeg === i
                      ? "border-[#3b82f6] bg-[#2563eb]/15 text-[#f3f4f6]"
                      : "border-[#22262e] text-[#9ca3af] hover:border-[#303642]",
                  )}
                >
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
                className="cf-btn inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Repeat2 className="h-3.5 w-3.5" />
                Flip
              </button>
              <button
                id="borel-pivot-shield-btn"
                type="button"
                onClick={() => handlePivot("SHIELD")}
                disabled={pivotLocked}
                className="cf-btn inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Shield className="h-3.5 w-3.5" />
                Shield
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[#6b7280]">
              {serverClock && nowMs < lockAtMs
                ? `Devnet room starts in ${Math.ceil((lockAtMs - nowMs) / 1000)}s — pivots open at the lock.`
                : "Flip banks the move so far and reverses the leg. Shield banks it and parks the leg in cash."}
            </p>
          </>
        )}
      </section>
    ) : null;

  const receiptsPanel =
    receipts.length > 0 ? (
      <section className="rounded-lg border border-[#22262e] bg-[#0a0d14] px-4 py-3">
        <h2 className="mb-1 text-sm font-semibold text-[#f3f4f6]">Lock receipts</h2>
        <ul id="borel-lock-receipts">
          {receipts.map((r, i) => (
            <ReceiptLine key={`${r.label}-${i}`} entry={r} />
          ))}
        </ul>
      </section>
    ) : null;

  const showdown =
    phase === "SHOWDOWN" && youRow ? (
      <section id="borel-showdown">
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[#3b82f6]/30 bg-[#0a0d14] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[#f3f4f6]">Showdown · 00:00</h2>
            <p className="text-[11px] text-[#9ca3af]">Every hand is face-up. Final prices are frozen at the bell.</p>
          </div>
          <div className="flex items-baseline gap-4 font-mono tabular-nums">
            <span className="text-2xl font-semibold text-[#f3f4f6]">#{youRow.rank}</span>
            <span className={cn("text-lg font-semibold", scoreTone(youRow.scoreE9))}>
              {formatScorePctPrecise(youRow.scoreE9)}
            </span>
          </div>
        </div>
      </section>
    ) : null;

  const receiptBlock =
    phase === "SHOWDOWN" && youRow ? (
      <section className="space-y-3">
        <HandReceipt
          roomCode={roomCode}
          modeLabel={MODE_LABEL[mode]}
          stakeLabel={stake === "PAPER" ? "Paper" : "Devnet"}
          rank={youRow.rank}
          totalSeats={ranked.length}
          scoreE9={youRow.scoreE9}
          legs={receiptLegs}
          commitment={commitment}
          explorerUrl={settleReceipt?.outcome.kind === "receipt" ? settleReceipt.outcome.receipt.explorerUrl : undefined}
          signature={settleReceipt?.outcome.kind === "receipt" ? settleReceipt.outcome.receipt.signature : undefined}
        />
        <button
          id="borel-next-room-btn"
          type="button"
          onClick={handleNextRoom}
          className="cf-btn inline-flex h-9 cursor-pointer items-center rounded-md border border-[#303642] bg-[#171a20] px-4 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
        >
          Next room
        </button>
      </section>
    ) : null;

  return (
    <div className="space-y-3">
      {header}
      {statebar}
      {phase === "DRAFT" ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="lg:col-span-8">{handCards}</div>
          <div className="lg:col-span-4">{ladder}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            {showdown}
            {ladder}
            {receiptBlock}
            {matrix}
          </div>
          <div className="space-y-3 lg:col-span-5">
            {handCards}
            {pivotControl}
            {phase === "SEALED" && stake === "PAPER" ? (
              <button
                id="borel-force-showdown-btn"
                type="button"
                onClick={runShowdown}
                className="cf-btn h-8 cursor-pointer rounded-md px-2 font-mono text-[11px] text-[#6b7280] underline-offset-2 hover:text-[#d1d5db] hover:underline"
              >
                Ring the bell now (end round at current prices)
              </button>
            ) : null}
            {receiptsPanel}
          </div>
        </div>
      )}
    </div>
  );
}
