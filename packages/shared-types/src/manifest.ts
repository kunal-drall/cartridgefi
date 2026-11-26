import * as z from "zod/v4";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  ENGINE_GUARDRAILS,
  KALSHI_DFLOW_MARKETS,
  PYTH_FEED_IDS,
  SOLANA_CANONICAL_MINTS,
  SUPPORTED_DEPOSIT_CHAINS,
} from "./constants.js";

export const CartridgeGenreEnum = z.enum([
  "BOREL_GAMEDAY",
  "ARCADE_RUNNER",
  "SYNDICATE_TURF",
  "PREDICTION_BRACKET",
]);
export type CartridgeGenre = z.infer<typeof CartridgeGenreEnum>;

export const EngineTargetEnum = z.enum([
  "NEXT_REACT",
  "PHASER_3",
  "THREE_JS",
  "UNITY_WEBGL",
]);
export type EngineTarget = z.infer<typeof EngineTargetEnum>;

export const PrivacyModeEnum = z.enum([
  "PRIVATE_TEE_FOG_OF_WAR",
  "PUBLIC_TRANSPARENT_ER",
]);
export type PrivacyMode = z.infer<typeof PrivacyModeEnum>;

export const VrfUsageEnum = z.enum([
  "TIEBREAK_AND_FREE_BONUS_DROP",
  "PROCEDURAL_TRACK_SEED_AND_TIEBREAK",
  "NONE",
]);
export type VrfUsage = z.infer<typeof VrfUsageEnum>;

export const MarketVenueEnum = z.enum([
  "JUPITER_XSTOCKS",
  "PHOENIX_PERP",
  "JUPITER_PERP",
  "DFLOW_KALSHI",
]);
export type MarketVenue = z.infer<typeof MarketVenueEnum>;

export const ScoringFormulaEnum = z.enum([
  "DIRECTION_NEUTRAL_REL_RETURN",
  "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL",
  "KALSHI_BRIER_CALIBRATION",
  "MULTI_STAGE_CARRY_COMPOSITE",
]);
export type ScoringFormulaName = z.infer<typeof ScoringFormulaEnum>;

export const PrizeCurveEnum = z.enum([
  "TOP_20_PERCENT_SHAPLEY",
  "PODIUM_TOP_3",
  "HEAD_TO_HEAD_1V1",
]);
export type PrizeCurveName = z.infer<typeof PrizeCurveEnum>;

export const StanceWeightLegSchema = z.object({
  asset: z.string().min(1).max(32),
  /** Integer basis points in [-10000, +10000] representing [-1.0, +1.0] without float drift. */
  weightBps: z.number().int().min(-10_000).max(10_000),
});

export const ActionBindingSchema = z.discriminatedUnion("bindingType", [
  z.object({
    gameEvent: z.string().min(2).max(64),
    bindingType: z.literal("CONVICTION_WEIGHT_VECTOR"),
    maxRebalances: z.number().int().min(1).max(12),
    allowedAssets: z.array(z.string().min(1)).min(1).max(8),
    nettingPolicy: z.enum([
      "NET_ON_ENTRY_AND_SETTLEMENT",
      "NET_AT_CHECKPOINTS_30S",
    ]),
  }),
  z.object({
    gameEvent: z.string().min(2).max(64),
    bindingType: z.literal("CONTINUOUS_STANCE_VECTOR"),
    mapping: z.record(z.string(), StanceWeightLegSchema),
    nettingPolicy: z.enum([
      "NET_AT_CHECKPOINTS_30S",
      "NET_ON_ENTRY_AND_SETTLEMENT",
    ]),
  }),
  z.object({
    gameEvent: z.string().min(2).max(64),
    bindingType: z.literal("BINARY_OUTCOME_CALL"),
    asset: z.string().min(1).max(32),
    /** Integer basis points multiplier >= 10000 and <= 20000 (e.g. 13500 = 1.35x). */
    scoreCarryMultiplierBps: z.number().int().min(10_000).max(20_000),
  }),
  z.object({
    gameEvent: z.string().min(2).max(64),
    bindingType: z.literal("SECTOR_TURF_CAPTURE"),
    districtAssets: z.array(z.string().min(1)).min(1).max(8),
    heistDurationSecs: z.number().int().min(60).max(900),
    nettingPolicy: z.literal("NET_ON_ENTRY_AND_SETTLEMENT"),
  }),
]);
export type ActionBinding = z.infer<typeof ActionBindingSchema>;

