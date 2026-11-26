# Product Requirements Document (PRD) — CartridgeFi Engine, Borel & Studio Ecosystem

**Version:** 2.0 (Unified Engine + First-Party Studio Architecture)  
**Date:** November 24, 2026  
**Product Hierarchy:** **CartridgeFi** (Core Financial Game Engine, 7-Chain Wallet, SDK/MCP/Vibe Studio) $\rightarrow$ **Borel** (First-Party Flagship Game #001) + **Genre Reference Games (#002, #003)** + **Third-Party Ecosystem**

---

## 1. Product Vision & Problem Statement

Game developers want real-money excitement, high retention, and instant monetization without spending 12 months building wallet infrastructure, DeFi exchange integrations, or regulatory compliance. Meanwhile, retail traders want fun, social, skill-based ways to engage with stocks, perps, and prediction markets without staring at intimidating order books or getting wiped out by 50x liquidations and copy-trading bots.

**CartridgeFi** bridges both worlds as **the Entertainment Finance Game Engine on Solana**:
* **For Players:** One unified USD cash and stock-vault account (funded via Apple Pay, Google Pay, debit card, or crypto from 7 chains, settled invisibly on Solana) with a portable **Market ELO** identity across dozens of addictive skill games—starting with **Borel**.
* **For Developers, AI Coding Agents & Vibe-Coders:** A complete financial physics and monetization engine (`SDK`, `CLI`, `SKILL.md`, `MCP`, and `Web Vibe Studio`) that binds in-game actions—lane switches, turf captures, sniper shots, sports calls, or portfolio drafts—safely to live tokenized equities, perpetuals, and prediction markets.
* **For Wallets & Venues:** Drop-in `<CartridgeDeck/>` components turning any wallet into an Entertainment Finance arcade sharing $40\%\text{--}50\%$ of routed order-flow fees.

---

## 2. Core Engine Innovation: The "Action-to-Market Binding" & Session Risk Envelope

The hardest design challenge in Entertainment Finance is **how an arcade game (like *Subway Surfers*) or an open-world game (like *GTA 6*) connects to real perps, stocks, and prediction markets without bankrupting users on transaction churn or violating FCA/SEC gamification rules**.

CartridgeFi solves this at the engine level through three mandatory primitives:

1. **Pre-Approved Session Risk Envelopes (Zero Mid-Game Popups, Bounded Risk):**
   * Before entering a game session, the player selects either:
     * **Free Paper Mode:** $0$ capital at risk, plays with virtual Stance Units, competes for Market ELO and sponsor/ad-funded fractional stock pools.
     * **Live Conviction Envelope:** Player authorizes a strict maximum session exposure (e.g., $\text{USDC } 25$ with hard leverage ceiling $\le 5\times$) via an ephemeral MagicBlock Session Key. A player can *never* lose more than their chosen Session Envelope, and zero wallet popups interrupt gameplay.
2. **Real-Time ER Stance Netting (Game Speed $\neq$ Order Spam):**
   * Inside a fast game ($60\text{ fps}$), in-game actions (dodging left, capturing a zone, hitting a boost gate) update the player's **Stance Vector** at $10\text{ ms}$ inside a zero-fee **MagicBlock Ephemeral Rollup** (or encrypted **Private ER TEE**).
   * CartridgeFi's **Stance Netting Engine** translates continuous gameplay skill into **clean, netted non-custodial venue executions** at defined checkpoint intervals or session entry/settlement—eliminating predatory swap churn while generating genuine hedged/directional volume on Jupiter, Phoenix, and DFlow.
3. **Skill-First, Direction-Neutral Scoring:**
   * Every CartridgeFi game scores players on **measurable skill** (timing precision, relative benchmark outperformance, drawdown control, Brier forecast calibration) so skilled players win in both bull rallies and market crashes.

---

## 3. First-Party Studio Slate: Borel (Game #001) + Genre Proof Titles

To prove CartridgeFi powers *any* creative vision, our studio ships **Borel** as our flagship daily habit product alongside two genre-defining reference cartridges that external builders can play and fork:

| Title | Genre & Inspiration | Core Gameplay & Market Binding | Solana RFS & Venue Showcase |
| :--- | :--- | :--- | :--- |
| **Game #001: BOREL** *(Flagship Daily Habit — P0)* | **Live Game-Day & Tactical Conviction Arena** (*Fantasy Sports $\times$ Bloomberg Terminal $\times$ Poker Showdown*) | • **Game-Day Mode:** One live multiplayer screen uniting open Kalshi predictions, correlated perps, and tokenized stocks during macro prints, IPOs, and sports matches.<br>• **Blind Conviction Blitz ($60\text{ s}$ / $5\text{ m}$):** Allocate $100$ conviction chips across Long/Short/Shock; rival plays stay encrypted inside **MagicBlock Private ER TEE ("Fog of War")** for the first $75\%$ of the clock before dramatically unsealing in the final **$15\text{-second}$ Showdown**. | **RFS #11** (Game-Day Mode)<br>**RFS #3** (Earned Stock Vault: `NVDAx`, `SPYx`, `ANTx`)<br>**RFS #7** (Jupiter, Phoenix, DFlow) |
| **Game #002: PULSE RUNNER** *(Arcade Reference — P0 Prototype / P1 Full)* | **3-Lane Reflex Volatility Runner** (*Subway Surfers $\times$ Live Perps & xStocks*) | • Player sprints down a neon 3-lane track synced to live $1\text{ ms}$ Pyth price feeds (`SOL`, `BTC`, `NVDAx`).<br>• **Left Lane = Short Stance**, **Center Lane = Neutral USDC Shield**, **Right Lane = Long Stance**.<br>• Real-time market volatility spikes spawn red liquidation barriers and golden momentum rails; collectible **Kalshi Gate Portals** let runners call binary macro outcomes mid-run for a $1.5\times$ skill multiplier. | Proves reflex/casual mobile gamers can express directional & volatility market skill effortlessly. |
| **Game #003: VICE BOURSE** *(Open-World Syndicate Reference — P2)* | **Top-Down / 3D Turf & Heist Economy** (*GTA 6 Turf Wars $\times$ Sector Stocks & Event Contracts*) | • City map divided into live market districts (*Silicon Coast = `NVDAx`/`ANTx`*, *Rockstar Strip = `TTWO`*, *Fed Reserve Plaza = `Kalshi Rates`*).<br>• Crews stake district control backed by real tokenized-stock baskets, defend turf during live market hours, and launch **10-minute Private TEE Vault Heists** where rival syndicates try to out-predict live volatility moves without seeing each other's positions. | Proves deep social/clan open-world economies can run natively on CartridgeFi's SDK & TEEs. |

---

## 4. Functional Requirements Matrix

### Module A: CartridgeFi Universal Wallet, 7-Chain Cash & Venue Engine

| ID | Requirement | Priority | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **CF-1.1** | **Passkey + Fiat Instant Onboarding** | **P0** | 1-tap sign-in via Apple ID, Google, or WebAuthn Passkey (embedded self-custody) + external Solana wallet support. Instant Apple Pay, Google Pay, and Debit Card top-ups (`USD 10` min) straight into Unified Solana `USDC`. |
| **CF-1.2** | **Fomo-Grade 7-Chain Deposit Abstraction** | **P0** | Accept deposits from **Solana, Ethereum, Base, Arbitrum, BNB Chain, Monad, and Polygon**. Auto-bridge and settle incoming `USDC`/`ETH`/`SOL`/`BNB` into canonical **Solana `USDC`** in $\le 4\text{ seconds}$ via intent solvers, presenting a single **Unified Cash Balance** across all CartridgeFi games. |
| **CF-1.3** | **Gasless Kora + MagicBlock Session Engine** | **P0** | Sponsor $100\%$ of Solana L1 delegation/settlement gas via Kora paymaster (reimbursed silently in bps/USDC) and execute all in-game ticks at $0$ fee inside MagicBlock ERs with **zero mid-game wallet popups**. |
| **CF-1.4** | **Unified Multi-Venue Execution Router** | **P0** | Pre-integrated non-custodial adapters for **Tokenized Equities** (`xStocks`, `Backpack` via Jupiter Swap V2 `/order` referral fees), **Perpetuals** (`Jupiter Perps`, `Phoenix` Rise builder codes capped at $\le 5\times$), and **Prediction Markets** (`DFlow` Kalshi SPL Yes/No contracts). |
| **CF-1.5** | **Earned Stock Vault & Claim Menu (`RFS #3`)** | **P0** | Hold prize pools in `USDC` (zero bear-market inventory decay). Eligible non-US/UK/CA/AU winners claim prizes in their choice of event stock (`NVDAx`, `ANTx`, `TTWO`), index (`SPYx`), or `USDC` into a unified **Earned Stock Vault** visible across every CartridgeFi game. |
| **CF-1.6** | **Portable Cross-Game Market ELO Passport** | **P1** | Track unified player skill ratings (*Timing*, *Forecasting Brier*, *Risk Sharpe*, *Reflex Clutch*) across Borel, Pulse Runner, and third-party games. |

### Module B: Developer, AI Agent & Vibe-Coding Creation Stack

| ID | Requirement | Priority | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **CF-2.1** | **Web Vibe-Coding Studio ("Prompt-a-Game")** | **P0** | Browser IDE where creators prompt a game idea, select a genre template (*Game-Day Arena*, *3-Lane Runner*, *Turf Grid*, *Prediction Bracket*), customize rules/skins, run an automated WASM simulation check, and publish live with an on-chain $50\%$ creator fee vault in $< 60\text{ seconds}$. |
| **CF-2.2** | **CartridgeFi Agent Skill (`SKILL.md`)** | **P0** | Installable via `npx skills add cartridgefi/skill` for Claude Code, Cursor, Codex, and Windsurf—equipping coding agents with verified integration patterns, compliance guardrails, and zero-hallucination SDK bindings. |
| **CF-2.3** | **CartridgeFi MCP Server (`@cartridgefi/mcp`)** | **P0** | Model Context Protocol server allowing AI coding agents to query live Solana venue mints/feeds, validate `CartridgeManifest` JSONs, provision MagicBlock ER/TEE rooms, and deploy games directly from an IDE prompt. |
| **CF-2.4** | **`cartridgefi` CLI & Multi-Engine SDKs** | **P1** | Ship `@cartridgefi/sdk` (TypeScript core), `@cartridgefi/react`, `@cartridgefi/phaser`, `@cartridgefi/three`, and Unity WebGL postMessage bridge, backed by `npx cartridgefi init` & local emulator (`cartridgefi dev`). |
| **CF-2.5** | **Wallet & Protocol Embed SDK (`<CartridgeDeck/>`)** | **P0** | 15-line React/WebView embed letting wallets (`Solflare`, `Phantom`, `Backpack`, `Jupiter`) render Borel or curated CartridgeFi games natively while splitting $40\%$ of net builder fees to `partnerFeeVault`. |

### Module C: Borel (First-Party Flagship Game #001) Specific Requirements

| ID | Requirement | Priority | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **BO-1.1** | **Live Game-Day Hub (`RFS #11`)** | **P0** | Unified real-time dashboard displaying a player's open positions across active games alongside correlated Kalshi contracts, perps, and tokenized stocks with 1-tap Conviction Entry and close-anytime portfolio control. |
| **BO-1.2** | **Private TEE "Fog of War" & 15s Showdown** | **P0** | Encrypt live player allocations inside MagicBlock Private ER TEEs during the first $75\%\text{--}80\%$ of every match while streaming live $\Delta\text{Rank}$, unsealing all positions at $T - 15\text{ s}$ before crank settlement. |
| **BO-1.3** | **Rivalries, Shareable Skill Cards & AI Coach** | **P1** | 1v1 challenge links, group clans, verifiable Market ELO receipt cards, and an opt-in **AI Event Coach (`RFS #8`)** explaining live catalyst moves. |

---

## 5. Mandatory Compliance & Player-Safety Engine Guardrails

Because CartridgeFi empowers external creators and AI agents to build games, **compliance is enforced programmatically at the Engine & Manifest Compiler layer** so no third-party creator can create an illegal casino or predatory trading trap:

1. **Hard-Blocked Casino Mechanics:** The `CartridgeManifest` schema and Anchor contracts disallow paid loot boxes, paid roulette multipliers on financial assets, or pure-chance paid entry pools. MagicBlock VRF is restricted strictly to free cosmetic drops, procedural obstacle seeding (synced deterministically for all runners in a pod), and exact mathematical score tie-breaks.
2. **Anti-Churn & FCA/SEC DEP Protection:** In-game button presses update ER Stance Vectors ($0\text{ fee}$) rather than firing per-click swap fees; notifications across Borel and the SDK strictly alert scheduled match starts, rivalry overtakes, and settled results—never nudging trade frequency.
3. **Engine-Level Geo & Issuer Gating (`cartridge-passport`):** Automatic edge + on-chain enforcement blocking US and OFAC-sanctioned jurisdictions from restricted venues, and restricting tokenized-equity (`xStocks`) prize delivery strictly to the $110+$ issuer-eligible countries (`USDC` fallback elsewhere).

---

## 6. Validation Metrics & Stage Kill Gates

* **Gate 1 — Blitz v10 & Perps Hackathon (Nov 27 – Dec 5, 2026):** End-to-end ER + Private TEE latency $\text{p95} < 50\text{ ms}$; Borel + Pulse Runner running concurrently on the same Anchor `cartridge-registry` contract; first $100$ real mainnet routed perp/prediction trades settled cleanly.
* **Gate 2 — Guarded Mainnet Private Beta (Early Jan 2027, Pre-Audit):** Borel Day-14 retention $\ge 25\%$; $\ge 10$ playable third-party/vibe-coded cartridges published via MCP/Studio; $0$ vault accounting drift across $250+$ mainnet rooms $\rightarrow$ **Triggers Stage C Initial Security Audit**.
* **Gate 3 — Engine Network Effect (Q1 2027):** $\ge 30\%$ of total CartridgeFi routed venue volume originating from *creator-built games and partner Wallet SDK embeds* alongside Borel's first-party baseline.