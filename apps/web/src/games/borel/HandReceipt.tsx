"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Copy, Download, ExternalLink, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { Conviction } from "@/lib/borel/types";
import { cn } from "@/lib/utils";
import { FOCUS_RING, displaySign, formatScorePctPrecise, formatTestUsdc } from "./format";
import { bpsLabel } from "./StakeControls";
import { outcomeTier } from "./UnsealMoment";

export type LegOutcome = "WIN" | "LOSS" | "FLAT";

export interface ReceiptLeg {
  readonly conviction: Conviction;
  readonly outcome: LegOutcome;
  readonly pivot?: "FLIP" | "SHIELD";
}

export interface HandReceiptProps {
  roomCode: string;
  modeLabel: string;
  stakeLabel: string;
  rank: number;
  totalSeats: number;
  scoreE9: bigint;
  /** Exactly three legs; rendered in conviction order so markets stay hidden. */
  legs: readonly ReceiptLeg[];
  commitment: string;
  /** Solscan URL of the round's on-chain transaction, when one exists. */
  explorerUrl?: string;
  signature?: string;
  /** Connected wallet (short form) shown as the player; omitted when no wallet is connected. */
  playerLabel?: string;
  /** Real test-USDC stake for this room (base units, 6 decimals); omitted for unstaked rooms. */
  stake?: ReceiptStake;
}

export interface ReceiptStake {
  readonly stakeUnits: bigint;
  /** Settled payout; null until the vault reports it. */
  readonly payoutUnits: bigint | null;
  readonly feeBps: number | null;
  readonly poolUnits: bigint | null;
}

/** "Staked 10.00 → paid 18.81 test-USDC" (or "settling") for the card and the share text. */
function stakeSummary(stake: ReceiptStake): string {
  return stake.payoutUnits === null
    ? `Staked ${formatTestUsdc(stake.stakeUnits)} test-USDC · payout settling`
    : `Staked ${formatTestUsdc(stake.stakeUnits)} → paid ${formatTestUsdc(stake.payoutUnits)} test-USDC`;
}

const W = 1080;
const H = 1080;
const M = 72;
const EXPORT_SCALE = 1;
const SANS = "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO =
  "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const NUMERIC: React.CSSProperties = { fontVariantNumeric: "tabular-nums slashed-zero" };
const SHARE_URL = "https://cartridgefi.vercel.app";

const GLYPH: Record<LegOutcome, string> = { WIN: "▲", LOSS: "▼", FLAT: "■" };
const TILE: Record<LegOutcome, { fill: string; stroke: string; ink: string }> = {
  WIN: { fill: "#0d2a20", stroke: "#10b981", ink: "#34d399" },
  LOSS: { fill: "#2a1214", stroke: "#ef4444", ink: "#f87171" },
  FLAT: { fill: "#15181f", stroke: "#303642", ink: "#9ca3af" },
};

export function receiptGlyphs(legs: readonly ReceiptLeg[]): string {
  return [...legs]
    .sort((a, b) => a.conviction - b.conviction)
    .map((leg) => GLYPH[leg.outcome])
    .join("");
}

/** Wordle-style share text: header line, spoiler-free glyph row, link. Markets are never named. */
export function buildShareText(props: HandReceiptProps): string {
  const lines = [
    `Borel ${props.roomCode} · #${props.rank}/${props.totalSeats} · ${formatScorePctPrecise(props.scoreE9)}`,
    `${receiptGlyphs(props.legs)}  1x 2x 3x`,
    `${props.playerLabel ? `${props.playerLabel} · ` : ""}${props.modeLabel} · ${props.stakeLabel}${props.explorerUrl ? ` · ${props.explorerUrl}` : ""}`,
    ...(props.stake ? [stakeSummary(props.stake)] : []),
    SHARE_URL,
  ];
  return lines.join("\n");
}

function buildQrPath(text: string): { d: string; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  let d = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { d, size };
}

async function rasterizeSvg(svg: SVGSVGElement, canvas: HTMLCanvasElement): Promise<Blob> {
  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Receipt SVG could not be decoded"));
      image.src = url;
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
      "image/png",
    );
  });
}