export const MarketUniverseEntrySchema = z.object({
  alias: z.string().min(2).max(32),
  venue: MarketVenueEnum,
  symbol: z.string().min(2).max(32),
  mint: z.string().min(32).max(48).optional(),
  pythFeedId: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  marketId: z.string().min(3).max(64).optional(),
});
export type MarketUniverseEntry = z.infer<typeof MarketUniverseEntrySchema>;

export const ClaimAssetEnum = z.enum(["NVDAx", "ANTx", "SPYx", "TSLAx", "USDC"]);
export type ClaimAssetSymbol = z.infer<typeof ClaimAssetEnum>;

export const CartridgeManifestV2Schema = z.object({
  $schema: z
    .string()
    .default("https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json"),
  manifestVersion: z.literal("2.0.0"),
  metadata: z.object({
    slug: z
      .string()
      .min(3)
      .max(48)
      .regex(/^[a-z0-9-]+$/),
    title: z.string().min(3).max(80),
    subtitle: z.string().min(4).max(160),
    genre: CartridgeGenreEnum,
    engineTarget: EngineTargetEnum,
    creatorHandle: z.string().min(2).max(32),
    creatorWallet: z.string().min(32).max(48),
    creatorFeeShareBps: z
      .number()
      .int()
      .min(0)
      .max(ENGINE_GUARDRAILS.maxCreatorShareBps),
  }),
  onboardingAndSession: z.object({
    allowPaperMode: z.boolean(),
    allowLiveMode: z.boolean(),
    supportedDepositChains: z
      .array(z.enum(SUPPORTED_DEPOSIT_CHAINS))
      .min(1),
    applePayEnabled: z.boolean(),
    liveSessionEnvelopeUsdc: z.object({
      minUsdc: z.number().int().min(1).max(500),
      maxUsdc: z.number().int().min(5).max(500),
      maxLeverage: z
        .number()
        .int()
        .min(1)
        .max(ENGINE_GUARDRAILS.maxLiveLeverage),
    }),
  }),
  magicblockRoomConfig: z.object({
    tickIntervalMs: z.number().int().min(10).max(250),
    durationSecs: z.number().int().min(30).max(86_400),
    shardCapacity: z
      .number()
      .int()
      .min(2)
      .max(ENGINE_GUARDRAILS.maxPlayersPerShard),
    privacyMode: PrivacyModeEnum,
    fogOfWarBps: z.number().int().min(0).max(9_000),
    showdownUnsealSecs: z.number().int().min(5).max(120),
    vrfUsage: VrfUsageEnum,
  }),
  marketUniverse: z.array(MarketUniverseEntrySchema).min(1).max(8),
  actionBindings: z.array(ActionBindingSchema).min(1).max(6),
  scoringAndPrizes: z.object({
    primaryFormula: ScoringFormulaEnum,
    prizeCurve: PrizeCurveEnum,
    claimMenuAssets: z.array(ClaimAssetEnum).min(1).max(5),
  }),
});

export type CartridgeManifestV2 = z.infer<typeof CartridgeManifestV2Schema>;

export interface ComplianceCheckResult {
  valid: boolean;
  violations: string[];
}

const BANNED_GAMBLING_PATTERNS = [
  /loot\s*box/i,
  /paid\s*spin/i,
  /roulette/i,
  /slot\s*machine/i,
  /casino\s*jackpot/i,
  /double\s*or\s*nothing\s*spin/i,
  /trade\s*streak\s*nudge/i,
];

/**
 * Enforces programmatic FCA / SEC DEP / Anti-Casino compliance on any CartridgeManifest v2.0 + source prompt.
 */
