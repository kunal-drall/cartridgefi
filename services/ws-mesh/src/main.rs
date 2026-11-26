#![deny(clippy::float_arithmetic)]
//! Binary entrypoint for `cartridge-ws-mesh` (default port `8788`).

use std::net::SocketAddr;

use cartridge_ws_mesh::{build_ws_router, spawn_ws_mesh_runtime, WsMeshConfig};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,cartridge_ws_mesh=debug")),
        )
        .init();

    let port: u16 = std::env::var("CARTRIDGEFI_WS_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8788);
    let host = std::env::var("CARTRIDGEFI_WS_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let addr: SocketAddr = format!("{host}:{port}").parse()?;

    let config = WsMeshConfig::default();
    let tick_ms = config.tick_interval_ms;
    let (state, shutdown_tx) = spawn_ws_mesh_runtime(config);
    let app = build_ws_router(state);

    let listener = TcpListener::bind(addr).await?;
    info!(%addr, tick_ms, "CartridgeFi WS Mesh listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            let _ = shutdown_tx.send(true);
            info!("Shutdown signal received, stopping cartridge-ws-mesh");
        })
        .await?;

    Ok(())
}
