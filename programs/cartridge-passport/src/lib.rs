#![allow(unexpected_cfgs, clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;

const _: fn() -> usize = ::anchor_lang::solana_program::instruction::get_stack_height;

declare_id!("B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF");

pub const SCALE: i128 = 1_000_000_000;
pub const DEFAULT_ELO_SCALED: i128 = 1_200 * SCALE;
pub const MIN_ELO_SCALED: i128 = 100 * SCALE;
pub const ELO_K_PAPER: i128 = 12;
pub const ELO_K_LIVE: i128 = 32;
pub const LN10_SCALED: i128 = 2_302_585_093;
pub const ELO_DIVISOR_SCALED: i128 = 400 * SCALE;

pub const SEED_PASSPORT_CONFIG: &[u8] = b"passport_config";
pub const SEED_PASSPORT: &[u8] = b"passport";
pub const SEED_MATCH_CREDIT: &[u8] = b"match_credit";

/// `cartridge_vault_router`: owner of the SessionRiskEnvelope a credit is bound to.
pub const VAULT_ROUTER_PROGRAM_ID: Pubkey = pubkey!("Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR");
pub const SEED_SESSION_ENVELOPE: &[u8] = b"session_envelope";
/// `sha256("account:SessionRiskEnvelope")[0..8]` on `cartridge_vault_router`.
pub const SESSION_ENVELOPE_DISCRIMINATOR: [u8; 8] =
    [0xe9, 0xaf, 0xa5, 0x17, 0x55, 0x64, 0xaf, 0xe5];
/// v2 SessionRiskEnvelope length (8 disc + 183).
pub const SESSION_ENVELOPE_V2_LEN: usize = 191;

pub const BIT_GEO_ELIGIBLE: u8 = 1;
pub const BIT_CAN_CLAIM_XSTOCKS: u8 = 2;
pub const BIT_SYBIL_VERIFIED: u8 = 4;
pub const VALID_ELIGIBILITY_MASK: u8 =
    BIT_GEO_ELIGIBLE | BIT_CAN_CLAIM_XSTOCKS | BIT_SYBIL_VERIFIED;

#[program]
pub mod cartridge_passport {
    use super::*;

    pub fn initialize_passport_config(
        ctx: Context<InitializePassportConfig>,
        keeper_authority: Pubkey,
    ) -> Result<()> {
        require!(
            keeper_authority != Pubkey::default(),
            PassportError::InvalidAuthority
        );
        let cfg = &mut ctx.accounts.passport_config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.keeper_authority = keeper_authority;
        cfg.bump = ctx.bumps.passport_config;
        Ok(())
    }

    pub fn initialize_passport(ctx: Context<InitializePassport>) -> Result<()> {
        let passport = &mut ctx.accounts.passport;
        passport.owner = ctx.accounts.owner.key();
        passport.elo_scaled = DEFAULT_ELO_SCALED;
        passport.eligibility_bitmask = 0;
        passport.matches_played = 0;
        passport.wins_count = 0;
        passport.best_sharpe_scaled = i128::MIN;
        passport.best_brier_scaled = 0;
        passport.earned_nvda_units = 0;
        passport.earned_spy_units = 0;
        passport.earned_ant_units = 0;
        passport.earned_usdc_units = 0;
        passport.bump = ctx.bumps.passport;

        emit!(PassportInitialized {
            owner: passport.owner,
            passport: passport.key(),
            elo_scaled: passport.elo_scaled,
        });
        Ok(())
    }

    pub fn update_eligibility_bitmask(
        ctx: Context<UpdateEligibilityBitmask>,
        eligibility_bitmask: u8,
    ) -> Result<()> {
        let cfg = &ctx.accounts.passport_config;
        let caller = ctx.accounts.authority.key();
        require!(
            caller == cfg.admin || caller == cfg.keeper_authority,
            PassportError::UnauthorizedAuthority
        );
        require!(
            (eligibility_bitmask & !VALID_ELIGIBILITY_MASK) == 0,
            PassportError::InvalidEligibilityBits
        );

        let passport = &mut ctx.accounts.passport;
        passport.eligibility_bitmask = eligibility_bitmask;

        emit!(EligibilityUpdated {
            owner: passport.owner,
            eligibility_bitmask,
        });
        Ok(())
    }

