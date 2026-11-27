# Borel — Sealed-Conviction Live Market Showdowns on Solana + MagicBlock

**Fantasy trading with a hidden hand.** Everyone in a Borel room plays the same live window. You draft three market calls (`LONG`/`SHORT` across SOL, BTC, ETH, NVDAx, SPY), place your `1x`/`2x`/`3x` conviction cards (the `3x` is your secret Sniper) and seal the hand. Rivals watch your rank move in real time but never see your legs. Each player gets one Pivot (flip a leg or shield it to cash). At `00:00` every hand unseals and the table learns who was right.

- **Live app:** https://cartridgefi.vercel.app (`/` is the Borel table, `/protocol` is the live on-chain inspector)
- **Why it exists:** see [`docs/IDEA_VALIDATION.md`](./docs/IDEA_VALIDATION.md) (Colosseum Copilot stress test)
- **On-chain proof:** see [`docs/DEVNET_PROOF.md`](./docs/DEVNET_PROOF.md)

## How a room works

The live app and the proof script exercise the same deployed programs at different depths. The table says which is which.

Both paths have run live on devnet (21-transaction lifecycle on 2026-11-27, links in `docs/DEVNET_PROOF.md`).

| Step | Live app (`/api/borel/*`, relayer-paid) | Proof script (`scripts/prove-live-devnet.ts`) |
| :--- | :--- | :--- |
| Join | `cartridge_registry.register_cartridge` (first room), `cartridge_er_room.initialize_room_shard`, `init_stance_and_delegate` (stance delegated to MagicBlock via `DELeGGv…`) | Same, plus `delegate_room_shard` |
| Seal | sha256 commitment published as a devnet memo; the hand itself is AES-GCM encrypted with a server-held key until showdown | `submit_stance` on the MagicBlock ER under a Permission Program (`ACLseo…`) ACL |
| Sweat | Scores recomputed from live Pyth prices with bigint `10^9` fixed-point math; only ranks are public | — |
| Pivot | One `FLIP`/`SHIELD`, memo-recorded, enforced by the relayer | Second `submit_stance`, capped on-chain by `max_rebalances` |
| Showdown | Hands revealed as memos at settle; tie-break seed from a blockhash, labelled "not VRF" | `request_settlement_vrf`, `trigger_showdown_unseal`, `undelegate_player_stance`, `settle_and_commit_shard` |

**Not yet possible with the current keys:** SPL stakes, fee routing into `platformFeeAccount` and `record_elo`. These need the original devnet authority (`D7ba9q…`), which holds the test mint and the passport admin role. The historical run that exercised them is in `docs/DEVNET_PROOF.md`. On-chain stances use four slots `[SOL, BTC, ETH, NVDAx]`, so SPY legs are scored off-chain only.

**Stakes:** rooms default to paper play. Devnet rooms send real devnet transactions through a server-side relayer when it is funded. When it isn't, the app says so and shows simulation results instead of signatures. Nothing in the UI fabricates a transaction.

**Prices:** Pyth Hermes now requires an API key. Without `PYTH_API_KEY`, the server reads Pyth's on-chain push-feed accounts on Solana mainnet and streams them to the browser over SSE (`/api/pyth/stream`). Equity legs are marked `closed`/`stale` outside US market hours.

---

## Deployed Solana Devnet Programs, Relayer & `platformFeeAccount`

| Component | Pubkey / Endpoint | Role |
| :--- | :--- | :--- |
| **`cartridge_er_room` (P1)** | `Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR` | `435,080 B` · Delegated `RoomShard` & `PlayerStance`, PER permissions, VRF request/callback, `MagicIntentBundleBuilder`, & 4 `i128` (`10^9`) formulas |
| **`cartridge_vault_router` (P2)** | `6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT` | `373,232 B` · Non-custodial `SessionRiskEnvelope`, Harmonic Shapley payouts, `50/50` & `40/30/30` fee splits into `platformFeeAccount` |
| **`cartridge_registry` (P3)** | `5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr` | `188,752 B` · `EngineConfig` (`platform_fee_account`, TVL caps) & parameterized `CartridgeManifestAccount` PDAs |
| **`cartridge_passport` (P4)** | `5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr` | `182,040 B` · Portable Cross-Game Market ELO (`i128` `10^9`) & Geo/xStocks Eligibility Bitmask |
| **Proof-run authority (2026-11-26)** | `D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1` | Signed the historical proof run in `docs/DEVNET_PROOF.md` (TEE auth, `delegateSpl`, private eSPL transfers, `withdrawSpl`) |
| **Borel relayer (live app)** | `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg` | Server-side fee payer for Borel room transactions; key lives only in server env |
| **`platformFeeAccount` (Canonical ATA)** | `6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir` | Canonical SPL ATA of treasury owner `Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd` for Devnet SPL mint `F6chXtYN1UUtxY1eNcbjnRDqnMWVYNUtqUqiy52pzWm1` |
| **MagicBlock Delegation / PER / eSPL** | `DELeGGvX...` · `ACLseoPo...` · `SPLxh1LV...` | Account delegation, ER-local permissions, and encrypted Magic ATA private SPL transfers |
| **MagicBlock Router & Private TEE** | `https://devnet-router.magicblock.app` · `https://devnet-tee.magicblock.app` | Dynamic ER routing (`10ms`) & Intel TDX hardware-encrypted execution |

