"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { Conviction } from "@/lib/borel/types";
import { formatScorePctPrecise } from "./format";

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
}

const W = 1200;
const H = 630;
const M = 56;
const EXPORT_SCALE = 2;
const SANS = "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO =
  "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const NUMERIC: React.CSSProperties = { fontVariantNumeric: "tabular-nums slashed-zero" };

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

export function buildShareText(props: HandReceiptProps): string {
  const lines = [
    `Borel ${props.roomCode} · ${props.playerLabel ? `${props.playerLabel} · ` : ""}${props.modeLabel} · ${props.stakeLabel}`,
    `${receiptGlyphs(props.legs)}  #${props.rank}/${props.totalSeats}  ${formatScorePctPrecise(props.scoreE9)}`,
    props.explorerUrl ?? "Paper round · no on-chain transaction",
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

  const qr = React.useMemo(
    () => (props.explorerUrl ? buildQrPath(props.explorerUrl) : null),
    [props.explorerUrl],
  );
  const orderedLegs = React.useMemo(
    () => [...props.legs].sort((a, b) => a.conviction - b.conviction),
    [props.legs],
  );
  const scorePct = formatScorePctPrecise(props.scoreE9);
  const scoreInk = props.scoreE9 > 0n ? "#34d399" : props.scoreE9 < 0n ? "#f87171" : "#f3f4f6";
  const qrBox = 176;
  const qrQuiet = 3;
  const qrX = W - M - qrBox;
  const qrY = 392;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildShareText(props));
      toast.success("Receipt copied");
    } catch {
      toast.error("Clipboard unavailable in this browser");
    }
  };

  const handleDownload = async (): Promise<void> => {
    const svg = svgRef.current;
    const canvas = canvasRef.current;
    if (!svg || !canvas) return;
    setExporting(true);
    try {
      const blob = await rasterizeSvg(svg, canvas);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `borel-${props.roomCode.toLowerCase()}-receipt.png`;
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

  return (
    <figure id="borel-receipt" className="m-0 space-y-2.5">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Unsealed hand receipt ${props.roomCode}: ${receiptGlyphs(props.legs)}, rank ${props.rank} of ${props.totalSeats}, score ${scorePct}`}
        className="block h-auto w-full rounded-lg border border-[#22262e]"
      >
        <rect width={W} height={H} fill="#0a0d14" />
        <text x={M} y={78} fill="#f3f4f6" fontFamily={SANS} fontSize={22} fontWeight={600} letterSpacing={-0.5}>
          Unsealed hand receipt
        </text>
        <text x={M} y={104} fill="#6b7280" fontFamily={SANS} fontSize={14}>
          Borel · sealed-conviction live market showdown
        </text>
        <text x={W - M} y={78} fill="#f3f4f6" fontFamily={MONO} fontSize={20} fontWeight={600} textAnchor="end" style={NUMERIC}>
          {props.roomCode}
        </text>
        <text x={W - M} y={104} fill="#6b7280" fontFamily={MONO} fontSize={13} textAnchor="end">
          {props.playerLabel ? `${props.playerLabel} · ` : ""}{props.modeLabel} · {props.stakeLabel}
        </text>
        <line x1={M} y1={128} x2={W - M} y2={128} stroke="#303642" />

        {/* Spoiler-free leg tiles: outcome only, ordered 1x → 3x */}
        {orderedLegs.map((leg, i) => {
          const x = M + i * 136;
          const tile = TILE[leg.outcome];
          return (
            <g key={`${leg.conviction}`}>
              <rect x={x} y={168} width={120} height={120} rx={6} fill={tile.fill} stroke={tile.stroke} strokeWidth={1.5} />
              <text x={x + 60} y={248} fill={tile.ink} fontFamily={MONO} fontSize={54} textAnchor="middle">
                {GLYPH[leg.outcome]}
              </text>
              <text x={x} y={316} fill="#9ca3af" fontFamily={MONO} fontSize={14} style={NUMERIC}>
                {leg.conviction}x{leg.conviction === 3 ? " sniper" : ""}
              </text>
              {leg.pivot ? (
                <text x={x} y={336} fill="#6b7280" fontFamily={MONO} fontSize={12}>
                  {leg.pivot === "FLIP" ? "flipped" : "shielded"}
                </text>
              ) : null}
            </g>
          );
        })}

        <line x1={500} y1={168} x2={500} y2={336} stroke="#22262e" />
        <text x={530} y={190} fill="#6b7280" fontFamily={SANS} fontSize={13} fontWeight={500}>
          Final rank
        </text>
        <text x={524} y={300} fill="#f3f4f6" fontFamily={MONO} fontSize={112} fontWeight={600} letterSpacing={-5} style={NUMERIC}>
          #{props.rank}
        </text>
        <text x={530} y={330} fill="#6b7280" fontFamily={MONO} fontSize={16} style={NUMERIC}>
          of {props.totalSeats} seats
        </text>

        <line x1={800} y1={168} x2={800} y2={336} stroke="#22262e" />
        <text x={830} y={190} fill="#6b7280" fontFamily={SANS} fontSize={13} fontWeight={500}>
          Hand score
        </text>
        <text
          x={830}
          y={278}
          fill={scoreInk}
          fontFamily={MONO}
          fontSize={Math.min(64, Math.floor(300 / (scorePct.length * 0.6)))}
          fontWeight={600}
          letterSpacing={-1.5}
          style={NUMERIC}
        >
          {scorePct}
        </text>
        <text x={830} y={330} fill="#6b7280" fontFamily={MONO} fontSize={14}>
          Σ return × conviction
        </text>

        <line x1={M} y1={368} x2={W - M} y2={368} stroke="#303642" />
        <text x={M} y={414} fill="#6b7280" fontFamily={SANS} fontSize={13}>
          Hand commitment (sha256, published at seal)
        </text>
        <text x={M} y={442} fill="#d1d5db" fontFamily={MONO} fontSize={14} style={NUMERIC}>
          {props.commitment.slice(0, 32)}
        </text>
        <text x={M} y={464} fill="#d1d5db" fontFamily={MONO} fontSize={14} style={NUMERIC}>
          {props.commitment.slice(32)}
        </text>
        <text x={M} y={512} fill="#6b7280" fontFamily={SANS} fontSize={13}>
          {props.signature ? "Settlement transaction" : "Settlement"}
        </text>
        <text x={M} y={540} fill="#d1d5db" fontFamily={MONO} fontSize={14} style={NUMERIC}>
          {props.signature
            ? `${props.signature.slice(0, 22)}…${props.signature.slice(-22)}`
            : "Paper round · no on-chain transaction"}
        </text>
        <text x={M} y={H - 24} fill="#6b7280" fontFamily={MONO} fontSize={11}>
          ▲ leg finished up · ▼ leg finished down · ■ flat or shielded · markets withheld
        </text>

        {qr ? (
          <g>
            <rect x={qrX} y={qrY} width={qrBox} height={qrBox} fill="#f3f4f6" />
            <path
              d={qr.d}
              fill="#0b0c0e"
              shapeRendering="crispEdges"
              transform={`translate(${qrX + (qrQuiet * qrBox) / (qr.size + qrQuiet * 2)} ${qrY + (qrQuiet * qrBox) / (qr.size + qrQuiet * 2)}) scale(${qrBox / (qr.size + qrQuiet * 2)})`}
            />
            <text x={qrX - 16} y={qrY + 16} fill="#9ca3af" fontFamily={SANS} fontSize={12} textAnchor="end">
              Scan for transaction
            </text>
            <text x={qrX - 16} y={qrY + 34} fill="#6b7280" fontFamily={MONO} fontSize={11} textAnchor="end">
              solscan.io · devnet
            </text>
          </g>
        ) : (
          <g>
            <rect x={qrX} y={qrY} width={qrBox} height={qrBox} fill="none" stroke="#303642" strokeDasharray="4 4" />
            <text x={qrX + qrBox / 2} y={qrY + qrBox / 2 + 4} fill="#6b7280" fontFamily={MONO} fontSize={12} textAnchor="middle">
              no transaction
            </text>
          </g>
        )}
      </svg>

      <figcaption className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#9ca3af]">
        {props.explorerUrl ? (
          <a
            href={props.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline"
          >
            Solscan transaction
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <span>Paper round · nothing was broadcast</span>
        )}
        <span className="flex items-center gap-2">
          <button
            id="borel-receipt-copy-btn"
            type="button"
            onClick={() => void handleCopy()}
            className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy text
          </button>
          <button
            id="borel-receipt-download-btn"
            type="button"
            onClick={() => void handleDownload()}
            disabled={exporting}
            className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129] disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Rendering…" : "Download PNG"}
          </button>
        </span>
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
