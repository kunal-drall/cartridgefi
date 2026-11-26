#![deny(clippy::float_arithmetic)]

use cartridge_core_api::{build_router, AppState, CoreApiConfig};
use cartridge_keeper_bots::{run_keeper_cycle_once, KeeperConfig, PacerBotAgent};
use tokio::net::TcpListener;

#[tokio::test]
async fn test_three_pacer_bots_full_borel_and_pulse_runner_lifecycle() {
    let squad = PacerBotAgent::load_default_squad();
    assert_eq!(squad.len(), 3);
    assert_eq!(squad[0].handle, "AlphaQuant");
    assert_eq!(squad[1].handle, "BorelSigma");
    assert_eq!(squad[2].handle, "KalshiHawk");

    // Boot in-process Core API
    let api_state = AppState::new(CoreApiConfig {
        standalone_dev: true,
        offline_feeds: true,
        ..CoreApiConfig::default()
    });
    let app = build_router(api_state);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test api");
    let addr = listener.local_addr().expect("local_addr");
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let keeper_cfg = KeeperConfig {
        core_api_url: format!("http://{addr}"),
        router_http_url: "https://devnet-router.magicblock.app".to_string(),
        solana_rpc_url: "https://rpc.magicblock.app/devnet".to_string(),
        offline_mode: true,
        allow_embedded_api_fallback: false,
        phase_step_delay_ms: 5,
        loop_interval_secs: 1,
    };

    let report = run_keeper_cycle_once(&keeper_cfg)
        .await
        .expect("complete 3-bot keeper cycle");

    assert!(!report.used_embedded_standalone_api);
    assert_eq!(report.kora_sponsored_count, 3);

    // Verify Borel (#001, 60s) round invariants
    assert!(report.borel_round.fog_of_war_redaction_verified);
    assert!(report.borel_round.showdown_unseal_verified);
    assert!(report.borel_round.payout_conservation_verified);
    assert_eq!(report.borel_round.room_pool_usdc_atomic, 60_000_000);
    assert_eq!(report.borel_round.total_distributed_usdc_atomic, 60_000_000);
    assert_eq!(report.borel_round.claims_completed.len(), 3);

    // Verify Pulse Runner (#002, 90s) round invariants + Stance Netting Engine swap savings
    assert!(report.pulse_runner_round.fog_of_war_redaction_verified);
    assert!(report.pulse_runner_round.showdown_unseal_verified);
    assert!(report.pulse_runner_round.payout_conservation_verified);
    assert!(
        report.pulse_runner_round.saved_netted_swaps_total >= 6,
        "expected Stance Netting Engine to net multi-lane switches, got {}",
        report.pulse_runner_round.saved_netted_swaps_total
    );
    assert_eq!(report.pulse_runner_round.claims_completed.len(), 3);

    // Verify Creator Vault received exact 50% share of 2.50% fee across both 60 USDC rooms
    // Each room: 60_000_000 * 250 / 10_000 = 1_500_000 total fee -> 750_000 creator + 750_000 platform -> 1_500_000 across 2 rooms
    assert_eq!(
        report.creator_vault_after.total_earned_creator_usdc_atomic,
        1_500_000
    );
    assert_eq!(report.creator_vault_after.rooms_settled_count, 2);
}
