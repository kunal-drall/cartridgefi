#![allow(unexpected_cfgs, clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::access_control::instructions::{
    CloseEphemeralPermissionCpi, CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi,
};
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, EphemeralPermission, Member, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG,
    PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
#[allow(deprecated)]
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::utils::create_pda;
use ephemeral_rollups_sdk::vrf::{
    self,
    consts::program_identity_pubkey,
    instructions::{create_request_randomness_ix_const, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use ephemeral_rollups_sdk::{compat, ActionArgs, ShortAccountMeta};

declare_id!("DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W");

pub const SCALE: i128 = 1_000_000_000;
pub const BPS_TO_SCALE: i128 = 100_000; // 10_000 bps * 100_000 = 1_000_000_000
pub const MAX_GROSS_WEIGHT_BPS: u32 = 10_000;
pub const MAX_PLAYERS_PER_SHARD: u16 = 200;
pub const MAX_PERMISSION_MEMBERS: usize = 4;
pub const PYTH_MAX_STALENESS_SECS: i64 = 15;
pub const PYTH_MAX_CONF_RATIO_BPS: u128 = 150;
pub const DEFAULT_SHARPE_EPSILON_SQ_18: u128 = 1_000_000_000_000;

pub const SEED_ROOM_SHARD: &[u8] = b"room_shard";
pub const SEED_PLAYER_STANCE: &[u8] = b"player_stance";
pub const CRANK_EXECUTOR_SEED: &[u8] = b"crank-executor";

pub const CARTRIDGE_REGISTRY_ID: Pubkey = pubkey!("BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc");
pub const CARTRIDGE_VAULT_ROUTER_ID: Pubkey =
    pubkey!("Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR");
pub const PRICING_ORACLE_PROGRAM_ID: Pubkey =
    pubkey!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
pub const CRANK_PROGRAM_ID: Pubkey = pubkey!("Crank11111111111111111111111111111111111111");

pub const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);
pub const SCOPED_VRF_IDENTITY: Pubkey =
    Pubkey::new_from_array(vrf::consts::scoped_vrf_identity_const(&crate::ID).0);

pub const ALL_MEMBER_FLAGS: u8 =
    AUTHORITY_FLAG | TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG | ACCOUNT_SIGNATURES_FLAG;

/// `sha256("global:distribute_pool_action")[0..8]` on `cartridge-vault-router`.
pub const DISTRIBUTE_POOL_ACTION_DISCRIMINATOR: [u8; 8] =
    [0x10, 0x6d, 0x64, 0xb4, 0x0d, 0x66, 0x21, 0x09];
/// `sha256("account:CartridgeManifestAccount")[0..8]` on `cartridge-registry`.
pub const CARTRIDGE_MANIFEST_DISCRIMINATOR: [u8; 8] =
    [0xc6, 0x6e, 0xf5, 0xf9, 0xbc, 0x5a, 0x6f, 0xac];

#[ephemeral]
#[program]
pub mod cartridge_er_room {
    use super::*;

    pub fn initialize_room_shard(
        ctx: Context<InitializeRoomShard>,
        args: InitializeRoomShardArgs,
    ) -> Result<()> {
        require!(args.event_id != [0u8; 32], ErRoomError::InvalidEventId);
        let manifest_info = ctx.accounts.cartridge_manifest.to_account_info();
        require!(
            manifest_info.owner == &CARTRIDGE_REGISTRY_ID,
            ErRoomError::InvalidManifestOwner
        );

        let manifest_snapshot = parse_cartridge_manifest(&manifest_info)?;
        require!(
            manifest_snapshot.duration_secs >= 30,
            ErRoomError::InvalidManifestDuration
        );

        let perm_rent = ephemeral_rollups_sdk::ephemeral_accounts::rent(
            EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32,
        );
        if perm_rent > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: ctx.accounts.room_shard.to_account_info(),
                    },
                ),
                perm_rent,
            )?;
        }

        let clock = Clock::get()?;
        let start_ts = if args.start_ts > 0 {
            args.start_ts
        } else {
            clock.unix_timestamp
        };
        let duration_i64 = i64::from(manifest_snapshot.duration_secs);
        let end_ts = start_ts
            .checked_add(duration_i64)
            .ok_or(ErRoomError::MathOverflow)?;
        let fog_duration = duration_i64
            .checked_mul(i64::from(manifest_snapshot.fog_of_war_bps))
            .ok_or(ErRoomError::MathOverflow)?
            / 10_000;
        let unseal_ts = start_ts
            .checked_add(fog_duration)
            .ok_or(ErRoomError::MathOverflow)?;
        let is_private_fog = manifest_snapshot.fog_of_war_bps > 0;

        let shard = &mut ctx.accounts.room_shard;
        shard.event_id = args.event_id;
        shard.shard_index = args.shard_index;
        shard.cartridge_manifest = ctx.accounts.cartridge_manifest.key();
        shard.authority = ctx.accounts.authority.key();
        shard.phase = if is_private_fog {
            RoomPhase::FogOfWar
        } else {
            RoomPhase::LobbyOpen
        };
        shard.scoring_formula = manifest_snapshot.scoring_formula;
        shard.action_binding_mode = manifest_snapshot.action_binding_mode;
        shard.max_rebalances = manifest_snapshot.max_rebalances;
        shard.is_private_fog = is_private_fog;
        shard.player_count = 0;
        shard.evaluated_count = 0;
        shard.start_ts = start_ts;
        shard.unseal_ts = unseal_ts;
        shard.end_ts = end_ts;
        shard.room_pool_usdc = args.room_pool_usdc;
        shard.crank_task_id = args.crank_task_id;
        shard.vrf_request_nonce = 0;
        shard.vrf_seed = [0u8; 32];
        shard.vrf_fulfilled = false;
        shard.kalshi_outcome_yes = 0;
        shard.settlement_prices_8 = [0i64; 4];
        shard.public_rank_digest = args.event_id;
        shard.bump = ctx.bumps.room_shard;

        emit!(RoomShardInitialized {
            room_shard: shard.key(),
            event_id: shard.event_id,
            shard_index: shard.shard_index,
            authority: shard.authority,
            start_ts,
            unseal_ts,
            end_ts,
            is_private_fog,
        });
        Ok(())
    }

    pub fn delegate_room_shard(
        ctx: Context<DelegateRoomShard>,
        event_id: [u8; 32],
        shard_index: u16,
    ) -> Result<()> {
        if ctx.accounts.room_shard.owner != &ephemeral_rollups_sdk::id() {
            require!(
                ctx.accounts.room_shard.owner == &crate::ID,
                ErRoomError::InvalidShardOwner
            );
            {
                let data = ctx.accounts.room_shard.try_borrow_data()?;
                let mut slice: &[u8] = &data;
                let shard = RoomShard::try_deserialize(&mut slice)?;
                require_keys_eq!(
                    shard.authority,
                    ctx.accounts.authority.key(),
                    ErRoomError::UnauthorizedAuthority
                );
            }
            let shard_idx_bytes = shard_index.to_le_bytes();
            ctx.accounts.delegate_room_shard(
                &ctx.accounts.authority,
                &[SEED_ROOM_SHARD, event_id.as_ref(), shard_idx_bytes.as_ref()],
                DelegateConfig {
                    validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }

    #[allow(deprecated)]
    pub fn schedule_room_crank(
        ctx: Context<ScheduleRoomCrank>,
        task_id: i64,
        execution_interval_millis: i64,
        iterations: i64,
    ) -> Result<()> {
        require!(
            execution_interval_millis >= 50 && iterations >= 1,
            ErRoomError::InvalidCrankSchedule
        );
        let expected_crank_signer = crank_signer_pda(&ctx.accounts.authority.key());
        require_keys_eq!(
            ctx.accounts.crank_signer.key(),
            expected_crank_signer,
            ErRoomError::UnauthorizedCrankSigner
        );

        ctx.accounts.room_shard.crank_task_id = task_id;

        let tick_ix = compat::Instruction {
            program_id: crate::ID,
            accounts: vec![
                compat::AccountMeta::new_readonly(expected_crank_signer, true),
                compat::AccountMeta::new(ctx.accounts.room_shard.key(), false),
            ],
            data: anchor_lang::InstructionData::data(&crate::instruction::CrankTickRoom {}),
        };

        let authority_key = ctx.accounts.authority.key();
        let magic_key = ctx.accounts.magic_program.key();
        let shard_key = ctx.accounts.room_shard.key();
        let dummy_owner = Pubkey::default();
        let mut l0 = 0u64;
        let mut l1 = 0u64;
        let mut l2 = 0u64;
        let mut l3 = 0u64;
        let mut d0 = [];
        let mut d1 = [];
        let mut d2 = [];
        let mut d3 = [];

        let schedule_ix = {
            let payer_meta_ai = AccountInfo::new(
                &authority_key,
                true,
                true,
                &mut l0,
                &mut d0,
                &dummy_owner,
                false,
            );
            let magic_meta_ai = AccountInfo::new(
                &magic_key,
                false,
                false,
                &mut l1,
                &mut d1,
                &dummy_owner,
                false,
            );
            let crank_meta_ai = AccountInfo::new(
                &expected_crank_signer,
                false,
                false,
                &mut l2,
                &mut d2,
                &dummy_owner,
                false,
            );
            let shard_meta_ai = AccountInfo::new(
                &shard_key,
                false,
                true,
                &mut l3,
                &mut d3,
                &dummy_owner,
                false,
            );
            let meta_accounts = [crank_meta_ai, shard_meta_ai];

            ScheduleCrankCpi {
                payer: &payer_meta_ai,
                magic_program: &magic_meta_ai,
                instruction_accounts: &meta_accounts,
                args: ScheduleTaskArgs {
                    task_id,
                    execution_interval_millis,
                    iterations,
                    instructions: vec![tick_ix],
                },
            }
            .instruction()
        };

        anchor_lang::solana_program::program::invoke(
            &schedule_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.crank_signer.to_account_info(),
                ctx.accounts.room_shard.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            ],
        )?;

        Ok(())
    }

    pub fn crank_tick_room(ctx: Context<CrankTickRoom>) -> Result<()> {
        let clock = Clock::get()?;
        let shard = &mut ctx.accounts.room_shard;
        if shard.phase == RoomPhase::FogOfWar && clock.unix_timestamp >= shard.unseal_ts {
            shard.phase = RoomPhase::Showdown;
            shard.is_private_fog = false;
            emit!(RoomShowdownUnsealed {
                room_shard: shard.key(),
                timestamp: clock.unix_timestamp,
            });
        }
        Ok(())
    }

    pub fn init_stance_and_delegate(
        ctx: Context<InitStanceAndDelegate>,
        ephemeral_session_key: Pubkey,
        session_expiry_ts: i64,
    ) -> Result<()> {
        require!(
            ephemeral_session_key != Pubkey::default()
                && ephemeral_session_key != ctx.accounts.player.key(),
            ErRoomError::InvalidSessionKey
        );

        let shard_owner = ctx.accounts.room_shard.owner;
        require!(
            shard_owner == &crate::ID || shard_owner == &ephemeral_rollups_sdk::id(),
            ErRoomError::InvalidShardOwner
        );
        let (start_ts, end_ts, shard_authority) = {
            let shard_data = ctx.accounts.room_shard.try_borrow_data()?;
            let mut slice: &[u8] = &shard_data;
            let shard = RoomShard::try_deserialize(&mut slice)?;
            (shard.start_ts, shard.end_ts, shard.authority)
        };
        // Seat creation (and any re-delegation) needs the room authority's co-signature (C1).
        require_keys_eq!(
            ctx.accounts.room_authority.key(),
            shard_authority,
            ErRoomError::UnauthorizedAuthority
        );
        require!(
            session_expiry_ts > start_ts && session_expiry_ts <= end_ts,
            ErRoomError::SessionExpiryExceedsRoomEnd
        );

        if ctx.accounts.player_stance.owner != &ephemeral_rollups_sdk::id() {
            let room_key = ctx.accounts.room_shard.key();
            let player_key = ctx.accounts.player.key();
            let bump = ctx.bumps.player_stance;
            let signer_seeds: &[&[u8]] = &[
                SEED_PLAYER_STANCE,
                room_key.as_ref(),
                player_key.as_ref(),
                &[bump],
            ];

            if ctx.accounts.player_stance.owner != &crate::ID {
                let space = 8 + PlayerStance::INIT_SPACE;
                create_pda(
                    &ctx.accounts.player_stance.to_account_info(),
                    &crate::ID,
                    space,
                    &[signer_seeds],
                    &ctx.accounts.system_program.to_account_info(),
                    &ctx.accounts.player.to_account_info(),
                    true,
                )?;

                let perm_rent = ephemeral_rollups_sdk::ephemeral_accounts::rent(
                    EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32,
                );
                if perm_rent > 0 {
                    transfer(
                        CpiContext::new(
                            ctx.accounts.system_program.key(),
                            Transfer {
                                from: ctx.accounts.player.to_account_info(),
                                to: ctx.accounts.player_stance.to_account_info(),
                            },
                        ),
                        perm_rent,
                    )?;
                }

                let stance = PlayerStance {
                    room_shard: room_key,
                    player: player_key,
                    ephemeral_session_key,
                    session_expiry_ts,
                    last_move_ts: 0,
                    move_count: 0,
                    weights_bps: [0i16; 4],
                    kalshi_binary_call: 0,
                    kalshi_prob_bps: 5_000,
                    entry_prices_8: [0i64; 4],
                    step_returns_scaled: [0i64; 8],
                    step_count: 0,
                    max_drawdown_scaled: 0,
                    stage1_score_scaled: 0,
                    final_score_scaled: 0,
                    joined_er: false,
                    evaluated: false,
                    rank: 0,
                    claimed: false,
                    bump,
                };
                let mut data = ctx.accounts.player_stance.try_borrow_mut_data()?;
                let mut writer: &mut [u8] = &mut data;
                stance.try_serialize(&mut writer)?;
            } else {
                let data = ctx.accounts.player_stance.try_borrow_data()?;
                let mut slice: &[u8] = &data;
                let existing = PlayerStance::try_deserialize(&mut slice)?;
                require_keys_eq!(existing.player, player_key, ErRoomError::UnauthorizedPlayer);
            }

            ctx.accounts.delegate_player_stance(
                &ctx.accounts.player,
                &[SEED_PLAYER_STANCE, room_key.as_ref(), player_key.as_ref()],
                DelegateConfig {
                    validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }

    pub fn join_room_and_init_permission(ctx: Context<JoinRoomAndInitPermission>) -> Result<()> {
        let caller = ctx.accounts.payer.key();
        let shard = &mut ctx.accounts.room_shard;
        let stance = &mut ctx.accounts.player_stance;

        require!(
            caller == stance.player
                || caller == shard.authority
                || caller == stance.ephemeral_session_key,
            ErRoomError::UnauthorizedPlayer
        );
        require!(
            shard.phase == RoomPhase::LobbyOpen || shard.phase == RoomPhase::FogOfWar,
            ErRoomError::InvalidRoomPhase
        );

        if !stance.joined_er {
            require!(
                shard.player_count < MAX_PLAYERS_PER_SHARD,
                ErRoomError::ShardFull
            );
            shard.player_count = shard
                .player_count
                .checked_add(1)
                .ok_or(ErRoomError::MathOverflow)?;
            stance.joined_er = true;
            if shard.phase == RoomPhase::LobbyOpen && shard.is_private_fog {
                shard.phase = RoomPhase::FogOfWar;
            }
        }

        if ctx.accounts.permission.owner != &PERMISSION_PROGRAM_ID
            || ctx.accounts.permission.data_is_empty()
        {
            let members = build_stance_members(stance.player, shard.authority);
            require!(
                members.len() <= MAX_PERMISSION_MEMBERS,
                ErRoomError::TooManyPermissionMembers
            );
            let is_private = shard.phase == RoomPhase::FogOfWar && shard.is_private_fog;
            let room_key = shard.key();
            let player_key = stance.player;
            let bump = stance.bump;
            let signer_seeds: &[&[u8]] = &[
                SEED_PLAYER_STANCE,
                room_key.as_ref(),
                player_key.as_ref(),
                &[bump],
            ];

            CreateEphemeralPermissionCpi {
                payer: stance.to_account_info(),
                permissioned_account: stance.to_account_info(),
                permission: ctx.accounts.permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs {
                    is_private,
                    members,
                },
            }
            .invoke_signed(&[signer_seeds])?;
        }

        Ok(())
    }

    pub fn submit_stance(ctx: Context<SubmitStance>, args: SubmitStanceArgs) -> Result<()> {
        let clock = Clock::get()?;
        let shard = &mut ctx.accounts.room_shard;
        let stance = &mut ctx.accounts.player_stance;

        require_keys_eq!(
            ctx.accounts.session_signer.key(),
            stance.ephemeral_session_key,
            ErRoomError::InvalidSessionSigner
        );
        require!(
            clock.unix_timestamp <= stance.session_expiry_ts
                && clock.unix_timestamp <= shard.end_ts,
            ErRoomError::SessionExpired
        );
        require!(stance.joined_er, ErRoomError::PlayerNotJoined);
        require!(
            shard.phase == RoomPhase::FogOfWar || shard.phase == RoomPhase::Showdown,
            ErRoomError::InvalidRoomPhase
        );
        require!(
            stance.move_count < shard.max_rebalances,
            ErRoomError::MaxRebalancesExceeded
        );
        if stance.move_count == 0 {
            // Entry (the sealed hand) must land before the clock starts.
            require!(
                clock.unix_timestamp < shard.start_ts,
                ErRoomError::EntryAfterStart
            );
            // Entry prices are attested by the co-signing room authority; no silent fallback.
            require!(
                args.secondary_prices_8.iter().all(|p| *p > 0),
                ErRoomError::InvalidAttestedPrice
            );
        } else {
            // Pivots only while the room is live.
            require!(
                clock.unix_timestamp >= shard.start_ts && clock.unix_timestamp < shard.end_ts,
                ErRoomError::PivotOutsideLiveWindow
            );
        }
        if shard.action_binding_mode == 1 && stance.move_count > 0 {
            require!(
                clock.unix_timestamp > stance.last_move_ts,
                ErRoomError::LaneCheckpointCooldownActive
            );
        }

        let gross_bps: u32 = args
            .weights_bps
            .iter()
            .map(|w| i32::from(*w).unsigned_abs())
            .sum();
        require!(
            gross_bps <= MAX_GROSS_WEIGHT_BPS,
            ErRoomError::GrossWeightExceedsCap
        );
        require!(
            args.kalshi_binary_call <= 2 && args.kalshi_prob_bps <= 10_000,
            ErRoomError::InvalidKalshiForecast
        );

        let oracle_tick =
            match verify_oracle_health(&ctx.accounts.oracle_feed, clock.unix_timestamp)? {
                OracleHealth::Healthy(price_8) => price_8,
                OracleHealth::Stale => return err!(ErRoomError::StaleOraclePrice),
                OracleHealth::WideConfidence => return err!(ErRoomError::OracleConfidenceTooWide),
            };

        if stance.move_count == 0 {
            stance.entry_prices_8[0] = oracle_tick;
            stance.entry_prices_8[1..].copy_from_slice(&args.secondary_prices_8);
        } else if (stance.step_count as usize) < stance.step_returns_scaled.len() {
            let prev_entry = stance.entry_prices_8[0];
            if prev_entry > 0 {
                let raw_ret_scaled = (i128::from(oracle_tick) - i128::from(prev_entry))
                    .checked_mul(SCALE)
                    .ok_or(ErRoomError::MathOverflow)?
                    / i128::from(prev_entry);
                let w0_scaled = i128::from(stance.weights_bps[0]) * BPS_TO_SCALE;
                let weighted_step = fp_mul(w0_scaled, raw_ret_scaled)?;
                let step_i64 =
                    i64::try_from(weighted_step).map_err(|_| ErRoomError::MathOverflow)?;
                let idx = usize::from(stance.step_count);
                stance.step_returns_scaled[idx] = step_i64;
                stance.step_count = stance.step_count.saturating_add(1);
                if step_i64 < 0 {
                    let dd = step_i64.saturating_neg();
                    if dd > stance.max_drawdown_scaled {
                        stance.max_drawdown_scaled = dd;
                    }
                }
            }
        }

        stance.weights_bps = args.weights_bps;
        stance.kalshi_binary_call = args.kalshi_binary_call;
        stance.kalshi_prob_bps = args.kalshi_prob_bps;
        stance.stage1_score_scaled = args.stage1_score_scaled;
        stance.move_count = stance
            .move_count
            .checked_add(1)
            .ok_or(ErRoomError::MathOverflow)?;
        stance.last_move_ts = clock.unix_timestamp;

        shard.public_rank_digest = mix_anonymized_rank_digest(
            &shard.public_rank_digest,
            &stance.player,
            stance.move_count,
            clock.slot,
        );

        Ok(())
    }

    pub fn trigger_showdown_unseal(ctx: Context<TriggerShowdownUnseal>) -> Result<()> {
        let clock = Clock::get()?;
        let shard = &mut ctx.accounts.room_shard;
        let stance = &ctx.accounts.player_stance;

        require!(
            clock.unix_timestamp >= shard.unseal_ts,
            ErRoomError::UnsealTimestampNotReached
        );
        require!(
            shard.phase == RoomPhase::FogOfWar || shard.phase == RoomPhase::Showdown,
            ErRoomError::InvalidRoomPhase
        );

        shard.phase = RoomPhase::Showdown;
        shard.is_private_fog = false;

        if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID
            && !ctx.accounts.permission.data_is_empty()
        {
            let members = build_stance_members(stance.player, shard.authority);
            let room_key = shard.key();
            let player_key = stance.player;
            let bump = stance.bump;
            let signer_seeds: &[&[u8]] = &[
                SEED_PLAYER_STANCE,
                room_key.as_ref(),
                player_key.as_ref(),
                &[bump],
            ];

            UpdateEphemeralPermissionCpi {
                payer: stance.to_account_info(),
                permissioned_account: stance.to_account_info(),
                permission: ctx.accounts.permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                authority: stance.to_account_info(),
                authority_is_signer: false,
                args: EphemeralMembersArgs {
                    is_private: false,
                    members,
                },
            }
            .invoke_signed(&[signer_seeds])?;
        }

        emit!(RoomShowdownUnsealed {
            room_shard: shard.key(),
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn request_settlement_vrf(
        ctx: Context<RequestSettlementVrf>,
        client_seed: u8,
    ) -> Result<()> {
        let shard = &mut ctx.accounts.room_shard;
        let next_nonce = shard
            .vrf_request_nonce
            .checked_add(1)
            .ok_or(ErRoomError::MathOverflow)?;
        shard.vrf_request_nonce = next_nonce;
        shard.vrf_fulfilled = false;

        let mut caller_seed = shard.event_id;
        let nonce_bytes = next_nonce.to_le_bytes();
        for i in 0..8 {
            caller_seed[i] ^= nonce_bytes[i] ^ client_seed;
        }

        let params = RequestRandomnessParams {
            payer: ctx.accounts.authority.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: crate::instruction::CallbackSettlementVrf::DISCRIMINATOR
                .to_vec(),
            caller_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: shard.key(),
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: Some(next_nonce.to_le_bytes().to_vec()),
        };

        let ix = create_request_randomness_ix_const(params, PROGRAM_IDENTITY);
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.authority.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn callback_settlement_vrf(
        ctx: Context<CallbackSettlementVrf>,
        randomness: [u8; 32],
        request_nonce: u64,
    ) -> Result<()> {
        let shard = &mut ctx.accounts.room_shard;
        require!(
            request_nonce == shard.vrf_request_nonce,
            ErRoomError::SupersededVrfCallback
        );
        if shard.vrf_fulfilled {
            return Ok(());
        }
        shard.vrf_seed = randomness;
        shard.vrf_fulfilled = true;

        emit!(SettlementVrfFulfilled {
            room_shard: shard.key(),
            request_nonce,
            vrf_seed: randomness,
        });
        Ok(())
    }

    pub fn evaluate_player_score(
        ctx: Context<EvaluatePlayerScore>,
        args: EvaluateScoreArgs,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let shard = &mut ctx.accounts.room_shard;
        let stance = &mut ctx.accounts.player_stance;

        require!(
            clock.unix_timestamp >= shard.end_ts,
            ErRoomError::SettlementBeforeRoomEnd
        );
        require!(
            shard.phase == RoomPhase::FogOfWar
                || shard.phase == RoomPhase::Showdown
                || shard.phase == RoomPhase::RetryGrace,
            ErRoomError::InvalidRoomPhase
        );

        let primary_exit_price_8 =
            match verify_oracle_health(&ctx.accounts.oracle_feed, clock.unix_timestamp)? {
                OracleHealth::Healthy(price_8) => price_8,
                OracleHealth::Stale => {
                    shard.phase = RoomPhase::RetryGrace;
                    emit!(RoomEnteredRetryGrace {
                        room_shard: shard.key(),
                        reason_code: 1,
                        timestamp: clock.unix_timestamp,
                    });
                    return Ok(());
                }
                OracleHealth::WideConfidence => {
                    shard.phase = RoomPhase::RetryGrace;
                    emit!(RoomEnteredRetryGrace {
                        room_shard: shard.key(),
                        reason_code: 2,
                        timestamp: clock.unix_timestamp,
                    });
                    return Ok(());
                }
            };

        if shard.phase == RoomPhase::RetryGrace || shard.phase == RoomPhase::FogOfWar {
            shard.phase = RoomPhase::Showdown;
            shard.is_private_fog = false;
        }

        let mut exit_prices_8 = [primary_exit_price_8; 4];
        for i in 0..3 {
            if args.secondary_exit_prices_8[i] > 0 {
                exit_prices_8[i + 1] = args.secondary_exit_prices_8[i];
            }
        }
        shard.settlement_prices_8 = exit_prices_8;
        shard.kalshi_outcome_yes = args.kalshi_outcome_yes;

        let final_score = compute_player_score_scaled(
            shard.scoring_formula,
            stance,
            &exit_prices_8,
            args.beta_bench_scaled,
            args.lambda_dd_scaled,
            args.kalshi_outcome_yes,
            args.max_multiplier_scaled,
        )?;

        stance.final_score_scaled = final_score;
        if !stance.evaluated {
            stance.evaluated = true;
            shard.evaluated_count = shard
                .evaluated_count
                .checked_add(1)
                .ok_or(ErRoomError::MathOverflow)?;
        }

        if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID
            && !ctx.accounts.permission.data_is_empty()
        {
            let room_key = shard.key();
            let player_key = stance.player;
            let bump = stance.bump;
            let signer_seeds: &[&[u8]] = &[
                SEED_PLAYER_STANCE,
                room_key.as_ref(),
                player_key.as_ref(),
                &[bump],
            ];
            CloseEphemeralPermissionCpi {
                payer: stance.to_account_info(),
                permissioned_account: stance.to_account_info(),
                permission: ctx.accounts.permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                authority: stance.to_account_info(),
                authority_is_signer: false,
            }
            .invoke_signed(&[signer_seeds])?;
        }

        Ok(())
    }

    pub fn undelegate_player_stance(ctx: Context<UndelegatePlayerStance>) -> Result<()> {
        require!(
            ctx.accounts.player_stance.evaluated,
            ErRoomError::PlayerNotEvaluated
        );
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.player_stance.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    pub fn settle_and_commit_shard(
        ctx: Context<SettleAndCommitShard>,
        args: SettleShardArgs,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let shard_info = ctx.accounts.room_shard.to_account_info();
        require!(
            shard_info.owner == &crate::ID,
            ErRoomError::InvalidShardOwner
        );

        let mut shard = {
            let data = shard_info.try_borrow_data()?;
            let mut slice: &[u8] = &data;
            RoomShard::try_deserialize(&mut slice)?
        };

        let expected_shard_pda = Pubkey::create_program_address(
            &[
                SEED_ROOM_SHARD,
                shard.event_id.as_ref(),
                &shard.shard_index.to_le_bytes(),
                &[shard.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ErRoomError::InvalidShardOwner)?;
        require_keys_eq!(
            shard_info.key(),
            expected_shard_pda,
            ErRoomError::InvalidShardOwner
        );
        require_keys_eq!(
            shard.authority,
            ctx.accounts.authority.key(),
            ErRoomError::UnauthorizedAuthority
        );

        require!(
            clock.unix_timestamp >= shard.end_ts,
            ErRoomError::SettlementBeforeRoomEnd
        );
        require!(shard.vrf_fulfilled, ErRoomError::VrfNotFulfilled);
        require!(
            shard.phase == RoomPhase::Showdown
                || shard.phase == RoomPhase::FogOfWar
                || shard.phase == RoomPhase::RetryGrace,
            ErRoomError::InvalidRoomPhase
        );

        let primary_exit_price_8 =
            match verify_oracle_health(&ctx.accounts.oracle_feed, clock.unix_timestamp)? {
                OracleHealth::Healthy(price_8) => price_8,
                OracleHealth::Stale => {
                    shard.phase = RoomPhase::RetryGrace;
                    {
                        let mut data = shard_info.try_borrow_mut_data()?;
                        let mut writer: &mut [u8] = &mut data;
                        shard.try_serialize(&mut writer)?;
                    }
                    emit!(RoomEnteredRetryGrace {
                        room_shard: shard_info.key(),
                        reason_code: 1,
                        timestamp: clock.unix_timestamp,
                    });
                    return Ok(());
                }
                OracleHealth::WideConfidence => {
                    shard.phase = RoomPhase::RetryGrace;
                    {
                        let mut data = shard_info.try_borrow_mut_data()?;
                        let mut writer: &mut [u8] = &mut data;
                        shard.try_serialize(&mut writer)?;
                    }
                    emit!(RoomEnteredRetryGrace {
                        room_shard: shard_info.key(),
                        reason_code: 2,
                        timestamp: clock.unix_timestamp,
                    });
                    return Ok(());
                }
            };

        require!(
            shard.evaluated_count == shard.player_count,
            ErRoomError::PendingPlayerEvaluations
        );

        shard.settlement_prices_8[0] = primary_exit_price_8;
        shard.phase = RoomPhase::SettledCommitted;
        shard.is_private_fog = false;

        // Flush updated RoomShard bytes BEFORE MagicProgram CPI changes owner / snapshots commit state
        {
            let mut data = shard_info.try_borrow_mut_data()?;
            let mut writer: &mut [u8] = &mut data;
            shard.try_serialize(&mut writer)?;
        }

        if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID
            && !ctx.accounts.permission.data_is_empty()
            && ctx.accounts.permission.is_writable
            && ctx.accounts.ephemeral_vault.is_writable
        {
            let event_id = shard.event_id;
            let shard_idx_bytes = shard.shard_index.to_le_bytes();
            let bump = shard.bump;
            let signer_seeds: &[&[u8]] = &[
                SEED_ROOM_SHARD,
                event_id.as_ref(),
                shard_idx_bytes.as_ref(),
                &[bump],
            ];
            CloseEphemeralPermissionCpi {
                payer: shard_info.clone(),
                permissioned_account: shard_info.clone(),
                permission: ctx.accounts.permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                authority: shard_info.clone(),
                authority_is_signer: false,
            }
            .invoke_signed(&[signer_seeds])?;
        }

        let builder = MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[shard_info]);

        if args.schedule_vault_action {
            let mut action_metas = Vec::with_capacity(args.vault_action_accounts.len());
            for spec in &args.vault_action_accounts {
                action_metas.push(ShortAccountMeta {
                    pubkey: spec.pubkey,
                    is_writable: spec.is_writable,
                });
            }
            let action = CallHandler {
                destination_program: CARTRIDGE_VAULT_ROUTER_ID,
                accounts: action_metas,
                args: ActionArgs::new(DISTRIBUTE_POOL_ACTION_DISCRIMINATOR.to_vec()),
                escrow_authority: ctx.accounts.authority.to_account_info(),
                compute_units: 300_000,
            };
            builder
                .add_post_commit_actions([action])
                .build_and_invoke()?;
        } else {
            builder.build_and_invoke()?;
        }

        Ok(())
    }
}

pub fn crank_signer_pda(authority: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[CRANK_EXECUTOR_SEED, authority.as_ref()],
        &CRANK_PROGRAM_ID,
    )
    .0
}

fn build_stance_members(player: Pubkey, authority: Pubkey) -> Vec<Member> {
    if player == authority {
        vec![Member {
            flags: ALL_MEMBER_FLAGS,
            pubkey: player,
        }]
    } else {
        vec![
            Member {
                flags: ALL_MEMBER_FLAGS,
                pubkey: player,
            },
            Member {
                flags: ALL_MEMBER_FLAGS,
                pubkey: authority,
            },
        ]
    }
}

struct ManifestSnapshot {
    duration_secs: u32,
    fog_of_war_bps: u16,
    max_rebalances: u16,
    scoring_formula: u8,
    action_binding_mode: u8,
}

fn parse_cartridge_manifest(manifest_info: &AccountInfo) -> Result<ManifestSnapshot> {
    let data = manifest_info.try_borrow_data()?;
    // Layout: 8 disc + 32 slug_hash + 32 creator + 32 creator_fee_vault + 2 creator_share_bps
    // + 1 genre_code + 4 duration_secs + 2 fog_of_war_bps + 2 max_rebalances
    // + 1 scoring_formula + 1 action_binding_mode
    require!(
        data.len() >= 117 && data[0..8] == CARTRIDGE_MANIFEST_DISCRIMINATOR,
        ErRoomError::InvalidManifestData
    );
    let duration_secs = u32::from_le_bytes([data[107], data[108], data[109], data[110]]);
    let fog_of_war_bps = u16::from_le_bytes([data[111], data[112]]);
    let max_rebalances = u16::from_le_bytes([data[113], data[114]]);
    let scoring_formula = data[115];
    let action_binding_mode = data[116];
    require!(
        scoring_formula <= 3 && action_binding_mode <= 3 && max_rebalances >= 1,
        ErRoomError::InvalidManifestData
    );
    Ok(ManifestSnapshot {
        duration_secs,
        fog_of_war_bps,
        max_rebalances,
        scoring_formula,
        action_binding_mode,
    })
}

pub enum OracleHealth {
    Healthy(i64),
    Stale,
    WideConfidence,
}

/// Validates Pyth Receiver / MagicBlock Pricing Oracle (`PriceUpdateV2` / `PriceUpdateV3`) account.
pub fn verify_oracle_health(oracle_info: &AccountInfo, now_ts: i64) -> Result<OracleHealth> {
    require!(
        oracle_info.owner == &PRICING_ORACLE_PROGRAM_ID
            || oracle_info.owner == &PYTH_RECEIVER_PROGRAM_ID,
        ErRoomError::InvalidOracleOwner
    );
    let data = oracle_info.try_borrow_data()?;
    require!(data.len() >= 133, ErRoomError::InvalidOracleData);

    // Byte 40: VerificationLevel (0 => Partial(u8) = 2 bytes; 1 => Full = 1 byte)
    let msg_offset = match data[40] {
        0 => 42usize,
        1 => 41usize,
        _ => return err!(ErRoomError::InvalidOracleData),
    };
    require!(
        data.len() >= msg_offset + 92,
        ErRoomError::InvalidOracleData
    );

    // PriceFeedMessage: 32 feed_id + 8 price + 8 conf + 4 exponent + 8 publish_time + 8 prev + 8 ema_p + 8 ema_c + 8 posted_slot
    let p_off = msg_offset + 32;
    let price = i64::from_le_bytes([
        data[p_off],
        data[p_off + 1],
        data[p_off + 2],
        data[p_off + 3],
        data[p_off + 4],
        data[p_off + 5],
        data[p_off + 6],
        data[p_off + 7],
    ]);
    let c_off = p_off + 8;
    let conf = u64::from_le_bytes([
        data[c_off],
        data[c_off + 1],
        data[c_off + 2],
        data[c_off + 3],
        data[c_off + 4],
        data[c_off + 5],
        data[c_off + 6],
        data[c_off + 7],
    ]);
    let pub_off = c_off + 8 + 4;
    let publish_time = i64::from_le_bytes([
        data[pub_off],
        data[pub_off + 1],
        data[pub_off + 2],
        data[pub_off + 3],
        data[pub_off + 4],
        data[pub_off + 5],
        data[pub_off + 6],
        data[pub_off + 7],
    ]);
    let slot_off = msg_offset + 84;
    let posted_slot = u64::from_le_bytes([
        data[slot_off],
        data[slot_off + 1],
        data[slot_off + 2],
        data[slot_off + 3],
        data[slot_off + 4],
        data[slot_off + 5],
        data[slot_off + 6],
        data[slot_off + 7],
    ]);

    require!(posted_slot > 0 && price > 0, ErRoomError::InvalidOracleData);
    require!(
        publish_time <= now_ts.saturating_add(5),
        ErRoomError::InvalidOracleData
    );

    if now_ts.saturating_sub(publish_time) > PYTH_MAX_STALENESS_SECS {
        return Ok(OracleHealth::Stale);
    }

    let lhs = u128::from(conf)
        .checked_mul(10_000)
        .ok_or(ErRoomError::MathOverflow)?;
    let rhs = u128::from(price.unsigned_abs())
        .checked_mul(PYTH_MAX_CONF_RATIO_BPS)
        .ok_or(ErRoomError::MathOverflow)?;
    if lhs > rhs {
        return Ok(OracleHealth::WideConfidence);
    }

    Ok(OracleHealth::Healthy(price))
}

fn mix_anonymized_rank_digest(
    prev_digest: &[u8; 32],
    player: &Pubkey,
    move_count: u16,
    slot: u64,
) -> [u8; 32] {
    let mut out = *prev_digest;
    let p_bytes = player.to_bytes();
    let mc = move_count.to_le_bytes();
    let sl = slot.to_le_bytes();
    for i in 0..32 {
        let mix = p_bytes[i]
            .wrapping_mul(131)
            .wrapping_add(mc[i & 1])
            .wrapping_add(sl[i & 7]);
        out[i] = out[i].rotate_left(3) ^ mix;
    }
    out
}

pub fn fp_mul(a: i128, b: i128) -> Result<i128> {
    Ok(a.checked_mul(b).ok_or(ErRoomError::MathOverflow)? / SCALE)
}

pub fn fp_div(a: i128, b: i128) -> Result<i128> {
    require!(b != 0, ErRoomError::DivisionByZero);
    Ok(a.checked_mul(SCALE).ok_or(ErRoomError::MathOverflow)? / b)
}

pub fn fp_clamp(val: i128, min_val: i128, max_val: i128) -> i128 {
    if val < min_val {
        min_val
    } else if val > max_val {
        max_val
    } else {
        val
    }
}

pub fn isqrt_u128(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x0 = n;
    let mut x1 = (x0 >> 1) + 1;
    while x1 < x0 {
        x0 = x1;
        x1 = (x0 + n / x0) >> 1;
    }
    x0
}

pub fn compute_direction_neutral_return_scaled(
    weights_bps: &[i16; 4],
    entry_prices_8: &[i64; 4],
    exit_prices_8: &[i64; 4],
    beta_bench_scaled: i128,
) -> Result<i128> {
    let mut abs_weight_sum: i128 = 0;
    let mut weighted_ret_sum: i128 = 0;
    let mut raw_ret_sum: i128 = 0;
    let mut valid_legs: i128 = 0;

    for i in 0..4 {
        let entry = i128::from(entry_prices_8[i]);
        let exit = i128::from(exit_prices_8[i]);
        if entry <= 0 || exit < 0 {
            continue;
        }
        let w_scaled = i128::from(weights_bps[i]) * BPS_TO_SCALE;
        abs_weight_sum = abs_weight_sum
            .checked_add(w_scaled.abs())
            .ok_or(ErRoomError::MathOverflow)?;
        let asset_ret = exit
            .checked_sub(entry)
            .ok_or(ErRoomError::MathOverflow)?
            .checked_mul(SCALE)
            .ok_or(ErRoomError::MathOverflow)?
            / entry;
        weighted_ret_sum = weighted_ret_sum
            .checked_add(fp_mul(w_scaled, asset_ret)?)
            .ok_or(ErRoomError::MathOverflow)?;
        raw_ret_sum = raw_ret_sum
            .checked_add(asset_ret)
            .ok_or(ErRoomError::MathOverflow)?;
        valid_legs += 1;
    }

    require!(abs_weight_sum <= SCALE, ErRoomError::GrossWeightExceedsCap);
    if valid_legs == 0 {
        return Ok(0);
    }

    let bench_mean = raw_ret_sum / valid_legs;
    let bench_adj = fp_mul(beta_bench_scaled, bench_mean)?;
    weighted_ret_sum
        .checked_sub(bench_adj)
        .ok_or_else(|| error!(ErRoomError::MathOverflow))
}

pub fn compute_drawdown_penalized_sharpe_scaled(
    step_returns_scaled: &[i64],
    max_drawdown_scaled: i64,
    lambda_dd_scaled: i128,
) -> Result<i128> {
    if step_returns_scaled.is_empty() {
        return Ok(0);
    }
    require!(max_drawdown_scaled >= 0, ErRoomError::MathOverflow);

    let k_i128 =
        i128::try_from(step_returns_scaled.len()).map_err(|_| ErRoomError::MathOverflow)?;
    let mut sum_returns: i128 = 0;
    for r in step_returns_scaled {
        sum_returns = sum_returns
            .checked_add(i128::from(*r))
            .ok_or(ErRoomError::MathOverflow)?;
    }
    let mean_return = sum_returns / k_i128;

    let mut sum_sq_diff_18: u128 = 0;
    for r in step_returns_scaled {
        let diff = i128::from(*r)
            .checked_sub(mean_return)
            .ok_or(ErRoomError::MathOverflow)?;
        let abs_diff = diff.unsigned_abs();
        let sq = abs_diff
            .checked_mul(abs_diff)
            .ok_or(ErRoomError::MathOverflow)?;
        sum_sq_diff_18 = sum_sq_diff_18
            .checked_add(sq)
            .ok_or(ErRoomError::MathOverflow)?;
    }

    let stabilized = sum_sq_diff_18
        .checked_add(DEFAULT_SHARPE_EPSILON_SQ_18)
        .ok_or(ErRoomError::MathOverflow)?;
    let denom_scaled =
        i128::try_from(isqrt_u128(stabilized)).map_err(|_| ErRoomError::MathOverflow)?;
    let raw_sharpe = fp_div(sum_returns, denom_scaled)?;
    let dd_penalty = fp_mul(lambda_dd_scaled, i128::from(max_drawdown_scaled))?;

    raw_sharpe
        .checked_sub(dd_penalty)
        .ok_or_else(|| error!(ErRoomError::MathOverflow))
}

pub fn compute_kalshi_brier_scaled(prob_bps: u16, outcome_yes_code: u8) -> Result<i128> {
    let f_scaled = fp_clamp(i128::from(prob_bps) * BPS_TO_SCALE, 0, SCALE);
    let o_scaled = if outcome_yes_code == 2 { SCALE } else { 0 };
    let diff = f_scaled
        .checked_sub(o_scaled)
        .ok_or(ErRoomError::MathOverflow)?;
    let sq_scaled = diff.checked_mul(diff).ok_or(ErRoomError::MathOverflow)? / SCALE;
    SCALE
        .checked_sub(sq_scaled)
        .ok_or_else(|| error!(ErRoomError::MathOverflow))
}

pub fn compute_multi_stage_carry_scaled(
    stage1_score_scaled: i128,
    stage2_score_scaled: i128,
    max_multiplier_scaled: i128,
) -> Result<i128> {
    let clamped_s1 = fp_clamp(stage1_score_scaled, 0, SCALE);
    let mult_excess = max_multiplier_scaled
        .checked_sub(SCALE)
        .ok_or(ErRoomError::MathOverflow)?;
    let bonus = fp_mul(mult_excess, clamped_s1)?;
    let multiplier = SCALE.checked_add(bonus).ok_or(ErRoomError::MathOverflow)?;
    fp_mul(stage2_score_scaled, multiplier)
}

fn compute_player_score_scaled(
    scoring_formula: u8,
    stance: &PlayerStance,
    exit_prices_8: &[i64; 4],
    beta_bench_scaled: i128,
    lambda_dd_scaled: i128,
    kalshi_outcome_yes: u8,
    max_multiplier_scaled: i128,
) -> Result<i128> {
    let rel_score = compute_direction_neutral_return_scaled(
        &stance.weights_bps,
        &stance.entry_prices_8,
        exit_prices_8,
        beta_bench_scaled,
    )?;

    match scoring_formula {
        0 => Ok(rel_score),
        1 => {
            let count = usize::from(stance.step_count).min(stance.step_returns_scaled.len());
            if count == 0 {
                let fallback = [i64::try_from(rel_score).unwrap_or(0)];
                compute_drawdown_penalized_sharpe_scaled(
                    &fallback,
                    stance.max_drawdown_scaled,
                    lambda_dd_scaled,
                )
            } else {
                compute_drawdown_penalized_sharpe_scaled(
                    &stance.step_returns_scaled[..count],
                    stance.max_drawdown_scaled,
                    lambda_dd_scaled,
                )
            }
        }
        2 => compute_kalshi_brier_scaled(stance.kalshi_prob_bps, kalshi_outcome_yes),
        3 => compute_multi_stage_carry_scaled(
            i128::from(stance.stage1_score_scaled),
            rel_score,
            max_multiplier_scaled,
        ),
        _ => err!(ErRoomError::InvalidManifestData),
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum RoomPhase {
    LobbyOpen,
    FogOfWar,
    Showdown,
    SettledCommitted,
    RetryGrace,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeRoomShardArgs {
    pub event_id: [u8; 32],
    pub shard_index: u16,
    pub start_ts: i64,
    pub room_pool_usdc: u64,
    pub crank_task_id: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubmitStanceArgs {
    pub weights_bps: [i16; 4],
    pub kalshi_binary_call: u8,
    pub kalshi_prob_bps: u16,
    pub secondary_prices_8: [i64; 3],
    pub stage1_score_scaled: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EvaluateScoreArgs {
    pub secondary_exit_prices_8: [i64; 3],
    pub beta_bench_scaled: i128,
    pub lambda_dd_scaled: i128,
    pub kalshi_outcome_yes: u8,
    pub max_multiplier_scaled: i128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ActionAccountSpec {
    pub pubkey: Pubkey,
    pub is_writable: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SettleShardArgs {
    pub schedule_vault_action: bool,
    pub vault_action_accounts: Vec<ActionAccountSpec>,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct RoomShard {
    pub event_id: [u8; 32],
    pub shard_index: u16,
    pub cartridge_manifest: Pubkey,
    pub authority: Pubkey,
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

#[account]
#[derive(InitSpace, Debug)]
pub struct PlayerStance {
    pub room_shard: Pubkey,
    pub player: Pubkey,
    pub ephemeral_session_key: Pubkey,
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

#[derive(Accounts)]
#[instruction(args: InitializeRoomShardArgs)]
pub struct InitializeRoomShard<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Verified owner == CARTRIDGE_REGISTRY_ID and parsed in handler.
    pub cartridge_manifest: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + RoomShard::INIT_SPACE,
        seeds = [SEED_ROOM_SHARD, args.event_id.as_ref(), &args.shard_index.to_le_bytes()],
        bump
    )]
    pub room_shard: Account<'info, RoomShard>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(event_id: [u8; 32], shard_index: u16)]
pub struct DelegateRoomShard<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Delegated PDA; owner and authority verified before delegation CPI.
    #[account(
        mut,
        del,
        seeds = [SEED_ROOM_SHARD, event_id.as_ref(), &shard_index.to_le_bytes()],
        bump
    )]
    pub room_shard: UncheckedAccount<'info>,
    /// CHECK: Optional target ER / TEE validator identity.
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct ScheduleRoomCrank<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump,
        has_one = authority @ ErRoomError::UnauthorizedAuthority
    )]
    pub room_shard: Account<'info, RoomShard>,
    /// CHECK: Derived crank executor PDA verified in handler.
    pub crank_signer: UncheckedAccount<'info>,
    /// CHECK: Magic Program verified by address constraint.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CrankTickRoom<'info> {
    #[account(
        address = crank_signer_pda(&room_shard.authority) @ ErRoomError::UnauthorizedCrankSigner
    )]
    pub crank_signer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump
    )]
    pub room_shard: Account<'info, RoomShard>,
}

#[delegate]
#[derive(Accounts)]
pub struct InitStanceAndDelegate<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: Verified owner (crate::ID or delegation program) and deserialized for end_ts bound.
    pub room_shard: UncheckedAccount<'info>,
    /// CHECK: PlayerStance PDA initialized and delegated in handler (`del` requires UncheckedAccount).
    #[account(
        mut,
        del,
        seeds = [SEED_PLAYER_STANCE, room_shard.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_stance: UncheckedAccount<'info>,
    /// CHECK: Optional target ER / TEE validator identity.
    pub validator: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
    /// CHECK: The owner program of the delegated PDA (declared explicitly so `room_authority` is last).
    #[account(address = crate::ID)]
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: The delegation program.
    #[account(address = ephemeral_rollups_sdk::id())]
    pub delegation_program: UncheckedAccount<'info>,
    /// Room authority co-signer; must equal `RoomShard.authority` (checked in the handler, which
    /// reads the shard whether it is owned by this program or by the delegation program).
    pub room_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct JoinRoomAndInitPermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump
    )]
    pub room_shard: Account<'info, RoomShard>,
    #[account(
        mut,
        seeds = [SEED_PLAYER_STANCE, room_shard.key().as_ref(), player_stance.player.as_ref()],
        bump = player_stance.bump,
        has_one = room_shard @ ErRoomError::ShardMismatch
    )]
    pub player_stance: Account<'info, PlayerStance>,
    /// CHECK: Derived under MagicBlock Permission Program (`ACLseoPoy...`).
    #[account(
        mut,
        seeds = [PERMISSION_SEED, player_stance.key().as_ref()],
        bump,
        seeds::program = permission_program.key()
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Address pinned to PERMISSION_PROGRAM_ID.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Address pinned to EPHEMERAL_VAULT_ID.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Address pinned to MAGIC_PROGRAM_ID.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// Room authority co-signer: every counted seat is authority-approved (C1).
    #[account(address = room_shard.authority @ ErRoomError::UnauthorizedAuthority)]
    pub room_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SubmitStance<'info> {
    pub session_signer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump
    )]
    pub room_shard: Account<'info, RoomShard>,
    #[account(
        mut,
        seeds = [SEED_PLAYER_STANCE, room_shard.key().as_ref(), player_stance.player.as_ref()],
        bump = player_stance.bump,
        has_one = room_shard @ ErRoomError::ShardMismatch
    )]
    pub player_stance: Account<'info, PlayerStance>,
    /// CHECK: Verified owner (`PriCems...` or `rec5EK...`), freshness <= 15s, and conf <= 150 bps.
    pub oracle_feed: UncheckedAccount<'info>,
    /// Room authority co-signer: attests the entry prices and the timing of every move (C1).
    #[account(address = room_shard.authority @ ErRoomError::UnauthorizedAuthority)]
    pub room_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerShowdownUnseal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump,
        has_one = authority @ ErRoomError::UnauthorizedAuthority
    )]
    pub room_shard: Account<'info, RoomShard>,
    #[account(
        mut,
        seeds = [SEED_PLAYER_STANCE, room_shard.key().as_ref(), player_stance.player.as_ref()],
        bump = player_stance.bump,
        has_one = room_shard @ ErRoomError::ShardMismatch
    )]
    pub player_stance: Account<'info, PlayerStance>,
    /// CHECK: Derived under MagicBlock Permission Program (`ACLseoPoy...`).
    #[account(
        mut,
        seeds = [PERMISSION_SEED, player_stance.key().as_ref()],
        bump,
        seeds::program = permission_program.key()
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Address pinned to PERMISSION_PROGRAM_ID.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Address pinned to EPHEMERAL_VAULT_ID.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Address pinned to MAGIC_PROGRAM_ID.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestSettlementVrf<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump,
        has_one = authority @ ErRoomError::UnauthorizedAuthority
    )]
    pub room_shard: Account<'info, RoomShard>,
    /// CHECK: Validated against MagicBlock VRF default & test queues.
    #[account(
        mut,
        constraint =
            oracle_queue.key() == vrf::consts::DEFAULT_QUEUE ||
            oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE ||
            oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE ||
            oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
            @ ErRoomError::InvalidVrfQueue
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackSettlementVrf<'info> {
    /// Scoped VRF identity PDA, bound to this program. Its presence as a signer proves
    /// the callback was issued by the VRF program for this program.
    #[account(constraint = vrf_program_identity.key() == SCOPED_VRF_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump
    )]
    pub room_shard: Account<'info, RoomShard>,
}

