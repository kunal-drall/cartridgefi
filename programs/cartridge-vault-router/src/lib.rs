#![allow(unexpected_cfgs, clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use cartridge_registry::{
    cpi as registry_cpi, program::CartridgeRegistry, CartridgeManifestAccount, EngineConfig,
    SEED_CARTRIDGE, SEED_ENGINE_CONFIG,
};
use ephemeral_rollups_sdk::anchor::action;

declare_id!("6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT");

pub const BPS_DENOM: u128 = 10_000;
pub const ACTION_ESCROW_INDEX: u8 = 255;

pub const BETA_MAX_ROOM_POOL_USDC: u64 = 500_000_000;
pub const BETA_MAX_GLOBAL_TVL_USDC: u64 = 5_000_000_000;
pub const MAX_LIVE_LEVERAGE: u8 = 5;
pub const MAX_TOTAL_FEE_BPS: u16 = 1_000;
pub const MAX_CREATOR_SHARE_BPS: u16 = 5_000;

pub const PARTNER_WALLET_SHARE_BPS: u128 = 4_000;
pub const PARTNER_CREATOR_SHARE_BPS: u128 = 3_000;
pub const SHAPLEY_WEIGHT_BASE: u128 = 2_520_000;

pub const BIT_CAN_CLAIM_XSTOCKS: u8 = 2;

pub const SEED_ROOM_VAULT: &[u8] = b"room_vault";
pub const SEED_ROOM_VAULT_TOKEN: &[u8] = b"room_vault_token";
pub const SEED_SESSION_ENVELOPE: &[u8] = b"session_envelope";
pub const SEED_VAULT_ROUTER_AUTH: &[u8] = b"vault_router_auth";
pub const SEED_PASSPORT: &[u8] = b"passport";

pub const ER_ROOM_PROGRAM_ID: Pubkey = pubkey!("Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR");
pub const PASSPORT_PROGRAM_ID: Pubkey = pubkey!("5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr");