    pub fn record_elo_and_vault_credit(
        ctx: Context<RecordEloAndVaultCredit>,
        args: RecordEloArgs,
    ) -> Result<()> {
        let cfg = &ctx.accounts.passport_config;
        let caller = ctx.accounts.authority.key();
        require!(
            caller == cfg.admin || caller == cfg.keeper_authority,
            PassportError::UnauthorizedAuthority
        );
        require!(
            args.room_mean_elo_scaled >= MIN_ELO_SCALED,
            PassportError::InvalidMeanElo
        );

        // The credit is bound to the settled vault-router envelope of this (room, wallet):
        // the keeper cannot credit an arbitrary amount or a different outcome.
        let bound = parse_settled_envelope(
            &ctx.accounts.session_envelope,
            &args.room_shard,
            &ctx.accounts.passport.owner,
        )?;
        require!(
            args.asset_credit_units == bound.payout_usdc && args.is_win == (bound.rank == 1),
            PassportError::CreditMismatch
        );

        let receipt = &mut ctx.accounts.match_credit;
        receipt.passport_owner = ctx.accounts.passport.owner;
        receipt.room_shard = args.room_shard;
        receipt.credited_units = args.asset_credit_units;
        receipt.recorded_at = Clock::get()?.unix_timestamp;
        receipt.bump = ctx.bumps.match_credit;

        let passport = &mut ctx.accounts.passport;
        let (next_elo_scaled, delta_elo_scaled, expected_score_scaled) =
            compute_updated_market_elo(
                passport.elo_scaled,
                args.room_mean_elo_scaled,
                args.placement_score_scaled,
                args.is_live_mode,
            )?;

        passport.elo_scaled = next_elo_scaled;
        passport.matches_played = passport
            .matches_played
            .checked_add(1)
            .ok_or(PassportError::MathOverflow)?;
        if args.is_win {
            passport.wins_count = passport
                .wins_count
                .checked_add(1)
                .ok_or(PassportError::MathOverflow)?;
        }

        if let Some(sharpe) = args.sharpe_score_scaled {
            if sharpe > passport.best_sharpe_scaled {
                passport.best_sharpe_scaled = sharpe;
            }
        }
        if let Some(brier) = args.brier_score_scaled {
            if brier > passport.best_brier_scaled {
                passport.best_brier_scaled = brier;
            }
        }

        match args.asset_credit_kind {
            AssetCreditKind::Usdc => {
                passport.earned_usdc_units = passport
                    .earned_usdc_units
                    .checked_add(args.asset_credit_units)
                    .ok_or(PassportError::MathOverflow)?;
            }
            AssetCreditKind::Nvdax => {
                passport.earned_nvda_units = passport
                    .earned_nvda_units
                    .checked_add(args.asset_credit_units)
                    .ok_or(PassportError::MathOverflow)?;
            }
            AssetCreditKind::Spyx => {
                passport.earned_spy_units = passport
                    .earned_spy_units
                    .checked_add(args.asset_credit_units)
                    .ok_or(PassportError::MathOverflow)?;
            }
            AssetCreditKind::Antx => {
                passport.earned_ant_units = passport
                    .earned_ant_units
                    .checked_add(args.asset_credit_units)
                    .ok_or(PassportError::MathOverflow)?;
            }
        }

        emit!(PassportEloUpdated {
            owner: passport.owner,
            next_elo_scaled,
            delta_elo_scaled,
            expected_score_scaled,
            matches_played: passport.matches_played,
            wins_count: passport.wins_count,
            asset_credit_kind: args.asset_credit_kind,
            asset_credit_units: args.asset_credit_units,
        });
        Ok(())
    }
}

struct BoundEnvelope {
    payout_usdc: u64,
    rank: u16,
}