#[derive(Accounts)]
pub struct EvaluatePlayerScore<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump,
        has_one = authority @ ErRoomError::UnauthorizedAuthority
    )]
    pub room_shard: Account<'info, RoomShard>,
    #[account(
        mut,
        seeds = [SEED_PLAYER_STANCE, room_shard.key().as_ref(), player_stance.player.as_ref()],
        bump = player_stance.bump,
        has_one = room_shard @ ErRoomError::ShardMismatch
    )]
    pub player_stance: Account<'info, PlayerStance>,
    /// CHECK: Verified Pyth/MagicBlock oracle; stale or wide conf transitions cleanly to RetryGrace.
    pub oracle_feed: UncheckedAccount<'info>,
    /// CHECK: Derived under MagicBlock Permission Program (`ACLseoPoy...`).
    #[account(
        mut,
        seeds = [PERMISSION_SEED, player_stance.key().as_ref()],
        bump,
        seeds::program = permission_program.key()
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Address pinned to PERMISSION_PROGRAM_ID.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Address pinned to EPHEMERAL_VAULT_ID.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Address pinned to MAGIC_PROGRAM_ID.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegatePlayerStance<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [SEED_ROOM_SHARD, room_shard.event_id.as_ref(), &room_shard.shard_index.to_le_bytes()],
        bump = room_shard.bump,
        has_one = authority @ ErRoomError::UnauthorizedAuthority
    )]
    pub room_shard: Account<'info, RoomShard>,
    #[account(
        mut,
        seeds = [SEED_PLAYER_STANCE, room_shard.key().as_ref(), player_stance.player.as_ref()],
        bump = player_stance.bump,
        has_one = room_shard @ ErRoomError::ShardMismatch
    )]
    pub player_stance: Account<'info, PlayerStance>,
}