pub const CANONICAL_NVDAX_MINT: Pubkey = pubkey!("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
pub const CANONICAL_SPYX_MINT: Pubkey = pubkey!("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
pub const CANONICAL_ANTX_MINT: Pubkey = pubkey!("XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb");

pub const ROOM_SHARD_DISCRIMINATOR: [u8; 8] = [0x46, 0xa0, 0x4a, 0xdc, 0x0d, 0x83, 0x5d, 0x6c];
pub const PLAYER_STANCE_DISCRIMINATOR: [u8; 8] = [0x22, 0x1f, 0xf1, 0xf4, 0x50, 0xa3, 0x53, 0x2b];
pub const MARKET_PASSPORT_DISCRIMINATOR: [u8; 8] = [0xea, 0x88, 0x5c, 0xc2, 0x2e, 0xf0, 0xfd, 0x08];

#[program]
pub mod cartridge_vault_router {
    use super::*;

    pub fn initialize_room_vault(
        ctx: Context<InitializeRoomVault>,
        total_fee_bps: u16,
        partner_wallet_active: bool,
    ) -> Result<()> {
        let engine_cfg = &ctx.accounts.engine_config;
        let manifest = &ctx.accounts.cartridge_manifest;

        require!(!engine_cfg.paused, VaultError::EnginePaused);
        require!(
            total_fee_bps <= MAX_TOTAL_FEE_BPS,
            VaultError::FeeBpsExceedsCap
        );
        require!(
            manifest.creator_share_bps <= MAX_CREATOR_SHARE_BPS,
            VaultError::CreatorShareExceedsCap
        );
        require_keys_eq!(
            ctx.accounts.platform_fee_account.key(),
            engine_cfg.platform_fee_account,
            VaultError::InvalidFeeDestination
        );
        require_keys_eq!(
            ctx.accounts.creator_fee_vault.key(),
            manifest.creator_fee_vault,
            VaultError::InvalidFeeDestination
        );

        let partner_vault_key = if partner_wallet_active {
            let p_vault = ctx
                .accounts
                .partner_fee_vault
                .as_deref()
                .ok_or(VaultError::MissingPartnerFeeVault)?;
            require_keys_eq!(
                p_vault.mint,
                ctx.accounts.usdc_mint.key(),
                VaultError::MintMismatch
            );
            p_vault.key()
        } else {
            Pubkey::default()
        };

        let vault = &mut ctx.accounts.room_vault;
        vault.room_shard = ctx.accounts.room_shard.key();
        vault.authority = ctx.accounts.authority.key();
        vault.usdc_mint = ctx.accounts.usdc_mint.key();
        vault.vault_usdc_token = ctx.accounts.vault_usdc_token.key();
        vault.cartridge_manifest = manifest.key();
        vault.creator_fee_vault = ctx.accounts.creator_fee_vault.key();
        vault.platform_fee_account = ctx.accounts.platform_fee_account.key();
        vault.partner_fee_vault = partner_vault_key;
        vault.partner_wallet_active = partner_wallet_active;
        vault.creator_share_bps = manifest.creator_share_bps;
        vault.total_fee_bps = total_fee_bps;
        vault.room_pool_usdc = 0;
        vault.total_distributed_usdc = 0;
        vault.total_claimed_usdc = 0;
        vault.settled = false;
        vault.bump = ctx.bumps.room_vault;

        Ok(())
    }

    pub fn open_session_envelope(
        ctx: Context<OpenSessionEnvelope>,
        principal_usdc: u64,
        leverage: u8,
        ephemeral_session_key: Pubkey,
    ) -> Result<()> {
        let player_key = ctx.accounts.player.key();
        require!(
            ephemeral_session_key != Pubkey::default() && player_key != ephemeral_session_key,
            VaultError::SessionKeyPrivilegeEscalation
        );
        require!(
            (1..=MAX_LIVE_LEVERAGE).contains(&leverage),
            VaultError::LeverageExceedsCap
        );
        require!(principal_usdc > 0, VaultError::ZeroPrincipal);

        let engine_cfg = &ctx.accounts.engine_config;
        require!(!engine_cfg.paused, VaultError::EnginePaused);

        let vault = &mut ctx.accounts.room_vault;
        require!(!vault.settled, VaultError::VaultAlreadySettled);

        let next_room_pool = vault
            .room_pool_usdc
            .checked_add(principal_usdc)
            .ok_or(VaultError::MathOverflow)?;
        let next_global_tvl = engine_cfg
            .current_global_tvl_usdc
            .checked_add(principal_usdc)
            .ok_or(VaultError::MathOverflow)?;

        if engine_cfg.private_beta_mode {
            require!(
                next_room_pool <= BETA_MAX_ROOM_POOL_USDC,
                VaultError::BetaRoomPoolCapExceeded
            );
            require!(
                next_global_tvl <= BETA_MAX_GLOBAL_TVL_USDC,
                VaultError::BetaGlobalTvlCapExceeded
            );
        }
        require!(
            next_room_pool <= engine_cfg.max_room_pool_usdc,
            VaultError::RoomPoolCapExceeded
        );
        require!(
            next_global_tvl <= engine_cfg.max_global_tvl_usdc,
            VaultError::GlobalTvlCapExceeded
        );

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.player_usdc_ata.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault_usdc_token.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            principal_usdc,
            ctx.accounts.usdc_mint.decimals,
        )?;

        let delta_i64 = i64::try_from(principal_usdc).map_err(|_| VaultError::MathOverflow)?;
        let auth_seeds: &[&[u8]] = &[SEED_VAULT_ROUTER_AUTH, &[ctx.bumps.vault_router_auth]];
        registry_cpi::sync_global_tvl(
            CpiContext::new_with_signer(
                ctx.accounts.registry_program.key(),
                registry_cpi::accounts::SyncGlobalTvl {
                    authority: ctx.accounts.vault_router_auth.to_account_info(),
                    engine_config: ctx.accounts.engine_config.to_account_info(),
                },
                &[auth_seeds],
            ),
            delta_i64,
        )?;

        vault.room_pool_usdc = next_room_pool;

        let env = &mut ctx.accounts.session_envelope;
        env.room_shard = vault.room_shard;
        env.player = player_key;
        env.ephemeral_session_key = ephemeral_session_key;
        env.principal_usdc = principal_usdc;
        env.leverage = leverage;
        env.payout_usdc = 0;
        env.rank = 0;
        env.settled = false;
        env.claimed = false;
        env.claimed_mint = Pubkey::default();
        env.bump = ctx.bumps.session_envelope;

        emit!(SessionEnvelopeOpened {
            room_shard: vault.room_shard,
            player: player_key,
            principal_usdc,
            leverage,
            room_pool_usdc: next_room_pool,
        });
        Ok(())
    }

    pub fn distribute_pool_and_fees<'info>(
        ctx: Context<'info, DistributePoolDirect<'info>>,
    ) -> Result<()> {
        execute_pool_distribution(
            &mut ctx.accounts.room_vault,
            &ctx.accounts.room_shard,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.vault_usdc_token,
            &ctx.accounts.platform_fee_account,
            &ctx.accounts.creator_fee_vault,
            ctx.accounts.partner_fee_vault.as_deref(),
            &ctx.accounts.token_program,
            &ctx.accounts.engine_config,
            &ctx.accounts.vault_router_auth,
            ctx.bumps.vault_router_auth,
            &ctx.accounts.registry_program,
            ctx.remaining_accounts,
        )
    }

    pub fn distribute_pool_action<'info>(
        ctx: Context<'info, DistributePoolAction<'info>>,
    ) -> Result<()> {
        let rem = ctx.remaining_accounts;
        let pair_accounts = if rem.len() >= 3
            && rem[rem.len() - 3].key() == ER_ROOM_PROGRAM_ID
            && rem[rem.len() - 2].key() == ctx.accounts.escrow_auth.key()
            && rem[rem.len() - 1].key() == ctx.accounts.escrow.key()
        {
            &rem[..rem.len() - 3]
        } else {
            rem
        };
        execute_pool_distribution(
            &mut ctx.accounts.room_vault,
            &ctx.accounts.room_shard,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.vault_usdc_token,
            &ctx.accounts.platform_fee_account,
            &ctx.accounts.creator_fee_vault,
            ctx.accounts.partner_fee_vault.as_deref(),
            &ctx.accounts.token_program,
            &ctx.accounts.engine_config,
            &ctx.accounts.vault_router_auth,
            ctx.bumps.vault_router_auth,
            &ctx.accounts.registry_program,
            pair_accounts,
        )
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, xstock_units_out: u64) -> Result<()> {
        let player_key = ctx.accounts.player.key();
        let vault = &mut ctx.accounts.room_vault;
        let env = &mut ctx.accounts.session_envelope;

        require_keys_eq!(player_key, env.player, VaultError::Unauthorized);
        require!(
            player_key != env.ephemeral_session_key,
            VaultError::SessionKeyPrivilegeEscalation
        );
        require!(vault.settled && env.settled, VaultError::VaultNotYetSettled);
        require!(!env.claimed, VaultError::PrizeAlreadyClaimed);
        require!(env.payout_usdc > 0, VaultError::ZeroPrizePayout);

        let desired_mint_key = ctx.accounts.desired_mint.key();
        let room_shard_key = vault.room_shard;
        let vault_bump = vault.bump;
        let vault_seeds: &[&[u8]] = &[SEED_ROOM_VAULT, room_shard_key.as_ref(), &[vault_bump]];

        if desired_mint_key == vault.usdc_mint {
            require_keys_eq!(
                ctx.accounts.player_destination_ata.mint,
                vault.usdc_mint,
                VaultError::MintMismatch
            );
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault_usdc_token.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ctx.accounts.player_destination_ata.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                    &[vault_seeds],
                ),
                env.payout_usdc,
                ctx.accounts.usdc_mint.decimals,
            )?;
        } else {
            let passport_info = ctx
                .accounts
                .market_passport
                .as_ref()
                .ok_or(VaultError::MissingPassportForXStocks)?;
            verify_xstocks_passport_eligibility(passport_info, &player_key)?;

            require!(xstock_units_out > 0, VaultError::InvalidXStockUnits);
            let xstock_reserve = ctx
                .accounts
                .xstock_reserve_token
                .as_deref()
                .ok_or(VaultError::MissingXStockReserve)?;
            let settlement_usdc = ctx
                .accounts
                .settlement_usdc_ata
                .as_deref()
                .ok_or(VaultError::MissingXStockReserve)?;

            require!(
                desired_mint_key == CANONICAL_NVDAX_MINT
                    || desired_mint_key == CANONICAL_SPYX_MINT
                    || desired_mint_key == CANONICAL_ANTX_MINT
                    || desired_mint_key == xstock_reserve.mint,
                VaultError::UnsupportedPayoutMint
            );
            require_keys_eq!(
                xstock_reserve.mint,
                desired_mint_key,
                VaultError::MintMismatch
            );
            require_keys_eq!(xstock_reserve.owner, vault.key(), VaultError::Unauthorized);
            require_keys_eq!(
                ctx.accounts.player_destination_ata.mint,
                desired_mint_key,
                VaultError::MintMismatch
            );
            require_keys_eq!(
                settlement_usdc.mint,
                vault.usdc_mint,
                VaultError::MintMismatch
            );

            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault_usdc_token.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: settlement_usdc.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                    &[vault_seeds],
                ),
                env.payout_usdc,
                ctx.accounts.usdc_mint.decimals,
            )?;

            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: xstock_reserve.to_account_info(),
                        mint: ctx.accounts.desired_mint.to_account_info(),
                        to: ctx.accounts.player_destination_ata.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                    &[vault_seeds],
                ),
                xstock_units_out,
                ctx.accounts.desired_mint.decimals,
            )?;
        }

        let payout_i64 = i64::try_from(env.payout_usdc).map_err(|_| VaultError::MathOverflow)?;
        let auth_seeds: &[&[u8]] = &[SEED_VAULT_ROUTER_AUTH, &[ctx.bumps.vault_router_auth]];
        registry_cpi::sync_global_tvl(
            CpiContext::new_with_signer(
                ctx.accounts.registry_program.key(),
                registry_cpi::accounts::SyncGlobalTvl {
                    authority: ctx.accounts.vault_router_auth.to_account_info(),
                    engine_config: ctx.accounts.engine_config.to_account_info(),
                },
                &[auth_seeds],
            ),
            -payout_i64,
        )?;

        env.claimed = true;
        env.claimed_mint = desired_mint_key;
        vault.total_claimed_usdc = vault
            .total_claimed_usdc
            .checked_add(env.payout_usdc)
            .ok_or(VaultError::MathOverflow)?;

        emit!(PrizeClaimed {
            room_shard: vault.room_shard,
            player: player_key,
            payout_usdc: env.payout_usdc,
            claimed_mint: desired_mint_key,
            xstock_units_out,
        });
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn execute_pool_distribution<'info>(
    vault: &mut Account<'info, RoomVault>,
    room_shard_info: &UncheckedAccount<'info>,
    usdc_mint: &InterfaceAccount<'info, Mint>,
    vault_usdc_token: &InterfaceAccount<'info, TokenAccount>,
    platform_fee_account: &InterfaceAccount<'info, TokenAccount>,
    creator_fee_vault: &InterfaceAccount<'info, TokenAccount>,
    partner_fee_vault: Option<&InterfaceAccount<'info, TokenAccount>>,
    token_program: &Interface<'info, TokenInterface>,
    engine_config: &Account<'info, EngineConfig>,
    vault_router_auth: &UncheckedAccount<'info>,
    vault_router_auth_bump: u8,
    registry_program: &Program<'info, CartridgeRegistry>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    require!(!vault.settled, VaultError::VaultAlreadySettled);
    require!(
        room_shard_info.owner == &ER_ROOM_PROGRAM_ID,
        VaultError::RoomShardNotCommittedToL1
    );

    let expected_player_count = parse_settled_room_shard(room_shard_info)?;
    require!(
        remaining_accounts.len() == usize::from(expected_player_count) * 2,
        VaultError::InvalidSettlementAccountPairs
    );

    let mut score_inputs: Vec<PlayerScoreEntry> =
        Vec::with_capacity(usize::from(expected_player_count));
    for pair_idx in 0..usize::from(expected_player_count) {
        let stance_info = &remaining_accounts[pair_idx * 2];
        let env_info = &remaining_accounts[pair_idx * 2 + 1];

        require!(
            stance_info.owner == &ER_ROOM_PROGRAM_ID,
            VaultError::InvalidStanceAccount
        );
        require!(
            env_info.owner == &crate::ID && env_info.is_writable,
            VaultError::InvalidEnvelopeAccount
        );

        let (stance_room, stance_player, stance_score, evaluated) =
            parse_player_stance(stance_info)?;
        require_keys_eq!(stance_room, vault.room_shard, VaultError::ShardMismatch);
        require!(evaluated, VaultError::StanceNotEvaluated);

        let (expected_env_pda, _) = Pubkey::find_program_address(
            &[
                SEED_SESSION_ENVELOPE,
                vault.room_shard.as_ref(),
                stance_player.as_ref(),
            ],
            &crate::ID,
        );
        require_keys_eq!(
            env_info.key(),
            expected_env_pda,
            VaultError::InvalidEnvelopeAccount
        );

        for prev in &score_inputs {
            require!(
                prev.player != stance_player,
                VaultError::DuplicatePlayerInSettlement
            );
        }

        score_inputs.push(PlayerScoreEntry {
            player: stance_player,
            score_scaled: stance_score,
        });
    }

    let dist = compute_pool_and_fee_distribution(
        vault.room_pool_usdc,
        vault.total_fee_bps,
        vault.creator_share_bps,
        vault.partner_wallet_active,
        &score_inputs,
    )?;

    let room_shard_key = vault.room_shard;
    let vault_bump = vault.bump;
    let vault_seeds: &[&[u8]] = &[SEED_ROOM_VAULT, room_shard_key.as_ref(), &[vault_bump]];

    if dist.platform_fee_usdc > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                token_program.key(),
                TransferChecked {
                    from: vault_usdc_token.to_account_info(),
                    mint: usdc_mint.to_account_info(),
                    to: platform_fee_account.to_account_info(),
                    authority: vault.to_account_info(),
                },
                &[vault_seeds],
            ),
            dist.platform_fee_usdc,
            usdc_mint.decimals,
        )?;
    }

    if dist.creator_fee_usdc > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                token_program.key(),
                TransferChecked {
                    from: vault_usdc_token.to_account_info(),
                    mint: usdc_mint.to_account_info(),
                    to: creator_fee_vault.to_account_info(),
                    authority: vault.to_account_info(),
                },
                &[vault_seeds],
            ),
            dist.creator_fee_usdc,
            usdc_mint.decimals,
        )?;
    }

    if dist.partner_fee_usdc > 0 {
        let p_vault = partner_fee_vault.ok_or(VaultError::MissingPartnerFeeVault)?;
        require_keys_eq!(
            p_vault.key(),
            vault.partner_fee_vault,
            VaultError::InvalidFeeDestination
        );
        transfer_checked(
            CpiContext::new_with_signer(
                token_program.key(),
                TransferChecked {
                    from: vault_usdc_token.to_account_info(),
                    mint: usdc_mint.to_account_info(),
                    to: p_vault.to_account_info(),
                    authority: vault.to_account_info(),
                },
                &[vault_seeds],
            ),
            dist.partner_fee_usdc,
            usdc_mint.decimals,
        )?;
    }

    for pair_idx in 0..usize::from(expected_player_count) {
        let env_info = &remaining_accounts[pair_idx * 2 + 1];
        let mut env_data = env_info.try_borrow_mut_data()?;
        let mut slice: &[u8] = &env_data;
        let mut env = SessionRiskEnvelope::try_deserialize(&mut slice)?;
        require!(!env.settled, VaultError::VaultAlreadySettled);

        let payout_item = dist
            .payouts
            .iter()
            .find(|p| p.player == env.player)
            .ok_or(VaultError::InvalidEnvelopeAccount)?;
        env.payout_usdc = payout_item.payout_usdc;
        env.rank = payout_item.rank;
        env.settled = true;

        let mut writer: &mut [u8] = &mut env_data;
        env.try_serialize(&mut writer)?;
    }

    if dist.total_fee_usdc > 0 {
        let fee_i64 = i64::try_from(dist.total_fee_usdc).map_err(|_| VaultError::MathOverflow)?;
        let auth_seeds: &[&[u8]] = &[SEED_VAULT_ROUTER_AUTH, &[vault_router_auth_bump]];
        registry_cpi::sync_global_tvl(
            CpiContext::new_with_signer(
                registry_program.key(),
                registry_cpi::accounts::SyncGlobalTvl {
                    authority: vault_router_auth.to_account_info(),
                    engine_config: engine_config.to_account_info(),
                },
                &[auth_seeds],
            ),
            -fee_i64,
        )?;
    }

    vault.settled = true;
    vault.total_distributed_usdc = dist.total_distributed_usdc;

    emit!(PoolDistributed {
        room_shard: vault.room_shard,
        room_pool_usdc: vault.room_pool_usdc,
        platform_fee_usdc: dist.platform_fee_usdc,
        creator_fee_usdc: dist.creator_fee_usdc,
        partner_fee_usdc: dist.partner_fee_usdc,
        total_distributed_usdc: dist.total_distributed_usdc,
    });
    Ok(())
}