/// Reads a v2 `SessionRiskEnvelope` at fixed offsets: 8 disc + room_shard (8..40) + player (40..72)
/// + session key (72..104) + principal (104..112) + leverage (112) + payout (113..121) + rank (121..123)
/// + settled (123) + claimed (124) + claimed_mint (125..157) + bump (157) + funder (158..190) + refunded (190).
fn parse_settled_envelope(
    env_info: &AccountInfo,
    room_shard: &Pubkey,
    owner: &Pubkey,
) -> Result<BoundEnvelope> {
    require!(
        env_info.owner == &VAULT_ROUTER_PROGRAM_ID,
        PassportError::InvalidEnvelope
    );
    let data = env_info.try_borrow_data()?;
    require!(
        data.len() >= SESSION_ENVELOPE_V2_LEN && data[..8] == SESSION_ENVELOPE_DISCRIMINATOR,
        PassportError::InvalidEnvelope
    );
    let env_room =
        Pubkey::try_from(&data[8..40]).map_err(|_| error!(PassportError::InvalidEnvelope))?;
    let env_player =
        Pubkey::try_from(&data[40..72]).map_err(|_| error!(PassportError::InvalidEnvelope))?;
    let funder =
        Pubkey::try_from(&data[158..190]).map_err(|_| error!(PassportError::InvalidEnvelope))?;
    require_keys_eq!(env_room, *room_shard, PassportError::InvalidEnvelope);
    require_keys_eq!(funder, *owner, PassportError::InvalidEnvelope);
    let expected = Pubkey::create_program_address(
        &[
            SEED_SESSION_ENVELOPE,
            env_room.as_ref(),
            env_player.as_ref(),
            &[data[157]],
        ],
        &VAULT_ROUTER_PROGRAM_ID,
    )
    .map_err(|_| error!(PassportError::InvalidEnvelope))?;
    require_keys_eq!(env_info.key(), expected, PassportError::InvalidEnvelope);
    let settled = data[123] != 0;
    let refunded = data[190] != 0;
    require!(settled && !refunded, PassportError::EnvelopeNotSettled);
    let mut payout = [0u8; 8];
    payout.copy_from_slice(&data[113..121]);
    Ok(BoundEnvelope {
        payout_usdc: u64::from_le_bytes(payout),
        rank: u16::from_le_bytes([data[121], data[122]]),
    })
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

/// Exact deterministic `10^(x / (400 * 10^9))` scaled by `10^9`.
/// Uses octave decomposition + 8-term integer Taylor series matching `packages/shared-types/src/fixed-point.ts` bit-for-bit.
pub fn pow10_elo_ratio_scaled(elo_diff_scaled: i128) -> Result<i128> {
    let clamped_diff = fp_clamp(elo_diff_scaled, -1_600 * SCALE, 1_600 * SCALE);

    let mut q = clamped_diff / ELO_DIVISOR_SCALED;
    let mut r = clamped_diff - q * ELO_DIVISOR_SCALED;
    if r > 200 * SCALE {
        q += 1;
        r -= ELO_DIVISOR_SCALED;
    } else if r < -200 * SCALE {
        q -= 1;
        r += ELO_DIVISOR_SCALED;
    }

    let z_scaled = r
        .checked_mul(LN10_SCALED)
        .ok_or(PassportError::MathOverflow)?
        / ELO_DIVISOR_SCALED;

    let mut term = SCALE;
    let mut exp_sum = SCALE;
    let mut n: i128 = 1;
    while n <= 8 {
        term = term
            .checked_mul(z_scaled)
            .ok_or(PassportError::MathOverflow)?
            / (n * SCALE);
        exp_sum = exp_sum
            .checked_add(term)
            .ok_or(PassportError::MathOverflow)?;
        n += 1;
    }

    if q >= 0 {
        let mut factor: i128 = 1;
        let mut i: i128 = 0;
        while i < q {
            factor = factor.checked_mul(10).ok_or(PassportError::MathOverflow)?;
            i += 1;
        }
        exp_sum
            .checked_mul(factor)
            .ok_or_else(|| error!(PassportError::MathOverflow))
    } else {
        let mut divisor: i128 = 1;
        let mut i: i128 = 0;
        while i < -q {
            divisor = divisor.checked_mul(10).ok_or(PassportError::MathOverflow)?;
            i += 1;
        }
        Ok(exp_sum / divisor)
    }
}

pub fn compute_updated_market_elo(
    player_elo_scaled: i128,
    room_mean_elo_scaled: i128,
    placement_score_scaled: i128,
    is_live_mode: bool,
) -> Result<(i128, i128, i128)> {
    let k_factor = if is_live_mode {
        ELO_K_LIVE
    } else {
        ELO_K_PAPER
    };
    let clamped_placement = fp_clamp(placement_score_scaled, 0, SCALE);
    let diff = room_mean_elo_scaled
        .checked_sub(player_elo_scaled)
        .ok_or(PassportError::MathOverflow)?;
    let ratio_scaled = pow10_elo_ratio_scaled(diff)?;
    let denom = SCALE
        .checked_add(ratio_scaled)
        .ok_or(PassportError::MathOverflow)?;
    require!(denom > 0, PassportError::MathOverflow);

    let expected_score_scaled = (SCALE * SCALE) / denom;
    let score_diff = clamped_placement
        .checked_sub(expected_score_scaled)
        .ok_or(PassportError::MathOverflow)?;
    let raw_delta = k_factor
        .checked_mul(score_diff)
        .ok_or(PassportError::MathOverflow)?;
    let raw_next = player_elo_scaled
        .checked_add(raw_delta)
        .ok_or(PassportError::MathOverflow)?;
    let next_elo_scaled = if raw_next < MIN_ELO_SCALED {
        MIN_ELO_SCALED
    } else {
        raw_next
    };
    let actual_delta = next_elo_scaled
        .checked_sub(player_elo_scaled)
        .ok_or(PassportError::MathOverflow)?;

    Ok((next_elo_scaled, actual_delta, expected_score_scaled))
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AssetCreditKind {
    Usdc,
    Nvdax,
    Spyx,
    Antx,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecordEloArgs {
    pub room_mean_elo_scaled: i128,
    pub placement_score_scaled: i128,
    pub is_live_mode: bool,
    pub is_win: bool,
    pub sharpe_score_scaled: Option<i128>,
    pub brier_score_scaled: Option<i128>,
    pub asset_credit_kind: AssetCreditKind,
    pub asset_credit_units: u64,
    pub room_shard: Pubkey,
}

/// Idempotency receipt: one ELO / earned-asset credit per (passport owner, room).
#[account]
#[derive(InitSpace, Debug)]
pub struct MatchCredit {
    pub passport_owner: Pubkey,
    pub room_shard: Pubkey,
    pub credited_units: u64,
    pub recorded_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct PassportConfig {
    pub admin: Pubkey,
    pub keeper_authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct MarketPassport {
    pub owner: Pubkey,
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

#[derive(Accounts)]
pub struct InitializePassportConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + PassportConfig::INIT_SPACE,
        seeds = [SEED_PASSPORT_CONFIG],
        bump
    )]
    pub passport_config: Account<'info, PassportConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializePassport<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + MarketPassport::INIT_SPACE,
        seeds = [SEED_PASSPORT, owner.key().as_ref()],
        bump
    )]
    pub passport: Account<'info, MarketPassport>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEligibilityBitmask<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [SEED_PASSPORT_CONFIG],
        bump = passport_config.bump
    )]
    pub passport_config: Account<'info, PassportConfig>,
    #[account(
        mut,
        seeds = [SEED_PASSPORT, passport.owner.as_ref()],
        bump = passport.bump
    )]
    pub passport: Account<'info, MarketPassport>,
}