#[commit]
#[derive(Accounts)]
pub struct SettleAndCommitShard<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Verified owner == crate::ID, PDA seeds, bump, and authority in handler; UncheckedAccount prevents post-undelegation exit write (`ExternalAccountDataModified`).
    #[account(mut)]
    pub room_shard: UncheckedAccount<'info>,
    /// CHECK: Verified Pyth/MagicBlock oracle; stale or wide conf transitions cleanly to RetryGrace.
    pub oracle_feed: UncheckedAccount<'info>,
    /// CHECK: Derived under MagicBlock Permission Program (`ACLseoPoy...`); writable only when closing an active permission.
    #[account(
        seeds = [PERMISSION_SEED, room_shard.key().as_ref()],
        bump,
        seeds::program = permission_program.key()
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Address pinned to PERMISSION_PROGRAM_ID.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Address pinned to EPHEMERAL_VAULT_ID.
    #[account(address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Destination program for optional post-commit vault settlement action.
    #[account(address = CARTRIDGE_VAULT_ROUTER_ID)]
    pub vault_router_program: UncheckedAccount<'info>,
}

#[event]
pub struct RoomShardInitialized {
    pub room_shard: Pubkey,
    pub event_id: [u8; 32],
    pub shard_index: u16,
    pub authority: Pubkey,
    pub start_ts: i64,
    pub unseal_ts: i64,
    pub end_ts: i64,
    pub is_private_fog: bool,
}