export function validateManifestCompliance(
  manifest: CartridgeManifestV2,
  sourcePrompt: string = "",
): ComplianceCheckResult {
  const violations: string[] = [];
  const parsed = CartridgeManifestV2Schema.safeParse(manifest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, violations };
  }

  const combinedText = `${manifest.metadata.title} ${manifest.metadata.subtitle} ${sourcePrompt}`;
  for (const pattern of BANNED_GAMBLING_PATTERNS) {
    if (pattern.test(combinedText)) {
      violations.push(
        `Compliance hard-block: prohibited casino/dark-pattern mechanic matched (${pattern.source}). CartridgeFi enforces 100% skill-first financial physics.`,
      );
    }
  }

  if (
    manifest.onboardingAndSession.liveSessionEnvelopeUsdc.minUsdc >
    manifest.onboardingAndSession.liveSessionEnvelopeUsdc.maxUsdc
  ) {
    violations.push("liveSessionEnvelopeUsdc.minUsdc cannot exceed maxUsdc.");
  }

  if (
    manifest.onboardingAndSession.liveSessionEnvelopeUsdc.maxLeverage >
    ENGINE_GUARDRAILS.maxLiveLeverage
  ) {
    violations.push(
      `Leverage ceiling exceeded: maxLeverage must be <= ${ENGINE_GUARDRAILS.maxLiveLeverage}x.`,
    );
  }

  if (
    manifest.magicblockRoomConfig.showdownUnsealSecs >=
    manifest.magicblockRoomConfig.durationSecs
  ) {
    violations.push(
      "magicblockRoomConfig.showdownUnsealSecs must be strictly less than durationSecs.",
    );
  }

  if (!manifest.scoringAndPrizes.claimMenuAssets.includes("USDC")) {
    violations.push(
      "scoringAndPrizes.claimMenuAssets must always include 'USDC' as universal geo-safe fallback.",
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function exportCartridgeManifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(CartridgeManifestV2Schema) as Record<string, unknown>;
}

/**
 * First-Party Studio Cartridge #001: BOREL (Flagship Game-Day & Blind Conviction Blitz Arena)
 */
export const BOREL_GAMEDAY_MANIFEST: CartridgeManifestV2 = {
  $schema: "https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json",
  manifestVersion: "2.0.0",
  metadata: {
    slug: "borel-macro-blitz-001",
    title: "Borel: Game-Day Conviction Arena",
    subtitle:
      "60s & Game-Day multiplayer arena uniting Kalshi predictions, Solana perps, and xStocks inside Private ER TEE Fog-of-War.",
    genre: "BOREL_GAMEDAY",
    engineTarget: "NEXT_REACT",
    creatorHandle: "@cartridgefi-studio",
    creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
    creatorFeeShareBps: 5000,
  },
  onboardingAndSession: {
    allowPaperMode: true,
    allowLiveMode: true,
    supportedDepositChains: [...SUPPORTED_DEPOSIT_CHAINS],
    applePayEnabled: true,
    liveSessionEnvelopeUsdc: {
      minUsdc: 10,
      maxUsdc: 250,
      maxLeverage: 5,
    },
  },
  magicblockRoomConfig: {
    tickIntervalMs: 10,
    durationSecs: 60,
    shardCapacity: 200,
    privacyMode: "PRIVATE_TEE_FOG_OF_WAR",
    fogOfWarBps: 7500,
    showdownUnsealSecs: 15,
    vrfUsage: "TIEBREAK_AND_FREE_BONUS_DROP",
  },
  marketUniverse: [
    {
      alias: "SOL_PERP",
      venue: "PHOENIX_PERP",
      symbol: "SOL-PERP",
      pythFeedId: PYTH_FEED_IDS["SOL/USD"],
    },
    {
      alias: "NVDA_XSTOCK",
      venue: "JUPITER_XSTOCKS",
      symbol: "NVDAx",
      mint: SOLANA_CANONICAL_MINTS.NVDAx,
      pythFeedId: PYTH_FEED_IDS["NVDAx/USD"],
    },
    {
      alias: "SPY_XSTOCK",
      venue: "JUPITER_XSTOCKS",
      symbol: "SPYx",
      mint: SOLANA_CANONICAL_MINTS.SPYx,
      pythFeedId: PYTH_FEED_IDS["SPYx/USD"],
    },
    {
      alias: "FED_CUT_GATE",
      venue: "DFLOW_KALSHI",
      symbol: "KALSHI-FED-CUT",
      marketId: KALSHI_DFLOW_MARKETS["KALSHI-FED-DEC26-CUT"].marketId,
    },
  ],
  actionBindings: [
    {
      gameEvent: "SUBMIT_CONVICTION_WEIGHTS",
      bindingType: "CONVICTION_WEIGHT_VECTOR",
      maxRebalances: 3,
      allowedAssets: ["SOL_PERP", "NVDA_XSTOCK", "SPY_XSTOCK"],
      nettingPolicy: "NET_ON_ENTRY_AND_SETTLEMENT",
    },
    {
      gameEvent: "CALL_KALSHI_CATALYST",
      bindingType: "BINARY_OUTCOME_CALL",
      asset: "FED_CUT_GATE",
      scoreCarryMultiplierBps: 13_500,
    },
  ],
  scoringAndPrizes: {
    primaryFormula: "DIRECTION_NEUTRAL_REL_RETURN",
    prizeCurve: "TOP_20_PERCENT_SHAPLEY",
    claimMenuAssets: ["NVDAx", "ANTx", "SPYx", "USDC"],
  },
};

/**
 * First-Party Genre Proof #002: PULSE RUNNER (3-Lane Volatility Reflex Runner)
 */
export const PULSE_RUNNER_MANIFEST: CartridgeManifestV2 = {
  $schema: "https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json",
  manifestVersion: "2.0.0",
  metadata: {
    slug: "pulse-runner-nvda-sol",
    title: "Pulse Runner: 3-Lane Volatility Sprint",
    subtitle:
      "60fps 3-lane arcade reflex runner where Left=Short, Center=USDC Shield, Right=Long on the exact same CartridgeFi ER contract.",
    genre: "ARCADE_RUNNER",
    engineTarget: "PHASER_3",
    creatorHandle: "@cartridgefi-studio",
    creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
    creatorFeeShareBps: 5000,
  },
  onboardingAndSession: {
    allowPaperMode: true,
    allowLiveMode: true,
    supportedDepositChains: [...SUPPORTED_DEPOSIT_CHAINS],
    applePayEnabled: true,
    liveSessionEnvelopeUsdc: {
      minUsdc: 10,
      maxUsdc: 150,
      maxLeverage: 3,
    },
  },
  magicblockRoomConfig: {
    tickIntervalMs: 10,
    durationSecs: 90,
    shardCapacity: 200,
    privacyMode: "PRIVATE_TEE_FOG_OF_WAR",
    fogOfWarBps: 7500,
    showdownUnsealSecs: 15,
    vrfUsage: "PROCEDURAL_TRACK_SEED_AND_TIEBREAK",
  },
  marketUniverse: [
    {
      alias: "PRIMARY_PERP",
      venue: "PHOENIX_PERP",
      symbol: "SOL-PERP",
      pythFeedId: PYTH_FEED_IDS["SOL/USD"],
    },
    {
      alias: "TECH_EQUITY",
      venue: "JUPITER_XSTOCKS",
      symbol: "NVDAx",
      mint: SOLANA_CANONICAL_MINTS.NVDAx,
      pythFeedId: PYTH_FEED_IDS["NVDAx/USD"],
    },
    {
      alias: "MACRO_GATE",
      venue: "DFLOW_KALSHI",
      symbol: "KALSHI-FED-CUT",
      marketId: KALSHI_DFLOW_MARKETS["KALSHI-FED-DEC26-CUT"].marketId,
    },
  ],
  actionBindings: [
    {
      gameEvent: "PLAYER_LANE_SWITCH",
      bindingType: "CONTINUOUS_STANCE_VECTOR",
      mapping: {
        LANE_LEFT: { asset: "PRIMARY_PERP", weightBps: -10_000 },
        LANE_CENTER: { asset: "USDC_SHIELD", weightBps: 0 },
        LANE_RIGHT: { asset: "PRIMARY_PERP", weightBps: 10_000 },
      },
      nettingPolicy: "NET_AT_CHECKPOINTS_30S",
    },
    {
      gameEvent: "PORTAL_GATE_PASS",
      bindingType: "BINARY_OUTCOME_CALL",
      asset: "MACRO_GATE",
      scoreCarryMultiplierBps: 15_000,
    },
  ],
  scoringAndPrizes: {
    primaryFormula: "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL",
    prizeCurve: "TOP_20_PERCENT_SHAPLEY",
    claimMenuAssets: ["NVDAx", "SPYx", "USDC"],
  },
};

export const VICE_BOURSE_MANIFEST: CartridgeManifestV2 = {
  $schema: "https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json",
  manifestVersion: "2.0.0",
  metadata: {
    slug: "vice-bourse-syndicate",
    title: "Vice Bourse: Sector Turf Wars",
    subtitle:
      "District control & 10-minute Private TEE Vault Heists backed by tokenized tech & index equities.",
    genre: "SYNDICATE_TURF",
    engineTarget: "THREE_JS",
    creatorHandle: "@vice-labs",
    creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
    creatorFeeShareBps: 5000,
  },
  onboardingAndSession: {
    allowPaperMode: true,
    allowLiveMode: true,
    supportedDepositChains: [...SUPPORTED_DEPOSIT_CHAINS],
    applePayEnabled: true,
    liveSessionEnvelopeUsdc: {
      minUsdc: 15,
      maxUsdc: 250,
      maxLeverage: 3,
    },
  },
  magicblockRoomConfig: {
    tickIntervalMs: 25,
    durationSecs: 600,
    shardCapacity: 200,
    privacyMode: "PRIVATE_TEE_FOG_OF_WAR",
    fogOfWarBps: 8000,
    showdownUnsealSecs: 30,
    vrfUsage: "TIEBREAK_AND_FREE_BONUS_DROP",
  },
  marketUniverse: [
    {
      alias: "SILICON_COAST",
      venue: "JUPITER_XSTOCKS",
      symbol: "NVDAx",
      mint: SOLANA_CANONICAL_MINTS.NVDAx,
      pythFeedId: PYTH_FEED_IDS["NVDAx/USD"],
    },
    {
      alias: "ANTHROPIC_TOWER",
      venue: "JUPITER_XSTOCKS",
      symbol: "ANTx",
      mint: SOLANA_CANONICAL_MINTS.ANTx,
    },
    {
      alias: "FED_PLAZA",
      venue: "DFLOW_KALSHI",
      symbol: "KALSHI-FED-CUT",
      marketId: KALSHI_DFLOW_MARKETS["KALSHI-FED-DEC26-CUT"].marketId,
    },
  ],
  actionBindings: [
    {
      gameEvent: "CLAIM_DISTRICT_TURF",
      bindingType: "SECTOR_TURF_CAPTURE",
      districtAssets: ["SILICON_COAST", "ANTHROPIC_TOWER"],
      heistDurationSecs: 600,
      nettingPolicy: "NET_ON_ENTRY_AND_SETTLEMENT",
    },
  ],
  scoringAndPrizes: {
    primaryFormula: "MULTI_STAGE_CARRY_COMPOSITE",
    prizeCurve: "TOP_20_PERCENT_SHAPLEY",
    claimMenuAssets: ["NVDAx", "ANTx", "USDC"],
  },
};

export const CHAMPIONS_CLASH_MANIFEST: CartridgeManifestV2 = {
  $schema: "https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json",
  manifestVersion: "2.0.0",
  metadata: {
    slug: "champions-prop-clash",
    title: "Champions Matchday Prop Clash",
    subtitle:
      "Live matchday prediction brackets calibrated via Brier forecasting skill and Kalshi outcome liquidity.",
    genre: "PREDICTION_BRACKET",
    engineTarget: "NEXT_REACT",
    creatorHandle: "@EuroAlpha",
    creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot2,
    creatorFeeShareBps: 5000,
  },
  onboardingAndSession: {
    allowPaperMode: true,
    allowLiveMode: true,
    supportedDepositChains: [...SUPPORTED_DEPOSIT_CHAINS],
    applePayEnabled: true,
    liveSessionEnvelopeUsdc: {
      minUsdc: 10,
      maxUsdc: 200,
      maxLeverage: 2,
    },
  },
  magicblockRoomConfig: {
    tickIntervalMs: 20,
    durationSecs: 180,
    shardCapacity: 200,
    privacyMode: "PRIVATE_TEE_FOG_OF_WAR",
    fogOfWarBps: 7500,
    showdownUnsealSecs: 20,
    vrfUsage: "TIEBREAK_AND_FREE_BONUS_DROP",
  },
  marketUniverse: [
    {
      alias: "NVDA_EARNINGS",
      venue: "DFLOW_KALSHI",
      symbol: "KALSHI-NVDA-BEAT",
      marketId: KALSHI_DFLOW_MARKETS["KALSHI-NVDA-BEAT-Q4"].marketId,
    },
    {
      alias: "SOL_ATH_GATE",
      venue: "DFLOW_KALSHI",
      symbol: "KALSHI-SOL-ATH",
      marketId: KALSHI_DFLOW_MARKETS["KALSHI-SOL-ATH-2026"].marketId,
    },
  ],
  actionBindings: [
    {
      gameEvent: "SUBMIT_BRACKET_FORECAST",
      bindingType: "BINARY_OUTCOME_CALL",
      asset: "NVDA_EARNINGS",
      scoreCarryMultiplierBps: 12_500,
    },
  ],
  scoringAndPrizes: {
    primaryFormula: "KALSHI_BRIER_CALIBRATION",
    prizeCurve: "TOP_20_PERCENT_SHAPLEY",
    claimMenuAssets: ["SPYx", "NVDAx", "USDC"],
  },
};

export const FIRST_PARTY_CARTRIDGE_CATALOG: readonly CartridgeManifestV2[] = [
  BOREL_GAMEDAY_MANIFEST,
  PULSE_RUNNER_MANIFEST,
  VICE_BOURSE_MANIFEST,
  CHAMPIONS_CLASH_MANIFEST,
];

/**
 * Deterministic natural-language Prompt-to-CartridgeManifest v2.0 compiler used across
 * Web Vibe Studio, `@cartridgefi/mcp`, `cartridgefi` CLI, and `core-api`.
 */
export function compilePromptToManifest(params: {
  prompt: string;
  genre: CartridgeGenre;
  creatorWallet: string;
  creatorHandle?: string;
}): { manifest: CartridgeManifestV2; compliance: ComplianceCheckResult } {
  const cleanPrompt = params.prompt.trim();
  const lower = cleanPrompt.toLowerCase();

  const slugBase = cleanPrompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34);
  const slug = `${slugBase || "custom-cartridge"}-${params.genre.toLowerCase().slice(0, 6)}`;

  const mentionsTsla = lower.includes("tsla");
  const mentionsBtc = lower.includes("btc") || lower.includes("bitcoin");
  const mentionsAnt = lower.includes("ant") || lower.includes("anthropic");
  const durationSecs = lower.includes("180s") || lower.includes("3m")
    ? 180
    : lower.includes("5m") || lower.includes("300s")
      ? 300
      : params.genre === "ARCADE_RUNNER"
        ? 90
        : 60;

  const marketUniverse: MarketUniverseEntry[] = [
    {
      alias: mentionsBtc ? "PRIMARY_PERP" : "PRIMARY_PERP",
      venue: "PHOENIX_PERP",
      symbol: mentionsBtc ? "BTC-PERP" : "SOL-PERP",
      pythFeedId: mentionsBtc ? PYTH_FEED_IDS["BTC/USD"] : PYTH_FEED_IDS["SOL/USD"],
    },
    {
      alias: "EQUITY_ANCHOR",
      venue: "JUPITER_XSTOCKS",
      symbol: mentionsTsla ? "TSLAx" : mentionsAnt ? "ANTx" : "NVDAx",
      mint: mentionsTsla
        ? SOLANA_CANONICAL_MINTS.TSLAx
        : mentionsAnt
          ? SOLANA_CANONICAL_MINTS.ANTx
          : SOLANA_CANONICAL_MINTS.NVDAx,
      pythFeedId: PYTH_FEED_IDS["NVDAx/USD"],
    },
    {
      alias: "MACRO_CATALYST",
      venue: "DFLOW_KALSHI",
      symbol: "KALSHI-FED-CUT",
      marketId: KALSHI_DFLOW_MARKETS["KALSHI-FED-DEC26-CUT"].marketId,
    },
  ];

  const claimMenuAssets: ClaimAssetSymbol[] = mentionsTsla
    ? ["TSLAx", "NVDAx", "USDC"]
    : mentionsAnt
      ? ["ANTx", "NVDAx", "USDC"]
      : ["NVDAx", "SPYx", "USDC"];

  const actionBindings: ActionBinding[] =
    params.genre === "ARCADE_RUNNER"
      ? [
          {
            gameEvent: "PLAYER_LANE_SWITCH",
            bindingType: "CONTINUOUS_STANCE_VECTOR",
            mapping: {
              LANE_LEFT: { asset: "PRIMARY_PERP", weightBps: -10_000 },
              LANE_CENTER: { asset: "USDC_SHIELD", weightBps: 0 },
              LANE_RIGHT: { asset: "PRIMARY_PERP", weightBps: 10_000 },
            },
            nettingPolicy: "NET_AT_CHECKPOINTS_30S",
          },
          {
            gameEvent: "PORTAL_GATE_PASS",
            bindingType: "BINARY_OUTCOME_CALL",
            asset: "MACRO_CATALYST",
            scoreCarryMultiplierBps: 15_000,
          },
        ]
      : params.genre === "SYNDICATE_TURF"
        ? [
            {
              gameEvent: "CLAIM_DISTRICT_TURF",
              bindingType: "SECTOR_TURF_CAPTURE",
              districtAssets: ["PRIMARY_PERP", "EQUITY_ANCHOR"],
              heistDurationSecs: Math.max(60, durationSecs),
              nettingPolicy: "NET_ON_ENTRY_AND_SETTLEMENT",
            },
          ]
        : params.genre === "PREDICTION_BRACKET"
          ? [
              {
                gameEvent: "SUBMIT_BRACKET_FORECAST",
                bindingType: "BINARY_OUTCOME_CALL",
                asset: "MACRO_CATALYST",
                scoreCarryMultiplierBps: 13_500,
              },
            ]
          : [
              {
                gameEvent: "SUBMIT_CONVICTION_WEIGHTS",
                bindingType: "CONVICTION_WEIGHT_VECTOR",
                maxRebalances: 3,
                allowedAssets: ["PRIMARY_PERP", "EQUITY_ANCHOR"],
                nettingPolicy: "NET_ON_ENTRY_AND_SETTLEMENT",
              },
              {
                gameEvent: "CALL_KALSHI_CATALYST",
                bindingType: "BINARY_OUTCOME_CALL",
                asset: "MACRO_CATALYST",
                scoreCarryMultiplierBps: 13_500,
              },
            ];

  const primaryFormula: ScoringFormulaName =
    params.genre === "ARCADE_RUNNER"
      ? "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL"
      : params.genre === "PREDICTION_BRACKET"
        ? "KALSHI_BRIER_CALIBRATION"
        : params.genre === "SYNDICATE_TURF"
          ? "MULTI_STAGE_CARRY_COMPOSITE"
          : "DIRECTION_NEUTRAL_REL_RETURN";

  const engineTarget: EngineTarget =
    params.genre === "ARCADE_RUNNER"
      ? "PHASER_3"
      : params.genre === "SYNDICATE_TURF"
        ? "THREE_JS"
        : "NEXT_REACT";

  const titleWords = cleanPrompt.split(/\s+/).slice(0, 7).join(" ");
  const title =
    titleWords.length >= 4
      ? titleWords.slice(0, 76)
      : `Custom ${params.genre} Cartridge`;

  const manifest: CartridgeManifestV2 = {
    $schema: "https://spec.cartridgefi.com/v2/cartridge-manifest.schema.json",
    manifestVersion: "2.0.0",
    metadata: {
      slug,
      title,
      subtitle: cleanPrompt.slice(0, 155) || "Vibe-compiled CartridgeFi arena.",
      genre: params.genre,
      engineTarget,
      creatorHandle: params.creatorHandle ?? "@vibe-creator",
      creatorWallet: params.creatorWallet,
      creatorFeeShareBps: 5000,
    },
    onboardingAndSession: {
      allowPaperMode: true,
      allowLiveMode: true,
      supportedDepositChains: [...SUPPORTED_DEPOSIT_CHAINS],
      applePayEnabled: true,
      liveSessionEnvelopeUsdc: {
        minUsdc: 10,
        maxUsdc: 200,
        maxLeverage: 3,
      },
    },
    magicblockRoomConfig: {
      tickIntervalMs: 10,
      durationSecs,
      shardCapacity: 200,
      privacyMode: "PRIVATE_TEE_FOG_OF_WAR",
      fogOfWarBps: 7500,
      showdownUnsealSecs: Math.min(15, Math.floor(durationSecs / 4)),
      vrfUsage:
        params.genre === "ARCADE_RUNNER"
          ? "PROCEDURAL_TRACK_SEED_AND_TIEBREAK"
          : "TIEBREAK_AND_FREE_BONUS_DROP",
    },
    marketUniverse,
    actionBindings,
    scoringAndPrizes: {
      primaryFormula,
      prizeCurve: "TOP_20_PERCENT_SHAPLEY",
      claimMenuAssets,
    },
  };

  const compliance = validateManifestCompliance(manifest, cleanPrompt);
  return { manifest, compliance };
}
