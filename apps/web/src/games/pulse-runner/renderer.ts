import {
  laneToTargetX,
  type PulseRunnerRunState,
  type RunnerLaneId,
} from "./engine";

function projectPoint(
  laneCoord: number, // -1.5 .. +1.5
  z: number, // 1.0 = horizon, 0.0 = bottom edge
  width: number,
  height: number,
): { x: number; y: number; scale: number } {
  const horizonY = height * 0.24;
  const bottomY = height * 0.94;
  // Perspective curve: closer objects expand faster
  const depth = 1 - Math.max(-0.1, Math.min(1.05, z));
  const perspectiveT = depth * depth * 0.65 + depth * 0.35;
  const y = horizonY + (bottomY - horizonY) * perspectiveT;

  const topTrackHalfWidth = width * 0.09;
  const bottomTrackHalfWidth = width * 0.44;
  const halfWidthAtY =
    topTrackHalfWidth + (bottomTrackHalfWidth - topTrackHalfWidth) * perspectiveT;
  const scale = 0.22 + 0.78 * perspectiveT;

  // laneCoord in [-1, 0, +1] maps to center of the 3 lanes; outer edges are [-1.5, +1.5]
  const x = width * 0.5 + (laneCoord / 1.5) * halfWidthAtY;
  return { x, y, scale };
}

