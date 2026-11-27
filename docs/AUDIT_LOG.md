# CartridgeFi Engine & Borel (#001) — Adversarial Security, Solvency & Visual Anti-Slop Audit Log

**Lead Auditor:** Agent-06 (Adversarial Staff Reviewer, Security & Anti-Slop Auditor — Wave 4 Veto Gate)  
**Audit Date:** November 25, 2026  
**Final Verdict:** **APPROVED — ALL 5 DEFINITION OF DONE GATES PASSED WITH ZERO WARNINGS**

---

## 1. Exit Gate Checklist Sign-Off (Section 8)

- [x] **Skill Lock Verified**: `skills-lock.json` (version 2 SHA-256 content hashes across 13 verified project skills from `vercel-labs`, `anthropics`, `solana-foundation`, `magicblock-labs`, `jup-ag`, `dflowprotocol`, `microsoft`, `gamedev-skills`) passes `npx skills check`; `packages/cartridgefi-skill/SKILL.md` (+ 5 reference guides + 3 manifest templates) validates cleanly with `npx skills add ./packages/cartridgefi-skill --list`.
- [x] **Zero-Warning On-Chain Build & Autofix**: All 4 Anchor programs (`cartridge-registry`, `cartridge-er-room`, `cartridge-vault-router`, `cartridge-passport`, ~3,100 nSLOC) pass live `solana-mcp` `program_autofixer` (`issues: []`, `require_another_tool_call_after_fixing: false` on all 4 programs), `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `NO_DNA=1 anchor build --ignore-keys`, and **100% of LiteSVM + MagicSVM + Proptest security & solvency invariant tests** (8/8 suites including **100,000 fuzzed score/payout vectors**).
- [x] **MagicBlock Full-Stack Signals Live**: `cartridge-er-room` (`Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR`) executes real ER delegation (`DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`), Private ER TEE permission lifecycle (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` — `CreateEphemeralPermissionCpi` `is_private = true` during Fog-of-War, `UpdateEphemeralPermissionCpi` `is_private = false` at Showdown, `CloseEphemeralPermissionCpi` at settlement), scoped `#[vrf]` / `#[vrf_callback]` randomness, `ScheduleCrankCpi` scheduled tasks, `MagicIntentBundleBuilder` commit-and-undelegate + post-commit `CallHandler` Magic Actions, and `platform_fee_account` routing, backed by `cartridge-keeper-bots` running 3 autonomous AI Pacer Bots (`AlphaQuant`, `BorelSigma`, `KalshiHawk`).
- [x] **Agentic & SDK Stack Verified**: `@cartridgefi/shared-types`, `@cartridgefi/codama-clients`, `@cartridgefi/ui-system`, `@cartridgefi/sdk`, `@cartridgefi/react` (`<CartridgeDeck/>` & `<BorelArena/>`), `cartridgefi` CLI, and `@cartridgefi/mcp` v2 (`stdio` + Streamable HTTP `/mcp`) compile with `tsc --noEmit` (`0` errors, zero `any`, zero `as unknown as`) and pass 100% of end-to-end tool & lifecycle tests.
- [x] **Zero AI Slop & 60/120fps UI Proof**: Playwright headless inspection confirms `0` console errors, `0` page errors, `0` wallet/dialog popups, and `0` horizontal overflow across `/`, `/play/borel`, `/play/pulse-runner`, and `/studio` on both **Desktop (`1440x900`)** and **Mobile (`390x844`)**, verifying official Solana & MagicBlock vector SVG lockups, `tabular-nums` numeric alignment, 380ms 3D spring Showdown unseal, 60fps 3-lane Canvas track, and responsive thumb-zone ergonomics.

---

## 2. On-Chain & MagicBlock Security Findings Table

*(Formatted per `.agents/skills/magicblock/references/security.md#review-output`)*

