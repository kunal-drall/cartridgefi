#![forbid(unsafe_code)]

use cartridgefi_onchain_tests::*;
use proptest::prelude::*;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn deterministic_player(index: usize) -> Address {
    let mut bytes = [0u8; 32];
    bytes[0] = 0xAA;
    bytes[1..9].copy_from_slice(&(index as u64 + 1).to_le_bytes());
    bytes[31] = (index & 0xFF) as u8;
    Address::new_from_array(bytes)
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100_000,
        max_shrink_iters: 0,
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    #[test]
    fn fuzz_100k_harmonic_shapley_and_fee_solvency_invariants(
        room_pool_usdc in prop_oneof![
            Just(0u64),
            1u64..=100u64,
            101u64..=BETA_MAX_ROOM_POOL_USDC,
            BETA_MAX_ROOM_POOL_USDC..=1_000_000_000_000_000u64,
            Just(u64::MAX),
        ],
        total_fee_bps in 0u16..=MAX_TOTAL_FEE_BPS,
        creator_share_bps in 0u16..=MAX_CREATOR_SHARE_BPS,
        partner_wallet_active in any::<bool>(),
        raw_scores in prop::collection::vec(
            prop_oneof![
                Just(0i128),
                Just(-SCALE),
                Just(SCALE),
                Just(i128::MIN / 2),
                Just(i128::MAX / 2),
                -10_000_000_000_000i128..=10_000_000_000_000i128,
            ],
            0..=32
        )
    ) {
        let inputs: Vec<ScoreInput> = raw_scores
            .iter()
            .enumerate()
            .map(|(i, s)| ScoreInput {
                player: deterministic_player(i),
                score_scaled: *s,
            })
            .collect();

        let out = compute_pool_and_fee_distribution_exact(
            room_pool_usdc,
            total_fee_bps,
            creator_share_bps,
            partner_wallet_active,
            &inputs,
        )
        .expect("valid domain parameters must never panic or error");

        let winner_sum: u128 = out
            .payouts
            .iter()
            .map(|p| u128::from(p.payout_usdc))
            .sum();
        let fee_sum: u128 = u128::from(out.platform_fee_usdc)
            + u128::from(out.creator_fee_usdc)
            + u128::from(out.partner_fee_usdc);
        let grand_total = winner_sum + fee_sum;

        // Core Solvency Invariant: sum(WinnerPayouts) + sum(FeeSplits) <= RoomPool_USDC
        prop_assert!(
            grand_total <= u128::from(room_pool_usdc),
            "solvency violated: grand_total={grand_total} > room_pool={room_pool_usdc}"
        );
        prop_assert_eq!(u128::from(out.total_distributed_usdc), grand_total);
        prop_assert_eq!(fee_sum, u128::from(out.total_fee_usdc));
        prop_assert_eq!(
            u128::from(out.total_distributed_usdc) + u128::from(out.undistributed_dust_usdc),
            u128::from(room_pool_usdc)
        );

        if !partner_wallet_active {
            prop_assert_eq!(out.partner_fee_usdc, 0);
        }

        if !inputs.is_empty() && out.net_prize_pool_usdc > 0 {
            prop_assert_eq!(winner_sum, u128::from(out.net_prize_pool_usdc));
            prop_assert_eq!(out.total_distributed_usdc, room_pool_usdc);
            prop_assert_eq!(out.undistributed_dust_usdc, 0);
        }

        // Monotonic rank ordering: higher rank never receives strictly less than lower rank
        for w in out.payouts.windows(2) {
            prop_assert_eq!(w[0].rank + 1, w[1].rank);
            prop_assert!(
                w[0].payout_usdc >= w[1].payout_usdc,
                "rank {} payout {} < rank {} payout {}",
                w[0].rank,
                w[0].payout_usdc,
                w[1].rank,
                w[1].payout_usdc
            );
        }
    }
}

