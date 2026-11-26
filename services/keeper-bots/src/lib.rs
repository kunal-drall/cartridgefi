#![deny(clippy::float_arithmetic)]
//! CartridgeFi Redundant Crank Keeper & 3 Autonomous Devnet AI Pacer Bots
//! (`AlphaQuant`, `BorelSigma`, `KalshiHawk`).
//! Queries MagicBlock Router `getDelegationStatus` and drives full 60s Borel (#001)
//! and 90s Pulse Runner (#002) rounds end-to-end against `core-api` & Solana Devnet.

use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use cartridge_core_api::{
    build_router,
    cashier::DevnetFaucetResponse,
    constants::{
        DELEGATION_PROGRAM_ID, DEVNET_BASE_RPC, DEVNET_ROUTER_HTTP, ER_ROOM_PROGRAM_ID,
        PERMISSION_PROGRAM_ID, SESSION_KEY_PROGRAM_ID,
    },
    keypair::SolanaSigner,
    kora::KoraSponsorResponse,
    markets::MarketDiscoveryResponse,
    rooms::{ClaimRoomPrizeResponse, CreatorVaultResponse, PublicRoomView, SubmitStanceResponse},
    AppState, CoreApiConfig, RoomsListResponse,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tracing::info;

#[derive(Debug, Clone)]
pub struct PacerBotAgent {
    pub handle: &'static str,
    pub signer: SolanaSigner,
    pub session_signer: SolanaSigner,
    pub borel_weights_bps: [i32; 4],
    pub kalshi_call: u8,
    pub preferred_prize_asset: &'static str,
    pub pulse_runner_lanes: &'static [&'static str],
}

