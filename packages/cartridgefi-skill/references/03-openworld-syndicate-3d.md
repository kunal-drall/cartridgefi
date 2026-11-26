# Pattern 03 — 3D Open-World Syndicate Turf & TEE Crew Heist (`SYNDICATE_TURF`)

## When to Use
Use `SYNDICATE_TURF` for Three.js, React Three Fiber, or Unity WebGL district-control and crew-heist games where city sectors correspond to real-market equities (`NVDAx` Silicon Coast, `ANTx` Frontier Tower, `SPYx` Index Financial District) and macro catalysts (`KALSHI-FED-DEC26-CUT`).

## Key Mechanics
- **Binding Type**: `SECTOR_TURF_CAPTURE` with `nettingPolicy: "NET_ON_ENTRY_AND_SETTLEMENT"`.
- **Private ER TEE Fog-of-War (`fogOfWarBps: 8000`)**: Rival syndicate turf allocations stay encrypted inside Intel TDX (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`) for the first 8 minutes of a 10-minute heist, preventing rival crews from front-running sector rotations before the final 30-second Showdown.
- **Composite Scoring**: `MULTI_STAGE_CARRY_COMPOSITE` combines macro catalyst Brier accuracy with direction-neutral equity alpha.

## Three.js Integration Pattern
```ts
import { CartridgeClient } from "@cartridgefi/sdk";

const client = await CartridgeClient.connect({
  cartridgeSlug: "vice-bourse-syndicate",
  mode: "PAPER",
});

// Drive 3D volumetric rain/neon bloom from integer volatilitySigmaMilli
const stopTicks = client.onWorldTick((frame) => {
  const bloomMilli = frame.volatilitySigmaMilli; // e.g. 2650 = 2.650 sigma
  void bloomMilli;
});

// Capture District 0 (Silicon Coast -> NVDAx) with 80% conviction (8000 bps)
await client.emitAction("CLAIM_DISTRICT_TURF", {
  districtIndex: 0,
  convictionBps: 8_000,
});

// Clean up on scene unmount
stopTicks();
client.disconnect();
```
