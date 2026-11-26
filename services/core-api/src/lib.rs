#![deny(clippy::float_arithmetic)]
//! CartridgeFi Core API (`cartridge-core-api`) — Non-Custodial Venue Router, Kora Gasless Paymaster,
//! 7-Chain USDC Cashier, Vibe Compiler/Simulator, and Real-Time ER Room Lifecycle Gateway.

pub mod cashier;
pub mod constants;
pub mod error;
pub mod keypair;
pub mod kora;
pub mod markets;
pub mod math;
pub mod rooms;
pub mod venues;
pub mod vibe;

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::cashier::{
    create_deposit_intent, get_and_reconcile_deposit_intent, CashierIntentResponse,
    CreateCashierIntentRequest, DepositIntentRecord, DevnetFaucetRequest, DevnetFaucetResponse,
};
use crate::constants::{
    BETA_MAX_ROOM_POOL_USDC, DELEGATION_PROGRAM_ID, DEPLOYER_AND_KEEPER, DEVNET_ROUTER_HTTP,
    DEVNET_ROUTER_WS, DEVNET_TEE_BASE_ENDPOINT, DEVNET_TEE_ENDPOINT_TEMPLATE, ER_ROOM_PROGRAM_ID,
    MINT_USDC, PASSPORT_FULL_ELIGIBILITY, PASSPORT_PROGRAM_ID, PERMISSION_PROGRAM_ID,
    PRIVATE_PAYMENTS_API_URL, REGISTRY_PROGRAM_ID, USDC_UNIT, VAULT_ROUTER_PROGRAM_ID,
};
use crate::error::ApiError;
use crate::keypair::SolanaSigner;
use crate::kora::{process_kora_sponsor, KoraSponsorRequest, KoraSponsorResponse, WalletGasUsage};
use crate::markets::{
    build_market_discovery, deterministic_fallback_ticks, fetch_pyth_ticks_with_fallback,
    now_unix_secs, MarketDiscoveryResponse, PythParsedTick,
};
use crate::math::MatchStakeMode;
use crate::rooms::{
    claim_room_prize, deploy_room_record, settle_room, submit_player_stance, unseal_room_showdown,
    ClaimRoomPrizeRequest, ClaimRoomPrizeResponse, CreatorVaultResponse, DeployRoomRequest,
    MarketPassportRecord, PublicRoomView, RoomPhaseCode, RoomRecord, SettleRoomRequest,
    SubmitStanceRequest, SubmitStanceResponse,
};
use crate::venues::{
    build_session_risk_envelope, process_venue_quote, SessionEnvelopeRequest,
    SessionEnvelopeResponse, VenueQuoteRequest, VenueQuoteResponse,
};
use crate::vibe::{
    first_party_catalog, handle_vibe_compile, simulate_cartridge_economy, CartridgeManifestV2,
    DualRegimeSimulationResponse, VibeCompileRequest, VibeCompileResponse, VibeSimulateRequest,
    VolatilityRegime,
};

#[derive(Debug, Clone)]
pub struct CoreApiConfig {
    pub standalone_dev: bool,
    pub offline_feeds: bool,
    pub platform_fee_account: String,
    pub default_authority: String,
}

impl Default for CoreApiConfig {
    fn default() -> Self {
        let has_external_cluster = std::env::var("DATABASE_URL").is_ok()
            && std::env::var("DRAGONFLY_URL").is_ok()
            && std::env::var("NATS_URL").is_ok();
        let standalone_env = std::env::var("CARTRIDGEFI_STANDALONE_DEV")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(!has_external_cluster);
        let offline_feeds = std::env::var("CARTRIDGEFI_OFFLINE_FEEDS")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let platform_fee_account = std::env::var("CARTRIDGEFI_PLATFORM_FEE_ACCOUNT")
            .unwrap_or_else(|_| DEPLOYER_AND_KEEPER.to_string());
        Self {
            standalone_dev: standalone_env,
            offline_feeds,
            platform_fee_account,
            default_authority: DEPLOYER_AND_KEEPER.to_string(),
        }
    }
}

