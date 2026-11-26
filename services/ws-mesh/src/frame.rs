//! Exact 48-byte little-endian binary `WorldPulseFrame` codec (`magic = 0xCF`, `version = 2`),
//! matching `packages/shared-types/src/accounts.ts` byte-for-byte.

use cartridge_core_api::rooms::RoomPhaseCode;
use serde::{Deserialize, Serialize};

pub const WORLD_PULSE_FRAME_BYTES: usize = 48;
pub const WORLD_PULSE_MAGIC: u8 = 0xCF;
pub const WORLD_PULSE_VERSION: u8 = 2;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FrameCodecError {
    #[error("invalid WorldPulseFrame byte length: expected {WORLD_PULSE_FRAME_BYTES}, got {0}")]
    InvalidLength(usize),
    #[error("invalid WorldPulseFrame header: magic=0x{magic:02X}, version={version}")]
    InvalidHeader { magic: u8, version: u8 },
    #[error("invalid RoomPhaseCode byte: {0}")]
    InvalidPhase(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldPulseFrame {
    pub phase: RoomPhaseCode,
    pub asset_index: u8,
    pub timestamp_ms: u64,
    pub price8: i64,
    pub velocity_bps: i32,
    pub volatility_sigma_milli: u32,
    pub countdown_remaining_ms: u32,
    pub player_rank: u16,
    pub total_players: u16,
    pub top_leader_score_scaled: i64,
    pub active_rooms_count: u16,
    pub is_fog_encrypted: bool,
    pub vrf_verified: bool,
}

impl WorldPulseFrame {
    pub fn encode(&self) -> [u8; WORLD_PULSE_FRAME_BYTES] {
        let mut buf = [0u8; WORLD_PULSE_FRAME_BYTES];
        buf[0] = WORLD_PULSE_MAGIC;
        buf[1] = WORLD_PULSE_VERSION;
        buf[2] = self.phase.as_u8();
        buf[3] = self.asset_index;
        buf[4..12].copy_from_slice(&self.timestamp_ms.to_le_bytes());
        buf[12..20].copy_from_slice(&self.price8.to_le_bytes());
        buf[20..24].copy_from_slice(&self.velocity_bps.to_le_bytes());
        buf[24..28].copy_from_slice(&self.volatility_sigma_milli.to_le_bytes());
        buf[28..32].copy_from_slice(&self.countdown_remaining_ms.to_le_bytes());
        buf[32..34].copy_from_slice(&self.player_rank.to_le_bytes());
        buf[34..36].copy_from_slice(&self.total_players.to_le_bytes());
        buf[36..44].copy_from_slice(&self.top_leader_score_scaled.to_le_bytes());
        buf[44..46].copy_from_slice(&self.active_rooms_count.to_le_bytes());
        let flags: u16 = (u16::from(self.is_fog_encrypted)) | (u16::from(self.vrf_verified) << 1);
        buf[46..48].copy_from_slice(&flags.to_le_bytes());
        buf
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, FrameCodecError> {
        if bytes.len() < WORLD_PULSE_FRAME_BYTES {
            return Err(FrameCodecError::InvalidLength(bytes.len()));
        }
        let magic = bytes[0];
        let version = bytes[1];
        if magic != WORLD_PULSE_MAGIC || version != WORLD_PULSE_VERSION {
            return Err(FrameCodecError::InvalidHeader { magic, version });
        }
        let phase = match bytes[2] {
            0 => RoomPhaseCode::LobbyOpen,
            1 => RoomPhaseCode::FogOfWar,
            2 => RoomPhaseCode::Showdown,
            3 => RoomPhaseCode::SettledCommitted,
            4 => RoomPhaseCode::RetryGrace,
            other => return Err(FrameCodecError::InvalidPhase(other)),
        };
        let asset_index = bytes[3];

        let mut ts_arr = [0u8; 8];
        ts_arr.copy_from_slice(&bytes[4..12]);
        let timestamp_ms = u64::from_le_bytes(ts_arr);

        let mut price_arr = [0u8; 8];
        price_arr.copy_from_slice(&bytes[12..20]);
        let price8 = i64::from_le_bytes(price_arr);

        let mut vel_arr = [0u8; 4];
        vel_arr.copy_from_slice(&bytes[20..24]);
        let velocity_bps = i32::from_le_bytes(vel_arr);

        let mut sig_arr = [0u8; 4];
        sig_arr.copy_from_slice(&bytes[24..28]);
        let volatility_sigma_milli = u32::from_le_bytes(sig_arr);

        let mut cd_arr = [0u8; 4];
        cd_arr.copy_from_slice(&bytes[28..32]);
        let countdown_remaining_ms = u32::from_le_bytes(cd_arr);

        let mut rank_arr = [0u8; 2];
        rank_arr.copy_from_slice(&bytes[32..34]);
        let player_rank = u16::from_le_bytes(rank_arr);

        let mut tot_arr = [0u8; 2];
        tot_arr.copy_from_slice(&bytes[34..36]);
        let total_players = u16::from_le_bytes(tot_arr);

        let mut score_arr = [0u8; 8];
        score_arr.copy_from_slice(&bytes[36..44]);
        let top_leader_score_scaled = i64::from_le_bytes(score_arr);

        let mut rooms_arr = [0u8; 2];
        rooms_arr.copy_from_slice(&bytes[44..46]);
        let active_rooms_count = u16::from_le_bytes(rooms_arr);

        let mut flags_arr = [0u8; 2];
        flags_arr.copy_from_slice(&bytes[46..48]);
        let flags = u16::from_le_bytes(flags_arr);

        Ok(Self {
            phase,
            asset_index,
            timestamp_ms,
            price8,
            velocity_bps,
            volatility_sigma_milli,
            countdown_remaining_ms,
            player_rank,
            total_players,
            top_leader_score_scaled,
            active_rooms_count,
            is_fog_encrypted: (flags & 1) == 1,
            vrf_verified: (flags & 2) == 2,
        })
    }
}
