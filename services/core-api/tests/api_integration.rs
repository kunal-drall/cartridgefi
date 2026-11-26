#![deny(clippy::float_arithmetic)]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use cartridge_core_api::{
    build_router,
    cashier::{CashierIntentResponse, DevnetFaucetResponse},
    constants::{
        CARTRIDGE_PROGRAM_IDS, DELEGATION_PROGRAM_ID, DEPLOYER_AND_KEEPER, ER_ROOM_PROGRAM_ID,
        KORA_DAILY_LAMPORTS_CAP, MINT_NVDAX, MINT_USDC, PACER_BOT_1_PUBKEY, PACER_BOT_2_PUBKEY,
        PACER_BOT_3_PUBKEY, PASSPORT_GEO_ELIGIBLE, PERMISSION_PROGRAM_ID, SCALE,
        SUPPORTED_DEPOSIT_CHAINS,
    },
    keypair::verify_ed25519_base58,
    kora::KoraSponsorResponse,
    markets::MarketDiscoveryResponse,
    math::{
        compute_direction_neutral_relative_return, compute_drawdown_penalized_sharpe,
        compute_kalshi_brier_score, compute_pool_and_fee_distribution, compute_updated_market_elo,
        BrierForecastItem, MatchStakeMode, PlayerScoreInput, RelativeReturnAssetLeg,
    },
    rooms::{
        ClaimRoomPrizeResponse, CreatorVaultResponse, MarketPassportRecord, PublicRoomView,
        SubmitStanceResponse,
    },
    venues::{SessionEnvelopeResponse, VenueQuoteResponse},
    vibe::{DualRegimeSimulationResponse, VibeCompileResponse},
    AppState, CoreApiConfig, HealthResponse, RoomsListResponse,
};
use reqwest::StatusCode;
use tokio::net::TcpListener;

async fn spawn_test_core_api() -> (String, reqwest::Client) {
    let config = CoreApiConfig {
        standalone_dev: true,
        offline_feeds: true,
        platform_fee_account: DEPLOYER_AND_KEEPER.to_string(),
        default_authority: DEPLOYER_AND_KEEPER.to_string(),
    };
    let state = AppState::new(config);
    let app = build_router(state);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let addr = listener.local_addr().expect("local_addr");
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let client = reqwest::Client::new();
    (format!("http://{addr}"), client)
}

#[test]
fn test_fixed_point_math_and_payout_conservation() {
    let rel = compute_direction_neutral_relative_return(
        &[
            RelativeReturnAssetLeg {
                weight_scaled: 600_000_000,
                entry_price: 10_000_000_000,
                exit_price: 11_000_000_000, // +10%
            },
            RelativeReturnAssetLeg {
                weight_scaled: -400_000_000,
                entry_price: 20_000_000_000,
                exit_price: 19_000_000_000, // -5%
            },
        ],
        500_000_000,
    )
    .expect("valid relative return");
    // Weighted = 0.6*(+0.10) + (-0.4)*(-0.05) = +0.08; Bench = 0.5 * ((0.10 - 0.05)/2) = +0.0125 -> 0.0675 * 10^9
    assert_eq!(rel, 67_500_000);

    let sharpe = compute_drawdown_penalized_sharpe(
        &[12_000_000, 8_000_000, 15_000_000, -2_000_000, 11_000_000],
        4_000_000,
        350_000_000,
        1_000_000_000_000,
    )
    .expect("valid sharpe");
    assert!(sharpe > 0);

    let brier = compute_kalshi_brier_score(&[BrierForecastItem {
        forecast_prob_scaled: 800_000_000,
        outcome_scaled: SCALE,
    }]);
    // 1 - (0.2)^2 = 0.96 -> 960_000_000
    assert_eq!(brier, 960_000_000);

    let elo = compute_updated_market_elo(1_200 * SCALE, 1_200 * SCALE, SCALE, MatchStakeMode::Live);
    // Equal mean ELO => expected 0.5, placement 1.0, K=32 => +16.0 ELO
    assert_eq!(elo.delta_elo_scaled, 16 * SCALE);

    // Test odd prime pool conservation across both 50/50 standalone and 40/30/30 partner wallet splits
    let scores = vec![
        PlayerScoreInput {
            player: PACER_BOT_1_PUBKEY.to_string(),
            score_scaled: 95_000_000,
            tiebreak_key: [3u8; 32],
        },
        PlayerScoreInput {
            player: PACER_BOT_2_PUBKEY.to_string(),
            score_scaled: 42_000_000,
            tiebreak_key: [2u8; 32],
        },
        PlayerScoreInput {
            player: PACER_BOT_3_PUBKEY.to_string(),
            score_scaled: -10_000_000,
            tiebreak_key: [1u8; 32],
        },
        PlayerScoreInput {
            player: DEPLOYER_AND_KEEPER.to_string(),
            score_scaled: -50_000_000,
            tiebreak_key: [0u8; 32],
        },
    ];

    for &pool in &[60_000_000_u64, 77_777_779_u64, 123_456_789_u64] {
        let standalone =
            compute_pool_and_fee_distribution(pool, 250, 5_000, false, &scores).unwrap();
        assert_eq!(standalone.total_distributed_usdc, pool);
        assert_eq!(standalone.partner_fee_usdc, 0);
        assert_eq!(
            standalone.creator_fee_usdc + standalone.platform_fee_usdc,
            standalone.total_fee_usdc
        );

        let partner = compute_pool_and_fee_distribution(pool, 250, 5_000, true, &scores).unwrap();
        assert_eq!(partner.total_distributed_usdc, pool);
        assert_eq!(
            partner.partner_fee_usdc + partner.creator_fee_usdc + partner.platform_fee_usdc,
            partner.total_fee_usdc
        );
    }
}