#[test]
fn test_f2_onchain_sbf_solvency_bit_for_bit_across_tied_negative_and_partner_vectors() {
    let mut h = CartridgeTestHarness::new();
    let admin = h.admin.insecure_clone();

    // Disable beta mode so we can also test diverse fee/split edge cases cleanly across multiple rooms
    h.send_base(
        &[ix_initialize_engine_config(
            admin.pubkey(),
            h.platform_fee_ata,
            false,
            10_000_000_000,
            100_000_000_000,
        )],
        &admin,
        &[&admin],
    );

    let creator_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let partner_fee_ata = h.create_funded_token_account(h.usdc_mint, admin.pubkey(), 0);
    let manifest_args = RegisterCartridgeArgs {
        slug_hash: slug_hash("solvency-adversarial-matrix"),
        creator_share_bps: 5_000,
        genre_code: 1,
        duration_secs: 60,
        fog_of_war_bps: 7_500,
        max_rebalances: 4,
        scoring_formula: ScoringFormula::DirectionNeutralRelReturn,
        action_binding_mode: ActionBindingMode::ConvictionWeights,
        allowed_feeds_merkle_root: [0x99; 32],
        manifest_uri: pad_uri("https://cartridgefi.com/manifests/solvency.json"),
    };
    h.send_base(
        &[ix_register_cartridge(
            admin.pubkey(),
            creator_fee_ata,
            &manifest_args,
        )],
        &admin,
        &[&admin],
    );
    let (manifest_pda, _) = cartridge_manifest_pda(&manifest_args.slug_hash);

    // Matrix of nasty prime-number micro-USDC deposits, tied scores, all-negative scores, 50/50 & 40/30/30 splits
    let scenarios: &[(u16, bool, &[u64], &[i16])] = &[
        // Scenario 0: 5 players, prime deposits, tied negative & positive scores, 50/50 split, 333 bps fee
        (
            333,
            false,
            &[17_777_779, 23_333_333, 19_999_991, 11_111_117, 13_333_337],
            &[-4_000, -4_000, 0, 7_500, 7_500],
        ),
        // Scenario 1: 6 players, ALL NEGATIVE scores + ties, 40/30/30 partner wallet split, 777 bps fee
        (
            777,
            true,
            &[
                7_000_003, 8_000_009, 9_000_011, 6_000_013, 5_000_017, 4_000_019,
            ],
            &[-9_000, -5_000, -5_000, -2_000, -8_000, -1_000],
        ),
        // Scenario 2: Tiny 7 micro-USDC dust pool across 4 tied players, 1000 bps max fee, 40/30/30 split
        (1_000, true, &[2, 2, 2, 1], &[1_000, 1_000, 1_000, 1_000]),
    ];

    let oracle_pubkey = Address::new_from_array([0xFE; 32]);
    let validator = h.svm.validator_identity();

    for (s_idx, (fee_bps, partner_active, deposits, weights)) in scenarios.iter().enumerate() {
        let base_slot = 500 + (s_idx as u64) * 50;
        h.set_clock(base_slot, 1_750_010_000);

        let mut event_id = [0xF1; 32];
        event_id[0] = s_idx as u8 + 1;
        let (shard_pda, _) = room_shard_pda(&event_id, 0);
        let (vault_usdc_token, _) = room_vault_token_pda(&shard_pda);

        let plat_before = read_spl_token_balance(&h.svm.get_account(&h.platform_fee_ata).unwrap());
        let creator_before = read_spl_token_balance(&h.svm.get_account(&creator_fee_ata).unwrap());
        let partner_before = read_spl_token_balance(&h.svm.get_account(&partner_fee_ata).unwrap());

        h.send_base(
            &[
                ix_initialize_room_shard(
                    admin.pubkey(),
                    manifest_pda,
                    &InitializeRoomShardArgs {
                        event_id,
                        shard_index: 0,
                        start_ts: 1_750_010_000,
                        room_pool_usdc: 0,
                        crank_task_id: 2_000 + s_idx as i64,
                    },
                ),
                ix_initialize_room_vault(
                    admin.pubkey(),
                    shard_pda,
                    manifest_pda,
                    h.usdc_mint,
                    h.platform_fee_ata,
                    creator_fee_ata,
                    if *partner_active {
                        Some(partner_fee_ata)
                    } else {
                        None
                    },
                    *fee_bps,
                    *partner_active,
                    10_000_000,
                    8,
                ),
            ],
            &admin,
            &[&admin],
        );

        let mut players = Vec::new();
        let mut sks = Vec::new();
        let mut player_atas = Vec::new();
        let mut stance_pdas = Vec::new();
        let mut env_pdas = Vec::new();

        for p_idx in 0..deposits.len() {
            let p = Keypair::new();
            let sk = Keypair::new();
            h.svm.airdrop(&p.pubkey(), 5_000_000_000).unwrap();
            let ata = h.create_funded_token_account(h.usdc_mint, p.pubkey(), deposits[p_idx]);

            h.send_base(
                &[
                    ix_open_session_envelope(
                        p.pubkey(),
                        admin.pubkey(),
                        p.pubkey(),
                        shard_pda,
                        h.usdc_mint,
                        ata,
                        deposits[p_idx],
                        1,
                        sk.pubkey(),
                    ),
                    ix_init_stance_and_delegate(
                        p.pubkey(),
                        shard_pda,
                        sk.pubkey(),
                        1_750_010_060,
                        Some(validator),
                        admin.pubkey(),
                    ),
                ],
                &p,
                &[&p],
            );

            stance_pdas.push(player_stance_pda(&shard_pda, &p.pubkey()).0);
            env_pdas.push(session_envelope_pda(&shard_pda, &p.pubkey()).0);
            players.push(p);
            sks.push(sk);
            player_atas.push(ata);
        }

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

        h.svm
            .set_account(
                oracle_pubkey,
                make_pyth_oracle_account(10_000_000_000, 1_000_000, 1_750_010_000, base_slot),
            )
            .unwrap();

        for p_idx in 0..deposits.len() {
            h.send_ephemeral(
                &[
                    ix_join_room_and_init_permission(
                        players[p_idx].pubkey(),
                        shard_pda,
                        stance_pdas[p_idx],
                        admin.pubkey(),
                    ),
                    ix_submit_stance(
                        sks[p_idx].pubkey(),
                        shard_pda,
                        stance_pdas[p_idx],
                        oracle_pubkey,
                        admin.pubkey(),
                        &SubmitStanceArgs {
                            weights_bps: [weights[p_idx], 0, 0, 0],
                            kalshi_binary_call: 0,
                            kalshi_prob_bps: 5_000,
                            secondary_prices_8: [10_000_000_000; 3],
                            stage1_score_scaled: 0,
                        },
                    ),
                ],
                &players[p_idx],
                &[&players[p_idx], &sks[p_idx]],
            );
        }

        h.svm.set_vrf_randomness(Some([0x33; 32]));
        h.send_ephemeral(
            &[ix_request_settlement_vrf(
                admin.pubkey(),
                shard_pda,
                DEFAULT_EPHEMERAL_QUEUE,
                s_idx as u8,
            )],
            &admin,
            &[&admin],
        );
        let _ = h.svm.warp_to_slot(base_slot + 3);
        h.set_clock(base_slot + 10, 1_750_010_065);
        h.svm
            .set_account(
                oracle_pubkey,
                make_pyth_oracle_account(11_000_000_000, 1_000_000, 1_750_010_064, base_slot + 10),
            )
            .unwrap();

        for stance_pda in &stance_pdas {
            h.send_ephemeral(
                &[
                    ix_evaluate_player_score(
                        admin.pubkey(),
                        shard_pda,
                        *stance_pda,
                        oracle_pubkey,
                        &EvaluateScoreArgs {
                            secondary_exit_prices_8: [10_000_000_000; 3],
                            beta_bench_scaled: 0,
                            lambda_dd_scaled: 0,
                            kalshi_outcome_yes: 0,
                            max_multiplier_scaled: SCALE,
                        },
                    ),
                    ix_undelegate_player_stance(admin.pubkey(), shard_pda, *stance_pda),
                ],
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

        let mut score_inputs = Vec::new();
        let mut pairs = Vec::new();
        for p_idx in 0..deposits.len() {
            let st: PlayerStance = decode_anchor_account(
                &h.svm.get_account(&stance_pdas[p_idx]).unwrap(),
                "PlayerStance",
            );
            score_inputs.push(ScoreInput {
                player: players[p_idx].pubkey(),
                score_scaled: st.final_score_scaled,
            });
            pairs.push((stance_pdas[p_idx], env_pdas[p_idx]));
        }

        let total_pool: u64 = deposits.iter().sum();
        let expected = compute_pool_and_fee_distribution_exact(
            total_pool,
            *fee_bps,
            5_000,
            *partner_active,
            &score_inputs,
        )
        .unwrap();

        h.send_base(
            &[ix_distribute_pool_and_fees(
                admin.pubkey(),
                shard_pda,
                h.usdc_mint,
                h.platform_fee_ata,
                creator_fee_ata,
                if *partner_active {
                    Some(partner_fee_ata)
                } else {
                    None
                },
                &pairs,
            )],
            &admin,
            &[&admin],
        );

        // Verify fee token transfers match exact reference math down to 1 micro-USDC
        assert_eq!(
            read_spl_token_balance(&h.svm.get_account(&h.platform_fee_ata).unwrap()) - plat_before,
            expected.platform_fee_usdc
        );
        assert_eq!(
            read_spl_token_balance(&h.svm.get_account(&creator_fee_ata).unwrap()) - creator_before,
            expected.creator_fee_usdc
        );
        assert_eq!(
            read_spl_token_balance(&h.svm.get_account(&partner_fee_ata).unwrap()) - partner_before,
            expected.partner_fee_usdc
        );

        // Claim every non-zero winner payout and verify vault USDC reaches exact 0 dust!
        for p_idx in 0..deposits.len() {
            let env: SessionRiskEnvelope = decode_anchor_account(
                &h.svm.get_account(&env_pdas[p_idx]).unwrap(),
                "SessionRiskEnvelope",
            );
            let exp_item = expected
                .payouts
                .iter()
                .find(|x| x.player == players[p_idx].pubkey())
                .unwrap();
            assert_eq!(env.payout_usdc, exp_item.payout_usdc);
            assert_eq!(env.rank, exp_item.rank);

            if env.payout_usdc > 0 {
                h.send_base(
                    &[ix_claim_prize(
                        players[p_idx].pubkey(),
                        players[p_idx].pubkey(),
                        shard_pda,
                        h.usdc_mint,
                        h.usdc_mint,
                        player_atas[p_idx],
                        None,
                        None,
                        None,
                        0,
                    )],
                    &players[p_idx],
                    &[&players[p_idx]],
                );
            }
            assert_eq!(
                read_spl_token_balance(&h.svm.get_account(&player_atas[p_idx]).unwrap()),
                env.payout_usdc
            );
        }

        // Vault USDC token account balance MUST equal exact undistributed_dust_usdc (0 here)
        assert_eq!(
            read_spl_token_balance(&h.svm.get_account(&vault_usdc_token).unwrap()),
            expected.undistributed_dust_usdc
        );
    }
}