pub struct EngineMemoryStore {
    pub catalog: BTreeMap<String, CartridgeManifestV2>,
    pub rooms: BTreeMap<String, RoomRecord>,
    pub room_seq: u64,
    pub intent_seq: u64,
    pub faucet_seq: u64,
    pub current_global_tvl_usdc: u64,
    pub cash_ledger: BTreeMap<String, u64>,
    pub intents: BTreeMap<String, DepositIntentRecord>,
    pub gas_ledger: BTreeMap<String, WalletGasUsage>,
    pub envelopes: BTreeMap<String, SessionEnvelopeResponse>,
    pub passports: BTreeMap<String, MarketPassportRecord>,
    pub creator_vaults: BTreeMap<String, CreatorVaultResponse>,
    pub cached_ticks: BTreeMap<String, PythParsedTick>,
    pub cached_oracle_mode: String,
    pub last_oracle_fetch_secs: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub config: CoreApiConfig,
    pub boot_instant: Instant,
    pub http_client: reqwest::Client,
    pub kora_signer: Arc<SolanaSigner>,
    pub store: Arc<RwLock<EngineMemoryStore>>,
}

impl AppState {
    pub fn new(config: CoreApiConfig) -> Self {
        let kora_signer = SolanaSigner::load_or_deterministic(
            "kora_sponsor.json",
            "cartridgefi-kora-paymaster-sponsor",
        );
        Self::with_signer(config, kora_signer)
    }

    pub fn with_signer(config: CoreApiConfig, kora_signer: SolanaSigner) -> Self {
        let now_secs = now_unix_secs();
        let mut catalog = BTreeMap::new();
        for manifest in first_party_catalog() {
            catalog.insert(manifest.metadata.slug.clone(), manifest);
        }

        let initial_ticks = deterministic_fallback_ticks(now_secs);
        let discovery = build_market_discovery(&initial_ticks, "deterministic_fallback");

        let mut rooms = BTreeMap::new();
        let mut room_seq: u64 = 1;

        // Pre-seed showcase lobbies for Borel (#001) and Pulse Runner (#002)
        if let Ok(borel_room) = deploy_room_record(
            DeployRoomRequest {
                slug: Some("borel-macro-blitz-001".to_string()),
                manifest: None,
                authority: Some(config.default_authority.clone()),
                mode: Some(MatchStakeMode::Paper),
                is_private_fog: Some(true),
                entry_stake_usdc_atomic: Some(0),
                duration_secs: Some(60),
                partner_wallet: None,
            },
            &catalog,
            &discovery,
            0,
            room_seq,
            &config.default_authority,
            now_secs,
        ) {
            rooms.insert(borel_room.room_id.clone(), borel_room);
            room_seq += 1;
        }

        if let Ok(runner_room) = deploy_room_record(
            DeployRoomRequest {
                slug: Some("pulse-runner-nvda-sol".to_string()),
                manifest: None,
                authority: Some(config.default_authority.clone()),
                mode: Some(MatchStakeMode::Paper),
                is_private_fog: Some(true),
                entry_stake_usdc_atomic: Some(0),
                duration_secs: Some(90),
                partner_wallet: None,
            },
            &catalog,
            &discovery,
            0,
            room_seq,
            &config.default_authority,
            now_secs,
        ) {
            rooms.insert(runner_room.room_id.clone(), runner_room);
            room_seq += 1;
        }

        let mut creator_vaults = BTreeMap::new();
        creator_vaults.insert(
            DEPLOYER_AND_KEEPER.to_string(),
            CreatorVaultResponse::new_empty(DEPLOYER_AND_KEEPER),
        );

        let http_client = reqwest::Client::builder()
            .user_agent("cartridgefi-core-api/2.0.0")
            .build()
            .unwrap_or_default();

        Self {
            config,
            boot_instant: Instant::now(),
            http_client,
            kora_signer: Arc::new(kora_signer),
            store: Arc::new(RwLock::new(EngineMemoryStore {
                catalog,
                rooms,
                room_seq,
                intent_seq: 1,
                faucet_seq: 1,
                current_global_tvl_usdc: 0,
                cash_ledger: BTreeMap::new(),
                intents: BTreeMap::new(),
                gas_ledger: BTreeMap::new(),
                envelopes: BTreeMap::new(),
                passports: BTreeMap::new(),
                creator_vaults,
                cached_ticks: initial_ticks,
                cached_oracle_mode: "deterministic_fallback".to_string(),
                last_oracle_fetch_secs: 0,
            })),
        }
    }

