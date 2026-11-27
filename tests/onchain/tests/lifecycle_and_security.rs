#![forbid(unsafe_code)]

use cartridgefi_onchain_tests::*;
use magicsvm::TransactionTarget;
use solana_address::Address;
use solana_instruction::{error::InstructionError, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

fn assert_custom_error(
    harness: &mut CartridgeTestHarness,
    target: TransactionTarget,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
    expected_code: u32,
) {
    harness.svm.expire_blockhash_for(target);
    let tx = Transaction::new(
        signers,
        Message::new(ixs, Some(&payer.pubkey())),
        harness.svm.latest_blockhash_for(target),
    );
    let err = harness
        .svm
        .send_transaction_to(target, tx)
        .expect_err("expected transaction to fail with custom error");
    match err.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => {
            assert_eq!(
                code, expected_code,
                "unexpected custom error code {code} (expected {expected_code}); logs: {:?}",
                err.meta.logs
            );
        }
        other => panic!(
            "expected Custom({expected_code}), got {other:?}; logs: {:?}",
            err.meta.logs
        ),
    }
}

fn assert_tx_fails(
    harness: &mut CartridgeTestHarness,
    target: TransactionTarget,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) {
    harness.svm.expire_blockhash_for(target);
    let tx = Transaction::new(
        signers,
        Message::new(ixs, Some(&payer.pubkey())),
        harness.svm.latest_blockhash_for(target),
    );
    assert!(
        harness.svm.send_transaction_to(target, tx).is_err(),
        "expected adversarial transaction to fail"
    );
}

fn borel_manifest_args() -> RegisterCartridgeArgs {
    RegisterCartridgeArgs {
        slug_hash: slug_hash("borel-blind-conviction-blitz-001"),
        creator_share_bps: 5_000,
        genre_code: 1,
        duration_secs: 60,
        fog_of_war_bps: 7_500, // First 75% (45s) Fog of War, final 15s Showdown
        max_rebalances: 6,
        scoring_formula: ScoringFormula::DirectionNeutralRelReturn,
        action_binding_mode: ActionBindingMode::ConvictionWeights,
        allowed_feeds_merkle_root: [0x11; 32],
        manifest_uri: pad_uri("https://cartridgefi.com/manifests/borel-001.json"),
    }
}

fn pulse_runner_manifest_args() -> RegisterCartridgeArgs {
    RegisterCartridgeArgs {
        slug_hash: slug_hash("pulse-runner-volatility-arcade-002"),
        creator_share_bps: 5_000,
        genre_code: 2,
        duration_secs: 90,
        fog_of_war_bps: 5_000,
        max_rebalances: 12,
        scoring_formula: ScoringFormula::DrawdownPenalizedSharpe,
        action_binding_mode: ActionBindingMode::ThreeLaneStance,
        allowed_feeds_merkle_root: [0x22; 32],
        manifest_uri: pad_uri("https://cartridgefi.com/manifests/pulse-runner-002.json"),
    }
}

#[test]
fn test_a_engine_config_and_multi_genre_cartridge_manifests() {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();

    // 1. Initialize global EngineConfig with platform_fee_account wired and private_beta_mode = true
    let init_cfg_ix = ix_initialize_engine_config(
        admin.pubkey(),
        h.platform_fee_ata,
        true,
        BETA_MAX_ROOM_POOL_USDC,
        BETA_MAX_GLOBAL_TVL_USDC,
    );
    h.send_base(&[init_cfg_ix], &admin, &[&admin]);

    let (cfg_pda, _) = engine_config_pda();
    let cfg_acc = h
        .svm
        .get_account_for(TransactionTarget::Base, &cfg_pda)
        .expect("engine_config exists");
    let cfg: EngineConfig = decode_anchor_account(&cfg_acc, "EngineConfig");
    assert_eq!(cfg.admin_multisig, admin.pubkey());
    assert_eq!(cfg.platform_fee_account, h.platform_fee_ata);
    assert!(cfg.private_beta_mode);
    assert_eq!(cfg.max_room_pool_usdc, BETA_MAX_ROOM_POOL_USDC);
    assert_eq!(cfg.max_global_tvl_usdc, BETA_MAX_GLOBAL_TVL_USDC);
    assert_eq!(cfg.current_global_tvl_usdc, 0);
    assert!(!cfg.paused);

    // 2. Register BOTH Borel #001 (Blind Conviction Blitz) & Pulse Runner #002 (3-lane runner)
    //    against the exact same parameterized cartridge-registry & cartridge-er-room programs.
    let borel_creator = Keypair::new();
    let runner_creator = Keypair::new();
    h.svm
        .airdrop(&borel_creator.pubkey(), 10_000_000_000)
        .unwrap();
    h.svm
        .airdrop(&runner_creator.pubkey(), 10_000_000_000)
        .unwrap();

    let borel_fee_ata = h.create_funded_token_account(h.usdc_mint, borel_creator.pubkey(), 0);
    let runner_fee_ata = h.create_funded_token_account(h.usdc_mint, runner_creator.pubkey(), 0);

    let borel_args = borel_manifest_args();
    let runner_args = pulse_runner_manifest_args();

    h.send_base(
        &[ix_register_cartridge(
            borel_creator.pubkey(),
            borel_fee_ata,
            &borel_args,
        )],
        &borel_creator,
        &[&borel_creator],
    );
    h.send_base(
        &[ix_register_cartridge(
            runner_creator.pubkey(),
            runner_fee_ata,
            &runner_args,
        )],
        &runner_creator,
        &[&runner_creator],
    );

    let (borel_manifest_pda, _) = cartridge_manifest_pda(&borel_args.slug_hash);
    let (runner_manifest_pda, _) = cartridge_manifest_pda(&runner_args.slug_hash);

    let borel_manifest: CartridgeManifestAccount = decode_anchor_account(
        &h.svm.get_account(&borel_manifest_pda).unwrap(),
        "CartridgeManifestAccount",
    );
    let runner_manifest: CartridgeManifestAccount = decode_anchor_account(
        &h.svm.get_account(&runner_manifest_pda).unwrap(),
        "CartridgeManifestAccount",
    );

    assert_eq!(
        borel_manifest.scoring_formula,
        ScoringFormula::DirectionNeutralRelReturn
    );
    assert_eq!(
        borel_manifest.action_binding_mode,
        ActionBindingMode::ConvictionWeights
    );
    assert_eq!(
        runner_manifest.scoring_formula,
        ScoringFormula::DrawdownPenalizedSharpe
    );
    assert_eq!(
        runner_manifest.action_binding_mode,
        ActionBindingMode::ThreeLaneStance
    );

    // 3. Instantiate RoomShards for BOTH cartridges on the exact same cartridge-er-room contract
    let borel_event = [0xA1; 32];
    let runner_event = [0xB2; 32];
    h.send_base(
        &[
            ix_initialize_room_shard(
                admin.pubkey(),
                borel_manifest_pda,
                &InitializeRoomShardArgs {
                    event_id: borel_event,
                    shard_index: 0,
                    start_ts: 1_750_000_000,
                    room_pool_usdc: 0,
                    crank_task_id: 101,
                },
            ),
            ix_initialize_room_shard(
                admin.pubkey(),
                runner_manifest_pda,
                &InitializeRoomShardArgs {
                    event_id: runner_event,
                    shard_index: 0,
                    start_ts: 1_750_000_000,
                    room_pool_usdc: 0,
                    crank_task_id: 202,
                },
            ),
        ],
        &admin,
        &[&admin],
    );

    let (borel_shard_pda, _) = room_shard_pda(&borel_event, 0);
    let (runner_shard_pda, _) = room_shard_pda(&runner_event, 0);
    let borel_shard: RoomShard =
        decode_anchor_account(&h.svm.get_account(&borel_shard_pda).unwrap(), "RoomShard");
    let runner_shard: RoomShard =
        decode_anchor_account(&h.svm.get_account(&runner_shard_pda).unwrap(), "RoomShard");

    assert_eq!(borel_shard.phase, RoomPhase::FogOfWar);
    assert_eq!(borel_shard.unseal_ts, 1_750_000_045);
    assert_eq!(borel_shard.end_ts, 1_750_000_060);
    assert_eq!(borel_shard.scoring_formula, 0);
    assert_eq!(borel_shard.action_binding_mode, 0);

    assert_eq!(runner_shard.phase, RoomPhase::FogOfWar);
    assert_eq!(runner_shard.unseal_ts, 1_750_000_045);
    assert_eq!(runner_shard.end_ts, 1_750_000_090);
    assert_eq!(runner_shard.scoring_formula, 1);
    assert_eq!(runner_shard.action_binding_mode, 1);
}

