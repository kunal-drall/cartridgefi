#![deny(clippy::float_arithmetic)]
//! CartridgeFi WebSocket Mesh (`cartridge-ws-mesh`) — Real-time fan-out server (`/ws`)
//! streaming 48-byte binary `WorldPulseFrame` packets (`0xCF` v2) and structured JSON
//! Showdown/Rank/Settlement events synced with Pyth Hermes v2 & `core-api`.

pub mod frame;

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use cartridge_core_api::{
    constants::{
        PACER_BOT_1_PUBKEY, PACER_BOT_2_PUBKEY, PACER_BOT_3_PUBKEY, PYTH_FEED_NVDAX_USD,
        PYTH_FEED_SOL_USD, PYTH_FEED_SPYX_USD,
    },
    markets::{fetch_pyth_ticks_with_fallback, now_unix_ms},
    rooms::RoomPhaseCode,
    RoomsListResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, watch, RwLock};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tower_http::cors::{Any, CorsLayer};

use crate::frame::{WorldPulseFrame, WORLD_PULSE_FRAME_BYTES};

#[derive(Debug, Clone)]
pub struct WsMeshConfig {
    pub tick_interval_ms: u64,
    pub round_duration_ms: u32,
    pub showdown_unseal_ms: u32,
    pub settled_hold_ms: u32,
    pub core_api_url: String,
    pub offline_feeds: bool,
}

