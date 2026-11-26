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
 * Renders a crisp 1200x630 high-contrast Market ELO Receipt Card on HTML5 Canvas.
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

  // 1. Void background
  ctx.fillStyle = "#050609";
  ctx.fillRect(0, 0, 1200, 630);

  // Subtle precision grid lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
  ctx.lineWidth = 1;
  for (let gx = 60; gx < 1200; gx += 60) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, 630);
    ctx.stroke();
  }
  for (let gy = 60; gy < 630; gy += 60) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(1200, gy);
    ctx.stroke();
  }

  // 2. Main anodized hardware frame
  drawRoundedRect(ctx, 36, 32, 1128, 566, 28);
  ctx.fillStyle = "#0A0D14";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Top emerald specular bar
  ctx.fillStyle = "#00F59B";
  ctx.fillRect(68, 32, 1064, 4);

  // 3. Header row
  ctx.fillStyle = "#00F59B";
  ctx.font = "700 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("CARTRIDGEFI ENGINE // CARTRIDGE #001: BOREL", 76, 88);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "600 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`ROUND #${data.roundCode} · ${data.sessionModeLabel}`, 1124, 88);
  ctx.textAlign = "left";

  // Header divider
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(76, 112);
  ctx.lineTo(1124, 112);
  ctx.stroke();

  // 4. Primary Title & Rank Badge
  ctx.fillStyle = "#F8FAFC";
  ctx.font = "800 50px system-ui, -apple-system, sans-serif";
  ctx.fillText("VERIFIED MARKET ELO RECEIPT", 76, 178);

  drawRoundedRect(ctx, 900, 134, 224, 56, 14);
  ctx.fillStyle = data.rank === 1 ? "rgba(0, 245, 155, 0.14)" : "rgba(0, 212, 255, 0.14)";
  ctx.fill();
  ctx.strokeStyle = data.rank === 1 ? "#00F59B" : "#00D4FF";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = data.rank === 1 ? "#00F59B" : "#00D4FF";
  ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`PODIUM RANK #${data.rank}`, 1012, 170);
  ctx.textAlign = "left";

  // 5. Three Telemetry Wells
  const boxes = [
    {
      x: 76,
      w: 332,
      label: "DIRECTION-NEUTRAL SKILL (S_REL)",
      value: data.skillScoreFormatted,
      sub: "Kalshi 1.35x Carry Calibrated",
      accent: "#00F59B",
    },
    {
      x: 434,
      w: 332,
      label: "PORTABLE MARKET ELO RATING",
      value: `${data.nextEloFormatted} ELO`,
      sub: `${data.prevEloFormatted} -> ${data.nextEloFormatted} (${data.deltaEloFormatted})`,
      accent: "#00D4FF",
    },
    {
      x: 792,
      w: 332,
      label: "EARNED STOCK VAULT PAYOUT",
      value: data.payoutSummary,
      sub: `Passport Owner: ${data.playerWalletShort}`,
      accent: "#FFB020",
    },
  ];

  for (const b of boxes) {
    drawRoundedRect(ctx, b.x, 224, b.w, 196, 20);
    ctx.fillStyle = "#050609";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#94A3B8";
    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(b.label, b.x + 22, 264);

    ctx.fillStyle = b.accent;
    ctx.font = "700 34px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(b.value.slice(0, 18), b.x + 22, 326);

    ctx.fillStyle = "#CBD5E1";
    ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(b.sub.slice(0, 36), b.x + 22, 376);
  }

  // 6. Cryptographic Attestation Strip
  drawRoundedRect(ctx, 76, 452, 1048, 110, 16);
  ctx.fillStyle = "rgba(17, 21, 32, 0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(139, 92, 246, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = "#C4B5FD";
  ctx.font = "600 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `MAGICBLOCK PRIVATE ER TEE (${data.teeProgramId.slice(0, 12)}…) · ZERO COPY-TRADE LEAKAGE`,
    100,
    488,
  );

  ctx.fillStyle = "#94A3B8";
  ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `ER Room Program: ${data.erRoomProgramId}   |   VRF Proof Seed: ${data.vrfSeedShort}`,
    100,
    518,
  );
  ctx.fillText(
    "Settled Atomically on Solana L1 via Magic Actions · Kora Gasless Paymaster · 100% Fixed-Point i128 Math",
    100,
    544,
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