fn parse_settled_room_shard(room_shard_info: &AccountInfo) -> Result<u16> {
    let data = room_shard_info.try_borrow_data()?;
    // RoomShard layout: 8 disc + 32 event_id + 2 shard_index + 32 cartridge_manifest + 32 authority
    // + 1 phase + 1 scoring_formula + 1 action_binding_mode + 2 max_rebalances + 1 is_private_fog
    // + 2 player_count + 2 evaluated_count
    require!(
        data.len() >= 116 && data[0..8] == ROOM_SHARD_DISCRIMINATOR,
        VaultError::InvalidRoomShardData
    );
    let phase = data[106];
    require!(phase == 3, VaultError::RoomShardNotSettled);
    let player_count = u16::from_le_bytes([data[112], data[113]]);
    let evaluated_count = u16::from_le_bytes([data[114], data[115]]);
    require!(
        player_count == evaluated_count,
        VaultError::StanceNotEvaluated
    );
    Ok(player_count)
}

fn parse_player_stance(stance_info: &AccountInfo) -> Result<(Pubkey, Pubkey, i128, bool)> {
    let data = stance_info.try_borrow_data()?;
    // PlayerStance layout:
    // 8 disc + 32 room_shard (8..40) + 32 player (40..72) + 32 session_key (72..104)
    // + 8 session_expiry_ts (104..112) + 8 last_move_ts (112..120) + 2 move_count (120..122)
    // + 8 weights_bps (122..130) + 1 kalshi_binary_call (130) + 2 kalshi_prob_bps (131..133)
    // + 32 entry_prices_8 (133..165) + 64 step_returns_scaled (165..229) + 1 step_count (229)
    // + 8 max_drawdown_scaled (230..238) + 8 stage1_score_scaled (238..246)
    // + 16 final_score_scaled (246..262) + 1 joined_er (262) + 1 evaluated (263)
    require!(
        data.len() >= 264 && data[0..8] == PLAYER_STANCE_DISCRIMINATOR,
        VaultError::InvalidStanceAccount
    );
    let room_shard =
        Pubkey::try_from(&data[8..40]).map_err(|_| error!(VaultError::InvalidStanceAccount))?;
    let player =
        Pubkey::try_from(&data[40..72]).map_err(|_| error!(VaultError::InvalidStanceAccount))?;
    let mut score_bytes = [0u8; 16];
    score_bytes.copy_from_slice(&data[246..262]);
    let final_score_scaled = i128::from_le_bytes(score_bytes);
    let evaluated = data[263] != 0;
    Ok((room_shard, player, final_score_scaled, evaluated))
}

