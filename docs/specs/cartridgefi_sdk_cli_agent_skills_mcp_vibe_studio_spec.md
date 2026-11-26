# CartridgeFi — Developer Ecosystem Specification (SDK, CLI, Agent Skills, MCP & Vibe Studio)

**Version:** 1.0  
**Date:** November 24, 2026  
**Target Builders:** AI Coding Agents (`Claude Code`, `Cursor`, `Windsurf`, `OpenAI Codex`), Indie & AAA Game Studios (`React`, `Phaser`, `Three.js`, `Unity`, `Godot`), Non-Coding Vibe Creators, and Partner Wallets.

---

## 1. Developer Experience Philosophy: "Zero DeFi Plumbing, Infinite Genres"

A game developer building a *Subway Surfers* runner or a *GTA 6* syndicate game—or a creator prompting Claude Code—should **never** have to write Anchor smart contracts, calculate Pyth fixed-point exponents, manage Kora paymaster nonces, configure 7-chain bridges, or parse Jupiter/DFlow transaction buffers.

CartridgeFi exposes **four progressive creation interfaces**, all compiling down to the exact same audited **CartridgeFi Engine Protocol**:

```
  [1. Web Vibe Studio]       [2. AI Coding Agents]         [3. Game Dev CLI & SDK]      [4. Partner Wallets]
  60-sec browser prompt      `SKILL.md` + `@cartridgefi/mcp` `npx cartridgefi init`     `<CartridgeDeck />`
           \                          |                             /                          /
            +-------------------------+----------------------------+--------------------------+
                                      |
                                      v
              [ CARTRIDGEFI COMPILER & WASM SIMULATION GATE ]
              Validates `CartridgeManifest v2.0`, Leverage/Compliance Bounds,
              Action-to-Market Netting Rules & Creator Fee Vault Splits
                                      |
                                      v
              [ CARTRIDGEFI ON-CHAIN ENGINE (SOLANA + MAGICBLOCK ER/TEE) ]
              7-Chain + Apple Pay Cash | Jupiter + Phoenix + DFlow | 10ms Private Rooms
```

---

## 2. Universal `CartridgeManifest` v2.0 Schema (Multi-Genre Financial Physics)

Unlike simple leaderboard configs, `CartridgeManifest v2.0` introduces **`actionBindings`** and **`sessionEnvelope`**—allowing *any* game mechanic (reflex lanes, territory capture, sports prop calls, portfolio drafts) to drive real or paper market stances safely:

```json
{
  "$schema": "https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json",
  "manifestVersion": "2.0.0",
  "metadata": {
    "slug": "pulse-runner-nvda-sol",
    "title": "Pulse Runner: AI & Crypto Volatility Sprint",
    "genre": "ARCADE_RUNNER",
    "engineTarget": "PHASER_3",
    "creatorWallet": "Crtr111111111111111111111111111111111111111",
    "creatorFeeShareBps": 5000
  },
  "onboardingAndSession": {
    "allowPaperMode": true,
    "allowLiveMode": true,
    "supportedDepositChains": ["solana", "base", "ethereum", "arbitrum", "bnb", "monad", "polygon"],
    "applePayEnabled": true,
    "liveSessionEnvelopeUsdc": { "min": 10, "max": 250, "maxLeverage": 3 }
  },
  "magicblockRoomConfig": {
    "tickIntervalMs": 10,
    "durationSecs": 120,
    "shardCapacity": 200,
    "privacyMode": "PRIVATE_TEE_FOG_OF_WAR",
    "showdownUnsealSecs": 15,
    "vrfUsage": "PROCEDURAL_TRACK_SEED_AND_TIEBREAK"
  },
  "marketUniverse": [
    { "alias": "PRIMARY_PERP", "venue": "PHOENIX_PERP", "symbol": "SOL-PERP", "pythFeedId": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
    { "alias": "TECH_EQUITY", "venue": "JUPITER_XSTOCKS", "symbol": "NVDAx", "mint": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
    { "alias": "MACRO_GATE", "venue": "DFLOW_KALSHI", "marketId": "KALSHI-FED-DEC26-CUT" }
  ],
  "actionBindings": [
    {
      "gameEvent": "PLAYER_LANE_SWITCH",
      "bindingType": "CONTINUOUS_STANCE_VECTOR",
      "mapping": {
        "LANE_LEFT":   { "asset": "PRIMARY_PERP", "weight": -1.0 },
        "LANE_CENTER": { "asset": "USDC_SHIELD",  "weight":  0.0 },
        "LANE_RIGHT":  { "asset": "PRIMARY_PERP", "weight":  1.0 }
      },
      "nettingPolicy": "NET_AT_CHECKPOINTS_30S"
    },
    {
      "gameEvent": "PORTAL_GATE_PASS",
      "bindingType": "BINARY_OUTCOME_CALL",
      "asset": "MACRO_GATE",
      "scoreCarryMultiplier": 1.35
    }
  ],
  "scoringAndPrizes": {
    "primaryFormula": "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL",
    "prizeCurve": "TOP_20_PERCENT_SHAPLEY",
    "claimMenuAssets": ["NVDAx", "SPYx", "USDC"]
  }
}
```

