#![deny(clippy::float_arithmetic)]

use std::time::Duration;

use cartridge_core_api::rooms::RoomPhaseCode;
use cartridge_ws_mesh::{
    build_ws_router, connect_world_pulse_stream,
    frame::{WorldPulseFrame, WORLD_PULSE_FRAME_BYTES, WORLD_PULSE_MAGIC, WORLD_PULSE_VERSION},
    spawn_ws_mesh_runtime, MeshJsonEvent, WsMeshConfig,
};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

#[test]
fn test_exact_48_byte_world_pulse_frame_layout() {
    let frame = WorldPulseFrame {
        phase: RoomPhaseCode::FogOfWar,
        asset_index: 2,
        timestamp_ms: 0x0102_0304_0506_0708,
        price8: 59_820_000_000,
        velocity_bps: -42,
        volatility_sigma_milli: 2_500,
        countdown_remaining_ms: 44_250,
        player_rank: 1,
        total_players: 18,
        top_leader_score_scaled: 78_900_000,
        active_rooms_count: 4,
        is_fog_encrypted: true,
        vrf_verified: true,
    };

    let bytes = frame.encode();
    assert_eq!(bytes.len(), WORLD_PULSE_FRAME_BYTES);
    assert_eq!(bytes[0], WORLD_PULSE_MAGIC); // 0xCF
    assert_eq!(bytes[1], WORLD_PULSE_VERSION); // 2
    assert_eq!(bytes[2], 1); // FogOfWar
    assert_eq!(bytes[3], 2); // SPYx
    assert_eq!(&bytes[4..12], &0x0102_0304_0506_0708_u64.to_le_bytes());
    assert_eq!(&bytes[12..20], &59_820_000_000_i64.to_le_bytes());
    assert_eq!(&bytes[20..24], &(-42_i32).to_le_bytes());
    assert_eq!(&bytes[24..28], &2_500_u32.to_le_bytes());
    assert_eq!(&bytes[28..32], &44_250_u32.to_le_bytes());
    assert_eq!(&bytes[32..34], &1_u16.to_le_bytes());
    assert_eq!(&bytes[34..36], &18_u16.to_le_bytes());
    assert_eq!(&bytes[36..44], &78_900_000_i64.to_le_bytes());
    assert_eq!(&bytes[44..46], &4_u16.to_le_bytes());
    assert_eq!(&bytes[46..48], &3_u16.to_le_bytes()); // bit0 | bit1 == 3

    let decoded = WorldPulseFrame::decode(&bytes).expect("decode 48-byte frame");
    assert_eq!(decoded, frame);
}

#[tokio::test]
async fn test_ws_mesh_binary_and_json_showdown_stream_lifecycle() {
    let config = WsMeshConfig {
        tick_interval_ms: 15,
        round_duration_ms: 150,
        showdown_unseal_ms: 75,
        settled_hold_ms: 45,
        core_api_url: "http://127.0.0.1:9".to_string(),
        offline_feeds: true,
    };

    let (state, shutdown_tx) = spawn_ws_mesh_runtime(config);
    let app = build_ws_router(state);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ws-mesh");
    let addr = listener.local_addr().expect("local_addr");

    let stop_for_server = shutdown_tx.clone();
    tokio::spawn(async move {
        let mut rx = stop_for_server.subscribe();
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.changed().await;
            })
            .await;
    });

    let ws_url = format!("ws://{addr}/ws");
    let mut ws_stream = connect_world_pulse_stream(&ws_url)
        .await
        .expect("connect /ws");
    ws_stream
        .send(Message::Ping(vec![0x42, 0x99].into()))
        .await
        .expect("send ping");

    let mut saw_pong = false;
    let mut saw_welcome = false;
    let mut saw_fog_binary = false;
    let mut saw_showdown_binary = false;
    let mut saw_settled_binary = false;
    let mut saw_showdown_json = false;
    let mut saw_settled_json = false;
    let mut saw_rollover_json = false;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    while tokio::time::Instant::now() < deadline {
        if saw_welcome
            && saw_fog_binary
            && saw_showdown_binary
            && saw_settled_binary
            && saw_showdown_json
            && saw_settled_json
            && saw_rollover_json
        {
            break;
        }

        let msg_opt = tokio::time::timeout(Duration::from_millis(500), ws_stream.next())
            .await
            .expect("ws frame timeout");
        let Some(Ok(msg)) = msg_opt else {
            break;
        };

        match msg {
            Message::Binary(bin) => {
                assert_eq!(bin.len(), WORLD_PULSE_FRAME_BYTES);
                assert_eq!(bin[0], WORLD_PULSE_MAGIC);
                assert_eq!(bin[1], WORLD_PULSE_VERSION);
                let parsed = WorldPulseFrame::decode(&bin).expect("valid WorldPulseFrame");
                match parsed.phase {
                    RoomPhaseCode::FogOfWar => {
                        assert!(parsed.is_fog_encrypted);
                        saw_fog_binary = true;
                    }
                    RoomPhaseCode::Showdown => {
                        assert!(!parsed.is_fog_encrypted);
                        saw_showdown_binary = true;
                    }
                    RoomPhaseCode::SettledCommitted => {
                        assert!(parsed.vrf_verified);
                        saw_settled_binary = true;
                    }
                    _ => {}
                }
            }
            Message::Text(txt) => {
                let ev: MeshJsonEvent =
                    serde_json::from_str(&txt).expect("valid MeshJsonEvent JSON");
                match ev {
                    MeshJsonEvent::WelcomeSnapshot { .. } => saw_welcome = true,
                    MeshJsonEvent::ShowdownUnseal {
                        unsealed_stances, ..
                    } => {
                        assert_eq!(unsealed_stances.len(), 3);
                        assert!(unsealed_stances.iter().all(|s| !s.is_fog_encrypted));
                        saw_showdown_json = true;
                    }
                    MeshJsonEvent::RoundSettled { vrf_verified, .. } => {
                        assert!(vrf_verified);
                        saw_settled_json = true;
                    }
                    MeshJsonEvent::RoundRollover {
                        next_round_number, ..
                    } => {
                        assert!(next_round_number >= 2);
                        saw_rollover_json = true;
                    }
                    MeshJsonEvent::RankHeartbeat { .. } => {}
                }
            }
            Message::Pong(p) if p.as_ref() == [0x42, 0x99] => {
                saw_pong = true;
            }
            _ => {}
        }
    }

    let _ = ws_stream.close(None).await;
    let _ = shutdown_tx.send(true);

    assert!(saw_pong, "missing Pong response");
    assert!(saw_welcome, "missing WELCOME_SNAPSHOT");
    assert!(saw_fog_binary, "missing FogOfWar 48-byte binary frame");
    assert!(saw_showdown_binary, "missing Showdown 48-byte binary frame");
    assert!(
        saw_settled_binary,
        "missing SettledCommitted 48-byte binary frame"
    );
    assert!(saw_showdown_json, "missing SHOWDOWN_UNSEAL JSON event");
    assert!(saw_settled_json, "missing ROUND_SETTLED JSON event");
    assert!(saw_rollover_json, "missing ROUND_ROLLOVER JSON event");
}
