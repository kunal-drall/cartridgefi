//! Unified Venue Quote Racer (`POST /v1/venues/quote`) & Non-Custodial Session Risk Envelope Builder (`POST /v1/venues/envelope`).
//! Routes/races Jupiter Swap V2 (`/swap/v2/order` with `referralAccount` & `referralFee=20`),
//! DFlow Prediction/SPL (`/order` with `transactionVersion=v1` & `platformFeeBps=20`),
//! Phoenix/Jupiter Perps (`leverage <= 5x` hard ceiling), and MagicBlock Private Payments API
//! (`https://payments.magicblock.app/v1/spl/transfer` on `devnet-private`) fee routing payloads.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::constants::{
    BETA_MAX_GLOBAL_TVL_USDC, BETA_MAX_ROOM_POOL_USDC, BPS_DENOMINATOR_U64, DFLOW_DEV_ORDER_URL,
    JUPITER_SWAP_V2_ORDER_URL, MAX_LIVE_LEVERAGE, MINT_NVDAX, MINT_USDC, PRIVATE_PAYMENTS_API_URL,
    SESSION_KEY_PROGRAM_ID, VAULT_ROUTER_PROGRAM_ID, VENUE_BUILDER_FEE_BPS,
};
use crate::error::ApiError;
use crate::markets::{resolve_mint_price8_and_decimals, MarketDiscoveryResponse};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueQuoteRequest {
    /// Optional target venue (`JUPITER_XSTOCKS`, `DFLOW_KALSHI`, `PHOENIX_PERP`, `JUPITER_PERP`, or `AUTO_RACE`).
    #[serde(default)]
    pub venue: Option<String>,
    #[serde(default, alias = "input_mint")]
    pub input_mint: Option<String>,
    #[serde(default, alias = "output_mint")]
    pub output_mint: Option<String>,
    /// Input amount in atomic units (e.g. `10_000_000` = 10 USDC).
    #[serde(alias = "amount_atomic")]
    pub amount: u64,
    #[serde(default, alias = "user_public_key")]
    pub user_public_key: Option<String>,
    /// Leverage for perp venues (`1..=5`). Strictly rejects `> 5`!
    #[serde(default)]
    pub leverage: Option<u8>,
    #[serde(default)]
    pub side: Option<String>,
    #[serde(default, alias = "slippage_bps")]
    pub slippage_bps: Option<u16>,
    #[serde(default, alias = "sponsored_swap")]
    pub sponsored_swap: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicBlockPrivatePaymentSpec {
    pub endpoint: String,
    pub cluster: String,
    pub visibility: String,
    pub from: String,
    pub to: String,
    pub mint: String,
    pub amount: u64,
    pub from_balance: String,
    pub to_balance: String,
    pub init_if_missing: bool,
    pub init_atas_if_missing: bool,
    pub min_delay_ms: String,
    pub max_delay_ms: String,
    pub split: u8,
    pub platform_fee_bps: u16,
    pub platform_fee_account: String,
    pub client_ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompetingVenueQuote {
    pub venue: String,
    pub endpoint_url: String,
    pub out_amount_atomic: u64,
    pub fee_bps: u16,
    pub transaction_version: String,
    pub upstream_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueQuoteResponse {
    pub selected_venue: String,
    pub input_mint: String,
    pub output_mint: String,
    pub in_amount_atomic: u64,
    pub out_amount_atomic: u64,
    pub builder_fee_bps: u16,
    pub builder_fee_usdc_atomic: u64,
    pub leverage: u8,
    pub notional_usdc_atomic: u64,
    pub entry_price8: i64,
    pub liquidation_price8: Option<i64>,
    pub transaction_version: String,
    pub referral_account: String,
    pub platform_fee_account: String,
    pub competing_quotes: Vec<CompetingVenueQuote>,
    pub magicblock_private_fee_route: MagicBlockPrivatePaymentSpec,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamOrderQuote {
    out_amount: Option<String>,
}

pub fn build_private_payment_fee_spec(
    sender_wallet: &str,
    recipient_wallet: &str,
    mint: &str,
    amount_atomic: u64,
    platform_fee_account: &str,
    client_ref_id: &str,
) -> MagicBlockPrivatePaymentSpec {
    let base = std::env::var("MAGICBLOCK_PAYMENTS_URL")
        .unwrap_or_else(|_| PRIVATE_PAYMENTS_API_URL.to_string());
    MagicBlockPrivatePaymentSpec {
        endpoint: format!("{}/v1/spl/transfer", base.trim_end_matches('/')),
        cluster: "devnet-private".to_string(),
        visibility: "private".to_string(),
        from: sender_wallet.to_string(),
        to: recipient_wallet.to_string(),
        mint: mint.to_string(),
        amount: amount_atomic,
        from_balance: "base".to_string(),
        to_balance: "base".to_string(),
        init_if_missing: true,
        init_atas_if_missing: true,
        min_delay_ms: "0".to_string(),
        max_delay_ms: "0".to_string(),
        split: 1,
        platform_fee_bps: VENUE_BUILDER_FEE_BPS,
        platform_fee_account: platform_fee_account.to_string(),
        client_ref_id: client_ref_id.to_string(),
    }
}

/// Computes exact integer swap output amount from atomic input, oracle prices, decimals, and fee bps.
pub fn compute_deterministic_swap_out(
    in_amount_atomic: u64,
    in_price8: i64,
    in_decimals: u32,
    out_price8: i64,
    out_decimals: u32,
    fee_bps: u16,
    venue_edge_bps: i64,
) -> u64 {
    if in_amount_atomic == 0 || in_price8 <= 0 || out_price8 <= 0 {
        return 0;
    }
    let in_scale = 10_u128.pow(in_decimals.min(18));
    let out_scale = 10_u128.pow(out_decimals.min(18));

    // Value in 10^8 USD * out_scale:
    let gross_numer = (in_amount_atomic as u128)
        .saturating_mul(in_price8 as u128)
        .saturating_mul(out_scale);
    let gross_denom = in_scale.saturating_mul(out_price8 as u128);
    if gross_denom == 0 {
        return 0;
    }
    let gross_out = gross_numer / gross_denom;
    let net_bps = (10_000_i64 - (fee_bps as i64) + venue_edge_bps).clamp(1, 10_000) as u128;
    ((gross_out.saturating_mul(net_bps)) / 10_000) as u64
}

async fn try_jupiter_v2_order_quote(
    http: &reqwest::Client,
    input_mint: &str,
    output_mint: &str,
    amount: u64,
    referral_account: &str,
    offline_mode: bool,
) -> (Option<u64>, String, String) {
    let url = std::env::var("JUPITER_ORDER_URL")
        .unwrap_or_else(|_| JUPITER_SWAP_V2_ORDER_URL.to_string());
    let full_endpoint = format!(
        "{url}?inputMint={input_mint}&outputMint={output_mint}&amount={amount}&referralAccount={referral_account}&referralFee={VENUE_BUILDER_FEE_BPS}"
    );
    if offline_mode {
        return (None, full_endpoint, "standalone_deterministic".to_string());
    }
    let Ok(api_key) = std::env::var("JUPITER_API_KEY") else {
        return (
            None,
            full_endpoint,
            "missing_jupiter_api_key_fallback".to_string(),
        );
    };
    if api_key.trim().is_empty() {
        return (
            None,
            full_endpoint,
            "missing_jupiter_api_key_fallback".to_string(),
        );
    }

    let amount_str = amount.to_string();
    let fee_str = VENUE_BUILDER_FEE_BPS.to_string();
    let req = http
        .get(&url)
        .header("x-api-key", api_key.trim())
        .query(&[
            ("inputMint", input_mint),
            ("outputMint", output_mint),
            ("amount", amount_str.as_str()),
            ("referralAccount", referral_account),
            ("referralFee", fee_str.as_str()),
        ])
        .timeout(Duration::from_millis(2_500));

    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            if let Ok(parsed) = resp.json::<UpstreamOrderQuote>().await {
                if let Some(out_s) = parsed.out_amount {
                    if let Ok(out_u64) = out_s.parse::<u64>() {
                        return (Some(out_u64), full_endpoint, "jupiter_v2_live".to_string());
                    }
                }
            }
        }
    }
    (
        None,
        full_endpoint,
        "upstream_fallback_deterministic".to_string(),
    )
}

#[allow(clippy::too_many_arguments)]
async fn try_dflow_v1_order_quote(
    http: &reqwest::Client,
    input_mint: &str,
    output_mint: &str,
    amount: u64,
    platform_fee_account: &str,
    user_pubkey: Option<&str>,
    sponsor_pubkey: Option<&str>,
    offline_mode: bool,
) -> (Option<u64>, String, String) {
    let base = std::env::var("DFLOW_TRADE_API_URL")
        .unwrap_or_else(|_| DFLOW_DEV_ORDER_URL.trim_end_matches("/order").to_string());
    let url = format!("{}/order", base.trim_end_matches('/'));
    let full_endpoint = format!(
        "{url}?inputMint={input_mint}&outputMint={output_mint}&amount={amount}&transactionVersion=v1&platformFeeBps={VENUE_BUILDER_FEE_BPS}&feeAccount={platform_fee_account}"
    );
    if offline_mode {
        return (None, full_endpoint, "standalone_deterministic".to_string());
    }

    let amount_str = amount.to_string();
    let fee_str = VENUE_BUILDER_FEE_BPS.to_string();
    let mut query: Vec<(&str, &str)> = vec![
        ("inputMint", input_mint),
        ("outputMint", output_mint),
        ("amount", amount_str.as_str()),
        ("transactionVersion", "v1"),
        ("platformFeeBps", fee_str.as_str()),
        ("feeAccount", platform_fee_account),
    ];
    if let Some(u) = user_pubkey {
        query.push(("userPublicKey", u));
    }
    if let Some(sp) = sponsor_pubkey {
        query.push(("sponsor", sp));
        query.push(("sponsorExec", "false"));
    }

    let mut req = http
        .get(&url)
        .query(&query)
        .timeout(Duration::from_millis(2_500));
    if let Ok(dflow_key) = std::env::var("DFLOW_API_KEY") {
        if !dflow_key.trim().is_empty() {
            req = req.header("x-api-key", dflow_key.trim());
        }
    }

    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            if let Ok(parsed) = resp.json::<UpstreamOrderQuote>().await {
                if let Some(out_s) = parsed.out_amount {
                    if let Ok(out_u64) = out_s.parse::<u64>() {
                        return (Some(out_u64), full_endpoint, "dflow_v1_live".to_string());
                    }
                }
            }
        }
    }
    (
        None,
        full_endpoint,
        "upstream_fallback_deterministic".to_string(),
    )
}

