#![forbid(unsafe_code)]

use std::path::PathBuf;

use borsh::{BorshDeserialize, BorshSerialize};
use magicsvm::{MagicSVM, TransactionTarget};
use solana_account::Account;
use solana_address::{address, Address};
use solana_clock::Clock;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_rent::Rent;
use solana_sdk_ids::{system_program, sysvar::slot_hashes};
use solana_sha256_hasher::hash;
use solana_signer::Signer;
use solana_system_interface::instruction as system_ix;
use solana_transaction::Transaction;

pub const SCALE: i128 = 1_000_000_000;
pub const BPS_DENOM: u128 = 10_000;
pub const SHAPLEY_WEIGHT_BASE: u128 = 2_520_000;
pub const PARTNER_WALLET_SHARE_BPS: u128 = 4_000;
pub const PARTNER_CREATOR_SHARE_BPS: u128 = 3_000;
pub const MAX_TOTAL_FEE_BPS: u16 = 1_000;
pub const MAX_CREATOR_SHARE_BPS: u16 = 5_000;

pub const BETA_MAX_ROOM_POOL_USDC: u64 = 500_000_000;
pub const BETA_MAX_GLOBAL_TVL_USDC: u64 = 5_000_000_000;

pub const BIT_GEO_ELIGIBLE: u8 = 1;
pub const BIT_CAN_CLAIM_XSTOCKS: u8 = 2;
pub const BIT_SYBIL_VERIFIED: u8 = 4;

pub const CARTRIDGE_REGISTRY_ID: Address = address!("5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr");
pub const CARTRIDGE_ER_ROOM_ID: Address = address!("Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR");
pub const CARTRIDGE_VAULT_ROUTER_ID: Address =
    address!("6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT");
pub const CARTRIDGE_PASSPORT_ID: Address = address!("5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr");

