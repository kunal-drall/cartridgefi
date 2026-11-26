//! Verified CartridgeFi, Solana L1, MagicBlock ER/PER, Pyth, Jupiter, Phoenix, and DFlow constants.
//! Strictly integer-only bounds (`SCALE = 1_000_000_000`).

pub const SCALE: i128 = 1_000_000_000;
pub const USDC_DECIMALS: u32 = 6;
pub const USDC_UNIT: u64 = 1_000_000;
pub const BPS_DENOMINATOR: i128 = 10_000;
pub const BPS_DENOMINATOR_U64: u64 = 10_000;

// Verified CartridgeFi On-Chain Program IDs
pub const REGISTRY_PROGRAM_ID: &str = "5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr";
pub const ER_ROOM_PROGRAM_ID: &str = "Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR";
pub const VAULT_ROUTER_PROGRAM_ID: &str = "6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT";
pub const PASSPORT_PROGRAM_ID: &str = "5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr";

pub const CARTRIDGE_PROGRAM_IDS: [&str; 4] = [
    REGISTRY_PROGRAM_ID,
    ER_ROOM_PROGRAM_ID,
    VAULT_ROUTER_PROGRAM_ID,
    PASSPORT_PROGRAM_ID,
];

// Verified Devnet Authorities
pub const DEPLOYER_AND_KEEPER: &str = "D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1";
pub const PACER_BOT_1_PUBKEY: &str = "FRLBDfWhskqdGsoNkBMsnxHtQTy6Bkm25NEvsVncGAay";
pub const PACER_BOT_2_PUBKEY: &str = "7JdpFNAHqeoaYnnS9G1DY9qCyN33UBRyaySfANCHjFRa";
pub const PACER_BOT_3_PUBKEY: &str = "E5EwXiUfq9wCegbBwNdXpUvubkuJCZC4LDmR8wwQTJsR";
pub const KORA_SPONSOR_DEFAULT_PUBKEY: &str = "Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd";

// Verified MagicBlock Program IDs & Endpoints
pub const DELEGATION_PROGRAM_ID: &str = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
pub const PERMISSION_PROGRAM_ID: &str = "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";
pub const MAGIC_PROGRAM_ID: &str = "Magic11111111111111111111111111111111111111";
pub const MAGIC_CONTEXT_ID: &str = "MagicContext1111111111111111111111111111111";
pub const SESSION_KEY_PROGRAM_ID: &str = "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5";
pub const VRF_PROGRAM_ID: &str = "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz";
pub const ESPL_TOKEN_PROGRAM_ID: &str = "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2";
pub const DEFAULT_EPHEMERAL_VRF_QUEUE: &str = "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc";

pub const DEVNET_BASE_RPC: &str = "https://rpc.magicblock.app/devnet";
pub const DEVNET_ROUTER_HTTP: &str = "https://devnet-router.magicblock.app";
pub const DEVNET_ROUTER_WS: &str = "wss://devnet-router.magicblock.app";
pub const DEVNET_TEE_BASE_ENDPOINT: &str = "https://devnet-tee.magicblock.app";
pub const DEVNET_TEE_ENDPOINT_TEMPLATE: &str =
    "https://devnet-tee.magicblock.app?token={authToken}";
pub const PRIVATE_PAYMENTS_API_URL: &str = "https://payments.magicblock.app";

// Standard Solana System & SPL Programs (for Kora strict allowlist)
pub const SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";
pub const SPL_TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const TOKEN_2022_PROGRAM_ID: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
pub const ASSOCIATED_TOKEN_PROGRAM_ID: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
pub const COMPUTE_BUDGET_PROGRAM_ID: &str = "ComputeBudget111111111111111111111111111111";

pub const KORA_ALLOWLISTED_PROGRAMS: [&str; 15] = [
    REGISTRY_PROGRAM_ID,
    ER_ROOM_PROGRAM_ID,
    VAULT_ROUTER_PROGRAM_ID,
    PASSPORT_PROGRAM_ID,
    DELEGATION_PROGRAM_ID,
    PERMISSION_PROGRAM_ID,
    MAGIC_PROGRAM_ID,
    SESSION_KEY_PROGRAM_ID,
    VRF_PROGRAM_ID,
    ESPL_TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    SPL_TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    COMPUTE_BUDGET_PROGRAM_ID,
];