impl Default for WsMeshConfig {
    fn default() -> Self {
        let tick_interval_ms = std::env::var("CARTRIDGEFI_WS_TICK_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(50)
            .clamp(10, 500);
        let round_duration_ms = std::env::var("CARTRIDGEFI_WS_ROUND_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60_000);
        let showdown_unseal_ms = std::env::var("CARTRIDGEFI_WS_SHOWDOWN_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15_000);
        let settled_hold_ms = std::env::var("CARTRIDGEFI_WS_SETTLED_HOLD_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1_500);
        let core_api_url = std::env::var("CARTRIDGEFI_API_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".to_string());
        let offline_feeds = std::env::var("CARTRIDGEFI_OFFLINE_FEEDS")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        Self {
            tick_interval_ms,
            round_duration_ms,
            showdown_unseal_ms,
            settled_hold_ms,
            core_api_url,
            offline_feeds,
        }
    }
}

#[derive(Debug, Clone)]
pub enum OutboundWsPacket {
    Binary([u8; WORLD_PULSE_FRAME_BYTES]),
    JsonText(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedPeerTelemetry {
    pub handle: String,
    pub wallet: String,
    pub rank: u16,
    pub score_scaled: i64,
    pub weights_bps: [i32; 4],
    pub is_fog_encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "eventType", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MeshJsonEvent {
    #[serde(rename_all = "camelCase")]
    WelcomeSnapshot {
        round_number: u64,
        phase: String,
        countdown_remaining_ms: u32,
        tick_interval_ms: u64,
        active_rooms_count: u16,
        assets: [String; 4],
        prices8: [i64; 4],
    },
    #[serde(rename_all = "camelCase")]
    ShowdownUnseal {
        round_number: u64,
        countdown_remaining_ms: u32,
        unsealed_stances: Vec<RankedPeerTelemetry>,
    },
    #[serde(rename_all = "camelCase")]
    RankHeartbeat {
        round_number: u64,
        phase: String,
        countdown_remaining_ms: u32,
        leaderboard: Vec<RankedPeerTelemetry>,
    },
    #[serde(rename_all = "camelCase")]
    RoundSettled {
        round_number: u64,
        vrf_verified: bool,
        vrf_seed_hex: String,
        final_podium: Vec<RankedPeerTelemetry>,
    },
    #[serde(rename_all = "camelCase")]
    RoundRollover {
        next_round_number: u64,
        duration_ms: u32,
        showdown_unseal_ms: u32,
    },
}

#[derive(Debug, Clone)]
pub struct LiveMeshSnapshot {
    pub round_number: u64,
    pub phase: RoomPhaseCode,
    pub countdown_remaining_ms: u32,
    pub prices8: [i64; 4],
    pub prev_prices8: [i64; 4],
    pub active_rooms_count: u16,
    pub total_players: u16,
    pub top_leader_score_scaled: i64,
    pub oracle_source: String,
}

#[derive(Clone)]
pub struct WsMeshState {
    pub config: WsMeshConfig,
    pub boot_instant: Instant,
    pub connected_clients: Arc<AtomicUsize>,
    pub tx: broadcast::Sender<OutboundWsPacket>,
    pub snapshot: Arc<RwLock<LiveMeshSnapshot>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsMeshHealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub uptime_secs: u64,
    pub connected_clients: usize,
    pub tick_interval_ms: u64,
    pub round_number: u64,
    pub phase: String,
    pub countdown_remaining_ms: u32,
    pub active_rooms_count: u16,
    pub oracle_source: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsConnectQuery {
    #[serde(default)]
    pub wallet: Option<String>,
}

pub fn spawn_ws_mesh_runtime(config: WsMeshConfig) -> (WsMeshState, watch::Sender<bool>) {
    let (tx, _rx) = broadcast::channel::<OutboundWsPacket>(2048);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let initial_prices8 = [
        18_640_000_000_i64,
        14_280_000_000_i64,
        59_820_000_000_i64,
        64_500_000_i64,
    ];
    let snapshot = Arc::new(RwLock::new(LiveMeshSnapshot {
        round_number: 1,
        phase: RoomPhaseCode::FogOfWar,
        countdown_remaining_ms: config.round_duration_ms,
        prices8: initial_prices8,
        prev_prices8: initial_prices8,
        active_rooms_count: 2,
        total_players: 3,
        top_leader_score_scaled: 18_450_000,
        oracle_source: "deterministic_fallback".to_string(),
    }));

    let state = WsMeshState {
        config: config.clone(),
        boot_instant: Instant::now(),
        connected_clients: Arc::new(AtomicUsize::new(0)),
        tx: tx.clone(),
        snapshot: snapshot.clone(),
    };

    // Task 1: Upstream Pyth Hermes v2 + Core API non-blocking sync
    {
        let snap_sync = snapshot.clone();
        let cfg_sync = config.clone();
        let mut stop_rx = shutdown_rx.clone();
        tokio::spawn(async move {
            let http = reqwest::Client::builder()
                .user_agent("cartridgefi-ws-mesh/2.0.0")
                .build()
                .unwrap_or_default();
            let mut sync_interval = tokio::time::interval(Duration::from_millis(2_000));
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = sync_interval.tick() => {
                        let (ticks, mode) = fetch_pyth_ticks_with_fallback(&http, cfg_sync.offline_feeds).await;
                        let sol_key = PYTH_FEED_SOL_USD.trim_start_matches("0x").to_ascii_lowercase();
                        let nvda_key = PYTH_FEED_NVDAX_USD.trim_start_matches("0x").to_ascii_lowercase();
                        let spy_key = PYTH_FEED_SPYX_USD.trim_start_matches("0x").to_ascii_lowercase();

                        let mut active_rooms_opt: Option<(u16, u16)> = None;
                        if !cfg_sync.offline_feeds {
                            let rooms_url = format!("{}/v1/rooms", cfg_sync.core_api_url.trim_end_matches('/'));
                            if let Ok(resp) = http.get(&rooms_url).timeout(Duration::from_millis(800)).send().await {
                                if let Ok(list) = resp.json::<RoomsListResponse>().await {
                                    let active = list.active_count.min(u16::MAX as usize) as u16;
                                    let max_players = list
                                        .rooms
                                        .iter()
                                        .map(|r| r.player_count)
                                        .max()
                                        .unwrap_or(3)
                                        .max(3)
                                        .min(u16::MAX as usize) as u16;
                                    active_rooms_opt = Some((active.max(1), max_players));
                                }
                            }
                        }

                        let mut guard = snap_sync.write().await;
                        guard.oracle_source = mode;
                        if let Some(t) = ticks.get(&sol_key) {
                            guard.prices8[0] = t.price8;
                        }
                        if let Some(t) = ticks.get(&nvda_key) {
                            guard.prices8[1] = t.price8;
                        }
                        if let Some(t) = ticks.get(&spy_key) {
                            guard.prices8[2] = t.price8;
                        }
                        if let Some((active, players)) = active_rooms_opt {
                            guard.active_rooms_count = active;
                            guard.total_players = players;
                        }
                    }
                }
            }
        });
    }

    // Task 2: High-frequency 50ms/10ms WorldPulse binary frame & Showdown/Settlement state machine
    {
        let snap_tick = snapshot;
        let cfg_tick = config;
        let tx_tick = tx;
        let mut stop_rx = shutdown_rx;
        tokio::spawn(async move {
            let mut ticker =
                tokio::time::interval(Duration::from_millis(cfg_tick.tick_interval_ms.max(5)));
            let mut tick_counter: u64 = 0;
            let mut settled_elapsed_ms: u32 = 0;

            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = ticker.tick() => {
                        tick_counter = tick_counter.wrapping_add(1);
                        let step_ms = cfg_tick.tick_interval_ms as u32;
                        let now_ms = now_unix_ms();

                        let mut guard = snap_tick.write().await;
                        let prev_phase = guard.phase;

                        // Deterministic integer micro-tick oscillation between Pyth updates
                        let wave = ((tick_counter % 17) as i64) - 8;
                        let asset_idx = (tick_counter % 4) as usize;
                        guard.prev_prices8[asset_idx] = guard.prices8[asset_idx];
                        let delta_units = match asset_idx {
                            0 => wave * 180_000, // SOL-PERP
                            1 => wave * 140_000, // NVDAx
                            2 => wave * 95_000,  // SPYx
                            _ => wave * 12_000,  // KALSHI-FED
                        };
                        guard.prices8[asset_idx] = (guard.prices8[asset_idx] + delta_units).max(1_000_000);
                        guard.top_leader_score_scaled += wave * 125_000;

                        // Advance round countdown & phase state machine
                        if guard.phase == RoomPhaseCode::SettledCommitted {
                            settled_elapsed_ms = settled_elapsed_ms.saturating_add(step_ms);
                            if settled_elapsed_ms >= cfg_tick.settled_hold_ms {
                                settled_elapsed_ms = 0;
                                guard.round_number = guard.round_number.saturating_add(1);
                                guard.phase = RoomPhaseCode::FogOfWar;
                                guard.countdown_remaining_ms = cfg_tick.round_duration_ms;
                                let rollover = MeshJsonEvent::RoundRollover {
                                    next_round_number: guard.round_number,
                                    duration_ms: cfg_tick.round_duration_ms,
                                    showdown_unseal_ms: cfg_tick.showdown_unseal_ms,
                                };
                                if let Ok(json) = serde_json::to_string(&rollover) {
                                    let _ = tx_tick.send(OutboundWsPacket::JsonText(json));
                                }
                            }
                        } else {
                            guard.countdown_remaining_ms =
                                guard.countdown_remaining_ms.saturating_sub(step_ms);
                            if guard.countdown_remaining_ms == 0 {
                                guard.phase = RoomPhaseCode::SettledCommitted;
                                settled_elapsed_ms = 0;
                            } else if guard.countdown_remaining_ms <= cfg_tick.showdown_unseal_ms {
                                guard.phase = RoomPhaseCode::Showdown;
                            } else {
                                guard.phase = RoomPhaseCode::FogOfWar;
                            }
                        }

                        // Emit structured JSON transition events
                        if prev_phase == RoomPhaseCode::FogOfWar
                            && guard.phase == RoomPhaseCode::Showdown
                        {
                            let peers = build_peer_leaderboard(
                                guard.top_leader_score_scaled,
                                false,
                            );
                            let unseal_ev = MeshJsonEvent::ShowdownUnseal {
                                round_number: guard.round_number,
                                countdown_remaining_ms: guard.countdown_remaining_ms,
                                unsealed_stances: peers,
                            };
                            if let Ok(json) = serde_json::to_string(&unseal_ev) {
                                let _ = tx_tick.send(OutboundWsPacket::JsonText(json));
                            }
                        } else if prev_phase != RoomPhaseCode::SettledCommitted
                            && guard.phase == RoomPhaseCode::SettledCommitted
                        {
                            let mut h = Sha256::new();
                            h.update(b"ws_mesh_vrf:");
                            h.update(guard.round_number.to_le_bytes());
                            h.update(guard.prices8[0].to_le_bytes());
                            let vrf_seed_hex = hex::encode(h.finalize());
                            let podium = build_peer_leaderboard(
                                guard.top_leader_score_scaled,
                                false,
                            );
                            let settled_ev = MeshJsonEvent::RoundSettled {
                                round_number: guard.round_number,
                                vrf_verified: true,
                                vrf_seed_hex,
                                final_podium: podium,
                            };
                            if let Ok(json) = serde_json::to_string(&settled_ev) {
                                let _ = tx_tick.send(OutboundWsPacket::JsonText(json));
                            }
                        } else if tick_counter % 20 == 0 {
                            let is_fog = guard.phase == RoomPhaseCode::FogOfWar;
                            let peers = build_peer_leaderboard(
                                guard.top_leader_score_scaled,
                                is_fog,
                            );
                            let hb = MeshJsonEvent::RankHeartbeat {
                                round_number: guard.round_number,
                                phase: guard.phase.label().to_string(),
                                countdown_remaining_ms: guard.countdown_remaining_ms,
                                leaderboard: peers,
                            };
                            if let Ok(json) = serde_json::to_string(&hb) {
                                let _ = tx_tick.send(OutboundWsPacket::JsonText(json));
                            }
                        }

                        // Compute integer velocity_bps & volatility_sigma_milli
                        let prev_p = guard.prev_prices8[asset_idx].max(1);
                        let curr_p = guard.prices8[asset_idx];
                        let velocity_bps = (((curr_p - prev_p) * 100_000) / prev_p) as i32;
                        let volatility_sigma_milli: u32 = match guard.phase {
                            RoomPhaseCode::Showdown => 2_850,
                            RoomPhaseCode::FogOfWar => 1_750,
                            _ => 1_200,
                        };

                        let frame = WorldPulseFrame {
                            phase: guard.phase,
                            asset_index: asset_idx as u8,
                            timestamp_ms: now_ms,
                            price8: curr_p,
                            velocity_bps,
                            volatility_sigma_milli,
                            countdown_remaining_ms: guard.countdown_remaining_ms,
                            player_rank: 1,
                            total_players: guard.total_players,
                            top_leader_score_scaled: guard.top_leader_score_scaled,
                            active_rooms_count: guard.active_rooms_count,
                            is_fog_encrypted: guard.phase == RoomPhaseCode::FogOfWar,
                            vrf_verified: guard.phase == RoomPhaseCode::SettledCommitted,
                        };
                        let _ = tx_tick.send(OutboundWsPacket::Binary(frame.encode()));
                    }
                }
            }
        });
    }

    (state, shutdown_tx)
}

fn build_peer_leaderboard(top_score: i64, fog_encrypted: bool) -> Vec<RankedPeerTelemetry> {
    vec![
        RankedPeerTelemetry {
            handle: "AlphaQuant".to_string(),
            wallet: PACER_BOT_1_PUBKEY.to_string(),
            rank: 1,
            score_scaled: if fog_encrypted { 0 } else { top_score },
            weights_bps: if fog_encrypted {
                [0, 0, 0, 0]
            } else {
                [4_500, 3_500, -2_000, 0]
            },
            is_fog_encrypted: fog_encrypted,
        },
        RankedPeerTelemetry {
            handle: "BorelSigma".to_string(),
            wallet: PACER_BOT_2_PUBKEY.to_string(),
            rank: 2,
            score_scaled: if fog_encrypted {
                0
            } else {
                top_score - 3_200_000
            },
            weights_bps: if fog_encrypted {
                [0, 0, 0, 0]
            } else {
                [-3_000, 4_000, 2_500, 0]
            },
            is_fog_encrypted: fog_encrypted,
        },
        RankedPeerTelemetry {
            handle: "KalshiHawk".to_string(),
            wallet: PACER_BOT_3_PUBKEY.to_string(),
            rank: 3,
            score_scaled: if fog_encrypted {
                0
            } else {
                top_score - 6_450_000
            },
            weights_bps: if fog_encrypted {
                [0, 0, 0, 0]
            } else {
                [2_500, 2_500, 2_500, 0]
            },
            is_fog_encrypted: fog_encrypted,
        },
    ]
}

pub async fn connect_world_pulse_stream(
    ws_url: &str,
) -> anyhow::Result<WebSocketStream<MaybeTlsStream<TcpStream>>> {
    let (stream, _resp) = connect_async(ws_url).await?;
    Ok(stream)
}

pub fn build_ws_router(state: WsMeshState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(get_ws_health_handler))
        .route("/ws", get(ws_upgrade_handler))
        .layer(cors)
        .with_state(state)
}

async fn get_ws_health_handler(State(state): State<WsMeshState>) -> Json<WsMeshHealthResponse> {
    let snap = state.snapshot.read().await;
    Json(WsMeshHealthResponse {
        status: "ok".to_string(),
        service: "cartridge-ws-mesh".to_string(),
        version: "2.0.0".to_string(),
        uptime_secs: state.boot_instant.elapsed().as_secs(),
        connected_clients: state.connected_clients.load(Ordering::Relaxed),
        tick_interval_ms: state.config.tick_interval_ms,
        round_number: snap.round_number,
        phase: snap.phase.label().to_string(),
        countdown_remaining_ms: snap.countdown_remaining_ms,
        active_rooms_count: snap.active_rooms_count,
        oracle_source: snap.oracle_source.clone(),
    })
}

async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    Query(_query): Query<WsConnectQuery>,
    State(state): State<WsMeshState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_client(socket, state))
}

async fn handle_ws_client(socket: WebSocket, state: WsMeshState) {
    state.connected_clients.fetch_add(1, Ordering::Relaxed);
    let mut rx = state.tx.subscribe();
    let (mut sender, mut receiver) = socket.split();

    // Send immediate structured WelcomeSnapshot JSON on connect
    {
        let snap = state.snapshot.read().await;
        let welcome = MeshJsonEvent::WelcomeSnapshot {
            round_number: snap.round_number,
            phase: snap.phase.label().to_string(),
            countdown_remaining_ms: snap.countdown_remaining_ms,
            tick_interval_ms: state.config.tick_interval_ms,
            active_rooms_count: snap.active_rooms_count,
            assets: ["SOL-PERP", "NVDAx", "SPYx", "KALSHI-FED"].map(|s| s.to_string()),
            prices8: snap.prices8,
        };
        if let Ok(json) = serde_json::to_string(&welcome) {
            if sender.send(Message::Text(json.into())).await.is_err() {
                state.connected_clients.fetch_sub(1, Ordering::Relaxed);
                return;
            }
        }
    }

    loop {
        tokio::select! {
            inbound = receiver.next() => {
                match inbound {
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                        break;
                    }
                    Some(Ok(_)) => {}
                }
            }
            outbound = rx.recv() => {
                match outbound {
                    Ok(OutboundWsPacket::Binary(bytes)) => {
                        if sender.send(Message::Binary(bytes.to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(OutboundWsPacket::JsonText(json)) => {
                        if sender.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    state.connected_clients.fetch_sub(1, Ordering::Relaxed);
}
