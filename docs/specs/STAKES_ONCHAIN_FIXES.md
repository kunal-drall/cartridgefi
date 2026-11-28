# Borel staked rooms: on-chain fixes (spec for the contracts upgrade)

Status: **implemented and upgraded on Devnet (2026-11-28)**; see `docs/DEVNET_PROOF.md` ("On-chain stakes fixes upgrade", "Legacy stake vaults refunded") and `tests/onchain/tests/stakes_onchain_fixes.rs`. Deviations from the text below: (1) `room_authority` is the LAST account of `init_stance_and_delegate` (after the explicit `owner_program` / `delegation_program`), `join_room_and_init_permission` and `submit_stance`, so a server sending it also worked against the pre-upgrade program (zero-downtime switch); (2) `open_session_envelope` uses the recommended `funder` + `funder_usdc_ata`, and `room_authority` pays the envelope rent; (3) legacy envelopes are migrated inside `migrate_room_vault_v2` (passed as remaining accounts, reallocated in place, Σ principals must equal the pool) instead of a separate `migrate_session_envelope_v2`; (4) §5.3 is implemented: the ELO credit is bound to the settled envelope; (5) §4.3 (time lock) is not implemented. Staking stays behind `BOREL_STAKES_ENABLED` until the app team enables it.

Source findings: `docs/AUDIT_LOG.md` §5 — C1 (outsider stances and envelopes can steal or freeze pools), H1 (seat cap is check-then-act; there is no refund), H2 (variable stakes with rank-only payouts), M2 (ELO / vault-credit idempotency), L1 (stranded funds, late stake broadcast).

Programs (Devnet, upgrade authority = relayer `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg`):

| Program | ID |
| :--- | :--- |
| `cartridge_er_room` | `DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W` |
| `cartridge_vault_router` | `Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR` |
| `cartridge_passport` | `B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF` (section 5 only) |

## 0. Ground rules for the implementer

1. **Append-only layouts for `RoomShard`, `PlayerStance` and `MarketPassport`.** `cartridge_vault_router` reads these accounts at fixed byte offsets (`parse_settled_room_shard`, `parse_player_stance`, `verify_xstocks_passport_eligibility`):
   - RoomShard: `phase` @106, `player_count` @112..114, `evaluated_count` @114..116
   - PlayerStance: `room_shard` @8..40, `player` @40..72, `final_score_scaled` @246..262, `evaluated` @263
   - MarketPassport: `owner` @8..40, `elo_scaled` @40..56, `eligibility_bitmask` @56

   Add new fields **after `bump`** only, and update `INIT_SPACE`. Do not reorder or resize existing fields.
2. New fields change account size. New rooms get the new size from `init`. Legacy accounts are covered in §6.
3. Integer math only (`u64`/`i128`, 1e9 scale where scaled), `checked_*` everywhere, no floats.
4. After every edit run the solana-mcp `program_autofixer` on each touched `lib.rs` until `require_another_tool_call_after_fixing` is false, then `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `NO_DNA=1 anchor build`, and LiteSVM tests (`tests/onchain/`).
5. Regenerate the IDLs and the Codama clients (`node scripts/generate-codama-clients.mjs`). New accounts change instruction account lists, so `@cartridgefi/codama-clients` must be rebuilt before the app is switched back on.

The **room authority** below means `RoomShard.authority` (er_room) / `RoomVault.authority` (vault router). Both are the relayer for Borel rooms.

---

## 1. `cartridge_er_room`: room-authority co-signer on seat creation (C1) — Required

### 1.1 `init_stance_and_delegate`

Today any wallet can create and delegate a PlayerStance for any RoomShard.

- Accounts: add `pub room_authority: Signer<'info>` to `InitStanceAndDelegate`, declared **after `system_program`**.
- Handler: the shard is already deserialized for `start_ts/end_ts` (it may be owned by this program or by the Delegation Program, and the data is readable either way). Read `shard.authority` in that same block and add:
  ```rust
  require_keys_eq!(ctx.accounts.room_authority.key(), shard_authority, ErRoomError::UnauthorizedAuthority);
  ```
  Keep this check **before** `create_pda` and before the re-delegation branch, so a re-delegation of an existing stance also needs the authority.
