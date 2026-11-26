#![deny(clippy::float_arithmetic)]
//! Binary entrypoint for `cartridge-keeper-bots` supporting `--once` single-round verification
//! and continuous 24/7 Devnet daemon mode.

use std::time::Duration;

use cartridge_keeper_bots::{run_keeper_cycle_once, KeeperConfig};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,cartridge_keeper_bots=debug")),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let run_once = args.iter().any(|a| a == "--once");

    let config = KeeperConfig::default();

    if run_once {
        info!("Starting cartridge-keeper-bots in --once mode");
        let report = run_keeper_cycle_once(&config).await?;
        info!(
            borel_room = %report.borel_round.room_id,
            pulse_runner_room = %report.pulse_runner_round.room_id,
            borel_conserved = report.borel_round.payout_conservation_verified,
            runner_conserved = report.pulse_runner_round.payout_conservation_verified,
            creator_earned_atomic = report.creator_vault_after.total_earned_creator_usdc_atomic,
            "Completed single keeper & 3-bot round cycle successfully"
        );
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    info!(
        cadence_secs = config.loop_interval_secs,
        api_url = %config.core_api_url,
        "Starting cartridge-keeper-bots continuous 24/7 daemon loop"
    );

    let mut cycle_idx: u64 = 0;
    loop {
        cycle_idx = cycle_idx.saturating_add(1);
        match run_keeper_cycle_once(&config).await {
            Ok(report) => {
                info!(
                    cycle = cycle_idx,
                    borel_room = %report.borel_round.room_id,
                    pulse_runner_room = %report.pulse_runner_round.room_id,
                    saved_swaps = report.pulse_runner_round.saved_netted_swaps_total,
                    "Keeper cycle completed"
                );
            }
            Err(err) => {
                error!(cycle = cycle_idx, error = %err, "Keeper cycle encountered transient error");
            }
        }

        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("Shutdown signal received, exiting cartridge-keeper-bots daemon");
                break;
            }
            _ = tokio::time::sleep(Duration::from_secs(config.loop_interval_secs.max(1))) => {}
        }
    }

    Ok(())
}
