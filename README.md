# Borel — Sealed-Conviction Live Market Showdowns on Solana + MagicBlock

**Fantasy trading with a hidden hand.** Everyone in a Borel room plays the same live window. You draft three market calls (`LONG`/`SHORT` across SOL, BTC, ETH, NVDAx, SPY), place your `1x`/`2x`/`3x` conviction cards (the `3x` is your secret Sniper) and seal the hand. Rivals watch your rank move in real time but never see your legs. Each player gets one Pivot (flip a leg or shield it to cash). At `00:00` every hand unseals and the table learns who was right.

- **Live app:** https://cartridgefi.vercel.app (`/` is the Borel table, `/protocol` is the live on-chain inspector)
- **Why it exists:** see [`docs/IDEA_VALIDATION.md`](./docs/IDEA_VALIDATION.md) (Colosseum Copilot stress test)
- **On-chain proof:** see [`docs/DEVNET_PROOF.md`](./docs/DEVNET_PROOF.md)

## How a room works

Devnet rooms in the live app run the full private path against the deployed programs. Solana L1 handles account creation, delegation, the seat registry and the final commit. The MagicBlock Private ER does every hand write: the devnet TEE at `devnet-tee.magicblock.app`, validator `MTEWGuqx…`. The relayer (`Fc54gfod…`) pays every L1 fee, and ER transactions cost 0 lamports, so players never pay or sign a transaction.

How a hand is authorized: the browser's ephemeral ed25519 session key signs each API request. A connected wallet can delegate that key once per room. The server then releases a per-room stance session key, derived from relayer key material, which is the only key `submit_stance` accepts for that stance. It is released only for a valid session signature. A full app-driven room is recorded in `docs/DEVNET_PROOF.md` ("Borel app room on the Private ER"). `node scripts/prove-live-devnet.ts --app http://localhost:3100` replays one through the API.

| Step | Layer | What the app sends (`/api/borel/*`) |
| :--- | :--- | :--- |
| Join | L1 | First player only: `register_cartridge` (v2 manifest: `max_rebalances = 2`, `fog_of_war_bps = 9000`), then `initialize_room_shard` and `delegate_room_shard` to the TEE validator. Every player: a relayer-funded derived player key, `init_stance_and_delegate` to the TEE, and an HMAC join memo (the seat registry) |
| | ER | `join_room_and_init_permission`. This creates a private Permission Program (`ACLseo…`) ACL whose members are the player key and the relayer |
| Seal | ER | `submit_stance` (before `lockAt`). The hand's three markets go into weight slots 1–3 (`±conviction × 1000`) with fresh Pyth entry prices set by the server, never by the client. Slot 0, priced in-program by the ER oracle, stays empty. While the ACL is private, the TEE returns nothing for the stance to anyone but its members. It also redacts the transaction (no instructions, no logs) and leaves it out of the room's signature list |
| Sweat | server | The relayer is an ACL member: it reads only the stances whose join it performed, and ranks them with bigint `10^9` math. Rival ranks come from a price snapshot refreshed at most every 10 s. Rivals get rank and rank delta only: no score, no hand, no pivot use, and nothing at all in the lobby. Your live score goes only to your signed session (auth in request headers). Each client IP gets at most 2 seats per room |
| Pivot | ER | A second `submit_stance`: `FLIP` negates the leg, `SHIELD` zeroes it, and the pivot price is stored in the stance. The program's `max_rebalances = 2` rejects any third move |
| Settle | L1 + ER | An HMAC settle memo with Pyth prices at 00:00: Hermes historical where the API key grants the feed, otherwise the latest quote, but only within 8 s of 00:00. Then `request_settlement_vrf`, whose MagicBlock VRF callback writes `RoomShard.vrf_seed` (the tie-break seed). Then, for each stance, `trigger_showdown_unseal` + `evaluate_player_score` (permission closed, so the stance becomes public), then `undelegate_player_stance`. Finally `settle_and_commit_shard`, whose commit + undelegation lands on L1 as a Delegation Program transaction paid by the validator. Stake payouts run after that, when anyone staked |

**Still off-chain:** Borel's score (FLIP/SHIELD bank the move up to the pivot price) is computed by the server from the on-chain stance data. The program's own `final_score` uses its direction-neutral formula without pivot banking, so the two can differ. Paper rooms never touch the chain.

**Not yet possible with the current keys:** SPL stakes, fee routing into `platformFeeAccount` and `record_elo`. These need the original devnet authority (`D7ba9q…`), which holds the test mint and the passport admin role. The historical run that exercised them is in `docs/DEVNET_PROOF.md`. On-chain stances have four weight slots. Borel leaves slot 0 (priced by the ER oracle) empty and writes the hand's three markets, SPY included, to slots 1–3.

**Stakes:** rooms default to paper play. Devnet rooms send real devnet transactions through a server-side relayer when it is funded. When it isn't, the app says so and shows simulation results instead of signatures. Nothing in the UI fabricates a transaction.

**Prices:** Pyth Hermes now requires an API key. Without `PYTH_API_KEY`, the server reads Pyth's on-chain push-feed accounts on Solana mainnet and streams them to the browser over SSE (`/api/pyth/stream`). Equity legs are marked `closed`/`stale` outside US market hours.

---

## Deployed Solana Devnet Programs, Relayer & `platformFeeAccount`

Borel deployment of 2026-11-27: the Borel relayer `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg` is upgrade authority, config admin and mint authority. The 2026-11-26 deployment (`Hqi5b6iY…`, `6hzFDMeB…`, `5tH1uFw8…`, `5jkGrbF9…`) remains on devnet as the historical proof run.

| Component | Pubkey / Endpoint | Role |
| :--- | :--- | :--- |
| **`cartridge_er_room` (P1)** | `DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W` | `435,080 B` · Delegated `RoomShard` & `PlayerStance`, PER permissions, VRF request/callback, `MagicIntentBundleBuilder`, & 4 `i128` (`10^9`) formulas |
| **`cartridge_vault_router` (P2)** | `Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR` | `373,232 B` · Non-custodial `SessionRiskEnvelope`, Harmonic Shapley payouts, `50/50` & `40/30/30` fee splits into `platformFeeAccount` |
| **`cartridge_registry` (P3)** | `BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc` | `188,752 B` · `EngineConfig` (`platform_fee_account`, TVL caps) & parameterized `CartridgeManifestAccount` PDAs |
| **`cartridge_passport` (P4)** | `B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF` | `182,040 B` · Portable Cross-Game Market ELO (`i128` `10^9`) & Geo/xStocks Eligibility Bitmask |
| **Proof-run authority (2026-11-26)** | `D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1` | Signed the historical proof run in `docs/DEVNET_PROOF.md` (TEE auth, `delegateSpl`, private eSPL transfers, `withdrawSpl`) |
| **Borel relayer (live app)** | `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg` | Server-side fee payer for Borel room transactions; key lives only in server env |
| **`platformFeeAccount`** | `6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8` | Fee vault (SPL token account) for the Borel test-USDC mint `32CRMQ5gBzDv45kAKXVNLb7qfvoPAxRNp6dnnhkUnRtw` |
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