- Unchanged: `player` stays the rent payer and signer (the relayer funds it), and the PDA seeds stay the same.

### 1.2 `join_room_and_init_permission`

Today the caller may be the player, the authority, or the session key, so an outsider who created a stance can also get counted in `player_count`.

- Accounts: add `pub room_authority: Signer<'info>` with `#[account(address = room_shard.authority @ ErRoomError::UnauthorizedAuthority)]`, declared **after `magic_program`**.
- Handler: keep the existing `caller` check (`payer` ∈ {player, authority, session key}). With the new account, every counted join is co-signed by the room authority.
- Consequence: `player_count` can only grow by authority-approved seats. Together with §3.2, every counted player in a staked room has an authority-approved envelope.

### 1.3 Errors

Reuse `UnauthorizedAuthority`. No new error codes are needed for §1.

---

## 2. `cartridge_er_room`: entry before start, authority-attested entry prices (C1) — Required

Today `submit_stance` accepts the first move any time until `end_ts`, with caller-chosen `secondary_prices_8`. Entering late at a known price is free money.

### 2.1 Accounts

Add `pub room_authority: Signer<'info>` to `SubmitStance`, declared **after `oracle_feed`**, with `#[account(address = room_shard.authority @ ErRoomError::UnauthorizedAuthority)]`. `session_signer` stays as is: the session key proves the player's intent, and the authority attests the prices and the timing.

### 2.2 Timing rules (handler, after the existing phase / rebalance checks)

```rust
if stance.move_count == 0 {
    // Entry (the sealed hand) must land before the clock starts.
    require!(clock.unix_timestamp < shard.start_ts, ErRoomError::EntryAfterStart);
} else {
    // Pivots only while the room is live.
    require!(
        clock.unix_timestamp >= shard.start_ts && clock.unix_timestamp < shard.end_ts,
        ErRoomError::PivotOutsideLiveWindow
    );
}
```

### 2.3 Prices

- `secondary_prices_8` stays in `SubmitStanceArgs`. Because `room_authority` must co-sign, these values are authority-attested: the Borel server already sets them from fresh Pyth data at lock time.
- Add validation on the first move: `require!(args.secondary_prices_8.iter().all(|p| *p > 0), ErRoomError::InvalidAttestedPrice)`. Remove the silent fallback to `oracle_tick` for a non-positive secondary price.
- Slot 0 keeps using the verified on-chain `oracle_feed` (unchanged).

### 2.4 New errors (append to `ErRoomError`)

`EntryAfterStart`, `PivotOutsideLiveWindow`, `InvalidAttestedPrice`.

### 2.5 Optional alternative (not required)

Instead of co-signing every submit, the authority could call a new `attest_entry_prices(prices_8: [i64; 3])` instruction that stores `attested_secondary_prices_8: [i64; 3]` and `attested_at_ts: i64` (appended to RoomShard), and the first submit would read them (rejected if older than 60 s). Co-signing (2.1) is simpler and matches how the app already sends every lock through the relayer, so it is the specified path.

---

## 3. `cartridge_vault_router`: fixed buy-in, atomic seat cap, authority gate (C1, H1, H2) — Required

### 3.1 `RoomVault`: new fields (append after `bump`)

```rust
pub buy_in_usdc: u64,      // exact principal every envelope must deposit
pub max_envelopes: u16,    // seat cap (Borel: 8)
pub envelope_count: u16,   // envelopes opened so far
pub refunding: bool,       // set by refund_unsettled_room; blocks deposits and distribution
pub refunded_count: u16,   // envelopes refunded so far
pub layout_version: u8,    // 2 for this layout (see §6)
```

### 3.2 `initialize_room_vault`

- Signature becomes `initialize_room_vault(ctx, total_fee_bps: u16, partner_wallet_active: bool, buy_in_usdc: u64, max_envelopes: u16)`.
- Checks: `buy_in_usdc > 0`, and `buy_in_usdc ≤ engine_cfg.max_room_pool_usdc / max_envelopes`, so a full room fits the pool cap (and the beta cap when `private_beta_mode`). Also `1 ≤ max_envelopes ≤ MAX_ENVELOPES_PER_VAULT` (new const = 8, the single-transaction distribution limit without an ALT).
- Store the new fields: `envelope_count = 0`, `refunding = false`, `refunded_count = 0`, `layout_version = 2`.