#[tokio::test]
async fn test_health_and_market_discovery_endpoints() {
    let (base, http) = spawn_test_core_api().await;

    let health: HealthResponse = http
        .get(format!("{base}/health"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(health.status, "ok");
    assert!(health.standalone_mode);
    assert_eq!(health.program_ids.registry, CARTRIDGE_PROGRAM_IDS[0]);
    assert_eq!(health.program_ids.er_room, CARTRIDGE_PROGRAM_IDS[1]);
    assert_eq!(health.program_ids.vault_router, CARTRIDGE_PROGRAM_IDS[2]);
    assert_eq!(health.program_ids.passport, CARTRIDGE_PROGRAM_IDS[3]);
    assert!(health.active_lobby_count >= 2);

    let disc: MarketDiscoveryResponse = http
        .get(format!("{base}/v1/markets/discover"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(disc.canonical_settlement_mint, MINT_USDC);
    assert_eq!(disc.xstocks.len(), 4);
    assert_eq!(disc.perps.len(), 2);
    assert_eq!(disc.predictions.len(), 3);
    assert!(disc.xstocks.iter().all(|x| x.price8 > 0));
    assert!(disc
        .perps
        .iter()
        .all(|p| p.max_leverage == 5 && p.mark_price8 > 0));
}

#[tokio::test]
async fn test_kora_allowlist_signature_and_daily_cap_enforcement() {
    let (base, http) = spawn_test_core_api().await;
    let msg_bytes = b"cartridgefi-kora-test-message-v1";
    let msg_b64 = BASE64.encode(msg_bytes);

    // 1. Rogue program ID must be rejected with 403 Forbidden
    let bad_prog_res = http
        .post(format!("{base}/v1/kora/sponsor"))
        .json(&serde_json::json!({
            "wallet": PACER_BOT_1_PUBKEY,
            "messageBase64": msg_b64,
            "programIds": ["Rogue11111111111111111111111111111111111111"]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_prog_res.status(), StatusCode::FORBIDDEN);

    // 2. Valid allowlisted program succeeds and returns valid Ed25519 signature
    let ok_sponsor: KoraSponsorResponse = http
        .post(format!("{base}/v1/kora/sponsor"))
        .json(&serde_json::json!({
            "wallet": PACER_BOT_1_PUBKEY,
            "messageBase64": msg_b64,
            "programIds": [ER_ROOM_PROGRAM_ID, DELEGATION_PROGRAM_ID, PERMISSION_PROGRAM_ID],
            "estimatedLamports": 3_000_000_u64
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    let sig_vec = bs58::decode(&ok_sponsor.sponsor_signature_base58)
        .into_vec()
        .unwrap();
    let sig_arr: [u8; 64] = sig_vec.try_into().unwrap();
    assert!(verify_ed25519_base58(
        &ok_sponsor.sponsor_pubkey,
        msg_bytes,
        &sig_arr
    ));
    assert!(ok_sponsor.reimbursement_micro_usdc > 0);
    assert_eq!(ok_sponsor.daily_lamports_used, 3_000_000);
    assert_eq!(
        ok_sponsor.daily_lamports_remaining,
        KORA_DAILY_LAMPORTS_CAP - 3_000_000
    );

    // 3. Exceeding 5_000_000 lamports/24h cap must fail with 429 Too Many Requests
    let cap_exceeded = http
        .post(format!("{base}/v1/kora/sponsor"))
        .json(&serde_json::json!({
            "wallet": PACER_BOT_1_PUBKEY,
            "messageBase64": msg_b64,
            "programIds": [ER_ROOM_PROGRAM_ID],
            "estimatedLamports": 2_500_000_u64
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(cap_exceeded.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_venues_quote_racer_5x_leverage_ceiling_and_session_envelope() {
    let (base, http) = spawn_test_core_api().await;

    // 1. Race Jupiter Swap V2 and DFlow for USDC -> NVDAx
    let quote: VenueQuoteResponse = http
        .post(format!("{base}/v1/venues/quote"))
        .json(&serde_json::json!({
            "inputMint": MINT_USDC,
            "outputMint": MINT_NVDAX,
            "amount": 50_000_000_u64,
            "userPublicKey": PACER_BOT_1_PUBKEY
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    assert!(quote.out_amount_atomic > 0);
    assert_eq!(quote.builder_fee_bps, 20);
    assert_eq!(quote.competing_quotes.len(), 2);
    assert_eq!(quote.magicblock_private_fee_route.cluster, "devnet-private");
    assert_eq!(
        quote.magicblock_private_fee_route.platform_fee_account,
        DEPLOYER_AND_KEEPER
    );

    // 2. 5x leverage allowed on Perp quote; 6x leverage rejected!
    let ok_perp: VenueQuoteResponse = http
        .post(format!("{base}/v1/venues/quote"))
        .json(&serde_json::json!({
            "venue": "PHOENIX_PERP",
            "outputMint": "SOL-PERP",
            "amount": 25_000_000_u64,
            "leverage": 5
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ok_perp.leverage, 5);
    assert!(ok_perp.liquidation_price8.is_some());

    let bad_perp = http
        .post(format!("{base}/v1/venues/quote"))
        .json(&serde_json::json!({
            "venue": "PHOENIX_PERP",
            "outputMint": "SOL-PERP",
            "amount": 25_000_000_u64,
            "leverage": 6
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_perp.status(), StatusCode::BAD_REQUEST);

    // 3. Session Risk Envelope enforces <= 5x leverage and isolated session key
    let bad_env = http
        .post(format!("{base}/v1/venues/envelope"))
        .json(&serde_json::json!({
            "ownerWallet": PACER_BOT_1_PUBKEY,
            "ephemeralSessionKey": PACER_BOT_2_PUBKEY,
            "roomId": "borel-macro-blitz-001-r0001",
            "maxCollateralUsdcAtomic": 50_000_000_u64,
            "maxLeverage": 10
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_env.status(), StatusCode::BAD_REQUEST);

    let ok_env: SessionEnvelopeResponse = http
        .post(format!("{base}/v1/venues/envelope"))
        .json(&serde_json::json!({
            "ownerWallet": PACER_BOT_1_PUBKEY,
            "ephemeralSessionKey": PACER_BOT_2_PUBKEY,
            "roomId": "borel-macro-blitz-001-r0001",
            "maxCollateralUsdcAtomic": 50_000_000_u64,
            "maxLeverage": 4
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(ok_env.non_custodial_withdraw_locked_to_owner);
}

#[tokio::test]
async fn test_7_chain_cashier_intents_and_vibe_anti_casino_compliance() {
    let (base, http) = spawn_test_core_api().await;

    for chain in SUPPORTED_DEPOSIT_CHAINS {
        let created: CashierIntentResponse = http
            .post(format!("{base}/v1/cashier/intent"))
            .json(&serde_json::json!({
                "wallet": PACER_BOT_3_PUBKEY,
                "sourceChain": chain,
                "paymentRail": if chain == "solana" { "APPLE_PAY" } else { "CRYPTO_BRIDGE" },
                "amountUsdcAtomic": 10_000_000_u64,
                "autoSettle": false
            }))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(created.intent.canonical_solana_mint, MINT_USDC);

        let polled: CashierIntentResponse = http
            .get(format!(
                "{base}/v1/cashier/intent/{}",
                created.intent.intent_id
            ))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(polled.intent.status, "SETTLED_CANONICAL_USDC");
    }

    let faucet: DevnetFaucetResponse = http
        .post(format!("{base}/v1/cashier/devnet-faucet"))
        .json(&serde_json::json!({
            "wallet": PACER_BOT_3_PUBKEY,
            "amountUsdcAtomic": 50_000_000_u64
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(faucet.unified_usdc_balance_atomic >= 119_000_000);

    // Casino / gambling / >5x leverage prompts MUST be rejected with 422
    for bad_prompt in [
        "Build a paid loot box mystery spin crypto arena",
        "High roller crypto roulette slot machine with 50x leverage",
        "Double or nothing spin casino jackpot room",
    ] {
        let res = http
            .post(format!("{base}/v1/vibe/compile"))
            .json(&serde_json::json!({
                "prompt": bad_prompt,
                "genre": "BOREL_GAMEDAY",
                "creatorWallet": DEPLOYER_AND_KEEPER
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    // Valid skill-first prompt compiles & simulates deterministically
    let compiled: VibeCompileResponse = http
        .post(format!("{base}/v1/vibe/compile"))
        .json(&serde_json::json!({
            "prompt": "90s 3-lane TSLA and BTC volatility sprint with Kalshi Fed rate gate",
            "genre": "ARCADE_RUNNER",
            "creatorWallet": DEPLOYER_AND_KEEPER
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(compiled.valid);

    let sim: DualRegimeSimulationResponse = http
        .post(format!("{base}/v1/vibe/simulate"))
        .json(&serde_json::json!({
            "manifest": compiled.manifest,
            "volatilityRegime": "crash_vix35",
            "tickCount": 500,
            "simulatedPlayers": 20
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(sim.calm.payout_conservation_verified);
    assert!(sim.crash_vix35.payout_conservation_verified);
}

#[tokio::test]
async fn test_room_lifecycle_fog_of_war_partner_split_and_geo_bitmask_claim() {
    let (base, http) = spawn_test_core_api().await;

    // Deploy room with Partner Wallet active (`40% partner / 30% creator / 30% engine` fee split)
    let partner_wallet = "Partner1111111111111111111111111111111111111";
    let room: PublicRoomView = http
        .post(format!("{base}/v1/rooms/deploy"))
        .json(&serde_json::json!({
            "slug": "borel-macro-blitz-001",
            "mode": "LIVE",
            "isPrivateFog": true,
            "entryStakeUsdcAtomic": 40_000_000_u64,
            "partnerWallet": partner_wallet
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    let room_id = room.room_id;

    // Submit 3 stances
    for (wallet, weights, call) in [
        (PACER_BOT_1_PUBKEY, [5_000, 5_000, 0, 0], 2_u8),
        (PACER_BOT_2_PUBKEY, [-4_000, 3_000, 2_000, 0], 1_u8),
        (PACER_BOT_3_PUBKEY, [2_000, 2_000, 2_000, 0], 2_u8),
    ] {
        let _s: SubmitStanceResponse = http
            .post(format!("{base}/v1/rooms/{room_id}/stance"))
            .json(&serde_json::json!({
                "player": wallet,
                "weightsBps": weights,
                "kalshiBinaryCall": call
            }))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
    }

    // Verify Fog-of-War hides rival stances when queried publicly, while allowing Bot 1 to inspect only its own
    let public_list: RoomsListResponse = http
        .get(format!("{base}/v1/rooms?slug=borel-macro-blitz-001"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let fog_view = public_list
        .rooms
        .iter()
        .find(|r| r.room_id == room_id)
        .unwrap();
    assert!(fog_view.fog_currently_encrypted);
    assert!(fog_view
        .stances
        .iter()
        .all(|s| s.weights_bps == [0, 0, 0, 0]));

    let viewer_list: RoomsListResponse = http
        .get(format!(
            "{base}/v1/rooms?slug=borel-macro-blitz-001&viewerWallet={PACER_BOT_1_PUBKEY}"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let viewer_room = viewer_list
        .rooms
        .iter()
        .find(|r| r.room_id == room_id)
        .unwrap();
    let own = viewer_room
        .stances
        .iter()
        .find(|s| s.player == PACER_BOT_1_PUBKEY)
        .unwrap();
    assert_eq!(own.weights_bps, [5_000, 5_000, 0, 0]);
    assert!(viewer_room
        .stances
        .iter()
        .filter(|s| s.player != PACER_BOT_1_PUBKEY)
        .all(|s| s.weights_bps == [0, 0, 0, 0]));

    // Unseal at Showdown (T - 15s)
    let unsealed: PublicRoomView = http
        .post(format!("{base}/v1/rooms/{room_id}/unseal"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(unsealed.phase, "SHOWDOWN");
    assert!(!unsealed.fog_currently_encrypted);
    assert!(unsealed
        .stances
        .iter()
        .all(|s| s.weights_bps != [0, 0, 0, 0]));

    // Settle room (`room_pool = 120 USDC = 120_000_000`, `2.5%` fee = `3_000_000` -> 40/30/30 = `1_200_000` / `900_000` / `900_000`)
    let settled: PublicRoomView = http
        .post(format!("{base}/v1/rooms/{room_id}/settle"))
        .json(&serde_json::json!({
            "exitPrices8": [20_500_000_000_i64, 15_900_000_000_i64, 60_000_000_000_i64, 100_000_000_i64],
            "kalshiResolvedYes": true
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();

    let summary = settled.settlement.unwrap();
    assert!(summary.payout_conservation_verified);
    assert_eq!(summary.room_pool_usdc_atomic, 120_000_000);
    assert_eq!(summary.total_fee_usdc_atomic, 3_000_000);
    assert_eq!(summary.partner_fee_usdc_atomic, 1_200_000);
    assert_eq!(summary.creator_fee_usdc_atomic, 900_000);
    assert_eq!(summary.platform_fee_usdc_atomic, 900_000);
    assert_eq!(summary.total_distributed_usdc_atomic, 120_000_000);

    let rank1_player = summary.payouts[0].player.clone();
    let rank2_player = summary.payouts[1].player.clone();

    // Geo-bitmask enforcement: claiming NVDAx without CAN_CLAIM_XSTOCKS bit (`bitmask = 1`) must return 403 Forbidden
    let blocked_claim = http
        .post(format!("{base}/v1/rooms/{room_id}/claim"))
        .json(&serde_json::json!({
            "player": rank2_player,
            "desiredAsset": "NVDAx",
            "eligibilityBitmask": PASSPORT_GEO_ELIGIBLE
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(blocked_claim.status(), StatusCode::FORBIDDEN);

    // Passing `fallbackToUsdc: true` settles restricted wallet safely in canonical USDC
    let fallback_claim: ClaimRoomPrizeResponse = http
        .post(format!("{base}/v1/rooms/{room_id}/claim"))
        .json(&serde_json::json!({
            "player": rank2_player,
            "desiredAsset": "NVDAx",
            "eligibilityBitmask": PASSPORT_GEO_ELIGIBLE,
            "fallbackToUsdc": true
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(fallback_claim.geo_fallback_applied);
    assert_eq!(fallback_claim.settled_asset, "USDC");
    assert_eq!(fallback_claim.settled_mint, MINT_USDC);

    // Eligible Rank #1 winner claims NVDAx directly
    let nvda_claim: ClaimRoomPrizeResponse = http
        .post(format!("{base}/v1/rooms/{room_id}/claim"))
        .json(&serde_json::json!({
            "player": rank1_player,
            "desiredAsset": "NVDAx",
            "eligibilityBitmask": 7_u8
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(nvda_claim.settled_asset, "NVDAx");
    assert_eq!(nvda_claim.settled_mint, MINT_NVDAX);
    assert!(nvda_claim.delivered_asset_units_atomic > 0);

    // Verify Passport & Creator Vault endpoints
    let passport: MarketPassportRecord = http
        .get(format!("{base}/v1/passport/{rank1_player}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(passport.matches_played, 1);
    assert_eq!(passport.wins_count, 1);
    assert!(passport.earned_nvda_units > 0);

    let vault: CreatorVaultResponse = http
        .get(format!("{base}/v1/creators/{DEPLOYER_AND_KEEPER}/vault"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(vault.total_earned_creator_usdc_atomic, 900_000);
    assert_eq!(vault.total_partner_usdc_attributed_atomic, 1_200_000);
}
