#![allow(unexpected_cfgs, clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;

const _: fn() -> usize = ::anchor_lang::solana_program::instruction::get_stack_height;

declare_id!("5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr");

pub const SEED_ENGINE_CONFIG: &[u8] = b"engine_config";
pub const SEED_CARTRIDGE: &[u8] = b"cartridge";
pub const SEED_VAULT_ROUTER_AUTH: &[u8] = b"vault_router_auth";

pub const VAULT_ROUTER_PROGRAM_ID: Pubkey = pubkey!("6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT");
pub const ER_ROOM_PROGRAM_ID: Pubkey = pubkey!("Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR");

pub const BETA_MAX_ROOM_POOL_USDC: u64 = 500_000_000;
pub const BETA_MAX_GLOBAL_TVL_USDC: u64 = 5_000_000_000;
pub const MAX_CREATOR_SHARE_BPS: u16 = 5_000;
pub const MAX_FOG_OF_WAR_BPS: u16 = 9_000;
pub const MIN_DURATION_SECS: u32 = 30;
pub const MAX_REBALANCES_CAP: u16 = 1_000;

#[program]
pub mod cartridge_registry {
    use super::*;

    pub fn initialize_engine_config(
        ctx: Context<InitializeEngineConfig>,
        private_beta_mode: bool,
        max_room_pool_usdc: u64,
        max_global_tvl_usdc: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.platform_fee_account.key() != Pubkey::default(),
            RegistryError::InvalidFeeAccount
        );
        validate_tvl_caps(private_beta_mode, max_room_pool_usdc, max_global_tvl_usdc)?;

        let config = &mut ctx.accounts.engine_config;
        config.admin_multisig = ctx.accounts.admin_multisig.key();
        config.platform_fee_account = ctx.accounts.platform_fee_account.key();
        config.private_beta_mode = private_beta_mode;
        config.max_room_pool_usdc = max_room_pool_usdc;
        config.max_global_tvl_usdc = max_global_tvl_usdc;
        config.current_global_tvl_usdc = 0;
        config.paused = false;
        config.bump = ctx.bumps.engine_config;

