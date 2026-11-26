#![deny(clippy::float_arithmetic)]
//! Binary entrypoint for `cartridge-core-api` (default port `8787`, zero-Docker standalone dev ready).

use std::net::SocketAddr;

use cartridge_core_api::{build_router, AppState, CoreApiConfig};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,cartridge_core_api=debug")),
        )
        .init();

    let port: u16 = std::env::var("CARTRIDGEFI_API_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8787);
    let host = std::env::var("CARTRIDGEFI_API_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let addr: SocketAddr = format!("{host}:{port}").parse()?;

    let config = CoreApiConfig::default();
    let standalone = config.standalone_dev;
    let state = AppState::new(config);
    let sponsor_pubkey = state.kora_signer.pubkey_base58().to_string();
    let app = build_router(state);

    let listener = TcpListener::bind(addr).await?;
    info!(
        %addr,
        standalone_dev = standalone,
        kora_sponsor = %sponsor_pubkey,
        "CartridgeFi Core API listening"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    info!("Shutdown signal received, stopping cartridge-core-api");
}