#[test]
fn test_b_private_beta_room_and_global_tvl_caps_hard_revert() {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();
    let usdc_mint = h.usdc_mint;
    let platform_fee_ata = h.platform_fee_ata;

    // RegistryError::BetaRoomCapConfigurationExceeded = 6007
    assert_custom_error(
        &mut h,
        TransactionTarget::Base,
        &[ix_initialize_engine_config(
            admin.pubkey(),
            platform_fee_ata,
            true,
            BETA_MAX_ROOM_POOL_USDC + 1,
            BETA_MAX_GLOBAL_TVL_USDC,
        )],
        &admin,
        &[&admin],
        6007,
    );

    h.send_base(
        &[ix_initialize_engine_config(
            admin.pubkey(),
            h.platform_fee_ata,
            true,
            BETA_MAX_ROOM_POOL_USDC,
            BETA_MAX_GLOBAL_TVL_USDC,
        )],
        &admin,
        &[&admin],
    );

    let creator_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let borel_args = borel_manifest_args();
    h.send_base(
        &[ix_register_cartridge(
            admin.pubkey(),
            creator_fee_ata,
            &borel_args,
        )],
        &admin,
        &[&admin],
    );
    let (manifest_pda, _) = cartridge_manifest_pda(&borel_args.slug_hash);

    // Create 11 rooms (0..=10) so we can test both the $500 per-room cap and the $5,000 global TVL cap
    let mut shard_pdas = Vec::with_capacity(11);
    for idx in 0u16..=10 {
        let mut event_id = [0u8; 32];
        event_id[0] = 0xCC;
        event_id[1..3].copy_from_slice(&idx.to_le_bytes());
        let (shard_pda, _) = room_shard_pda(&event_id, 0);
        shard_pdas.push(shard_pda);

        h.send_base(
            &[
                ix_initialize_room_shard(
                    admin.pubkey(),
                    manifest_pda,
                    &InitializeRoomShardArgs {
                        event_id,
                        shard_index: 0,
                        start_ts: 1_750_000_000,
                        room_pool_usdc: 0,
                        crank_task_id: i64::from(idx) + 1,
                    },
                ),
                ix_initialize_room_vault(
                    admin.pubkey(),
                    shard_pda,
                    manifest_pda,
                    h.usdc_mint,
                    h.platform_fee_ata,
                    creator_fee_ata,
                    None,
                    500,
                    false,
                    10_000_000,
                    8,
                ),
            ],
            &admin,
            &[&admin],
        );
    }

    // 1. Single deposit > 500_000_000 micro-USDC ($500) in Room 0 MUST revert with BetaRoomPoolCapExceeded (6012)
    let whale = Keypair::new();
    let whale_sk = Keypair::new();
    h.svm.airdrop(&whale.pubkey(), 5_000_000_000).unwrap();
    let whale_ata = h.create_funded_token_account(h.usdc_mint, whale.pubkey(), 10_000_000_000);

    assert_custom_error(
        &mut h,
        TransactionTarget::Base,
        &[ix_open_session_envelope(
            whale.pubkey(),
            admin.pubkey(),
            whale.pubkey(),
            shard_pdas[0],
            usdc_mint,
            whale_ata,
            BETA_MAX_ROOM_POOL_USDC + 1,
            1,
            whale_sk.pubkey(),
        )],
        &whale,
        &[&whale],
        6012, // VaultError::BetaRoomPoolCapExceeded
    );

    // 2. Cumulative room deposits > 500_000_000 micro-USDC MUST also revert with BetaRoomPoolCapExceeded (6012)
    h.send_base(
        &[ix_open_session_envelope(
            whale.pubkey(),
            admin.pubkey(),
            whale.pubkey(),
            shard_pdas[0],
            h.usdc_mint,
            whale_ata,
            300_000_000,
            2,
            whale_sk.pubkey(),
        )],
        &whale,
        &[&whale],
    );

    let p2 = Keypair::new();
    let p2_sk = Keypair::new();
    h.svm.airdrop(&p2.pubkey(), 5_000_000_000).unwrap();
    let p2_ata = h.create_funded_token_account(h.usdc_mint, p2.pubkey(), 1_000_000_000);

    assert_custom_error(
        &mut h,
        TransactionTarget::Base,
        &[ix_open_session_envelope(
            p2.pubkey(),
            admin.pubkey(),
            p2.pubkey(),
            shard_pdas[0],
            usdc_mint,
            p2_ata,
            200_000_001, // 300M + 200.000001M = 500_000_001 > 500M
            1,
            p2_sk.pubkey(),
        )],
        &p2,
        &[&p2],
        6012, // VaultError::BetaRoomPoolCapExceeded
    );

    // Exact $500 room cap (300M + 200M = 500_000_000) succeeds
    h.send_base(
        &[ix_open_session_envelope(
            p2.pubkey(),
            admin.pubkey(),
            p2.pubkey(),
            shard_pdas[0],
            h.usdc_mint,
            p2_ata,
            200_000_000,
            1,
            p2_sk.pubkey(),
        )],
        &p2,
        &[&p2],
    );

    // 3. Fill Rooms 1..=9 with $500 each -> Global TVL reaches exact 5_000_000_000 ($5,000)
    for shard_pda in &shard_pdas[1..=9] {
        let depositor = Keypair::new();
        let sk = Keypair::new();
        h.svm.airdrop(&depositor.pubkey(), 2_000_000_000).unwrap();
        let ata = h.create_funded_token_account(h.usdc_mint, depositor.pubkey(), 500_000_000);
        h.send_base(
            &[ix_open_session_envelope(
                depositor.pubkey(),
                admin.pubkey(),
                depositor.pubkey(),
                *shard_pda,
                h.usdc_mint,
                ata,
                500_000_000,
                1,
                sk.pubkey(),
            )],
            &depositor,
            &[&depositor],
        );
    }

    let (cfg_pda, _) = engine_config_pda();
    let cfg: EngineConfig =
        decode_anchor_account(&h.svm.get_account(&cfg_pda).unwrap(), "EngineConfig");
    assert_eq!(cfg.current_global_tvl_usdc, BETA_MAX_GLOBAL_TVL_USDC);

    // 4. Even 1 micro-USDC in Room 10 (> 5_000_000_000 global TVL) MUST hard-revert with BetaGlobalTvlCapExceeded (6013)
    let overflow_player = Keypair::new();
    let overflow_sk = Keypair::new();
    h.svm
        .airdrop(&overflow_player.pubkey(), 2_000_000_000)
        .unwrap();
    let overflow_ata =
        h.create_funded_token_account(h.usdc_mint, overflow_player.pubkey(), 100_000_000);

    assert_custom_error(
        &mut h,
        TransactionTarget::Base,
        &[ix_open_session_envelope(
            overflow_player.pubkey(),
            admin.pubkey(),
            overflow_player.pubkey(),
            shard_pdas[10],
            usdc_mint,
            overflow_ata,
            1, // 5_000_000_000 + 1 > BETA_MAX_GLOBAL_TVL_USDC
            1,
            overflow_sk.pubkey(),
        )],
        &overflow_player,
        &[&overflow_player],
        6013, // VaultError::BetaGlobalTvlCapExceeded
    );
}