fn verify_xstocks_passport_eligibility(passport_info: &AccountInfo, player: &Pubkey) -> Result<()> {
    require!(
        passport_info.owner == &PASSPORT_PROGRAM_ID,
        VaultError::InvalidPassportOwner
    );
    let (expected_pda, _) =
        Pubkey::find_program_address(&[SEED_PASSPORT, player.as_ref()], &PASSPORT_PROGRAM_ID);
    require_keys_eq!(
        passport_info.key(),
        expected_pda,
        VaultError::InvalidPassportPda
    );

    let data = passport_info.try_borrow_data()?;
    // MarketPassport layout: 8 disc + 32 owner (8..40) + 16 elo_scaled (40..56) + 1 eligibility_bitmask (56)
    require!(
        data.len() >= 57 && data[0..8] == MARKET_PASSPORT_DISCRIMINATOR,
        VaultError::InvalidPassportData
    );
    let owner =
        Pubkey::try_from(&data[8..40]).map_err(|_| error!(VaultError::InvalidPassportData))?;
    require_keys_eq!(owner, *player, VaultError::InvalidPassportData);
    let eligibility_bitmask = data[56];
    require!(
        (eligibility_bitmask & BIT_CAN_CLAIM_XSTOCKS) != 0,
        VaultError::XStocksIneligible
    );
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerScoreEntry {
    pub player: Pubkey,
    pub score_scaled: i128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerPayoutOutcome {
    pub player: Pubkey,
    pub rank: u16,
    pub payout_usdc: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolDistributionOutcome {
    pub room_pool_usdc: u64,
    pub total_fee_usdc: u64,
    pub platform_fee_usdc: u64,
    pub creator_fee_usdc: u64,
    pub partner_fee_usdc: u64,
    pub net_prize_pool_usdc: u64,
    pub payouts: Vec<PlayerPayoutOutcome>,
    pub total_distributed_usdc: u64,
    pub undistributed_dust_usdc: u64,
}

/// Exact integer Harmonic Shapley winner payout + protocol/builder/partner fee conservation math.
/// Matches `packages/shared-types/src/fixed-point.ts::computePoolAndFeeDistribution` bit-for-bit.
/// Guarantees `sum(winner_payouts) + platform_fee + creator_fee + partner_fee <= room_pool_usdc`.
pub fn compute_pool_and_fee_distribution(
    room_pool_usdc: u64,
    total_fee_bps: u16,
    creator_share_bps: u16,
    partner_wallet_active: bool,
    player_scores: &[PlayerScoreEntry],
) -> Result<PoolDistributionOutcome> {
    require!(
        total_fee_bps <= MAX_TOTAL_FEE_BPS,
        VaultError::FeeBpsExceedsCap
    );
    require!(
        creator_share_bps <= MAX_CREATOR_SHARE_BPS,
        VaultError::CreatorShareExceedsCap
    );

    let pool_u128 = u128::from(room_pool_usdc);
    let total_fee_u128 = pool_u128
        .checked_mul(u128::from(total_fee_bps))
        .ok_or(VaultError::MathOverflow)?
        / BPS_DENOM;

    let (partner_fee_u128, creator_fee_u128, platform_fee_u128) = if partner_wallet_active {
        let p_fee = total_fee_u128
            .checked_mul(PARTNER_WALLET_SHARE_BPS)
            .ok_or(VaultError::MathOverflow)?
            / BPS_DENOM;
        let c_fee = total_fee_u128
            .checked_mul(PARTNER_CREATOR_SHARE_BPS)
            .ok_or(VaultError::MathOverflow)?
            / BPS_DENOM;
        let plat_fee = total_fee_u128
            .checked_sub(p_fee)
            .and_then(|v| v.checked_sub(c_fee))
            .ok_or(VaultError::MathOverflow)?;
        (p_fee, c_fee, plat_fee)
    } else {
        let c_fee = total_fee_u128
            .checked_mul(u128::from(creator_share_bps))
            .ok_or(VaultError::MathOverflow)?
            / BPS_DENOM;
        let plat_fee = total_fee_u128
            .checked_sub(c_fee)
            .ok_or(VaultError::MathOverflow)?;
        (0u128, c_fee, plat_fee)
    };

    let net_prize_u128 = pool_u128
        .checked_sub(total_fee_u128)
        .ok_or(VaultError::MathOverflow)?;

    let total_fee_usdc = u64::try_from(total_fee_u128).map_err(|_| VaultError::MathOverflow)?;
    let platform_fee_usdc =
        u64::try_from(platform_fee_u128).map_err(|_| VaultError::MathOverflow)?;
    let creator_fee_usdc = u64::try_from(creator_fee_u128).map_err(|_| VaultError::MathOverflow)?;
    let partner_fee_usdc = u64::try_from(partner_fee_u128).map_err(|_| VaultError::MathOverflow)?;
    let net_prize_pool_usdc =
        u64::try_from(net_prize_u128).map_err(|_| VaultError::MathOverflow)?;

    if player_scores.is_empty() || net_prize_u128 == 0 {
        let fee_sum = platform_fee_u128
            .checked_add(creator_fee_u128)
            .and_then(|v| v.checked_add(partner_fee_u128))
            .ok_or(VaultError::MathOverflow)?;
        require!(fee_sum <= pool_u128, VaultError::SolvencyInvariantViolated);
        let total_distributed_usdc =
            u64::try_from(fee_sum).map_err(|_| VaultError::MathOverflow)?;
        let mut zero_payouts = Vec::with_capacity(player_scores.len());
        if !player_scores.is_empty() {
            let mut indexed: Vec<(usize, &PlayerScoreEntry)> =
                player_scores.iter().enumerate().collect();
            indexed.sort_by(|(idx_a, a), (idx_b, b)| {
                b.score_scaled
                    .cmp(&a.score_scaled)
                    .then_with(|| idx_a.cmp(idx_b))
            });
            for (rank_idx, (_, entry)) in indexed.into_iter().enumerate() {
                let rank_u16 = u16::try_from(rank_idx + 1).map_err(|_| VaultError::MathOverflow)?;
                zero_payouts.push(PlayerPayoutOutcome {
                    player: entry.player,
                    rank: rank_u16,
                    payout_usdc: 0,
                });
            }
        }
        return Ok(PoolDistributionOutcome {
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
                .ok_or(VaultError::MathOverflow)?,
        });
    }

    let mut indexed: Vec<(usize, &PlayerScoreEntry)> = player_scores.iter().enumerate().collect();
    indexed.sort_by(|(idx_a, a), (idx_b, b)| {
        b.score_scaled
            .cmp(&a.score_scaled)
            .then_with(|| idx_a.cmp(idx_b))
    });

    let n = indexed.len();
    // Exact integer equivalent of `Math.max(Math.min(3, n), Math.ceil(n * 0.2))`
    let top_twenty_pct_ceil = n.checked_add(4).ok_or(VaultError::MathOverflow)? / 5;
    let winner_count = core::cmp::max(core::cmp::min(3, n), top_twenty_pct_ceil);

    let mut raw_weights: Vec<u128> = Vec::with_capacity(winner_count);
    let mut weight_sum: u128 = 0;
    for r in 0..winner_count {
        let denom = u128::try_from(r + 1).map_err(|_| VaultError::MathOverflow)?;
        let w = SHAPLEY_WEIGHT_BASE / denom;
        raw_weights.push(w);
        weight_sum = weight_sum.checked_add(w).ok_or(VaultError::MathOverflow)?;
    }

    let mut payouts: Vec<PlayerPayoutOutcome> = Vec::with_capacity(n);
    let mut paid_winner_sum: u128 = 0;
    for (i, (_, entry)) in indexed.into_iter().enumerate() {
        let mut payout_u128 = 0u128;
        if i < winner_count && weight_sum > 0 {
            payout_u128 = net_prize_u128
                .checked_mul(raw_weights[i])
                .ok_or(VaultError::MathOverflow)?
                / weight_sum;
            paid_winner_sum = paid_winner_sum
                .checked_add(payout_u128)
                .ok_or(VaultError::MathOverflow)?;
        }
        let rank_u16 = u16::try_from(i + 1).map_err(|_| VaultError::MathOverflow)?;
        let payout_u64 = u64::try_from(payout_u128).map_err(|_| VaultError::MathOverflow)?;
        payouts.push(PlayerPayoutOutcome {
            player: entry.player,
            rank: rank_u16,
            payout_usdc: payout_u64,
        });
    }

    let prize_dust = net_prize_u128
        .checked_sub(paid_winner_sum)
        .ok_or(VaultError::MathOverflow)?;
    if prize_dust > 0 && !payouts.is_empty() {
        let dust_u64 = u64::try_from(prize_dust).map_err(|_| VaultError::MathOverflow)?;
        payouts[0].payout_usdc = payouts[0]
            .payout_usdc
            .checked_add(dust_u64)
            .ok_or(VaultError::MathOverflow)?;
        paid_winner_sum = paid_winner_sum
            .checked_add(prize_dust)
            .ok_or(VaultError::MathOverflow)?;
    }

    let total_dist_u128 = paid_winner_sum
        .checked_add(platform_fee_u128)
        .and_then(|v| v.checked_add(creator_fee_u128))
        .and_then(|v| v.checked_add(partner_fee_u128))
        .ok_or(VaultError::MathOverflow)?;

    require!(
        total_dist_u128 <= pool_u128,
        VaultError::SolvencyInvariantViolated
    );

    let total_distributed_usdc =
        u64::try_from(total_dist_u128).map_err(|_| VaultError::MathOverflow)?;
    let undistributed_dust_usdc = room_pool_usdc
        .checked_sub(total_distributed_usdc)
        .ok_or(VaultError::MathOverflow)?;

    Ok(PoolDistributionOutcome {
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

#[account]
#[derive(InitSpace, Debug)]
pub struct RoomVault {
    pub room_shard: Pubkey,
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault_usdc_token: Pubkey,
    pub cartridge_manifest: Pubkey,
    pub creator_fee_vault: Pubkey,
    pub platform_fee_account: Pubkey,
    pub partner_fee_vault: Pubkey,
    pub partner_wallet_active: bool,
    pub creator_share_bps: u16,
    pub total_fee_bps: u16,
    pub room_pool_usdc: u64,
    pub total_distributed_usdc: u64,
    pub total_claimed_usdc: u64,
    pub settled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct SessionRiskEnvelope {
    pub room_shard: Pubkey,
    pub player: Pubkey,
    pub ephemeral_session_key: Pubkey,
    pub principal_usdc: u64,
    pub leverage: u8,
    pub payout_usdc: u64,
    pub rank: u16,
    pub settled: bool,
    pub claimed: bool,
    pub claimed_mint: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeRoomVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: RoomShard PDA key bound to this vault.
    pub room_shard: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump,
        seeds::program = registry_program.key()
    )]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    #[account(
        seeds = [SEED_CARTRIDGE, cartridge_manifest.slug_hash.as_ref()],
        bump = cartridge_manifest.bump,
        seeds::program = registry_program.key()
    )]
    pub cartridge_manifest: Box<Account<'info, CartridgeManifestAccount>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = authority,
        space = 8 + RoomVault::INIT_SPACE,
        seeds = [SEED_ROOM_VAULT, room_shard.key().as_ref()],
        bump
    )]
    pub room_vault: Box<Account<'info, RoomVault>>,
    #[account(
        init,
        payer = authority,
        seeds = [SEED_ROOM_VAULT_TOKEN, room_shard.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = room_vault,
        token::token_program = token_program
    )]
    pub vault_usdc_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = usdc_mint, token::token_program = token_program)]
    pub platform_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = usdc_mint, token::token_program = token_program)]
    pub creator_fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub partner_fee_vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub registry_program: Program<'info, CartridgeRegistry>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenSessionEnvelope<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump,
        seeds::program = registry_program.key()
    )]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    #[account(
        mut,
        seeds = [SEED_ROOM_VAULT, room_vault.room_shard.as_ref()],
        bump = room_vault.bump
    )]
    pub room_vault: Box<Account<'info, RoomVault>>,
    #[account(address = room_vault.usdc_mint @ VaultError::MintMismatch)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = room_vault.vault_usdc_token @ VaultError::InvalidVaultTokenAccount,
        constraint = vault_usdc_token.key() != player_usdc_ata.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub vault_usdc_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = player,
        token::token_program = token_program
    )]
    pub player_usdc_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = player,
        space = 8 + SessionRiskEnvelope::INIT_SPACE,
        seeds = [SEED_SESSION_ENVELOPE, room_vault.room_shard.as_ref(), player.key().as_ref()],
        bump
    )]
    pub session_envelope: Box<Account<'info, SessionRiskEnvelope>>,
    /// CHECK: Program-owned PDA signer for atomic global TVL synchronization in `cartridge-registry`.
    #[account(seeds = [SEED_VAULT_ROUTER_AUTH], bump)]
    pub vault_router_auth: UncheckedAccount<'info>,
    pub registry_program: Program<'info, CartridgeRegistry>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DistributePoolDirect<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_VAULT, room_vault.room_shard.as_ref()],
        bump = room_vault.bump,
        has_one = authority @ VaultError::Unauthorized
    )]
    pub room_vault: Box<Account<'info, RoomVault>>,
    /// CHECK: Verified owner == ER_ROOM_PROGRAM_ID and phase == SettledCommitted in handler.
    #[account(address = room_vault.room_shard @ VaultError::ShardMismatch)]
    pub room_shard: UncheckedAccount<'info>,
    #[account(address = room_vault.usdc_mint @ VaultError::MintMismatch)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = room_vault.vault_usdc_token @ VaultError::InvalidVaultTokenAccount
    )]
    pub vault_usdc_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = room_vault.platform_fee_account @ VaultError::InvalidFeeDestination,
        constraint = platform_fee_account.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub platform_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = room_vault.creator_fee_vault @ VaultError::InvalidFeeDestination,
        constraint = creator_fee_vault.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts,
        constraint = creator_fee_vault.key() != platform_fee_account.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub creator_fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = partner_fee_vault.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts,
        constraint = partner_fee_vault.key() != platform_fee_account.key() @ VaultError::DuplicateTokenAccounts,
        constraint = partner_fee_vault.key() != creator_fee_vault.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub partner_fee_vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        mut,
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump,
        seeds::program = registry_program.key()
    )]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    /// CHECK: Program-owned PDA signer for atomic global TVL synchronization.
    #[account(seeds = [SEED_VAULT_ROUTER_AUTH], bump)]
    pub vault_router_auth: UncheckedAccount<'info>,
    pub registry_program: Program<'info, CartridgeRegistry>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[action]
