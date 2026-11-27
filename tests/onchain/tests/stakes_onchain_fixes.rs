#![forbid(unsafe_code)]
//! LiteSVM (MagicSVM) coverage for docs/specs/STAKES_ONCHAIN_FIXES.md:
//! authority co-signed seats / entries (C1), fixed buy-in + atomic seat cap (H1/H2),
//! authority-only refunds and v1 migration (H1/L1), MatchCredit ELO idempotency (M2).

use borsh::BorshSerialize;
use cartridgefi_onchain_tests::*;
use magicsvm::TransactionTarget;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{error::InstructionError, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_rent::Rent;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

const T0: i64 = 1_750_000_000;
const DURATION: i64 = 180;
const BUY_IN: u64 = 10_000_000;

// cartridge_er_room::ErRoomError (6000 + index)
const ER_UNAUTHORIZED_AUTHORITY: u32 = 6005;
const ER_MAX_REBALANCES_EXCEEDED: u32 = 6018;
const ER_ENTRY_AFTER_START: u32 = 6035;
const ER_PIVOT_OUTSIDE_LIVE_WINDOW: u32 = 6036;
const ER_INVALID_ATTESTED_PRICE: u32 = 6037;
// cartridge_vault_router::VaultError
const VAULT_UNAUTHORIZED: u32 = 6001;
const VAULT_ALREADY_SETTLED: u32 = 6016;
const VAULT_BUY_IN_MISMATCH: u32 = 6039;
const VAULT_ROOM_SEATS_FULL: u32 = 6040;
const VAULT_REFUNDING: u32 = 6041;
const VAULT_ENVELOPE_COUNT_MISMATCH: u32 = 6042;
const VAULT_INVALID_BUY_IN: u32 = 6043;
const VAULT_REFUND_DESTINATION_MISMATCH: u32 = 6044;
const VAULT_INVALID_LEGACY_LAYOUT: u32 = 6046;
// cartridge_passport::PassportError
const PASSPORT_CREDIT_MISMATCH: u32 = 6007;

fn send(
    h: &mut CartridgeTestHarness,
    target: TransactionTarget,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<(), (TransactionError, Vec<String>)> {
    h.svm.expire_blockhash_for(target);
    let tx = Transaction::new(
        signers,
        Message::new(ixs, Some(&payer.pubkey())),
        h.svm.latest_blockhash_for(target),
    );
    h.svm
        .send_transaction_to(target, tx)
        .map(|_| ())
        .map_err(|e| (e.err, e.meta.logs))
}

fn assert_custom_error(
    h: &mut CartridgeTestHarness,
    target: TransactionTarget,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
    expected: u32,
) {
    match send(h, target, ixs, payer, signers) {
        Err((TransactionError::InstructionError(_, InstructionError::Custom(code)), logs)) => {
            assert_eq!(code, expected, "unexpected error {code}; logs: {logs:?}");
        }
        Err((other, logs)) => panic!("expected Custom({expected}), got {other:?}; logs: {logs:?}"),
        Ok(()) => panic!("expected Custom({expected}), transaction succeeded"),
    }
}

fn assert_ok(
    h: &mut CartridgeTestHarness,
    target: TransactionTarget,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) {
    if let Err((err, logs)) = send(h, target, ixs, payer, signers) {
        panic!("transaction failed: {err:?}; logs: {logs:?}");
    }
}

fn manifest_args() -> RegisterCartridgeArgs {
    RegisterCartridgeArgs {
        slug_hash: slug_hash("borel-stakes-onchain-fixes"),
        creator_share_bps: 0,
        genre_code: 0,
        duration_secs: DURATION as u32,
        fog_of_war_bps: 9_000,
        max_rebalances: 2,
        scoring_formula: ScoringFormula::DirectionNeutralRelReturn,
        action_binding_mode: ActionBindingMode::ConvictionWeights,
        allowed_feeds_merkle_root: [0x33; 32],
        manifest_uri: pad_uri("https://cartridgefi.com/borel/stakes-onchain-fixes"),
    }
}

struct World {
    h: CartridgeTestHarness,
    admin: Keypair,
    manifest: Address,
    creator_fee_ata: Address,
}

fn boot() -> World {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();
    let creator_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let args = manifest_args();
    let platform = h.platform_fee_ata;
    h.send_base(
        &[
            ix_initialize_engine_config(
                admin.pubkey(),
                platform,
                true,
                BETA_MAX_ROOM_POOL_USDC,
                BETA_MAX_GLOBAL_TVL_USDC,
            ),
            ix_initialize_passport_config(admin.pubkey(), admin.pubkey()),
            ix_register_cartridge(admin.pubkey(), creator_fee_ata, &args),
        ],
        &admin,
        &[&admin],
    );
    let manifest = cartridge_manifest_pda(&args.slug_hash).0;
    World {
        h,
        admin,
        manifest,
        creator_fee_ata,
    }
}

fn open_room(w: &mut World, event_byte: u8, start_ts: i64) -> ([u8; 32], Address) {
    let event_id = [event_byte; 32];
    let shard = room_shard_pda(&event_id, 0).0;
    let admin = w.admin.insecure_clone();
    w.h.send_base(
        &[ix_initialize_room_shard(
            admin.pubkey(),
            w.manifest,
            &InitializeRoomShardArgs {
                event_id,
                shard_index: 0,
                start_ts,
                room_pool_usdc: 0,
                crank_task_id: 1,
            },
        )],
        &admin,
        &[&admin],
    );
    (event_id, shard)
}

fn open_vault(w: &mut World, shard: Address, buy_in: u64, max_envelopes: u16) {
    let admin = w.admin.insecure_clone();
    let (mint, platform, creator) = (w.h.usdc_mint, w.h.platform_fee_ata, w.creator_fee_ata);
    w.h.send_base(
        &[ix_initialize_room_vault(
            admin.pubkey(),
            shard,
            w.manifest,
            mint,
            platform,
            creator,
            None,
            100,
            false,
            buy_in,
            max_envelopes,
        )],
        &admin,
        &[&admin],
    );
}

struct Seat {
    player: Keypair,
    funder: Keypair,
    funder_ata: Address,
    envelope: Address,
}

/// Opens one envelope at `principal` (room authority co-signs, funder deposits).
fn stake_ix(
    w: &World,
    shard: Address,
    seat: &Seat,
    principal: u64,
    authority: Address,
) -> Instruction {
    ix_open_session_envelope(
        seat.player.pubkey(),
        authority,
        seat.funder.pubkey(),
        shard,
        w.h.usdc_mint,
        seat.funder_ata,
        principal,
        1,
        Keypair::new().pubkey(),
    )
}

fn new_seat(w: &mut World, shard: Address, funds: u64) -> Seat {
    let player = Keypair::new();
    let funder = Keypair::new();
    let mint = w.h.usdc_mint;
    let funder_ata =
        w.h.create_funded_token_account(mint, funder.pubkey(), funds);
    let envelope = session_envelope_pda(&shard, &player.pubkey()).0;
    Seat {
        player,
        funder,
        funder_ata,
        envelope,
    }
}

fn stake(w: &mut World, shard: Address, seat: &Seat) {
    let admin = w.admin.insecure_clone();
    let ix = stake_ix(w, shard, seat, BUY_IN, admin.pubkey());
    assert_ok(
        &mut w.h,
        TransactionTarget::Base,
        &[ix],
        &admin,
        &[&admin, &seat.player, &seat.funder],
    );
}

fn token_balance(h: &CartridgeTestHarness, ata: &Address) -> u64 {
    read_spl_token_balance(&h.svm.get_account_for(TransactionTarget::Base, ata).unwrap())
}

fn vault_state(h: &CartridgeTestHarness, shard: &Address) -> RoomVault {
    let acc = h
        .svm
        .get_account_for(TransactionTarget::Base, &room_vault_pda(shard).0)
        .unwrap();
    decode_anchor_account(&acc, "RoomVault")
}

fn envelope_state(h: &CartridgeTestHarness, env: &Address) -> SessionRiskEnvelope {
    let acc = h.svm.get_account_for(TransactionTarget::Base, env).unwrap();
    decode_anchor_account(&acc, "SessionRiskEnvelope")
}

fn engine_tvl(h: &CartridgeTestHarness) -> u64 {
    let acc = h
        .svm
        .get_account_for(TransactionTarget::Base, &engine_config_pda().0)
        .unwrap();
    decode_anchor_account::<EngineConfig>(&acc, "EngineConfig").current_global_tvl_usdc
}

fn anchor_account<T: BorshSerialize>(type_name: &str, value: &T, owner: Address) -> Account {
    let mut data = anchor_discriminator("account", type_name).to_vec();
    value.serialize(&mut data).unwrap();
    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

fn set_oracle(h: &mut CartridgeTestHarness, oracle: Address, now: i64) {
    h.svm
        .set_account(
            oracle,
            make_pyth_oracle_account(14_000_000_000, 5_000_000, now - 1, 100),
        )
        .unwrap();
}

fn stance_args(weights: [i16; 4], prices: [i64; 3]) -> SubmitStanceArgs {
    SubmitStanceArgs {
        weights_bps: weights,
        kalshi_binary_call: 0,
        kalshi_prob_bps: 5_000,
        secondary_prices_8: prices,
        stage1_score_scaled: 0,
    }
}

/// Delegated room + one authority-approved, ER-joined stance per player.
fn delegated_room_with_stances(
    w: &mut World,
    event_byte: u8,
    start_ts: i64,
    players: &[&Keypair],
    sessions: &[&Keypair],
) -> (Address, Vec<Address>) {
    let (event_id, shard) = open_room(w, event_byte, start_ts);
    let admin = w.admin.insecure_clone();
    let validator = w.h.svm.validator_identity();
    w.h.send_base(
        &[ix_delegate_room_shard(
            admin.pubkey(),
            event_id,
            0,
            Some(validator),
        )],
        &admin,
        &[&admin],
    );
    let mut stances = Vec::new();
    for (p, s) in players.iter().zip(sessions.iter()) {
        w.h.svm.airdrop(&p.pubkey(), 1_000_000_000).unwrap();
        assert_ok(
            &mut w.h,
            TransactionTarget::Base,
            &[ix_init_stance_and_delegate(
                p.pubkey(),
                shard,
                s.pubkey(),
                start_ts + DURATION,
                Some(validator),
                admin.pubkey(),
            )],
            p,
            &[*p, &admin],
        );
        let stance = player_stance_pda(&shard, &p.pubkey()).0;
        assert_ok(
            &mut w.h,
            TransactionTarget::Ephemeral,
            &[ix_join_room_and_init_permission(
                admin.pubkey(),
                shard,
                stance,
                admin.pubkey(),
            )],
            &admin,
            &[&admin],
        );
        stances.push(stance);
    }
    (shard, stances)
}

// ---------------------------------------------------------------------------
// §1 seat creation and join need the room authority (C1)
// ---------------------------------------------------------------------------

#[test]
fn outsider_stance_and_join_are_rejected() {
    let mut w = boot();
    let (event_id, shard) = open_room(&mut w, 0x51, T0 + 100);
    let admin = w.admin.insecure_clone();
    let validator = w.h.svm.validator_identity();
    w.h.send_base(
        &[ix_delegate_room_shard(
            admin.pubkey(),
            event_id,
            0,
            Some(validator),
        )],
        &admin,
        &[&admin],
    );

    let outsider = Keypair::new();
    let session = Keypair::new();
    w.h.svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
    let outsider_ix = |authority: Address| {
        ix_init_stance_and_delegate(
            outsider.pubkey(),
            shard,
            session.pubkey(),
            T0 + 100 + DURATION,
            Some(validator),
            authority,
        )
    };

    // Outsider self-co-signs: not the RoomShard authority.
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[outsider_ix(outsider.pubkey())],
        &outsider,
        &[&outsider],
        ER_UNAUTHORIZED_AUTHORITY,
    );
    // A non-authority co-signer.
    let stranger = Keypair::new();
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[outsider_ix(stranger.pubkey())],
        &outsider,
        &[&outsider, &stranger],
        ER_UNAUTHORIZED_AUTHORITY,
    );
    // The real authority listed but not signing.
    let mut unsigned = outsider_ix(admin.pubkey());
    unsigned.accounts.last_mut().unwrap().is_signer = false;
    assert!(
        send(
            &mut w.h,
            TransactionTarget::Base,
            &[unsigned],
            &outsider,
            &[&outsider]
        )
        .is_err(),
        "init_stance_and_delegate without the authority signature must fail"
    );
    let stance = player_stance_pda(&shard, &outsider.pubkey()).0;
    assert!(
        w.h.svm
            .get_account_for(TransactionTarget::Base, &stance)
            .map_or(true, |a| a.owner != DELEGATION_PROGRAM_ID),
        "no outsider stance may be created or delegated"
    );

    // Authority co-signed seat succeeds.
    assert_ok(
        &mut w.h,
        TransactionTarget::Base,
        &[outsider_ix(admin.pubkey())],
        &outsider,
        &[&outsider, &admin],
    );
    // Join co-signed by a non-authority (player is a permitted caller) is rejected and not counted.
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[ix_join_room_and_init_permission(
            outsider.pubkey(),
            shard,
            stance,
            stranger.pubkey(),
        )],
        &outsider,
        &[&outsider, &stranger],
        ER_UNAUTHORIZED_AUTHORITY,
    );
    let shard_er: RoomShard = decode_anchor_account(
        &w.h.svm
            .get_account_for(TransactionTarget::Ephemeral, &shard)
            .unwrap(),
        "RoomShard",
    );
    assert_eq!(shard_er.player_count, 0);
    assert_ok(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[ix_join_room_and_init_permission(
            outsider.pubkey(),
            shard,
            stance,
            admin.pubkey(),
        )],
        &outsider,
        &[&outsider, &admin],
    );
    let shard_er: RoomShard = decode_anchor_account(
        &w.h.svm
            .get_account_for(TransactionTarget::Ephemeral, &shard)
            .unwrap(),
        "RoomShard",
    );
    assert_eq!(shard_er.player_count, 1);
}