### 3.3 `open_session_envelope`

Today there is no authority gate, the principal is arbitrary, and the seat cap is off-chain only.

- Accounts:
  - add `pub room_authority: Signer<'info>` with `#[account(address = room_vault.authority @ VaultError::Unauthorized)]`;
  - **Recommended:** add `pub funder: Signer<'info>` and replace `player_usdc_ata` with `funder_usdc_ata` (`token::mint = usdc_mint, token::authority = funder`). The staking wallet then deposits directly, with no transient player ATA, and the envelope records who funded it (used by §4 refunds and §5 credits).
- Handler, before the transfer:
  ```rust
  require!(!vault.refunding, VaultError::VaultRefunding);
  require!(principal_usdc == vault.buy_in_usdc, VaultError::BuyInMismatch);
  require!(vault.envelope_count < vault.max_envelopes, VaultError::RoomSeatsFull);
  vault.envelope_count = vault.envelope_count.checked_add(1).ok_or(VaultError::MathOverflow)?;
  ```
  Keep every existing cap check (beta, room pool, global TVL).
- `SessionRiskEnvelope`: append `pub funder: Pubkey` (the funding wallet; `Pubkey::default()` only for legacy envelopes) and `pub refunded: bool`.
- Event: add `funder` to `SessionEnvelopeOpened`.

### 3.4 `distribute_pool_and_fees` / `distribute_pool_action`

In `execute_pool_distribution`, after `expected_player_count` is parsed:

```rust
require!(!vault.refunding, VaultError::VaultRefunding);
require!(u16::from(vault.envelope_count) == expected_player_count, VaultError::EnvelopeCountMismatch);
```

Every opened envelope must then be paired with a counted, evaluated stance. Stranded envelopes become impossible (with §1.2, an unpaired envelope can only exist if the room never committed, and §4 handles that). Then, per pair:

```rust
require!(env.principal_usdc == vault.buy_in_usdc, VaultError::BuyInMismatch); // defence in depth
```

### 3.5 `claim_prize`

If `env.funder != Pubkey::default()`, require `player_destination_ata.owner == env.funder` (USDC path), so payouts land in the funding wallet even if the server-held player key leaks. The legacy path (funder unset) keeps `token::authority = player`.

### 3.6 New errors (append to `VaultError`)

`BuyInMismatch`, `RoomSeatsFull`, `VaultRefunding`, `EnvelopeCountMismatch`, `InvalidBuyIn`, `RefundDestinationMismatch`, `AlreadyRefunded`.

---

## 4. `cartridge_vault_router`: authority-only refund for unsettled rooms (H1, L1) — Required

New instruction `refund_unsettled_room<'info>(ctx: Context<'info, RefundUnsettledRoom<'info>>)`.

### 4.1 Accounts

```rust
#[derive(Accounts)]
pub struct RefundUnsettledRoom<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_ROOM_VAULT, room_vault.room_shard.as_ref()], bump = room_vault.bump,
              has_one = authority @ VaultError::Unauthorized)]
    pub room_vault: Box<Account<'info, RoomVault>>,
    #[account(address = room_vault.usdc_mint @ VaultError::MintMismatch)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = room_vault.vault_usdc_token @ VaultError::InvalidVaultTokenAccount)]
    pub vault_usdc_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_ENGINE_CONFIG], bump = engine_config.bump, seeds::program = registry_program.key())]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    /// CHECK: vault_router_auth PDA signer for sync_global_tvl.
    #[account(seeds = [SEED_VAULT_ROUTER_AUTH], bump)]
    pub vault_router_auth: UncheckedAccount<'info>,
    pub registry_program: Program<'info, CartridgeRegistry>,
    pub token_program: Interface<'info, TokenInterface>,
    // remaining_accounts: (SessionRiskEnvelope [writable], destination TokenAccount [writable]) pairs
}
```

### 4.2 Rules