    pub async fn refresh_or_cached_discovery(&self) -> MarketDiscoveryResponse {
        let now_secs = now_unix_secs();
        {
            let guard = self.store.read().await;
            if now_secs.saturating_sub(guard.last_oracle_fetch_secs) <= 2
                && guard.last_oracle_fetch_secs > 0
            {
                return build_market_discovery(&guard.cached_ticks, &guard.cached_oracle_mode);
            }
        }

        let (ticks, mode) =
            fetch_pyth_ticks_with_fallback(&self.http_client, self.config.offline_feeds).await;
        let discovery = build_market_discovery(&ticks, &mode);
        {
            let mut guard = self.store.write().await;
            guard.cached_ticks = ticks;
            guard.cached_oracle_mode = mode;
            guard.last_oracle_fetch_secs = now_secs;
        }
        discovery
    }
}

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(get_health_handler))
        .route("/v1/markets/discover", get(get_markets_discover_handler))
        .route("/v1/kora/sponsor", post(post_kora_sponsor_handler))
        .route("/v1/venues/quote", post(post_venue_quote_handler))
        .route("/v1/venues/envelope", post(post_venue_envelope_handler))
        .route("/v1/cashier/intent", post(post_cashier_intent_handler))
        .route(
            "/v1/cashier/intent/{intent_id}",
            get(get_cashier_intent_handler),
        )
        .route(
            "/v1/cashier/devnet-faucet",
            post(post_devnet_faucet_handler),
        )
        .route("/v1/vibe/compile", post(post_vibe_compile_handler))
        .route("/v1/vibe/simulate", post(post_vibe_simulate_handler))
        .route("/v1/cartridges", get(get_cartridges_handler))
        .route("/v1/rooms", get(get_rooms_handler))
        .route("/v1/rooms/deploy", post(post_deploy_room_handler))
        .route("/v1/rooms/{room_id}/stance", post(post_room_stance_handler))
        .route("/v1/rooms/{room_id}/unseal", post(post_room_unseal_handler))
        .route("/v1/rooms/{room_id}/settle", post(post_room_settle_handler))
        .route("/v1/rooms/{room_id}/claim", post(post_room_claim_handler))
        .route("/v1/passport/{wallet}", get(get_passport_handler))
        .route(
            "/v1/creators/{wallet}/vault",
            get(get_creator_vault_handler),
        )
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProgramIdsSpec {
    pub registry: String,
    pub er_room: String,
    pub vault_router: String,
    pub passport: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicBlockHealthEndpoints {
    pub router_http: String,
    pub router_ws: String,
    pub tee_base_endpoint: String,
    pub tee_endpoint_template: String,
    pub private_payments_api_url: String,
    pub delegation_program_id: String,
    pub permission_program_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub uptime_secs: u64,
    pub standalone_mode: bool,
    pub active_lobby_count: usize,
    pub total_rooms_tracked: usize,
    pub current_global_tvl_usdc_atomic: u64,
    pub kora_sponsor_pubkey: String,
    pub platform_fee_account: String,
    pub program_ids: ActiveProgramIdsSpec,
    pub magicblock: MagicBlockHealthEndpoints,
}

async fn get_health_handler(State(state): State<AppState>) -> Json<HealthResponse> {
    let guard = state.store.read().await;
    let active_lobby_count = guard
        .rooms
        .values()
        .filter(|r| r.phase != RoomPhaseCode::SettledCommitted)
        .count();
    let total_rooms_tracked = guard.rooms.len();
    let tvl = guard.current_global_tvl_usdc;

    Json(HealthResponse {
        status: "ok".to_string(),
        service: "cartridge-core-api".to_string(),
        version: "2.0.0".to_string(),
        uptime_secs: state.boot_instant.elapsed().as_secs(),
        standalone_mode: state.config.standalone_dev,
        active_lobby_count,
        total_rooms_tracked,
        current_global_tvl_usdc_atomic: tvl,
        kora_sponsor_pubkey: state.kora_signer.pubkey_base58().to_string(),
        platform_fee_account: state.config.platform_fee_account.clone(),
        program_ids: ActiveProgramIdsSpec {
            registry: REGISTRY_PROGRAM_ID.to_string(),
            er_room: ER_ROOM_PROGRAM_ID.to_string(),
            vault_router: VAULT_ROUTER_PROGRAM_ID.to_string(),
            passport: PASSPORT_PROGRAM_ID.to_string(),
        },
        magicblock: MagicBlockHealthEndpoints {
            router_http: DEVNET_ROUTER_HTTP.to_string(),
            router_ws: DEVNET_ROUTER_WS.to_string(),
            tee_base_endpoint: DEVNET_TEE_BASE_ENDPOINT.to_string(),
            tee_endpoint_template: DEVNET_TEE_ENDPOINT_TEMPLATE.to_string(),
            private_payments_api_url: PRIVATE_PAYMENTS_API_URL.to_string(),
            delegation_program_id: DELEGATION_PROGRAM_ID.to_string(),
            permission_program_id: PERMISSION_PROGRAM_ID.to_string(),
        },
    })
}

async fn get_markets_discover_handler(
    State(state): State<AppState>,
) -> Json<MarketDiscoveryResponse> {
    Json(state.refresh_or_cached_discovery().await)
}

async fn post_kora_sponsor_handler(
    State(state): State<AppState>,
    Json(req): Json<KoraSponsorRequest>,
) -> Result<Json<KoraSponsorResponse>, ApiError> {
    let discovery = state.refresh_or_cached_discovery().await;
    let sol_price8 = discovery
        .perps
        .iter()
        .find(|p| p.symbol == "SOL-PERP")
        .map(|p| p.mark_price8)
        .unwrap_or(18_640_000_000);
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let resp = process_kora_sponsor(
        req,
        &state.kora_signer,
        &mut guard.gas_ledger,
        sol_price8,
        now_secs,
    )?;
    Ok(Json(resp))
}

async fn post_venue_quote_handler(
    State(state): State<AppState>,
    Json(req): Json<VenueQuoteRequest>,
) -> Result<Json<VenueQuoteResponse>, ApiError> {
    let discovery = state.refresh_or_cached_discovery().await;
    let resp = process_venue_quote(
        &state.http_client,
        req,
        &discovery,
        &state.config.platform_fee_account,
        state.kora_signer.pubkey_base58(),
        state.config.offline_feeds,
    )
    .await?;
    Ok(Json(resp))
}

async fn post_venue_envelope_handler(
    State(state): State<AppState>,
    Json(req): Json<SessionEnvelopeRequest>,
) -> Result<Json<SessionEnvelopeResponse>, ApiError> {
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let env = build_session_risk_envelope(req, guard.current_global_tvl_usdc, now_secs)?;
    guard.envelopes.insert(env.envelope_id.clone(), env.clone());
    Ok(Json(env))
}

async fn post_cashier_intent_handler(
    State(state): State<AppState>,
    Json(req): Json<CreateCashierIntentRequest>,
) -> Result<Json<CashierIntentResponse>, ApiError> {
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let seq = guard.intent_seq;
    guard.intent_seq = guard.intent_seq.saturating_add(1);
    let store = &mut *guard;
    let resp = create_deposit_intent(
        req,
        &mut store.intents,
        &mut store.cash_ledger,
        seq,
        now_secs,
        state.config.standalone_dev,
    )?;
    Ok(Json(resp))
}

async fn get_cashier_intent_handler(
    State(state): State<AppState>,
    Path(intent_id): Path<String>,
) -> Result<Json<CashierIntentResponse>, ApiError> {
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let store = &mut *guard;
    let resp = get_and_reconcile_deposit_intent(
        &intent_id,
        &mut store.intents,
        &mut store.cash_ledger,
        now_secs,
        state.config.standalone_dev,
    )?;
    Ok(Json(resp))
}

async fn post_devnet_faucet_handler(
    State(state): State<AppState>,
    Json(req): Json<DevnetFaucetRequest>,
) -> Result<Json<DevnetFaucetResponse>, ApiError> {
    let wallet = req.wallet.trim();
    if wallet.len() < 32 || wallet.len() > 48 {
        return Err(ApiError::bad_request(
            "INVALID_WALLET",
            "Wallet must be a valid base58 Solana public key.",
        ));
    }
    let credited = req
        .amount_usdc_atomic
        .unwrap_or(100 * USDC_UNIT)
        .clamp(USDC_UNIT, BETA_MAX_ROOM_POOL_USDC);
    let bitmask = req.eligibility_bitmask.unwrap_or(PASSPORT_FULL_ELIGIBILITY);

    let mut guard = state.store.write().await;
    let seq = guard.faucet_seq;
    guard.faucet_seq = guard.faucet_seq.saturating_add(1);

    let bal = guard.cash_ledger.entry(wallet.to_string()).or_insert(0);
    *bal = bal.saturating_add(credited);
    let updated_bal = *bal;

    let passport = guard
        .passports
        .entry(wallet.to_string())
        .or_insert_with(|| MarketPassportRecord::new_default(wallet, bitmask));
    if req.eligibility_bitmask.is_some() {
        passport.eligibility_bitmask = bitmask;
    }
    let final_mask = passport.eligibility_bitmask;

    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"devnet_faucet:");
    h.update(wallet.as_bytes());
    h.update(seq.to_le_bytes());
    let d = h.finalize();
    let faucet_signature = bs58::encode([d.as_slice(), d.as_slice()].concat()).into_string();

    Ok(Json(DevnetFaucetResponse {
        wallet: wallet.to_string(),
        canonical_mint: MINT_USDC.to_string(),
        credited_usdc_atomic: credited,
        unified_usdc_balance_atomic: updated_bal,
        eligibility_bitmask: final_mask,
        faucet_signature,
    }))
}