// ---------------------------------------------------------------------------
// §2 entry before start_ts, attested prices, pivots only while live (C1)
// ---------------------------------------------------------------------------

#[test]
fn late_or_caller_priced_submit_is_rejected() {
    let mut w = boot();
    let start = T0 + 100;
    let (a, b, c) = (Keypair::new(), Keypair::new(), Keypair::new());
    let (sa, sb, sc) = (Keypair::new(), Keypair::new(), Keypair::new());
    let (shard, stances) =
        delegated_room_with_stances(&mut w, 0x52, start, &[&a, &b, &c], &[&sa, &sb, &sc]);
    let admin = w.admin.insecure_clone();
    let oracle = Address::new_from_array([0x77; 32]);
    w.h.set_clock(200, T0);
    set_oracle(&mut w.h, oracle, T0);
    let prices = [6_000_000_000_000i64, 300_000_000_000, 18_000_000_000];
    let hand = [0i16, 3_000, -1_000, 2_000];
    let submit =
        |session: &Keypair, stance: Address, authority: Address, args: &SubmitStanceArgs| {
            ix_submit_stance(session.pubkey(), shard, stance, oracle, authority, args)
        };

    // Non-positive attested entry price (no silent oracle fallback).
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[submit(
            &sa,
            stances[0],
            admin.pubkey(),
            &stance_args(hand, [prices[0], 0, prices[2]]),
        )],
        &admin,
        &[&admin, &sa],
        ER_INVALID_ATTESTED_PRICE,
    );
    // Caller-priced entry without the authority co-signature.
    let stranger = Keypair::new();
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[submit(
            &sa,
            stances[0],
            stranger.pubkey(),
            &stance_args(hand, prices),
        )],
        &sa,
        &[&sa, &stranger],
        ER_UNAUTHORIZED_AUTHORITY,
    );
    // Valid sealed entries before start_ts (A and C).
    for (s, st) in [(&sa, stances[0]), (&sc, stances[2])] {
        assert_ok(
            &mut w.h,
            TransactionTarget::Ephemeral,
            &[submit(s, st, admin.pubkey(), &stance_args(hand, prices))],
            &admin,
            &[&admin, s],
        );
    }
    // The stance is private on the ER: read it as the room authority (a permission member).
    w.h.svm.set_authorized_user(Some(admin.pubkey()));
    let stance_a: PlayerStance = decode_anchor_account(
        &w.h.svm
            .get_account_for(TransactionTarget::Ephemeral, &stances[0])
            .unwrap(),
        "PlayerStance",
    );
    assert_eq!(stance_a.entry_prices_8[1..], prices[..]);
    // A pivot before start_ts is rejected.
    let pivot = stance_args([0, -3_000, -1_000, 2_000], [0, 0, 0]);
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[submit(&sa, stances[0], admin.pubkey(), &pivot)],
        &admin,
        &[&admin, &sa],
        ER_PIVOT_OUTSIDE_LIVE_WINDOW,
    );

    // At start_ts: a first move (entry) is too late; A's pivot is accepted.
    w.h.set_clock(300, start);
    set_oracle(&mut w.h, oracle, start);
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[submit(
            &sb,
            stances[1],
            admin.pubkey(),
            &stance_args(hand, prices),
        )],
        &admin,
        &[&admin, &sb],
        ER_ENTRY_AFTER_START,
    );
    assert_ok(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[submit(&sa, stances[0], admin.pubkey(), &pivot)],
        &admin,
        &[&admin, &sa],
    );
    // max_rebalances = 2 still caps a third move.
    w.h.set_clock(301, start + 1);
    set_oracle(&mut w.h, oracle, start + 1);
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[submit(
            &sa,
            stances[0],
            admin.pubkey(),
            &stance_args(hand, [0, 0, 0]),
        )],
        &admin,
        &[&admin, &sa],
        ER_MAX_REBALANCES_EXCEEDED,
    );

    // At end_ts a pivot is outside the live window.
    let end = start + DURATION;
    w.h.set_clock(400, end);
    set_oracle(&mut w.h, oracle, end);
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Ephemeral,
        &[submit(&sc, stances[2], admin.pubkey(), &pivot)],
        &admin,
        &[&admin, &sc],
        ER_PIVOT_OUTSIDE_LIVE_WINDOW,
    );
}