#[derive(Accounts)]
pub struct DistributePoolAction<'info> {
    #[account(
        mut,
        seeds = [SEED_ROOM_VAULT, room_vault.room_shard.as_ref()],
        bump = room_vault.bump
    )]
    pub room_vault: Box<Account<'info, RoomVault>>,
    /// CHECK: Verified owner == ER_ROOM_PROGRAM_ID and phase == SettledCommitted in handler.
    #[account(address = room_vault.room_shard @ VaultError::ShardMismatch)]
    pub room_shard: UncheckedAccount<'info>,
    #[account(address = room_vault.usdc_mint @ VaultError::MintMismatch)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = room_vault.vault_usdc_token @ VaultError::InvalidVaultTokenAccount
    )]
    pub vault_usdc_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = room_vault.platform_fee_account @ VaultError::InvalidFeeDestination,
        constraint = platform_fee_account.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub platform_fee_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        address = room_vault.creator_fee_vault @ VaultError::InvalidFeeDestination,
        constraint = creator_fee_vault.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts,
        constraint = creator_fee_vault.key() != platform_fee_account.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub creator_fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = partner_fee_vault.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts,
        constraint = partner_fee_vault.key() != platform_fee_account.key() @ VaultError::DuplicateTokenAccounts,
        constraint = partner_fee_vault.key() != creator_fee_vault.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub partner_fee_vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        mut,
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump,
        seeds::program = registry_program.key()
    )]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    /// CHECK: Program-owned PDA signer for atomic global TVL synchronization.
    #[account(seeds = [SEED_VAULT_ROUTER_AUTH], bump)]
    pub vault_router_auth: UncheckedAccount<'info>,
    pub registry_program: Program<'info, CartridgeRegistry>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: Program that scheduled the post-commit Magic Action (`cartridge-er-room`).
    #[account(address = ER_ROOM_PROGRAM_ID @ VaultError::Unauthorized)]
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: Escrow authority pinned to `room_vault.authority`.
    #[account(address = room_vault.authority @ VaultError::Unauthorized)]
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: Delegation Program signed escrow balance PDA proving post-commit dispatch.
    #[account(
        signer @ VaultError::Unauthorized,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(
            &escrow_auth.key(),
            ACTION_ESCROW_INDEX,
        ) @ VaultError::Unauthorized,
    )]
    pub escrow: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ROOM_VAULT, room_vault.room_shard.as_ref()],
        bump = room_vault.bump
    )]
    pub room_vault: Box<Account<'info, RoomVault>>,
    #[account(
        mut,
        seeds = [SEED_SESSION_ENVELOPE, room_vault.room_shard.as_ref(), player.key().as_ref()],
        bump = session_envelope.bump,
        has_one = player @ VaultError::Unauthorized
    )]
    pub session_envelope: Box<Account<'info, SessionRiskEnvelope>>,
    #[account(address = room_vault.usdc_mint @ VaultError::MintMismatch)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub desired_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        address = room_vault.vault_usdc_token @ VaultError::InvalidVaultTokenAccount,
        constraint = vault_usdc_token.key() != player_destination_ata.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub vault_usdc_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = desired_mint,
        token::authority = player,
        token::token_program = token_program
    )]
    pub player_destination_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = xstock_reserve_token.key() != player_destination_ata.key() @ VaultError::DuplicateTokenAccounts,
        constraint = xstock_reserve_token.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub xstock_reserve_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        mut,
        constraint = settlement_usdc_ata.key() != vault_usdc_token.key() @ VaultError::DuplicateTokenAccounts,
        constraint = settlement_usdc_ata.key() != player_destination_ata.key() @ VaultError::DuplicateTokenAccounts
    )]
    pub settlement_usdc_ata: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// CHECK: Verified owner == PASSPORT_PROGRAM_ID, canonical PDA, and BIT_CAN_CLAIM_XSTOCKS when claiming xStocks.
    pub market_passport: Option<UncheckedAccount<'info>>,
    #[account(
        mut,
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump,
        seeds::program = registry_program.key()
    )]
    pub engine_config: Box<Account<'info, EngineConfig>>,
    /// CHECK: Program-owned PDA signer for atomic global TVL synchronization.
    #[account(seeds = [SEED_VAULT_ROUTER_AUTH], bump)]
    pub vault_router_auth: UncheckedAccount<'info>,
    pub registry_program: Program<'info, CartridgeRegistry>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct SessionEnvelopeOpened {
    pub room_shard: Pubkey,
    pub player: Pubkey,
    pub principal_usdc: u64,
    pub leverage: u8,
    pub room_pool_usdc: u64,
}