- `require!(!vault.settled, VaultError::VaultAlreadySettled)`. A refund is only for rooms whose pool was never distributed: the shard never reached SettledCommitted, the commit failed, or distribution stayed blocked.
- On the first call set `vault.refunding = true`. From then on `open_session_envelope` and distribution are rejected (§3.3, §3.4).
- For each `(envelope, destination)` pair:
  - the envelope is owned by `crate::ID`, has the canonical PDA `[SEED_SESSION_ENVELOPE, vault.room_shard, env.player]`, and is writable;
  - skip it if `env.refunded`, else require `!env.settled && !env.claimed`;
  - destination: if `env.funder != default`, `destination.owner == env.funder`; otherwise (legacy) `destination.owner == env.player`. Always `destination.mint == vault.usdc_mint` and `destination != vault_usdc_token`;
  - `transfer_checked(vault_usdc_token → destination, env.principal_usdc)` signed by the vault PDA seeds;
  - `env.refunded = true; env.settled = true; env.payout_usdc = 0;` then write the envelope back (same serialize pattern as distribution);
  - `vault.room_pool_usdc -= principal`, `vault.refunded_count += 1`, `sync_global_tvl(-principal)`.
- When `vault.refunded_count == vault.envelope_count`, set `vault.settled = true`. A room is then terminal: either distributed or fully refunded, never both.
- Paging: callers may pass any number of pairs that fits in the transaction, and repeated calls are idempotent (`refunded` flag).
- Event: `RoomRefunded { room_shard, envelope, destination, principal_usdc, remaining_pool_usdc }`.

### 4.3 Optional: time lock

If you want to bound authority discretion, require `Clock::unix_timestamp ≥ shard.end_ts + REFUND_GRACE_SECS` (e.g. 3600) unless the vault has zero envelopes. Reading `end_ts` needs the RoomShard as an extra read-only account, parsed with the same offset style as `parse_settled_room_shard` (`end_ts` is after `start_ts` and `unseal_ts`). Not required for Devnet.

---

## 5. `cartridge_passport`: idempotency marker for `record_elo_and_vault_credit` (M2) — Required

The app currently de-duplicates with MAC'd memos and a scan of the full history with relayer fee-payer checks. Replace that with an on-chain receipt.

### 5.1 New account

```rust
#[account]
#[derive(InitSpace)]
pub struct MatchCredit {
    pub passport_owner: Pubkey,
    pub room_shard: Pubkey,
    pub credited_units: u64,
    pub recorded_at: i64,
    pub bump: u8,
}
pub const SEED_MATCH_CREDIT: &[u8] = b"match_credit";
```

### 5.2 Instruction change

- `RecordEloArgs` gains `pub room_shard: Pubkey` (append as the last field).
- `RecordEloAndVaultCredit` gains:
  ```rust
  #[account(mut)]
  pub payer: Signer<'info>, // the relayer; may equal authority
  #[account(init, payer = payer, space = 8 + MatchCredit::INIT_SPACE,
            seeds = [SEED_MATCH_CREDIT, passport.owner.as_ref(), args.room_shard.as_ref()], bump)]
  pub match_credit: Account<'info, MatchCredit>,
  pub system_program: Program<'info, System>,
  ```
  (Add `#[instruction(args: RecordEloArgs)]` on the struct.) A second call for the same (owner, room) fails in `init` ("already in use"), so ELO and the earned-asset credit are applied at most once per room.
- Fill the receipt: `credited_units = args.asset_credit_units`, `recorded_at = Clock::unix_timestamp`, `bump`.

### 5.3 Recommended: bind the credit to the envelope

Pass the vault-router `SessionRiskEnvelope` as a read-only account. Require that it is owned by `Db58xz…`, that `env.room_shard == args.room_shard`, `env.funder == passport.owner` (needs §3.3 funder), `env.settled`, and `args.asset_credit_units == env.payout_usdc`. Derive `is_win` from `env.rank == 1`. The keeper can then no longer credit arbitrary amounts.

---

## 6. Migration of legacy accounts

The new structs are larger, so legacy accounts cannot be deserialized as `Account<RoomVault>` / `Account<SessionRiskEnvelope>` without migration.