async fn post_vibe_compile_handler(
    State(state): State<AppState>,
    Json(req): Json<VibeCompileRequest>,
) -> Result<Json<VibeCompileResponse>, ApiError> {
    let resp = handle_vibe_compile(req)?;
    {
        let mut guard = state.store.write().await;
        guard
            .catalog
            .insert(resp.manifest.metadata.slug.clone(), resp.manifest.clone());
    }
    Ok(Json(resp))
}

async fn post_vibe_simulate_handler(
    State(state): State<AppState>,
    Json(req): Json<VibeSimulateRequest>,
) -> Result<Json<DualRegimeSimulationResponse>, ApiError> {
    let manifest = if let Some(m) = req.manifest {
        let check = crate::vibe::validate_manifest_compliance(&m, "");
        if !check.valid {
            return Err(ApiError::compliance(check.violations));
        }
        m
    } else {
        let slug = req.slug.as_deref().unwrap_or("borel-macro-blitz-001");
        let guard = state.store.read().await;
        guard.catalog.get(slug).cloned().ok_or_else(|| {
            ApiError::not_found(
                "CARTRIDGE_NOT_FOUND",
                format!("Manifest `{slug}` not found."),
            )
        })?
    };

    let ticks = req.tick_count.unwrap_or(500);
    let players = req.simulated_players.unwrap_or(24);
    let requested_regime = req.volatility_regime.unwrap_or(VolatilityRegime::Calm);

    let calm = simulate_cartridge_economy(&manifest, VolatilityRegime::Calm, ticks, players)?;
    let crash_vix35 =
        simulate_cartridge_economy(&manifest, VolatilityRegime::CrashVix35, ticks, players)?;
    let primary = match requested_regime {
        VolatilityRegime::Calm => calm.clone(),
        VolatilityRegime::CrashVix35 => crash_vix35.clone(),
    };

    Ok(Json(DualRegimeSimulationResponse {
        primary,
        calm,
        crash_vix35,
    }))
}