pub const DELEGATION_PROGRAM_ID: Address = address!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
pub const PERMISSION_PROGRAM_ID: Address = address!("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
pub const MAGIC_PROGRAM_ID: Address = address!("Magic11111111111111111111111111111111111111");
pub const MAGIC_CONTEXT_ID: Address = address!("MagicContext1111111111111111111111111111111");
pub const EPHEMERAL_VAULT_ID: Address = address!("MagicVau1t999999999999999999999999999999999");
pub const CRANK_PROGRAM_ID: Address = address!("Crank11111111111111111111111111111111111111");
pub const VRF_PROGRAM_ID: Address = address!("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
pub const DEFAULT_EPHEMERAL_QUEUE: Address =
    address!("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
pub const PRICING_ORACLE_PROGRAM_ID: Address =
    address!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
pub const TOKEN_PROGRAM_ID: Address = address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

pub const CANONICAL_NVDAX_MINT: Address = address!("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
pub const CANONICAL_SPYX_MINT: Address = address!("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
pub const CANONICAL_ANTX_MINT: Address = address!("XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb");

pub const SEED_ENGINE_CONFIG: &[u8] = b"engine_config";
pub const SEED_CARTRIDGE: &[u8] = b"cartridge";
pub const SEED_VAULT_ROUTER_AUTH: &[u8] = b"vault_router_auth";
pub const SEED_ROOM_SHARD: &[u8] = b"room_shard";
pub const SEED_PLAYER_STANCE: &[u8] = b"player_stance";
pub const SEED_ROOM_VAULT: &[u8] = b"room_vault";
pub const SEED_ROOM_VAULT_TOKEN: &[u8] = b"room_vault_token";
pub const SEED_SESSION_ENVELOPE: &[u8] = b"session_envelope";
pub const SEED_PASSPORT_CONFIG: &[u8] = b"passport_config";
pub const SEED_PASSPORT: &[u8] = b"passport";
pub const PERMISSION_SEED: &[u8] = b"permission:";

pub fn anchor_discriminator(namespace: &str, name: &str) -> [u8; 8] {
    let preimage = format!("{namespace}:{name}");
    let digest = hash(preimage.as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&digest.to_bytes()[..8]);
    out
}

pub fn slug_hash(slug: &str) -> [u8; 32] {
    hash(slug.as_bytes()).to_bytes()
}

pub fn pad_uri(uri: &str) -> [u8; 96] {
    let mut buf = [0u8; 96];
    let bytes = uri.as_bytes();
    let copy_len = bytes.len().min(96);
    buf[..copy_len].copy_from_slice(&bytes[..copy_len]);
    buf
}

// ============================================================================
// Borsh Wire Types Matching Frozen Program IDLs
// ============================================================================

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ScoringFormula {
    DirectionNeutralRelReturn,
    DrawdownPenalizedSharpe,
    KalshiBrierCalibration,
    MultiStageCarryComposite,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ActionBindingMode {
    ConvictionWeights,
    ThreeLaneStance,
    SectorTurf,
    MultiStageCarry,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct RegisterCartridgeArgs {
    pub slug_hash: [u8; 32],
    pub creator_share_bps: u16,
    pub genre_code: u8,
    pub duration_secs: u32,
    pub fog_of_war_bps: u16,
    pub max_rebalances: u16,
    pub scoring_formula: ScoringFormula,
    pub action_binding_mode: ActionBindingMode,
    pub allowed_feeds_merkle_root: [u8; 32],
    pub manifest_uri: [u8; 96],
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct EngineConfig {
    pub admin_multisig: Address,
    pub platform_fee_account: Address,
    pub private_beta_mode: bool,
    pub max_room_pool_usdc: u64,
    pub max_global_tvl_usdc: u64,
    pub current_global_tvl_usdc: u64,
    pub paused: bool,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct CartridgeManifestAccount {
    pub slug_hash: [u8; 32],
    pub creator: Address,
    pub creator_fee_vault: Address,
    pub creator_share_bps: u16,
    pub genre_code: u8,
    pub duration_secs: u32,
    pub fog_of_war_bps: u16,
    pub max_rebalances: u16,
    pub scoring_formula: ScoringFormula,
    pub action_binding_mode: ActionBindingMode,
    pub allowed_feeds_merkle_root: [u8; 32],
    pub manifest_uri: [u8; 96],
    pub total_rooms_created: u64,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoomPhase {
    LobbyOpen,
    FogOfWar,
    Showdown,
    SettledCommitted,
    RetryGrace,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct InitializeRoomShardArgs {
    pub event_id: [u8; 32],
    pub shard_index: u16,
    pub start_ts: i64,
    pub room_pool_usdc: u64,
    pub crank_task_id: i64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct SubmitStanceArgs {
    pub weights_bps: [i16; 4],
    pub kalshi_binary_call: u8,
    pub kalshi_prob_bps: u16,
    pub secondary_prices_8: [i64; 3],
    pub stage1_score_scaled: i64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct EvaluateScoreArgs {
    pub secondary_exit_prices_8: [i64; 3],
    pub beta_bench_scaled: i128,
    pub lambda_dd_scaled: i128,
    pub kalshi_outcome_yes: u8,
    pub max_multiplier_scaled: i128,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct ActionAccountSpec {
    pub pubkey: Address,
    pub is_writable: bool,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct SettleShardArgs {
    pub schedule_vault_action: bool,
    pub vault_action_accounts: Vec<ActionAccountSpec>,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RoomShard {
    pub event_id: [u8; 32],
    pub shard_index: u16,
    pub cartridge_manifest: Address,
    pub authority: Address,
    pub phase: RoomPhase,
    pub scoring_formula: u8,
    pub action_binding_mode: u8,
    pub max_rebalances: u16,
    pub is_private_fog: bool,
    pub player_count: u16,
    pub evaluated_count: u16,
    pub start_ts: i64,
    pub unseal_ts: i64,
    pub end_ts: i64,
    pub room_pool_usdc: u64,
    pub crank_task_id: i64,
    pub vrf_request_nonce: u64,
    pub vrf_seed: [u8; 32],
    pub vrf_fulfilled: bool,
    pub kalshi_outcome_yes: u8,
    pub settlement_prices_8: [i64; 4],
    pub public_rank_digest: [u8; 32],
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct PlayerStance {
    pub room_shard: Address,
    pub player: Address,
    pub ephemeral_session_key: Address,
    pub session_expiry_ts: i64,
    pub last_move_ts: i64,
    pub move_count: u16,
    pub weights_bps: [i16; 4],
    pub kalshi_binary_call: u8,
    pub kalshi_prob_bps: u16,
    pub entry_prices_8: [i64; 4],
    pub step_returns_scaled: [i64; 8],
    pub step_count: u8,
    pub max_drawdown_scaled: i64,
    pub stage1_score_scaled: i64,
    pub final_score_scaled: i128,
    pub joined_er: bool,
    pub evaluated: bool,
    pub rank: u16,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RoomVault {
    pub room_shard: Address,
    pub authority: Address,
    pub usdc_mint: Address,
    pub vault_usdc_token: Address,
    pub cartridge_manifest: Address,
    pub creator_fee_vault: Address,
    pub platform_fee_account: Address,
    pub partner_fee_vault: Address,
    pub partner_wallet_active: bool,
    pub creator_share_bps: u16,
    pub total_fee_bps: u16,
    pub room_pool_usdc: u64,
    pub total_distributed_usdc: u64,
    pub total_claimed_usdc: u64,
    pub settled: bool,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct SessionRiskEnvelope {
    pub room_shard: Address,
    pub player: Address,
    pub ephemeral_session_key: Address,
    pub principal_usdc: u64,
    pub leverage: u8,
    pub payout_usdc: u64,
    pub rank: u16,
    pub settled: bool,
    pub claimed: bool,
    pub claimed_mint: Address,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AssetCreditKind {
    Usdc,
    Nvdax,
    Spyx,
    Antx,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct RecordEloArgs {
    pub room_mean_elo_scaled: i128,
    pub placement_score_scaled: i128,
    pub is_live_mode: bool,
    pub is_win: bool,
    pub sharpe_score_scaled: Option<i128>,
    pub brier_score_scaled: Option<i128>,
    pub asset_credit_kind: AssetCreditKind,
    pub asset_credit_units: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct MarketPassport {
    pub owner: Address,
    pub elo_scaled: i128,
    pub eligibility_bitmask: u8,
    pub matches_played: u32,
    pub wins_count: u32,
    pub best_sharpe_scaled: i128,
    pub best_brier_scaled: i128,
    pub earned_nvda_units: u64,
    pub earned_spy_units: u64,
    pub earned_ant_units: u64,
    pub earned_usdc_units: u64,
    pub bump: u8,
}

pub fn decode_anchor_account<T: BorshDeserialize>(account: &Account, type_name: &str) -> T {
    let expected_disc = anchor_discriminator("account", type_name);
    assert!(
        account.data.len() >= 8 && account.data[..8] == expected_disc,
        "invalid Anchor discriminator for {type_name}"
    );
    let mut slice = &account.data[8..];
    T::deserialize(&mut slice).unwrap_or_else(|e| panic!("failed to decode {type_name}: {e}"))
}

// ============================================================================
// PDA Derivations
// ============================================================================

pub fn engine_config_pda() -> (Address, u8) {
    Address::find_program_address(&[SEED_ENGINE_CONFIG], &CARTRIDGE_REGISTRY_ID)
}

pub fn cartridge_manifest_pda(slug: &[u8; 32]) -> (Address, u8) {
    Address::find_program_address(&[SEED_CARTRIDGE, slug.as_ref()], &CARTRIDGE_REGISTRY_ID)
}

pub fn vault_router_auth_pda() -> (Address, u8) {
    Address::find_program_address(&[SEED_VAULT_ROUTER_AUTH], &CARTRIDGE_VAULT_ROUTER_ID)
}

pub fn room_shard_pda(event_id: &[u8; 32], shard_index: u16) -> (Address, u8) {
    Address::find_program_address(
        &[
            SEED_ROOM_SHARD,
            event_id.as_ref(),
            &shard_index.to_le_bytes(),
        ],
        &CARTRIDGE_ER_ROOM_ID,
    )
}

pub fn player_stance_pda(room_shard: &Address, player: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[SEED_PLAYER_STANCE, room_shard.as_ref(), player.as_ref()],
        &CARTRIDGE_ER_ROOM_ID,
    )
}

pub fn permission_pda(permissioned_account: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[PERMISSION_SEED, permissioned_account.as_ref()],
        &PERMISSION_PROGRAM_ID,
    )
}

pub fn crank_signer_pda(authority: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"crank-executor", authority.as_ref()], &CRANK_PROGRAM_ID)
}

pub fn vrf_program_identity_pda(program_id: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"identity"], program_id)
}

pub fn scoped_vrf_identity_pda(program_id: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"identity", program_id.as_ref()], &VRF_PROGRAM_ID)
}

pub fn room_vault_pda(room_shard: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[SEED_ROOM_VAULT, room_shard.as_ref()],
        &CARTRIDGE_VAULT_ROUTER_ID,
    )
}

pub fn room_vault_token_pda(room_shard: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[SEED_ROOM_VAULT_TOKEN, room_shard.as_ref()],
        &CARTRIDGE_VAULT_ROUTER_ID,
    )
}

pub fn session_envelope_pda(room_shard: &Address, player: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[SEED_SESSION_ENVELOPE, room_shard.as_ref(), player.as_ref()],
        &CARTRIDGE_VAULT_ROUTER_ID,
    )
}

pub fn passport_config_pda() -> (Address, u8) {
    Address::find_program_address(&[SEED_PASSPORT_CONFIG], &CARTRIDGE_PASSPORT_ID)
}

pub fn market_passport_pda(owner: &Address) -> (Address, u8) {
    Address::find_program_address(&[SEED_PASSPORT, owner.as_ref()], &CARTRIDGE_PASSPORT_ID)
}

pub fn delegation_buffer_pda(pda: &Address, owner_program: &Address) -> Address {
    Address::find_program_address(&[b"buffer", pda.as_ref()], owner_program).0
}

pub fn delegation_record_pda(pda: &Address) -> Address {
    Address::find_program_address(&[b"delegation", pda.as_ref()], &DELEGATION_PROGRAM_ID).0
}

pub fn delegation_metadata_pda(pda: &Address) -> Address {
    Address::find_program_address(
        &[b"delegation-metadata", pda.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0
}

// ============================================================================
// Instruction Builders
// ============================================================================

fn encode_ix<T: BorshSerialize>(name: &str, payload: &T) -> Vec<u8> {
    let mut data = anchor_discriminator("global", name).to_vec();
    payload.serialize(&mut data).expect("borsh serialize ix");
    data
}

pub fn ix_initialize_engine_config(
    admin_multisig: Address,
    platform_fee_account: Address,
    private_beta_mode: bool,
    max_room_pool_usdc: u64,
    max_global_tvl_usdc: u64,
) -> Instruction {
    let (engine_config, _) = engine_config_pda();
    let data = encode_ix(
        "initialize_engine_config",
        &(private_beta_mode, max_room_pool_usdc, max_global_tvl_usdc),
    );
    Instruction {
        program_id: CARTRIDGE_REGISTRY_ID,
        accounts: vec![
            AccountMeta::new(admin_multisig, true),
            AccountMeta::new_readonly(platform_fee_account, false),
            AccountMeta::new(engine_config, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

pub fn ix_register_cartridge(
    creator: Address,
    creator_fee_vault: Address,
    args: &RegisterCartridgeArgs,
) -> Instruction {
    let (engine_config, _) = engine_config_pda();
    let (cartridge_manifest, _) = cartridge_manifest_pda(&args.slug_hash);
    Instruction {
        program_id: CARTRIDGE_REGISTRY_ID,
        accounts: vec![
            AccountMeta::new(creator, true),
            AccountMeta::new_readonly(creator_fee_vault, false),
            AccountMeta::new_readonly(engine_config, false),
            AccountMeta::new(cartridge_manifest, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode_ix("register_cartridge", args),
    }
}

pub fn ix_initialize_room_shard(
    authority: Address,
    cartridge_manifest: Address,
    args: &InitializeRoomShardArgs,
) -> Instruction {
    let (room_shard, _) = room_shard_pda(&args.event_id, args.shard_index);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(cartridge_manifest, false),
            AccountMeta::new(room_shard, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode_ix("initialize_room_shard", args),
    }
}

pub fn ix_delegate_room_shard(
    authority: Address,
    event_id: [u8; 32],
    shard_index: u16,
    validator: Option<Address>,
) -> Instruction {
    let (room_shard, _) = room_shard_pda(&event_id, shard_index);
    let buffer = delegation_buffer_pda(&room_shard, &CARTRIDGE_ER_ROOM_ID);
    let record = delegation_record_pda(&room_shard);
    let metadata = delegation_metadata_pda(&room_shard);
    let validator_meta =
        AccountMeta::new_readonly(validator.unwrap_or(CARTRIDGE_ER_ROOM_ID), false);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(buffer, false),
            AccountMeta::new(record, false),
            AccountMeta::new(metadata, false),
            AccountMeta::new(room_shard, false),
            validator_meta,
            AccountMeta::new_readonly(CARTRIDGE_ER_ROOM_ID, false),
            AccountMeta::new_readonly(DELEGATION_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode_ix("delegate_room_shard", &(event_id, shard_index)),
    }
}

pub fn ix_init_stance_and_delegate(
    player: Address,
    room_shard: Address,
    ephemeral_session_key: Address,
    session_expiry_ts: i64,
    validator: Option<Address>,
) -> Instruction {
    let (player_stance, _) = player_stance_pda(&room_shard, &player);
    let buffer = delegation_buffer_pda(&player_stance, &CARTRIDGE_ER_ROOM_ID);
    let record = delegation_record_pda(&player_stance);
    let metadata = delegation_metadata_pda(&player_stance);
    let validator_meta =
        AccountMeta::new_readonly(validator.unwrap_or(CARTRIDGE_ER_ROOM_ID), false);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(player, true),
            AccountMeta::new_readonly(room_shard, false),
            AccountMeta::new(buffer, false),
            AccountMeta::new(record, false),
            AccountMeta::new(metadata, false),
            AccountMeta::new(player_stance, false),
            validator_meta,
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(CARTRIDGE_ER_ROOM_ID, false),
            AccountMeta::new_readonly(DELEGATION_PROGRAM_ID, false),
        ],
        data: encode_ix(
            "init_stance_and_delegate",
            &(ephemeral_session_key, session_expiry_ts),
        ),
    }
}

pub fn ix_join_room_and_init_permission(
    payer: Address,
    room_shard: Address,
    player_stance: Address,
) -> Instruction {
    let (permission, _) = permission_pda(&player_stance);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(room_shard, false),
            AccountMeta::new(player_stance, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(PERMISSION_PROGRAM_ID, false),
            AccountMeta::new(EPHEMERAL_VAULT_ID, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
        ],
        data: anchor_discriminator("global", "join_room_and_init_permission").to_vec(),
    }
}

pub fn ix_schedule_room_crank(
    authority: Address,
    room_shard: Address,
    task_id: i64,
    execution_interval_millis: i64,
    iterations: i64,
) -> Instruction {
    let (crank_signer, _) = crank_signer_pda(&authority);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(room_shard, false),
            AccountMeta::new_readonly(crank_signer, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
        ],
        data: encode_ix(
            "schedule_room_crank",
            &(task_id, execution_interval_millis, iterations),
        ),
    }
}

pub fn ix_crank_tick_room(crank_signer: Address, room_shard: Address) -> Instruction {
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new_readonly(crank_signer, true),
            AccountMeta::new(room_shard, false),
        ],
        data: anchor_discriminator("global", "crank_tick_room").to_vec(),
    }
}

pub fn ix_submit_stance(
    session_signer: Address,
    room_shard: Address,
    player_stance: Address,
    oracle_feed: Address,
    args: &SubmitStanceArgs,
) -> Instruction {
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new_readonly(session_signer, true),
            AccountMeta::new(room_shard, false),
            AccountMeta::new(player_stance, false),
            AccountMeta::new_readonly(oracle_feed, false),
        ],
        data: encode_ix("submit_stance", args),
    }
}

pub fn ix_trigger_showdown_unseal(
    authority: Address,
    room_shard: Address,
    player_stance: Address,
) -> Instruction {
    let (permission, _) = permission_pda(&player_stance);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(room_shard, false),
            AccountMeta::new(player_stance, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(PERMISSION_PROGRAM_ID, false),
            AccountMeta::new(EPHEMERAL_VAULT_ID, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
        ],
        data: anchor_discriminator("global", "trigger_showdown_unseal").to_vec(),
    }
}

pub fn ix_request_settlement_vrf(
    authority: Address,
    room_shard: Address,
    oracle_queue: Address,
    client_seed: u8,
) -> Instruction {
    let (program_identity, _) = vrf_program_identity_pda(&CARTRIDGE_ER_ROOM_ID);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(room_shard, false),
            AccountMeta::new(oracle_queue, false),
            AccountMeta::new_readonly(program_identity, false),
            AccountMeta::new_readonly(VRF_PROGRAM_ID, false),
            AccountMeta::new_readonly(slot_hashes::ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode_ix("request_settlement_vrf", &client_seed),
    }
}

pub fn ix_callback_settlement_vrf_spoofed(
    fake_vrf_identity: Address,
    room_shard: Address,
    randomness: [u8; 32],
    request_nonce: u64,
) -> Instruction {
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new_readonly(fake_vrf_identity, true),
            AccountMeta::new(room_shard, false),
        ],
        data: encode_ix("callback_settlement_vrf", &(randomness, request_nonce)),
    }
}

pub fn ix_evaluate_player_score(
    authority: Address,
    room_shard: Address,
    player_stance: Address,
    oracle_feed: Address,
    args: &EvaluateScoreArgs,
) -> Instruction {
    let (permission, _) = permission_pda(&player_stance);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(room_shard, false),
            AccountMeta::new(player_stance, false),
            AccountMeta::new_readonly(oracle_feed, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(PERMISSION_PROGRAM_ID, false),
            AccountMeta::new(EPHEMERAL_VAULT_ID, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
        ],
        data: encode_ix("evaluate_player_score", args),
    }
}

pub fn ix_undelegate_player_stance(
    authority: Address,
    room_shard: Address,
    player_stance: Address,
) -> Instruction {
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(room_shard, false),
            AccountMeta::new(player_stance, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
        ],
        data: anchor_discriminator("global", "undelegate_player_stance").to_vec(),
    }
}

pub fn ix_settle_and_commit_shard(
    authority: Address,
    room_shard: Address,
    oracle_feed: Address,
    args: &SettleShardArgs,
) -> Instruction {
    let (permission, _) = permission_pda(&room_shard);
    Instruction {
        program_id: CARTRIDGE_ER_ROOM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(room_shard, false),
            AccountMeta::new_readonly(oracle_feed, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(PERMISSION_PROGRAM_ID, false),
            AccountMeta::new(EPHEMERAL_VAULT_ID, false),
            AccountMeta::new_readonly(CARTRIDGE_VAULT_ROUTER_ID, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
        ],
        data: encode_ix("settle_and_commit_shard", args),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn ix_initialize_room_vault(
    authority: Address,
    room_shard: Address,
    cartridge_manifest: Address,
    usdc_mint: Address,
    platform_fee_account: Address,
    creator_fee_vault: Address,
    partner_fee_vault: Option<Address>,
    total_fee_bps: u16,
    partner_wallet_active: bool,
) -> Instruction {
    let (engine_config, _) = engine_config_pda();
    let (room_vault, _) = room_vault_pda(&room_shard);
    let (vault_usdc_token, _) = room_vault_token_pda(&room_shard);
    let partner_meta = AccountMeta::new_readonly(
        partner_fee_vault.unwrap_or(CARTRIDGE_VAULT_ROUTER_ID),
        false,
    );
    Instruction {
        program_id: CARTRIDGE_VAULT_ROUTER_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(room_shard, false),
            AccountMeta::new_readonly(engine_config, false),
            AccountMeta::new_readonly(cartridge_manifest, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new(room_vault, false),
            AccountMeta::new(vault_usdc_token, false),
            AccountMeta::new_readonly(platform_fee_account, false),
            AccountMeta::new_readonly(creator_fee_vault, false),
            partner_meta,
            AccountMeta::new_readonly(CARTRIDGE_REGISTRY_ID, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode_ix(
            "initialize_room_vault",
            &(total_fee_bps, partner_wallet_active),
        ),
    }
}

pub fn ix_open_session_envelope(
    player_signer: Address,
    room_shard: Address,
    usdc_mint: Address,
    player_usdc_ata: Address,
    principal_usdc: u64,
    leverage: u8,
    ephemeral_session_key: Address,
) -> Instruction {
    let (engine_config, _) = engine_config_pda();
    let (room_vault, _) = room_vault_pda(&room_shard);
    let (vault_usdc_token, _) = room_vault_token_pda(&room_shard);
    let (session_envelope, _) = session_envelope_pda(&room_shard, &player_signer);
    let (vault_router_auth, _) = vault_router_auth_pda();
    Instruction {
        program_id: CARTRIDGE_VAULT_ROUTER_ID,
        accounts: vec![
            AccountMeta::new(player_signer, true),
            AccountMeta::new(engine_config, false),
            AccountMeta::new(room_vault, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new(vault_usdc_token, false),
            AccountMeta::new(player_usdc_ata, false),
            AccountMeta::new(session_envelope, false),
            AccountMeta::new_readonly(vault_router_auth, false),
            AccountMeta::new_readonly(CARTRIDGE_REGISTRY_ID, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode_ix(
            "open_session_envelope",
            &(principal_usdc, leverage, ephemeral_session_key),
        ),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn ix_distribute_pool_and_fees(
    authority: Address,
    room_shard: Address,
    usdc_mint: Address,
    platform_fee_account: Address,
    creator_fee_vault: Address,
    partner_fee_vault: Option<Address>,
    stance_and_envelope_pairs: &[(Address, Address)],
) -> Instruction {
    let (engine_config, _) = engine_config_pda();
    let (room_vault, _) = room_vault_pda(&room_shard);
    let (vault_usdc_token, _) = room_vault_token_pda(&room_shard);
    let (vault_router_auth, _) = vault_router_auth_pda();
    let partner_meta = match partner_fee_vault {
        Some(pk) => AccountMeta::new(pk, false),
        None => AccountMeta::new_readonly(CARTRIDGE_VAULT_ROUTER_ID, false),
    };
    let mut accounts = vec![
        AccountMeta::new_readonly(authority, true),
        AccountMeta::new(room_vault, false),
        AccountMeta::new_readonly(room_shard, false),
        AccountMeta::new_readonly(usdc_mint, false),
        AccountMeta::new(vault_usdc_token, false),
        AccountMeta::new(platform_fee_account, false),
        AccountMeta::new(creator_fee_vault, false),
        partner_meta,
        AccountMeta::new(engine_config, false),
        AccountMeta::new_readonly(vault_router_auth, false),
        AccountMeta::new_readonly(CARTRIDGE_REGISTRY_ID, false),
        AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
    ];
    for (stance, env) in stance_and_envelope_pairs {
        accounts.push(AccountMeta::new_readonly(*stance, false));
        accounts.push(AccountMeta::new(*env, false));
    }
    Instruction {
        program_id: CARTRIDGE_VAULT_ROUTER_ID,
        accounts,
        data: anchor_discriminator("global", "distribute_pool_and_fees").to_vec(),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn ix_claim_prize(
    signer: Address,
    envelope_player: Address,
    room_shard: Address,
    usdc_mint: Address,
    desired_mint: Address,
    player_destination_ata: Address,
    xstock_reserve_token: Option<Address>,
    settlement_usdc_ata: Option<Address>,
    market_passport: Option<Address>,
    xstock_units_out: u64,
) -> Instruction {
    let (engine_config, _) = engine_config_pda();
    let (room_vault, _) = room_vault_pda(&room_shard);
    let (vault_usdc_token, _) = room_vault_token_pda(&room_shard);
    let (session_envelope, _) = session_envelope_pda(&room_shard, &envelope_player);
    let (vault_router_auth, _) = vault_router_auth_pda();

    let xstock_meta = match xstock_reserve_token {
        Some(pk) => AccountMeta::new(pk, false),
        None => AccountMeta::new_readonly(CARTRIDGE_VAULT_ROUTER_ID, false),
    };
    let settle_meta = match settlement_usdc_ata {
        Some(pk) => AccountMeta::new(pk, false),
        None => AccountMeta::new_readonly(CARTRIDGE_VAULT_ROUTER_ID, false),
    };
    let passport_meta =
        AccountMeta::new_readonly(market_passport.unwrap_or(CARTRIDGE_VAULT_ROUTER_ID), false);

    Instruction {
        program_id: CARTRIDGE_VAULT_ROUTER_ID,
        accounts: vec![
            AccountMeta::new_readonly(signer, true),
            AccountMeta::new(room_vault, false),
            AccountMeta::new(session_envelope, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new_readonly(desired_mint, false),
            AccountMeta::new(vault_usdc_token, false),
            AccountMeta::new(player_destination_ata, false),
            xstock_meta,
            settle_meta,
            passport_meta,
            AccountMeta::new(engine_config, false),
            AccountMeta::new_readonly(vault_router_auth, false),
            AccountMeta::new_readonly(CARTRIDGE_REGISTRY_ID, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        ],
        data: encode_ix("claim_prize", &xstock_units_out),
    }
}

pub fn ix_initialize_passport_config(admin: Address, keeper_authority: Address) -> Instruction {
    let (passport_config, _) = passport_config_pda();
    Instruction {
        program_id: CARTRIDGE_PASSPORT_ID,
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new(passport_config, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: encode_ix("initialize_passport_config", &keeper_authority),
    }
}

pub fn ix_initialize_passport(payer: Address, owner: Address) -> Instruction {
    let (passport, _) = market_passport_pda(&owner);
    Instruction {
        program_id: CARTRIDGE_PASSPORT_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(owner, true),
            AccountMeta::new(passport, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: anchor_discriminator("global", "initialize_passport").to_vec(),
    }
}

pub fn ix_update_eligibility_bitmask(
    authority: Address,
    owner: Address,
    eligibility_bitmask: u8,
) -> Instruction {
    let (passport_config, _) = passport_config_pda();
    let (passport, _) = market_passport_pda(&owner);
    Instruction {
        program_id: CARTRIDGE_PASSPORT_ID,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new_readonly(passport_config, false),
            AccountMeta::new(passport, false),
        ],
        data: encode_ix("update_eligibility_bitmask", &eligibility_bitmask),
    }
}

pub fn ix_record_elo_and_vault_credit(
    authority: Address,
    owner: Address,
    args: &RecordEloArgs,
) -> Instruction {
    let (passport_config, _) = passport_config_pda();
    let (passport, _) = market_passport_pda(&owner);
    Instruction {
        program_id: CARTRIDGE_PASSPORT_ID,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new_readonly(passport_config, false),
            AccountMeta::new(passport, false),
        ],
        data: encode_ix("record_elo_and_vault_credit", args),
    }
}

// ============================================================================
// SPL Token & Pyth PriceUpdateV3 Helpers
// ============================================================================

pub fn ix_spl_transfer_checked(
    source: Address,
    mint: Address,
    destination: Address,
    authority: Address,
    amount: u64,
    decimals: u8,
) -> Instruction {
    let mut data = Vec::with_capacity(10);
    data.push(12u8); // SPL Token TransferChecked
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(source, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(authority, true),
        ],
        data,
    }
}

pub fn make_spl_mint_account(mint_authority: &Address, supply: u64, decimals: u8) -> Account {
    let mut data = vec![0u8; 82];
    data[0..4].copy_from_slice(&1u32.to_le_bytes()); // COption::Some(mint_authority)
    data[4..36].copy_from_slice(mint_authority.as_ref());
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1; // is_initialized = true
    Account {
        lamports: Rent::default().minimum_balance(82),
        data,
        owner: TOKEN_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }
}

pub fn make_spl_token_account(mint: &Address, owner: &Address, amount: u64) -> Account {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1; // AccountState::Initialized
    Account {
        lamports: Rent::default().minimum_balance(165),
        data,
        owner: TOKEN_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }
}

pub fn read_spl_token_balance(account: &Account) -> u64 {
    assert!(
        account.owner == TOKEN_PROGRAM_ID && account.data.len() >= 72,
        "invalid SPL token account"
    );
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&account.data[64..72]);
    u64::from_le_bytes(bytes)
}

/// Builds a canonical Pyth Receiver / MagicBlock Pricing Oracle `PriceUpdateV3` account
/// (`VerificationLevel::Full = 1` at byte 40, message at byte 41..133).
pub fn make_pyth_oracle_account(
    price_8: i64,
    conf_8: u64,
    publish_time: i64,
    posted_slot: u64,
) -> Account {
    let mut data = vec![0u8; 134];
    data[0..8].copy_from_slice(&anchor_discriminator("account", "PriceUpdateV2"));
    data[40] = 1; // VerificationLevel::Full (1 byte)
    let msg_offset = 41usize;
    data[msg_offset..msg_offset + 32].copy_from_slice(&[0xAB; 32]); // feed_id
    data[msg_offset + 32..msg_offset + 40].copy_from_slice(&price_8.to_le_bytes());
    data[msg_offset + 40..msg_offset + 48].copy_from_slice(&conf_8.to_le_bytes());
    data[msg_offset + 48..msg_offset + 52].copy_from_slice(&(-8i32).to_le_bytes());
    data[msg_offset + 52..msg_offset + 60].copy_from_slice(&publish_time.to_le_bytes());
    data[msg_offset + 60..msg_offset + 68]
        .copy_from_slice(&publish_time.saturating_sub(1).to_le_bytes());
    data[msg_offset + 68..msg_offset + 76].copy_from_slice(&price_8.to_le_bytes());
    data[msg_offset + 76..msg_offset + 84].copy_from_slice(&conf_8.to_le_bytes());
    data[msg_offset + 84..msg_offset + 92].copy_from_slice(&posted_slot.to_le_bytes());

    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner: PRICING_ORACLE_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }
}

// ============================================================================
// MagicSVM Test Harness Loading All 4 Compiled SBF Programs
// ============================================================================

pub struct CartridgeTestHarness {
    pub svm: MagicSVM,
    pub admin: Keypair,
    pub usdc_mint_authority: Keypair,
    pub usdc_mint: Address,
    pub platform_fee_ata: Address,
}

impl Default for CartridgeTestHarness {
    fn default() -> Self {
        Self::new()
    }
}

impl CartridgeTestHarness {
    pub fn new() -> Self {
        let mut svm = MagicSVM::new();
        let deploy_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy");

        svm.add_program_from_file(
            CARTRIDGE_REGISTRY_ID,
            deploy_dir.join("cartridge_registry.so"),
        )
        .expect("load cartridge_registry.so");
        svm.add_program_from_file(
            CARTRIDGE_ER_ROOM_ID,
            deploy_dir.join("cartridge_er_room.so"),
        )
        .expect("load cartridge_er_room.so");
        svm.add_program_from_file(
            CARTRIDGE_VAULT_ROUTER_ID,
            deploy_dir.join("cartridge_vault_router.so"),
        )
        .expect("load cartridge_vault_router.so");
        svm.add_program_from_file(
            CARTRIDGE_PASSPORT_ID,
            deploy_dir.join("cartridge_passport.so"),
        )
        .expect("load cartridge_passport.so");

        let admin = Keypair::new();
        let usdc_mint_authority = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000)
            .expect("airdrop admin");
        svm.airdrop(&usdc_mint_authority.pubkey(), 10_000_000_000)
            .expect("airdrop mint auth");

        // Initialize canonical 6-decimal USDC Mint + Platform Fee Token Account via real SPL Token instructions
        let usdc_mint_kp = Keypair::new();
        let platform_fee_kp = Keypair::new();
        let rent = Rent::default();

        let create_mint_ix = system_ix::create_account(
            &admin.pubkey(),
            &usdc_mint_kp.pubkey(),
            rent.minimum_balance(82),
            82,
            &TOKEN_PROGRAM_ID,
        );
        let mut init_mint_data = Vec::with_capacity(35);
        init_mint_data.push(20u8); // InitializeMint2
        init_mint_data.push(6u8); // 6 decimals (micro-USDC)
        init_mint_data.extend_from_slice(usdc_mint_authority.pubkey().as_ref());
        init_mint_data.push(0u8); // COption::None freeze authority
        let init_mint_ix = Instruction {
            program_id: TOKEN_PROGRAM_ID,
            accounts: vec![AccountMeta::new(usdc_mint_kp.pubkey(), false)],
            data: init_mint_data,
        };

        let create_fee_ata_ix = system_ix::create_account(
            &admin.pubkey(),
            &platform_fee_kp.pubkey(),
            rent.minimum_balance(165),
            165,
            &TOKEN_PROGRAM_ID,
        );
        let mut init_acc_data = Vec::with_capacity(33);
        init_acc_data.push(18u8); // InitializeAccount3
        init_acc_data.extend_from_slice(admin.pubkey().as_ref());
        let init_fee_ata_ix = Instruction {
            program_id: TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(platform_fee_kp.pubkey(), false),
                AccountMeta::new_readonly(usdc_mint_kp.pubkey(), false),
            ],
            data: init_acc_data,
        };

        let tx = Transaction::new(
            &[&admin, &usdc_mint_kp, &platform_fee_kp],
            Message::new(
                &[
                    create_mint_ix,
                    init_mint_ix,
                    create_fee_ata_ix,
                    init_fee_ata_ix,
                ],
                Some(&admin.pubkey()),
            ),
            svm.latest_blockhash_for(TransactionTarget::Base),
        );
        svm.send_transaction_to(TransactionTarget::Base, tx)
            .expect("init USDC mint and platform fee account");

        let clock = Clock {
            slot: 100,
            epoch_start_timestamp: 1_750_000_000,
            epoch: 1,
            leader_schedule_epoch: 1,
            unix_timestamp: 1_750_000_000,
        };
        svm.set_sysvar(&clock);

        Self {
            svm,
            admin,
            usdc_mint_authority,
            usdc_mint: usdc_mint_kp.pubkey(),
            platform_fee_ata: platform_fee_kp.pubkey(),
        }
    }

    pub fn set_clock(&mut self, slot: u64, unix_timestamp: i64) {
        let clock = Clock {
            slot,
            epoch_start_timestamp: 1_750_000_000,
            epoch: 1,
            leader_schedule_epoch: 1,
            unix_timestamp,
        };
        self.svm.set_sysvar(&clock);
    }

    pub fn create_funded_token_account(
        &mut self,
        mint: Address,
        owner: Address,
        amount: u64,
    ) -> Address {
        let kp = Keypair::new();
        self.svm
            .set_account(kp.pubkey(), make_spl_token_account(&mint, &owner, amount))
            .expect("set funded token account");
        kp.pubkey()
    }

    pub fn send_base(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
        self.svm.expire_blockhash_for(TransactionTarget::Base);
        let tx = Transaction::new(
            signers,
            Message::new(ixs, Some(&payer.pubkey())),
            self.svm.latest_blockhash_for(TransactionTarget::Base),
        );
        self.svm
            .send_transaction_to(TransactionTarget::Base, tx)
            .unwrap_or_else(|e| panic!("base tx failed: {:?}\nlogs: {:?}", e.err, e.meta.logs));
    }

    pub fn send_ephemeral(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
        self.svm.expire_blockhash_for(TransactionTarget::Ephemeral);
        let tx = Transaction::new(
            signers,
            Message::new(ixs, Some(&payer.pubkey())),
            self.svm.latest_blockhash_for(TransactionTarget::Ephemeral),
        );
        self.svm
            .send_transaction_to(TransactionTarget::Ephemeral, tx)
            .unwrap_or_else(|e| {
                panic!("ephemeral tx failed: {:?}\nlogs: {:?}", e.err, e.meta.logs)
            });
    }
}

// ============================================================================
// Pure Fixed-Point Solvency & Harmonic Shapley Verification Model (0 Floats)
// ============================================================================

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreInput {
    pub player: Address,
    pub score_scaled: i128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayoutItem {
    pub player: Address,
    pub rank: u16,
    pub payout_usdc: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolvencyResult {
    pub room_pool_usdc: u64,
    pub total_fee_usdc: u64,
    pub platform_fee_usdc: u64,
    pub creator_fee_usdc: u64,
    pub partner_fee_usdc: u64,
    pub net_prize_pool_usdc: u64,
    pub payouts: Vec<PayoutItem>,
    pub total_distributed_usdc: u64,
    pub undistributed_dust_usdc: u64,
}

/// Exact bit-for-bit integer Harmonic Shapley + fee split engine matching
/// `programs/cartridge-vault-router/src/lib.rs::compute_pool_and_fee_distribution`.
pub fn compute_pool_and_fee_distribution_exact(
    room_pool_usdc: u64,
    total_fee_bps: u16,
    creator_share_bps: u16,
    partner_wallet_active: bool,
    player_scores: &[ScoreInput],
) -> Result<SolvencyResult, &'static str> {
    if total_fee_bps > MAX_TOTAL_FEE_BPS {
        return Err("FeeBpsExceedsCap");
    }
    if creator_share_bps > MAX_CREATOR_SHARE_BPS {
        return Err("CreatorShareExceedsCap");
    }

    let pool_u128 = u128::from(room_pool_usdc);
    let total_fee_u128 = pool_u128
        .checked_mul(u128::from(total_fee_bps))
        .ok_or("MathOverflow")?
        / BPS_DENOM;

    let (partner_fee_u128, creator_fee_u128, platform_fee_u128) = if partner_wallet_active {
        let p_fee = total_fee_u128
            .checked_mul(PARTNER_WALLET_SHARE_BPS)
            .ok_or("MathOverflow")?
            / BPS_DENOM;
        let c_fee = total_fee_u128
            .checked_mul(PARTNER_CREATOR_SHARE_BPS)
            .ok_or("MathOverflow")?
            / BPS_DENOM;
        let plat_fee = total_fee_u128
            .checked_sub(p_fee)
            .and_then(|v| v.checked_sub(c_fee))
            .ok_or("MathOverflow")?;
        (p_fee, c_fee, plat_fee)
    } else {
        let c_fee = total_fee_u128
            .checked_mul(u128::from(creator_share_bps))
            .ok_or("MathOverflow")?
            / BPS_DENOM;
        let plat_fee = total_fee_u128.checked_sub(c_fee).ok_or("MathOverflow")?;
        (0u128, c_fee, plat_fee)
    };

    let net_prize_u128 = pool_u128
        .checked_sub(total_fee_u128)
        .ok_or("MathOverflow")?;

    let total_fee_usdc = u64::try_from(total_fee_u128).map_err(|_| "MathOverflow")?;
    let platform_fee_usdc = u64::try_from(platform_fee_u128).map_err(|_| "MathOverflow")?;
    let creator_fee_usdc = u64::try_from(creator_fee_u128).map_err(|_| "MathOverflow")?;
    let partner_fee_usdc = u64::try_from(partner_fee_u128).map_err(|_| "MathOverflow")?;
    let net_prize_pool_usdc = u64::try_from(net_prize_u128).map_err(|_| "MathOverflow")?;

    if player_scores.is_empty() || net_prize_u128 == 0 {
        let fee_sum = platform_fee_u128
            .checked_add(creator_fee_u128)
            .and_then(|v| v.checked_add(partner_fee_u128))
            .ok_or("MathOverflow")?;
        if fee_sum > pool_u128 {
            return Err("SolvencyInvariantViolated");
        }
        let total_distributed_usdc = u64::try_from(fee_sum).map_err(|_| "MathOverflow")?;
        let mut zero_payouts = Vec::with_capacity(player_scores.len());
        if !player_scores.is_empty() {
            let mut indexed: Vec<(usize, &ScoreInput)> = player_scores.iter().enumerate().collect();
            indexed.sort_by(|(idx_a, a), (idx_b, b)| {
                b.score_scaled
                    .cmp(&a.score_scaled)
                    .then_with(|| idx_a.cmp(idx_b))
            });
            for (rank_idx, (_, entry)) in indexed.into_iter().enumerate() {
                let rank_u16 = u16::try_from(rank_idx + 1).map_err(|_| "MathOverflow")?;
                zero_payouts.push(PayoutItem {
                    player: entry.player,
                    rank: rank_u16,
                    payout_usdc: 0,
                });
            }
        }
        return Ok(SolvencyResult {
            room_pool_usdc,
            total_fee_usdc,
            platform_fee_usdc,
            creator_fee_usdc,
            partner_fee_usdc,
            net_prize_pool_usdc,
            payouts: zero_payouts,
            total_distributed_usdc,
            undistributed_dust_usdc: room_pool_usdc
                .checked_sub(total_distributed_usdc)
                .ok_or("MathOverflow")?,
        });
    }

    let mut indexed: Vec<(usize, &ScoreInput)> = player_scores.iter().enumerate().collect();
    indexed.sort_by(|(idx_a, a), (idx_b, b)| {
        b.score_scaled
            .cmp(&a.score_scaled)
            .then_with(|| idx_a.cmp(idx_b))
    });

    let n = indexed.len();
    let top_twenty_pct_ceil = n.checked_add(4).ok_or("MathOverflow")? / 5;
    let winner_count = core::cmp::max(core::cmp::min(3, n), top_twenty_pct_ceil);

    let mut raw_weights: Vec<u128> = Vec::with_capacity(winner_count);
    let mut weight_sum: u128 = 0;
    for r in 0..winner_count {
        let denom = u128::try_from(r + 1).map_err(|_| "MathOverflow")?;
        let w = SHAPLEY_WEIGHT_BASE / denom;
        raw_weights.push(w);
        weight_sum = weight_sum.checked_add(w).ok_or("MathOverflow")?;
    }

    let mut payouts: Vec<PayoutItem> = Vec::with_capacity(n);
    let mut paid_winner_sum: u128 = 0;
    for (i, (_, entry)) in indexed.into_iter().enumerate() {
        let mut payout_u128 = 0u128;
        if i < winner_count && weight_sum > 0 {
            payout_u128 = net_prize_u128
                .checked_mul(raw_weights[i])
                .ok_or("MathOverflow")?
                / weight_sum;
            paid_winner_sum = paid_winner_sum
                .checked_add(payout_u128)
                .ok_or("MathOverflow")?;
        }
        let rank_u16 = u16::try_from(i + 1).map_err(|_| "MathOverflow")?;
        let payout_u64 = u64::try_from(payout_u128).map_err(|_| "MathOverflow")?;
        payouts.push(PayoutItem {
            player: entry.player,
            rank: rank_u16,
            payout_usdc: payout_u64,
        });
    }

    let prize_dust = net_prize_u128
        .checked_sub(paid_winner_sum)
        .ok_or("MathOverflow")?;
    if prize_dust > 0 && !payouts.is_empty() {
        let dust_u64 = u64::try_from(prize_dust).map_err(|_| "MathOverflow")?;
        payouts[0].payout_usdc = payouts[0]
            .payout_usdc
            .checked_add(dust_u64)
            .ok_or("MathOverflow")?;
        paid_winner_sum = paid_winner_sum
            .checked_add(prize_dust)
            .ok_or("MathOverflow")?;
    }

    let total_dist_u128 = paid_winner_sum
        .checked_add(platform_fee_u128)
        .and_then(|v| v.checked_add(creator_fee_u128))
        .and_then(|v| v.checked_add(partner_fee_u128))
        .ok_or("MathOverflow")?;

    if total_dist_u128 > pool_u128 {
        return Err("SolvencyInvariantViolated");
    }

    let total_distributed_usdc = u64::try_from(total_dist_u128).map_err(|_| "MathOverflow")?;
    let undistributed_dust_usdc = room_pool_usdc
        .checked_sub(total_distributed_usdc)
        .ok_or("MathOverflow")?;

    Ok(SolvencyResult {
        room_pool_usdc,
        total_fee_usdc,
        platform_fee_usdc,
        creator_fee_usdc,
        partner_fee_usdc,
        net_prize_pool_usdc,
        payouts,
        total_distributed_usdc,
        undistributed_dust_usdc,
    })
}