// ---------------------------------------------------------------------------
// §3 fixed buy-in, atomic seat cap, authority gate (C1, H1, H2)
// ---------------------------------------------------------------------------

#[test]
fn buy_in_and_seat_cap_are_enforced() {
    let mut w = boot();
    let admin = w.admin.insecure_clone();
    let (_, shard) = open_room(&mut w, 0x53, T0 + 100);

    // initialize_room_vault bounds: seat cap 1..=8, full room must fit the (beta) pool cap.
    let (mint, platform, creator) = (w.h.usdc_mint, w.h.platform_fee_ata, w.creator_fee_ata);
    for (buy_in, max) in [
        (BUY_IN, 9u16),
        (BUY_IN, 0),
        (0, 8),
        (BETA_MAX_ROOM_POOL_USDC / 8 + 1, 8),
    ] {
        assert_custom_error(
            &mut w.h,
            TransactionTarget::Base,
            &[ix_initialize_room_vault(
                admin.pubkey(),
                shard,
                w.manifest,
                mint,
                platform,
                creator,
                None,
                100,
                false,
                buy_in,
                max,
            )],
            &admin,
            &[&admin],
            VAULT_INVALID_BUY_IN,
        );
    }
    open_vault(&mut w, shard, BUY_IN, 8);
    let v = vault_state(&w.h, &shard);
    assert_eq!(
        (
            v.buy_in_usdc,
            v.max_envelopes,
            v.envelope_count,
            v.layout_version
        ),
        (BUY_IN, 8, 0, 2)
    );

    let seat = new_seat(&mut w, shard, 100_000_000);
    // Wrong principal.
    for principal in [BUY_IN - 1, BUY_IN + 1, 25_000_000] {
        let ix = stake_ix(&w, shard, &seat, principal, admin.pubkey());
        assert_custom_error(
            &mut w.h,
            TransactionTarget::Base,
            &[ix],
            &admin,
            &[&admin, &seat.player, &seat.funder],
            VAULT_BUY_IN_MISMATCH,
        );
    }
    // No room authority: the funder tries to approve its own seat.
    let ix = stake_ix(&w, shard, &seat, BUY_IN, seat.funder.pubkey());
    w.h.svm
        .airdrop(&seat.funder.pubkey(), 1_000_000_000)
        .unwrap();
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix],
        &seat.funder,
        &[&seat.funder, &seat.player],
        VAULT_UNAUTHORIZED,
    );

    // Eight seats fill the room; the ninth is rejected on-chain.
    stake(&mut w, shard, &seat);
    let env = envelope_state(&w.h, &seat.envelope);
    assert_eq!(
        (env.funder, env.refunded, env.principal_usdc),
        (seat.funder.pubkey(), false, BUY_IN)
    );
    assert_eq!(token_balance(&w.h, &seat.funder_ata), 100_000_000 - BUY_IN);
    for _ in 1..8 {
        let s = new_seat(&mut w, shard, BUY_IN);
        stake(&mut w, shard, &s);
    }
    let v = vault_state(&w.h, &shard);
    assert_eq!((v.envelope_count, v.room_pool_usdc), (8, 8 * BUY_IN));
    let ninth = new_seat(&mut w, shard, BUY_IN);
    let ix = stake_ix(&w, shard, &ninth, BUY_IN, admin.pubkey());
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix],
        &admin,
        &[&admin, &ninth.player, &ninth.funder],
        VAULT_ROOM_SEATS_FULL,
    );
}

