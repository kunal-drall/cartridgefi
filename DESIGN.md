# CartridgeFi Design System — Institutional Market & Protocol Workstation

## 1. Visual World & Mode (`Operate`)

CartridgeFi is an **on-chain market execution engine** pairing Solana L1 custody (`cartridge-vault-router`), parameterized arena manifests (`cartridge-registry`), portable skill scoring (`cartridge-passport`), and 10ms MagicBlock Ephemeral Rollup / Intel TDX TEE rooms (`cartridge-er-room`).

- **Mode:** `Operate` (live multi-venue execution terminal, protocol block inspector, and manifest IDE).
- **Craft Reference Bar:** Linear, Fey, Kalshi, TradingView, Hyperliquid.
- **First-Surface Rule:** Opening `/` places the operator directly inside the live multi-venue market terminal with real-time WebSocket candles (`SOL-USD`, `BTC-USD`), Solana `xStocks` DEX pools (`NVDAx`, `SPYx`, `TSLAx`), live Kalshi binary contracts, and live Solana Devnet / MagicBlock ER state. Zero SaaS marketing brochure filler.

## 2. Explicit Anti-Slop Bans

- **No neon glow or purple-on-dark:** Zero `#00F59B` / `#8B5CF6` / `#00D4FF` glowing shadows, halos, or gradient text.
- **No frosted-glass card soup:** Panels dock cleanly via `1px solid #22262E` structural hairlines on matte carbon surfaces (`#0B0C0E` / `#111317`), never nested `rounded-2xl` blurred cards.
- **No eyebrows / kickers above headings:** Headings speak directly in sentence case without tracked-out uppercase labels above them.
- **No fake telemetry or fake signatures:** Every price, candle, Kalshi quote, program account count, balance, and transaction hash comes from live APIs (`Coinbase Exchange`, `DexScreener`, `GeckoTerminal`, `Kalshi`, `Solana Devnet RPC`, `MagicBlock Router / ER / TEE RPC`).

## 3. Palette & Surface Tokens

| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--bg-canvas` | `#0B0C0E` | Primary application ground |
| `--bg-panel` | `#111317` | Docked workspace panes & tables |
| `--bg-elevated` | `#171A20` | Interactive controls, inputs, active rows |
| `--bg-hover` | `#1D2129` | Pointer hover surface |
| `--border-subtle` | `#22262E` | 1px structural pane & table dividers |
| `--border-strong` | `#303642` | Control borders & focused dividers |
| `--fg-primary` | `#F3F4F6` | Primary text & active numerals |
| `--fg-secondary` | `#9CA3AF` | Secondary labels & metadata (≥4.5:1) |
| `--fg-muted` | `#6B7280` | Table headers & inactive hints |
| `--accent-primary` | `#2563EB` | Primary interactive action & focus ring |
| `--market-up` | `#10B981` / `#34D399` | Bid, positive delta, bullish candle |
| `--market-down` | `#EF4444` / `#F87171` | Ask, negative delta, bearish candle |
| `--state-amber` | `#F59E0B` / `#FBBF24` | Hardware-encrypted TEE seal / warning |

## 4. Typography & Motion Physics

- **UI Sans:** `Inter` (`400`, `500`, `600`), tight optical tracking (`-0.018em` on titles), sentence case.
- **Data Mono:** `JetBrains Mono` (`400`, `500`, `600`) with `font-variant-numeric: tabular-nums slashed-zero` strictly on prices, orderbooks, timestamps, slots, basis points, and base58 addresses.
- **Tactile Press & Transitions:**
  - Press feedback: `transform: scale(0.97)` on `:active`.
  - Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` at `140ms`–`180ms`.
  - Never `transition: all`. Hover transitions gated behind `@media (hover: hover) and (pointer: fine)`.