---

## Agent Skill (`SKILL.md`), MCP v2 Server & CLI

### 1. Install the CartridgeFi Agent Skill (`Claude Code`, `Cursor`, `Codex`)

```bash
# Install from repository or published skill package
npx skills add ./packages/cartridgefi-skill
```

Includes `SKILL.md`, 5 deep-dive protocol references (`manifest-schema.md`, `scoring-formulas.md`, `session-keys-and-per.md`, `venue-routing.md`, `wallet-deck-embed.md`), and 3 compliant `CartridgeManifest v2.0` starter templates.

### 2. Connect `@cartridgefi/mcp` v2 (`stdio` or Streamable HTTP `/mcp`)

Add to `.mcp.json` or Claude Desktop / Cursor MCP settings:

```json
{
  "mcpServers": {
    "cartridgefi": {
      "command": "node",
      "args": ["packages/mcp-server/dist/cli.js", "--stdio"]
    }
  }
}
```

Exposes 6 deterministic tools: `discover_live_markets`, `compile_prompt_to_manifest`, `simulate_cartridge_economy`, `deploy_cartridge_devnet`, `inspect_room_telemetry`, and `generate_engine_client_bindings` (TypeScript, C# Unity, GDScript Godot).

### 3. `cartridgefi` Creator CLI & `<CartridgeDeck />` Wallet Embed

```bash
node packages/cli/dist/cli.js init my-nvda-blitz --genre BOREL_GAMEDAY
node packages/cli/dist/cli.js simulate ./my-nvda-blitz/cartridge.manifest.json --ticks 500 --regime crash_vix35
node packages/cli/dist/cli.js publish ./my-nvda-blitz/cartridge.manifest.json --network devnet
```

```tsx
import { CartridgeDeck } from "@cartridgefi/react";

export function PartnerWalletMiniApp({ userWallet }: { userWallet: string }) {
  return (
    <CartridgeDeck
      cartridgeSlug="borel-blind-conviction-blitz-001"
      partnerWallet={userWallet}
      partnerFeeVault="6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir"
      mode="PAPER"
    />
  );
}
```

---

## Quickstart, Vercel Deployment & Full Verification Suite

```bash
# 1. Install dependencies & verify SHA-256 locked agent skills
pnpm install
pnpm skills:check

# 2. Build, typecheck & unit-test all TypeScript packages + Next.js 15 web app
pnpm build
pnpm typecheck
pnpm test

# 3. Compile optimized Anchor SBF binaries (opt-level = "z") & run LiteSVM + MagicSVM + 100k solvency fuzz tests
pnpm anchor:build
pnpm clippy:programs
pnpm test:litesvm

# 4. Verify Rust real-time edge services (#![deny(clippy::float_arithmetic)])
pnpm clippy:services
pnpm test:services

# 5. Priority-ordered Devnet deploy & full MagicBlock Blitz v10 on-chain proof
./scripts/deploy-devnet.sh
pnpm prove:blitz

# 6. Run Playwright Desktop (1440x900) & Mobile (390x844) headless E2E suite (incl. /protocol)
pnpm test:e2e
```

### Vercel Deployment (`apps/web`)
Root [`vercel.json`](./vercel.json) and [`apps/web/.env.example`](./apps/web/.env.example) are pre-configured for zero-config Vercel builds (`NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL`, `NEXT_PUBLIC_MAGICBLOCK_TEE_URL`). When external `core-api` or `ws-mesh` daemons are not attached, the web console gracefully degrades to direct Solana Devnet RPC + live MagicBlock ER oracle reads + deterministic 48-byte binary telemetry with zero uncaught WebSocket or console errors.