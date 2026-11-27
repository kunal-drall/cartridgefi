import {
  laneToTargetX,
  type PulseRunnerRunState,
  type RunnerLaneId,
} from "./engine";

function projectPoint(
  laneCoord: number,
  z: number,
  width: number,
  height: number,
): { x: number; y: number; scale: number } {
  const horizonY = height * 0.24;
  const bottomY = height * 0.94;
  const depth = 1 - Math.max(-0.1, Math.min(1.05, z));
  const perspectiveT = depth * depth * 0.65 + depth * 0.35;
  const y = horizonY + (bottomY - horizonY) * perspectiveT;

  const topTrackHalfWidth = width * 0.09;
  const bottomTrackHalfWidth = width * 0.44;
  const halfWidthAtY =
    topTrackHalfWidth +
    (bottomTrackHalfWidth - topTrackHalfWidth) * perspectiveT;
  const scale = 0.22 + 0.78 * perspectiveT;

  const x = width * 0.5 + (laneCoord / 1.5) * halfWidthAtY;
  return { x, y, scale };
}

function laneAccentColor(lane: RunnerLaneId): string {
  if (lane === "LANE_LEFT") return "#ef4444";
  if (lane === "LANE_CENTER") return "#3b82f6";
  return "#10b981";
}

export function renderPulseRunnerFrame(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  state: PulseRunnerRunState,
  measuredFps: number,
  reducedMotion: boolean,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  // Matte carbon ground
  ctx.fillStyle = "#0b0c0e";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const horizonY = cssHeight * 0.24;
  ctx.fillStyle = "#0e1014";
  ctx.fillRect(0, horizonY, cssWidth, cssHeight - horizonY);

  // Volatility trace line at horizon
  ctx.strokeStyle = "#303642";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const waveAmp = Math.min(14, (state.volatilitySigmaMilli / 1000) * 3.8);
  const phaseShift = reducedMotion ? 0 : state.distanceMeters * 0.08;
  for (let px = 0; px <= cssWidth; px += 12) {
    const wy =
      horizonY -
      8 +
      Math.sin(px * 0.028 + phaseShift) *
        waveAmp *
        Math.sin((px / cssWidth) * Math.PI);
    if (px === 0) ctx.moveTo(px, wy);
    else ctx.lineTo(px, wy);
  }
  ctx.stroke();

  // Perspective Track Surface
  const topLeft = projectPoint(-1.5, 1.0, cssWidth, cssHeight);
  const topRight = projectPoint(1.5, 1.0, cssWidth, cssHeight);
  const botRight = projectPoint(1.5, 0.0, cssWidth, cssHeight);
  const botLeft = projectPoint(-1.5, 0.0, cssWidth, cssHeight);

  ctx.fillStyle = "#111317";
  ctx.beginPath();
  ctx.moveTo(topLeft.x, topLeft.y);
  ctx.lineTo(topRight.x, topRight.y);
  ctx.lineTo(botRight.x, botRight.y);
  ctx.lineTo(botLeft.x, botLeft.y);
  ctx.closePath();
  ctx.fill();

  // Active lane tint
  const laneIdx = laneToTargetX(state.activeLane);
  const lTop0 = projectPoint(laneIdx - 0.5, 1.0, cssWidth, cssHeight);
  const lTop1 = projectPoint(laneIdx + 0.5, 1.0, cssWidth, cssHeight);
  const lBot1 = projectPoint(laneIdx + 0.5, 0.0, cssWidth, cssHeight);
  const lBot0 = projectPoint(laneIdx - 0.5, 0.0, cssWidth, cssHeight);

  ctx.fillStyle =
    state.activeLane === "LANE_LEFT"
      ? "rgba(239, 68, 68, 0.08)"
      : state.activeLane === "LANE_CENTER"
        ? "rgba(59, 130, 246, 0.08)"
        : "rgba(16, 185, 129, 0.08)";
  ctx.beginPath();
  ctx.moveTo(lTop0.x, lTop0.y);
  ctx.lineTo(lTop1.x, lTop1.y);
  ctx.lineTo(lBot1.x, lBot1.y);
  ctx.lineTo(lBot0.x, lBot0.y);
  ctx.closePath();
  ctx.fill();

  // Transverse ties
  const tieOffset = reducedMotion ? 0 : (state.distanceMeters * 0.025) % 0.125;
  ctx.strokeStyle = "#1d2129";
  ctx.lineWidth = 1;
  for (let z = 1.0 - tieOffset; z >= 0.0; z -= 0.125) {
    const pL = projectPoint(-1.5, z, cssWidth, cssHeight);
    const pR = projectPoint(1.5, z, cssWidth, cssHeight);
    ctx.beginPath();
    ctx.moveTo(pL.x, pL.y);
    ctx.lineTo(pR.x, pR.y);
    ctx.stroke();
  }

  // Rails
  const railCoords = [-1.5, -0.5, 0.5, 1.5] as const;
  for (const rc of railCoords) {
    const pTop = projectPoint(rc, 1.0, cssWidth, cssHeight);
    const pBot = projectPoint(rc, 0.0, cssWidth, cssHeight);
    ctx.strokeStyle = Math.abs(rc) === 1.5 ? "#383f4d" : "#262b35";
    ctx.lineWidth = Math.abs(rc) === 1.5 ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBot.x, pBot.y);
    ctx.stroke();
  }

  const laneGuides: readonly { coord: number; label: string }[] = [
    { coord: -1, label: "SHORT -1.0x" },
    { coord: 0, label: "NEUTRAL 0.0x" },
    { coord: 1, label: "LONG +1.0x" },
  ];
  for (const g of laneGuides) {
    const tagPos = projectPoint(g.coord, 0.02, cssWidth, cssHeight);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(g.label, tagPos.x, tagPos.y);
  }

  // Track objects
  const sortedObjects = [...state.objects].sort((a, b) => b.z - a.z);
  for (const obj of sortedObjects) {
    if (obj.z < -0.04 || obj.z > 1.02) continue;
    const lx = laneToTargetX(obj.lane);
    const center = projectPoint(lx, obj.z, cssWidth, cssHeight);
    const leftEdge = projectPoint(lx - 0.42, obj.z, cssWidth, cssHeight);
    const rightEdge = projectPoint(lx + 0.42, obj.z, cssWidth, cssHeight);
    const spanW = Math.max(16, rightEdge.x - leftEdge.x);

    if (obj.kind === "LIQUIDATION_BARRIER") {
      const barH = Math.max(12, 34 * center.scale);
      ctx.fillStyle = "rgba(239, 68, 68, 0.18)";
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = Math.max(1.2, 2 * center.scale);
      ctx.beginPath();
      ctx.rect(center.x - spanW * 0.5, center.y - barH, spanW, barH);
      ctx.fill();
      ctx.stroke();

      if (center.scale > 0.45) {
        ctx.fillStyle = "#fca5a5";
        ctx.font = `600 ${Math.round(10 * center.scale)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(obj.label, center.x, center.y - barH * 0.35);
      }
    } else if (obj.kind === "MOMENTUM_BOOSTER") {
      const r = Math.max(6, 17 * center.scale);
      const cy = center.y - r * 1.1;
      ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(center.x, cy - r);
      ctx.lineTo(center.x + r, cy);
      ctx.lineTo(center.x, cy + r);
      ctx.lineTo(center.x - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (obj.kind === "KALSHI_PORTAL") {
      const portalH = Math.max(20, 60 * center.scale);
      ctx.fillStyle = "rgba(37, 99, 235, 0.14)";
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = Math.max(1.4, 2.2 * center.scale);
      ctx.beginPath();
      ctx.rect(
        center.x - spanW * 0.48,
        center.y - portalH,
        spanW * 0.96,
        portalH,
      );
      ctx.fill();
      ctx.stroke();

      if (center.scale > 0.4) {
        ctx.fillStyle = "#93c5fd";
        ctx.font = `600 ${Math.round(10 * center.scale)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText("EVENT CARRY", center.x, center.y - portalH * 0.52);
      }
    }
  }

  // Player cursor geometry
  const shipPos = projectPoint(state.visualLaneX, 0.12, cssWidth, cssHeight);
  const shipColor = laneAccentColor(state.activeLane);
  const shipW = Math.max(24, Math.min(44, cssWidth * 0.05));
  const shipH = shipW * 0.82;

  ctx.fillStyle = "#171a20";
  ctx.strokeStyle = shipColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(shipPos.x, shipPos.y - shipH * 1.1);
  ctx.lineTo(shipPos.x + shipW * 0.54, shipPos.y + shipH * 0.1);
  ctx.lineTo(shipPos.x, shipPos.y - shipH * 0.18);
  ctx.lineTo(shipPos.x - shipW * 0.54, shipPos.y + shipH * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Top telemetry bar
  ctx.textAlign = "left";
  ctx.fillStyle = "#111317";
  ctx.fillRect(12, 12, Math.min(cssWidth - 24, 330), 30);
  ctx.strokeStyle = "#22262e";
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 12, Math.min(cssWidth - 24, 330), 30);

  ctx.fillStyle = "#d1d5db";
  ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  const sigmaStr = (state.volatilitySigmaMilli / 1000).toFixed(2);
  const speedStr = (state.trackSpeedMultiplierMilli / 1000).toFixed(2);
  ctx.fillText(
    `${measuredFps} fps | ${speedStr}x speed | ${sigmaStr}σ | ${Math.floor(state.distanceMeters)}m`,
    20,
    31,
  );

  ctx.restore();
}