#[event]
pub struct RoomShowdownUnsealed {
    pub room_shard: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SettlementVrfFulfilled {
    pub room_shard: Pubkey,
    pub request_nonce: u64,
    pub vrf_seed: [u8; 32],
}

#[event]
pub struct RoomEnteredRetryGrace {
    pub room_shard: Pubkey,
    pub reason_code: u8,
    pub timestamp: i64,
}

#[error_code]
pub enum ErRoomError {
    #[msg("Event ID cannot be all zeroes")]
    InvalidEventId,
    #[msg("Cartridge manifest account has invalid program owner")]
    InvalidManifestOwner,
    #[msg("Cartridge manifest account data is malformed")]
    InvalidManifestData,
    #[msg("Cartridge duration must be at least 30 seconds")]
    InvalidManifestDuration,
    #[msg("Room shard has invalid program owner")]
    InvalidShardOwner,
    #[msg("Caller is not the authorized room authority")]
    UnauthorizedAuthority,
    #[msg("Caller is not the authorized crank executor PDA")]
    UnauthorizedCrankSigner,
    #[msg("Invalid crank interval or iteration count")]
    InvalidCrankSchedule,
    #[msg("Invalid ephemeral session key")]
    InvalidSessionKey,
    #[msg("Session key expiry must fall within room start and end bounds")]
    SessionExpiryExceedsRoomEnd,
    #[msg("Caller is not authorized for this player stance")]
    UnauthorizedPlayer,
    #[msg("Player stance does not belong to this room shard")]
    ShardMismatch,
    #[msg("Room shard is full (MAX_PLAYERS_PER_SHARD = 200)")]
    ShardFull,
    #[msg("Permission member count exceeds funded capacity")]
    TooManyPermissionMembers,
    #[msg("Operation not permitted in current room phase")]
    InvalidRoomPhase,
    #[msg("Signer does not match bound ephemeral session key")]
    InvalidSessionSigner,
    #[msg("Session key or room submission window has expired")]
    SessionExpired,
    #[msg("Player has not joined the ER room")]
    PlayerNotJoined,
    #[msg("Maximum rebalances exceeded for this room")]
    MaxRebalancesExceeded,
    #[msg("Three-lane stance checkpoint cooldown is active")]
    LaneCheckpointCooldownActive,
    #[msg("Gross conviction weight sum(|w_i|) exceeds 10,000 bps")]
    GrossWeightExceedsCap,
    #[msg("Invalid Kalshi binary call or probability bounds")]
    InvalidKalshiForecast,
    #[msg("Oracle feed has an untrusted owner program")]
    InvalidOracleOwner,
    #[msg("Oracle feed data is malformed or uninitialized")]
    InvalidOracleData,
    #[msg("Pyth oracle tick is older than 15 seconds")]
    StaleOraclePrice,
    #[msg("Pyth oracle confidence width exceeds 150 bps (1.50%)")]
    OracleConfidenceTooWide,
    #[msg("Showdown unseal timestamp has not been reached")]
    UnsealTimestampNotReached,
    #[msg("Unsupported VRF oracle queue")]
    InvalidVrfQueue,
    #[msg("VRF callback nonce does not match active request")]
    SupersededVrfCallback,
    #[msg("VRF randomness has not been fulfilled for settlement")]
    VrfNotFulfilled,
    #[msg("Cannot settle room before end timestamp")]
    SettlementBeforeRoomEnd,
    #[msg("All joined player stances must be evaluated before shard commit")]
    PendingPlayerEvaluations,
    #[msg("Player stance must be evaluated before undelegation")]
    PlayerNotEvaluated,
    #[msg("Division by zero in fixed-point math")]
    DivisionByZero,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("The sealed entry must land before the room start timestamp")]
    EntryAfterStart,
    #[msg("Pivots are only allowed while the room is live (start_ts <= now < end_ts)")]
    PivotOutsideLiveWindow,
    #[msg("Authority-attested entry prices must all be positive")]
    InvalidAttestedPrice,
}