#[test]
fn test_c_full_per_er_vrf_crank_settlement_xstocks_and_passport_lifecycle() {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();
    let keeper = Keypair::new();
    h.svm.airdrop(&keeper.pubkey(), 10_000_000_000).unwrap();

    // 1. Initialize EngineConfig + PassportConfig + Borel #001 Cartridge Manifest
    let creator_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let partner_fee_ata = h.create_funded_token_account(h.usdc_mint, keeper.pubkey(), 0);
    let borel_args = borel_manifest_args();

    h.send_base(
        &[
            ix_initialize_engine_config(
                admin.pubkey(),
                h.platform_fee_ata,
                true,
                BETA_MAX_ROOM_POOL_USDC,
                BETA_MAX_GLOBAL_TVL_USDC,
            ),
            ix_initialize_passport_config(admin.pubkey(), keeper.pubkey()),
            ix_register_cartridge(admin.pubkey(), creator_fee_ata, &borel_args),
        ],
        &admin,
        &[&admin],
    );
    let (manifest_pda, _) = cartridge_manifest_pda(&borel_args.slug_hash);

    // 2. Initialize RoomShard + RoomVault (partner_wallet_active = true -> 40/30/30 split, 500 bps total fee)
    let event_id = [0x42; 32];
    let (shard_pda, _) = room_shard_pda(&event_id, 0);
    let (vault_pda, _) = room_vault_pda(&shard_pda);

    h.send_base(
        &[
            ix_initialize_room_shard(
                admin.pubkey(),
                manifest_pda,
                &InitializeRoomShardArgs {
                    event_id,
                    shard_index: 0,
                    start_ts: 1_750_000_000,
                    room_pool_usdc: 0,
                    crank_task_id: 777,
                },
            ),
            ix_initialize_room_vault(
                admin.pubkey(),
                shard_pda,
                manifest_pda,
                h.usdc_mint,
                h.platform_fee_ata,
                creator_fee_ata,
                Some(partner_fee_ata),
                500, // 5.00% total fee
                true, // 40% partner / 30% creator / 30% platform
                10_000_000,
                8,
            ),
        ],
        &admin,
        &[&admin],
    );

    // 3. Setup 3 Rival Players + Session Keys + Passports + Deposits (200 + 150 + 150 = $500 pool)
    let players = [Keypair::new(), Keypair::new(), Keypair::new()];
    let session_keys = [Keypair::new(), Keypair::new(), Keypair::new()];
    let deposits = [200_000_000u64, 150_000_000u64, 150_000_000u64];
    let mut player_usdc_atas = Vec::new();
    let mut stance_pdas = Vec::new();
    let mut env_pdas = Vec::new();

    for i in 0..3 {
        h.svm.airdrop(&players[i].pubkey(), 10_000_000_000).unwrap();
        let ata = h.create_funded_token_account(h.usdc_mint, players[i].pubkey(), deposits[i]);
        player_usdc_atas.push(ata);
        stance_pdas.push(player_stance_pda(&shard_pda, &players[i].pubkey()).0);
        env_pdas.push(session_envelope_pda(&shard_pda, &players[i].pubkey()).0);

        h.send_base(
            &[
                ix_initialize_passport(players[i].pubkey(), players[i].pubkey()),
                ix_open_session_envelope(
                    players[i].pubkey(),
                    admin.pubkey(),
                    players[i].pubkey(),
                    shard_pda,
                    h.usdc_mint,
                    ata,
                    deposits[i],
                    3,
                    session_keys[i].pubkey(),
                ),
            ],
            &players[i],
            &[&players[i]],
        );
    }

    // Grant BIT_CAN_CLAIM_XSTOCKS to player 0 only; player 1 gets BIT_GEO_ELIGIBLE without BIT_CAN_CLAIM_XSTOCKS
    h.send_base(
        &[
            ix_update_eligibility_bitmask(
                keeper.pubkey(),
                players[0].pubkey(),
                BIT_GEO_ELIGIBLE | BIT_CAN_CLAIM_XSTOCKS | BIT_SYBIL_VERIFIED,
            ),
            ix_update_eligibility_bitmask(keeper.pubkey(), players[1].pubkey(), BIT_GEO_ELIGIBLE),
        ],
        &keeper,
        &[&keeper],
    );

    // 4. Delegate RoomShard + Init & Delegate all 3 PlayerStances to MagicBlock ER/PER Validator
    let validator = h.svm.validator_identity();
    h.send_base(
        &[ix_delegate_room_shard(
            admin.pubkey(),
            event_id,
            0,
            Some(validator),
        )],
        &admin,
        &[&admin],
    );
    assert_eq!(
        h.svm
            .get_account_for(TransactionTarget::Base, &shard_pda)
            .unwrap()
            .owner,
        DELEGATION_PROGRAM_ID
    );
    assert_eq!(
        h.svm
            .get_account_for(TransactionTarget::Ephemeral, &shard_pda)
            .unwrap()
            .owner,
        CARTRIDGE_ER_ROOM_ID
    );

    for i in 0..3 {
        h.send_base(
            &[ix_init_stance_and_delegate(
                players[i].pubkey(),
                shard_pda,
                session_keys[i].pubkey(),
                1_750_000_060,
                Some(validator),
                admin.pubkey(),
            )],
            &players[i],
            &[&players[i]],
        );
        assert_eq!(
            h.svm
                .get_account_for(TransactionTarget::Base, &stance_pdas[i])
                .unwrap()
                .owner,
            DELEGATION_PROGRAM_ID
        );
    }

    // 5. Join ER Room & Create Private Ephemeral Permissions (ACLseoPoy... is_private = true)
    for i in 0..3 {
        h.send_ephemeral(
            &[ix_join_room_and_init_permission(
                players[i].pubkey(),
                shard_pda,
                stance_pdas[i],
                admin.pubkey(),
            )],
            &players[i],
            &[&players[i]],
        );
    }

    // Prove PER Fog-of-War Hardware Privacy: rival players & public cannot read Player 0's stance!
    h.svm.set_authorized_user(None);
    assert!(
        h.svm
            .get_account_for(TransactionTarget::Ephemeral, &stance_pdas[0])
            .is_none(),
        "public viewer must not read private Fog-of-War stance"
    );
    h.svm.set_authorized_user(Some(players[1].pubkey()));
    assert!(
        h.svm
            .get_account_for(TransactionTarget::Ephemeral, &stance_pdas[0])
            .is_none(),
        "rival player must not read Player 0 private Fog-of-War stance"
    );
    h.svm.set_authorized_user(Some(players[0].pubkey()));
    assert!(
        h.svm
            .get_account_for(TransactionTarget::Ephemeral, &stance_pdas[0])
            .is_some(),
        "Player 0 must read their own private stance"
    );
    h.svm.set_authorized_user(Some(admin.pubkey()));
    assert!(
        h.svm
            .get_account_for(TransactionTarget::Ephemeral, &stance_pdas[0])
            .is_some(),
        "Room authority must read delegated stances"
    );
    h.svm.set_authorized_user(None);

    // 6. Schedule Room Crank & prove unauthorized direct call to crank_tick_room fails
    let fake_crank = Keypair::new();
    h.svm.airdrop(&fake_crank.pubkey(), 1_000_000_000).unwrap();
    assert_tx_fails(
        &mut h,
        TransactionTarget::Ephemeral,
        &[ix_crank_tick_room(fake_crank.pubkey(), shard_pda)],
        &fake_crank,
        &[&fake_crank],
    );

    h.send_ephemeral(
        &[ix_schedule_room_crank(
            admin.pubkey(),
            shard_pda,
            777,
            50,
            2,
        )],
        &admin,
        &[&admin],
    );
    let crank_results = h.svm.warp_to_slot(105);
    assert!(
        !crank_results.is_empty() && crank_results.iter().all(|r| r.is_ok()),
        "scheduled room crank iterations must execute cleanly"
    );
    h.set_clock(105, 1_750_000_010);

    // 7. Zero-Popup Session-Key Stance Submissions on Fee-Free Ephemeral Rollup
    let oracle_pubkey = Address::new_from_array([0x55; 32]);
    // Entry price = $140.00 (14_000_000_000 in 10^-8 scale), conf = $0.05 (~3.5 bps)
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(14_000_000_000, 5_000_000, 1_750_000_009, 105),
        )
        .unwrap();

    let player_weights = [
        [8_000i16, 0, 0, 0],  // Player 0: +80% high-conviction long
        [2_000i16, 0, 0, 0],  // Player 1: +20% mild long
        [-6_000i16, 0, 0, 0], // Player 2: -60% short
    ];
    for i in 0..3 {
        // Notice: session_keys[i] has ZERO airdropped SOL on Base, proving gasless ER execution!
        h.send_ephemeral(
            &[ix_submit_stance(
                session_keys[i].pubkey(),
                shard_pda,
                stance_pdas[i],
                oracle_pubkey,
                admin.pubkey(),
                &SubmitStanceArgs {
                    weights_bps: player_weights[i],
                    kalshi_binary_call: 2,
                    kalshi_prob_bps: 8_000,
                    secondary_prices_8: [14_000_000_000; 3],
                    stage1_score_scaled: 0,
                },
            )],
            &session_keys[i],
            &[&session_keys[i]],
        );
    }

    // 8. Advance Clock to Final 15-Second Showdown (t = 46s >= unseal_ts = 45s) & Unseal Permissions
    h.set_clock(120, 1_750_000_046);
    for stance_pda in &stance_pdas {
        h.send_ephemeral(
            &[ix_trigger_showdown_unseal(
                admin.pubkey(),
                shard_pda,
                *stance_pda,
            )],
            &admin,
            &[&admin],
        );
    }

    // Prove Showdown Unseal: rival & public viewers can now read stances live on screen!
    h.svm.set_authorized_user(None);
    let unsealed_p0: PlayerStance = decode_anchor_account(
        &h.svm
            .get_account_for(TransactionTarget::Ephemeral, &stance_pdas[0])
            .expect("unsealed stance visible to public during Showdown"),
        "PlayerStance",
    );
    assert_eq!(unsealed_p0.weights_bps[0], 8_000);
    assert_eq!(unsealed_p0.move_count, 1);

    // 9. Request Settlement VRF on Ephemeral Queue + Reject Spoofed Callback + Fulfill Real Callback
    let expected_vrf_seed = [0x9E; 32];
    h.svm.set_vrf_randomness(Some(expected_vrf_seed));
    h.send_ephemeral(
        &[ix_request_settlement_vrf(
            admin.pubkey(),
            shard_pda,
            DEFAULT_EPHEMERAL_QUEUE,
            7,
        )],
        &admin,
        &[&admin],
    );

    // Spoofed VRF callback without scoped vrf_program_identity MUST fail
    let spoof_vrf = Keypair::new();
    assert_tx_fails(
        &mut h,
        TransactionTarget::Ephemeral,
        &[ix_callback_settlement_vrf_spoofed(
            spoof_vrf.pubkey(),
            shard_pda,
            [0xFF; 32],
            1,
        )],
        &spoof_vrf,
        &[&spoof_vrf],
    );

    let vrf_results = h.svm.warp_to_slot(122);
    assert!(
        !vrf_results.is_empty() && vrf_results.iter().all(|r| r.is_ok()),
        "MagicSVM VRF oracle callback must succeed: {vrf_results:?}"
    );

    h.svm.set_authorized_user(Some(admin.pubkey()));
    let shard_after_vrf: RoomShard = decode_anchor_account(
        &h.svm
            .get_account_for(TransactionTarget::Ephemeral, &shard_pda)
            .unwrap(),
        "RoomShard",
    );
    assert!(shard_after_vrf.vrf_fulfilled);
    assert_eq!(shard_after_vrf.vrf_seed, expected_vrf_seed);

    // 10. Advance Clock past Room End (t = 61s) with +10% Exit Price ($154.00) & Evaluate Scores
    h.set_clock(130, 1_750_000_061);
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(15_400_000_000, 5_000_000, 1_750_000_060, 130),
        )
        .unwrap();

    for stance_pda in &stance_pdas {
        h.send_ephemeral(
            &[ix_evaluate_player_score(
                admin.pubkey(),
                shard_pda,
                *stance_pda,
                oracle_pubkey,
                &EvaluateScoreArgs {
                    secondary_exit_prices_8: [14_000_000_000; 3], // flat secondary legs
                    beta_bench_scaled: 0,
                    lambda_dd_scaled: 500_000_000,
                    kalshi_outcome_yes: 2,
                    max_multiplier_scaled: SCALE,
                },
            )],
            &admin,
            &[&admin],
        );
    }

    // 11. Commit & Undelegate Stances + Settle & Commit RoomShard back to Base L1
    for stance_pda in &stance_pdas {
        h.send_ephemeral(
            &[ix_undelegate_player_stance(
                admin.pubkey(),
                shard_pda,
                *stance_pda,
            )],
            &admin,
            &[&admin],
        );
    }
    h.send_ephemeral(
        &[ix_settle_and_commit_shard(
            admin.pubkey(),
            shard_pda,
            oracle_pubkey,
            &SettleShardArgs {
                schedule_vault_action: false,
                vault_action_accounts: vec![],
            },
        )],
        &admin,
        &[&admin],
    );

    let l1_shard_acc = h
        .svm
        .get_account_for(TransactionTarget::Base, &shard_pda)
        .unwrap();
    assert_eq!(l1_shard_acc.owner, CARTRIDGE_ER_ROOM_ID);
    let l1_shard: RoomShard = decode_anchor_account(&l1_shard_acc, "RoomShard");
    assert_eq!(l1_shard.phase, RoomPhase::SettledCommitted);
    assert_eq!(l1_shard.evaluated_count, 3);

    let s0: PlayerStance =
        decode_anchor_account(&h.svm.get_account(&stance_pdas[0]).unwrap(), "PlayerStance");
    let s1: PlayerStance =
        decode_anchor_account(&h.svm.get_account(&stance_pdas[1]).unwrap(), "PlayerStance");
    let s2: PlayerStance =
        decode_anchor_account(&h.svm.get_account(&stance_pdas[2]).unwrap(), "PlayerStance");
    assert!(s0.final_score_scaled > s1.final_score_scaled);
    assert!(s1.final_score_scaled > s2.final_score_scaled);
    assert!(s2.final_score_scaled < 0);

    // 12. Distribute Pool & 40/30/30 Fees on Base L1
    let pairs: Vec<(Address, Address)> = stance_pdas
        .iter()
        .copied()
        .zip(env_pdas.iter().copied())
        .collect();
    h.send_base(
        &[ix_distribute_pool_and_fees(
            admin.pubkey(),
            shard_pda,
            h.usdc_mint,
            h.platform_fee_ata,
            creator_fee_ata,
            Some(partner_fee_ata),
            &pairs,
        )],
        &admin,
        &[&admin],
    );

    // Verify exact 40/30/30 fee balances ($25 total fee -> $10 partner, $7.50 creator, $7.50 platform)
    assert_eq!(
        read_spl_token_balance(&h.svm.get_account(&partner_fee_ata).unwrap()),
        10_000_000
    );
    assert_eq!(
        read_spl_token_balance(&h.svm.get_account(&creator_fee_ata).unwrap()),
        7_500_000
    );
    assert_eq!(
        read_spl_token_balance(&h.svm.get_account(&h.platform_fee_ata).unwrap()),
        7_500_000
    );

    // Verify Harmonic Shapley payouts (259_090_910 + 129_545_454 + 86_363_636 == 475_000_000)
    let e0: SessionRiskEnvelope = decode_anchor_account(
        &h.svm.get_account(&env_pdas[0]).unwrap(),
        "SessionRiskEnvelope",
    );
    let e1: SessionRiskEnvelope = decode_anchor_account(
        &h.svm.get_account(&env_pdas[1]).unwrap(),
        "SessionRiskEnvelope",
    );
    let e2: SessionRiskEnvelope = decode_anchor_account(
        &h.svm.get_account(&env_pdas[2]).unwrap(),
        "SessionRiskEnvelope",
    );
    assert_eq!((e0.rank, e0.payout_usdc), (1, 259_090_910));
    assert_eq!((e1.rank, e1.payout_usdc), (2, 129_545_454));
    assert_eq!((e2.rank, e2.payout_usdc), (3, 86_363_636));

    // 13. Claim Prizes: Enforce BIT_CAN_CLAIM_XSTOCKS for NVDAx + Canonical USDC Fallback
    // Install canonical NVDAx Mint + Vault NVDAx Reserve + Settlement USDC ATA
    h.svm
        .set_account(
            CANONICAL_NVDAX_MINT,
            make_spl_mint_account(&admin.pubkey(), 10_000_000_000, 6),
        )
        .unwrap();
    let vault_nvdax_reserve =
        h.create_funded_token_account(CANONICAL_NVDAX_MINT, vault_pda, 50_000_000);
    let settlement_usdc_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let p0_nvdax_ata = h.create_funded_token_account(CANONICAL_NVDAX_MINT, players[0].pubkey(), 0);
    let p1_nvdax_ata = h.create_funded_token_account(CANONICAL_NVDAX_MINT, players[1].pubkey(), 0);

    // Player 1 lacks BIT_CAN_CLAIM_XSTOCKS -> claiming NVDAx MUST revert with XStocksIneligible (6034)
    let usdc_mint = h.usdc_mint;
    let (p1_passport, _) = market_passport_pda(&players[1].pubkey());
    assert_custom_error(
        &mut h,
        TransactionTarget::Base,
        &[ix_claim_prize(
            players[1].pubkey(),
            players[1].pubkey(),
            shard_pda,
            usdc_mint,
            CANONICAL_NVDAX_MINT,
            p1_nvdax_ata,
            Some(vault_nvdax_reserve),
            Some(settlement_usdc_ata),
            Some(p1_passport),
            841_204,
        )],
        &players[1],
        &[&players[1]],
        6034, // VaultError::XStocksIneligible
    );

    // Player 0 holds BIT_CAN_CLAIM_XSTOCKS -> claims NVDAx (1_682_408 units) atomically!
    let (p0_passport, _) = market_passport_pda(&players[0].pubkey());
    h.send_base(
        &[ix_claim_prize(
            players[0].pubkey(),
            players[0].pubkey(),
            shard_pda,
            h.usdc_mint,
            CANONICAL_NVDAX_MINT,
            p0_nvdax_ata,
            Some(vault_nvdax_reserve),
            Some(settlement_usdc_ata),
            Some(p0_passport),
            1_682_408,
        )],
        &players[0],
        &[&players[0]],
    );
    assert_eq!(
        read_spl_token_balance(&h.svm.get_account(&p0_nvdax_ata).unwrap()),
        1_682_408
    );
    assert_eq!(
        read_spl_token_balance(&h.svm.get_account(&settlement_usdc_ata).unwrap()),
        259_090_910
    );

    // Players 1 and 2 claim canonical USDC payouts
    for i in 1..=2 {
        h.send_base(
            &[ix_claim_prize(
                players[i].pubkey(),
                players[i].pubkey(),
                shard_pda,
                h.usdc_mint,
                h.usdc_mint,
                player_usdc_atas[i],
                None,
                None,
                None,
                0,
            )],
            &players[i],
            &[&players[i]],
        );
    }
    assert_eq!(
        read_spl_token_balance(&h.svm.get_account(&player_usdc_atas[1]).unwrap()),
        129_545_454
    );
    assert_eq!(
        read_spl_token_balance(&h.svm.get_account(&player_usdc_atas[2]).unwrap()),
        86_363_636
    );

    // Global TVL returns cleanly to 0 after fees + all prizes exit the vault!
    let (cfg_pda, _) = engine_config_pda();
    let cfg_final: EngineConfig =
        decode_anchor_account(&h.svm.get_account(&cfg_pda).unwrap(), "EngineConfig");
    assert_eq!(cfg_final.current_global_tvl_usdc, 0);

    // 14. Record Cross-Game Market ELO & Earned Stock Vault Credit in cartridge-passport
    h.send_base(
        &[ix_record_elo_and_vault_credit(
            keeper.pubkey(),
            players[0].pubkey(),
            keeper.pubkey(),
            Address::default(),
            &RecordEloArgs {
                room_mean_elo_scaled: 1_200 * SCALE,
                placement_score_scaled: SCALE, // 1st place = 1.0 * 10^9
                is_live_mode: true,
                is_win: true,
                sharpe_score_scaled: Some(2_450_000_000),
                brier_score_scaled: Some(960_000_000),
                asset_credit_kind: AssetCreditKind::Nvdax,
                asset_credit_units: 1_682_408,
                room_shard: shard_pda,
            },
        )],
        &keeper,
        &[&keeper],
    );

    let p0_pass_state: MarketPassport =
        decode_anchor_account(&h.svm.get_account(&p0_passport).unwrap(), "MarketPassport");
    // Equal-ELO 1st place live win: expected = 0.5, K = 32 => +16.0 ELO => 1216.0 * 10^9
    assert_eq!(p0_pass_state.elo_scaled, 1_216 * SCALE);
    assert_eq!(p0_pass_state.matches_played, 1);
    assert_eq!(p0_pass_state.wins_count, 1);
    assert_eq!(p0_pass_state.best_sharpe_scaled, 2_450_000_000);
    assert_eq!(p0_pass_state.best_brier_scaled, 960_000_000);
    assert_eq!(p0_pass_state.earned_nvda_units, 1_682_408);
}

