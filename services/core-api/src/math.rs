//! Deterministic Fixed-Point Skill, ELO, and Payout Conservation Math (`SCALE = 1_000_000_000`).
//! Strictly zero floating-point operations (`i128` / `u128` / `u64` only), matching `shared-types/src/fixed-point.ts` bit-for-bit.

use serde::{Deserialize, Serialize};

use crate::constants::{
    BPS_DENOMINATOR_U64, ELO_K_LIVE, ELO_K_PAPER, MAX_CREATOR_SHARE_BPS, PARTNER_CREATOR_SHARE_BPS,
    PARTNER_WALLET_SHARE_BPS, SCALE,
};

#[inline]
pub fn fp_clamp(val: i128, min_val: i128, max_val: i128) -> i128 {
    if val < min_val {
        min_val
    } else if val > max_val {
        max_val
    } else {
        val
    }
}

#[inline]
pub fn fp_mul(a: i128, b: i128) -> i128 {
    a.saturating_mul(b) / SCALE
}

pub fn fp_div(a: i128, b: i128) -> Result<i128, &'static str> {
    if b == 0 {
        return Err("Fixed-point division by zero");
    }
    Ok(a.saturating_mul(SCALE) / b)
}

pub fn isqrt_i128(n: i128) -> Result<i128, &'static str> {
    if n < 0 {
        return Err("Square root of negative integer");
    }
    if n < 2 {
        return Ok(n);
    }
    let nu = n as u128;
    let mut x0 = nu;
    let mut x1 = (x0 + 1) >> 1;
    while x1 < x0 {
        x0 = x1;
        x1 = (x0 + nu / x0) >> 1;
    }
    Ok(x0 as i128)
}

pub fn fp_sqrt(x_scaled: i128) -> Result<i128, &'static str> {
    if x_scaled < 0 {
        return Err("fp_sqrt requires non-negative scaled input");
    }
    isqrt_i128(x_scaled.saturating_mul(SCALE))
}

#[derive(Debug, Clone, Copy)]
pub struct RelativeReturnAssetLeg {
    /// Weight scaled by `10^9` in `[-SCALE, +SCALE]`. Sum of `|weight_scaled|` across legs must be `<= SCALE`.
    pub weight_scaled: i128,
    /// Positive entry price in integer oracle units (`10^8`).
    pub entry_price: i128,
    /// Non-negative exit price in integer oracle units (`10^8`).
    pub exit_price: i128,
}

/// Formula 1: Direction-Neutral Relative Return (`S_rel`, scaled by `10^9`).
pub fn compute_direction_neutral_relative_return(
    legs: &[RelativeReturnAssetLeg],
    beta_bench_scaled: i128,
) -> Result<i128, &'static str> {
    if legs.is_empty() {
        return Ok(0);
    }
    let mut abs_weight_sum: i128 = 0;
    let mut weighted_return_sum: i128 = 0;
    let mut raw_return_sum: i128 = 0;

    for leg in legs {
        if leg.entry_price <= 0 || leg.exit_price < 0 {
            return Err("Invalid non-positive entry_price or negative exit_price");
        }
        abs_weight_sum = abs_weight_sum.saturating_add(leg.weight_scaled.abs());
        let asset_return_scaled =
            (leg.exit_price - leg.entry_price).saturating_mul(SCALE) / leg.entry_price;
        weighted_return_sum =
            weighted_return_sum.saturating_add(fp_mul(leg.weight_scaled, asset_return_scaled));
        raw_return_sum = raw_return_sum.saturating_add(asset_return_scaled);
    }

    if abs_weight_sum > SCALE {
        return Err("Gross conviction weight exceeds SCALE (1.0x)");
    }

    let n_legs = legs.len() as i128;
    let bench_mean_return_scaled = raw_return_sum / n_legs;
    let bench_adjustment_scaled = fp_mul(beta_bench_scaled, bench_mean_return_scaled);
    Ok(weighted_return_sum - bench_adjustment_scaled)
}