export function HandReceipt(props: HandReceiptProps): React.JSX.Element {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [exporting, setExporting] = React.useState<boolean>(false);
  // navigator.share exists only on some browsers; detect after mount so SSR markup matches.
  const [canShare, setCanShare] = React.useState<boolean>(false);
  React.useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const qr = React.useMemo(
    () => (props.explorerUrl ? buildQrPath(props.explorerUrl) : null),
    [props.explorerUrl],
  );
  const orderedLegs = React.useMemo(
    () => [...props.legs].sort((a, b) => a.conviction - b.conviction),
    [props.legs],
  );
  const scorePct = formatScorePctPrecise(props.scoreE9);
  const sign = displaySign(props.scoreE9);
  const scoreInk = sign > 0 ? "#34d399" : sign < 0 ? "#f87171" : "#f3f4f6";
  const tier = outcomeTier(props.rank, props.totalSeats);
  const fileName = `borel-${props.roomCode.toLowerCase().replace(/[^a-z0-9-]/g, "")}-receipt.png`;
  const qrBox = 168;
  const qrQuiet = 3;
  const qrX = W - M - qrBox;
  const qrY = 812;
  const tileW = 288;
  const tileGap = (W - M * 2 - tileW * 3) / 2;

  const renderPng = async (): Promise<Blob | null> => {
    const svg = svgRef.current;
    const canvas = canvasRef.current;
    if (!svg || !canvas) return null;
    return rasterizeSvg(svg, canvas);
  };

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildShareText(props));
      toast.success("Receipt copied");
    } catch {
      toast.error("Clipboard unavailable in this browser");
    }
  };

  const handleDownload = async (): Promise<void> => {
    setExporting(true);
    try {
      const blob = await renderPng();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Receipt export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleShare = async (): Promise<void> => {
    const text = buildShareText(props);
    setExporting(true);
    try {
      const blob = await renderPng();
      const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;
      if (file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: `Borel ${props.roomCode}` });
      } else {
        await navigator.share({ text, title: `Borel ${props.roomCode}` });
      }
    } catch (error) {
      // Dismissing the share sheet rejects with AbortError: that is a choice, not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Sharing failed; use Copy text instead");
      }
    } finally {
      setExporting(false);
    }
  };

  const actionBtn = cn(
    "cf-btn inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#303642] bg-[#171a20] px-3 text-[13px] font-medium text-[#e5e7eb] hover:bg-[#1d2129] disabled:opacity-60 sm:flex-none",
    FOCUS_RING,
  );

  return (
    <figure id="borel-receipt" className="m-0 space-y-3">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Unsealed hand receipt ${props.roomCode}: ${receiptGlyphs(props.legs)}, rank ${props.rank} of ${props.totalSeats}, score ${scorePct}`}
        className="mx-auto block h-auto w-full max-w-[480px] rounded-xl border border-[#22262e]"
      >
        <rect width={W} height={H} fill="#0a0d14" />
        <rect width={W} height={8} fill={tier.ring} />
        <text x={M} y={128} fill="#f3f4f6" fontFamily={SANS} fontSize={64} fontWeight={700} letterSpacing={-2.4}>
          Borel
        </text>
        <text x={M} y={176} fill="#9ca3af" fontFamily={SANS} fontSize={28}>
          Unsealed hand · {props.modeLabel} · {props.stakeLabel}
        </text>
        <text x={W - M} y={124} fill="#f3f4f6" fontFamily={MONO} fontSize={40} fontWeight={600} textAnchor="end" style={NUMERIC}>
          {props.roomCode}
        </text>
        {props.playerLabel ? (
          <text x={W - M} y={172} fill="#9ca3af" fontFamily={MONO} fontSize={26} textAnchor="end" style={NUMERIC}>
            {props.playerLabel}
          </text>
        ) : null}

        {/* Spoiler-free leg tiles: outcome only, ordered 1x → 3x, markets withheld */}
        {orderedLegs.map((leg, i) => {
          const x = M + i * (tileW + tileGap);
          const tile = TILE[leg.outcome];
          return (
            <g key={`${leg.conviction}`}>
              <rect x={x} y={232} width={tileW} height={248} rx={20} fill={tile.fill} stroke={tile.stroke} strokeWidth={4} />
              <text x={x + tileW / 2} y={404} fill={tile.ink} fontFamily={MONO} fontSize={150} textAnchor="middle">
                {GLYPH[leg.outcome]}
              </text>
              <text x={x} y={526} fill="#d1d5db" fontFamily={MONO} fontSize={28} fontWeight={600} style={NUMERIC}>
                {leg.conviction}x{leg.conviction === 3 ? " sniper" : ""}
              </text>
              {leg.pivot ? (
                <text x={x + tileW} y={526} fill="#9ca3af" fontFamily={MONO} fontSize={24} textAnchor="end">
                  {leg.pivot === "FLIP" ? "flipped" : "shielded"}
                </text>
              ) : null}
            </g>
          );
        })}

        <line x1={M} y1={572} x2={W - M} y2={572} stroke="#303642" strokeWidth={2} />
        <text x={M} y={626} fill="#9ca3af" fontFamily={SANS} fontSize={26} fontWeight={500}>
          Final rank
        </text>
        <text x={M - 8} y={772} fill={tier.ink} fontFamily={MONO} fontSize={176} fontWeight={600} letterSpacing={-10} style={NUMERIC}>
          #{props.rank}
        </text>
        <text x={M} y={826} fill="#9ca3af" fontFamily={MONO} fontSize={28} style={NUMERIC}>
          of {props.totalSeats} seats · {tier.label.toLowerCase()}
        </text>
        {props.stake ? (
          <text x={M} y={870} fill="#fbbf24" fontFamily={MONO} fontSize={24} fontWeight={600} style={NUMERIC}>
            {stakeSummary(props.stake)}
          </text>
        ) : null}

        <text x={W - M} y={626} fill="#9ca3af" fontFamily={SANS} fontSize={26} fontWeight={500} textAnchor="end">
          Hand score
        </text>
        <text
          x={W - M}
          y={732}
          fill={scoreInk}
          fontFamily={MONO}
          fontSize={Math.min(96, Math.floor(820 / scorePct.length))}
          fontWeight={600}
          letterSpacing={-3}
          textAnchor="end"
          style={NUMERIC}
        >
          {scorePct}
        </text>
        <text x={W - M} y={776} fill="#9ca3af" fontFamily={MONO} fontSize={24} textAnchor="end">
          Σ move × card
        </text>

        <text x={M} y={912} fill="#9ca3af" fontFamily={SANS} fontSize={22}>
          Hand commitment · sha256, published at seal
        </text>
        <text x={M} y={948} fill="#d1d5db" fontFamily={MONO} fontSize={24} style={NUMERIC}>
          {props.commitment.slice(0, 20)}…{props.commitment.slice(-12)}
        </text>
        <text x={M} y={990} fill="#9ca3af" fontFamily={MONO} fontSize={22} style={NUMERIC}>
          {props.signature
            ? `Settle tx ${props.signature.slice(0, 12)}…${props.signature.slice(-8)}`
            : "Paper round · no on-chain transaction"}
        </text>
        <text x={M} y={H - 36} fill="#7d8590" fontFamily={MONO} fontSize={20}>
          cartridgefi.vercel.app · ▲ up ▼ down ■ flat · markets withheld
        </text>

        {qr ? (
          <g>
            <rect x={qrX} y={qrY} width={qrBox} height={qrBox} rx={8} fill="#f3f4f6" />
            <path
              d={qr.d}
              fill="#0b0c0e"
              shapeRendering="crispEdges"
              transform={`translate(${qrX + (qrQuiet * qrBox) / (qr.size + qrQuiet * 2)} ${qrY + (qrQuiet * qrBox) / (qr.size + qrQuiet * 2)}) scale(${qrBox / (qr.size + qrQuiet * 2)})`}
            />
          </g>
        ) : null}
      </svg>

      <figcaption className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#9ca3af]">
          {props.explorerUrl ? (
            <a
              href={props.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("inline-flex items-center gap-1 rounded text-[#93c5fd] hover:underline", FOCUS_RING)}
            >
              Solscan transaction
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : (
            <span>Paper round · nothing was broadcast</span>
          )}
          <span>Spoiler-free: markets stay hidden</span>
        </div>
        {props.stake ? (
          <dl
            id="borel-receipt-stake"
            className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-[#f59e0b]/25 bg-[#0d0b07] px-3 py-2 font-mono text-[11px] tabular-nums sm:grid-cols-4"
          >
            <div>
              <dt className="text-[#9ca3af]">Staked</dt>
              <dd className="text-[#e5e7eb]">{formatTestUsdc(props.stake.stakeUnits)}</dd>
            </div>
            <div>
              <dt className="text-[#9ca3af]">Pool</dt>
              <dd className="text-[#e5e7eb]">{props.stake.poolUnits === null ? "—" : formatTestUsdc(props.stake.poolUnits)}</dd>
            </div>
            <div>
              <dt className="text-[#9ca3af]">Fee {props.stake.feeBps === null ? "1%" : bpsLabel(BigInt(props.stake.feeBps))}</dt>
              <dd className="text-[#e5e7eb]">
                {props.stake.poolUnits === null || props.stake.feeBps === null
                  ? "—"
                  : formatTestUsdc((props.stake.poolUnits * BigInt(props.stake.feeBps)) / 10_000n)}
              </dd>
            </div>
            <div>
              <dt className="text-[#9ca3af]">Payout</dt>
              <dd className="font-semibold text-[#fbbf24]">
                {props.stake.payoutUnits === null ? "settling" : formatTestUsdc(props.stake.payoutUnits)}
              </dd>
            </div>
          </dl>
        ) : null}
        <div className="flex flex-wrap gap-2 sm:justify-center">
          {canShare ? (
            <button
              id="borel-receipt-share-btn"
              type="button"
              onClick={() => void handleShare()}
              disabled={exporting}
              className={cn(actionBtn, "border-[#3b82f6]/60 bg-[#2563eb]/20 text-[#f3f4f6] hover:bg-[#2563eb]/30")}
            >
              <Share2 className="h-4 w-4" />
              Share
            </button>
          ) : null}
          <button id="borel-receipt-copy-btn" type="button" onClick={() => void handleCopy()} className={actionBtn}>
            <Copy className="h-4 w-4" />
            Copy text
          </button>
          <button
            id="borel-receipt-download-btn"
            type="button"
            onClick={() => void handleDownload()}
            disabled={exporting}
            className={actionBtn}
          >
            <Download className="h-4 w-4" />
            {exporting ? "Rendering…" : "Download PNG"}
          </button>
        </div>
      </figcaption>

      <canvas
        ref={canvasRef}
        width={W * EXPORT_SCALE}
        height={H * EXPORT_SCALE}
        className="hidden"
        aria-hidden="true"
      />
    </figure>
  );
}