        emit!(EngineConfigUpdated {
            admin_multisig: config.admin_multisig,
            platform_fee_account: config.platform_fee_account,
            private_beta_mode: config.private_beta_mode,
            max_room_pool_usdc: config.max_room_pool_usdc,
            max_global_tvl_usdc: config.max_global_tvl_usdc,
            paused: config.paused,
        });
        Ok(())
    }

    pub fn update_engine_config(
        ctx: Context<UpdateEngineConfig>,
        args: UpdateEngineConfigArgs,
    ) -> Result<()> {
        let config = &mut ctx.accounts.engine_config;

        if let Some(new_admin) = args.new_admin_multisig {
            require!(new_admin != Pubkey::default(), RegistryError::InvalidAdmin);
            config.admin_multisig = new_admin;
        }
        if let Some(new_fee_account) = args.new_platform_fee_account {
            require!(
                new_fee_account != Pubkey::default(),
                RegistryError::InvalidFeeAccount
            );
            config.platform_fee_account = new_fee_account;
        }

        let next_beta = args.private_beta_mode.unwrap_or(config.private_beta_mode);
        let next_room_cap = args.max_room_pool_usdc.unwrap_or(config.max_room_pool_usdc);
        let next_global_cap = args
            .max_global_tvl_usdc
            .unwrap_or(config.max_global_tvl_usdc);

        validate_tvl_caps(next_beta, next_room_cap, next_global_cap)?;

        config.private_beta_mode = next_beta;
        config.max_room_pool_usdc = next_room_cap;
        config.max_global_tvl_usdc = next_global_cap;

        if let Some(paused) = args.paused {
            config.paused = paused;
        }

        emit!(EngineConfigUpdated {
            admin_multisig: config.admin_multisig,
            platform_fee_account: config.platform_fee_account,
            private_beta_mode: config.private_beta_mode,
            max_room_pool_usdc: config.max_room_pool_usdc,
            max_global_tvl_usdc: config.max_global_tvl_usdc,
            paused: config.paused,
        });
        Ok(())
    }

    pub fn sync_global_tvl(ctx: Context<SyncGlobalTvl>, delta_usdc: i64) -> Result<()> {
        let config = &mut ctx.accounts.engine_config;
        let caller = ctx.accounts.authority.key();
        let (expected_vault_auth, _) =
            Pubkey::find_program_address(&[SEED_VAULT_ROUTER_AUTH], &VAULT_ROUTER_PROGRAM_ID);

        require!(
            caller == config.admin_multisig || caller == expected_vault_auth,
            RegistryError::UnauthorizedTvlSync
        );

        let updated_tvl = if delta_usdc >= 0 {
            require!(!config.paused, RegistryError::EnginePaused);
            let add_amount = u64::try_from(delta_usdc).map_err(|_| RegistryError::MathOverflow)?;
            let next = config
                .current_global_tvl_usdc
                .checked_add(add_amount)
                .ok_or(RegistryError::MathOverflow)?;
            require!(
                next <= config.max_global_tvl_usdc,
                RegistryError::GlobalTvlCapExceeded
            );
            if config.private_beta_mode {
                require!(
                    next <= BETA_MAX_GLOBAL_TVL_USDC,
                    RegistryError::BetaGlobalTvlCapExceeded
                );
            }
            next
        } else {
            let sub_amount = delta_usdc.unsigned_abs();
            config
                .current_global_tvl_usdc
                .checked_sub(sub_amount)
                .ok_or(RegistryError::TvlUnderflow)?
        };

        config.current_global_tvl_usdc = updated_tvl;

        emit!(GlobalTvlSynced {
            authority: caller,
            delta_usdc,
            current_global_tvl_usdc: updated_tvl,
        });
        Ok(())
    }

    pub fn register_cartridge(
        ctx: Context<RegisterCartridge>,
        args: RegisterCartridgeArgs,
    ) -> Result<()> {
        require!(
            !ctx.accounts.engine_config.paused,
            RegistryError::EnginePaused
        );
        require!(args.slug_hash != [0u8; 32], RegistryError::InvalidSlugHash);
        require!(
            ctx.accounts.creator_fee_vault.key() != Pubkey::default(),
            RegistryError::InvalidFeeAccount
        );
        require!(
            args.creator_share_bps <= MAX_CREATOR_SHARE_BPS,
            RegistryError::CreatorShareExceedsCap
        );
        require!(
            args.fog_of_war_bps <= MAX_FOG_OF_WAR_BPS,
            RegistryError::FogOfWarExceedsCap
        );
        require!(
            args.duration_secs >= MIN_DURATION_SECS,
            RegistryError::DurationTooShort
        );
        require!(
            args.max_rebalances >= 1 && args.max_rebalances <= MAX_REBALANCES_CAP,
            RegistryError::InvalidMaxRebalances
        );

        let manifest = &mut ctx.accounts.cartridge_manifest;
        manifest.slug_hash = args.slug_hash;
        manifest.creator = ctx.accounts.creator.key();
        manifest.creator_fee_vault = ctx.accounts.creator_fee_vault.key();
        manifest.creator_share_bps = args.creator_share_bps;
        manifest.genre_code = args.genre_code;
        manifest.duration_secs = args.duration_secs;
        manifest.fog_of_war_bps = args.fog_of_war_bps;
        manifest.max_rebalances = args.max_rebalances;
        manifest.scoring_formula = args.scoring_formula;
        manifest.action_binding_mode = args.action_binding_mode;
        manifest.allowed_feeds_merkle_root = args.allowed_feeds_merkle_root;
        manifest.manifest_uri = args.manifest_uri;
        manifest.total_rooms_created = 0;
        manifest.bump = ctx.bumps.cartridge_manifest;

        emit!(CartridgeRegistered {
            cartridge_manifest: manifest.key(),
            slug_hash: manifest.slug_hash,
            creator: manifest.creator,
            creator_share_bps: manifest.creator_share_bps,
            duration_secs: manifest.duration_secs,
            fog_of_war_bps: manifest.fog_of_war_bps,
            scoring_formula: manifest.scoring_formula,
            action_binding_mode: manifest.action_binding_mode,
        });
        Ok(())
    }

    pub fn record_room_created(ctx: Context<RecordRoomCreated>) -> Result<()> {
        require!(
            !ctx.accounts.engine_config.paused,
            RegistryError::EnginePaused
        );
        let caller = ctx.accounts.authority.key();
        let manifest = &mut ctx.accounts.cartridge_manifest;
        require!(
            caller == manifest.creator || caller == ctx.accounts.engine_config.admin_multisig,
            RegistryError::UnauthorizedRoomRecorder
        );
        manifest.total_rooms_created = manifest
            .total_rooms_created
            .checked_add(1)
            .ok_or(RegistryError::MathOverflow)?;
        Ok(())
    }
}