impl PacerBotAgent {
    pub fn load_default_squad() -> [Self; 3] {
        let bot1 = SolanaSigner::load_or_deterministic(
            "pacer_bot_1.json",
            "cartridgefi-pacer-bot-1-alphaquant",
        );
        let bot2 = SolanaSigner::load_or_deterministic(
            "pacer_bot_2.json",
            "cartridgefi-pacer-bot-2-borelsigma",
        );
        let bot3 = SolanaSigner::load_or_deterministic(
            "pacer_bot_3.json",
            "cartridgefi-pacer-bot-3-kalshihawk",
        );

        [
            Self {
                handle: "AlphaQuant",
                signer: bot1,
                session_signer: SolanaSigner::deterministic_from_seed("session-alphaquant-v2"),
                borel_weights_bps: [4_500, 3_500, -2_000, 0],
                kalshi_call: 2, // YES
                preferred_prize_asset: "NVDAx",
                pulse_runner_lanes: &["LANE_RIGHT", "LANE_CENTER", "LANE_RIGHT"],
            },
            Self {
                handle: "BorelSigma",
                signer: bot2,
                session_signer: SolanaSigner::deterministic_from_seed("session-borelsigma-v2"),
                borel_weights_bps: [-3_000, 4_000, 2_500, 0],
                kalshi_call: 1, // NO
                preferred_prize_asset: "SPYx",
                pulse_runner_lanes: &[
                    "LANE_LEFT",
                    "LANE_CENTER",
                    "LANE_RIGHT",
                    "LANE_LEFT",
                    "LANE_RIGHT",
                ],
            },
            Self {
                handle: "KalshiHawk",
                signer: bot3,
                session_signer: SolanaSigner::deterministic_from_seed("session-kalshihawk-v2"),
                borel_weights_bps: [2_500, 2_500, 2_500, 0],
                kalshi_call: 2, // YES
                preferred_prize_asset: "USDC",
                pulse_runner_lanes: &["LANE_CENTER", "LANE_RIGHT", "LANE_LEFT", "LANE_RIGHT"],
            },
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationStatusReport {
    pub room_shard_pda: String,
    pub router_endpoint: String,
    pub is_delegated: bool,
    pub assigned_validator: Option<String>,
    pub router_status: String,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouterDelegationResult {
    #[serde(default)]
    is_delegated: bool,
    #[serde(default)]
    fqdn: Option<String>,
    #[serde(default)]
    validator: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BlockhashRpcValue {
    value: BlockhashInner,
}

#[derive(Debug, Deserialize)]
struct BlockhashInner {
    blockhash: String,
}

#[derive(Debug, Clone)]
pub struct KeeperConfig {
    pub core_api_url: String,
    pub router_http_url: String,
    pub solana_rpc_url: String,
    pub offline_mode: bool,
    pub allow_embedded_api_fallback: bool,
    pub phase_step_delay_ms: u64,
    pub loop_interval_secs: u64,
}

impl Default for KeeperConfig {
    fn default() -> Self {
        let offline_mode = std::env::var("CARTRIDGEFI_OFFLINE_FEEDS")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let allow_embedded_api_fallback = std::env::var("CARTRIDGEFI_REQUIRE_EXTERNAL_API")
            .map(|v| !(v == "1" || v.eq_ignore_ascii_case("true")))
            .unwrap_or(true);
        Self {
            core_api_url: std::env::var("CARTRIDGEFI_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8787".to_string()),
            router_http_url: std::env::var("MAGICBLOCK_ROUTER_URL")
                .unwrap_or_else(|_| DEVNET_ROUTER_HTTP.to_string()),
            solana_rpc_url: std::env::var("SOLANA_RPC_URL")
                .unwrap_or_else(|_| DEVNET_BASE_RPC.to_string()),
            offline_mode,
            allow_embedded_api_fallback,
            phase_step_delay_ms: std::env::var("CARTRIDGEFI_FAST_ROUND_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20),
            loop_interval_secs: std::env::var("CARTRIDGEFI_KEEPER_CADENCE_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedRoundReceipt {
    pub slug: String,
    pub room_id: String,
    pub room_shard_pda: String,
    pub delegation_report: DelegationStatusReport,
    pub fog_of_war_redaction_verified: bool,
    pub showdown_unseal_verified: bool,
    pub payout_conservation_verified: bool,
    pub vrf_seed_hex: String,
    pub public_rank_digest_hex: String,
    pub room_pool_usdc_atomic: u64,
    pub total_distributed_usdc_atomic: u64,
    pub platform_fee_usdc_atomic: u64,
    pub creator_fee_usdc_atomic: u64,
    pub saved_netted_swaps_total: u32,
    pub claims_completed: Vec<ClaimRoomPrizeResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeeperCycleReport {
    pub api_base_url: String,
    pub used_embedded_standalone_api: bool,
    pub devnet_blockhash: String,
    pub bot_pubkeys: [String; 3],
    pub kora_sponsored_count: usize,
    pub borel_round: CompletedRoundReceipt,
    pub pulse_runner_round: CompletedRoundReceipt,
    pub creator_vault_after: CreatorVaultResponse,
}

/// Queries MagicBlock Router `getDelegationStatus` (`https://devnet-router.magicblock.app`) with resilient fallback.
pub async fn query_magicblock_delegation_status(
    http: &reqwest::Client,
    router_url: &str,
    room_shard_pda: &str,
    offline_mode: bool,
) -> DelegationStatusReport {
    if offline_mode {
        return DelegationStatusReport {
            room_shard_pda: room_shard_pda.to_string(),
            router_endpoint: router_url.to_string(),
            is_delegated: false,
            assigned_validator: Some("MTEWGuqxUpYZGFJQcp8tLN7x5v9B8F3y2V6D9T3ePER".to_string()),
            router_status: "offline_standalone_fallback".to_string(),
        };
    }

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getDelegationStatus",
        "params": [room_shard_pda]
    });

    if let Ok(resp) = http
        .post(router_url)
        .json(&payload)
        .timeout(Duration::from_millis(2_500))
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(rpc) = resp.json::<JsonRpcResponse<RouterDelegationResult>>().await {
                if let Some(res) = rpc.result {
                    return DelegationStatusReport {
                        room_shard_pda: room_shard_pda.to_string(),
                        router_endpoint: router_url.to_string(),
                        is_delegated: res.is_delegated,
                        assigned_validator: res.validator.or(res.fqdn),
                        router_status: "magicblock_router_live".to_string(),
                    };
                }
            }
        }
    }

    DelegationStatusReport {
        room_shard_pda: room_shard_pda.to_string(),
        router_endpoint: router_url.to_string(),
        is_delegated: false,
        assigned_validator: Some("MTEWGuqxUpYZGFJQcp8tLN7x5v9B8F3y2V6D9T3ePER".to_string()),
        router_status: "router_unreachable_fallback".to_string(),
    }
}

pub async fn fetch_devnet_blockhash_with_fallback(
    http: &reqwest::Client,
    rpc_url: &str,
    offline_mode: bool,
) -> String {
    if !offline_mode {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getLatestBlockhash",
            "params": [{ "commitment": "confirmed" }]
        });
        if let Ok(resp) = http
            .post(rpc_url)
            .json(&payload)
            .timeout(Duration::from_millis(2_500))
            .send()
            .await
        {
            if let Ok(parsed) = resp.json::<JsonRpcResponse<BlockhashRpcValue>>().await {
                if let Some(v) = parsed.result {
                    return v.value.blockhash;
                }
            }
        }
    }
    let mut h = Sha256::new();
    h.update(b"cartridgefi:fallback_blockhash:v2");
    bs58::encode(h.finalize()).into_string()
}

async fn ensure_api_reachable_or_spawn_embedded(
    http: &reqwest::Client,
    config: &KeeperConfig,
) -> anyhow::Result<(String, bool, Option<tokio::sync::oneshot::Sender<()>>)> {
    let base = config.core_api_url.trim_end_matches('/').to_string();
    let health_url = format!("{base}/health");
    if let Ok(resp) = http
        .get(&health_url)
        .timeout(Duration::from_millis(900))
        .send()
        .await
    {
        if resp.status().is_success() {
            return Ok((base, false, None));
        }
    }

    if !config.allow_embedded_api_fallback {
        anyhow::bail!("Core API at {base} is unreachable and embedded fallback is disabled");
    }

    let api_cfg = CoreApiConfig {
        standalone_dev: true,
        offline_feeds: config.offline_mode,
        ..CoreApiConfig::default()
    };
    let state = AppState::new(api_cfg);
    let app = build_router(state);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = stop_rx.await;
            })
            .await;
    });

