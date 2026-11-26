//! Server-side CartridgeManifest v2.0 prompt compiler, FCA/SEC anti-casino compliance engine,
//! and deterministic 500-tick `i128` fixed-point economy simulator (`calm` vs `crash_vix35`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::constants::{
    CARTRIDGE_PROGRAM_IDS, DEPLOYER_AND_KEEPER, KALSHI_FED_DEC26_CUT_ID, KALSHI_NVDA_BEAT_Q4_ID,
    KALSHI_SOL_ATH_2026_ID, MAX_CREATOR_SHARE_BPS, MAX_LIVE_LEVERAGE, MAX_PLAYERS_PER_SHARD,
    MINT_ANTX, MINT_NVDAX, MINT_SPYX, MINT_TSLAX, PACER_BOT_1_PUBKEY, PACER_BOT_2_PUBKEY,
    PYTH_FEED_BTC_USD, PYTH_FEED_NVDAX_USD, PYTH_FEED_SOL_USD, PYTH_FEED_SPYX_USD,
    ROOM_TOTAL_FEE_BPS, SCALE, SUPPORTED_DEPOSIT_CHAINS, USDC_UNIT,
};
use crate::error::ApiError;
use crate::math::{
    compute_direction_neutral_relative_return, compute_drawdown_penalized_sharpe,
    compute_kalshi_brier_score, compute_multi_stage_carry_score, compute_pool_and_fee_distribution,
    format_scaled_i128, BrierForecastItem, PlayerScoreInput, RelativeReturnAssetLeg,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CartridgeGenre {
    #[serde(rename = "BOREL_GAMEDAY")]
    BorelGameday,
    #[serde(rename = "ARCADE_RUNNER")]
    ArcadeRunner,
    #[serde(rename = "SYNDICATE_TURF")]
    SyndicateTurf,
    #[serde(rename = "PREDICTION_BRACKET")]
    PredictionBracket,
}

impl CartridgeGenre {
    pub fn as_slug_suffix(self) -> &'static str {
        match self {
            Self::BorelGameday => "borel_",
            Self::ArcadeRunner => "arcade",
            Self::SyndicateTurf => "syndic",
            Self::PredictionBracket => "predic",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::BorelGameday => "BOREL_GAMEDAY",
            Self::ArcadeRunner => "ARCADE_RUNNER",
            Self::SyndicateTurf => "SYNDICATE_TURF",
            Self::PredictionBracket => "PREDICTION_BRACKET",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScoringFormulaName {
    #[serde(rename = "DIRECTION_NEUTRAL_REL_RETURN")]
    DirectionNeutralRelReturn,
    #[serde(rename = "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL")]
    DirectionNeutralSharpePlusSurvival,
    #[serde(rename = "KALSHI_BRIER_CALIBRATION")]
    KalshiBrierCalibration,
    #[serde(rename = "MULTI_STAGE_CARRY_COMPOSITE")]
    MultiStageCarryComposite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMetadata {
    pub slug: String,
    pub title: String,
    pub subtitle: String,
    pub genre: CartridgeGenre,
    pub engine_target: String,
    pub creator_handle: String,
    pub creator_wallet: String,
    pub creator_fee_share_bps: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionEnvelopeConfig {
    pub min_usdc: u64,
    pub max_usdc: u64,
    pub max_leverage: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingAndSessionConfig {
    pub allow_paper_mode: bool,
    pub allow_live_mode: bool,
    pub supported_deposit_chains: Vec<String>,
    pub apple_pay_enabled: bool,
    pub live_session_envelope_usdc: LiveSessionEnvelopeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicblockRoomConfig {
    pub tick_interval_ms: u32,
    pub duration_secs: u32,
    pub shard_capacity: usize,
    pub privacy_mode: String,
    pub fog_of_war_bps: u16,
    pub showdown_unseal_secs: u32,
    pub vrf_usage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketUniverseEntry {
    pub alias: String,
    pub venue: String,
    pub symbol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pyth_feed_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub market_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StanceWeightLeg {
    pub asset: String,
    pub weight_bps: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "bindingType", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionBinding {
    #[serde(rename_all = "camelCase")]
    ConvictionWeightVector {
        game_event: String,
        max_rebalances: u8,
        allowed_assets: Vec<String>,
        netting_policy: String,
    },
    #[serde(rename_all = "camelCase")]
    ContinuousStanceVector {
        game_event: String,
        mapping: BTreeMap<String, StanceWeightLeg>,
        netting_policy: String,
    },
    #[serde(rename_all = "camelCase")]
    BinaryOutcomeCall {
        game_event: String,
        asset: String,
        score_carry_multiplier_bps: u16,
    },
    #[serde(rename_all = "camelCase")]
    SectorTurfCapture {
        game_event: String,
        district_assets: Vec<String>,
        heist_duration_secs: u32,
        netting_policy: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoringAndPrizesConfig {
    pub primary_formula: ScoringFormulaName,
    pub prize_curve: String,
    pub claim_menu_assets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CartridgeManifestV2 {
    #[serde(rename = "$schema", default = "default_manifest_schema")]
    pub schema: String,
    pub manifest_version: String,
    pub metadata: ManifestMetadata,
    pub onboarding_and_session: OnboardingAndSessionConfig,
    pub magicblock_room_config: MagicblockRoomConfig,
    pub market_universe: Vec<MarketUniverseEntry>,
    pub action_bindings: Vec<ActionBinding>,
    pub scoring_and_prizes: ScoringAndPrizesConfig,
}

fn default_manifest_schema() -> String {
    "https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceCheckResult {
    pub valid: bool,
    pub violations: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VibeCompileRequest {
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub genre: Option<CartridgeGenre>,
    #[serde(default, alias = "creator_wallet")]
    pub creator_wallet: Option<String>,
    #[serde(default, alias = "creator_handle")]
    pub creator_handle: Option<String>,
    #[serde(default)]
    pub manifest: Option<CartridgeManifestV2>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VibeCompileResponse {
    pub valid: bool,
    pub violations: Vec<String>,
    pub slug_hash_hex: String,
    pub target_program_ids: [String; 4],
    pub manifest: CartridgeManifestV2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VolatilityRegime {
    #[serde(rename = "calm")]
    Calm,
    #[serde(rename = "crash_vix35")]
    CrashVix35,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VibeSimulateRequest {
    #[serde(default)]
    pub manifest: Option<CartridgeManifestV2>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default, alias = "volatility_regime")]
    pub volatility_regime: Option<VolatilityRegime>,
    #[serde(default, alias = "tick_count")]
    pub tick_count: Option<usize>,
    #[serde(default, alias = "simulated_players")]
    pub simulated_players: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodiumEntry {
    pub player: String,
    pub rank: usize,
    pub score_scaled: String,
    pub score_formatted: String,
    pub payout_usdc_atomic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CartridgeSimulationReport {
    pub slug: String,
    pub volatility_regime: VolatilityRegime,
    pub tick_count: usize,
    pub simulated_players: usize,
    pub room_pool_usdc_atomic: String,
    pub payout_conservation_verified: bool,
    pub total_distributed_usdc_atomic: String,
    pub creator_fee_per_room_usdc_atomic: String,
    pub projected_monthly_creator_fee_usdc_formatted: String,
    pub p90_score_formatted: String,
    pub median_score_formatted: String,
    pub p10_score_formatted: String,
    pub top_podium: Vec<PodiumEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DualRegimeSimulationResponse {
    pub primary: CartridgeSimulationReport,
    pub calm: CartridgeSimulationReport,
    pub crash_vix35: CartridgeSimulationReport,
}

const BANNED_GAMBLING_PHRASES: [&str; 9] = [
    "loot box",
    "lootbox",
    "paid spin",
    "roulette",
    "slot machine",
    "casino jackpot",
    "double or nothing spin",
    "trade streak nudge",
    "gacha spin",
];

fn normalize_whitespace_lower(input: &str) -> String {
    input
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Validates programmatic FCA / SEC DEP / Anti-Casino compliance on any `CartridgeManifestV2` + prompt.
pub fn validate_manifest_compliance(
    manifest: &CartridgeManifestV2,
    source_prompt: &str,
) -> ComplianceCheckResult {
    let mut violations = Vec::new();

    if manifest.manifest_version != "2.0.0" {
        violations.push("manifestVersion must equal '2.0.0'.".to_string());
    }
    if manifest.metadata.slug.len() < 3 || manifest.metadata.slug.len() > 48 {
        violations.push("metadata.slug length must be in [3, 48].".to_string());
    }
    if manifest.metadata.creator_fee_share_bps > MAX_CREATOR_SHARE_BPS {
        violations.push(format!(
            "creatorFeeShareBps ({}) exceeds {} bps cap.",
            manifest.metadata.creator_fee_share_bps, MAX_CREATOR_SHARE_BPS
        ));
    }
    if manifest
        .onboarding_and_session
        .live_session_envelope_usdc
        .max_leverage
        > MAX_LIVE_LEVERAGE
        || manifest
            .onboarding_and_session
            .live_session_envelope_usdc
            .max_leverage
            == 0
    {
        violations.push(format!(
            "Leverage ceiling exceeded: maxLeverage must be in [1, {}x].",
            MAX_LIVE_LEVERAGE
        ));
    }

    // Also detect explicit >5x leverage demand in raw prompt (e.g. "50x leverage", "100x perp")
    if let Some(bad_lev) = detect_excessive_prompt_leverage(source_prompt) {
        violations.push(format!(
            "Prompt requests {bad_lev}x leverage, exceeding hard {MAX_LIVE_LEVERAGE}x safety ceiling."
        ));
    }

    if manifest
        .onboarding_and_session
        .live_session_envelope_usdc
        .min_usdc
        == 0
        || manifest
            .onboarding_and_session
            .live_session_envelope_usdc
            .min_usdc
            > manifest
                .onboarding_and_session
                .live_session_envelope_usdc
                .max_usdc
        || manifest
            .onboarding_and_session
            .live_session_envelope_usdc
            .max_usdc
            > 500
    {
        violations.push(
            "liveSessionEnvelopeUsdc bounds invalid (require 1 <= minUsdc <= maxUsdc <= 500)."
                .to_string(),
        );
    }

    if manifest.magicblock_room_config.shard_capacity < 2
        || manifest.magicblock_room_config.shard_capacity > MAX_PLAYERS_PER_SHARD
    {
        violations.push(format!(
            "shardCapacity must be in [2, {MAX_PLAYERS_PER_SHARD}]."
        ));
    }

    if manifest.magicblock_room_config.showdown_unseal_secs
        >= manifest.magicblock_room_config.duration_secs
    {
        violations.push(
            "magicblockRoomConfig.showdownUnsealSecs must be strictly less than durationSecs."
                .to_string(),
        );
    }

    if !manifest
        .scoring_and_prizes
        .claim_menu_assets
        .iter()
        .any(|a| a == "USDC")
    {
        violations.push(
            "scoringAndPrizes.claimMenuAssets must always include 'USDC' as universal geo-safe fallback."
                .to_string(),
        );
    }

    let combined = normalize_whitespace_lower(&format!(
        "{} {} {}",
        manifest.metadata.title, manifest.metadata.subtitle, source_prompt
    ));
    for banned in &BANNED_GAMBLING_PHRASES {
        if combined.contains(banned) {
            violations.push(format!(
                "Compliance hard-block: prohibited casino/dark-pattern mechanic matched ('{banned}'). CartridgeFi enforces 100% skill-first financial physics."
            ));
        }
    }

    ComplianceCheckResult {
        valid: violations.is_empty(),
        violations,
    }
}

fn detect_excessive_prompt_leverage(prompt: &str) -> Option<u32> {
    for raw_token in prompt.split(|c: char| !c.is_ascii_alphanumeric()) {
        let lower = raw_token.to_ascii_lowercase();
        if let Some(num_str) = lower.strip_suffix('x') {
            if !num_str.is_empty() && num_str.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(val) = num_str.parse::<u32>() {
                    if val > (MAX_LIVE_LEVERAGE as u32) && val <= 1_000 {
                        return Some(val);
                    }
                }
            }
        }
    }
    None
}

pub fn compute_slug_hash_hex(slug: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(slug.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn compile_prompt_to_manifest(
    prompt: &str,
    genre: CartridgeGenre,
    creator_wallet: &str,
    creator_handle: Option<&str>,
) -> (CartridgeManifestV2, ComplianceCheckResult) {
    let clean_prompt = prompt.trim();
    let lower = clean_prompt.to_ascii_lowercase();

    let mut slug_chars = String::new();
    let mut prev_dash = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            slug_chars.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug_chars.is_empty() {
            slug_chars.push('-');
            prev_dash = true;
        }
        if slug_chars.len() >= 34 {
            break;
        }
    }
    let slug_base = slug_chars.trim_matches('-');
    let slug_prefix = if slug_base.is_empty() {
        "custom-cartridge"
    } else {
        slug_base
    };
    let suffix = genre.as_slug_suffix().trim_matches('_');
    let slug = format!("{slug_prefix}-{suffix}");

    let mentions_tsla = lower.contains("tsla");
    let mentions_btc = lower.contains("btc") || lower.contains("bitcoin");
    let mentions_ant = lower.contains("ant") || lower.contains("anthropic");

    let duration_secs: u32 = if lower.contains("180s") || lower.contains("3m") {
        180
    } else if lower.contains("300s") || lower.contains("5m") {
        300
    } else if genre == CartridgeGenre::ArcadeRunner {
        90
    } else {
        60
    };

    let equity_symbol = if mentions_tsla {
        "TSLAx"
    } else if mentions_ant {
        "ANTx"
    } else {
        "NVDAx"
    };
    let equity_mint = if mentions_tsla {
        MINT_TSLAX
    } else if mentions_ant {
        MINT_ANTX
    } else {
        MINT_NVDAX
    };

    let market_universe = vec![
        MarketUniverseEntry {
            alias: "PRIMARY_PERP".to_string(),
            venue: "PHOENIX_PERP".to_string(),
            symbol: if mentions_btc { "BTC-PERP" } else { "SOL-PERP" }.to_string(),
            mint: None,
            pyth_feed_id: Some(
                if mentions_btc {
                    PYTH_FEED_BTC_USD
                } else {
                    PYTH_FEED_SOL_USD
                }
                .to_string(),
            ),
            market_id: None,
        },
        MarketUniverseEntry {
            alias: "EQUITY_ANCHOR".to_string(),
            venue: "JUPITER_XSTOCKS".to_string(),
            symbol: equity_symbol.to_string(),
            mint: Some(equity_mint.to_string()),
            pyth_feed_id: Some(PYTH_FEED_NVDAX_USD.to_string()),
            market_id: None,
        },
        MarketUniverseEntry {
            alias: "MACRO_CATALYST".to_string(),
            venue: "DFLOW_KALSHI".to_string(),
            symbol: "KALSHI-FED-CUT".to_string(),
            mint: None,
            pyth_feed_id: None,
            market_id: Some(KALSHI_FED_DEC26_CUT_ID.to_string()),
        },
    ];

    let claim_menu_assets = if mentions_tsla {
        vec!["TSLAx".to_string(), "NVDAx".to_string(), "USDC".to_string()]
    } else if mentions_ant {
        vec!["ANTx".to_string(), "NVDAx".to_string(), "USDC".to_string()]
    } else {
        vec!["NVDAx".to_string(), "SPYx".to_string(), "USDC".to_string()]
    };

    let action_bindings = match genre {
        CartridgeGenre::ArcadeRunner => {
            let mut mapping = BTreeMap::new();
            mapping.insert(
                "LANE_LEFT".to_string(),
                StanceWeightLeg {
                    asset: "PRIMARY_PERP".to_string(),
                    weight_bps: -10_000,
                },
            );
            mapping.insert(
                "LANE_CENTER".to_string(),
                StanceWeightLeg {
                    asset: "USDC_SHIELD".to_string(),
                    weight_bps: 0,
                },
            );
            mapping.insert(
                "LANE_RIGHT".to_string(),
                StanceWeightLeg {
                    asset: "PRIMARY_PERP".to_string(),
                    weight_bps: 10_000,
                },
            );
            vec![
                ActionBinding::ContinuousStanceVector {
                    game_event: "PLAYER_LANE_SWITCH".to_string(),
                    mapping,
                    netting_policy: "NET_AT_CHECKPOINTS_30S".to_string(),
                },
                ActionBinding::BinaryOutcomeCall {
                    game_event: "PORTAL_GATE_PASS".to_string(),
                    asset: "MACRO_CATALYST".to_string(),
                    score_carry_multiplier_bps: 15_000,
                },
            ]
        }
        CartridgeGenre::SyndicateTurf => vec![ActionBinding::SectorTurfCapture {
            game_event: "CLAIM_DISTRICT_TURF".to_string(),
            district_assets: vec!["PRIMARY_PERP".to_string(), "EQUITY_ANCHOR".to_string()],
            heist_duration_secs: duration_secs.max(60),
            netting_policy: "NET_ON_ENTRY_AND_SETTLEMENT".to_string(),
        }],
        CartridgeGenre::PredictionBracket => vec![ActionBinding::BinaryOutcomeCall {
            game_event: "SUBMIT_BRACKET_FORECAST".to_string(),
            asset: "MACRO_CATALYST".to_string(),
            score_carry_multiplier_bps: 13_500,
        }],
        CartridgeGenre::BorelGameday => vec![
            ActionBinding::ConvictionWeightVector {
                game_event: "SUBMIT_CONVICTION_WEIGHTS".to_string(),
                max_rebalances: 3,
                allowed_assets: vec!["PRIMARY_PERP".to_string(), "EQUITY_ANCHOR".to_string()],
                netting_policy: "NET_ON_ENTRY_AND_SETTLEMENT".to_string(),
            },
            ActionBinding::BinaryOutcomeCall {
                game_event: "CALL_KALSHI_CATALYST".to_string(),
                asset: "MACRO_CATALYST".to_string(),
                score_carry_multiplier_bps: 13_500,
            },
        ],
    };

    let primary_formula = match genre {
        CartridgeGenre::ArcadeRunner => ScoringFormulaName::DirectionNeutralSharpePlusSurvival,
        CartridgeGenre::PredictionBracket => ScoringFormulaName::KalshiBrierCalibration,
        CartridgeGenre::SyndicateTurf => ScoringFormulaName::MultiStageCarryComposite,
        CartridgeGenre::BorelGameday => ScoringFormulaName::DirectionNeutralRelReturn,
    };

    let engine_target = match genre {
        CartridgeGenre::ArcadeRunner => "PHASER_3",
        CartridgeGenre::SyndicateTurf => "THREE_JS",
        _ => "NEXT_REACT",
    };

    let words: Vec<&str> = clean_prompt.split_whitespace().take(7).collect();
    let joined_words = words.join(" ");
    let title = if joined_words.len() >= 4 {
        joined_words.chars().take(76).collect()
    } else {
        format!("Custom {} Cartridge", genre.label())
    };
    let subtitle = if clean_prompt.len() >= 4 {
        clean_prompt.chars().take(155).collect()
    } else {
        "Vibe-compiled CartridgeFi real-market arena.".to_string()
    };

    let manifest = CartridgeManifestV2 {
        schema: default_manifest_schema(),
        manifest_version: "2.0.0".to_string(),
        metadata: ManifestMetadata {
            slug,
            title,
            subtitle,
            genre,
            engine_target: engine_target.to_string(),
            creator_handle: creator_handle.unwrap_or("@vibe-creator").to_string(),
            creator_wallet: creator_wallet.to_string(),
            creator_fee_share_bps: 5_000,
        },
        onboarding_and_session: OnboardingAndSessionConfig {
            allow_paper_mode: true,
            allow_live_mode: true,
            supported_deposit_chains: SUPPORTED_DEPOSIT_CHAINS
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
            apple_pay_enabled: true,
            live_session_envelope_usdc: LiveSessionEnvelopeConfig {
                min_usdc: 10,
                max_usdc: 200,
                max_leverage: 3,
            },
        },
        magicblock_room_config: MagicblockRoomConfig {
            tick_interval_ms: 10,
            duration_secs,
            shard_capacity: 200,
            privacy_mode: "PRIVATE_TEE_FOG_OF_WAR".to_string(),
            fog_of_war_bps: 7_500,
            showdown_unseal_secs: 15.min(duration_secs / 4).max(5),
            vrf_usage: if genre == CartridgeGenre::ArcadeRunner {
                "PROCEDURAL_TRACK_SEED_AND_TIEBREAK"
            } else {
                "TIEBREAK_AND_FREE_BONUS_DROP"
            }
            .to_string(),
        },
        market_universe,
        action_bindings,
        scoring_and_prizes: ScoringAndPrizesConfig {
            primary_formula,
            prize_curve: "TOP_20_PERCENT_SHAPLEY".to_string(),
            claim_menu_assets,
        },
    };

    let compliance = validate_manifest_compliance(&manifest, clean_prompt);
    (manifest, compliance)
}

#[inline]
fn next_deterministic_u64(state: u64) -> (u64, u64) {
    let mut x = if state == 0 {
        0x9e37_79b9_7f4a_7c15
    } else {
        state
    };
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    let out = x.wrapping_mul(0x2545_f491_4f6c_dd1d);
    (x, out)
}

/// Runs 500 market ticks through CartridgeFi's deterministic `i128` fixed-point scoring & payout engine,
/// matching `packages/shared-types/src/simulation.ts`.
pub fn simulate_cartridge_economy(
    manifest: &CartridgeManifestV2,
    volatility_regime: VolatilityRegime,
    tick_count: usize,
    simulated_players: usize,
) -> Result<CartridgeSimulationReport, ApiError> {
    let ticks = tick_count.clamp(20, 5_000);
    let players = simulated_players.clamp(2, MAX_PLAYERS_PER_SHARD);

    let regime_key = match volatility_regime {
        VolatilityRegime::Calm => "calm",
        VolatilityRegime::CrashVix35 => "crash_vix35",
    };
    let mut seed: u64 = 0x517c_c1b7_2722_0a95;
    for b in format!("{}:{regime_key}", manifest.metadata.slug).bytes() {
        seed = (seed ^ (b as u64)).wrapping_mul(0x0100_0000_01b3);
    }

    let step_amplitude_bps: i128 = match volatility_regime {
        VolatilityRegime::CrashVix35 => 85,
        VolatilityRegime::Calm => 18,
    };
    let drift_bias_bps: i128 = match volatility_regime {
        VolatilityRegime::CrashVix35 => -12,
        VolatilityRegime::Calm => 3,
    };

    let mut p0: i128 = 18_500_000_000;
    let mut p1: i128 = 14_200_000_000;
    let start_p0 = p0;
    let start_p1 = p1;

    let mut p0_series = Vec::with_capacity(ticks + 1);
    let mut p1_series = Vec::with_capacity(ticks + 1);
    p0_series.push(p0);
    p1_series.push(p1);

    for _ in 0..ticks {
        let (s1, v0) = next_deterministic_u64(seed);
        let (s2, v1) = next_deterministic_u64(s1);
        seed = s2;

        let centered0 = ((v0 % 201) as i128) - 100;
        let centered1 = ((v1 % 201) as i128) - 100;
        let delta_bps0 = (centered0 * step_amplitude_bps) / 100 + drift_bias_bps;
        let delta_bps1 = (centered1 * step_amplitude_bps) / 100 + drift_bias_bps / 2;

        p0 = (p0 + (p0 * delta_bps0) / 100_000).max(100_000_000);
        p1 = (p1 + (p1 * delta_bps1) / 100_000).max(100_000_000);
        p0_series.push(p0);
        p1_series.push(p1);
    }

    let end_p0 = *p0_series.last().unwrap_or(&start_p0);
    let end_p1 = *p1_series.last().unwrap_or(&start_p1);

    let mut player_scores = Vec::with_capacity(players);
    for p in 0..players {
        let (s1, vp) = next_deterministic_u64(seed);
        let (s2, vq) = next_deterministic_u64(s1);
        seed = s2;

        let raw_w0 = (((vp % 1201) as i128) - 600) * 1_000_000;
        let rem_cap = SCALE - raw_w0.abs();
        let sign1: i128 = if vq % 2 == 0 { 1 } else { -1 };
        let raw_w1 = sign1 * ((rem_cap * ((vq % 80) as i128)) / 100);

        let rel_score = compute_direction_neutral_relative_return(
            &[
                RelativeReturnAssetLeg {
                    weight_scaled: raw_w0,
                    entry_price: start_p0,
                    exit_price: end_p0,
                },
                RelativeReturnAssetLeg {
                    weight_scaled: raw_w1,
                    entry_price: start_p1,
                    exit_price: end_p1,
                },
            ],
            500_000_000,
        )
        .map_err(ApiError::internal)?;

        let score_scaled = match manifest.scoring_and_prizes.primary_formula {
            ScoringFormulaName::DirectionNeutralRelReturn => rel_score,
            ScoringFormulaName::DirectionNeutralSharpePlusSurvival => {
                let stride = (ticks / 20).max(1);
                let mut step_returns = Vec::new();
                let mut peak_cum: i128 = 0;
                let mut cum: i128 = 0;
                let mut max_dd: i128 = 0;
                let mut idx = stride;
                while idx < p0_series.len() {
                    let prev = p0_series[idx - stride];
                    let curr = p0_series[idx];
                    let asset_ret = ((curr - prev) * SCALE) / prev;
                    let player_step_ret = (raw_w0 * asset_ret) / SCALE;
                    step_returns.push(player_step_ret);
                    cum += player_step_ret;
                    if cum > peak_cum {
                        peak_cum = cum;
                    }
                    let dd = peak_cum - cum;
                    if dd > max_dd {
                        max_dd = dd;
                    }
                    idx += stride;
                }
                compute_drawdown_penalized_sharpe(
                    &step_returns,
                    max_dd,
                    350_000_000,
                    1_000_000_000_000,
                )
                .map_err(ApiError::internal)?
            }
            ScoringFormulaName::KalshiBrierCalibration => {
                let forecast_prob = (((vq % 900) as i128) + 50) * 1_000_000;
                let outcome = match volatility_regime {
                    VolatilityRegime::CrashVix35 => SCALE,
                    VolatilityRegime::Calm => 0,
                };
                compute_kalshi_brier_score(&[BrierForecastItem {
                    forecast_prob_scaled: forecast_prob,
                    outcome_scaled: outcome,
                }])
            }
            ScoringFormulaName::MultiStageCarryComposite => {
                let stage1_brier = compute_kalshi_brier_score(&[BrierForecastItem {
                    forecast_prob_scaled: (((vq % 800) as i128) + 100) * 1_000_000,
                    outcome_scaled: SCALE,
                }]);
                compute_multi_stage_carry_score(
                    stage1_brier,
                    rel_score + 250_000_000,
                    1_350_000_000,
                )
            }
        };

        let mut tb = [0u8; 32];
        tb[31] = (players - p) as u8;
        player_scores.push(PlayerScoreInput {
            player: format!("Player_{:02}", p + 1),
            score_scaled,
            tiebreak_key: tb,
        });
    }

    let envelope_mid_usdc = manifest
        .onboarding_and_session
        .live_session_envelope_usdc
        .max_usdc
        .min(20);
    let room_pool_usdc = (players as u64)
        .saturating_mul(envelope_mid_usdc)
        .saturating_mul(USDC_UNIT);

    let dist = compute_pool_and_fee_distribution(
        room_pool_usdc,
        ROOM_TOTAL_FEE_BPS,
        manifest.metadata.creator_fee_share_bps,
        false,
        &player_scores,
    )
    .map_err(ApiError::internal)?;

    let mut sorted_scores: Vec<i128> = player_scores.iter().map(|s| s.score_scaled).collect();
    sorted_scores.sort_by_key(|&a| std::cmp::Reverse(a));

    let p90_idx = (sorted_scores.len() / 10).min(sorted_scores.len() - 1);
    let med_idx = (sorted_scores.len() / 2).min(sorted_scores.len() - 1);
    let p10_idx = ((sorted_scores.len() * 9) / 10).min(sorted_scores.len() - 1);

    let monthly_creator_atomic = (dist.creator_fee_usdc as i128) * 1_200;
    let monthly_creator_scaled = (monthly_creator_atomic * SCALE) / (USDC_UNIT as i128);

    let top_podium = dist
        .payouts
        .iter()
        .take(3)
        .map(|p| PodiumEntry {
            player: p.player.clone(),
            rank: p.rank,
            score_scaled: p.score_scaled.clone(),
            score_formatted: p.score_formatted.clone(),
            payout_usdc_atomic: p.payout_usdc_atomic.to_string(),
        })
        .collect();

    Ok(CartridgeSimulationReport {
        slug: manifest.metadata.slug.clone(),
        volatility_regime,
        tick_count: ticks,
        simulated_players: players,
        room_pool_usdc_atomic: dist.room_pool_usdc.to_string(),
        payout_conservation_verified: dist.total_distributed_usdc <= dist.room_pool_usdc,
        total_distributed_usdc_atomic: dist.total_distributed_usdc.to_string(),
        creator_fee_per_room_usdc_atomic: dist.creator_fee_usdc.to_string(),
        projected_monthly_creator_fee_usdc_formatted: format_scaled_i128(monthly_creator_scaled, 2),
        p90_score_formatted: format_scaled_i128(sorted_scores[p90_idx], 4),
        median_score_formatted: format_scaled_i128(sorted_scores[med_idx], 4),
        p10_score_formatted: format_scaled_i128(sorted_scores[p10_idx], 4),
        top_podium,
    })
}

/// Canonical first-party CartridgeFi studio manifests (#001 Borel, #002 Pulse Runner, #003 Vice Bourse, #004 Champions Clash).
pub fn first_party_catalog() -> Vec<CartridgeManifestV2> {
    let borel = CartridgeManifestV2 {
        schema: default_manifest_schema(),
        manifest_version: "2.0.0".to_string(),
        metadata: ManifestMetadata {
            slug: "borel-macro-blitz-001".to_string(),
            title: "Borel: Game-Day Conviction Arena".to_string(),
            subtitle: "60s & Game-Day multiplayer arena uniting Kalshi predictions, Solana perps, and xStocks inside Private ER TEE Fog-of-War.".to_string(),
            genre: CartridgeGenre::BorelGameday,
            engine_target: "NEXT_REACT".to_string(),
            creator_handle: "@cartridgefi-studio".to_string(),
            creator_wallet: DEPLOYER_AND_KEEPER.to_string(),
            creator_fee_share_bps: 5_000,
        },
        onboarding_and_session: OnboardingAndSessionConfig {
            allow_paper_mode: true,
            allow_live_mode: true,
            supported_deposit_chains: SUPPORTED_DEPOSIT_CHAINS.iter().map(|s| (*s).to_string()).collect(),
            apple_pay_enabled: true,
            live_session_envelope_usdc: LiveSessionEnvelopeConfig {
                min_usdc: 10,
                max_usdc: 250,
                max_leverage: 5,
            },
        },
        magicblock_room_config: MagicblockRoomConfig {
            tick_interval_ms: 10,
            duration_secs: 60,
            shard_capacity: 200,
            privacy_mode: "PRIVATE_TEE_FOG_OF_WAR".to_string(),
            fog_of_war_bps: 7_500,
            showdown_unseal_secs: 15,
            vrf_usage: "TIEBREAK_AND_FREE_BONUS_DROP".to_string(),
        },
        market_universe: vec![
            MarketUniverseEntry {
                alias: "SOL_PERP".to_string(),
                venue: "PHOENIX_PERP".to_string(),
                symbol: "SOL-PERP".to_string(),
                mint: None,
                pyth_feed_id: Some(PYTH_FEED_SOL_USD.to_string()),
                market_id: None,
            },
            MarketUniverseEntry {
                alias: "NVDA_XSTOCK".to_string(),
                venue: "JUPITER_XSTOCKS".to_string(),
                symbol: "NVDAx".to_string(),
                mint: Some(MINT_NVDAX.to_string()),
                pyth_feed_id: Some(PYTH_FEED_NVDAX_USD.to_string()),
                market_id: None,
            },
            MarketUniverseEntry {
                alias: "SPY_XSTOCK".to_string(),
                venue: "JUPITER_XSTOCKS".to_string(),
                symbol: "SPYx".to_string(),
                mint: Some(MINT_SPYX.to_string()),
                pyth_feed_id: Some(PYTH_FEED_SPYX_USD.to_string()),
                market_id: None,
            },
            MarketUniverseEntry {
                alias: "FED_CUT_GATE".to_string(),
                venue: "DFLOW_KALSHI".to_string(),
                symbol: "KALSHI-FED-CUT".to_string(),
                mint: None,
                pyth_feed_id: None,
                market_id: Some(KALSHI_FED_DEC26_CUT_ID.to_string()),
            },
        ],
        action_bindings: vec![
            ActionBinding::ConvictionWeightVector {
                game_event: "SUBMIT_CONVICTION_WEIGHTS".to_string(),
                max_rebalances: 3,
                allowed_assets: vec![
                    "SOL_PERP".to_string(),
                    "NVDA_XSTOCK".to_string(),
                    "SPY_XSTOCK".to_string(),
                ],
                netting_policy: "NET_ON_ENTRY_AND_SETTLEMENT".to_string(),
            },
            ActionBinding::BinaryOutcomeCall {
                game_event: "CALL_KALSHI_CATALYST".to_string(),
                asset: "FED_CUT_GATE".to_string(),
                score_carry_multiplier_bps: 13_500,
            },
        ],
        scoring_and_prizes: ScoringAndPrizesConfig {
            primary_formula: ScoringFormulaName::DirectionNeutralRelReturn,
            prize_curve: "TOP_20_PERCENT_SHAPLEY".to_string(),
            claim_menu_assets: vec![
                "NVDAx".to_string(),
                "ANTx".to_string(),
                "SPYx".to_string(),
                "USDC".to_string(),
            ],
        },
    };

    let mut runner_lanes = BTreeMap::new();
    runner_lanes.insert(
        "LANE_LEFT".to_string(),
        StanceWeightLeg {
            asset: "PRIMARY_PERP".to_string(),
            weight_bps: -10_000,
        },
    );
    runner_lanes.insert(
        "LANE_CENTER".to_string(),
        StanceWeightLeg {
            asset: "USDC_SHIELD".to_string(),
            weight_bps: 0,
        },
    );
    runner_lanes.insert(
        "LANE_RIGHT".to_string(),
        StanceWeightLeg {
            asset: "PRIMARY_PERP".to_string(),
            weight_bps: 10_000,
        },
    );

    let pulse_runner = CartridgeManifestV2 {
        schema: default_manifest_schema(),
        manifest_version: "2.0.0".to_string(),
        metadata: ManifestMetadata {
            slug: "pulse-runner-nvda-sol".to_string(),
            title: "Pulse Runner: 3-Lane Volatility Sprint".to_string(),
            subtitle: "60fps 3-lane arcade reflex runner where Left=Short, Center=USDC Shield, Right=Long on the exact same CartridgeFi ER contract.".to_string(),
            genre: CartridgeGenre::ArcadeRunner,
            engine_target: "PHASER_3".to_string(),
            creator_handle: "@cartridgefi-studio".to_string(),
            creator_wallet: DEPLOYER_AND_KEEPER.to_string(),
            creator_fee_share_bps: 5_000,
        },
        onboarding_and_session: OnboardingAndSessionConfig {
            allow_paper_mode: true,
            allow_live_mode: true,
            supported_deposit_chains: SUPPORTED_DEPOSIT_CHAINS.iter().map(|s| (*s).to_string()).collect(),
            apple_pay_enabled: true,
            live_session_envelope_usdc: LiveSessionEnvelopeConfig {
                min_usdc: 10,
                max_usdc: 150,
                max_leverage: 3,
            },
        },
        magicblock_room_config: MagicblockRoomConfig {
            tick_interval_ms: 10,
            duration_secs: 90,
            shard_capacity: 200,
            privacy_mode: "PRIVATE_TEE_FOG_OF_WAR".to_string(),
            fog_of_war_bps: 7_500,
            showdown_unseal_secs: 15,
            vrf_usage: "PROCEDURAL_TRACK_SEED_AND_TIEBREAK".to_string(),
        },
        market_universe: vec![
            MarketUniverseEntry {
                alias: "PRIMARY_PERP".to_string(),
                venue: "PHOENIX_PERP".to_string(),
                symbol: "SOL-PERP".to_string(),
                mint: None,
                pyth_feed_id: Some(PYTH_FEED_SOL_USD.to_string()),
                market_id: None,
            },
            MarketUniverseEntry {
                alias: "TECH_EQUITY".to_string(),
                venue: "JUPITER_XSTOCKS".to_string(),
                symbol: "NVDAx".to_string(),
                mint: Some(MINT_NVDAX.to_string()),
                pyth_feed_id: Some(PYTH_FEED_NVDAX_USD.to_string()),
                market_id: None,
            },
            MarketUniverseEntry {
                alias: "MACRO_GATE".to_string(),
                venue: "DFLOW_KALSHI".to_string(),
                symbol: "KALSHI-FED-CUT".to_string(),
                mint: None,
                pyth_feed_id: None,
                market_id: Some(KALSHI_FED_DEC26_CUT_ID.to_string()),
            },
        ],
        action_bindings: vec![
            ActionBinding::ContinuousStanceVector {
                game_event: "PLAYER_LANE_SWITCH".to_string(),
                mapping: runner_lanes,
                netting_policy: "NET_AT_CHECKPOINTS_30S".to_string(),
            },
            ActionBinding::BinaryOutcomeCall {
                game_event: "PORTAL_GATE_PASS".to_string(),
                asset: "MACRO_GATE".to_string(),
                score_carry_multiplier_bps: 15_000,
            },
        ],
        scoring_and_prizes: ScoringAndPrizesConfig {
            primary_formula: ScoringFormulaName::DirectionNeutralSharpePlusSurvival,
            prize_curve: "TOP_20_PERCENT_SHAPLEY".to_string(),
            claim_menu_assets: vec![
                "NVDAx".to_string(),
                "SPYx".to_string(),
                "USDC".to_string(),
            ],
        },
    };

    let vice_bourse = CartridgeManifestV2 {
        schema: default_manifest_schema(),
        manifest_version: "2.0.0".to_string(),
        metadata: ManifestMetadata {
            slug: "vice-bourse-syndicate".to_string(),
            title: "Vice Bourse: Sector Turf Wars".to_string(),
            subtitle: "District control & 10-minute Private TEE Vault Heists backed by tokenized tech & index equities.".to_string(),
            genre: CartridgeGenre::SyndicateTurf,
            engine_target: "THREE_JS".to_string(),
            creator_handle: "@vice-labs".to_string(),
            creator_wallet: PACER_BOT_1_PUBKEY.to_string(),
            creator_fee_share_bps: 5_000,
        },
        onboarding_and_session: OnboardingAndSessionConfig {
            allow_paper_mode: true,
            allow_live_mode: true,
            supported_deposit_chains: SUPPORTED_DEPOSIT_CHAINS.iter().map(|s| (*s).to_string()).collect(),
            apple_pay_enabled: true,
            live_session_envelope_usdc: LiveSessionEnvelopeConfig {
                min_usdc: 15,
                max_usdc: 250,
                max_leverage: 3,
            },
        },
        magicblock_room_config: MagicblockRoomConfig {
            tick_interval_ms: 25,
            duration_secs: 600,
            shard_capacity: 200,
            privacy_mode: "PRIVATE_TEE_FOG_OF_WAR".to_string(),
            fog_of_war_bps: 8_000,
            showdown_unseal_secs: 30,
            vrf_usage: "TIEBREAK_AND_FREE_BONUS_DROP".to_string(),
        },
        market_universe: vec![
            MarketUniverseEntry {
                alias: "SILICON_COAST".to_string(),
                venue: "JUPITER_XSTOCKS".to_string(),
                symbol: "NVDAx".to_string(),
                mint: Some(MINT_NVDAX.to_string()),
                pyth_feed_id: Some(PYTH_FEED_NVDAX_USD.to_string()),
                market_id: None,
            },
            MarketUniverseEntry {
                alias: "ANTHROPIC_TOWER".to_string(),
                venue: "JUPITER_XSTOCKS".to_string(),
                symbol: "ANTx".to_string(),
                mint: Some(MINT_ANTX.to_string()),
                pyth_feed_id: None,
                market_id: None,
            },
            MarketUniverseEntry {
                alias: "FED_PLAZA".to_string(),
                venue: "DFLOW_KALSHI".to_string(),
                symbol: "KALSHI-FED-CUT".to_string(),
                mint: None,
                pyth_feed_id: None,
                market_id: Some(KALSHI_FED_DEC26_CUT_ID.to_string()),
            },
        ],
        action_bindings: vec![ActionBinding::SectorTurfCapture {
            game_event: "CLAIM_DISTRICT_TURF".to_string(),
            district_assets: vec!["SILICON_COAST".to_string(), "ANTHROPIC_TOWER".to_string()],
            heist_duration_secs: 600,
            netting_policy: "NET_ON_ENTRY_AND_SETTLEMENT".to_string(),
        }],
        scoring_and_prizes: ScoringAndPrizesConfig {
            primary_formula: ScoringFormulaName::MultiStageCarryComposite,
            prize_curve: "TOP_20_PERCENT_SHAPLEY".to_string(),
            claim_menu_assets: vec![
                "NVDAx".to_string(),
                "ANTx".to_string(),
                "USDC".to_string(),
            ],
        },
    };

    let champions_clash = CartridgeManifestV2 {
        schema: default_manifest_schema(),
        manifest_version: "2.0.0".to_string(),
        metadata: ManifestMetadata {
            slug: "champions-prop-clash".to_string(),
            title: "Champions Matchday Prop Clash".to_string(),
            subtitle: "Live matchday prediction brackets calibrated via Brier forecasting skill and Kalshi outcome liquidity.".to_string(),
            genre: CartridgeGenre::PredictionBracket,
            engine_target: "NEXT_REACT".to_string(),
            creator_handle: "@EuroAlpha".to_string(),
            creator_wallet: PACER_BOT_2_PUBKEY.to_string(),
            creator_fee_share_bps: 5_000,
        },
        onboarding_and_session: OnboardingAndSessionConfig {
            allow_paper_mode: true,
            allow_live_mode: true,
            supported_deposit_chains: SUPPORTED_DEPOSIT_CHAINS.iter().map(|s| (*s).to_string()).collect(),
            apple_pay_enabled: true,
            live_session_envelope_usdc: LiveSessionEnvelopeConfig {
                min_usdc: 10,
                max_usdc: 200,
                max_leverage: 2,
            },
        },
        magicblock_room_config: MagicblockRoomConfig {
            tick_interval_ms: 20,
            duration_secs: 180,
            shard_capacity: 200,
            privacy_mode: "PRIVATE_TEE_FOG_OF_WAR".to_string(),
            fog_of_war_bps: 7_500,
            showdown_unseal_secs: 20,
            vrf_usage: "TIEBREAK_AND_FREE_BONUS_DROP".to_string(),
        },
        market_universe: vec![
            MarketUniverseEntry {
                alias: "NVDA_EARNINGS".to_string(),
                venue: "DFLOW_KALSHI".to_string(),
                symbol: "KALSHI-NVDA-BEAT".to_string(),
                mint: None,
                pyth_feed_id: None,
                market_id: Some(KALSHI_NVDA_BEAT_Q4_ID.to_string()),
            },
            MarketUniverseEntry {
                alias: "SOL_ATH_GATE".to_string(),
                venue: "DFLOW_KALSHI".to_string(),
                symbol: "KALSHI-SOL-ATH".to_string(),
                mint: None,
                pyth_feed_id: None,
                market_id: Some(KALSHI_SOL_ATH_2026_ID.to_string()),
            },
        ],
        action_bindings: vec![ActionBinding::BinaryOutcomeCall {
            game_event: "SUBMIT_BRACKET_FORECAST".to_string(),
            asset: "NVDA_EARNINGS".to_string(),
            score_carry_multiplier_bps: 12_500,
        }],
        scoring_and_prizes: ScoringAndPrizesConfig {
            primary_formula: ScoringFormulaName::KalshiBrierCalibration,
            prize_curve: "TOP_20_PERCENT_SHAPLEY".to_string(),
            claim_menu_assets: vec![
                "SPYx".to_string(),
                "NVDAx".to_string(),
                "USDC".to_string(),
            ],
        },
    };

    vec![borel, pulse_runner, vice_bourse, champions_clash]
}

pub fn handle_vibe_compile(req: VibeCompileRequest) -> Result<VibeCompileResponse, ApiError> {
    let (manifest, compliance) = if let Some(explicit_manifest) = req.manifest {
        let check = validate_manifest_compliance(&explicit_manifest, &req.prompt);
        (explicit_manifest, check)
    } else {
        if req.prompt.trim().is_empty() {
            return Err(ApiError::bad_request(
                "EMPTY_PROMPT",
                "Either `prompt` or `manifest` must be provided.",
            ));
        }
        let genre = req.genre.unwrap_or(CartridgeGenre::BorelGameday);
        let wallet = req.creator_wallet.as_deref().unwrap_or(DEPLOYER_AND_KEEPER);
        compile_prompt_to_manifest(&req.prompt, genre, wallet, req.creator_handle.as_deref())
    };

    if !compliance.valid {
        return Err(ApiError::compliance(compliance.violations));
    }

    let slug_hash_hex = compute_slug_hash_hex(&manifest.metadata.slug);
    Ok(VibeCompileResponse {
        valid: true,
        violations: Vec::new(),
        slug_hash_hex,
        target_program_ids: CARTRIDGE_PROGRAM_IDS.map(|s| s.to_string()),
        manifest,
    })
}