/// Formula 2: Drawdown-Penalized Volatility Sharpe (`S_sharpe`, scaled by `10^9`).
pub fn compute_drawdown_penalized_sharpe(
    step_returns_scaled: &[i128],
    max_drawdown_scaled: i128,
    lambda_dd_scaled: i128,
    epsilon_scaled_sq: i128,
) -> Result<i128, &'static str> {
    if step_returns_scaled.is_empty() {
        return Ok(0);
    }
    if max_drawdown_scaled < 0 || epsilon_scaled_sq <= 0 {
        return Err("max_drawdown_scaled must be >= 0 and epsilon_scaled_sq must be > 0");
    }

    let k = step_returns_scaled.len() as i128;
    let mut sum_returns: i128 = 0;
    for &r in step_returns_scaled {
        sum_returns = sum_returns.saturating_add(r);
    }
    let mean_return = sum_returns / k;

    let mut sum_sq_diff_18: i128 = 0;
    for &r in step_returns_scaled {
        let diff = r - mean_return;
        sum_sq_diff_18 = sum_sq_diff_18.saturating_add(diff.saturating_mul(diff));
    }

    let denom_scaled = isqrt_i128(sum_sq_diff_18.saturating_add(epsilon_scaled_sq))?;
    let raw_sharpe_scaled = fp_div(sum_returns, denom_scaled)?;
    let drawdown_penalty_scaled = fp_mul(lambda_dd_scaled, max_drawdown_scaled);
    Ok(raw_sharpe_scaled - drawdown_penalty_scaled)
}

#[derive(Debug, Clone, Copy)]
pub struct BrierForecastItem {
    pub forecast_prob_scaled: i128,
    pub outcome_scaled: i128,
}

/// Formula 3: Kalshi Prediction Brier Calibration (`S_brier`, scaled by `10^9`).
pub fn compute_kalshi_brier_score(items: &[BrierForecastItem]) -> i128 {
    if items.is_empty() {
        return 0;
    }
    let mut sq_err_sum_scaled: i128 = 0;
    for item in items {
        let f = fp_clamp(item.forecast_prob_scaled, 0, SCALE);
        let o = fp_clamp(item.outcome_scaled, 0, SCALE);
        let diff = f - o;
        let sq_scaled = diff.saturating_mul(diff) / SCALE;
        sq_err_sum_scaled = sq_err_sum_scaled.saturating_add(sq_scaled);
    }
    let mean_brier_loss_scaled = sq_err_sum_scaled / (items.len() as i128);
    SCALE - mean_brier_loss_scaled
}

/// Formula 4a: Multi-Stage Carry-Over Total Score (`S_total`, scaled by `10^9`).
pub fn compute_multi_stage_carry_score(
    stage1_score_scaled: i128,
    stage2_score_scaled: i128,
    max_multiplier_scaled: i128,
) -> i128 {
    let clamped_stage1 = fp_clamp(stage1_score_scaled, 0, SCALE);
    let bonus_factor = fp_mul(max_multiplier_scaled - SCALE, clamped_stage1);
    let multiplier = SCALE + bonus_factor;
    fp_mul(stage2_score_scaled, multiplier)
}

const LN10_SCALED: i128 = 2_302_585_093;
const ELO_DIVISOR_SCALED: i128 = 400 * SCALE;