// ---------------------------------------------------------------------------
// §4 authority-only refund (H1, L1)
// ---------------------------------------------------------------------------

#[test]
fn refund_is_authority_only_partial_and_idempotent() {
    let mut w = boot();
    let admin = w.admin.insecure_clone();
    let (_, shard) = open_room(&mut w, 0x54, T0 + 100);
    open_vault(&mut w, shard, BUY_IN, 8);
    let seats: Vec<Seat> = (0..3).map(|_| new_seat(&mut w, shard, BUY_IN)).collect();
    for s in &seats {
        stake(&mut w, shard, s);
    }
    assert_eq!(engine_tvl(&w.h), 3 * BUY_IN);
    let mint = w.h.usdc_mint;
    let pair = |s: &Seat| (s.envelope, s.funder_ata);

    // Non-authority.
    let outsider = Keypair::new();
    w.h.svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix_refund_unsettled_room(
            outsider.pubkey(),
            shard,
            mint,
            &[pair(&seats[0])],
        )],
        &outsider,
        &[&outsider],
        VAULT_UNAUTHORIZED,
    );
    // Wrong destination owner (someone else's USDC account).
    let thief_ata = w.h.create_funded_token_account(mint, outsider.pubkey(), 0);
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix_refund_unsettled_room(
            admin.pubkey(),
            shard,
            mint,
            &[(seats[0].envelope, thief_ata)],
        )],
        &admin,
        &[&admin],
        VAULT_REFUND_DESTINATION_MISMATCH,
    );

    // Partial refund: seat 0 only.
    w.h.send_base(
        &[ix_refund_unsettled_room(
            admin.pubkey(),
            shard,
            mint,
            &[pair(&seats[0])],
        )],
        &admin,
        &[&admin],
    );
    assert_eq!(token_balance(&w.h, &seats[0].funder_ata), BUY_IN);
    let v = vault_state(&w.h, &shard);
    assert!(v.refunding && !v.settled);
    assert_eq!((v.refunded_count, v.room_pool_usdc), (1, 2 * BUY_IN));
    assert!(envelope_state(&w.h, &seats[0].envelope).refunded);

    // Deposits are closed once refunding starts.
    let late = new_seat(&mut w, shard, BUY_IN);
    let ix = stake_ix(&w, shard, &late, BUY_IN, admin.pubkey());
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix],
        &admin,
        &[&admin, &late.player, &late.funder],
        VAULT_REFUNDING,
    );

    // Remainder; seat 0 again is skipped (idempotent), not paid twice.
    w.h.send_base(
        &[ix_refund_unsettled_room(
            admin.pubkey(),
            shard,
            mint,
            &[pair(&seats[0]), pair(&seats[1]), pair(&seats[2])],
        )],
        &admin,
        &[&admin],
    );
    for s in &seats {
        assert_eq!(token_balance(&w.h, &s.funder_ata), BUY_IN);
        let e = envelope_state(&w.h, &s.envelope);
        assert!(e.refunded && e.settled && e.payout_usdc == 0);
    }
    let v = vault_state(&w.h, &shard);
    assert!(v.settled);
    assert_eq!(
        (v.refunded_count, v.envelope_count, v.room_pool_usdc),
        (3, 3, 0)
    );
    assert_eq!(token_balance(&w.h, &room_vault_token_pda(&shard).0), 0);
    assert_eq!(engine_tvl(&w.h), 0, "global TVL restored");
    // Terminal: no second refund.
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix_refund_unsettled_room(
            admin.pubkey(),
            shard,
            mint,
            &[pair(&seats[1])],
        )],
        &admin,
        &[&admin],
        VAULT_ALREADY_SETTLED,
    );

    // An empty vault refunds straight to settled.
    let (_, empty_shard) = open_room(&mut w, 0x55, T0 + 100);
    open_vault(&mut w, empty_shard, BUY_IN, 8);
    w.h.send_base(
        &[ix_refund_unsettled_room(
            admin.pubkey(),
            empty_shard,
            mint,
            &[],
        )],
        &admin,
        &[&admin],
    );
    assert!(vault_state(&w.h, &empty_shard).settled);
}

