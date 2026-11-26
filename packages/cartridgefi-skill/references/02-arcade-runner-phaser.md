# Pattern 02 — 3-Lane Arcade Volatility Runner (`ARCADE_RUNNER` · Phaser 3/4)

## When to Use
Use `ARCADE_RUNNER` for high-tempo 60fps reflex games (*Subway Surfers* / *Pulse Runner* style) where spatial lane choices map to market stances without ever triggering predatory per-swipe DEX swaps.

## Stance Mapping & 30-Second Checkpoint Netting
- `LANE_LEFT`: `-10_000 bps` (`-1.0x` Short `PRIMARY_PERP`)
- `LANE_CENTER`: `0 bps` (`USDC_SHIELD` neutral shelter during high-sigma volatility spikes)
- `LANE_RIGHT`: `+10_000 bps` (`+1.0x` Long `PRIMARY_PERP`)
- `nettingPolicy`: `"NET_AT_CHECKPOINTS_30S"` — `StanceNettingEngine` records every 60fps swipe on the Ephemeral Rollup for drawdown-penalized Sharpe scoring (`DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL`) while collapsing hundreds of lane switches into a single netted venue delta at 30-second checkpoints.

## Render Loop Separation Pattern
Keep Phaser's `update(time, delta)` loop 100% synchronous by caching telemetry from `onMarketPulse`:

```ts
import { CartridgeClient, CashModal } from "@cartridgefi/sdk";

export async function createPhaserMarketBridge() {
  const cartridge = await CartridgeClient.connect({
    cartridgeSlug: "pulse-runner-nvda-sol",
    mode: "PAPER",
  });

  await CashModal.ensureSessionReady(cartridge, {
    mode: "PAPER_OR_LIVE",
    suggestedEnvelopeUsdc: 20,
  });

  const worldState = {
    speedScaleMilli: 1_000,
    volatilityStormActive: false,
    isFogOfWar: true,
  };

  const unsubscribe = cartridge.onMarketPulse((pulse) => {
    worldState.speedScaleMilli = 1_000 + Math.min(2_000, Math.abs(pulse.velocityBps) * 25);
    worldState.volatilityStormActive = pulse.volatilitySigmaMilli >= 2_500;
    worldState.isFogOfWar = pulse.isFogEncrypted;
  });

  return {
    worldState,
    swipeLane: (lane: "LANE_LEFT" | "LANE_CENTER" | "LANE_RIGHT") =>
      cartridge.emitAction("PLAYER_LANE_SWITCH", { state: lane }),
    passMacroGate: (call: "YES" | "NO") =>
      cartridge.emitAction("PORTAL_GATE_PASS", { call }),
    destroy: () => {
      unsubscribe();
      cartridge.disconnect();
    },
  };
}
```