/// Exact deterministic `10^(x / (400 * 10^9))` scaled by `10^9`.
pub fn pow10_elo_ratio_scaled(elo_diff_scaled: i128) -> i128 {
    let clamped_diff = fp_clamp(elo_diff_scaled, -1600 * SCALE, 1600 * SCALE);
    let mut q = clamped_diff / ELO_DIVISOR_SCALED;
    let mut r = clamped_diff - q * ELO_DIVISOR_SCALED;
    if r > 200 * SCALE {
        q += 1;
        r -= ELO_DIVISOR_SCALED;
    } else if r < -200 * SCALE {
        q -= 1;
        r += ELO_DIVISOR_SCALED;
    }

    let z_scaled = (r * LN10_SCALED) / ELO_DIVISOR_SCALED;
    let mut term = SCALE;
    let mut exp_sum = SCALE;
    for n in 1..=8_i128 {
        term = (term * z_scaled) / (n * SCALE);
        exp_sum += term;
    }

    if q >= 0 {
        let mut factor: i128 = 1;
        for _ in 0..q {
            factor *= 10;
        }
        exp_sum * factor
    } else {
        let mut divisor: i128 = 1;
        for _ in 0..(-q) {
            divisor *= 10;
        }
        exp_sum / divisor
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchStakeMode {
    #[serde(rename = "PAPER")]
    Paper,
    #[serde(rename = "LIVE")]
    Live,
}

#[derive(Debug, Clone, Copy)]
pub struct EloUpdateResult {
    pub next_elo_scaled: i128,
    pub delta_elo_scaled: i128,
    pub expected_score_scaled: i128,
}

/// Formula 4b: Multiplayer Market ELO Update (`ELO'_u`, scaled by `10^9`).
pub fn compute_updated_market_elo(
    player_elo_scaled: i128,
    room_mean_elo_scaled: i128,
    placement_score_scaled: i128,
    mode: MatchStakeMode,
) -> EloUpdateResult {
    let k_factor = match mode {
        MatchStakeMode::Live => ELO_K_LIVE,
        MatchStakeMode::Paper => ELO_K_PAPER,
    };
    let clamped_placement = fp_clamp(placement_score_scaled, 0, SCALE);
    let ratio_scaled = pow10_elo_ratio_scaled(room_mean_elo_scaled - player_elo_scaled);
    let expected_score_scaled = (SCALE * SCALE) / (SCALE + ratio_scaled);
    let delta_raw = k_factor * (clamped_placement - expected_score_scaled);
    let raw_next = player_elo_scaled + delta_raw;
    let next_elo_scaled = if raw_next < 100 * SCALE {
        100 * SCALE
    } else {
        raw_next
    };
    EloUpdateResult {
        next_elo_scaled,
        delta_elo_scaled: next_elo_scaled - player_elo_scaled,
        expected_score_scaled,
    }
}

#[derive(Debug, Clone)]
pub struct PlayerScoreInput {
    pub player: String,
    pub score_scaled: i128,
    pub tiebreak_key: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerPayout {
    pub player: String,
    pub rank: usize,
    pub score_scaled: String,
    pub score_formatted: String,
    pub payout_usdc_atomic: u64,
}

#[derive(Debug, Clone)]
pub struct PoolDistributionResult {
    pub room_pool_usdc: u64,
    pub total_fee_usdc: u64,
    pub platform_fee_usdc: u64,
    pub creator_fee_usdc: u64,
    pub partner_fee_usdc: u64,
    pub net_prize_pool_usdc: u64,
    pub payouts: Vec<PlayerPayout>,
    pub total_distributed_usdc: u64,
    pub undistributed_dust_usdc: u64,
}

/// Computes exact integer USDC payouts and builder/protocol fee splits (`50/50` standalone or `40/30/30` partner wallet)
/// with provable conservation: `sum(winner_payouts) + platform_fee + creator_fee + partner_fee <= room_pool_usdc`.
pub fn compute_pool_and_fee_distribution(
    room_pool_usdc: u64,
    total_fee_bps: u16,
    creator_share_bps: u16,
    partner_wallet_active: bool,
    player_scores: &[PlayerScoreInput],
) -> Result<PoolDistributionResult, &'static str> {
    if total_fee_bps > 1_000 {
        return Err("total_fee_bps out of bounds [0, 1000]");
    }
    if creator_share_bps > MAX_CREATOR_SHARE_BPS {
        return Err("creator_share_bps exceeds 5000 bps cap");
    }

    let pool_u128 = room_pool_usdc as u128;
    let total_fee_u128 = (pool_u128 * (total_fee_bps as u128)) / (BPS_DENOMINATOR_U64 as u128);
    let total_fee_usdc = total_fee_u128 as u64;

    let (partner_fee_usdc, creator_fee_usdc, platform_fee_usdc) = if partner_wallet_active {
        let partner = ((total_fee_u128 * (PARTNER_WALLET_SHARE_BPS as u128))
            / (BPS_DENOMINATOR_U64 as u128)) as u64;
        let creator = ((total_fee_u128 * (PARTNER_CREATOR_SHARE_BPS as u128))
            / (BPS_DENOMINATOR_U64 as u128)) as u64;
        let platform = total_fee_usdc
            .saturating_sub(partner)
            .saturating_sub(creator);
        (partner, creator, platform)
    } else {
        let creator =
            ((total_fee_u128 * (creator_share_bps as u128)) / (BPS_DENOMINATOR_U64 as u128)) as u64;
        let platform = total_fee_usdc.saturating_sub(creator);
        (0, creator, platform)
    };

    let net_prize_pool_usdc = room_pool_usdc.saturating_sub(total_fee_usdc);

    if player_scores.is_empty() || net_prize_pool_usdc == 0 {
        let mut zero_payouts = Vec::with_capacity(player_scores.len());
        for (idx, p) in player_scores.iter().enumerate() {
            zero_payouts.push(PlayerPayout {
                player: p.player.clone(),
                rank: idx + 1,
                score_scaled: p.score_scaled.to_string(),
                score_formatted: format_scaled_i128(p.score_scaled, 4),
                payout_usdc_atomic: 0,
            });
        }
        let total_distributed_usdc = platform_fee_usdc
            .saturating_add(creator_fee_usdc)
            .saturating_add(partner_fee_usdc);
        return Ok(PoolDistributionResult {
            room_pool_usdc,
            total_fee_usdc,
            platform_fee_usdc,
            creator_fee_usdc,
            partner_fee_usdc,
            net_prize_pool_usdc,
            payouts: zero_payouts,
            total_distributed_usdc,
            undistributed_dust_usdc: room_pool_usdc.saturating_sub(total_distributed_usdc),
        });
    }

    let mut indexed: Vec<(usize, &PlayerScoreInput)> = player_scores.iter().enumerate().collect();
    indexed.sort_by(|(idx_a, a), (idx_b, b)| {
        b.score_scaled
            .cmp(&a.score_scaled)
            .then_with(|| b.tiebreak_key.cmp(&a.tiebreak_key))
            .then_with(|| idx_a.cmp(idx_b))
    });

    let n = indexed.len();
    // Top 20% via integer ceiling `(n + 4) / 5`, minimum up to `min(3, n)` podium winners in small pods
    let top_20_ceil = n.div_ceil(5);
    let min_podium = n.min(3);
    let winner_count = top_20_ceil.max(min_podium);

    const WEIGHT_BASE: u128 = 2_520_000;
    let mut raw_weights = Vec::with_capacity(winner_count);
    let mut weight_sum: u128 = 0;
    for r in 0..winner_count {
        let w = WEIGHT_BASE / ((r + 1) as u128);
        raw_weights.push(w);
        weight_sum += w;
    }

    let mut payouts = Vec::with_capacity(n);
    let mut paid_winner_sum: u64 = 0;
    for (rank_zero, (_, entry)) in indexed.iter().enumerate() {
        let payout_usdc_atomic = if rank_zero < winner_count && weight_sum > 0 {
            let w = raw_weights[rank_zero];
            let p = (((net_prize_pool_usdc as u128) * w) / weight_sum) as u64;
            paid_winner_sum = paid_winner_sum.saturating_add(p);
            p
        } else {
            0
        };
        payouts.push(PlayerPayout {
            player: entry.player.clone(),
            rank: rank_zero + 1,
            score_scaled: entry.score_scaled.to_string(),
            score_formatted: format_scaled_i128(entry.score_scaled, 4),
            payout_usdc_atomic,
        });
    }

    // Credit integer division dust strictly to Rank #1 winner
    let prize_dust = net_prize_pool_usdc.saturating_sub(paid_winner_sum);
    if prize_dust > 0 {
        if let Some(first) = payouts.first_mut() {
            first.payout_usdc_atomic = first.payout_usdc_atomic.saturating_add(prize_dust);
            paid_winner_sum = paid_winner_sum.saturating_add(prize_dust);
        }
    }

    let total_distributed_usdc = paid_winner_sum
        .saturating_add(platform_fee_usdc)
        .saturating_add(creator_fee_usdc)
        .saturating_add(partner_fee_usdc);

    if total_distributed_usdc > room_pool_usdc {
        return Err("Solvency invariant violated: distributed exceeds room pool");
    }

    Ok(PoolDistributionResult {
        room_pool_usdc,
        total_fee_usdc,
        platform_fee_usdc,
        creator_fee_usdc,
        partner_fee_usdc,
        net_prize_pool_usdc,
        payouts,
        total_distributed_usdc,
        undistributed_dust_usdc: room_pool_usdc.saturating_sub(total_distributed_usdc),
    })
}

/// Formats a `10^9`-scaled `i128` into a fixed decimal string without IEEE-754 float conversion.
pub fn format_scaled_i128(value_scaled: i128, decimals: usize) -> String {
    let negative = value_scaled < 0;
    let abs_val: u128 = value_scaled.unsigned_abs();
    let scale_u128 = SCALE as u128;
    let whole = abs_val / scale_u128;
    let frac_raw = abs_val % scale_u128;
    let clamped_dec = decimals.min(9);
    let sign = if negative { "-" } else { "" };
    if clamped_dec == 0 {
        format!("{sign}{whole}")
    } else {
        let frac_padded = format!("{frac_raw:09}");
        format!("{sign}{whole}.{}", &frac_padded[..clamped_dec])
    }
}