| Runtime | Product & State | Label | Source | Verification & Test Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Base Layer** | `cartridge-er-room::delegate_room_shard` & `init_stance_and_delegate` | Integration validation | `magicblock/references/delegation.md` (#288) | Verified `del` accounts are `UncheckedAccount<'info>` (never typed `Account<T>`), preventing `ExternalAccountDataModified` post-CPI re-serialization. Owner & authority checked prior to CPI. Tested in `test_c_full_per_er_vrf_crank_settlement_xstocks_and_passport_lifecycle`. |
| **PER (TEE)** | `EphemeralPermission` (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`) | Protocol guarantee + Integration validation | `magicblock/references/delegation.md` | Data PDA pre-funded on L1 via `ephemeral_accounts::rent`; ER permission initialized with `is_private = true` during `FogOfWar`, flipped to `is_private = false` at `unseal_ts` (`Showdown`), and closed before undelegation. Verified in MagicSVM `get_account_for` unauthorized vs member read tests. |
| **Base Layer** | `cartridge-vault-router::DistributePoolAction` (`#[action]`) | Integration validation | `magicblock/references/magic-actions.md` | Verified `escrow` is required as `signer` and pinned to `ephemeral_balance_pda_from_payer(&escrow_auth.key(), 255)`, `escrow_auth` pinned to `room_vault.authority`, and `source_program` pinned to `ER_ROOM_PROGRAM_ID`. Direct unauthorized wallet invocation rejected in `test_c2`. |
| **ER / Base** | `ephemeral_session_key` Isolation | Application policy + General Solana practice | `magicblock/references/security.md` | `submit_stance` accepts `ephemeral_session_key` strictly before `end_ts` and within `max_rebalances`. `open_session_envelope` and `claim_prize` require `player: Signer` and explicitly reject `player_key == ephemeral_session_key`. Verified in `test_d_session_key_isolation_red_team`. |
| **ER** | VRF (`request_settlement_vrf` / `callback_settlement_vrf`) | Integration validation | `magicblock/references/vrf.md` | Uses `create_request_randomness_ix_const` with compile-time `program_identity_pubkey(&crate::ID)`, `#[vrf]` request context, `#[vrf_callback]` scoped VRF identity check, and `vrf_request_nonce` correlation preventing superseded callback replay. |
| **ER** | Pricing Oracle (`verify_oracle_health`) | Integration validation + Application policy | `magicblock/references/pricing-oracle.md` | Verifies owner (`PriCems...` or Pyth Receiver), `posted_slot > 0`, `price > 0`, `now_ts - publish_time <= 15s`, and `conf / price <= 150 bps` (`1.5%`). Stale or wide-confidence feeds transition cleanly into `RoomPhase::RetryGrace` without reverting crank progress (`test_e_pyth_oracle_staleness_and_confidence_safety`). |
| **Base Layer** | Guarded Beta Caps & Harmonic Shapley Solvency | Application policy + General Solana practice | Section 7.1.D Spec | `private_beta_mode == true` hard-reverts room pools `> 500_000_000` ($500 USDC) and global TVL `> 5_000_000_000` ($5,000 USDC) (`test_b`). `fuzz_100k_harmonic_shapley_and_fee_solvency_invariants` verified $\sum \text{WinnerPayouts} + \sum \text{FeeSplits} \le \text{RoomPool}_{\text{USDC}}$ across 100,000 fuzzed vectors with zero overflows. |

---

## 3. Remediations Executed During Wave 4 Audit

1. **`apps/web/src/app/api/cashier/faucet/route.ts` (Missing Proxy Route -> 404 Console Error on `/play/borel`)**:
   - *Finding*: `ConsoleVaultContext.mintDevnetUsdc` posted to `/api/cashier/faucet`, which fell back locally after logging a browser `404` resource error.
   - *Fix*: Added `POST /api/cashier/faucet` Next.js edge route proxying pure-`BigInt` JSON directly to `cartridge-core-api` `POST /v1/cashier/devnet-faucet` with standalone fallback. Verified `0` console errors in Playwright.
2. **`packages/ui-system/src/LiquidGlass.tsx`, `apps/web/src/app/(marketing)/page.tsx`, & `apps/web/src/studio/VibeStudioConsole.tsx` (`390x844` Mobile Visual Fit)**:
   - *Finding*: Headless `390x844` screenshot inspection identified Tailwind v4 `.inline-flex` overriding `hidden sm:inline-flex` on the mobile navbar `Launch Studio` button, `CopyTerminalPill` needing `min-w-0 flex-1`, and 44-char base58 PDA strings in `#studio-deploy-receipt` needing `break-all` + explicit `ER Room Program ID` display.
   - *Fix*: Applied responsive fixes, rebuilt `@cartridgefi/ui-system` and `@cartridgefi/web`, and re-verified `8/8` Playwright tests + visual screenshot inspection across `1440x900` and `390x844`.

---

## 4. Borel Pivot Audit — 2026-11-27 (relayer, `/api/borel/*`, scoring)

Independent read-only review of the relayer and game API added in the Borel pivot. Findings are traced code paths unless marked estimated.

| ID | Severity | Finding | Status |
| :--- | :--- | :--- | :--- |
| C1 | Critical | Room state rebuilt from any tx carrying a `borel:v1:` memo; anyone could forge lock/pivot/settle events (unbounded scores, early settle revealing all hands) | FIXED — events count only with a relayer-key HMAC bound to the room id, relayer fee payer, and blockTime inside the phase window; signature reads paginated |
| H1 | High | Lock/pivot accepted any `sessionPubkey` with no player signature; full session ids exposed in room rows | FIXED — session key signs `{action, roomId, sessionPubkey, params, expiresAt}` (ed25519, 2-min expiry), verified server-side; rows carry a 12-hex label only |
| H2 | High | Exact live per-player scores plus public prices let anyone solve a sealed hand within seconds | FIXED — before settle, rivals expose only rank and rank delta; scores and hands only after settle |
| H3 | High | Client-supplied entry price (±1% edge, fails open when Pyth is unavailable) | FIXED — entry/pivot prices set server-side from Pyth; legs with missing or >60 s-old prices are refused |
| H4 | High (estimated cost) | Join rent drain via fresh session keys; per-instance in-memory rate limit | MITIGATED — 24-seat cap per room, rate limit, balance floor; shared limiter/spend budget deferred |
| H5 | High | Predictable RoomShard seeds allow pre-creation DoS; seed index wraps at 65,536 cycles | FIXED — shard seed = HMAC(relayer key, full room id); reads verify authority and schedule |
| M1 | Medium | Settle scores a missing feed as 0 and uses call-time prices | FIXED — settle refuses missing/stale prices (uses latest fresh price ~endsAt+1.5 s) |
| M2 | Medium | No rate limits on GET routes / SSE; per-subset Pyth cache amplifies upstream calls | DEFERRED |
| M3 | Medium | No price-freshness check on lock/pivot/settle | FIXED — 60 s freshness rule on lock/pivot/settle |
| L1 | Low | Relayer secret: no leak path found (no client import of server modules, not in `.next/static`, `.env.local` ignored) | Verified |

Verification after fixes: `tsc --noEmit` clean; Playwright 7 passed / 1 skipped (desktop-only Devnet test) on 1440x900 and 390x844. After funding (17:05 IST) the production app's relayer-signed `join` and `lock` broadcast successfully, and `scripts/prove-live-devnet.ts` completed the full lifecycle (21 confirmed transactions, `docs/DEVNET_PROOF.md`). The forged-event and signature checks have not yet been tested adversarially on-chain.