pub async fn process_venue_quote(
    http: &reqwest::Client,
    req: VenueQuoteRequest,
    discovery: &MarketDiscoveryResponse,
    platform_fee_account: &str,
    kora_sponsor_pubkey: &str,
    offline_mode: bool,
) -> Result<VenueQuoteResponse, ApiError> {
    if req.amount == 0 {
        return Err(ApiError::bad_request(
            "ZERO_QUOTE_AMOUNT",
            "Quote `amount` must be strictly positive in atomic units.",
        ));
    }

    let leverage = req.leverage.unwrap_or(1);
    if leverage == 0 || leverage > MAX_LIVE_LEVERAGE {
        return Err(ApiError::bad_request(
            "LEVERAGE_CEILING_EXCEEDED",
            format!(
                "Requested leverage {leverage}x violates CartridgeFi hard leverage ceiling (must be within 1x..={MAX_LIVE_LEVERAGE}x)."
            ),
        ));
    }

    let venue_hint = req
        .venue
        .as_deref()
        .unwrap_or("AUTO_RACE")
        .to_ascii_uppercase();
    let input_mint = req
        .input_mint
        .clone()
        .unwrap_or_else(|| MINT_USDC.to_string());
    let output_mint = req
        .output_mint
        .clone()
        .unwrap_or_else(|| MINT_NVDAX.to_string());

    let user_wallet = req
        .user_public_key
        .as_deref()
        .unwrap_or(platform_fee_account);
    let builder_fee_usdc_atomic = (((req.amount as u128) * (VENUE_BUILDER_FEE_BPS as u128))
        / (BPS_DENOMINATOR_U64 as u128)) as u64;

    let is_perp = venue_hint.contains("PERP") || leverage > 1 || output_mint.ends_with("-PERP");
    if is_perp {
        if req.amount > BETA_MAX_ROOM_POOL_USDC {
            return Err(ApiError::bad_request(
                "COLLATERAL_CAP_EXCEEDED",
                format!(
                    "Perp collateral {} exceeds beta cap {} atomic USDC.",
                    req.amount, BETA_MAX_ROOM_POOL_USDC
                ),
            ));
        }
        let (entry_price8, out_decimals) =
            resolve_mint_price8_and_decimals(discovery, &output_mint);
        let notional_usdc_atomic = req.amount.saturating_mul(leverage as u64);
        let is_short = req
            .side
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case("SHORT"))
            .unwrap_or(false);
        // Integer liquidation distance: `entry * (10000 +/- 9000 / leverage) / 10000`
        let liq_move_bps: i64 = 9_000 / (leverage as i64);
        let liq_price8 = if is_short {
            entry_price8 + (entry_price8 * liq_move_bps) / 10_000
        } else {
            (entry_price8 - (entry_price8 * liq_move_bps) / 10_000).max(1)
        };
        let out_units = compute_deterministic_swap_out(
            notional_usdc_atomic,
            100_000_000,
            6,
            entry_price8,
            out_decimals,
            VENUE_BUILDER_FEE_BPS,
            0,
        );
        let selected_venue = if venue_hint == "JUPITER_PERP" {
            "JUPITER_PERP".to_string()
        } else {
            "PHOENIX_PERP".to_string()
        };
        let fee_spec = build_private_payment_fee_spec(
            user_wallet,
            platform_fee_account,
            MINT_USDC,
            builder_fee_usdc_atomic.max(1),
            platform_fee_account,
            &format!("{}", req.amount % 1_000_000_000),
        );
        return Ok(VenueQuoteResponse {
            selected_venue: selected_venue.clone(),
            input_mint,
            output_mint,
            in_amount_atomic: req.amount,
            out_amount_atomic: out_units,
            builder_fee_bps: VENUE_BUILDER_FEE_BPS,
            builder_fee_usdc_atomic,
            leverage,
            notional_usdc_atomic,
            entry_price8,
            liquidation_price8: Some(liq_price8),
            transaction_version: "v1".to_string(),
            referral_account: platform_fee_account.to_string(),
            platform_fee_account: platform_fee_account.to_string(),
            competing_quotes: vec![CompetingVenueQuote {
                venue: selected_venue,
                endpoint_url: "solana://anchor-cpi/cartridge-vault-router".to_string(),
                out_amount_atomic: out_units,
                fee_bps: VENUE_BUILDER_FEE_BPS,
                transaction_version: "v1".to_string(),
                upstream_status: "anchor_cpi_ready".to_string(),
            }],
            magicblock_private_fee_route: fee_spec,
        });
    }

    // Race Jupiter Swap V2 (`/swap/v2/order`) and DFlow (`/order` v1) concurrently!
    let (in_price8, in_dec) = resolve_mint_price8_and_decimals(discovery, &input_mint);
    let (out_price8, out_dec) = resolve_mint_price8_and_decimals(discovery, &output_mint);

    let sponsor_opt = if req.sponsored_swap.unwrap_or(true) {
        Some(kora_sponsor_pubkey)
    } else {
        None
    };

    let (jup_res, dflow_res) = tokio::join!(
        try_jupiter_v2_order_quote(
            http,
            &input_mint,
            &output_mint,
            req.amount,
            platform_fee_account,
            offline_mode,
        ),
        try_dflow_v1_order_quote(
            http,
            &input_mint,
            &output_mint,
            req.amount,
            platform_fee_account,
            req.user_public_key.as_deref(),
            sponsor_opt,
            offline_mode,
        )
    );

    let is_kalshi = output_mint.starts_with("KFed")
        || output_mint.starts_with("KNvd")
        || output_mint.starts_with("KSol")
        || output_mint.starts_with("KALSHI-")
        || venue_hint == "DFLOW_KALSHI";

    let jup_out = jup_res.0.unwrap_or_else(|| {
        compute_deterministic_swap_out(
            req.amount,
            in_price8,
            in_dec,
            out_price8,
            out_dec,
            VENUE_BUILDER_FEE_BPS,
            if is_kalshi { -8 } else { 4 },
        )
    });
    let dflow_out = dflow_res.0.unwrap_or_else(|| {
        compute_deterministic_swap_out(
            req.amount,
            in_price8,
            in_dec,
            out_price8,
            out_dec,
            VENUE_BUILDER_FEE_BPS,
            if is_kalshi { 6 } else { 1 },
        )
    });

    let competing_quotes = vec![
        CompetingVenueQuote {
            venue: "JUPITER_XSTOCKS".to_string(),
            endpoint_url: jup_res.1,
            out_amount_atomic: jup_out,
            fee_bps: VENUE_BUILDER_FEE_BPS,
            transaction_version: "v1".to_string(),
            upstream_status: jup_res.2,
        },
        CompetingVenueQuote {
            venue: "DFLOW_KALSHI".to_string(),
            endpoint_url: dflow_res.1,
            out_amount_atomic: dflow_out,
            fee_bps: VENUE_BUILDER_FEE_BPS,
            transaction_version: "v1".to_string(),
            upstream_status: dflow_res.2,
        },
    ];

    let (selected_venue, winning_out) = if venue_hint == "JUPITER_XSTOCKS" {
        ("JUPITER_XSTOCKS".to_string(), jup_out)
    } else if venue_hint == "DFLOW_KALSHI" || dflow_out > jup_out {
        ("DFLOW_KALSHI".to_string(), dflow_out)
    } else {
        ("JUPITER_XSTOCKS".to_string(), jup_out)
    };

    let fee_spec = build_private_payment_fee_spec(
        user_wallet,
        platform_fee_account,
        MINT_USDC,
        builder_fee_usdc_atomic.max(1),
        platform_fee_account,
        &format!("{}", (req.amount ^ (winning_out + 1)) % 1_000_000_000),
    );

    Ok(VenueQuoteResponse {
        selected_venue,
        input_mint,
        output_mint,
        in_amount_atomic: req.amount,
        out_amount_atomic: winning_out,
        builder_fee_bps: VENUE_BUILDER_FEE_BPS,
        builder_fee_usdc_atomic,
        leverage: 1,
        notional_usdc_atomic: req.amount,
        entry_price8: out_price8,
        liquidation_price8: None,
        transaction_version: "v1".to_string(),
        referral_account: platform_fee_account.to_string(),
        platform_fee_account: platform_fee_account.to_string(),
        competing_quotes,
        magicblock_private_fee_route: fee_spec,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEnvelopeRequest {
    #[serde(alias = "owner_wallet")]
    pub owner_wallet: String,
    #[serde(alias = "ephemeral_session_key")]
    pub ephemeral_session_key: String,
    #[serde(alias = "room_id")]
    pub room_id: String,
    #[serde(alias = "max_collateral_usdc_atomic")]
    pub max_collateral_usdc_atomic: u64,
    #[serde(default, alias = "max_leverage")]
    pub max_leverage: Option<u8>,
    #[serde(default, alias = "duration_secs")]
    pub duration_secs: Option<u64>,
    #[serde(default, alias = "allowed_venues")]
    pub allowed_venues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEnvelopeResponse {
    pub envelope_id: String,
    pub session_envelope_pda: String,
    pub vault_router_program_id: String,
    pub magicblock_session_program_id: String,
    pub owner_wallet: String,
    pub ephemeral_session_key: String,
    pub room_id: String,
    pub max_collateral_usdc_atomic: u64,
    pub max_leverage: u8,
    pub allowed_venues_bitmask: u8,
    pub expires_at_secs: u64,
    pub non_custodial_withdraw_locked_to_owner: bool,
}

pub fn build_session_risk_envelope(
    req: SessionEnvelopeRequest,
    current_global_tvl_usdc: u64,
    now_secs: u64,
) -> Result<SessionEnvelopeResponse, ApiError> {
    let owner = req.owner_wallet.trim();
    let session_key = req.ephemeral_session_key.trim();
    if owner.len() < 32 || session_key.len() < 32 {
        return Err(ApiError::bad_request(
            "INVALID_SESSION_PUBKEY",
            "Both `ownerWallet` and `ephemeralSessionKey` must be valid base58 public keys.",
        ));
    }
    if owner == session_key {
        return Err(ApiError::bad_request(
            "SESSION_KEY_MUST_BE_ISOLATED",
            "`ephemeralSessionKey` must be distinct from `ownerWallet` for zero-popup session key isolation.",
        ));
    }

    let max_leverage = req.max_leverage.unwrap_or(3);
    if max_leverage == 0 || max_leverage > MAX_LIVE_LEVERAGE {
        return Err(ApiError::bad_request(
            "LEVERAGE_CEILING_EXCEEDED",
            format!(
                "Session envelope `maxLeverage` ({max_leverage}x) exceeds hard {MAX_LIVE_LEVERAGE}x limit."
            ),
        ));
    }

    if req.max_collateral_usdc_atomic == 0
        || req.max_collateral_usdc_atomic > BETA_MAX_ROOM_POOL_USDC
    {
        return Err(ApiError::bad_request(
            "ENVELOPE_COLLATERAL_OUT_OF_BOUNDS",
            format!(
                "Session `maxCollateralUsdcAtomic` must be within (0, {BETA_MAX_ROOM_POOL_USDC}] atomic USDC."
            ),
        ));
    }

    if current_global_tvl_usdc.saturating_add(req.max_collateral_usdc_atomic)
        > BETA_MAX_GLOBAL_TVL_USDC
    {
        return Err(ApiError::conflict(
            "GLOBAL_BETA_TVL_CAP_REACHED",
            format!("Global beta TVL cap ({BETA_MAX_GLOBAL_TVL_USDC} atomic USDC) exceeded."),
        ));
    }

    let duration_secs = req.duration_secs.unwrap_or(3_600).clamp(30, 86_400);
    let expires_at_secs = now_secs.saturating_add(duration_secs);

    let mut venue_mask: u8 = 0;
    if req.allowed_venues.is_empty() {
        venue_mask = 0b0000_1111; // All 4 verified CartridgeFi venues
    } else {
        for v in &req.allowed_venues {
            match v.to_ascii_uppercase().as_str() {
                "JUPITER_XSTOCKS" => venue_mask |= 1,
                "PHOENIX_PERP" => venue_mask |= 2,
                "JUPITER_PERP" => venue_mask |= 4,
                "DFLOW_KALSHI" => venue_mask |= 8,
                _ => {
                    return Err(ApiError::bad_request(
                        "UNSUPPORTED_VENUE",
                        format!("Unsupported venue `{v}` in session risk envelope."),
                    ));
                }
            }
        }
    }

    let mut hasher = Sha256::new();
    hasher.update(b"session_envelope:");
    hasher.update(VAULT_ROUTER_PROGRAM_ID.as_bytes());
    hasher.update(owner.as_bytes());
    hasher.update(req.room_id.as_bytes());
    let digest = hasher.finalize();
    let session_envelope_pda = bs58::encode(&digest).into_string();
    let envelope_id = format!("env_{}", &hex::encode(digest)[..16]);

    Ok(SessionEnvelopeResponse {
        envelope_id,
        session_envelope_pda,
        vault_router_program_id: VAULT_ROUTER_PROGRAM_ID.to_string(),
        magicblock_session_program_id: SESSION_KEY_PROGRAM_ID.to_string(),
        owner_wallet: owner.to_string(),
        ephemeral_session_key: session_key.to_string(),
        room_id: req.room_id,
        max_collateral_usdc_atomic: req.max_collateral_usdc_atomic,
        max_leverage,
        allowed_venues_bitmask: venue_mask,
        expires_at_secs,
        non_custodial_withdraw_locked_to_owner: true,
    })
}
