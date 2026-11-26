//! Kora Gasless Paymaster & Co-Signer (`POST /v1/kora/sponsor`).
//! Enforces strict program allowlist, per-wallet 24h gas cap (`5_000_000` lamports),
//! exact integer micro-USDC reimbursement math, message byte verification, and Ed25519 co-signing.

use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::constants::{
    is_kora_allowlisted_program, KORA_ALLOWLISTED_PROGRAMS, KORA_DAILY_LAMPORTS_CAP,
    KORA_MIN_SPONSOR_LAMPORTS, MINT_USDC,
};
use crate::error::ApiError;
use crate::keypair::SolanaSigner;

#[derive(Debug, Clone, Default)]
pub struct WalletGasUsage {
    pub window_start_secs: u64,
    pub used_lamports: u64,
    pub sponsored_tx_count: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KoraSponsorRequest {
    pub wallet: String,
    /// Base64-encoded Solana transaction message bytes (or supply `transaction_base64`).
    #[serde(default, alias = "message_base64")]
    pub message_base64: Option<String>,
    /// Base64-encoded Solana wire transaction (compact-u16 signatures + message bytes).
    #[serde(default, alias = "transaction_base64", alias = "transaction")]
    pub transaction_base64: Option<String>,
    /// Invoked program IDs declared by client (verified against strict Kora allowlist).
    #[serde(default, alias = "program_ids")]
    pub program_ids: Vec<String>,
    /// Estimated transaction fee in lamports (minimum `5_000` lamports).
    #[serde(default, alias = "estimated_lamports", alias = "fee_lamports")]
    pub estimated_lamports: Option<u64>,
    /// Optional SHA-256 hex digest of the expected message bytes to prevent message tampering.
    #[serde(default, alias = "expected_message_sha256")]
    pub expected_message_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KoraSponsorResponse {
    pub sponsor_pubkey: String,
    pub wallet: String,
    pub sponsor_signature_base58: String,
    pub sponsor_signature_base64: String,
    pub signed_transaction_base64: String,
    pub message_sha256: String,
    pub fee_lamports: u64,
    pub reimbursement_micro_usdc: u64,
    pub fee_token_mint: String,
    pub daily_lamports_used: u64,
    pub daily_lamports_remaining: u64,
    pub daily_lamports_cap: u64,
    pub verified_program_ids: Vec<String>,
}

/// Computes exact integer micro-USDC (`10^6`) fee reimbursement from `lamports` (`10^-9` SOL)
/// and `sol_price8` (`10^8` USD per SOL):
/// `micro_usdc = ceil((lamports * sol_price8) / 10^11)`.
pub fn compute_reimbursement_micro_usdc(lamports: u64, sol_price8: i64) -> u64 {
    let price_u128 = sol_price8.max(1_000_000_000) as u128; // floor $10 SOL safety guard
    let numerator = (lamports as u128).saturating_mul(price_u128);
    let denom: u128 = 100_000_000_000; // 10^11
    let ceil_div = numerator.saturating_add(denom - 1) / denom;
    ceil_div.max(1) as u64
}

/// Decodes a Solana compact-u16 integer at the start of `bytes`, returning `(value, bytes_consumed)`.
fn decode_compact_u16(bytes: &[u8]) -> Option<(usize, usize)> {
    let b0 = *bytes.first()? as usize;
    if (b0 & 0x80) == 0 {
        return Some((b0, 1));
    }
    let b1 = *bytes.get(1)? as usize;
    if (b1 & 0x80) == 0 {
        return Some(((b0 & 0x7f) | (b1 << 7), 2));
    }
    let b2 = *bytes.get(2)? as usize;
    if (b2 & 0xFC) != 0 {
        return None;
    }
    Some(((b0 & 0x7f) | ((b1 & 0x7f) << 7) | (b2 << 14), 3))
}

fn encode_compact_u16(val: usize) -> Vec<u8> {
    let mut rem = val;
    let mut out = Vec::with_capacity(3);
    loop {
        let mut elem = (rem & 0x7f) as u8;
        rem >>= 7;
        if rem == 0 {
            out.push(elem);
            break;
        } else {
            elem |= 0x80;
            out.push(elem);
        }
    }
    out
}

/// Attempts to parse invoked static program IDs from a compiled legacy or v0 Solana transaction message.
fn try_extract_compiled_program_ids(msg: &[u8]) -> Option<Vec<String>> {
    if msg.len() < 4 {
        return None;
    }
    let (is_versioned, cursor_start) = if (msg[0] & 0x80) != 0 {
        let version = msg[0] & 0x7f;
        if version > 1 {
            return None;
        }
        (true, 1usize)
    } else {
        (false, 0usize)
    };

    // Header: num_required_signatures, num_readonly_signed, num_readonly_unsigned (3 bytes)
    if msg.len() < cursor_start + 3 {
        return None;
    }
    let mut pos = cursor_start + 3;

    // Static account keys
    let (num_keys, consumed) = decode_compact_u16(msg.get(pos..)?)?;
    pos += consumed;
    if num_keys == 0 || num_keys > 128 {
        return None;
    }
    let keys_byte_len = num_keys.checked_mul(32)?;
    let keys_slice = msg.get(pos..pos + keys_byte_len)?;
    let mut account_keys = Vec::with_capacity(num_keys);
    for chunk in keys_slice.chunks_exact(32) {
        account_keys.push(bs58::encode(chunk).into_string());
    }
    pos += keys_byte_len;

    // Recent blockhash (32 bytes)
    if msg.len() < pos + 32 {
        return None;
    }
    pos += 32;

    // Instructions
    let (num_ix, ix_consumed) = decode_compact_u16(msg.get(pos..)?)?;
    pos += ix_consumed;
    if num_ix == 0 || num_ix > 64 {
        return None;
    }

    let mut program_ids = Vec::with_capacity(num_ix);
    for _ in 0..num_ix {
        let prog_idx = *msg.get(pos)? as usize;
        pos += 1;
        let (num_accts, accts_c) = decode_compact_u16(msg.get(pos..)?)?;
        pos += accts_c;
        pos = pos.checked_add(num_accts)?;
        let (data_len, data_c) = decode_compact_u16(msg.get(pos..)?)?;
        pos += data_c;
        pos = pos.checked_add(data_len)?;
        if pos > msg.len() {
            return None;
        }
        // Only resolve static keys directly; if v0 LUT index >= account_keys.len(), reject unverified LUT program
        let prog_id = account_keys.get(prog_idx)?.clone();
        if !program_ids.contains(&prog_id) {
            program_ids.push(prog_id);
        }
    }

    if !is_versioned && pos != msg.len() {
        return None;
    }
    Some(program_ids)
}

/// Extracts `(existing_signatures, message_bytes)` from a Solana wire transaction, or treats input as raw message.
fn unpack_wire_tx_or_message(
    transaction_b64: Option<&str>,
    message_b64: Option<&str>,
) -> Result<(Vec<[u8; 64]>, Vec<u8>), ApiError> {
    if let Some(tx_str) = transaction_b64 {
        let raw = BASE64.decode(tx_str.trim()).map_err(|e| {
            ApiError::bad_request(
                "INVALID_BASE64_TX",
                format!("Invalid base64 transaction: {e}"),
            )
        })?;
        if raw.is_empty() || raw.len() > 4_096 {
            return Err(ApiError::bad_request(
                "INVALID_TX_LENGTH",
                "Transaction byte length must be within (0, 4096].",
            ));
        }
        if let Some((sig_count, consumed)) = decode_compact_u16(&raw) {
            let sig_bytes_total = sig_count.saturating_mul(64);
            if sig_count > 0 && sig_count <= 16 && raw.len() > consumed + sig_bytes_total {
                let mut sigs = Vec::with_capacity(sig_count);
                for chunk in raw[consumed..consumed + sig_bytes_total].chunks_exact(64) {
                    let mut arr = [0u8; 64];
                    arr.copy_from_slice(chunk);
                    sigs.push(arr);
                }
                let msg = raw[consumed + sig_bytes_total..].to_vec();
                return Ok((sigs, msg));
            }
        }
        // Treat as raw message bytes when no signature prefix present
        return Ok((Vec::new(), raw));
    }

    if let Some(msg_str) = message_b64 {
        let msg = BASE64.decode(msg_str.trim()).map_err(|e| {
            ApiError::bad_request(
                "INVALID_BASE64_MESSAGE",
                format!("Invalid base64 message bytes: {e}"),
            )
        })?;
        if msg.is_empty() || msg.len() > 4_096 {
            return Err(ApiError::bad_request(
                "INVALID_MESSAGE_LENGTH",
                "Message byte length must be within (0, 4096].",
            ));
        }
        return Ok((Vec::new(), msg));
    }

    Err(ApiError::bad_request(
        "MISSING_TRANSACTION_BYTES",
        "Provide `messageBase64` or `transactionBase64` for Kora co-signing.",
    ))
}

pub fn process_kora_sponsor(
    req: KoraSponsorRequest,
    sponsor_signer: &SolanaSigner,
    gas_ledger: &mut BTreeMap<String, WalletGasUsage>,
    sol_price8: i64,
    now_secs: u64,
) -> Result<KoraSponsorResponse, ApiError> {
    let wallet = req.wallet.trim();
    if wallet.len() < 32 || wallet.len() > 48 {
        return Err(ApiError::bad_request(
            "INVALID_WALLET",
            "Wallet must be a valid base58 Solana public key.",
        ));
    }
    let decoded_wallet = bs58::decode(wallet).into_vec().map_err(|_| {
        ApiError::bad_request("INVALID_WALLET_BASE58", "Wallet is not valid base58.")
    })?;
    if decoded_wallet.len() != 32 {
        return Err(ApiError::bad_request(
            "INVALID_WALLET_LEN",
            "Decoded wallet public key must be exactly 32 bytes.",
        ));
    }

    let (mut sigs, message_bytes) = unpack_wire_tx_or_message(
        req.transaction_base64.as_deref(),
        req.message_base64.as_deref(),
    )?;

    let mut hasher = Sha256::new();
    hasher.update(&message_bytes);
    let message_sha256 = hex::encode(hasher.finalize());

    if let Some(expected_hash) = req.expected_message_sha256.as_deref() {
        if !expected_hash.eq_ignore_ascii_case(&message_sha256) {
            return Err(ApiError::forbidden(
                "MESSAGE_DIGEST_MISMATCH",
                "Transaction message SHA-256 does not match expected issued order digest.",
            ));
        }
    }

    // Collect program IDs from both explicit declaration and compiled Solana message inspection
    let mut all_programs: Vec<String> = req
        .program_ids
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if let Some(compiled_progs) = try_extract_compiled_program_ids(&message_bytes) {
        for p in compiled_progs {
            if !all_programs.contains(&p) {
                all_programs.push(p);
            }
        }
    }

    if all_programs.is_empty() {
        return Err(ApiError::bad_request(
            "EMPTY_PROGRAM_LIST",
            "Transaction must declare or encode at least one target program ID.",
        ));
    }

    for prog in &all_programs {
        if !is_kora_allowlisted_program(prog) {
            return Err(ApiError::forbidden(
                "PROGRAM_NOT_ALLOWLISTED",
                format!(
                    "Program `{prog}` is rejected by CartridgeFi Kora paymaster allowlist. Allowed programs: {:?}",
                    KORA_ALLOWLISTED_PROGRAMS
                ),
            ));
        }
    }

    let fee_lamports = req
        .estimated_lamports
        .unwrap_or(KORA_MIN_SPONSOR_LAMPORTS)
        .max(KORA_MIN_SPONSOR_LAMPORTS);

    let usage = gas_ledger
        .entry(wallet.to_string())
        .or_insert_with(|| WalletGasUsage {
            window_start_secs: now_secs,
            used_lamports: 0,
            sponsored_tx_count: 0,
        });

    // Reset rolling 24-hour window after 86_400 seconds
    if now_secs.saturating_sub(usage.window_start_secs) >= 86_400 {
        usage.window_start_secs = now_secs;
        usage.used_lamports = 0;
        usage.sponsored_tx_count = 0;
    }

    let next_used = usage.used_lamports.saturating_add(fee_lamports);
    if next_used > KORA_DAILY_LAMPORTS_CAP {
        return Err(ApiError::rate_limited(
            "DAILY_GAS_CAP_EXCEEDED",
            format!(
                "Wallet `{wallet}` exceeded Kora daily sponsorship cap of {KORA_DAILY_LAMPORTS_CAP} lamports/24h (used {}, requested {fee_lamports}).",
                usage.used_lamports
            ),
        ));
    }

    usage.used_lamports = next_used;
    usage.sponsored_tx_count = usage.sponsored_tx_count.saturating_add(1);
    let daily_remaining = KORA_DAILY_LAMPORTS_CAP.saturating_sub(usage.used_lamports);

    let reimbursement_micro_usdc = compute_reimbursement_micro_usdc(fee_lamports, sol_price8);

    // Co-sign exact message bytes with Kora sponsor Ed25519 keypair
    let sponsor_sig = sponsor_signer.sign_message(&message_bytes);
    let sponsor_sig_b58 = bs58::encode(sponsor_sig).into_string();
    let sponsor_sig_b64 = BASE64.encode(sponsor_sig);

    if sigs.is_empty() {
        sigs.push(sponsor_sig);
    } else {
        sigs[0] = sponsor_sig;
    }

    let mut wire_bytes = encode_compact_u16(sigs.len());
    for s in &sigs {
        wire_bytes.extend_from_slice(s);
    }
    wire_bytes.extend_from_slice(&message_bytes);
    let signed_transaction_base64 = BASE64.encode(&wire_bytes);

    Ok(KoraSponsorResponse {
        sponsor_pubkey: sponsor_signer.pubkey_base58().to_string(),
        wallet: wallet.to_string(),
        sponsor_signature_base58: sponsor_sig_b58,
        sponsor_signature_base64: sponsor_sig_b64,
        signed_transaction_base64,
        message_sha256,
        fee_lamports,
        reimbursement_micro_usdc,
        fee_token_mint: MINT_USDC.to_string(),
        daily_lamports_used: usage.used_lamports,
        daily_lamports_remaining: daily_remaining,
        daily_lamports_cap: KORA_DAILY_LAMPORTS_CAP,
        verified_program_ids: all_programs,
    })
}