---

## 3. CartridgeFi Agent Skill Specification (`SKILL.md`)

Developers using **Claude Code, Cursor, Windsurf, or OpenAI Codex** install CartridgeFi's official agent skill in one command:

```bash
npx skills add https://github.com/cartridgefi/agent-skill
```

### Directory Layout of `cartridgefi/agent-skill`
```
cartridgefi-skill/
├── SKILL.md                           # Core mental model, strict safety invariants & workflow
├── references/
│   ├── 01-bored-gameday-arena.md      # Pattern for RFS #11 Game-Day & Conviction Arenas (React/Next.js)
│   ├── 02-arcade-runner-phaser.md     # Pattern for Subway Surfers / reflex lane games (Phaser 3 / Canvas)
│   ├── 03-openworld-syndicate-3d.md   # Pattern for GTA-style sector turf & TEE crew heists (Three.js / Unity)
│   ├── 04-omnichain-fiat-auth.md      # 7-Chain + Apple Pay + Passkey + Kora session key drop-in setup
│   └── 05-compliance-hard-rules.md    # Mandatory FCA/SEC/Gambling rules agents MUST enforce
└── templates/
    ├── manifest.gameday.json
    ├── manifest.runner.json
    └── manifest.syndicate.json
```

### Core Directives Encoded Inside `SKILL.md`
1. **Never Generate Custom Custody or Vault Contracts:** Instructs the coding agent to *never* write raw Rust token-escrow code; instead, emit a validated `CartridgeManifest v2.0` and bind client gameplay events via `@cartridgefi/sdk` to CartridgeFi's audited program IDs.
2. **60fps Render Loop Separation:** Enforces subscribing to `cartridge.onWorldTick()` inside `requestAnimationFrame` / Phaser `update()` loops while routing `cartridge.emitGameAction(...)` over the zero-popup MagicBlock ER session channel.
3. **Mandatory Market-Driven World Physics:** Teaches the agent how to bind live Pyth volatility ($\sigma$), spread, and price velocity directly to enemy spawn rates, track speed, weather storms, or district yields so the game *feels* alive with the real market.
4. **Automatic Revenue Attribution:** Requires setting `creatorWallet` in every generated manifest so the user building the game automatically earns $50\%$ of net venue builder fees.

---

## 4. CartridgeFi MCP Server Specification (`@cartridgefi/mcp`)

Adding `@cartridgefi/mcp` to Claude Desktop, Claude Code, or Cursor connects the developer's AI directly to live Solana/MagicBlock state and the CartridgeFi compiler:

```json
{
  "mcpServers": {
    "cartridgefi": {
      "command": "npx",
      "args": ["-y", "@cartridgefi/mcp@latest"],
      "env": {
        "CARTRIDGEFI_API_KEY": "cf_live_...",
        "CARTRIDGEFI_NETWORK": "devnet"
      }
    }
  }
}
```

### Exposed MCP Tools & Resources