- Add authority-only `migrate_room_vault_v2(ctx, buy_in_usdc: u64, max_envelopes: u16)`. It takes `room_vault` as `UncheckedAccount` with a seeds check, verifies `authority` from the v1 bytes, reallocs to `8 + RoomVault::INIT_SPACE` (relayer pays rent), and writes the new fields. Set `envelope_count` to the number of legacy envelopes, passed as remaining accounts and validated by PDA + `room_shard`, and `layout_version = 2`.
- Add authority-only `migrate_session_envelope_v2`, which reallocs one envelope and sets `funder = default`, `refunded = false`. Alternatively, `refund_unsettled_room` may read legacy envelopes from fixed v1 offsets. Pick one and test it.
- Legacy RoomShards / PlayerStances: no migration. Old rooms never get new stances (seat creation now needs the authority), and the vault router reads them only at the unchanged offsets.

Stranded test-USDC to refund after the upgrade. These are all unsettled, all relayer-authority vaults, all test-USDC:

| RoomVault | RoomShard | Pool (units) | Envelopes |
| :--- | :--- | ---: | :--- |
| `4xLxwKMy773jyEPY2hPH8HvCZq9K3x6tKtxY7jhk73WX` | `6VJeEkP2aitptmB3zwSYGg23VXQuxjPpitwLXkHX7YFh` | 35,000,000 | `2wuLQhzh…` (10 USDC), `2FSFzjfx…` (25 USDC) |
| `5ZFHEfv5UUXcwxPcq16NifCy9Hsh8xqg5J7HLSLspkvK` | `Eg67mLqGQKahqeBBGm3aERJMCLi5EB5uJ16VewH1Ygzq` | 15,000,000 | `r8E6eJfx…` |
| `FQRKtUJbTf4ydX6iN1sLoFUEMuRma4zm2BSauqv6fcoG` | `A2Pss5KZ6TiYcfi9odE79MVjdYV7E9uSe8Me9Hn58HN` | 10,000,000 | `89TB8CtZ…` |
| `4tB3Q3Q1fNj9NedCYLGonHspNidudc3jgNTz4QC77ZUE` | `BYAktBRVGRUvLG65swnwgXfcz7wQDXLe8HcWgmw6BwM3` | 0 | none |

No vault holds a settled-but-unclaimed envelope (checked 2026-11-27), so pausing claims strands no winnings.

---

## 7. Required tests (LiteSVM, `tests/onchain/`)

1. `init_stance_and_delegate` and `join_room_and_init_permission` fail without the room authority, or with a non-authority co-signer.
2. First `submit_stance` at `start_ts` fails with `EntryAfterStart`; a pivot before `start_ts` or at `end_ts` fails; a non-positive attested price fails; `submit_stance` without the authority fails.
3. `open_session_envelope`: wrong principal → `BuyInMismatch`; the 9th envelope with `max_envelopes = 8` → `RoomSeatsFull`; no authority → `Unauthorized`; deposit after a refund starts → `VaultRefunding`.
4. Distribution with `envelope_count != player_count` → `EnvelopeCountMismatch`. The happy path still conserves funds (`Σ payouts + fees ≤ pool`, dust stays in the vault).
5. Refund: non-authority → `Unauthorized`; refund after distribute → `VaultAlreadySettled`; a partial refund then the remainder (idempotent per envelope); the wrong destination owner → `RefundDestinationMismatch`; the vault ends `settled`; `current_global_tvl_usdc` is restored.
6. `record_elo_and_vault_credit` twice for the same (owner, room) → the second fails; different rooms → both succeed.
7. Migration: a v1 vault migrates to v2, then refunds correctly.

## 8. App switch-over checklist (owned by the app team, after deploy)

1. Rebuild `@cartridgefi/codama-clients` from the new IDLs.
2. `stakes-core.ts`:
   - `ensureRoomVault` passes `buy_in_usdc = stakeBuyInUnits(roomId)` and `max_envelopes = 8`;
   - `buildStakeTransaction` adds `room_authority` (relayer) and uses `funder` + `funder_usdc_ata`, dropping the transient player ATA;
   - the ELO step passes `room_shard`, `payer` and `match_credit`, and the memo-scan idempotency is removed;
   - add a `refundRoom` helper for `refund_unsettled_room`.
3. `server-chain.ts` (chain layer): add the relayer as `room_authority` on `init_stance_and_delegate`, `join_room_and_init_permission` and `submit_stance`.
4. Run `scripts/prove-stakes-devnet.ts` end to end, and refund the four legacy vaults from §6.
5. Only then set `BOREL_STAKES_ENABLED=true`.
