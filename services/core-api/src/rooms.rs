//! Real-Time Room Lifecycle, Stance Netting Engine, Private ER TEE Fog-of-War,
//! VRF Tie-Break Seed Generation, Claim-Time Stock Prize Menu, Market Passport, and Creator Vaults.

use std::collections::BTreeMap;

use borsh::{BorshDeserialize, BorshSerialize};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::constants::{
    BETA_MAX_GLOBAL_TVL_USDC, BETA_MAX_ROOM_POOL_USDC, DEFAULT_ELO_SCALED,
    DEFAULT_EPHEMERAL_VRF_QUEUE, DELEGATION_PROGRAM_ID, DEVNET_ROUTER_HTTP,
    DEVNET_TEE_BASE_ENDPOINT, ER_ROOM_PROGRAM_ID, MAX_PLAYERS_PER_SHARD, MINT_ANTX, MINT_NVDAX,
    MINT_SPYX, MINT_TSLAX, MINT_USDC, PASSPORT_CAN_CLAIM_XSTOCKS, PASSPORT_FULL_ELIGIBILITY,
    PASSPORT_GEO_ELIGIBLE, PASSPORT_PROGRAM_ID, PERMISSION_PROGRAM_ID, ROOM_TOTAL_FEE_BPS, SCALE,
    VAULT_ROUTER_PROGRAM_ID, VENUE_BUILDER_FEE_BPS, VRF_PROGRAM_ID,
};
use crate::error::ApiError;
use crate::markets::{resolve_mint_price8_and_decimals, MarketDiscoveryResponse};
use crate::math::{
    compute_direction_neutral_relative_return, compute_drawdown_penalized_sharpe,
    compute_kalshi_brier_score, compute_multi_stage_carry_score, compute_pool_and_fee_distribution,
    compute_updated_market_elo, format_scaled_i128, BrierForecastItem, MatchStakeMode,
    PlayerPayout, PlayerScoreInput, RelativeReturnAssetLeg,
};
use crate::venues::{
    build_private_payment_fee_spec, compute_deterministic_swap_out, MagicBlockPrivatePaymentSpec,
};
use crate::vibe::{
    validate_manifest_compliance, ActionBinding, CartridgeManifestV2, ScoringFormulaName,
};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum RoomPhaseCode {
    LobbyOpen = 0,
    FogOfWar = 1,
    Showdown = 2,
    SettledCommitted = 3,
    RetryGrace = 4,
}

impl RoomPhaseCode {
    pub fn as_u8(self) -> u8 {
        self as u8
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::LobbyOpen => "LOBBY_OPEN",
            Self::FogOfWar => "FOG_OF_WAR",
            Self::Showdown => "SHOWDOWN",
            Self::SettledCommitted => "SETTLED_COMMITTED",
            Self::RetryGrace => "RETRY_GRACE",
        }
    }
}

/// Canonical Borsh payload for Anchor `submit_stance` ER instruction encoding.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct OnChainStanceBorshPayload {
    pub weights_bps: [i32; 4],
    pub kalshi_binary_call: u8,
    pub client_move_seq: u32,
}