// ---------------------------------------------------------------------------
// §3.4 distribution needs every envelope; §5 MatchCredit idempotency (M2)
// ---------------------------------------------------------------------------

/// Writes a SettledCommitted RoomShard and evaluated PlayerStances on L1 (what settle_and_commit_shard leaves).
fn commit_room(
    w: &mut World,
    shard: Address,
    admin: Address,
    counted: u16,
    seats: &[&Seat],
    scores: &[i128],
) -> Vec<Address> {
    let room = RoomShard {
        event_id: [0x99; 32],
        shard_index: 0,
        cartridge_manifest: w.manifest,
        authority: admin,
        phase: RoomPhase::SettledCommitted,
        scoring_formula: 0,
        action_binding_mode: 0,
        max_rebalances: 2,
        is_private_fog: false,
        player_count: counted,
        evaluated_count: counted,
        start_ts: T0 + 100,
        unseal_ts: T0 + 262,
        end_ts: T0 + 100 + DURATION,
        room_pool_usdc: 0,
        crank_task_id: 1,
        vrf_request_nonce: 1,
        vrf_seed: [7; 32],
        vrf_fulfilled: true,
        kalshi_outcome_yes: 0,
        settlement_prices_8: [0; 4],
        public_rank_digest: [0; 32],
        bump: 255,
    };
    w.h.svm
        .set_account(
            shard,
            anchor_account("RoomShard", &room, CARTRIDGE_ER_ROOM_ID),
        )
        .unwrap();
    seats
        .iter()
        .zip(scores.iter())
        .map(|(s, score)| {
            let (stance, bump) = player_stance_pda(&shard, &s.player.pubkey());
            let st = PlayerStance {
                room_shard: shard,
                player: s.player.pubkey(),
                ephemeral_session_key: Keypair::new().pubkey(),
                session_expiry_ts: T0 + 280,
                last_move_ts: T0 + 50,
                move_count: 1,
                weights_bps: [0, 3_000, -1_000, 2_000],
                kalshi_binary_call: 0,
                kalshi_prob_bps: 5_000,
                entry_prices_8: [0; 4],
                step_returns_scaled: [0; 8],
                step_count: 0,
                max_drawdown_scaled: 0,
                stage1_score_scaled: 0,
                final_score_scaled: *score,
                joined_er: true,
                evaluated: true,
                rank: 0,
                claimed: false,
                bump,
            };
            w.h.svm
                .set_account(
                    stance,
                    anchor_account("PlayerStance", &st, CARTRIDGE_ER_ROOM_ID),
                )
                .unwrap();
            stance
        })
        .collect()
}

