import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  CARTRIDGE_PROGRAM_IDS,
  CartridgeGenreEnum,
  CartridgeManifestV2Schema,
  FIRST_PARTY_CARTRIDGE_CATALOG,
  SOLANA_CANONICAL_MINTS,
  bytesToHex,
  compilePromptToManifest,
  deriveCartridgeDeploymentPlan,
  exportCartridgeManifestJsonSchema,
  sha256Sync,
  simulateCartridgeEconomy,
  utf8ToBytes,
  validateManifestCompliance,
  type CartridgeManifestV2,
} from "@cartridgefi/sdk";
import {
  generateFrameworkBindingCode,
  type SupportedBindingFramework,
} from "./bindings.js";
import {
  detectExcessivePromptLeverage,
  discoverLiveMarkets,
  inspectCreatorVaultSummary,
  type UnifiedDiscoveredMarket,
} from "./upstream.js";

const CHARACTER_LIMIT = 25_000;

function resolveApiBaseUrl(): string {
  return (process.env.CARTRIDGEFI_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const MarketItemSchema = z.object({
  category: z.enum(["xstocks", "perps", "kalshi"]),
  symbol: z.string(),
  title: z.string(),
  venue: z.string(),
  mintOrMarketId: z.string(),
  pythFeedId: z.string().nullable(),
  price8: z.string(),
  priceFormatted: z.string(),
  confidenceBps: z.number().int(),
  liquidity24hUsdcAtomic: z.string(),
  liquidity24hUsdcFormatted: z.string(),
  builderFeeBps: z.number().int(),
  oracleSource: z.string(),
});

const DiscoverMarketsPageSchema = z.object({
  oracleMode: z.string(),
  canonicalSettlementMint: z.string(),
  total: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().optional(),
  markets: z.array(MarketItemSchema),
});

function formatMarketMarkdown(m: UnifiedDiscoveredMarket): string {
  const feedPart = m.pythFeedId ? ` · Pyth \`${m.pythFeedId}\`` : "";
  return `- **${m.symbol}** (${m.venue}) — $${m.priceFormatted} · 24h Liq $${m.liquidity24hUsdcFormatted} · Mint/ID \`${m.mintOrMarketId}\`${feedPart} · Builder Fee ${m.builderFeeBps} bps`;
}

/**
 * Per-request MCP v2 Server Factory (`@modelcontextprotocol/server` + `zod/v4`).
 * Returns a fresh `McpServer` instance on every invocation so both `serveStdio` and
 * stateless Streamable HTTP (`createMcpHandler`) operate concurrently without shared session state.
 */
export function createCartridgeMcpServer(): McpServer {
  const server = new McpServer({
    name: "cartridgefi-mcp-server",
    version: "2.0.0",
  });

  const apiBaseUrl = resolveApiBaseUrl();

  // ---- Resource 1: First-Party Cartridge Catalog ----
  server.registerResource(
    "cartridgefi-first-party-catalog",
    "cartridgefi://catalog/first-party",
    {
      title: "CartridgeFi First-Party Cartridge Catalog",
      description:
        "Verified CartridgeManifest v2.0 specs for Borel (#001), Pulse Runner (#002), Vice Bourse, and Champions Clash.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(FIRST_PARTY_CARTRIDGE_CATALOG, null, 2),
        },
      ],
    }),
  );

  // ---- Resource 2: CartridgeManifest v2.0 JSON Schema ----
  server.registerResource(
    "cartridgefi-manifest-v2-schema",
    "cartridgefi://schema/manifest-v2",
    {
      title: "CartridgeManifest v2.0 JSON Schema",
      description: "Canonical JSON Schema for validating multi-genre CartridgeFi manifests.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(exportCartridgeManifestJsonSchema(), null, 2),
        },
      ],
    }),
  );

  // ---- Tool 1: discover_live_markets ----
  server.registerTool(
    "discover_live_markets",
    {
      title: "Discover Live Markets",
      description: `Discover verified Solana xStocks mints (NVDAx, SPYx, ANTx, TSLAx), Phoenix/Jupiter perps (SOL-PERP, BTC-PERP), and DFlow/Kalshi prediction contracts (KALSHI-FED-DEC26-CUT, etc.) with live Pyth Hermes v2 prices, 24h USDC liquidity, and builder-fee bps.

Use this tool FIRST before building or modifying a CartridgeManifest v2.0 so you never hallucinate unverified mints or Pyth feed IDs.

Examples:
  - List all tokenized stocks: category="xstocks"
  - Search NVDA markets: category="all", query="nvda"`,
      inputSchema: z.strictObject({
        category: z
          .enum(["all", "xstocks", "perps", "kalshi"])
          .default("all")
          .describe("Market category filter: 'all', 'xstocks', 'perps', or 'kalshi'"),
        query: z
          .string()
          .max(64)
          .optional()
          .describe("Optional case-insensitive search filter on symbol, title, or mint"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Maximum number of markets to return per page"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Zero-based pagination offset"),
        responseFormat: z
          .enum(["json", "markdown"])
          .default("json")
          .describe("'json' for structured JSON + structuredContent, or 'markdown' for concise human/LLM summary"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ category, query, limit, offset, responseFormat }, ctx) => {
      const discovered = await discoverLiveMarkets(
        { category, query, apiBaseUrl },
        ctx.mcpReq.signal,
      );

      let slice = discovered.markets.slice(offset, offset + limit);

      const render = (items: UnifiedDiscoveredMarket[]) => {
        const nextOffset = offset + items.length;
        const hasMore = discovered.markets.length > nextOffset;
        const page = DiscoverMarketsPageSchema.parse({
          oracleMode: discovered.oracleMode,
          canonicalSettlementMint: SOLANA_CANONICAL_MINTS.USDC,
          total: discovered.markets.length,
          count: items.length,
          offset,
          hasMore,
          ...(hasMore ? { nextOffset } : {}),
          markets: items,
        });

        if (responseFormat === "json") {
          return { page, text: JSON.stringify(page, null, 2) };
        }
        const mdLines = [
          `# CartridgeFi Verified Markets (${page.oracleMode})`,
          `Showing ${page.count} of ${page.total} markets · Canonical Settlement: \`${page.canonicalSettlementMint}\``,
          "",
          ...items.map(formatMarketMarkdown),
        ];
        if (hasMore) {
          mdLines.push("", `More results available: call again with offset=${nextOffset}.`);
        }
        return { page, text: mdLines.join("\n") };
      };

      let rendered = render(slice);
      while (slice.length > 1 && rendered.text.length > CHARACTER_LIMIT) {
        slice = slice.slice(0, Math.ceil(slice.length / 2));
        rendered = render(slice);
      }

      return {
        content: [{ type: "text", text: rendered.text }],
        structuredContent: rendered.page,
      };
    },
  );

  // ---- Tool 2: compile_cartridge_manifest ----
  server.registerTool(
    "compile_cartridge_manifest",
    {
      title: "Compile Cartridge Manifest v2.0",
      description: `Compile a natural-language game concept + genre ('BOREL_GAMEDAY', 'ARCADE_RUNNER', 'SYNDICATE_TURF', 'PREDICTION_BRACKET') + creatorWallet into a schema-validated CartridgeManifest v2.0 JSON.
Automatically enforces FCA/SEC/Anti-Casino compliance rules (hard-blocking paid loot boxes, roulette, slot machines, >5x leverage, and >5000 bps creator fee shares).

Examples:
  - genre="ARCADE_RUNNER", prompt="Cyberpunk 3-lane TSLAx & BTC sprint", creatorWallet="D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1"`,
      inputSchema: z.strictObject({
        prompt: z
          .string()
          .min(4)
          .max(600)
          .describe("Natural-language description of the game world, market twist, and duration"),
        genre: CartridgeGenreEnum.describe(
          "Base engine chassis: 'BOREL_GAMEDAY', 'ARCADE_RUNNER', 'SYNDICATE_TURF', or 'PREDICTION_BRACKET'",
        ),
        creatorWallet: z
          .string()
          .min(32)
          .max(48)
          .describe("Creator's base58 Solana wallet receiving 50% of net builder fees"),
        creatorHandle: z
          .string()
          .min(2)
          .max(32)
          .optional()
          .describe("Optional creator handle such as '@studio-alpha'"),
        maxLeverageOverride: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Optional leverage override (values > 5x are rejected by the compliance gate)"),
        creatorFeeShareBpsOverride: z
          .number()
          .int()
          .min(0)
          .max(10_000)
          .optional()
          .describe("Optional creator fee share in bps (values > 5000 bps are rejected)"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      prompt,
      genre,
      creatorWallet,
      creatorHandle,
      maxLeverageOverride,
      creatorFeeShareBpsOverride,
    }) => {
      const compiled = compilePromptToManifest({
        prompt,
        genre,
        creatorWallet,
        creatorHandle,
      });

      const candidateManifest: CartridgeManifestV2 = {
        ...compiled.manifest,
        metadata: {
          ...compiled.manifest.metadata,
          ...(creatorFeeShareBpsOverride !== undefined
            ? { creatorFeeShareBps: creatorFeeShareBpsOverride }
            : {}),
        },
        onboardingAndSession: {
          ...compiled.manifest.onboardingAndSession,
          liveSessionEnvelopeUsdc: {
            ...compiled.manifest.onboardingAndSession.liveSessionEnvelopeUsdc,
            ...(maxLeverageOverride !== undefined ? { maxLeverage: maxLeverageOverride } : {}),
          },
        },
      };

      const compliance = validateManifestCompliance(candidateManifest, prompt);
      const excessivePromptLev = detectExcessivePromptLeverage(prompt);
      const violations = [...compliance.violations];
      if (excessivePromptLev !== null) {
        violations.push(
          `Prompt requests ${excessivePromptLev}x leverage, exceeding CartridgeFi's hard 5x safety ceiling.`,
        );
      }

      if (violations.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `CartridgeManifest v2.0 Compliance Gate Rejected Input:\n${violations.map((v) => `- ${v}`).join("\n")}\n\nRecovery: Remove gambling/casino mechanics (loot boxes, roulette, paid spins), keep maxLeverage <= 5, and keep creatorFeeShareBps <= 5000.`,
            },
          ],
        };
      }

      const slugHashHex = bytesToHex(sha256Sync(utf8ToBytes(candidateManifest.metadata.slug)));
      const payload = {
        valid: true,
        slugHashHex,
        targetProgramIds: CARTRIDGE_PROGRAM_IDS,
        manifest: candidateManifest,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  // ---- Tool 3: simulate_cartridge_wasm ----
  server.registerTool(
    "simulate_cartridge_wasm",
    {
      title: "Simulate Cartridge Economy (500 Ticks)",
      description: `Run 500 synthetic market ticks ('calm' vs 'crash_vix35') through CartridgeFi's deterministic bigint fixed-point scoring & Shapley payout engine.
Verifies payout conservation (totalDistributedUsdcAtomic <= roomPoolUsdcAtomic), computes P90/Median/P10 skill scores, and projects monthly creator fee revenue.`,
      inputSchema: z.strictObject({
        manifest: z
          .record(z.string(), z.unknown())
          .describe("Schema-valid CartridgeManifest v2.0 JSON object"),
        volatilityRegime: z
          .enum(["calm", "crash_vix35"])
          .default("calm")
          .describe("'calm' for normal 18bps market regime, or 'crash_vix35' for tail-risk stress test"),
        tickCount: z
          .number()
          .int()
          .min(20)
          .max(5_000)
          .default(500)
          .describe("Number of market ticks to simulate (default 500)"),
        simulatedPlayers: z
          .number()
          .int()
          .min(2)
          .max(200)
          .default(24)
          .describe("Number of simulated players in the RoomShard (2..200)"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ manifest, volatilityRegime, tickCount, simulatedPlayers }) => {
      const parsed = CartridgeManifestV2Schema.safeParse(manifest);
      if (!parsed.success) {
        const msg = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid CartridgeManifest v2.0 schema: ${msg}. Call compile_cartridge_manifest first to build a valid manifest.`,
            },
          ],
        };
      }

      const compliance = validateManifestCompliance(parsed.data);
      if (!compliance.valid) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Compliance gate failed: ${compliance.violations.join(" | ")}`,
            },
          ],
        };
      }

      const report = simulateCartridgeEconomy(
        parsed.data,
        volatilityRegime,
        tickCount,
        simulatedPlayers,
      );

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        structuredContent: { ...report },
      };
    },
  );

  // ---- Tool 4: deploy_cartridge_onchain ----
  server.registerTool(
    "deploy_cartridge_onchain",
    {
      title: "Deploy Cartridge & RoomShard On-Chain",
      description: `Validate a CartridgeManifest v2.0, derive deterministic CartridgeManifestAccount (5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr) & RoomShard (Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR) PDAs on Solana, build Codama @solana/kit registerCartridge + initializeRoomShard instruction payloads, register the active lobby with core-api when reachable, and return Explorer & playable Studio URLs.`,
      inputSchema: z.strictObject({
        manifest: z
          .record(z.string(), z.unknown())
          .describe("Schema-valid CartridgeManifest v2.0 JSON object to deploy"),
        network: z
          .enum(["devnet", "mainnet-beta"])
          .default("devnet")
          .describe("Target Solana cluster ('devnet' recommended)"),
        shardIndex: z
          .number()
          .int()
          .min(0)
          .max(65_535)
          .default(0)
          .describe("Uint16 shard index (default 0)"),
        roomPoolUsdcAtomic: z
          .string()
          .regex(/^\d+$/)
          .optional()
          .describe("Optional initial room pool in 6-decimal atomic USDC"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ manifest, network, shardIndex, roomPoolUsdcAtomic }, ctx) => {
      const parsed = CartridgeManifestV2Schema.safeParse(manifest);
      if (!parsed.success) {
        const msg = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return {
          isError: true,
          content: [{ type: "text", text: `Manifest validation failed: ${msg}` }],
        };
      }

      const plan = await deriveCartridgeDeploymentPlan(parsed.data, {
        network,
        shardIndex,
        roomPoolUsdcAtomic: roomPoolUsdcAtomic ? BigInt(roomPoolUsdcAtomic) : undefined,
      });

      let registeredOnCoreApi = false;
      let resolvedRoomId = plan.roomId;

      try {
        const res = await fetch(`${apiBaseUrl}/v1/rooms/deploy`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            manifest: parsed.data,
            authority: plan.authorityAddress,
            mode: "PAPER",
            isPrivateFog:
              parsed.data.magicblockRoomConfig.privacyMode === "PRIVATE_TEE_FOG_OF_WAR",
          }),
          signal: AbortSignal.any([ctx.mcpReq.signal, AbortSignal.timeout(1_800)]),
        });
        if (res.ok) {
          const raw: unknown = await res.json();
          if (isRecord(raw) && typeof raw.roomId === "string") {
            resolvedRoomId = raw.roomId;
            registeredOnCoreApi = true;
          }
        }
      } catch {
        registeredOnCoreApi = false;
      }

      const deploymentResult = {
        roomId: resolvedRoomId,
        slug: plan.slug,
        network: plan.network,
        manifestPda: plan.cartridgeManifestPda,
        roomShardPda: plan.roomShardPda,
        engineConfigPda: plan.engineConfigPda,
        roomVaultPda: plan.roomVaultPda,
        creatorFeeVaultPda: plan.creatorFeeVaultPda,
        registryProgramId: plan.registryProgramId,
        erRoomProgramId: plan.erRoomProgramId,
        delegationProgramId: plan.delegationProgramId,
        permissionProgramId: plan.permissionProgramId,
        manifestExplorerUrl: plan.manifestExplorerUrl,
        roomShardExplorerUrl: plan.roomShardExplorerUrl,
        playableStudioUrl: plan.playableStudioUrl,
        registeredOnCoreApi,
        registerCartridgeInstruction: plan.registerCartridgeInstruction,
        initializeRoomShardInstruction: plan.initializeRoomShardInstruction,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(deploymentResult, null, 2) }],
        structuredContent: deploymentResult,
      };
    },
  );

  // ---- Tool 5: generate_framework_binding ----
  server.registerTool(
    "generate_framework_binding",
    {
      title: "Generate Framework Client Binding",
      description: `Generate complete, compilable TypeScript or C# client integration code for 'react' (<CartridgeDeck/>), 'phaser' (60fps 3-lane runner), 'threejs' (3D syndicate turf), or 'unity' pre-wired to a deployed roomId, cartridgeSlug, 7-chain CashModal, and zero-popup MagicBlock ER Session Signer.`,
      inputSchema: z.strictObject({
        roomId: z
          .string()
          .min(3)
          .max(80)
          .describe("Deployed CartridgeFi roomId (e.g. 'borel-macro-blitz-001-r0001')"),
        cartridgeSlug: z
          .string()
          .min(3)
          .max(48)
          .describe("Cartridge slug (e.g. 'borel-macro-blitz-001' or 'pulse-runner-nvda-sol')"),
        framework: z
          .enum(["react", "phaser", "threejs", "unity"])
          .describe("Target game/app framework: 'react', 'phaser', 'threejs', or 'unity'"),
        partnerId: z
          .string()
          .max(48)
          .optional()
          .describe("Optional partner identifier (e.g. 'solflare-mobile' or 'first-party-studio')"),
        partnerFeeVault: z
          .string()
          .min(32)
          .max(48)
          .optional()
          .describe("Optional partner wallet fee vault pubkey enabling 40% Partner / 30% Creator / 30% Engine split"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ roomId, cartridgeSlug, framework, partnerId, partnerFeeVault }) => {
      const binding = generateFrameworkBindingCode({
        roomId,
        cartridgeSlug,
        framework: framework as SupportedBindingFramework,
        partnerId,
        partnerFeeVault,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(binding, null, 2) }],
        structuredContent: { ...binding },
      };
    },
  );

  // ---- Tool 6: inspect_creator_vault ----
  server.registerTool(
    "inspect_creator_vault",
    {
      title: "Inspect Creator Fee Vault",
      description: `Inspect real-time routed USDC volume, active RoomShards, on-chain Solana balance, 50/50 vs 40/30/30 builder fee attribution policies, and claimable canonical USDC for a creatorWallet.`,
      inputSchema: z.strictObject({
        creatorWallet: z
          .string()
          .min(32)
          .max(48)
          .describe("Base58 Solana public key of the cartridge creator"),
        network: z
          .enum(["devnet", "mainnet-beta"])
          .default("devnet")
          .describe("Solana cluster to query ('devnet' or 'mainnet-beta')"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ creatorWallet, network }, ctx) => {
      const summary = await inspectCreatorVaultSummary(
        { creatorWallet, network, apiBaseUrl },
        ctx.mcpReq.signal,
      );

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        structuredContent: { ...summary },
      };
    },
  );

  return server;
}

export const createServer = createCartridgeMcpServer;
