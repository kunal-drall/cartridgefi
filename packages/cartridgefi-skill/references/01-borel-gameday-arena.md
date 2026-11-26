# Pattern 01 — Borel Game-Day & Blind Conviction Arena (`BOREL_GAMEDAY`)

## When to Use
Use `BOREL_GAMEDAY` for 60-second to matchday multiplayer arenas uniting **DFlow / Kalshi** binary event catalysts, **Phoenix / Jupiter** perpetuals (`<= 5x`), and **Jupiter xStocks** (`NVDAx`, `ANTx`, `SPYx`) inside **MagicBlock Private ER TEE Fog-of-War**.

## Core Loop
1. **Lobby & Session Bootstrap (`T = 0s`)**: Connect via `CartridgeClient.connect` or drop in `<CartridgeDeck />` from `@cartridgefi/react`. Ensure canonical Solana USDC session readiness via `CashModal.ensureSessionReady`.
2. **Blind Conviction Phase (`First 75%` · `fogOfWarBps = 7500`)**: Players submit normalized integer basis-point conviction vectors (`sum(|weightsBps[i]|) <= 10_000`) via `SUBMIT_CONVICTION_WEIGHTS` and optional `CALL_KALSHI_CATALYST` (`13_500 bps = 1.35x` carry multiplier). Rival weights remain sealed inside `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`.
3. **Live Showdown Unseal (`Final 15s` · `showdownUnsealSecs = 15`)**: Call `cartridge.triggerShowdownUnseal()` to transition the room to `SHOWDOWN`, reveal rival allocations with 3D `<ShowdownFlipCard />`, and verify tie-breaks via MagicBlock VRF.
4. **Earned Stock Vault Settlement**: Winners call `cartridge.claimStockPrize("NVDAx")` (or `"ANTx"`, `"SPYx"`, `"USDC"`). Restricted jurisdictions automatically receive canonical `USDC`.

## Minimal Drop-In React & Partner Wallet Embed (12 Lines)
```tsx
import { CartridgeDeck } from "@cartridgefi/react";

export function GameDayStage() {
  return (
    <CartridgeDeck
      partnerId="solflare-mobile"
      partnerFeeVault="FRLBDfWhskqdGsoNkBMsnxHtQTy6Bkm25NEvsVncGAay"
      defaultCartridgeSlug="borel-macro-blitz-001"
      defaultFrameMode="solflare"
    />
  );
}
```

## Direct SDK Integration
```ts
import { CartridgeClient, CashModal } from "@cartridgefi/sdk";

const client = await CartridgeClient.connect({
  cartridgeSlug: "borel-macro-blitz-001",
  mode: "PAPER",
});

await CashModal.ensureSessionReady(client, { mode: "PAPER_OR_LIVE", suggestedEnvelopeUsdc: 25 });

await client.emitAction("SUBMIT_CONVICTION_WEIGHTS", {
  weightsBps: [5_000, 3_500, 1_500, 0],
  kalshiBinaryCall: 2,
  kalshiProbBps: 6_400,
});
```