fn distribute_ix(
    w: &World,
    admin: Address,
    shard: Address,
    pairs: &[(Address, Address)],
) -> Instruction {
    ix_distribute_pool_and_fees(
        admin,
        shard,
        w.h.usdc_mint,
        w.h.platform_fee_ata,
        w.creator_fee_ata,
        None,
        pairs,
    )
}

fn elo_args(room_shard: Address, units: u64, is_win: bool) -> RecordEloArgs {
    RecordEloArgs {
        room_mean_elo_scaled: 1_200 * SCALE,
        placement_score_scaled: if is_win { SCALE } else { 0 },
        is_live_mode: true,
        is_win,
        sharpe_score_scaled: None,
        brier_score_scaled: None,
        asset_credit_kind: AssetCreditKind::Usdc,
        asset_credit_units: units,
        room_shard,
    }
}

#[test]
fn distribution_needs_every_envelope_and_elo_credits_once_per_room() {
    let mut w = boot();
    let admin = w.admin.insecure_clone();
    let mint = w.h.usdc_mint;
    let wallet = Keypair::new();
    w.h.svm.airdrop(&wallet.pubkey(), 1_000_000_000).unwrap();
    w.h.send_base(
        &[ix_initialize_passport(admin.pubkey(), wallet.pubkey())],
        &admin,
        &[&admin, &wallet],
    );

    let mut credited_rooms = Vec::new();
    for (round, event_byte) in [(0u8, 0x61u8), (1, 0x62)] {
        let (_, shard) = open_room(&mut w, event_byte, T0 + 100);
        open_vault(&mut w, shard, BUY_IN, 8);
        let mut a = new_seat(&mut w, shard, 0);
        // The same staking wallet funds seat A in both rooms.
        a.funder = wallet.insecure_clone();
        a.funder_ata =
            w.h.create_funded_token_account(mint, wallet.pubkey(), BUY_IN);
        let b = new_seat(&mut w, shard, BUY_IN);
        stake(&mut w, shard, &a);
        stake(&mut w, shard, &b);

        // A counted player without an envelope (3 counted, 2 envelopes) cannot be distributed.
        let stances = commit_room(
            &mut w,
            shard,
            admin.pubkey(),
            3,
            &[&a, &b],
            &[5 * SCALE, SCALE],
        );
        let pairs = [(stances[0], a.envelope), (stances[1], b.envelope)];
        let ix = distribute_ix(&w, admin.pubkey(), shard, &pairs);
        assert_custom_error(
            &mut w.h,
            TransactionTarget::Base,
            &[ix],
            &admin,
            &[&admin],
            VAULT_ENVELOPE_COUNT_MISMATCH,
        );

        // Every envelope paired with a counted, evaluated stance: distributes and conserves funds.
        let stances = commit_room(
            &mut w,
            shard,
            admin.pubkey(),
            2,
            &[&a, &b],
            &[5 * SCALE, SCALE],
        );
        let pairs = [(stances[0], a.envelope), (stances[1], b.envelope)];
        let fee_before = token_balance(&w.h, &w.h.platform_fee_ata.clone());
        let ix = distribute_ix(&w, admin.pubkey(), shard, &pairs);
        assert_ok(&mut w.h, TransactionTarget::Base, &[ix], &admin, &[&admin]);
        let (ea, eb) = (
            envelope_state(&w.h, &a.envelope),
            envelope_state(&w.h, &b.envelope),
        );
        let fee = token_balance(&w.h, &w.h.platform_fee_ata.clone()) - fee_before;
        let pool = 2 * BUY_IN;
        assert_eq!(ea.rank, 1);
        assert!(ea.payout_usdc + eb.payout_usdc + fee <= pool, "solvency");
        assert_eq!(
            token_balance(&w.h, &room_vault_token_pda(&shard).0),
            pool - fee,
            "payouts stay in the vault until claimed; dust never leaves it"
        );

        // Refund after distribution is rejected.
        let ix =
            ix_refund_unsettled_room(admin.pubkey(), shard, mint, &[(a.envelope, a.funder_ata)]);
        assert_custom_error(
            &mut w.h,
            TransactionTarget::Base,
            &[ix],
            &admin,
            &[&admin],
            VAULT_ALREADY_SETTLED,
        );

        // Claims pay the funder only.
        let player_ata = w.h.create_funded_token_account(mint, a.player.pubkey(), 0);
        let claim = |dest: Address| {
            ix_claim_prize(
                a.player.pubkey(),
                a.player.pubkey(),
                shard,
                mint,
                mint,
                dest,
                None,
                None,
                None,
                0,
            )
        };
        assert_custom_error(
            &mut w.h,
            TransactionTarget::Base,
            &[claim(player_ata)],
            &admin,
            &[&admin, &a.player],
            VAULT_UNAUTHORIZED,
        );
        let before = token_balance(&w.h, &a.funder_ata);
        assert_ok(
            &mut w.h,
            TransactionTarget::Base,
            &[claim(a.funder_ata)],
            &admin,
            &[&admin, &a.player],
        );
        assert_eq!(token_balance(&w.h, &a.funder_ata), before + ea.payout_usdc);

        // ELO credit bound to the settled envelope: wrong amount is rejected.
        let elo = |units: u64, win: bool| {
            ix_record_elo_and_vault_credit(
                admin.pubkey(),
                wallet.pubkey(),
                admin.pubkey(),
                a.envelope,
                &elo_args(shard, units, win),
            )
        };
        assert_custom_error(
            &mut w.h,
            TransactionTarget::Base,
            &[elo(ea.payout_usdc + 1, true)],
            &admin,
            &[&admin],
            PASSPORT_CREDIT_MISMATCH,
        );
        assert_custom_error(
            &mut w.h,
            TransactionTarget::Base,
            &[elo(ea.payout_usdc, false)],
            &admin,
            &[&admin],
            PASSPORT_CREDIT_MISMATCH,
        );
        assert_ok(
            &mut w.h,
            TransactionTarget::Base,
            &[elo(ea.payout_usdc, true)],
            &admin,
            &[&admin],
        );
        // Second credit for the same (wallet, room): the MatchCredit receipt already exists.
        assert!(
            send(
                &mut w.h,
                TransactionTarget::Base,
                &[elo(ea.payout_usdc, true)],
                &admin,
                &[&admin]
            )
            .is_err(),
            "double ELO credit must fail (round {round})"
        );
        let receipt: MatchCredit = decode_anchor_account(
            &w.h.svm
                .get_account_for(
                    TransactionTarget::Base,
                    &match_credit_pda(&wallet.pubkey(), &shard).0,
                )
                .unwrap(),
            "MatchCredit",
        );
        assert_eq!(
            (
                receipt.passport_owner,
                receipt.room_shard,
                receipt.credited_units
            ),
            (wallet.pubkey(), shard, ea.payout_usdc)
        );
        credited_rooms.push((shard, ea.payout_usdc));
    }
    // Different rooms: both credits applied.
    let passport: MarketPassport = decode_anchor_account(
        &w.h.svm
            .get_account_for(
                TransactionTarget::Base,
                &market_passport_pda(&wallet.pubkey()).0,
            )
            .unwrap(),
        "MarketPassport",
    );
    assert_eq!(passport.matches_played, 2);
    assert_eq!(passport.wins_count, 2);
    assert_eq!(
        passport.earned_usdc_units,
        credited_rooms.iter().map(|(_, u)| *u).sum::<u64>()
    );
}