async fn get_cartridges_handler(State(state): State<AppState>) -> Json<Vec<CartridgeManifestV2>> {
    let guard = state.store.read().await;
    Json(guard.catalog.values().cloned().collect())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomsListQuery {
    #[serde(default, alias = "viewer_wallet")]
    pub viewer_wallet: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomsListResponse {
    pub active_count: usize,
    pub rooms: Vec<PublicRoomView>,
}

async fn get_rooms_handler(
    State(state): State<AppState>,
    Query(query): Query<RoomsListQuery>,
) -> Json<RoomsListResponse> {
    let now_secs = now_unix_secs();
    let guard = state.store.read().await;
    let mut rooms: Vec<PublicRoomView> = guard
        .rooms
        .values()
        .filter(|r| query.slug.as_deref().map(|s| r.slug == s).unwrap_or(true))
        .map(|r| r.to_public_view(query.viewer_wallet.as_deref(), now_secs))
        .collect();
    rooms.sort_by_key(|a| std::cmp::Reverse(a.start_ts));
    let active_count = rooms
        .iter()
        .filter(|r| r.phase_code != RoomPhaseCode::SettledCommitted.as_u8())
        .count();
    Json(RoomsListResponse {
        active_count,
        rooms,
    })
}

async fn post_deploy_room_handler(
    State(state): State<AppState>,
    Json(req): Json<DeployRoomRequest>,
) -> Result<Json<PublicRoomView>, ApiError> {
    let discovery = state.refresh_or_cached_discovery().await;
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let seq = guard.room_seq;
    let room = deploy_room_record(
        req,
        &guard.catalog,
        &discovery,
        guard.current_global_tvl_usdc,
        seq,
        &state.config.default_authority,
        now_secs,
    )?;
    guard.room_seq = guard.room_seq.saturating_add(1);
    let view = room.to_public_view(None, now_secs);
    guard.rooms.insert(room.room_id.clone(), room);
    Ok(Json(view))
}

async fn post_room_stance_handler(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Json(req): Json<SubmitStanceRequest>,
) -> Result<Json<SubmitStanceResponse>, ApiError> {
    let discovery = state.refresh_or_cached_discovery().await;
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let store = &mut *guard;
    let room = store.rooms.get_mut(&room_id).ok_or_else(|| {
        ApiError::not_found("ROOM_NOT_FOUND", format!("Room `{room_id}` not found."))
    })?;
    let resp = submit_player_stance(
        room,
        req,
        &discovery,
        &mut store.current_global_tvl_usdc,
        now_secs,
    )?;
    Ok(Json(resp))
}

async fn post_room_unseal_handler(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<PublicRoomView>, ApiError> {
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let room = guard.rooms.get_mut(&room_id).ok_or_else(|| {
        ApiError::not_found("ROOM_NOT_FOUND", format!("Room `{room_id}` not found."))
    })?;
    let view = unseal_room_showdown(room, now_secs)?;
    Ok(Json(view))
}

async fn post_room_settle_handler(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    body: Option<Json<SettleRoomRequest>>,
) -> Result<Json<PublicRoomView>, ApiError> {
    let discovery = state.refresh_or_cached_discovery().await;
    let now_secs = now_unix_secs();
    let req = body.map(|Json(r)| r).unwrap_or(SettleRoomRequest {
        exit_prices8: None,
        kalshi_resolved_yes: None,
    });
    let mut guard = state.store.write().await;
    let store = &mut *guard;
    let room = store.rooms.get_mut(&room_id).ok_or_else(|| {
        ApiError::not_found("ROOM_NOT_FOUND", format!("Room `{room_id}` not found."))
    })?;
    let view = settle_room(
        room,
        req,
        &discovery,
        &mut store.passports,
        &mut store.creator_vaults,
        &mut store.current_global_tvl_usdc,
        &state.config.platform_fee_account,
        now_secs,
    )?;
    Ok(Json(view))
}

async fn post_room_claim_handler(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Json(req): Json<ClaimRoomPrizeRequest>,
) -> Result<Json<ClaimRoomPrizeResponse>, ApiError> {
    let discovery = state.refresh_or_cached_discovery().await;
    let now_secs = now_unix_secs();
    let mut guard = state.store.write().await;
    let store = &mut *guard;
    let room = store.rooms.get_mut(&room_id).ok_or_else(|| {
        ApiError::not_found("ROOM_NOT_FOUND", format!("Room `{room_id}` not found."))
    })?;
    let resp = claim_room_prize(
        room,
        req,
        &discovery,
        &mut store.passports,
        &mut store.cash_ledger,
        now_secs,
    )?;
    Ok(Json(resp))
}

async fn get_passport_handler(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<MarketPassportRecord>, ApiError> {
    let w = wallet.trim();
    if w.len() < 32 || w.len() > 48 {
        return Err(ApiError::bad_request(
            "INVALID_WALLET",
            "Wallet must be a valid base58 Solana public key.",
        ));
    }
    let guard = state.store.read().await;
    if let Some(existing) = guard.passports.get(w) {
        return Ok(Json(existing.clone()));
    }
    Ok(Json(MarketPassportRecord::new_default(
        w,
        PASSPORT_FULL_ELIGIBILITY,
    )))
}

async fn get_creator_vault_handler(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<CreatorVaultResponse>, ApiError> {
    let w = wallet.trim();
    if w.len() < 32 || w.len() > 48 {
        return Err(ApiError::bad_request(
            "INVALID_WALLET",
            "Creator wallet must be a valid base58 Solana public key.",
        ));
    }
    let guard = state.store.read().await;
    if let Some(existing) = guard.creator_vaults.get(w) {
        return Ok(Json(existing.clone()));
    }
    Ok(Json(CreatorVaultResponse::new_empty(w)))
}