#[test]
fn test_c2_remaining_scoring_modes_and_post_commit_magic_action_settlement() {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();
    let creator_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);

    h.send_base(
        &[ix_initialize_engine_config(
            admin.pubkey(),
            h.platform_fee_ata,
            true,
            BETA_MAX_ROOM_POOL_USDC,
            BETA_MAX_GLOBAL_TVL_USDC,
        )],
        &admin,
        &[&admin],
    );

    // Register 3 cartridges covering Sharpe (1), Kalshi Brier (2), and Multi-Stage Carry (3)
    let formulas = [
        (
            "sharpe-mode",
            ScoringFormula::DrawdownPenalizedSharpe,
            ActionBindingMode::ThreeLaneStance,
        ),
        (
            "brier-mode",
            ScoringFormula::KalshiBrierCalibration,
            ActionBindingMode::ConvictionWeights,
        ),
        (
            "carry-mode",
            ScoringFormula::MultiStageCarryComposite,
            ActionBindingMode::MultiStageCarry,
        ),
    ];

    let oracle_pubkey = Address::new_from_array([0x66; 32]);
    let validator = h.svm.validator_identity();

    for (idx, (slug, formula, binding)) in formulas.iter().enumerate() {
        h.set_clock(200 + (idx as u64) * 50, 1_750_001_000);
        let c_args = RegisterCartridgeArgs {
            slug_hash: slug_hash(slug),
            creator_share_bps: 5_000, // 50/50 split
            genre_code: (idx as u8) + 2,
            duration_secs: 60,
            fog_of_war_bps: 7_500,
            max_rebalances: 5,
            scoring_formula: *formula,
            action_binding_mode: *binding,
            allowed_feeds_merkle_root: [0x33; 32],
            manifest_uri: pad_uri("https://cartridgefi.com/manifests/mode.json"),
        };
        h.send_base(
            &[ix_register_cartridge(
                admin.pubkey(),
                creator_fee_ata,
                &c_args,
            )],
            &admin,
            &[&admin],
        );
        let (manifest_pda, _) = cartridge_manifest_pda(&c_args.slug_hash);

        let mut event_id = [0x70; 32];
        event_id[0] = idx as u8 + 1;
        let (shard_pda, _) = room_shard_pda(&event_id, 0);
        let player = Keypair::new();
        let sk = Keypair::new();
        h.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let player_ata = h.create_funded_token_account(h.usdc_mint, player.pubkey(), 100_000_000);

        h.send_base(
            &[
                ix_initialize_room_shard(
                    admin.pubkey(),
                    manifest_pda,
                    &InitializeRoomShardArgs {
                        event_id,
                        shard_index: 0,
                        start_ts: 1_750_001_000,
                        room_pool_usdc: 0,
                        crank_task_id: 900 + idx as i64,
                    },
                ),
                ix_initialize_room_vault(
                    admin.pubkey(),
                    shard_pda,
                    manifest_pda,
                    h.usdc_mint,
                    h.platform_fee_ata,
                    creator_fee_ata,
                    None,
                    400, // 4% total fee, 50/50 split
                    false,
                    10_000_000,
                    8,
                ),
            ],
            &admin,
            &[&admin],
        );

        h.send_base(
            &[
                ix_open_session_envelope(
                    player.pubkey(),
                    admin.pubkey(),
                    player.pubkey(),
                    shard_pda,
                    h.usdc_mint,
                    player_ata,
                    100_000_000,
                    2,
                    sk.pubkey(),
                ),
                ix_init_stance_and_delegate(
                    player.pubkey(),
                    shard_pda,
                    sk.pubkey(),
                    1_750_001_060,
                    Some(validator),
                    admin.pubkey(),
                ),
            ],
            &player,
            &[&player],
        );
        h.send_base(
            &[ix_delegate_room_shard(
                admin.pubkey(),
                event_id,
                0,
                Some(validator),
            )],
            &admin,
            &[&admin],
        );

        let (stance_pda, _) = player_stance_pda(&shard_pda, &player.pubkey());
        let (env_pda, _) = session_envelope_pda(&shard_pda, &player.pubkey());
        h.send_ephemeral(
            &[ix_join_room_and_init_permission(
                player.pubkey(),
                shard_pda,
                stance_pda,
                admin.pubkey(),
            )],
            &player,
            &[&player],
        );

        // Submit 2 moves so Sharpe mode accumulates multi-step returns + drawdown tracking
        h.svm
            .set_account(
                oracle_pubkey,
                make_pyth_oracle_account(10_000_000_000, 1_000_000, 1_750_001_000, 201),
            )
            .unwrap();
        h.send_ephemeral(
            &[ix_submit_stance(
                sk.pubkey(),
                shard_pda,
                stance_pda,
                oracle_pubkey,
                admin.pubkey(),
                &SubmitStanceArgs {
                    weights_bps: [5_000, 0, 0, 0],
                    kalshi_binary_call: 2,
                    kalshi_prob_bps: 9_000, // 90% YES -> Brier = 1 - (0.9 - 1.0)^2 = 0.99 * 10^9
                    secondary_prices_8: [10_000_000_000; 3],
                    stage1_score_scaled: 800_000_000, // 0.80 Stage-1 carry
                },
            )],
            &sk,
            &[&sk],
        );

        h.set_clock(210 + (idx as u64) * 50, 1_750_001_020);
        h.svm
            .set_account(
                oracle_pubkey,
                make_pyth_oracle_account(10_500_000_000, 1_000_000, 1_750_001_020, 210),
            )
            .unwrap();
        h.send_ephemeral(
            &[ix_submit_stance(
                sk.pubkey(),
                shard_pda,
                stance_pda,
                oracle_pubkey,
                admin.pubkey(),
                &SubmitStanceArgs {
                    weights_bps: [6_000, 0, 0, 0],
                    kalshi_binary_call: 2,
                    kalshi_prob_bps: 9_000,
                    secondary_prices_8: [10_000_000_000; 3],
                    stage1_score_scaled: 800_000_000,
                },
            )],
            &sk,
            &[&sk],
        );

        // Request & fulfill VRF
        h.svm.set_vrf_randomness(Some([0xAB; 32]));
        h.send_ephemeral(
            &[ix_request_settlement_vrf(
                admin.pubkey(),
                shard_pda,
                DEFAULT_EPHEMERAL_QUEUE,
                idx as u8 + 1,
            )],
            &admin,
            &[&admin],
        );
        let cur_slot = 212 + (idx as u64) * 50;
        let _ = h.svm.warp_to_slot(cur_slot);
        h.set_clock(cur_slot + 5, 1_750_001_065);

        h.svm
            .set_account(
                oracle_pubkey,
                make_pyth_oracle_account(11_000_000_000, 1_000_000, 1_750_001_064, cur_slot + 5),
            )
            .unwrap();
        h.send_ephemeral(
            &[ix_evaluate_player_score(
                admin.pubkey(),
                shard_pda,
                stance_pda,
                oracle_pubkey,
                &EvaluateScoreArgs {
                    secondary_exit_prices_8: [10_000_000_000; 3],
                    beta_bench_scaled: 0,
                    lambda_dd_scaled: 500_000_000,
                    kalshi_outcome_yes: 2,
                    max_multiplier_scaled: 2 * SCALE, // 2.0x max carry multiplier
                },
            )],
            &admin,
            &[&admin],
        );

        h.send_ephemeral(
            &[ix_undelegate_player_stance(
                admin.pubkey(),
                shard_pda,
                stance_pda,
            )],
            &admin,
            &[&admin],
        );

        // On the 3rd cartridge (Carry Composite), test atomic post-commit Magic Action settlement!
        let use_magic_action = idx == 2;
        let (room_vault, _) = room_vault_pda(&shard_pda);
        let (vault_usdc_token, _) = room_vault_token_pda(&shard_pda);
        let (engine_config, _) = engine_config_pda();
        let (vault_router_auth, _) = vault_router_auth_pda();

        let (escrow_pda, _) = Address::find_program_address(
            &[b"balance", admin.pubkey().as_ref(), &[255u8]],
            &DELEGATION_PROGRAM_ID,
        );
        if use_magic_action {
            // Ephemeral balance escrow PDA [b"balance", admin, 255] is system-owned and funded with SOL
            h.svm.airdrop(&escrow_pda, 1_000_000_000).unwrap();
        }

        let action_accounts = if use_magic_action {
            vec![
                ActionAccountSpec {
                    pubkey: room_vault,
                    is_writable: true,
                },
                ActionAccountSpec {
                    pubkey: shard_pda,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: h.usdc_mint,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: vault_usdc_token,
                    is_writable: true,
                },
                ActionAccountSpec {
                    pubkey: h.platform_fee_ata,
                    is_writable: true,
                },
                ActionAccountSpec {
                    pubkey: creator_fee_ata,
                    is_writable: true,
                },
                ActionAccountSpec {
                    pubkey: CARTRIDGE_VAULT_ROUTER_ID,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: engine_config,
                    is_writable: true,
                },
                ActionAccountSpec {
                    pubkey: vault_router_auth,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: CARTRIDGE_REGISTRY_ID,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: TOKEN_PROGRAM_ID,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: CARTRIDGE_ER_ROOM_ID,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: admin.pubkey(),
                    is_writable: true,
                },
                ActionAccountSpec {
                    pubkey: escrow_pda,
                    is_writable: true,
                },
                ActionAccountSpec {
                    pubkey: stance_pda,
                    is_writable: false,
                },
                ActionAccountSpec {
                    pubkey: env_pda,
                    is_writable: true,
                },
            ]
        } else {
            vec![]
        };

        h.send_ephemeral(
            &[ix_settle_and_commit_shard(
                admin.pubkey(),
                shard_pda,
                oracle_pubkey,
                &SettleShardArgs {
                    schedule_vault_action: use_magic_action,
                    vault_action_accounts: action_accounts,
                },
            )],
            &admin,
            &[&admin],
        );

        let stance_l1: PlayerStance =
            decode_anchor_account(&h.svm.get_account(&stance_pda).unwrap(), "PlayerStance");
        match formula {
            ScoringFormula::DrawdownPenalizedSharpe => {
                assert!(stance_l1.final_score_scaled > 0);
            }
            ScoringFormula::KalshiBrierCalibration => {
                // 1 - (0.9 - 1.0)^2 = 1 - 0.01 = 0.99 * 10^9 = 990_000_000
                assert_eq!(stance_l1.final_score_scaled, 990_000_000);
            }
            ScoringFormula::MultiStageCarryComposite => {
                // rel_score = 0.60 * 0.10 = 0.06 * 10^9 = 60_000_000
                // multiplier = 1.0 + (2.0 - 1.0) * 0.80 = 1.80 => 60_000_000 * 1.80 = 108_000_000
                assert_eq!(stance_l1.final_score_scaled, 108_000_000);

                // Verify post-commit Magic Action automatically settled RoomVault on L1!
                let vault_state: RoomVault =
                    decode_anchor_account(&h.svm.get_account(&room_vault).unwrap(), "RoomVault");
                assert!(
                    vault_state.settled,
                    "post-commit Magic Action must atomically settle RoomVault on L1"
                );
            }
            _ => unreachable!(),
        }
    }
}

