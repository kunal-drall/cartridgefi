---
name: cartridgefi
description: Build multi-genre real-market games on Solana and MagicBlock Ephemeral Rollups (ER and Private TEE) using CartridgeManifest v2.0, @cartridgefi/sdk, @cartridgefi/react, cartridgefi CLI, and @cartridgefi/mcp without writing custom custody smart contracts.
license: MIT
compatibility: Requires Node.js >= 22.20.0, TypeScript 5.8+, @cartridgefi/sdk 2.0+
metadata:
  author: cartridgefi
  version: "2.0.0"
---

# CartridgeFi Agent Skill (`v2.0.0`)

Use this skill whenever a developer or studio asks to build, scaffold, integrate, simulate, or deploy a real-market multiplayer game, Game-Day conviction arena, 3-lane arcade volatility runner, 3D sector turf heist, prediction bracket, or partner wallet game embed on **Solana** and **MagicBlock Ephemeral Rollups (ER / Private TEE)**.

---

## 1. Core Architectural Mental Model

CartridgeFi is the universal **Entertainment Finance Game Engine** on Solana. Any game genre compiles down to a single parameterized `CartridgeManifest v2.0` JSON artifact and executes against CartridgeFi's four audited on-chain programs:

- **Cartridge Registry (`5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr`)**: Stores `EngineConfig`, TVL safety caps, and `CartridgeManifestAccount` PDAs (`seeds = [b"cartridge", slug_hash]`).
- **Cartridge ER Room (`Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR`)**: Delegated to MagicBlock Ephemeral Rollups (`DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`) with Private ER TEE hardware-encrypted Fog-of-War (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`) and `< 10 ms` VRF (`Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`).
- **Cartridge Vault Router (`6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT`)**: Non-custodial canonical Solana `USDC` (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) escrow, Shapley podium settlement, builder fee splits, and Claim-Time `xStocks` swaps (`NVDAx`, `ANTx`, `SPYx`, `TSLAx`) via Jupiter.
- **Cartridge Passport (`5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr`)**: Portable cross-game Market ELO (`10^9` fixed-point `i128`) and jurisdiction eligibility bitmask.

---

## 2. Four Non-Negotiable Agent Directives

### Directive 1 — Never Generate Custom Custody Contracts
- **NEVER** write custom Rust/Anchor SPL token vaults, escrow PDAs, or ad-hoc payout splitters for user-generated games.
- **ALWAYS** express game economics as a validated `CartridgeManifest v2.0` JSON file and connect the frontend/engine via `@cartridgefi/sdk` (`CartridgeClient.connect`) or `@cartridgefi/react` (`<CartridgeDeck />`).
- **NEVER** authorize SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) or `cartridge-vault-router` withdrawal instructions on an ephemeral session key. `MagicBlockSessionSigner` is strictly scoped to gameplay stance instructions on `cartridge-er-room`.

### Directive 2 — 60fps Render Loop Separation
- **NEVER** block `requestAnimationFrame`, Phaser `update()`, or Three.js render loops on RPC calls or wallet signature popups.
- Subscribe to 48-byte binary `WorldPulseFrame` ticks via `cartridge.onWorldTick(frame => ...)` or `cartridge.onMarketPulse(pulse => ...)` to update local scene state synchronously at 60fps.
- Emit player inputs (`PLAYER_LANE_SWITCH`, `SUBMIT_CONVICTION_WEIGHTS`, `CALL_KALSHI_CATALYST`, `CLAIM_DISTRICT_TURF`) via `cartridge.emitAction(...)`. Actions are signed in `< 1 ms` by WebCrypto Ed25519 session keys and buffered by `StanceNettingEngine` (`NET_AT_CHECKPOINTS_30S` or `NET_ON_ENTRY_AND_SETTLEMENT`) to prevent predatory swap churn.

### Directive 3 — Mandatory Market-Driven World Physics
- Every CartridgeFi game must bind live integer Pyth oracle telemetry (`price8`, `velocityBps`, `volatilitySigmaMilli`) directly into gameplay physics:
  - **Velocity (`velocityBps`)**: Modulates runner track speed, boost pads, or momentum timers.
  - **Volatility (`volatilitySigmaMilli`)**: Triggers storm shaders, liquidation obstacles, or boss phases when `volatilitySigmaMilli >= 2400` (`2.400σ`).
  - **Fog-of-War (`isFogEncrypted`)**: Keeps rival conviction weights sealed inside MagicBlock Private ER TEE for the first `75%` of the match before unsealing in the final `15s` Showdown (`cartridge.triggerShowdownUnseal()`).
- **Zero Floating-Point Money/Score Math**: Use `bigint` scaled by `FP_SCALE = 1_000_000_000n` (`10^9`), `USDC_UNIT = 1_000_000n` (`10^6`), and integer basis points (`10_000n`) for all balances, weights, and payouts.

### Directive 4 — Automatic 50% Creator Revenue Attribution
- **ALWAYS** populate `metadata.creatorWallet` with the builder's Solana public key and `metadata.creatorFeeShareBps: 5000` in every generated manifest so the creator automatically earns **50%** of net venue builder fees (`5000 / 5000 bps` split with CartridgeFi Engine).
- When embedding inside a partner wallet (`Solflare`, `Phantom`, `Backpack`) via `<CartridgeDeck partnerFeeVault="..." />`, the protocol automatically activates the **40% Partner Wallet / 30% Creator / 30% CartridgeFi Engine** (`4000 / 3000 / 3000 bps`) revenue split.

---

## 3. Recommended Agent Workflow (`@cartridgefi/mcp` + CLI)

When connected to `@cartridgefi/mcp`, execute tools in this order:
1. Call `discover_live_markets` to retrieve verified canonical mints (`NVDAx`, `SPYx`, `ANTx`, `TSLAx`), Phoenix/Jupiter perps (`SOL-PERP`, `BTC-PERP`), and DFlow/Kalshi market IDs (`KALSHI-FED-DEC26-CUT`).
2. Call `compile_cartridge_manifest` with the user's `prompt`, `genre`, and `creatorWallet` to produce a compliance-checked `CartridgeManifest v2.0`.
3. Call `simulate_cartridge_wasm` under both `calm` and `crash_vix35` regimes (500 ticks) to prove `payoutConservationVerified === true`.
4. Call `deploy_cartridge_onchain` (`network: "devnet"`) to derive canonical `CartridgeManifestAccount` and `RoomShard` PDAs and register an active room.
5. Call `generate_framework_binding` (`react`, `phaser`, `threejs`, or `unity`) to emit pre-wired client code.
6. Call `inspect_creator_vault` to verify creator vault PDA and revenue attribution.

Without MCP, use the `cartridgefi` CLI:
```bash
npx cartridgefi init my-game --template phaser-volatility-runner --creator-wallet <PUBKEY>
npx cartridgefi simulate ./my-game/cartridge.manifest.json --regime crash_vix35
npx cartridgefi dev --replay-tape nvda-earnings-nov26 --ticks 20
npx cartridgefi publish ./my-game/cartridge.manifest.json --network devnet
```

---

## 4. Reference Guides & Starter Templates

Load the matching genre reference and manifest template before writing game code:

- **Borel Game-Day & Blind Conviction Arena (`React` / `Next.js`)**: [references/01-borel-gameday-arena.md](references/01-borel-gameday-arena.md) · Template: [templates/manifest.gameday.json](templates/manifest.gameday.json)
- **3-Lane Arcade Volatility Runner (`Phaser 3/4` / `Canvas`)**: [references/02-arcade-runner-phaser.md](references/02-arcade-runner-phaser.md) · Template: [templates/manifest.runner.json](templates/manifest.runner.json)
- **3D Sector Turf & Private TEE Crew Heist (`Three.js` / `Unity`)**: [references/03-openworld-syndicate-3d.md](references/03-openworld-syndicate-3d.md) · Template: [templates/manifest.syndicate.json](templates/manifest.syndicate.json)
- **7-Chain USDC Cashier, Apple Pay, Passkeys & Session Keys**: [references/04-omnichain-fiat-auth.md](references/04-omnichain-fiat-auth.md)
- **FCA / SEC / Anti-Casino Compliance Hard Rules**: [references/05-compliance-hard-rules.md](references/05-compliance-hard-rules.md)