function laneAccentColor(lane: RunnerLaneId): string {
  if (lane === "LANE_LEFT") return "#FFB020";
  if (lane === "LANE_CENTER") return "#00D4FF";
  return "#00F59B";
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

  // 1. Deep Void Background (#050609) & Stage Floor (#0A0D14)
  ctx.fillStyle = "#050609";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const horizonY = cssHeight * 0.24;
  ctx.fillStyle = "#080B12";
  ctx.fillRect(0, horizonY, cssWidth, cssHeight - horizonY);

  // Horizon divider & deterministic Pyth volatility pulse line
  ctx.strokeStyle = "rgba(0, 212, 255, 0.28)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const waveAmp = Math.min(18, (state.volatilitySigmaMilli / 1000) * 4.5);
  const phaseShift = reducedMotion ? 0 : state.distanceMeters * 0.08;
  for (let px = 0; px <= cssWidth; px += 12) {
    const wy =
      horizonY -
      10 +
      Math.sin(px * 0.028 + phaseShift) * waveAmp * Math.sin((px / cssWidth) * Math.PI);
    if (px === 0) ctx.moveTo(px, wy);
    else ctx.lineTo(px, wy);
  }
  ctx.stroke();

  // 2. Perspective Track Deck & Active Lane Illumination
  const topLeft = projectPoint(-1.5, 1.0, cssWidth, cssHeight);
  const topRight = projectPoint(1.5, 1.0, cssWidth, cssHeight);
  const botRight = projectPoint(1.5, 0.0, cssWidth, cssHeight);
  const botLeft = projectPoint(-1.5, 0.0, cssWidth, cssHeight);

  ctx.fillStyle = "#0A0D14";
  ctx.beginPath();
  ctx.moveTo(topLeft.x, topLeft.y);
  ctx.lineTo(topRight.x, topRight.y);
  ctx.lineTo(botRight.x, botRight.y);
  ctx.lineTo(botLeft.x, botLeft.y);
  ctx.closePath();
  ctx.fill();

  // Highlight active lane ribbon
  const laneIdx = laneToTargetX(state.activeLane); // -1, 0, +1
  const lTop0 = projectPoint(laneIdx - 0.5, 1.0, cssWidth, cssHeight);
  const lTop1 = projectPoint(laneIdx + 0.5, 1.0, cssWidth, cssHeight);
  const lBot1 = projectPoint(laneIdx + 0.5, 0.0, cssWidth, cssHeight);
  const lBot0 = projectPoint(laneIdx - 0.5, 0.0, cssWidth, cssHeight);

  ctx.fillStyle =
    state.activeLane === "LANE_LEFT"
      ? "rgba(255, 176, 32, 0.09)"
      : state.activeLane === "LANE_CENTER"
        ? "rgba(0, 212, 255, 0.09)"
        : "rgba(0, 245, 155, 0.09)";
  ctx.beginPath();
  ctx.moveTo(lTop0.x, lTop0.y);
  ctx.lineTo(lTop1.x, lTop1.y);
  ctx.lineTo(lBot1.x, lBot1.y);
  ctx.lineTo(lBot0.x, lBot0.y);
  ctx.closePath();
  ctx.fill();

  // Scrolling transverse ties
  const tieOffset = reducedMotion ? 0 : (state.distanceMeters * 0.025) % 0.125;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.065)";
  ctx.lineWidth = 1;
  for (let z = 1.0 - tieOffset; z >= 0.0; z -= 0.125) {
    const pL = projectPoint(-1.5, z, cssWidth, cssHeight);
    const pR = projectPoint(1.5, z, cssWidth, cssHeight);
    ctx.beginPath();
    ctx.moveTo(pL.x, pL.y);
    ctx.lineTo(pR.x, pR.y);
    ctx.stroke();
  }

  // Longitudinal lane rails (-1.5, -0.5, +0.5, +1.5) + colored center guide rails
  const railCoords = [-1.5, -0.5, 0.5, 1.5] as const;
  for (const rc of railCoords) {
    const pTop = projectPoint(rc, 1.0, cssWidth, cssHeight);
    const pBot = projectPoint(rc, 0.0, cssWidth, cssHeight);
    ctx.strokeStyle =
      Math.abs(rc) === 1.5 ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = Math.abs(rc) === 1.5 ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBot.x, pBot.y);
    ctx.stroke();
  }

  // Colored stance centerlines for each of the 3 lanes
  const laneGuides: readonly { coord: number; color: string; label: string }[] = [
    { coord: -1, color: "rgba(255, 176, 32, 0.35)", label: "SHORT -1.0x" },
    { coord: 0, color: "rgba(0, 212, 255, 0.35)", label: "USDC SHIELD" },
    { coord: 1, color: "rgba(0, 245, 155, 0.35)", label: "LONG +1.0x" },
  ];
  for (const g of laneGuides) {
    const pTop = projectPoint(g.coord, 1.0, cssWidth, cssHeight);
    const pBot = projectPoint(g.coord, 0.04, cssWidth, cssHeight);
    ctx.strokeStyle = g.color;
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBot.x, pBot.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Lane floor tag
    const tagPos = projectPoint(g.coord, 0.02, cssWidth, cssHeight);
    ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(g.label, tagPos.x, tagPos.y);
  }

  // 3. Draw Track Obstacles, Boosters & Kalshi Portals (Painter's order: far -> near)
  const sortedObjects = [...state.objects].sort((a, b) => b.z - a.z);
  for (const obj of sortedObjects) {
    if (obj.z < -0.04 || obj.z > 1.02) continue;
    const lx = laneToTargetX(obj.lane);
    const center = projectPoint(lx, obj.z, cssWidth, cssHeight);
    const leftEdge = projectPoint(lx - 0.42, obj.z, cssWidth, cssHeight);
    const rightEdge = projectPoint(lx + 0.42, obj.z, cssWidth, cssHeight);
    const spanW = Math.max(16, rightEdge.x - leftEdge.x);

    if (obj.kind === "LIQUIDATION_BARRIER") {
      const barH = Math.max(12, 38 * center.scale);
      ctx.fillStyle = "rgba(255, 69, 96, 0.22)";
      ctx.strokeStyle = "#FF4560";
      ctx.lineWidth = Math.max(1.4, 2.4 * center.scale);
      ctx.beginPath();
      ctx.rect(center.x - spanW * 0.5, center.y - barH, spanW, barH);
      ctx.fill();
      ctx.stroke();

      // Hazard crossbar
      ctx.fillStyle = "#FF4560";
      ctx.fillRect(center.x - spanW * 0.5, center.y - barH, spanW, Math.max(3, 6 * center.scale));

      if (center.scale > 0.45) {
        ctx.fillStyle = "#FFE4E8";
        ctx.font = `700 ${Math.round(11 * center.scale)}px ui-monospace, SFMono-Regular, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(obj.label, center.x, center.y - barH * 0.32);
      }
    } else if (obj.kind === "MOMENTUM_BOOSTER") {
      const r = Math.max(7, 20 * center.scale);
      const cy = center.y - r * 1.1;
      ctx.fillStyle = "rgba(0, 245, 155, 0.2)";
      ctx.strokeStyle = "#00F59B";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(center.x, cy - r);
      ctx.lineTo(center.x + r, cy);
      ctx.lineTo(center.x, cy + r);
      ctx.lineTo(center.x - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#FFB020";
      ctx.beginPath();
      ctx.arc(center.x, cy, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (obj.kind === "KALSHI_PORTAL") {
      const portalH = Math.max(22, 68 * center.scale);
      ctx.fillStyle = "rgba(0, 212, 255, 0.14)";
      ctx.strokeStyle = "#00D4FF";
      ctx.lineWidth = Math.max(1.5, 2.8 * center.scale);
      ctx.beginPath();
      ctx.rect(center.x - spanW * 0.48, center.y - portalH, spanW * 0.96, portalH);
      ctx.fill();
      ctx.stroke();

      if (center.scale > 0.4) {
        ctx.fillStyle = "#67E8F9";
        ctx.font = `700 ${Math.round(11 * center.scale)}px ui-monospace, SFMono-Regular, monospace`;
        ctx.textAlign = "center";
        ctx.fillText("KALSHI 1.5x", center.x, center.y - portalH * 0.52);
      }
    }
  }

  // 4. Draw Player Interceptor Ship at z = 0.12 using smoothly interpolated visualLaneX
  const shipPos = projectPoint(state.visualLaneX, 0.12, cssWidth, cssHeight);
  const shipColor = laneAccentColor(state.activeLane);
  const shipW = Math.max(26, Math.min(48, cssWidth * 0.055));
  const shipH = shipW * 0.85;

  // Center USDC Shield Bubble
  if (state.activeLane === "LANE_CENTER") {
    ctx.strokeStyle = "rgba(0, 212, 255, 0.65)";
    ctx.fillStyle = "rgba(0, 212, 255, 0.1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(shipPos.x, shipPos.y - shipH * 0.45, shipW * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Kalshi 1.5x Carry Ring
  if (state.kalshiCarryActive) {
    ctx.strokeStyle = "#FFB020";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(shipPos.x, shipPos.y - shipH * 0.45, shipW * 0.94, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ship Hull
  ctx.fillStyle = "#0F172A";
  ctx.strokeStyle = shipColor;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(shipPos.x, shipPos.y - shipH * 1.15);
  ctx.lineTo(shipPos.x + shipW * 0.58, shipPos.y + shipH * 0.1);
  ctx.lineTo(shipPos.x, shipPos.y - shipH * 0.18);
  ctx.lineTo(shipPos.x - shipW * 0.58, shipPos.y + shipH * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Thruster Core
  ctx.fillStyle = shipColor;
  ctx.beginPath();
  ctx.arc(shipPos.x, shipPos.y - shipH * 0.35, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // 5. Crisp Top Canvas Telemetry Overlay
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(10, 13, 20, 0.86)";
  ctx.fillRect(12, 12, Math.min(cssWidth - 24, 340), 34);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 12, Math.min(cssWidth - 24, 340), 34);

  ctx.fillStyle = "#00F59B";
  ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  const sigmaStr = (state.volatilitySigmaMilli / 1000).toFixed(2);
  const speedStr = (state.trackSpeedMultiplierMilli / 1000).toFixed(2);
  ctx.fillText(
    `${measuredFps} FPS · SPEED ${speedStr}x · VOL ${sigmaStr}σ · ${Math.floor(state.distanceMeters)}m`,
    22,
    33,
  );

  // Flash Feedback Toast inside upper stage
  if (state.flash) {
    const bannerW = Math.min(cssWidth - 24, 460);
    const bx = (cssWidth - bannerW) * 0.5;
    const by = 56;
    ctx.fillStyle = "rgba(5, 6, 9, 0.9)";
    ctx.fillRect(bx, by, bannerW, 30);
    ctx.strokeStyle =
      state.flash.tone === "danger"
        ? "#FF4560"
        : state.flash.tone === "cyan"
          ? "#00D4FF"
          : state.flash.tone === "amber"
            ? "#FFB020"
            : "#00F59B";
    ctx.strokeRect(bx, by, bannerW, 30);

    ctx.fillStyle = "#F8FAFC";
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(state.flash.text.slice(0, 58), cssWidth * 0.5, by + 19);
    ctx.textAlign = "left";
  }

  ctx.restore();
}