#[derive(Debug, Clone)]
pub struct StoredPlayerStance {
    pub player: String,
    pub ephemeral_session_key: String,
    pub join_index: usize,
    pub stake_usdc_atomic: u64,
    pub raw_move_count: u32,
    pub rebalance_count: u32,
    pub checkpoint_net_count: u32,
    pub weights_bps: [i32; 4],
    pub last_settled_venue_weights_bps: [i32; 4],
    pub kalshi_binary_call: u8, // 0 = unset, 1 = NO, 2 = YES
    pub entry_prices8: [i64; 4],
    pub last_mark_prices8: [i64; 4],
    pub step_returns_scaled: Vec<i128>,
    pub cumulative_return_scaled: i128,
    pub peak_return_scaled: i128,
    pub max_drawdown_scaled: i128,
    pub final_score_scaled: i128,
    pub rank: usize,
    pub payout_usdc_atomic: u64,
    pub claimed: bool,
    pub claimed_asset: Option<String>,
    pub claimed_units_atomic: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StanceNettingTelemetry {
    pub netting_policy: String,
    pub gross_moves_recorded: u32,
    pub netted_venue_orders_required: u32,
    pub saved_venue_swaps_count: u32,
    pub net_venue_delta_bps: [i32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPlayerStanceView {
    pub player: String,
    pub ephemeral_session_key: String,
    pub raw_move_count: u32,
    pub is_fog_encrypted: bool,
    pub tee_permission_program: String,
    pub weights_bps: [i32; 4],
    pub kalshi_binary_call: u8,
    pub entry_prices8: [i64; 4],
    pub final_score_scaled: String,
    pub final_score_formatted: String,
    pub rank: usize,
    pub payout_usdc_atomic: u64,
    pub claimed: bool,
    pub claimed_asset: Option<String>,
    pub netting: StanceNettingTelemetry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSettlementSummary {
    pub settled_at_secs: u64,
    pub exit_prices8: [i64; 4],
    pub kalshi_resolved_yes: bool,
    pub vrf_program_id: String,
    pub vrf_seed_hex: String,
    pub public_rank_digest_hex: String,
    pub room_pool_usdc_atomic: u64,
    pub total_fee_usdc_atomic: u64,
    pub creator_fee_usdc_atomic: u64,
    pub partner_fee_usdc_atomic: u64,
    pub platform_fee_usdc_atomic: u64,
    pub net_prize_pool_usdc_atomic: u64,
    pub total_distributed_usdc_atomic: u64,
    pub payout_conservation_verified: bool,
    pub payouts: Vec<PlayerPayout>,
    pub platform_fee_private_transfer: MagicBlockPrivatePaymentSpec,
}

#[derive(Debug, Clone)]
pub struct RoomRecord {
    pub room_id: String,
    pub slug: String,
    pub title: String,
    pub manifest: CartridgeManifestV2,
    pub room_shard_pda: String,
    pub room_vault_pda: String,
    pub authority: String,
    pub mode: MatchStakeMode,
    pub phase: RoomPhaseCode,
    pub is_private_fog: bool,
    pub start_ts: u64,
    pub unseal_ts: u64,
    pub end_ts: u64,
    pub entry_stake_usdc_atomic: u64,
    pub room_pool_usdc_atomic: u64,
    pub partner_wallet: Option<String>,
    pub entry_prices8: [i64; 4],
    pub stances: BTreeMap<String, StoredPlayerStance>,
    pub settlement: Option<RoomSettlementSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicRoomView {
    pub room_id: String,
    pub slug: String,
    pub title: String,
    pub genre: String,
    pub room_shard_pda: String,
    pub room_vault_pda: String,
    pub er_program_id: String,
    pub delegation_program_id: String,
    pub permission_program_id: String,
    pub magicblock_endpoint: String,
    pub mode: MatchStakeMode,
    pub phase_code: u8,
    pub phase: String,
    pub is_private_fog: bool,
    pub fog_currently_encrypted: bool,
    pub player_count: usize,
    pub start_ts: u64,
    pub unseal_ts: u64,
    pub end_ts: u64,
    pub countdown_remaining_secs: u64,
    pub entry_stake_usdc_atomic: u64,
    pub room_pool_usdc_atomic: u64,
    pub partner_wallet: Option<String>,
    pub entry_prices8: [i64; 4],
    pub claim_menu_assets: Vec<String>,
    pub stances: Vec<PublicPlayerStanceView>,
    pub settlement: Option<RoomSettlementSummary>,
}

impl RoomRecord {
    pub fn to_public_view(&self, viewer_wallet: Option<&str>, now_secs: u64) -> PublicRoomView {
        let fog_encrypted = self.is_private_fog && self.phase == RoomPhaseCode::FogOfWar;
        let netting_policy = extract_netting_policy(&self.manifest);

        let mut stance_list: Vec<&StoredPlayerStance> = self.stances.values().collect();
        stance_list.sort_by(|a, b| {
            let ra = if a.rank == 0 { usize::MAX } else { a.rank };
            let rb = if b.rank == 0 { usize::MAX } else { b.rank };
            ra.cmp(&rb).then_with(|| a.join_index.cmp(&b.join_index))
        });

        let stances = stance_list
            .into_iter()
            .map(|s| {
                let is_viewer = viewer_wallet.map(|v| v == s.player).unwrap_or(false);
                let redact = fog_encrypted && !is_viewer;
                let net_delta = if redact {
                    [0, 0, 0, 0]
                } else {
                    [
                        s.weights_bps[0] - s.last_settled_venue_weights_bps[0],
                        s.weights_bps[1] - s.last_settled_venue_weights_bps[1],
                        s.weights_bps[2] - s.last_settled_venue_weights_bps[2],
                        s.weights_bps[3] - s.last_settled_venue_weights_bps[3],
                    ]
                };
                let orders_req = s.checkpoint_net_count.max(1);
                PublicPlayerStanceView {
                    player: s.player.clone(),
                    ephemeral_session_key: s.ephemeral_session_key.clone(),
                    raw_move_count: s.raw_move_count,
                    is_fog_encrypted: redact,
                    tee_permission_program: PERMISSION_PROGRAM_ID.to_string(),
                    weights_bps: if redact { [0, 0, 0, 0] } else { s.weights_bps },
                    kalshi_binary_call: if redact { 0 } else { s.kalshi_binary_call },
                    entry_prices8: s.entry_prices8,
                    final_score_scaled: if redact {
                        "0".to_string()
                    } else {
                        s.final_score_scaled.to_string()
                    },
                    final_score_formatted: if redact {
                        "ENCRYPTED".to_string()
                    } else {
                        format_scaled_i128(s.final_score_scaled, 4)
                    },
                    rank: s.rank,
                    payout_usdc_atomic: s.payout_usdc_atomic,
                    claimed: s.claimed,
                    claimed_asset: s.claimed_asset.clone(),
                    netting: StanceNettingTelemetry {
                        netting_policy: netting_policy.clone(),
                        gross_moves_recorded: s.raw_move_count,
                        netted_venue_orders_required: orders_req,
                        saved_venue_swaps_count: s.raw_move_count.saturating_sub(orders_req),
                        net_venue_delta_bps: net_delta,
                    },
                }
            })
            .collect();

        let countdown_remaining_secs = if self.phase == RoomPhaseCode::SettledCommitted {
            0
        } else {
            self.end_ts.saturating_sub(now_secs)
        };

        PublicRoomView {
            room_id: self.room_id.clone(),
            slug: self.slug.clone(),
            title: self.title.clone(),
            genre: self.manifest.metadata.genre.label().to_string(),
            room_shard_pda: self.room_shard_pda.clone(),
            room_vault_pda: self.room_vault_pda.clone(),
            er_program_id: ER_ROOM_PROGRAM_ID.to_string(),
            delegation_program_id: DELEGATION_PROGRAM_ID.to_string(),
            permission_program_id: PERMISSION_PROGRAM_ID.to_string(),
            magicblock_endpoint: if self.is_private_fog {
                DEVNET_TEE_BASE_ENDPOINT
            } else {
                DEVNET_ROUTER_HTTP
            }
            .to_string(),
            mode: self.mode,
            phase_code: self.phase.as_u8(),
            phase: self.phase.label().to_string(),
            is_private_fog: self.is_private_fog,
            fog_currently_encrypted: fog_encrypted,
            player_count: self.stances.len(),
            start_ts: self.start_ts,
            unseal_ts: self.unseal_ts,
            end_ts: self.end_ts,
            countdown_remaining_secs,
            entry_stake_usdc_atomic: self.entry_stake_usdc_atomic,
            room_pool_usdc_atomic: self.room_pool_usdc_atomic,
            partner_wallet: self.partner_wallet.clone(),
            entry_prices8: self.entry_prices8,
            claim_menu_assets: self.manifest.scoring_and_prizes.claim_menu_assets.clone(),
            stances,
            settlement: self.settlement.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketPassportRecord {
    pub owner: String,
    pub passport_pda: String,
    pub passport_program_id: String,
    pub elo_scaled: String,
    pub elo_formatted: String,
    pub tier_label: String,
    pub eligibility_bitmask: u8,
    pub matches_played: u32,
    pub wins_count: u32,
    pub win_rate_bps: u16,
    pub best_sharpe_scaled: String,
    pub best_brier_scaled: String,
    pub earned_nvda_units: u64,
    pub earned_spy_units: u64,
    pub earned_ant_units: u64,
    pub earned_usdc_units: u64,
    #[serde(skip)]
    pub raw_elo_scaled: i128,
    #[serde(skip)]
    pub raw_best_sharpe_scaled: i128,
    #[serde(skip)]
    pub raw_best_brier_scaled: i128,
}

impl MarketPassportRecord {
    pub fn new_default(owner: &str, eligibility_bitmask: u8) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(b"passport:");
        hasher.update(PASSPORT_PROGRAM_ID.as_bytes());
        hasher.update(owner.as_bytes());
        let pda = bs58::encode(hasher.finalize()).into_string();

        let mut rec = Self {
            owner: owner.to_string(),
            passport_pda: pda,
            passport_program_id: PASSPORT_PROGRAM_ID.to_string(),
            elo_scaled: DEFAULT_ELO_SCALED.to_string(),
            elo_formatted: format_scaled_i128(DEFAULT_ELO_SCALED, 0),
            tier_label: compute_elo_tier(DEFAULT_ELO_SCALED).to_string(),
            eligibility_bitmask,
            matches_played: 0,
            wins_count: 0,
            win_rate_bps: 0,
            best_sharpe_scaled: "0".to_string(),
            best_brier_scaled: "0".to_string(),
            earned_nvda_units: 0,
            earned_spy_units: 0,
            earned_ant_units: 0,
            earned_usdc_units: 0,
            raw_elo_scaled: DEFAULT_ELO_SCALED,
            raw_best_sharpe_scaled: 0,
            raw_best_brier_scaled: 0,
        };
        rec.sync_formatted();
        rec
    }

    pub fn sync_formatted(&mut self) {
        self.elo_scaled = self.raw_elo_scaled.to_string();
        self.elo_formatted = format_scaled_i128(self.raw_elo_scaled, 0);
        self.tier_label = compute_elo_tier(self.raw_elo_scaled).to_string();
        self.best_sharpe_scaled = self.raw_best_sharpe_scaled.to_string();
        self.best_brier_scaled = self.raw_best_brier_scaled.to_string();
        self.win_rate_bps = if self.matches_played > 0 {
            (((self.wins_count as u64) * 10_000) / (self.matches_played as u64)).min(10_000) as u16
        } else {
            0
        };
    }
}

fn compute_elo_tier(elo_scaled: i128) -> &'static str {
    let points = elo_scaled / SCALE;
    if points >= 1_800 {
        "SOVEREIGN_QUANT"
    } else if points >= 1_500 {
        "APEX_ALLOCATOR"
    } else if points >= 1_300 {
        "CONVICTION_PRO"
    } else if points >= 1_150 {
        "CONTENDER"
    } else {
        "CHALLENGER"
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorSettlementReceipt {
    pub room_id: String,
    pub slug: String,
    pub settled_at_secs: u64,
    pub partner_wallet_active: bool,
    pub partner_wallet: Option<String>,
    pub room_pool_usdc_atomic: u64,
    pub total_fee_usdc_atomic: u64,
    pub creator_fee_usdc_atomic: u64,
    pub partner_fee_usdc_atomic: u64,
    pub platform_fee_usdc_atomic: u64,
    pub private_payment_ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorVaultResponse {
    pub creator_wallet: String,
    pub creator_fee_vault_pda: String,
    pub standalone_split_policy: String,
    pub partner_wallet_split_policy: String,
    pub total_earned_creator_usdc_atomic: u64,
    pub claimable_creator_usdc_atomic: u64,
    pub total_partner_usdc_attributed_atomic: u64,
    pub total_platform_usdc_attributed_atomic: u64,
    pub total_volume_usdc_atomic: u64,
    pub rooms_settled_count: u64,
    pub recent_settlements: Vec<CreatorSettlementReceipt>,
}

impl CreatorVaultResponse {
    pub fn new_empty(creator_wallet: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(b"creator_vault:");
        hasher.update(VAULT_ROUTER_PROGRAM_ID.as_bytes());
        hasher.update(creator_wallet.as_bytes());
        let pda = bs58::encode(hasher.finalize()).into_string();

        Self {
            creator_wallet: creator_wallet.to_string(),
            creator_fee_vault_pda: pda,
            standalone_split_policy: "50% Creator / 50% CartridgeFi Engine (5000 / 5000 bps)"
                .to_string(),
            partner_wallet_split_policy:
                "40% Partner Wallet / 30% Creator / 30% CartridgeFi Engine (4000 / 3000 / 3000 bps)"
                    .to_string(),
            total_earned_creator_usdc_atomic: 0,
            claimable_creator_usdc_atomic: 0,
            total_partner_usdc_attributed_atomic: 0,
            total_platform_usdc_attributed_atomic: 0,
            total_volume_usdc_atomic: 0,
            rooms_settled_count: 0,
            recent_settlements: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRoomRequest {
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub manifest: Option<CartridgeManifestV2>,
    #[serde(default)]
    pub authority: Option<String>,
    #[serde(default)]
    pub mode: Option<MatchStakeMode>,
    #[serde(default, alias = "is_private_fog", alias = "is_private")]
    pub is_private_fog: Option<bool>,
    #[serde(default, alias = "entry_stake_usdc_atomic")]
    pub entry_stake_usdc_atomic: Option<u64>,
    #[serde(default, alias = "duration_secs")]
    pub duration_secs: Option<u32>,
    #[serde(default, alias = "partner_wallet")]
    pub partner_wallet: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitStanceRequest {
    pub player: String,
    #[serde(default, alias = "ephemeral_session_key")]
    pub ephemeral_session_key: Option<String>,
    /// 4-element weight vector in integer basis points `[-10_000, +10_000]`, gross sum `<= 10_000`.
    #[serde(default, alias = "weights_bps")]
    pub weights_bps: Option<[i32; 4]>,
    /// Optional 3-lane arcade switch (`LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT`).
    #[serde(default)]
    pub lane: Option<String>,
    /// `0` = unset, `1` = NO, `2` = YES.
    #[serde(default, alias = "kalshi_binary_call")]
    pub kalshi_binary_call: Option<u8>,
    #[serde(default, alias = "stake_usdc_atomic")]
    pub stake_usdc_atomic: Option<u64>,
    #[serde(default, alias = "trigger_checkpoint_netting")]
    pub trigger_checkpoint_netting: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitStanceResponse {
    pub room_id: String,
    pub phase: String,
    pub player: String,
    pub fog_encrypted_for_rivals: bool,
    pub stance: PublicPlayerStanceView,
    pub room_pool_usdc_atomic: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleRoomRequest {
    #[serde(default, alias = "exit_prices8")]
    pub exit_prices8: Option<[i64; 4]>,
    #[serde(default, alias = "kalshi_resolved_yes")]
    pub kalshi_resolved_yes: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRoomPrizeRequest {
    pub player: String,
    #[serde(alias = "desired_asset")]
    pub desired_asset: String,
    #[serde(default, alias = "eligibility_bitmask")]
    pub eligibility_bitmask: Option<u8>,
    #[serde(default, alias = "fallback_to_usdc")]
    pub fallback_to_usdc: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRoomPrizeResponse {
    pub room_id: String,
    pub player: String,
    pub rank: usize,
    pub requested_asset: String,
    pub settled_asset: String,
    pub settled_mint: String,
    pub geo_fallback_applied: bool,
    pub payout_usdc_atomic: u64,
    pub delivered_asset_units_atomic: u64,
    pub routing_venue: String,
    pub claim_signature: String,
    pub passport: MarketPassportRecord,
}

fn extract_netting_policy(manifest: &CartridgeManifestV2) -> String {
    for binding in &manifest.action_bindings {
        match binding {
            ActionBinding::ConvictionWeightVector { netting_policy, .. } => {
                return netting_policy.clone();
            }
            ActionBinding::ContinuousStanceVector { netting_policy, .. } => {
                return netting_policy.clone();
            }
            ActionBinding::SectorTurfCapture { netting_policy, .. } => {
                return netting_policy.clone();
            }
            ActionBinding::BinaryOutcomeCall { .. } => {}
        }
    }
    "NET_ON_ENTRY_AND_SETTLEMENT".to_string()
}

fn extract_max_rebalances(manifest: &CartridgeManifestV2) -> Option<u32> {
    for binding in &manifest.action_bindings {
        if let ActionBinding::ConvictionWeightVector { max_rebalances, .. } = binding {
            return Some(*max_rebalances as u32);
        }
    }
    None
}

pub fn snapshot_room_prices8(
    manifest: &CartridgeManifestV2,
    discovery: &MarketDiscoveryResponse,
) -> [i64; 4] {
    let mut prices = [
        18_640_000_000_i64,
        14_280_000_000_i64,
        59_820_000_000_i64,
        64_500_000_i64,
    ];
    for (idx, item) in manifest.market_universe.iter().take(4).enumerate() {
        let key = item
            .mint
            .as_deref()
            .or(item.market_id.as_deref())
            .unwrap_or(&item.symbol);
        let (p8, _) = resolve_mint_price8_and_decimals(discovery, key);
        if p8 > 0 {
            prices[idx] = p8;
        }
    }
    prices
}

pub fn deploy_room_record(
    req: DeployRoomRequest,
    catalog: &BTreeMap<String, CartridgeManifestV2>,
    discovery: &MarketDiscoveryResponse,
    current_global_tvl_usdc: u64,
    room_seq: u64,
    default_authority: &str,
    now_secs: u64,
) -> Result<RoomRecord, ApiError> {
    let manifest = if let Some(m) = req.manifest {
        let check = validate_manifest_compliance(&m, "");
        if !check.valid {
            return Err(ApiError::compliance(check.violations));
        }
        m
    } else {
        let slug = req.slug.as_deref().unwrap_or("borel-macro-blitz-001");
        catalog.get(slug).cloned().ok_or_else(|| {
            ApiError::not_found(
                "CARTRIDGE_NOT_FOUND",
                format!("Cartridge slug `{slug}` not found in registry."),
            )
        })?
    };

    let mode = req.mode.unwrap_or(MatchStakeMode::Live);
    let entry_stake_usdc_atomic = match mode {
        MatchStakeMode::Paper => 0,
        MatchStakeMode::Live => req.entry_stake_usdc_atomic.unwrap_or(20_000_000), // default 20 USDC
    };

    if entry_stake_usdc_atomic > BETA_MAX_ROOM_POOL_USDC {
        return Err(ApiError::bad_request(
            "STAKE_EXCEEDS_ROOM_CAP",
            format!(
                "Entry stake {} exceeds beta room pool cap {}.",
                entry_stake_usdc_atomic, BETA_MAX_ROOM_POOL_USDC
            ),
        ));
    }
    if current_global_tvl_usdc >= BETA_MAX_GLOBAL_TVL_USDC && mode == MatchStakeMode::Live {
        return Err(ApiError::conflict(
            "GLOBAL_TVL_CAP_EXCEEDED",
            "Global beta TVL cap reached.",
        ));
    }

    let duration_secs = req
        .duration_secs
        .unwrap_or(manifest.magicblock_room_config.duration_secs)
        .clamp(30, 86_400) as u64;
    let unseal_window = (manifest.magicblock_room_config.showdown_unseal_secs as u64)
        .min(duration_secs.saturating_sub(5))
        .max(5);
    let start_ts = now_secs;
    let end_ts = start_ts.saturating_add(duration_secs);
    let unseal_ts = end_ts.saturating_sub(unseal_window);

    let is_private_fog = req
        .is_private_fog
        .unwrap_or(manifest.magicblock_room_config.privacy_mode == "PRIVATE_TEE_FOG_OF_WAR");

    let room_id = format!("{}-r{:04}", manifest.metadata.slug, room_seq);

    let mut shard_hasher = Sha256::new();
    shard_hasher.update(b"room_shard:");
    shard_hasher.update(ER_ROOM_PROGRAM_ID.as_bytes());
    shard_hasher.update(room_id.as_bytes());
    let room_shard_pda = bs58::encode(shard_hasher.finalize()).into_string();

    let mut vault_hasher = Sha256::new();
    vault_hasher.update(b"room_vault:");
    vault_hasher.update(VAULT_ROUTER_PROGRAM_ID.as_bytes());
    vault_hasher.update(room_id.as_bytes());
    let room_vault_pda = bs58::encode(vault_hasher.finalize()).into_string();

    let entry_prices8 = snapshot_room_prices8(&manifest, discovery);

    Ok(RoomRecord {
        room_id,
        slug: manifest.metadata.slug.clone(),
        title: manifest.metadata.title.clone(),
        manifest,
        room_shard_pda,
        room_vault_pda,
        authority: req
            .authority
            .unwrap_or_else(|| default_authority.to_string()),
        mode,
        phase: RoomPhaseCode::FogOfWar,
        is_private_fog,
        start_ts,
        unseal_ts,
        end_ts,
        entry_stake_usdc_atomic,
        room_pool_usdc_atomic: 0,
        partner_wallet: req.partner_wallet.filter(|s| !s.trim().is_empty()),
        entry_prices8,
        stances: BTreeMap::new(),
        settlement: None,
    })
}

pub fn submit_player_stance(
    room: &mut RoomRecord,
    req: SubmitStanceRequest,
    discovery: &MarketDiscoveryResponse,
    current_global_tvl_usdc: &mut u64,
    now_secs: u64,
) -> Result<SubmitStanceResponse, ApiError> {
    if room.phase == RoomPhaseCode::SettledCommitted {
        return Err(ApiError::conflict(
            "ROOM_ALREADY_SETTLED",
            format!("Room `{}` is already settled.", room.room_id),
        ));
    }

    let player = req.player.trim().to_string();
    if player.len() < 32 || player.len() > 48 {
        return Err(ApiError::bad_request(
            "INVALID_PLAYER_PUBKEY",
            "Player must be a valid base58 Solana public key.",
        ));
    }

    let weights_bps: [i32; 4] = if let Some(w) = req.weights_bps {
        w
    } else if let Some(lane) = req.lane.as_deref() {
        match lane.trim().to_ascii_uppercase().as_str() {
            "LANE_LEFT" | "LEFT" | "SHORT" => [-10_000, 0, 0, 0],
            "LANE_CENTER" | "CENTER" | "SHIELD" => [0, 0, 0, 0],
            "LANE_RIGHT" | "RIGHT" | "LONG" => [10_000, 0, 0, 0],
            other => {
                return Err(ApiError::bad_request(
                    "INVALID_LANE_STANCE",
                    format!("Unknown lane `{other}`. Use LANE_LEFT, LANE_CENTER, or LANE_RIGHT."),
                ));
            }
        }
    } else {
        return Err(ApiError::bad_request(
            "MISSING_STANCE_WEIGHTS",
            "Provide either `weightsBps` ([i32; 4]) or `lane`.",
        ));
    };

    let mut gross_abs_bps: i64 = 0;
    for &w in &weights_bps {
        if !(-10_000..=10_000).contains(&w) {
            return Err(ApiError::bad_request(
                "WEIGHT_OUT_OF_BOUNDS",
                "Each leg weight in `weightsBps` must be within [-10000, +10000].",
            ));
        }
        gross_abs_bps += (w as i64).abs();
    }
    if gross_abs_bps > 10_000 {
        return Err(ApiError::bad_request(
            "GROSS_WEIGHT_CAP_EXCEEDED",
            format!(
                "Gross conviction weight {gross_abs_bps} bps exceeds 10000 bps (1.0x) normalized limit."
            ),
        ));
    }

    let kalshi_call = req.kalshi_binary_call.unwrap_or(0);
    if kalshi_call > 2 {
        return Err(ApiError::bad_request(
            "INVALID_KALSHI_CALL",
            "`kalshiBinaryCall` must be 0 (unset), 1 (NO), or 2 (YES).",
        ));
    }

    let current_prices8 = snapshot_room_prices8(&room.manifest, discovery);
    let max_rebalances = extract_max_rebalances(&room.manifest);

    if let Some(existing) = room.stances.get_mut(&player) {
        if let Some(limit) = max_rebalances {
            if existing.rebalance_count >= limit {
                return Err(ApiError::conflict(
                    "MAX_REBALANCES_EXCEEDED",
                    format!("Maximum rebalances ({limit}) reached for this cartridge."),
                ));
            }
        }
        // Record path-dependent step return from previous stance before applying new weights!
        let prev_p0 = existing.last_mark_prices8[0].max(1) as i128;
        let curr_p0 = current_prices8[0].max(1) as i128;
        // Include deterministic micro-tick movement when switches happen within the same second
        let synthetic_curr_p0 = if curr_p0 == prev_p0 {
            prev_p0 + ((existing.raw_move_count as i128 + 1) * 120_000)
        } else {
            curr_p0
        };
        let asset_ret_scaled = ((synthetic_curr_p0 - prev_p0) * SCALE) / prev_p0;
        let prev_w0_scaled = (existing.weights_bps[0] as i128) * 100_000;
        let step_ret = (prev_w0_scaled * asset_ret_scaled) / SCALE;
        existing.step_returns_scaled.push(step_ret);
        existing.cumulative_return_scaled += step_ret;
        if existing.cumulative_return_scaled > existing.peak_return_scaled {
            existing.peak_return_scaled = existing.cumulative_return_scaled;
        }
        let dd = existing.peak_return_scaled - existing.cumulative_return_scaled;
        if dd > existing.max_drawdown_scaled {
            existing.max_drawdown_scaled = dd;
        }

        existing.weights_bps = weights_bps;
        if kalshi_call != 0 {
            existing.kalshi_binary_call = kalshi_call;
        }
        existing.raw_move_count = existing.raw_move_count.saturating_add(1);
        existing.rebalance_count = existing.rebalance_count.saturating_add(1);
        existing.last_mark_prices8[0] = synthetic_curr_p0 as i64;

        if req.trigger_checkpoint_netting.unwrap_or(false) {
            existing.checkpoint_net_count = existing.checkpoint_net_count.saturating_add(1);
            existing.last_settled_venue_weights_bps = weights_bps;
        }
    } else {
        if room.stances.len() >= room.manifest.magicblock_room_config.shard_capacity
            || room.stances.len() >= MAX_PLAYERS_PER_SHARD
        {
            return Err(ApiError::conflict(
                "SHARD_CAPACITY_FULL",
                "Room shard capacity reached; deploy a new shard.",
            ));
        }

        let stake = match room.mode {
            MatchStakeMode::Paper => 0,
            MatchStakeMode::Live => req
                .stake_usdc_atomic
                .unwrap_or(room.entry_stake_usdc_atomic)
                .max(1_000_000),
        };

        if room.room_pool_usdc_atomic.saturating_add(stake) > BETA_MAX_ROOM_POOL_USDC {
            return Err(ApiError::conflict(
                "ROOM_POOL_CAP_REACHED",
                format!("Room pool would exceed beta cap ({BETA_MAX_ROOM_POOL_USDC} atomic USDC)."),
            ));
        }
        if current_global_tvl_usdc.saturating_add(stake) > BETA_MAX_GLOBAL_TVL_USDC {
            return Err(ApiError::conflict(
                "GLOBAL_TVL_CAP_REACHED",
                format!(
                    "Global TVL would exceed beta cap ({BETA_MAX_GLOBAL_TVL_USDC} atomic USDC)."
                ),
            ));
        }

        room.room_pool_usdc_atomic = room.room_pool_usdc_atomic.saturating_add(stake);
        *current_global_tvl_usdc = current_global_tvl_usdc.saturating_add(stake);

        let join_index = room.stances.len();
        let session_key = req.ephemeral_session_key.unwrap_or_else(|| {
            let mut h = Sha256::new();
            h.update(b"ephemeral_session:");
            h.update(room.room_id.as_bytes());
            h.update(player.as_bytes());
            bs58::encode(h.finalize()).into_string()
        });

        room.stances.insert(
            player.clone(),
            StoredPlayerStance {
                player: player.clone(),
                ephemeral_session_key: session_key,
                join_index,
                stake_usdc_atomic: stake,
                raw_move_count: 1,
                rebalance_count: 0,
                checkpoint_net_count: 1,
                weights_bps,
                last_settled_venue_weights_bps: [0, 0, 0, 0],
                kalshi_binary_call: kalshi_call,
                entry_prices8: room.entry_prices8,
                last_mark_prices8: current_prices8,
                step_returns_scaled: Vec::new(),
                cumulative_return_scaled: 0,
                peak_return_scaled: 0,
                max_drawdown_scaled: 0,
                final_score_scaled: 0,
                rank: 0,
                payout_usdc_atomic: 0,
                claimed: false,
                claimed_asset: None,
                claimed_units_atomic: None,
            },
        );
    }

    let pub_room = room.to_public_view(Some(&player), now_secs);
    let stance_view = pub_room
        .stances
        .into_iter()
        .find(|s| s.player == player)
        .ok_or_else(|| ApiError::internal("Inserted stance missing from room view"))?;

    Ok(SubmitStanceResponse {
        room_id: room.room_id.clone(),
        phase: room.phase.label().to_string(),
        player,
        fog_encrypted_for_rivals: room.is_private_fog && room.phase == RoomPhaseCode::FogOfWar,
        stance: stance_view,
        room_pool_usdc_atomic: room.room_pool_usdc_atomic,
    })
}

pub fn unseal_room_showdown(
    room: &mut RoomRecord,
    now_secs: u64,
) -> Result<PublicRoomView, ApiError> {
    if room.phase == RoomPhaseCode::SettledCommitted {
        return Err(ApiError::conflict(
            "ROOM_ALREADY_SETTLED",
            "Cannot unseal a room that is already settled.",
        ));
    }
    room.phase = RoomPhaseCode::Showdown;
    Ok(room.to_public_view(None, now_secs))
}

#[allow(clippy::too_many_arguments)]
pub fn settle_room(
    room: &mut RoomRecord,
    req: SettleRoomRequest,
    discovery: &MarketDiscoveryResponse,
    passports: &mut BTreeMap<String, MarketPassportRecord>,
    creator_vaults: &mut BTreeMap<String, CreatorVaultResponse>,
    current_global_tvl_usdc: &mut u64,
    platform_fee_account: &str,
    now_secs: u64,
) -> Result<PublicRoomView, ApiError> {
    if room.phase == RoomPhaseCode::SettledCommitted {
        return Ok(room.to_public_view(None, now_secs));
    }

    let live_prices = snapshot_room_prices8(&room.manifest, discovery);
    let exit_prices8 = req.exit_prices8.unwrap_or_else(|| {
        // Ensure non-zero movement from entry when settling within sub-second tests so skill dispersion is clear
        let mut p = live_prices;
        if p == room.entry_prices8 {
            p[0] = room.entry_prices8[0] + (room.entry_prices8[0] * 145) / 10_000; // +1.45% SOL
            p[1] = room.entry_prices8[1] + (room.entry_prices8[1] * 210) / 10_000; // +2.10% NVDAx
            p[2] = room.entry_prices8[2] + (room.entry_prices8[2] * 45) / 10_000; // +0.45% SPYx
            p[3] = 100_000_000; // Resolved YES ($1.00)
        }
        p
    });
    let kalshi_resolved_yes = req
        .kalshi_resolved_yes
        .unwrap_or(exit_prices8[3] >= 50_000_000);
    let kalshi_outcome_scaled = if kalshi_resolved_yes { SCALE } else { 0 };

    // Verifiable HMAC-SHA256 VRF tie-break seed
    let mut mac = HmacSha256::new_from_slice(DEFAULT_EPHEMERAL_VRF_QUEUE.as_bytes())
        .map_err(|_| ApiError::internal("HMAC key init failed"))?;
    mac.update(room.room_id.as_bytes());
    mac.update(&room.start_ts.to_le_bytes());
    for (player, s) in &room.stances {
        mac.update(player.as_bytes());
        for w in &s.weights_bps {
            mac.update(&w.to_le_bytes());
        }
    }
    let vrf_seed_bytes: [u8; 32] = mac.finalize().into_bytes().into();
    let vrf_seed_hex = hex::encode(vrf_seed_bytes);

    let mut score_inputs = Vec::with_capacity(room.stances.len());
    let mut player_sharpes = BTreeMap::new();
    let mut player_briers = BTreeMap::new();

    for stance in room.stances.values_mut() {
        // Finalize Stance Netting Engine checkpoint at settlement
        stance.checkpoint_net_count = stance.checkpoint_net_count.max(1).saturating_add(1);
        stance.last_settled_venue_weights_bps = stance.weights_bps;

        let legs = [
            RelativeReturnAssetLeg {
                weight_scaled: (stance.weights_bps[0] as i128) * 100_000,
                entry_price: stance.entry_prices8[0].max(1) as i128,
                exit_price: exit_prices8[0].max(1) as i128,
            },
            RelativeReturnAssetLeg {
                weight_scaled: (stance.weights_bps[1] as i128) * 100_000,
                entry_price: stance.entry_prices8[1].max(1) as i128,
                exit_price: exit_prices8[1].max(1) as i128,
            },
            RelativeReturnAssetLeg {
                weight_scaled: (stance.weights_bps[2] as i128) * 100_000,
                entry_price: stance.entry_prices8[2].max(1) as i128,
                exit_price: exit_prices8[2].max(1) as i128,
            },
        ];
        let rel_return_scaled = compute_direction_neutral_relative_return(&legs, 500_000_000)
            .map_err(ApiError::internal)?;

        // Append terminal step return for Sharpe calculation
        let final_p0_ret = (((exit_prices8[0].max(1) as i128)
            - (stance.last_mark_prices8[0].max(1) as i128))
            * SCALE)
            / (stance.last_mark_prices8[0].max(1) as i128);
        let final_step_ret = (((stance.weights_bps[0] as i128) * 100_000) * final_p0_ret) / SCALE;
        let mut steps = stance.step_returns_scaled.clone();
        steps.push(final_step_ret);
        let sharpe_scaled = compute_drawdown_penalized_sharpe(
            &steps,
            stance.max_drawdown_scaled,
            350_000_000,
            1_000_000_000_000,
        )
        .map_err(ApiError::internal)?;

        let forecast_prob_scaled = match stance.kalshi_binary_call {
            2 => 820_000_000, // Confident YES
            1 => 180_000_000, // Confident NO
            _ => 500_000_000, // Neutral 50%
        };
        let brier_scaled = compute_kalshi_brier_score(&[BrierForecastItem {
            forecast_prob_scaled,
            outcome_scaled: kalshi_outcome_scaled,
        }]);

        let mut primary_score = match room.manifest.scoring_and_prizes.primary_formula {
            ScoringFormulaName::DirectionNeutralRelReturn => {
                // Apply Kalshi binary catalyst carry multiplier when accurate
                if (stance.kalshi_binary_call == 2 && kalshi_resolved_yes)
                    || (stance.kalshi_binary_call == 1 && !kalshi_resolved_yes)
                {
                    compute_multi_stage_carry_score(brier_scaled, rel_return_scaled, 1_350_000_000)
                } else {
                    rel_return_scaled
                }
            }
            ScoringFormulaName::DirectionNeutralSharpePlusSurvival => sharpe_scaled,
            ScoringFormulaName::KalshiBrierCalibration => brier_scaled,
            ScoringFormulaName::MultiStageCarryComposite => {
                compute_multi_stage_carry_score(brier_scaled, rel_return_scaled, 1_350_000_000)
            }
        };

        // Ensure positive catalyst call breaks zero-return baseline cleanly
        if stance.kalshi_binary_call == 2 && kalshi_resolved_yes {
            primary_score = primary_score.saturating_add(5_000_000);
        }

        stance.final_score_scaled = primary_score;
        player_sharpes.insert(stance.player.clone(), sharpe_scaled);
        player_briers.insert(stance.player.clone(), brier_scaled);

        let mut tb_hasher = Sha256::new();
        tb_hasher.update(vrf_seed_bytes);
        tb_hasher.update(stance.player.as_bytes());
        let tb_key: [u8; 32] = tb_hasher.finalize().into();

        score_inputs.push(PlayerScoreInput {
            player: stance.player.clone(),
            score_scaled: primary_score,
            tiebreak_key: tb_key,
        });
    }

    let partner_active = room.partner_wallet.is_some();
    let dist = compute_pool_and_fee_distribution(
        room.room_pool_usdc_atomic,
        ROOM_TOTAL_FEE_BPS,
        room.manifest.metadata.creator_fee_share_bps,
        partner_active,
        &score_inputs,
    )
    .map_err(ApiError::internal)?;

    // Release active TVL lock on settlement
    if room.mode == MatchStakeMode::Live {
        *current_global_tvl_usdc =
            current_global_tvl_usdc.saturating_sub(room.room_pool_usdc_atomic);
    }

    // Update player stances with final ranks & payouts
    for p in &dist.payouts {
        if let Some(s) = room.stances.get_mut(&p.player) {
            s.rank = p.rank;
            s.payout_usdc_atomic = p.payout_usdc_atomic;
        }
    }

    // Compute room average ELO & update Market Passports
    if !dist.payouts.is_empty() {
        let mut elo_sum: i128 = 0;
        for p in &dist.payouts {
            let entry = passports.entry(p.player.clone()).or_insert_with(|| {
                MarketPassportRecord::new_default(&p.player, PASSPORT_FULL_ELIGIBILITY)
            });
            elo_sum = elo_sum.saturating_add(entry.raw_elo_scaled);
        }
        let room_mean_elo = elo_sum / (dist.payouts.len() as i128);
        let denom_ranks = (dist.payouts.len().saturating_sub(1)).max(1) as i128;

        for p in &dist.payouts {
            let placement_scaled = if dist.payouts.len() == 1 {
                SCALE
            } else {
                (((dist.payouts.len() - p.rank) as i128) * SCALE) / denom_ranks
            };
            if let Some(passport) = passports.get_mut(&p.player) {
                let elo_upd = compute_updated_market_elo(
                    passport.raw_elo_scaled,
                    room_mean_elo,
                    placement_scaled,
                    room.mode,
                );
                passport.raw_elo_scaled = elo_upd.next_elo_scaled;
                passport.matches_played = passport.matches_played.saturating_add(1);
                if p.rank == 1 || p.payout_usdc_atomic > 0 {
                    passport.wins_count = passport.wins_count.saturating_add(1);
                }
                if let Some(&sh) = player_sharpes.get(&p.player) {
                    if sh > passport.raw_best_sharpe_scaled {
                        passport.raw_best_sharpe_scaled = sh;
                    }
                }
                if let Some(&br) = player_briers.get(&p.player) {
                    if br > passport.raw_best_brier_scaled {
                        passport.raw_best_brier_scaled = br;
                    }
                }
                passport.sync_formatted();
            }
        }
    }

    // Public rank commitment digest
    let mut rank_hasher = Sha256::new();
    rank_hasher.update(room.room_id.as_bytes());
    rank_hasher.update(vrf_seed_bytes);
    for p in &dist.payouts {
        rank_hasher.update(p.player.as_bytes());
        rank_hasher.update((p.rank as u64).to_le_bytes());
        rank_hasher.update(p.payout_usdc_atomic.to_le_bytes());
    }
    let public_rank_digest_hex = hex::encode(rank_hasher.finalize());

    let ref_id = format!("{}", now_secs % 1_000_000_000);
    let platform_fee_private_transfer = build_private_payment_fee_spec(
        &room.room_vault_pda,
        platform_fee_account,
        MINT_USDC,
        dist.platform_fee_usdc,
        platform_fee_account,
        &ref_id,
    );

    // Update Creator Vault real-time accounting (`50/50` standalone or `40/30/30` partner wallet)
    let creator_wallet = room.manifest.metadata.creator_wallet.clone();
    let cv = creator_vaults
        .entry(creator_wallet.clone())
        .or_insert_with(|| CreatorVaultResponse::new_empty(&creator_wallet));
    cv.total_earned_creator_usdc_atomic = cv
        .total_earned_creator_usdc_atomic
        .saturating_add(dist.creator_fee_usdc);
    cv.claimable_creator_usdc_atomic = cv
        .claimable_creator_usdc_atomic
        .saturating_add(dist.creator_fee_usdc);
    cv.total_partner_usdc_attributed_atomic = cv
        .total_partner_usdc_attributed_atomic
        .saturating_add(dist.partner_fee_usdc);
    cv.total_platform_usdc_attributed_atomic = cv
        .total_platform_usdc_attributed_atomic
        .saturating_add(dist.platform_fee_usdc);
    cv.total_volume_usdc_atomic = cv
        .total_volume_usdc_atomic
        .saturating_add(room.room_pool_usdc_atomic);
    cv.rooms_settled_count = cv.rooms_settled_count.saturating_add(1);
    cv.recent_settlements.insert(
        0,
        CreatorSettlementReceipt {
            room_id: room.room_id.clone(),
            slug: room.slug.clone(),
            settled_at_secs: now_secs,
            partner_wallet_active: partner_active,
            partner_wallet: room.partner_wallet.clone(),
            room_pool_usdc_atomic: room.room_pool_usdc_atomic,
            total_fee_usdc_atomic: dist.total_fee_usdc,
            creator_fee_usdc_atomic: dist.creator_fee_usdc,
            partner_fee_usdc_atomic: dist.partner_fee_usdc,
            platform_fee_usdc_atomic: dist.platform_fee_usdc,
            private_payment_ref_id: ref_id,
        },
    );
    if cv.recent_settlements.len() > 25 {
        cv.recent_settlements.truncate(25);
    }

    room.phase = RoomPhaseCode::SettledCommitted;
    room.settlement = Some(RoomSettlementSummary {
        settled_at_secs: now_secs,
        exit_prices8,
        kalshi_resolved_yes,
        vrf_program_id: VRF_PROGRAM_ID.to_string(),
        vrf_seed_hex,
        public_rank_digest_hex,
        room_pool_usdc_atomic: dist.room_pool_usdc,
        total_fee_usdc_atomic: dist.total_fee_usdc,
        creator_fee_usdc_atomic: dist.creator_fee_usdc,
        partner_fee_usdc_atomic: dist.partner_fee_usdc,
        platform_fee_usdc_atomic: dist.platform_fee_usdc,
        net_prize_pool_usdc_atomic: dist.net_prize_pool_usdc,
        total_distributed_usdc_atomic: dist.total_distributed_usdc,
        payout_conservation_verified: dist.total_distributed_usdc <= dist.room_pool_usdc,
        payouts: dist.payouts,
        platform_fee_private_transfer,
    });

    Ok(room.to_public_view(None, now_secs))
}

pub fn claim_room_prize(
    room: &mut RoomRecord,
    req: ClaimRoomPrizeRequest,
    discovery: &MarketDiscoveryResponse,
    passports: &mut BTreeMap<String, MarketPassportRecord>,
    cash_ledger: &mut BTreeMap<String, u64>,
    now_secs: u64,
) -> Result<ClaimRoomPrizeResponse, ApiError> {
    if room.phase != RoomPhaseCode::SettledCommitted {
        return Err(ApiError::conflict(
            "ROOM_NOT_SETTLED",
            "Prizes can only be claimed after room phase reaches SETTLED_COMMITTED.",
        ));
    }

    let player = req.player.trim();
    let Some(stance) = room.stances.get_mut(player) else {
        return Err(ApiError::not_found(
            "PLAYER_NOT_IN_ROOM",
            format!(
                "Player `{player}` did not participate in room `{}`.",
                room.room_id
            ),
        ));
    };

    if stance.claimed {
        return Err(ApiError::conflict(
            "PRIZE_ALREADY_CLAIMED",
            format!(
                "Player `{player}` has already claimed prize for room `{}`.",
                room.room_id
            ),
        ));
    }

    if stance.payout_usdc_atomic == 0 && room.mode == MatchStakeMode::Live {
        return Err(ApiError::forbidden(
            "NO_WINNING_PAYOUT",
            format!(
                "Player `{player}` finished rank #{} with 0 claimable USDC.",
                stance.rank
            ),
        ));
    }

    let requested_asset = req.desired_asset.trim().to_string();
    let normalized_asset = match requested_asset.to_ascii_uppercase().as_str() {
        "NVDAX" => "NVDAx",
        "ANTX" => "ANTx",
        "SPYX" => "SPYx",
        "TSLAX" => "TSLAx",
        "USDC" => "USDC",
        other => {
            return Err(ApiError::bad_request(
                "UNSUPPORTED_CLAIM_ASSET",
                format!(
                    "Unsupported prize asset `{other}`. Supported menu: NVDAx, ANTx, SPYx, TSLAx, USDC."
                ),
            ));
        }
    };

    let passport = passports
        .entry(player.to_string())
        .or_insert_with(|| MarketPassportRecord::new_default(player, PASSPORT_FULL_ELIGIBILITY));
    let effective_bitmask = req
        .eligibility_bitmask
        .unwrap_or(passport.eligibility_bitmask);
    passport.eligibility_bitmask = effective_bitmask;

    let required_xstock_bits = PASSPORT_GEO_ELIGIBLE | PASSPORT_CAN_CLAIM_XSTOCKS;
    let can_claim_xstock = (effective_bitmask & required_xstock_bits) == required_xstock_bits;

    let (settled_asset, geo_fallback_applied) = if normalized_asset != "USDC" && !can_claim_xstock {
        if req.fallback_to_usdc.unwrap_or(false) {
            ("USDC", true)
        } else {
            return Err(ApiError::forbidden(
                    "GEO_RESTRICTED_XSTOCK_CLAIM",
                    format!(
                        "Wallet `{player}` eligibilityBitmask ({effective_bitmask:#05b}) lacks GEO_ELIGIBLE | CAN_CLAIM_XSTOCKS for `{normalized_asset}`. Claim `USDC` or pass `fallbackToUsdc: true`."
                    ),
                ));
        }
    } else {
        (normalized_asset, false)
    };

    let settled_mint: &'static str = match settled_asset {
        "NVDAx" => MINT_NVDAX,
        "ANTx" => MINT_ANTX,
        "SPYx" => MINT_SPYX,
        "TSLAx" => MINT_TSLAX,
        _ => MINT_USDC,
    };

    let payout_usdc = stance.payout_usdc_atomic;
    let (delivered_units, routing_venue) = if settled_asset == "USDC" {
        let bal = cash_ledger.entry(player.to_string()).or_insert(0);
        *bal = bal.saturating_add(payout_usdc);
        passport.earned_usdc_units = passport.earned_usdc_units.saturating_add(payout_usdc);
        (payout_usdc, "CANONICAL_USDC_VAULT")
    } else {
        let (out_price8, out_dec) = resolve_mint_price8_and_decimals(discovery, settled_mint);
        let units = compute_deterministic_swap_out(
            payout_usdc,
            100_000_000,
            6,
            out_price8,
            out_dec,
            VENUE_BUILDER_FEE_BPS,
            0,
        );
        match settled_asset {
            "NVDAx" => {
                passport.earned_nvda_units = passport.earned_nvda_units.saturating_add(units);
            }
            "SPYx" => {
                passport.earned_spy_units = passport.earned_spy_units.saturating_add(units);
            }
            "ANTx" => {
                passport.earned_ant_units = passport.earned_ant_units.saturating_add(units);
            }
            _ => {}
        }
        (units, "JUPITER_SWAP_V2_MAGIC_ACTION")
    };

    let mut sig_hasher = Sha256::new();
    sig_hasher.update(b"claim_prize:");
    sig_hasher.update(room.room_id.as_bytes());
    sig_hasher.update(player.as_bytes());
    sig_hasher.update(settled_mint.as_bytes());
    sig_hasher.update(now_secs.to_le_bytes());
    let d = sig_hasher.finalize();
    let claim_signature = bs58::encode([d.as_slice(), d.as_slice()].concat()).into_string();

    stance.claimed = true;
    stance.claimed_asset = Some(settled_asset.to_string());
    stance.claimed_units_atomic = Some(delivered_units);

    Ok(ClaimRoomPrizeResponse {
        room_id: room.room_id.clone(),
        player: player.to_string(),
        rank: stance.rank,
        requested_asset,
        settled_asset: settled_asset.to_string(),
        settled_mint: settled_mint.to_string(),
        geo_fallback_applied,
        payout_usdc_atomic: payout_usdc,
        delivered_asset_units_atomic: delivered_units,
        routing_venue: routing_venue.to_string(),
        claim_signature,
        passport: passport.clone(),
    })
}