#[test]
fn test_d_session_key_isolation_red_team() {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();
    let creator_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let borel_args = borel_manifest_args();

    h.send_base(
        &[
            ix_initialize_engine_config(
                admin.pubkey(),
                h.platform_fee_ata,
                true,
                BETA_MAX_ROOM_POOL_USDC,
                BETA_MAX_GLOBAL_TVL_USDC,
            ),
            ix_register_cartridge(admin.pubkey(), creator_fee_ata, &borel_args),
        ],
        &admin,
        &[&admin],
    );
    let (manifest_pda, _) = cartridge_manifest_pda(&borel_args.slug_hash);

    let event_id = [0xD4; 32];
    let (shard_pda, _) = room_shard_pda(&event_id, 0);
    let (vault_usdc_token, _) = room_vault_token_pda(&shard_pda);

    h.send_base(
        &[
            ix_initialize_room_shard(
                admin.pubkey(),
                manifest_pda,
                &InitializeRoomShardArgs {
                    event_id,
                    shard_index: 0,
                    start_ts: 1_750_000_000,
                    room_pool_usdc: 0,
                    crank_task_id: 404,
                },
            ),
            ix_initialize_room_vault(
                admin.pubkey(),
                shard_pda,
                manifest_pda,
                h.usdc_mint,
                h.platform_fee_ata,
                creator_fee_ata,
                None,
                500,
                false,
                10_000_000,
                8,
            ),
        ],
        &admin,
        &[&admin],
    );

    let victim = Keypair::new();
    let compromised_sk = Keypair::new();
    h.svm.airdrop(&victim.pubkey(), 5_000_000_000).unwrap();
    // Even if an attacker funds the compromised ephemeral_session_key with SOL and USDC:
    h.svm
        .airdrop(&compromised_sk.pubkey(), 5_000_000_000)
        .unwrap();
    let victim_ata = h.create_funded_token_account(h.usdc_mint, victim.pubkey(), 200_000_000);
    let sk_ata = h.create_funded_token_account(h.usdc_mint, compromised_sk.pubkey(), 200_000_000);

    let usdc_mint = h.usdc_mint;
    let platform_fee_ata = h.platform_fee_ata;

    // 1. Compromised session key CANNOT open_session_envelope pulling victim's USDC ATA
    assert_tx_fails(
        &mut h,
        TransactionTarget::Base,
        &[ix_open_session_envelope(
            compromised_sk.pubkey(),
            admin.pubkey(),
            compromised_sk.pubkey(),
            shard_pda,
            usdc_mint,
            victim_ata,
            50_000_000,
            1,
            compromised_sk.pubkey(),
        )],
        &compromised_sk,
        &[&compromised_sk],
    );

    // 2. Compromised session key CANNOT open_session_envelope with player == ephemeral_session_key
    //    (VaultError::SessionKeyPrivilegeEscalation = 6002)
    assert_custom_error(
        &mut h,
        TransactionTarget::Base,
        &[ix_open_session_envelope(
            compromised_sk.pubkey(),
            admin.pubkey(),
            compromised_sk.pubkey(),
            shard_pda,
            usdc_mint,
            sk_ata,
            50_000_000,
            1,
            compromised_sk.pubkey(),
        )],
        &compromised_sk,
        &[&compromised_sk],
        6002, // VaultError::SessionKeyPrivilegeEscalation
    );

    // Victim legitimately opens envelope binding compromised_sk
    h.send_base(
        &[ix_open_session_envelope(
            victim.pubkey(),
            admin.pubkey(),
            victim.pubkey(),
            shard_pda,
            usdc_mint,
            victim_ata,
            100_000_000,
            2,
            compromised_sk.pubkey(),
        )],
        &victim,
        &[&victim],
    );

    // 3. Compromised session key CANNOT sign SPL Token TransferChecked from vault_usdc_token or victim_ata
    assert_tx_fails(
        &mut h,
        TransactionTarget::Base,
        &[ix_spl_transfer_checked(
            vault_usdc_token,
            usdc_mint,
            sk_ata,
            compromised_sk.pubkey(),
            10_000_000,
            6,
        )],
        &compromised_sk,
        &[&compromised_sk],
    );
    assert_tx_fails(
        &mut h,
        TransactionTarget::Base,
        &[ix_spl_transfer_checked(
            victim_ata,
            usdc_mint,
            sk_ata,
            compromised_sk.pubkey(),
            10_000_000,
            6,
        )],
        &compromised_sk,
        &[&compromised_sk],
    );

    // 4. Settle room legitimately, then prove compromised_sk CANNOT sign claim_prize for victim's envelope!
    let validator = h.svm.validator_identity();
    h.send_base(
        &[ix_init_stance_and_delegate(
            victim.pubkey(),
            shard_pda,
            compromised_sk.pubkey(),
            1_750_000_060,
            Some(validator),
            admin.pubkey(),
        )],
        &victim,
        &[&victim],
    );
    h.send_base(
        &[ix_delegate_room_shard(
            admin.pubkey(),
            event_id,
            0,
            Some(validator),
        )],
        &admin,
        &[&admin],
    );

    let (stance_pda, _) = player_stance_pda(&shard_pda, &victim.pubkey());
    let (env_pda, _) = session_envelope_pda(&shard_pda, &victim.pubkey());
    let oracle_pubkey = Address::new_from_array([0x77; 32]);
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(10_000_000_000, 1_000_000, 1_750_000_000, 100),
        )
        .unwrap();

    h.send_ephemeral(
        &[ix_join_room_and_init_permission(
            victim.pubkey(),
            shard_pda,
            stance_pda,
            admin.pubkey(),
        )],
        &victim,
        &[&victim],
    );
    h.send_ephemeral(
        &[ix_submit_stance(
            compromised_sk.pubkey(),
            shard_pda,
            stance_pda,
            oracle_pubkey,
            admin.pubkey(),
            &SubmitStanceArgs {
                weights_bps: [5_000, 0, 0, 0],
                kalshi_binary_call: 0,
                kalshi_prob_bps: 5_000,
                secondary_prices_8: [10_000_000_000; 3],
                stage1_score_scaled: 0,
            },
        )],
        &compromised_sk,
        &[&compromised_sk],
    );

    h.svm.set_vrf_randomness(Some([0x12; 32]));
    h.send_ephemeral(
        &[ix_request_settlement_vrf(
            admin.pubkey(),
            shard_pda,
            DEFAULT_EPHEMERAL_QUEUE,
            1,
        )],
        &admin,
        &[&admin],
    );
    let _ = h.svm.warp_to_slot(105);
    h.set_clock(110, 1_750_000_065);
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(10_500_000_000, 1_000_000, 1_750_000_064, 110),
        )
        .unwrap();

    h.send_ephemeral(
        &[
            ix_evaluate_player_score(
                admin.pubkey(),
                shard_pda,
                stance_pda,
                oracle_pubkey,
                &EvaluateScoreArgs {
                    secondary_exit_prices_8: [10_000_000_000; 3],
                    beta_bench_scaled: 0,
                    lambda_dd_scaled: 0,
                    kalshi_outcome_yes: 0,
                    max_multiplier_scaled: SCALE,
                },
            ),
            ix_undelegate_player_stance(admin.pubkey(), shard_pda, stance_pda),
            ix_settle_and_commit_shard(
                admin.pubkey(),
                shard_pda,
                oracle_pubkey,
                &SettleShardArgs {
                    schedule_vault_action: false,
                    vault_action_accounts: vec![],
                },
            ),
        ],
        &admin,
        &[&admin],
    );

    // Compromised session key CANNOT sign distribute_pool_and_fees
    assert_tx_fails(
        &mut h,
        TransactionTarget::Base,
        &[ix_distribute_pool_and_fees(
            compromised_sk.pubkey(),
            shard_pda,
            usdc_mint,
            platform_fee_ata,
            creator_fee_ata,
            None,
            &[(stance_pda, env_pda)],
        )],
        &compromised_sk,
        &[&compromised_sk],
    );

    h.send_base(
        &[ix_distribute_pool_and_fees(
            admin.pubkey(),
            shard_pda,
            usdc_mint,
            platform_fee_ata,
            creator_fee_ata,
            None,
            &[(stance_pda, env_pda)],
        )],
        &admin,
        &[&admin],
    );

    // Compromised session key CANNOT sign claim_prize (neither diverting to sk_ata nor to victim_ata)!
    assert_tx_fails(
        &mut h,
        TransactionTarget::Base,
        &[ix_claim_prize(
            compromised_sk.pubkey(),
            victim.pubkey(),
            shard_pda,
            usdc_mint,
            usdc_mint,
            sk_ata,
            None,
            None,
            None,
            0,
        )],
        &compromised_sk,
        &[&compromised_sk],
    );
    assert_tx_fails(
        &mut h,
        TransactionTarget::Base,
        &[ix_claim_prize(
            compromised_sk.pubkey(),
            victim.pubkey(),
            shard_pda,
            usdc_mint,
            usdc_mint,
            victim_ata,
            None,
            None,
            None,
            0,
        )],
        &compromised_sk,
        &[&compromised_sk],
    );
}

