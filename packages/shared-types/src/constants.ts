/**
 * Verified CartridgeFi, Solana L1, MagicBlock ER/PER, Pyth, Jupiter, Phoenix, and DFlow constants.
 * Zero floating-point constants for financial or scoring bounds.
 */

export const CARTRIDGE_PROGRAM_IDS = {
  registry: "5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr",
  erRoom: "Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR",
  vaultRouter: "6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT",
  passport: "5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr",
} as const;

export const CARTRIDGE_DEVNET_AUTHORITIES = {
  deployerAndKeeper: "D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1",
  pacerBot1: "FRLBDfWhskqdGsoNkBMsnxHtQTy6Bkm25NEvsVncGAay",
  pacerBot2: "7JdpFNAHqeoaYnnS9G1DY9qCyN33UBRyaySfANCHjFRa",
  pacerBot3: "E5EwXiUfq9wCegbBwNdXpUvubkuJCZC4LDmR8wwQTJsR",
  koraSponsor: "Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd",
} as const;

export const MAGICBLOCK_CONSTANTS = {
  delegationProgramId: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
  permissionProgramId: "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
  magicProgramId: "Magic11111111111111111111111111111111111111",
  magicContextId: "MagicContext1111111111111111111111111111111",
  sessionKeyProgramId: "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
  vrfProgramId: "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
  esplTokenProgramId: "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2",
  pricingOracleProgramId: "PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd",
  defaultVrfQueue: "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
  defaultEphemeralVrfQueue: "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
  devnetBaseRpc: "https://rpc.magicblock.app/devnet",
  mainnetBaseRpc: "https://rpc.magicblock.app/mainnet",
  devnetRouterHttp: "https://devnet-router.magicblock.app",
  devnetRouterWs: "wss://devnet-router.magicblock.app",
  devnetTeeEndpointTemplate: "https://devnet-tee.magicblock.app?token={authToken}",
  devnetTeeBaseEndpoint: "https://devnet-tee.magicblock.app",
  privatePaymentsApiUrl: "https://payments.magicblock.app",
  statusApiUrl: "https://status.magicblock.app/api/services",
} as const;

export const SOLANA_CANONICAL_MINTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  WSOL: "So11111111111111111111111111111111111111112",
  NVDAx: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  SPYx: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
  ANTx: "XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb",
  TSLAx: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
} as const;

export const PYTH_FEED_IDS = {
  "SOL/USD": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "NVDAx/USD": "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  "SPYx/USD": "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
} as const;

export const KALSHI_DFLOW_MARKETS = {
  "KALSHI-FED-DEC26-CUT": {
    marketId: "KALSHI-FED-DEC26-CUT",
    title: "Fed cuts rates >= 25bps at Dec 2026 FOMC",
    yesMint: "KFedYes111111111111111111111111111111111111",
    noMint: "KFedNo1111111111111111111111111111111111111",
    venue: "DFLOW_KALSHI" as const,
  },
  "KALSHI-NVDA-BEAT-Q4": {
    marketId: "KALSHI-NVDA-BEAT-Q4",
    title: "NVIDIA beats Q4 FY27 revenue consensus",
    yesMint: "KNvdYes111111111111111111111111111111111111",
    noMint: "KNvdNo1111111111111111111111111111111111111",
    venue: "DFLOW_KALSHI" as const,
  },
  "KALSHI-SOL-ATH-2026": {
    marketId: "KALSHI-SOL-ATH-2026",
    title: "Solana prints new all-time high before Jan 1, 2027",
    yesMint: "KSolYes111111111111111111111111111111111111",
    noMint: "KSolNo1111111111111111111111111111111111111",
    venue: "DFLOW_KALSHI" as const,
  },
} as const;

export const SUPPORTED_DEPOSIT_CHAINS = [
  "solana",
  "base",
  "ethereum",
  "arbitrum",
  "bnb",
  "monad",
  "polygon",
] as const;

export type SupportedDepositChain = (typeof SUPPORTED_DEPOSIT_CHAINS)[number];

/**
 * Fixed-point scale: 10^9 (matches Rust `pub const SCALE: i128 = 1_000_000_000;`).
 */
export const FP_SCALE = 1_000_000_000n;
export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;

export const ENGINE_GUARDRAILS = {
  betaMaxRoomPoolUsdc: 500_000_000n, // 500 USDC (6 decimals)
  betaMaxGlobalTvlUsdc: 5_000_000_000n, // 5,000 USDC (6 decimals)
  maxPlayersPerShard: 200,
  maxLiveLeverage: 5,
  maxCreatorShareBps: 5000,
  partnerWalletShareBps: 4000,
  partnerCreatorShareBps: 3000,
  partnerEngineShareBps: 3000,
  pythMaxStalenessSecs: 15,
  pythMaxConfRatioBps: 150, // 1.50%
  defaultEloScaled: 1_200_000_000_000n, // 1200 * 10^9
  eloKPaper: 12n,
  eloKLive: 32n,
} as const;

export const PASSPORT_ELIGIBILITY_BITS = {
  GEO_ELIGIBLE: 1,
  CAN_CLAIM_XSTOCKS: 2,
  SYBIL_VERIFIED: 4,
} as const;