fn validate_tvl_caps(
    private_beta_mode: bool,
    max_room_pool_usdc: u64,
    max_global_tvl_usdc: u64,
) -> Result<()> {
    require!(
        max_room_pool_usdc > 0 && max_global_tvl_usdc >= max_room_pool_usdc,
        RegistryError::InvalidTvlCapConfiguration
    );
    if private_beta_mode {
        require!(
            max_room_pool_usdc <= BETA_MAX_ROOM_POOL_USDC,
            RegistryError::BetaRoomCapConfigurationExceeded
        );
        require!(
            max_global_tvl_usdc <= BETA_MAX_GLOBAL_TVL_USDC,
            RegistryError::BetaGlobalTvlCapExceeded
        );
    }
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ScoringFormula {
    DirectionNeutralRelReturn,
    DrawdownPenalizedSharpe,
    KalshiBrierCalibration,
    MultiStageCarryComposite,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ActionBindingMode {
    ConvictionWeights,
    ThreeLaneStance,
    SectorTurf,
    MultiStageCarry,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateEngineConfigArgs {
    pub new_admin_multisig: Option<Pubkey>,
    pub new_platform_fee_account: Option<Pubkey>,
    pub private_beta_mode: Option<bool>,
    pub max_room_pool_usdc: Option<u64>,
    pub max_global_tvl_usdc: Option<u64>,
    pub paused: Option<bool>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
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

#[account]
#[derive(InitSpace, Debug)]
pub struct EngineConfig {
    pub admin_multisig: Pubkey,
    pub platform_fee_account: Pubkey,
    pub private_beta_mode: bool,
    pub max_room_pool_usdc: u64,
    pub max_global_tvl_usdc: u64,
    pub current_global_tvl_usdc: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct CartridgeManifestAccount {
    pub slug_hash: [u8; 32],
    pub creator: Pubkey,
    pub creator_fee_vault: Pubkey,
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

#[derive(Accounts)]
pub struct InitializeEngineConfig<'info> {
    #[account(mut)]
    pub admin_multisig: Signer<'info>,
    /// CHECK: Verified non-default USDC token account destination for protocol fees.
    pub platform_fee_account: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin_multisig,
        space = 8 + EngineConfig::INIT_SPACE,
        seeds = [SEED_ENGINE_CONFIG],
        bump
    )]
    pub engine_config: Account<'info, EngineConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEngineConfig<'info> {
    pub admin_multisig: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump,
        has_one = admin_multisig @ RegistryError::UnauthorizedAdmin
    )]
    pub engine_config: Account<'info, EngineConfig>,
}

#[derive(Accounts)]
pub struct SyncGlobalTvl<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump
    )]
    pub engine_config: Account<'info, EngineConfig>,
}

#[derive(Accounts)]
#[instruction(args: RegisterCartridgeArgs)]
pub struct RegisterCartridge<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: Verified non-default USDC token account destination for creator fee splits.
    pub creator_fee_vault: UncheckedAccount<'info>,
    #[account(
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump
    )]
    pub engine_config: Account<'info, EngineConfig>,
    #[account(
        init,
        payer = creator,
        space = 8 + CartridgeManifestAccount::INIT_SPACE,
        seeds = [SEED_CARTRIDGE, args.slug_hash.as_ref()],
        bump
    )]
    pub cartridge_manifest: Account<'info, CartridgeManifestAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordRoomCreated<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [SEED_ENGINE_CONFIG],
        bump = engine_config.bump
    )]
    pub engine_config: Account<'info, EngineConfig>,
    #[account(
        mut,
        seeds = [SEED_CARTRIDGE, cartridge_manifest.slug_hash.as_ref()],
        bump = cartridge_manifest.bump
    )]
    pub cartridge_manifest: Account<'info, CartridgeManifestAccount>,
}

#[event]
pub struct EngineConfigUpdated {
    pub admin_multisig: Pubkey,
    pub platform_fee_account: Pubkey,
    pub private_beta_mode: bool,
    pub max_room_pool_usdc: u64,
    pub max_global_tvl_usdc: u64,
    pub paused: bool,
}

#[event]
pub struct GlobalTvlSynced {
    pub authority: Pubkey,
    pub delta_usdc: i64,
    pub current_global_tvl_usdc: u64,
}

#[event]
pub struct CartridgeRegistered {
    pub cartridge_manifest: Pubkey,
    pub slug_hash: [u8; 32],
    pub creator: Pubkey,
    pub creator_share_bps: u16,
    pub duration_secs: u32,
    pub fog_of_war_bps: u16,
    pub scoring_formula: ScoringFormula,
    pub action_binding_mode: ActionBindingMode,
}

#[error_code]
pub enum RegistryError {
    #[msg("Caller is not the authorized admin multisig")]
    UnauthorizedAdmin,
    #[msg("Caller is not authorized to synchronize global TVL")]
    UnauthorizedTvlSync,
    #[msg("Caller is not authorized to record room creation")]
    UnauthorizedRoomRecorder,
    #[msg("Engine is currently paused")]
    EnginePaused,
    #[msg("Invalid default admin pubkey")]
    InvalidAdmin,
    #[msg("Invalid default fee account pubkey")]
    InvalidFeeAccount,
    #[msg("Invalid TVL cap configuration")]
    InvalidTvlCapConfiguration,
    #[msg("Private beta room pool cap cannot exceed 500 USDC (500_000_000)")]
    BetaRoomCapConfigurationExceeded,
    #[msg("Private beta global TVL cap cannot exceed 5,000 USDC (5_000_000_000)")]
    BetaGlobalTvlCapExceeded,
    #[msg("Global TVL cap exceeded")]
    GlobalTvlCapExceeded,
    #[msg("Global TVL underflow")]
    TvlUnderflow,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Slug hash cannot be all zeroes")]
    InvalidSlugHash,
    #[msg("Creator share cannot exceed 5000 bps (50%)")]
    CreatorShareExceedsCap,
    #[msg("Fog of war duration ratio cannot exceed 9000 bps (90%)")]
    FogOfWarExceedsCap,
    #[msg("Cartridge duration must be at least 30 seconds")]
    DurationTooShort,
    #[msg("Max rebalances must be between 1 and 1000")]
    InvalidMaxRebalances,
}