    let embedded_url = format!("http://{local_addr}");
    info!(%embedded_url, "Spawned embedded standalone cartridge-core-api for keeper cycle");
    Ok((embedded_url, true, Some(stop_tx)))
}

#[allow(clippy::too_many_arguments)]
async fn execute_single_room_round(
    http: &reqwest::Client,
    api_base: &str,
    config: &KeeperConfig,
    slug: &str,
    duration_secs: u32,
    is_arcade_runner: bool,
    bots: &[PacerBotAgent; 3],
) -> anyhow::Result<CompletedRoundReceipt> {
    // 1. Deploy room
    let deploy_resp: PublicRoomView = http
        .post(format!("{api_base}/v1/rooms/deploy"))
        .json(&serde_json::json!({
            "slug": slug,
            "mode": "LIVE",
            "isPrivateFog": true,
            "entryStakeUsdcAtomic": 20_000_000_u64,
            "durationSecs": duration_secs
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let room_id = deploy_resp.room_id.clone();

    // 2. Query MagicBlock Router getDelegationStatus for roomShardPda
    let delegation_report = query_magicblock_delegation_status(
        http,
        &config.router_http_url,
        &deploy_resp.room_shard_pda,
        config.offline_mode,
    )
    .await;

    // 3. All 3 AI Pacer Bots join & submit encrypted stances inside Fog-of-War
    for bot in bots {
        if is_arcade_runner {
            for &lane in bot.pulse_runner_lanes {
                let _stance_resp: SubmitStanceResponse = http
                    .post(format!("{api_base}/v1/rooms/{room_id}/stance"))
                    .json(&serde_json::json!({
                        "player": bot.signer.pubkey_base58(),
                        "ephemeralSessionKey": bot.session_signer.pubkey_base58(),
                        "lane": lane,
                        "kalshiBinaryCall": bot.kalshi_call
                    }))
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?;
            }
        } else {
            let _stance_resp: SubmitStanceResponse = http
                .post(format!("{api_base}/v1/rooms/{room_id}/stance"))
                .json(&serde_json::json!({
                    "player": bot.signer.pubkey_base58(),
                    "ephemeralSessionKey": bot.session_signer.pubkey_base58(),
                    "weightsBps": bot.borel_weights_bps,
                    "kalshiBinaryCall": bot.kalshi_call
                }))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
        }
    }

    // 4. Verify Fog-of-War redacts rival stances before T - 15s unseal
    let rooms_during_fog: RoomsListResponse = http
        .get(format!("{api_base}/v1/rooms?slug={slug}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let fog_room = rooms_during_fog
        .rooms
        .iter()
        .find(|r| r.room_id == room_id)
        .ok_or_else(|| anyhow::anyhow!("deployed room missing from /v1/rooms"))?;
    let fog_of_war_redaction_verified = fog_room.fog_currently_encrypted
        && fog_room
            .stances
            .iter()
            .all(|s| s.is_fog_encrypted && s.weights_bps == [0, 0, 0, 0]);

    if config.phase_step_delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(config.phase_step_delay_ms)).await;
    }

    // 5. Trigger T - 15s Showdown unseal
    let unsealed_room: PublicRoomView = http
        .post(format!("{api_base}/v1/rooms/{room_id}/unseal"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let showdown_unseal_verified = !unsealed_room.fog_currently_encrypted
        && unsealed_room.phase == "SHOWDOWN"
        && unsealed_room
            .stances
            .iter()
            .any(|s| s.weights_bps != [0, 0, 0, 0]);

    if config.phase_step_delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(config.phase_step_delay_ms)).await;
    }

    // 6. Settle room (VRF tie-break + Shapley pool conservation + fee routing to platformFeeAccount)
    let settled_room: PublicRoomView = http
        .post(format!("{api_base}/v1/rooms/{room_id}/settle"))
        .json(&serde_json::json!({}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let saved_netted_swaps_total: u32 = settled_room
        .stances
        .iter()
        .map(|s| s.netting.saved_venue_swaps_count)
        .sum();

    let settlement = settled_room
        .settlement
        .ok_or_else(|| anyhow::anyhow!("settled room missing settlement summary"))?;

    // 7. Claim prizes for winning bots according to their stock/USDC preference
    let mut claims_completed = Vec::new();
    for payout in &settlement.payouts {
        if payout.payout_usdc_atomic > 0 {
            let preferred_asset = bots
                .iter()
                .find(|b| b.signer.pubkey_base58() == payout.player)
                .map(|b| b.preferred_prize_asset)
                .unwrap_or("USDC");
            let claim_resp: ClaimRoomPrizeResponse = http
                .post(format!("{api_base}/v1/rooms/{room_id}/claim"))
                .json(&serde_json::json!({
                    "player": payout.player,
                    "desiredAsset": preferred_asset
                }))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            claims_completed.push(claim_resp);
        }
    }

    Ok(CompletedRoundReceipt {
        slug: slug.to_string(),
        room_id,
        room_shard_pda: deploy_resp.room_shard_pda,
        delegation_report,
        fog_of_war_redaction_verified,
        showdown_unseal_verified,
        payout_conservation_verified: settlement.payout_conservation_verified,
        vrf_seed_hex: settlement.vrf_seed_hex,
        public_rank_digest_hex: settlement.public_rank_digest_hex,
        room_pool_usdc_atomic: settlement.room_pool_usdc_atomic,
        total_distributed_usdc_atomic: settlement.total_distributed_usdc_atomic,
        platform_fee_usdc_atomic: settlement.platform_fee_usdc_atomic,
        creator_fee_usdc_atomic: settlement.creator_fee_usdc_atomic,
        saved_netted_swaps_total,
        claims_completed,
    })
}

/// Runs one complete end-to-end keeper + 3-pacer-bot cycle across Borel (#001, 60s) and Pulse Runner (#002, 90s).
pub async fn run_keeper_cycle_once(config: &KeeperConfig) -> anyhow::Result<KeeperCycleReport> {
    let http = reqwest::Client::builder()
        .user_agent("cartridgefi-keeper-bots/2.0.0")
        .build()?;

    let (api_base, used_embedded, stop_tx_opt) =
        ensure_api_reachable_or_spawn_embedded(&http, config).await?;

    let bots = PacerBotAgent::load_default_squad();
    let bot_pubkeys = [
        bots[0].signer.pubkey_base58().to_string(),
        bots[1].signer.pubkey_base58().to_string(),
        bots[2].signer.pubkey_base58().to_string(),
    ];

    let devnet_blockhash =
        fetch_devnet_blockhash_with_fallback(&http, &config.solana_rpc_url, config.offline_mode)
            .await;

    // Hydrate market discovery
    let _discovery: MarketDiscoveryResponse = http
        .get(format!("{api_base}/v1/markets/discover"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    // Fund all 3 bots via Devnet USDC faucet & sponsor session initialization via Kora
    let mut kora_sponsored_count = 0usize;
    for bot in &bots {
        let _faucet: DevnetFaucetResponse = http
            .post(format!("{api_base}/v1/cashier/devnet-faucet"))
            .json(&serde_json::json!({
                "wallet": bot.signer.pubkey_base58(),
                "amountUsdcAtomic": 100_000_000_u64
            }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let raw_msg = format!(
            "cartridgefi:session_init:{}:{}:{}",
            bot.signer.pubkey_base58(),
            bot.session_signer.pubkey_base58(),
            devnet_blockhash
        );
        let msg_b64 = BASE64.encode(raw_msg.as_bytes());

        let _kora: KoraSponsorResponse = http
            .post(format!("{api_base}/v1/kora/sponsor"))
            .json(&serde_json::json!({
                "wallet": bot.signer.pubkey_base58(),
                "messageBase64": msg_b64,
                "programIds": [
                    ER_ROOM_PROGRAM_ID,
                    DELEGATION_PROGRAM_ID,
                    PERMISSION_PROGRAM_ID,
                    SESSION_KEY_PROGRAM_ID
                ],
                "estimatedLamports": 10_000_u64
            }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        kora_sponsored_count += 1;
    }

    // Drive 60-second Borel (#001) round
    let borel_round = execute_single_room_round(
        &http,
        &api_base,
        config,
        "borel-macro-blitz-001",
        60,
        false,
        &bots,
    )
    .await?;

    // Drive 90-second Pulse Runner (#002) round
    let pulse_runner_round = execute_single_room_round(
        &http,
        &api_base,
        config,
        "pulse-runner-nvda-sol",
        90,
        true,
        &bots,
    )
    .await?;

    // Inspect Creator Vault accounting
    let creator_vault_after: CreatorVaultResponse = http
        .get(format!(
            "{api_base}/v1/creators/{}/vault",
            cartridge_core_api::constants::DEPLOYER_AND_KEEPER
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    if let Some(stop_tx) = stop_tx_opt {
        let _ = stop_tx.send(());
    }

    Ok(KeeperCycleReport {
        api_base_url: api_base,
        used_embedded_standalone_api: used_embedded,
        devnet_blockhash,
        bot_pubkeys,
        kora_sponsored_count,
        borel_round,
        pulse_runner_round,
        creator_vault_after,
    })
}