| MCP Tool Name | Input Parameters | What It Executes & Returns to the AI Agent |
| :--- | :--- | :--- |
| `discover_live_markets` | `{ category?: "xstocks" \| "perps" \| "kalshi", query?: string }` | Returns verified live mints, Pyth Lazer feed IDs, DFlow/Kalshi market IDs, current 24h liquidity, and builder-fee bps so agents never hallucinate dead addresses. |
| `scaffold_game_manifest` | `{ prompt: string, genre: string, creatorWallet: string }` | Generates a schema-valid `CartridgeManifest v2.0` tailored to the user's game concept and checks compliance rules automatically. |
| `simulate_cartridge_economy` | `{ manifestJson: object, volatilityRegime: "calm" \| "crash_vix35" }` | Runs 500 synthetic ticks through CartridgeFi's WASM `borel-scoring` engine; returns score distribution, payout conservation proof, and estimated creator fee yield. |
| `register_and_deploy_room` | `{ manifestJson: object, network: "devnet" \| "mainnet-beta" }` | Mints `CartridgeManifestAccount` on Solana, delegates an active `RoomShard` on MagicBlock ER/Private TEE, and returns the live `roomId` + playable preview URL. |
| `generate_engine_binding` | `{ roomId: string, framework: "react" \| "phaser" \| "threejs" \| "unity" }` | Outputs exact copy-paste TypeScript/C# client initialization code pre-wired to the deployed `roomId`, 7-chain cashier modal, and session signer. |
| `inspect_creator_earnings` | `{ creatorWallet: string }` | Queries real-time routed volume, active players across shards, and claimable USDC in the creator's `creatorFeeVault`. |

---

## 5. Multi-Engine SDK & CLI Ergonomics (`@cartridgefi/sdk` & `cartridgefi` CLI)

### 5.1 One-Command CLI Workflow
```bash
# Scaffold Borel-style Arena, Subway-style Phaser Runner, or Three.js Open-World Turf game
npx cartridgefi init my-market-runner --template phaser-volatility-runner

# Start local LiteSVM + Mock Pyth Crash Replay + Local ER Emulator (<2s boot)
cd my-market-runner && npx cartridgefi dev --replay-tape nvda-earnings-nov26

# Run WASM formal scoring & compliance check, then publish to CartridgeFi Registry
npx cartridgefi publish --network mainnet-beta --creator-wallet <PUBKEY>
```

### 5.2 Clean Multi-Genre SDK Usage (Example: Binding a *Subway Surfers* Runner in 18 Lines)
```typescript
import { CartridgeClient, CashModal } from "@cartridgefi/sdk";

const cartridge = await CartridgeClient.connect({
  cartridgeSlug: "pulse-runner-nvda-sol",
  partnerId: "first-party-studio", // Or third-party wallet ID for 40% split
});

// 1. Fomo-grade Passkey + 7-Chain / Apple Pay Unified Cash Modal (if Live Mode selected)
await CashModal.ensureSessionReady(cartridge, { mode: "PAPER_OR_LIVE", suggestedEnvelopeUsdc: 20 });

// 2. Drive 60fps game obstacles deterministically from live Pyth market telemetry
cartridge.onMarketPulse(({ symbol, velocityBps, volatilitySigma, rankDelta, phase }) => {
  gameScene.setTrackSpeed(1.0 + Math.abs(velocityBps) * 0.05);
  if (volatilitySigma > 2.5) gameScene.spawnLiquidationTrain();
  hud.updateLiveRank(rankDelta, { isFogOfWar: phase === "FOG_OF_WAR" });
});

// 3. Zero-popup, 0-gas 10ms MagicBlock Private ER action emission on lane swipe
playerController.onSwipe((lane: "LANE_LEFT" | "LANE_CENTER" | "LANE_RIGHT") => {
  cartridge.emitAction("PLAYER_LANE_SWITCH", { state: lane });
});
```

---

## 6. Hosted Web Vibe-Coding Studio Architecture

For non-developers, trading KOLs, and sports communities who never open an IDE:
1. **Prompt & Genre Picker:** User visits `studio.cartridgefi.com`, selects a base chassis (*Borel Game-Day Arena*, *Pulse 3-Lane Runner*, *Sector Turf Map*, or *Macro Bracket*), and writes any creative twist (*"Cyberpunk Tokyo theme; players surf TSLAx and BTC waves during US market open; winners get TSLAx"*).
2. **Parallel Generation (`< 6 seconds`):**
   * Worker A compiles and WASM-verifies the `CartridgeManifest v2.0`.
   * Worker B generates declarative theme tokens, procedural shaders/spritesheets, and HUD layout JSON inside our locked CSP sandbox (`*.play.cartridgefi.com`).
3. **Instant Distribution Everywhere:** Publishing mints a unique Cartridge ID that is **immediately playable on Web, mobile browsers, Telegram Mini-Apps, and inside every partner wallet running `<CartridgeDeck/>`**.