#[test]
fn test_e_pyth_oracle_staleness_and_confidence_safety() {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();
    let creator_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let borel_args = borel_manifest_args();

    h.send_base(
        &[
            ix_initialize_engine_config(
                admin.pubkey(),
                h.platform_fee_ata,
                true,
                BETA_MAX_ROOM_POOL_USDC,
                BETA_MAX_GLOBAL_TVL_USDC,
            ),
            ix_register_cartridge(admin.pubkey(), creator_fee_ata, &borel_args),
        ],
        &admin,
        &[&admin],
    );
    let (manifest_pda, _) = cartridge_manifest_pda(&borel_args.slug_hash);

    let event_id = [0xE5; 32];
    let (shard_pda, _) = room_shard_pda(&event_id, 0);
    let player = Keypair::new();
    let sk = Keypair::new();
    h.svm.airdrop(&player.pubkey(), 5_000_000_000).unwrap();

    let validator = h.svm.validator_identity();
    h.send_base(
        &[ix_initialize_room_shard(
            admin.pubkey(),
            manifest_pda,
            &InitializeRoomShardArgs {
                event_id,
                shard_index: 0,
                start_ts: 1_750_000_000,
                room_pool_usdc: 0,
                crank_task_id: 505,
            },
        )],
        &admin,
        &[&admin],
    );
    h.send_base(
        &[ix_init_stance_and_delegate(
            player.pubkey(),
            shard_pda,
            sk.pubkey(),
            1_750_000_060,
            Some(validator),
            admin.pubkey(),
        )],
        &player,
        &[&player],
    );
    h.send_base(
        &[ix_delegate_room_shard(
            admin.pubkey(),
            event_id,
            0,
            Some(validator),
        )],
        &admin,
        &[&admin],
    );

    let (stance_pda, _) = player_stance_pda(&shard_pda, &player.pubkey());
    h.send_ephemeral(
        &[ix_join_room_and_init_permission(
            player.pubkey(),
            shard_pda,
            stance_pda,
            admin.pubkey(),
        )],
        &player,
        &[&player],
    );

    let oracle_pubkey = Address::new_from_array([0x88; 32]);
    h.set_clock(105, 1_750_000_020);

    // 1. Stale tick (age = 16s > 15s) during gameplay MUST revert submit_stance with StaleOraclePrice (6024)
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(10_000_000_000, 5_000_000, 1_750_000_004, 100),
        )
        .unwrap();
    assert_custom_error(
        &mut h,
        TransactionTarget::Ephemeral,
        &[ix_submit_stance(
            sk.pubkey(),
            shard_pda,
            stance_pda,
            oracle_pubkey,
            admin.pubkey(),
            &SubmitStanceArgs {
                weights_bps: [5_000, 0, 0, 0],
                kalshi_binary_call: 0,
                kalshi_prob_bps: 5_000,
                secondary_prices_8: [10_000_000_000; 3],
                stage1_score_scaled: 0,
            },
        )],
        &sk,
        &[&sk],
        6024, // ErRoomError::StaleOraclePrice
    );

    // 2. Wide confidence tick (151 bps > 150 bps = 1.50%) MUST revert submit_stance with OracleConfidenceTooWide (6025)
    //    price = 10_000_000_000, conf = 151_000_000 (1.51%)
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(10_000_000_000, 151_000_000, 1_750_000_019, 105),
        )
        .unwrap();
    assert_custom_error(
        &mut h,
        TransactionTarget::Ephemeral,
        &[ix_submit_stance(
            sk.pubkey(),
            shard_pda,
            stance_pda,
            oracle_pubkey,
            admin.pubkey(),
            &SubmitStanceArgs {
                weights_bps: [5_000, 0, 0, 0],
                kalshi_binary_call: 0,
                kalshi_prob_bps: 5_000,
                secondary_prices_8: [10_000_000_000; 3],
                stage1_score_scaled: 0,
            },
        )],
        &sk,
        &[&sk],
        6025, // ErRoomError::OracleConfidenceTooWide
    );

    // Healthy tick (age = 1s, conf = 20 bps) succeeds
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(10_000_000_000, 20_000_000, 1_750_000_019, 105),
        )
        .unwrap();
    h.send_ephemeral(
        &[ix_submit_stance(
            sk.pubkey(),
            shard_pda,
            stance_pda,
            oracle_pubkey,
            admin.pubkey(),
            &SubmitStanceArgs {
                weights_bps: [5_000, 0, 0, 0],
                kalshi_binary_call: 0,
                kalshi_prob_bps: 5_000,
                secondary_prices_8: [10_000_000_000; 3],
                stage1_score_scaled: 0,
            },
        )],
        &sk,
        &[&sk],
    );

    // Fulfill VRF and advance to settlement (t = 65s)
    h.svm.set_vrf_randomness(Some([0x55; 32]));
    h.send_ephemeral(
        &[ix_request_settlement_vrf(
            admin.pubkey(),
            shard_pda,
            DEFAULT_EPHEMERAL_QUEUE,
            3,
        )],
        &admin,
        &[&admin],
    );
    let _ = h.svm.warp_to_slot(110);
    h.set_clock(115, 1_750_000_065);

    // 3. Stale tick at settlement (age = 20s > 15s) transitions RoomShard into RoomPhase::RetryGrace without evaluating!
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(11_000_000_000, 10_000_000, 1_750_000_045, 108),
        )
        .unwrap();
    h.send_ephemeral(
        &[ix_evaluate_player_score(
            admin.pubkey(),
            shard_pda,
            stance_pda,
            oracle_pubkey,
            &EvaluateScoreArgs {
                secondary_exit_prices_8: [10_000_000_000; 3],
                beta_bench_scaled: 0,
                lambda_dd_scaled: 0,
                kalshi_outcome_yes: 0,
                max_multiplier_scaled: SCALE,
            },
        )],
        &admin,
        &[&admin],
    );

    h.svm.set_authorized_user(Some(admin.pubkey()));
    let shard_stale: RoomShard = decode_anchor_account(
        &h.svm
            .get_account_for(TransactionTarget::Ephemeral, &shard_pda)
            .unwrap(),
        "RoomShard",
    );
    assert_eq!(shard_stale.phase, RoomPhase::RetryGrace);
    assert_eq!(shard_stale.evaluated_count, 0);

    // 4. Fresh tick evaluates player cleanly, then wide-confidence tick in settle_and_commit_shard ALSO enters RetryGrace!
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(11_000_000_000, 10_000_000, 1_750_000_064, 115),
        )
        .unwrap();
    h.send_ephemeral(
        &[ix_evaluate_player_score(
            admin.pubkey(),
            shard_pda,
            stance_pda,
            oracle_pubkey,
            &EvaluateScoreArgs {
                secondary_exit_prices_8: [10_000_000_000; 3],
                beta_bench_scaled: 0,
                lambda_dd_scaled: 0,
                kalshi_outcome_yes: 0,
                max_multiplier_scaled: SCALE,
            },
        )],
        &admin,
        &[&admin],
    );

    // Inject wide confidence (200 bps > 150 bps) right before settle_and_commit_shard
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(11_000_000_000, 220_000_000, 1_750_000_064, 115),
        )
        .unwrap();
    h.send_ephemeral(
        &[ix_settle_and_commit_shard(
            admin.pubkey(),
            shard_pda,
            oracle_pubkey,
            &SettleShardArgs {
                schedule_vault_action: false,
                vault_action_accounts: vec![],
            },
        )],
        &admin,
        &[&admin],
    );

    let shard_wide: RoomShard = decode_anchor_account(
        &h.svm
            .get_account_for(TransactionTarget::Ephemeral, &shard_pda)
            .unwrap(),
        "RoomShard",
    );
    assert_eq!(
        shard_wide.phase,
        RoomPhase::RetryGrace,
        "wide confidence tick must hold shard in RetryGrace on ER instead of committing bad tick"
    );
    assert_eq!(
        h.svm
            .get_account_for(TransactionTarget::Base, &shard_pda)
            .unwrap()
            .owner,
        DELEGATION_PROGRAM_ID
    );

    // 5. Healthy tick arrives -> settle_and_commit_shard recovers from RetryGrace and commits cleanly to L1!
    h.svm
        .set_account(
            oracle_pubkey,
            make_pyth_oracle_account(11_000_000_000, 10_000_000, 1_750_000_065, 116),
        )
        .unwrap();
    h.send_ephemeral(
        &[
            ix_undelegate_player_stance(admin.pubkey(), shard_pda, stance_pda),
            ix_settle_and_commit_shard(
                admin.pubkey(),
                shard_pda,
                oracle_pubkey,
                &SettleShardArgs {
                    schedule_vault_action: false,
                    vault_action_accounts: vec![],
                },
            ),
        ],
        &admin,
        &[&admin],
    );

    let recovered_l1 = h
        .svm
        .get_account_for(TransactionTarget::Base, &shard_pda)
        .unwrap();
    assert_eq!(recovered_l1.owner, CARTRIDGE_ER_ROOM_ID);
    let recovered_shard: RoomShard = decode_anchor_account(&recovered_l1, "RoomShard");
    assert_eq!(recovered_shard.phase, RoomPhase::SettledCommitted);
}