// Canonical Solana Token Mints
pub const MINT_USDC: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
pub const MINT_WSOL: &str = "So11111111111111111111111111111111111111112";
pub const MINT_NVDAX: &str = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
pub const MINT_SPYX: &str = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
pub const MINT_ANTX: &str = "XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb";
pub const MINT_TSLAX: &str = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

// Pyth Hermes v2 Price Feed IDs
pub const PYTH_HERMES_LATEST_URL: &str = "https://hermes.pyth.network/v2/updates/price/latest";
pub const PYTH_FEED_SOL_USD: &str =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const PYTH_FEED_BTC_USD: &str =
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
pub const PYTH_FEED_NVDAX_USD: &str =
    "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";
pub const PYTH_FEED_SPYX_USD: &str =
    "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5";

// Kalshi / DFlow SPL Outcome Markets
pub const KALSHI_FED_DEC26_CUT_ID: &str = "KALSHI-FED-DEC26-CUT";
pub const KALSHI_FED_YES_MINT: &str = "KFedYes111111111111111111111111111111111111";
pub const KALSHI_FED_NO_MINT: &str = "KFedNo1111111111111111111111111111111111111";

pub const KALSHI_NVDA_BEAT_Q4_ID: &str = "KALSHI-NVDA-BEAT-Q4";
pub const KALSHI_NVDA_YES_MINT: &str = "KNvdYes111111111111111111111111111111111111";
pub const KALSHI_NVDA_NO_MINT: &str = "KNvdNo1111111111111111111111111111111111111";

pub const KALSHI_SOL_ATH_2026_ID: &str = "KALSHI-SOL-ATH-2026";
pub const KALSHI_SOL_YES_MINT: &str = "KSolYes111111111111111111111111111111111111";
pub const KALSHI_SOL_NO_MINT: &str = "KSolNo1111111111111111111111111111111111111";

// Upstream Venue Endpoints
pub const JUPITER_SWAP_V2_ORDER_URL: &str = "https://api.jup.ag/swap/v2/order";
pub const DFLOW_DEV_ORDER_URL: &str = "https://dev-quote-api.dflow.net/order";
pub const VENUE_BUILDER_FEE_BPS: u16 = 20;

// Supported 7-Chain Deposit Intents -> Canonical Solana USDC
pub const SUPPORTED_DEPOSIT_CHAINS: [&str; 7] = [
    "solana", "base", "ethereum", "arbitrum", "bnb", "monad", "polygon",
];

// Engine Safety & Solvency Guardrails
pub const BETA_MAX_ROOM_POOL_USDC: u64 = 500_000_000; // 500 USDC (6 decimals)
pub const BETA_MAX_GLOBAL_TVL_USDC: u64 = 5_000_000_000; // 5,000 USDC (6 decimals)
pub const MAX_PLAYERS_PER_SHARD: usize = 200;
pub const MAX_LIVE_LEVERAGE: u8 = 5;
pub const MAX_CREATOR_SHARE_BPS: u16 = 5_000;
pub const PARTNER_WALLET_SHARE_BPS: u16 = 4_000;
pub const PARTNER_CREATOR_SHARE_BPS: u16 = 3_000;
pub const PARTNER_ENGINE_SHARE_BPS: u16 = 3_000;
pub const ROOM_TOTAL_FEE_BPS: u16 = 250; // 2.50% total room fee split between creator/partner/engine
pub const KORA_DAILY_LAMPORTS_CAP: u64 = 5_000_000; // 0.005 SOL / 24h per wallet
pub const KORA_MIN_SPONSOR_LAMPORTS: u64 = 5_000;

pub const DEFAULT_ELO_SCALED: i128 = 1_200_000_000_000;
pub const ELO_K_PAPER: i128 = 12;
pub const ELO_K_LIVE: i128 = 32;

// Passport Eligibility Bitmask
pub const PASSPORT_GEO_ELIGIBLE: u8 = 1;
pub const PASSPORT_CAN_CLAIM_XSTOCKS: u8 = 2;
pub const PASSPORT_SYBIL_VERIFIED: u8 = 4;
pub const PASSPORT_FULL_ELIGIBILITY: u8 =
    PASSPORT_GEO_ELIGIBLE | PASSPORT_CAN_CLAIM_XSTOCKS | PASSPORT_SYBIL_VERIFIED;

pub fn is_kora_allowlisted_program(program_id: &str) -> bool {
    KORA_ALLOWLISTED_PROGRAMS.contains(&program_id)
}

pub fn is_supported_deposit_chain(chain: &str) -> bool {
    SUPPORTED_DEPOSIT_CHAINS.contains(&chain)
}