#[derive(Accounts)]
#[instruction(args: RecordEloArgs)]
pub struct RecordEloAndVaultCredit<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [SEED_PASSPORT_CONFIG],
        bump = passport_config.bump
    )]
    pub passport_config: Account<'info, PassportConfig>,
    #[account(
        mut,
        seeds = [SEED_PASSPORT, passport.owner.as_ref()],
        bump = passport.bump
    )]
    pub passport: Account<'info, MarketPassport>,
    /// Receipt rent payer (the relayer; may equal `authority`).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// A second credit for the same (owner, room) fails here with "already in use".
    #[account(
        init,
        payer = payer,
        space = 8 + MatchCredit::INIT_SPACE,
        seeds = [SEED_MATCH_CREDIT, passport.owner.as_ref(), args.room_shard.as_ref()],
        bump
    )]
    pub match_credit: Account<'info, MatchCredit>,
    /// CHECK: vault-router SessionRiskEnvelope; owner, discriminator, PDA, room, funder and
    /// settlement verified in `parse_settled_envelope`.
    pub session_envelope: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct PassportInitialized {
    pub owner: Pubkey,
    pub passport: Pubkey,
    pub elo_scaled: i128,
}

#[event]
pub struct EligibilityUpdated {
    pub owner: Pubkey,
    pub eligibility_bitmask: u8,
}

#[event]
pub struct PassportEloUpdated {
    pub owner: Pubkey,
    pub next_elo_scaled: i128,
    pub delta_elo_scaled: i128,
    pub expected_score_scaled: i128,
    pub matches_played: u32,
    pub wins_count: u32,
    pub asset_credit_kind: AssetCreditKind,
    pub asset_credit_units: u64,
}

#[error_code]
pub enum PassportError {
    #[msg("Invalid default authority pubkey")]
    InvalidAuthority,
    #[msg("Caller is not authorized to update passport state")]
    UnauthorizedAuthority,
    #[msg("Eligibility bitmask contains unsupported flag bits")]
    InvalidEligibilityBits,
    #[msg("Room mean ELO must be at least 100.0")]
    InvalidMeanElo,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Session envelope is not the vault-router envelope of this room and wallet")]
    InvalidEnvelope,
    #[msg("Session envelope is not settled (or was refunded)")]
    EnvelopeNotSettled,
    #[msg("Credit units or win flag do not match the settled envelope")]
    CreditMismatch,
}