#[event]
pub struct PoolDistributed {
    pub room_shard: Pubkey,
    pub room_pool_usdc: u64,
    pub platform_fee_usdc: u64,
    pub creator_fee_usdc: u64,
    pub partner_fee_usdc: u64,
    pub total_distributed_usdc: u64,
}

#[event]
pub struct PrizeClaimed {
    pub room_shard: Pubkey,
    pub player: Pubkey,
    pub payout_usdc: u64,
    pub claimed_mint: Pubkey,
    pub xstock_units_out: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Engine is currently paused")]
    EnginePaused,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Ephemeral session key is forbidden from signing vault, deposit, or claim instructions")]
    SessionKeyPrivilegeEscalation,
    #[msg("Leverage must be between 1x and 5x")]
    LeverageExceedsCap,
    #[msg("Principal deposit must be greater than zero")]
    ZeroPrincipal,
    #[msg("Total fee bps cannot exceed 1000 bps (10%)")]
    FeeBpsExceedsCap,
    #[msg("Creator share bps cannot exceed 5000 bps (50%)")]
    CreatorShareExceedsCap,
    #[msg("Fee destination does not match registered protocol/creator/partner account")]
    InvalidFeeDestination,
    #[msg("Partner fee vault required when partner_wallet_active is true")]
    MissingPartnerFeeVault,
    #[msg("Token mint mismatch")]
    MintMismatch,
    #[msg("Invalid vault token account")]
    InvalidVaultTokenAccount,
    #[msg("Duplicate mutable token accounts are not permitted")]
    DuplicateTokenAccounts,
    #[msg("Private beta room pool cap (500 USDC) exceeded")]
    BetaRoomPoolCapExceeded,
    #[msg("Private beta global TVL cap (5,000 USDC) exceeded")]
    BetaGlobalTvlCapExceeded,
    #[msg("Configured room pool cap exceeded")]
    RoomPoolCapExceeded,
    #[msg("Configured global TVL cap exceeded")]
    GlobalTvlCapExceeded,
    #[msg("Vault has already been settled")]
    VaultAlreadySettled,
    #[msg("Vault and envelope must be settled before claiming")]
    VaultNotYetSettled,
    #[msg("Prize has already been claimed")]
    PrizeAlreadyClaimed,
    #[msg("Envelope payout is zero")]
    ZeroPrizePayout,
    #[msg("Room shard has not been committed and undelegated back to L1")]
    RoomShardNotCommittedToL1,
    #[msg("Room shard is not in SettledCommitted phase")]
    RoomShardNotSettled,
    #[msg("Malformed RoomShard account data")]
    InvalidRoomShardData,
    #[msg("Room shard key mismatch")]
    ShardMismatch,
    #[msg("Settlement remaining_accounts must contain exact (PlayerStance, SessionRiskEnvelope) pairs")]
    InvalidSettlementAccountPairs,
    #[msg("Invalid PlayerStance account owner or data")]
    InvalidStanceAccount,
    #[msg("PlayerStance has not been evaluated")]
    StanceNotEvaluated,
    #[msg("Invalid SessionRiskEnvelope PDA or mutability")]
    InvalidEnvelopeAccount,
    #[msg("Duplicate player in settlement pairs")]
    DuplicatePlayerInSettlement,
    #[msg("Solvency invariant violated: distributed exceeds room pool")]
    SolvencyInvariantViolated,
    #[msg("MarketPassport account required when claiming xStocks")]
    MissingPassportForXStocks,
    #[msg("MarketPassport has invalid program owner")]
    InvalidPassportOwner,
    #[msg("MarketPassport PDA derivation mismatch")]
    InvalidPassportPda,
    #[msg("MarketPassport data is malformed")]
    InvalidPassportData,
    #[msg("MarketPassport lacks BIT_CAN_CLAIM_XSTOCKS eligibility")]
    XStocksIneligible,
    #[msg("xStock reserve and settlement USDC accounts required for tokenized stock payout")]
    MissingXStockReserve,
    #[msg("xStock payout units must be greater than zero")]
    InvalidXStockUnits,
    #[msg("Unsupported payout token mint")]
    UnsupportedPayoutMint,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
