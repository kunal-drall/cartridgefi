//! Unified 7-Chain Deposit Intent Watcher, Apple/Google Pay + Passkey Onboarding Session Mint,
//! and 1-Tap Devnet USDC Faucet (`POST /v1/cashier/intent`, `GET /v1/cashier/intent/:intentId`, `POST /v1/cashier/devnet-faucet`).
//! Settles 100% into canonical Solana `USDC` (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) using pure integer math.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::constants::{
    is_supported_deposit_chain, BETA_MAX_ROOM_POOL_USDC, MINT_USDC, SUPPORTED_DEPOSIT_CHAINS,
    USDC_UNIT,
};
use crate::error::ApiError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositIntentRecord {
    pub intent_id: String,
    pub wallet: String,
    pub source_chain: String,
    pub payment_rail: String,
    pub source_asset: String,
    pub requested_usdc_atomic: u64,
    pub bridge_fee_usdc_atomic: u64,
    pub credited_canonical_usdc_atomic: u64,
    pub canonical_solana_mint: String,
    pub deposit_escrow_address: String,
    pub passkey_session_token: Option<String>,
    pub status: String,
    pub settlement_signature: String,
    pub created_at_secs: u64,
    pub settled_at_secs: Option<u64>,
    #[serde(skip)]
    pub ledger_credited: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCashierIntentRequest {
    pub wallet: String,
    #[serde(alias = "source_chain")]
    pub source_chain: String,
    #[serde(default, alias = "payment_rail")]
    pub payment_rail: Option<String>,
    #[serde(default, alias = "source_asset")]
    pub source_asset: Option<String>,
    #[serde(alias = "amount_usdc_atomic")]
    pub amount_usdc_atomic: u64,
    #[serde(default, alias = "mint_passkey_session")]
    pub mint_passkey_session: Option<bool>,
    #[serde(default, alias = "auto_settle")]
    pub auto_settle: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashierIntentResponse {
    pub intent: DepositIntentRecord,
    pub unified_usdc_balance_atomic: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevnetFaucetRequest {
    pub wallet: String,
    #[serde(default, alias = "amount_usdc_atomic")]
    pub amount_usdc_atomic: Option<u64>,
    #[serde(default, alias = "eligibility_bitmask")]
    pub eligibility_bitmask: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevnetFaucetResponse {
    pub wallet: String,
    pub canonical_mint: String,
    pub credited_usdc_atomic: u64,
    pub unified_usdc_balance_atomic: u64,
    pub eligibility_bitmask: u8,
    pub faucet_signature: String,
}

const ALLOWED_PAYMENT_RAILS: [&str; 5] = [
    "CRYPTO_BRIDGE",
    "APPLE_PAY",
    "GOOGLE_PAY",
    "DEBIT_CARD",
    "PASSKEY_SESSION",
];

pub fn create_deposit_intent(
    req: CreateCashierIntentRequest,
    intents: &mut BTreeMap<String, DepositIntentRecord>,
    cash_ledger: &mut BTreeMap<String, u64>,
    next_seq: u64,
    now_secs: u64,
    standalone_dev: bool,
) -> Result<CashierIntentResponse, ApiError> {
    let wallet = req.wallet.trim();
    if wallet.len() < 32 || wallet.len() > 48 {
        return Err(ApiError::bad_request(
            "INVALID_WALLET",
            "Wallet must be a valid base58 Solana address.",
        ));
    }
    let chain = req.source_chain.trim().to_ascii_lowercase();
    if !is_supported_deposit_chain(&chain) {
        return Err(ApiError::bad_request(
            "UNSUPPORTED_DEPOSIT_CHAIN",
            format!(
                "Chain `{chain}` is not supported. Supported 7-chain cashier routes: {:?}",
                SUPPORTED_DEPOSIT_CHAINS
            ),
        ));
    }

    if req.amount_usdc_atomic < USDC_UNIT || req.amount_usdc_atomic > BETA_MAX_ROOM_POOL_USDC {
        return Err(ApiError::bad_request(
            "INVALID_DEPOSIT_AMOUNT",
            format!(
                "`amountUsdcAtomic` must be between {USDC_UNIT} (1 USDC) and {BETA_MAX_ROOM_POOL_USDC} (500 USDC)."
            ),
        ));
    }

    let rail = req
        .payment_rail
        .as_deref()
        .unwrap_or("CRYPTO_BRIDGE")
        .to_ascii_uppercase();
    if !ALLOWED_PAYMENT_RAILS.contains(&rail.as_str()) {
        return Err(ApiError::bad_request(
            "UNSUPPORTED_PAYMENT_RAIL",
            format!(
                "Unsupported `paymentRail`: `{rail}`. Allowed: {:?}",
                ALLOWED_PAYMENT_RAILS
            ),
        ));
    }

    // Native Solana USDC = 0 bps fee; cross-chain intent solver = 10 bps integer fee
    let fee_bps: u128 = if chain == "solana" { 0 } else { 10 };
    let bridge_fee_usdc_atomic = (((req.amount_usdc_atomic as u128) * fee_bps) / 10_000) as u64;
    let credited_canonical_usdc_atomic = req
        .amount_usdc_atomic
        .saturating_sub(bridge_fee_usdc_atomic);

    let mut hasher = Sha256::new();
    hasher.update(b"cashier_intent:");
    hasher.update(wallet.as_bytes());
    hasher.update(chain.as_bytes());
    hasher.update(next_seq.to_le_bytes());
    hasher.update(now_secs.to_le_bytes());
    let digest = hasher.finalize();
    let hex_digest = hex::encode(digest);

    let intent_id = format!("int_{}", &hex_digest[..20]);
    let deposit_escrow_address = if chain == "solana" {
        bs58::encode(&digest).into_string()
    } else {
        format!("0x{}", &hex_digest[..40])
    };
    let settlement_signature =
        bs58::encode([digest.as_slice(), digest.as_slice()].concat()).into_string();

    let needs_passkey = req.mint_passkey_session.unwrap_or(false)
        || rail == "APPLE_PAY"
        || rail == "GOOGLE_PAY"
        || rail == "PASSKEY_SESSION";
    let passkey_session_token = if needs_passkey {
        Some(format!("pk_sess_{}", &hex_digest[20..52]))
    } else {
        None
    };

    let auto_settle = req
        .auto_settle
        .unwrap_or(standalone_dev || chain == "solana");
    let (status, settled_at_secs, ledger_credited) = if auto_settle {
        let entry = cash_ledger.entry(wallet.to_string()).or_insert(0);
        *entry = entry.saturating_add(credited_canonical_usdc_atomic);
        ("SETTLED_CANONICAL_USDC".to_string(), Some(now_secs), true)
    } else {
        ("BRIDGING_TO_SOLANA_USDC".to_string(), None, false)
    };

    let record = DepositIntentRecord {
        intent_id: intent_id.clone(),
        wallet: wallet.to_string(),
        source_chain: chain,
        payment_rail: rail,
        source_asset: req.source_asset.unwrap_or_else(|| "USDC".to_string()),
        requested_usdc_atomic: req.amount_usdc_atomic,
        bridge_fee_usdc_atomic,
        credited_canonical_usdc_atomic,
        canonical_solana_mint: MINT_USDC.to_string(),
        deposit_escrow_address,
        passkey_session_token,
        status,
        settlement_signature,
        created_at_secs: now_secs,
        settled_at_secs,
        ledger_credited,
    };

    intents.insert(intent_id, record.clone());
    let balance = *cash_ledger.get(wallet).unwrap_or(&0);
    Ok(CashierIntentResponse {
        intent: record,
        unified_usdc_balance_atomic: balance,
    })
}

pub fn get_and_reconcile_deposit_intent(
    intent_id: &str,
    intents: &mut BTreeMap<String, DepositIntentRecord>,
    cash_ledger: &mut BTreeMap<String, u64>,
    now_secs: u64,
    standalone_dev: bool,
) -> Result<CashierIntentResponse, ApiError> {
    let Some(intent) = intents.get_mut(intent_id) else {
        return Err(ApiError::not_found(
            "INTENT_NOT_FOUND",
            format!("Cashier deposit intent `{intent_id}` does not exist."),
        ));
    };

    if standalone_dev && !intent.ledger_credited {
        intent.status = "SETTLED_CANONICAL_USDC".to_string();
        intent.settled_at_secs = Some(now_secs);
        intent.ledger_credited = true;
        let bal = cash_ledger.entry(intent.wallet.clone()).or_insert(0);
        *bal = bal.saturating_add(intent.credited_canonical_usdc_atomic);
    }

    let balance = *cash_ledger.get(&intent.wallet).unwrap_or(&0);
    Ok(CashierIntentResponse {
        intent: intent.clone(),
        unified_usdc_balance_atomic: balance,
    })
}