// ---------------------------------------------------------------------------
// §6 migration: a v1 vault (and its v1 envelopes) migrates, then refunds
// ---------------------------------------------------------------------------

#[derive(BorshSerialize)]
struct RoomVaultV1 {
    room_shard: Address,
    authority: Address,
    usdc_mint: Address,
    vault_usdc_token: Address,
    cartridge_manifest: Address,
    creator_fee_vault: Address,
    platform_fee_account: Address,
    partner_fee_vault: Address,
    partner_wallet_active: bool,
    creator_share_bps: u16,
    total_fee_bps: u16,
    room_pool_usdc: u64,
    total_distributed_usdc: u64,
    total_claimed_usdc: u64,
    settled: bool,
    bump: u8,
}

#[derive(BorshSerialize)]
struct SessionRiskEnvelopeV1 {
    room_shard: Address,
    player: Address,
    ephemeral_session_key: Address,
    principal_usdc: u64,
    leverage: u8,
    payout_usdc: u64,
    rank: u16,
    settled: bool,
    claimed: bool,
    claimed_mint: Address,
    bump: u8,
}

#[test]
fn legacy_v1_vault_migrates_then_refunds() {
    let mut w = boot();
    let admin = w.admin.insecure_clone();
    let mint = w.h.usdc_mint;
    let shard = room_shard_pda(&[0x71; 32], 0).0;
    let (vault, vault_bump) = room_vault_pda(&shard);
    let vault_token = room_vault_token_pda(&shard).0;
    let principals = [10_000_000u64, 25_000_000];
    let pool: u64 = principals.iter().sum();
    let players = [Keypair::new(), Keypair::new()];

    let v1 = RoomVaultV1 {
        room_shard: shard,
        authority: admin.pubkey(),
        usdc_mint: mint,
        vault_usdc_token: vault_token,
        cartridge_manifest: w.manifest,
        creator_fee_vault: w.creator_fee_ata,
        platform_fee_account: w.h.platform_fee_ata,
        partner_fee_vault: Address::default(),
        partner_wallet_active: false,
        creator_share_bps: 0,
        total_fee_bps: 100,
        room_pool_usdc: pool,
        total_distributed_usdc: 0,
        total_claimed_usdc: 0,
        settled: false,
        bump: vault_bump,
    };
    let vault_acc = anchor_account("RoomVault", &v1, CARTRIDGE_VAULT_ROUTER_ID);
    assert_eq!(vault_acc.data.len(), 295);
    w.h.svm.set_account(vault, vault_acc).unwrap();
    w.h.svm
        .set_account(vault_token, make_spl_token_account(&mint, &vault, pool))
        .unwrap();
    let envelopes: Vec<Address> = players
        .iter()
        .zip(principals.iter())
        .map(|(p, principal)| {
            let (env, bump) = session_envelope_pda(&shard, &p.pubkey());
            let e = SessionRiskEnvelopeV1 {
                room_shard: shard,
                player: p.pubkey(),
                ephemeral_session_key: Keypair::new().pubkey(),
                principal_usdc: *principal,
                leverage: 1,
                payout_usdc: 0,
                rank: 0,
                settled: false,
                claimed: false,
                claimed_mint: Address::default(),
                bump,
            };
            let acc = anchor_account("SessionRiskEnvelope", &e, CARTRIDGE_VAULT_ROUTER_ID);
            assert_eq!(acc.data.len(), 158);
            w.h.svm.set_account(env, acc).unwrap();
            env
        })
        .collect();
    // The legacy pool is part of the global TVL.
    let cfg_key = engine_config_pda().0;
    let mut cfg_acc =
        w.h.svm
            .get_account_for(TransactionTarget::Base, &cfg_key)
            .unwrap();
    let mut cfg: EngineConfig = decode_anchor_account(&cfg_acc, "EngineConfig");
    cfg.current_global_tvl_usdc = pool;
    let mut data = anchor_discriminator("account", "EngineConfig").to_vec();
    cfg.serialize(&mut data).unwrap();
    data.resize(cfg_acc.data.len(), 0);
    cfg_acc.data = data;
    w.h.svm.set_account(cfg_key, cfg_acc).unwrap();

    // A v1 vault cannot be refunded before migration.
    let pairs: Vec<(Address, Address)> = players
        .iter()
        .zip(envelopes.iter())
        .map(|(p, e)| (*e, w.h.create_funded_token_account(mint, p.pubkey(), 0)))
        .collect();
    assert!(send(
        &mut w.h,
        TransactionTarget::Base,
        &[ix_refund_unsettled_room(
            admin.pubkey(),
            shard,
            mint,
            &pairs
        )],
        &admin,
        &[&admin]
    )
    .is_err());

    // Non-authority, and a migration that omits a legacy envelope, are rejected.
    let outsider = Keypair::new();
    w.h.svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix_migrate_room_vault_v2(
            outsider.pubkey(),
            shard,
            BUY_IN,
            8,
            &envelopes,
        )],
        &outsider,
        &[&outsider],
        VAULT_UNAUTHORIZED,
    );
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix_migrate_room_vault_v2(
            admin.pubkey(),
            shard,
            BUY_IN,
            8,
            &envelopes[..1],
        )],
        &admin,
        &[&admin],
        VAULT_ENVELOPE_COUNT_MISMATCH,
    );
    w.h.send_base(
        &[ix_migrate_room_vault_v2(
            admin.pubkey(),
            shard,
            BUY_IN,
            8,
            &envelopes,
        )],
        &admin,
        &[&admin],
    );
    let v = vault_state(&w.h, &shard);
    assert_eq!(
        (
            v.envelope_count,
            v.max_envelopes,
            v.layout_version,
            v.room_pool_usdc
        ),
        (2, 8, 2, pool)
    );
    for e in &envelopes {
        let env = envelope_state(&w.h, e);
        assert_eq!((env.funder, env.refunded), (Address::default(), false));
    }
    assert_custom_error(
        &mut w.h,
        TransactionTarget::Base,
        &[ix_migrate_room_vault_v2(
            admin.pubkey(),
            shard,
            BUY_IN,
            8,
            &envelopes,
        )],
        &admin,
        &[&admin],
        VAULT_INVALID_LEGACY_LAYOUT,
    );

    // Legacy envelopes (no funder) refund to the player key's USDC account.
    w.h.send_base(
        &[ix_refund_unsettled_room(
            admin.pubkey(),
            shard,
            mint,
            &pairs,
        )],
        &admin,
        &[&admin],
    );
    for ((_, dest), principal) in pairs.iter().zip(principals.iter()) {
        assert_eq!(token_balance(&w.h, dest), *principal);
    }
    let v = vault_state(&w.h, &shard);
    assert!(v.settled && v.room_pool_usdc == 0);
    assert_eq!(token_balance(&w.h, &vault_token), 0);
    assert_eq!(engine_tvl(&w.h), 0);
}
