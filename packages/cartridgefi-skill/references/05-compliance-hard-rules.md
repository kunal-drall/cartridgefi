# Pattern 05 — FCA / SEC DEP / Anti-Casino Compliance Hard Rules

Every `CartridgeManifest v2.0` compiled by an AI agent, CLI, or Web Vibe Studio passes through `validateManifestCompliance(manifest, sourcePrompt)`. Violating any rule below triggers a hard build/deploy rejection:

## 1. Zero Gambling or Dark-Pattern Mechanics
- **Hard-Blocked Mechanics**: Paid loot boxes (`loot box`), roulette, slot machines, casino jackpots, paid mystery spins (`paid spin`), double-or-nothing spins, and predatory `trade streak nudge` prompts.
- **Permitted VRF Usage**: MagicBlock VRF (`Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`) may **only** be used for procedural obstacle/weather seeding (`PROCEDURAL_TRACK_SEED_AND_TIEBREAK`) and exact score tie-breaking or free non-wagered bonus drops (`TIEBREAK_AND_FREE_BONUS_DROP`). Paid entry pools are always distributed strictly by deterministic skill formulas (`DIRECTION_NEUTRAL_REL_RETURN`, `DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL`, `KALSHI_BRIER_CALIBRATION`, `MULTI_STAGE_CARRY_COMPOSITE`).

## 2. Hard Financial & Risk Ceilings
- **Max Leverage**: `liveSessionEnvelopeUsdc.maxLeverage` must be an integer in `[1, 5]`. Prompts or manifests requesting `> 5x` (e.g., `20x`, `50x`, `100x`) are rejected immediately.
- **Session Envelope Bounds**: `1 <= minUsdc <= maxUsdc <= 500` USDC (`500_000_000` atomic units per room pool in private beta).
- **Creator Fee Cap**: `metadata.creatorFeeShareBps` must be in `[0, 5000]` (`<= 50%` of net builder fee).
- **Shard Capacity & Showdown Window**: `2 <= shardCapacity <= 200`, and `showdownUnsealSecs < durationSecs`.

## 3. Mandatory Universal `USDC` Geo-Safe Fallback
- `scoringAndPrizes.claimMenuAssets` **must always include `"USDC"`** alongside any tokenized equities (`"NVDAx"`, `"ANTx"`, `"SPYx"`, `"TSLAx"`).
- At claim time, `claimStockPrize` checks the winner's `MarketPassport` eligibility bitmask (`GEO_ELIGIBLE | CAN_CLAIM_XSTOCKS`); if absent, the prize settles 100% into canonical Solana `USDC` automatically without failing settlement.
