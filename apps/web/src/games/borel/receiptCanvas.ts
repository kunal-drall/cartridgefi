export interface BorelReceiptRenderInput {
  roundCode: string;
  playerWalletShort: string;
  sessionModeLabel: string;
  rank: number;
  skillScoreFormatted: string;
  prevEloFormatted: string;
  nextEloFormatted: string;
  deltaEloFormatted: string;
  payoutSummary: string;
  vrfSeedShort: string;
  erRoomProgramId: string;
  teeProgramId: string;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Renders a crisp 1200x630 institutional settlement receipt on HTML5 Canvas.
 */
export function renderBorelEloReceiptCanvas(
  canvas: HTMLCanvasElement,
  data: BorelReceiptRenderInput,
): string {
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }

  ctx.fillStyle = "#0b0c0e";
  ctx.fillRect(0, 0, 1200, 630);

  drawRoundedRect(ctx, 36, 32, 1128, 566, 12);
  ctx.fillStyle = "#111317";
  ctx.fill();
  ctx.strokeStyle = "#22262e";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Top cobalt bar
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(36, 32, 1128, 4);

  // Header
  ctx.fillStyle = "#f3f4f6";
  ctx.font = "600 18px system-ui, -apple-system, sans-serif";
  ctx.fillText("CartridgeFi Settlement Receipt — Borel Arena (#001)", 72, 86);

  ctx.fillStyle = "#9ca3af";
  ctx.font = "500 15px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${data.roundCode} | ${data.sessionModeLabel}`, 1128, 86);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#22262e";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(72, 110);
  ctx.lineTo(1128, 110);
  ctx.stroke();

  // Headline
  ctx.fillStyle = "#f3f4f6";
  ctx.font = "700 42px system-ui, -apple-system, sans-serif";
  ctx.fillText("Round Settlement Summary", 72, 174);

  drawRoundedRect(ctx, 920, 134, 208, 52, 8);
  ctx.fillStyle = data.rank === 1 ? "rgba(16, 185, 129, 0.14)" : "#171a20";
  ctx.fill();
  ctx.strokeStyle = data.rank === 1 ? "#10b981" : "#303642";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = data.rank === 1 ? "#34d399" : "#e5e7eb";
  ctx.font = "600 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`Rank #${data.rank} of 4`, 1024, 167);
  ctx.textAlign = "left";

  const boxes = [
    {
      x: 72,
      w: 336,
      label: "Relative Return Score",
      value: data.skillScoreFormatted,
      sub: "Direction-neutral benchmark adjusted",
      accent: "#34d399",
    },
    {
      x: 432,
      w: 336,
      label: "Passport ELO Rating",
      value: `${data.nextEloFormatted}`,
      sub: `${data.prevEloFormatted} -> ${data.nextEloFormatted} (${data.deltaEloFormatted})`,
      accent: "#f3f4f6",
    },
    {
      x: 792,
      w: 336,
      label: "Vault Settlement",
      value: data.payoutSummary,
      sub: `Account: ${data.playerWalletShort}`,
      accent: "#93c5fd",
    },
  ];

  for (const b of boxes) {
    drawRoundedRect(ctx, b.x, 224, b.w, 192, 10);
    ctx.fillStyle = "#0b0c0e";
    ctx.fill();
    ctx.strokeStyle = "#22262e";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#9ca3af";
    ctx.font = "500 14px system-ui, -apple-system, sans-serif";
    ctx.fillText(b.label, b.x + 22, 262);

    ctx.fillStyle = b.accent;
    ctx.font = "600 32px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(b.value.slice(0, 18), b.x + 22, 322);

    ctx.fillStyle = "#6b7280";
    ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(b.sub.slice(0, 38), b.x + 22, 372);
  }

  drawRoundedRect(ctx, 72, 450, 1056, 112, 10);
  ctx.fillStyle = "#0b0c0e";
  ctx.fill();
  ctx.strokeStyle = "#22262e";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#d1d5db";
  ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `ER Room Program: ${data.erRoomProgramId}  |  TEE Program: ${data.teeProgramId}`,
    96,
    488,
  );

  ctx.fillStyle = "#9ca3af";
  ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `Verified VRF Seed Reference: ${data.vrfSeedShort}  |  Fixed-Point 10^9 Settlement`,
    96,
    522,
  );

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export function triggerCanvasPngDownload(
  canvas: HTMLCanvasElement,
  filename: string,
): string {
  const dataUrl = canvas.toDataURL("image/png");
  if (typeof document !== "undefined" && dataUrl.startsWith("data:image/png")) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  return dataUrl;
}
