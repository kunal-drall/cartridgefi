import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
} from "@cartridgefi/sdk";
import { startCartridgeMcpHttpServer } from "../src/index.js";

const EXPECTED_TOOLS = [
  "compile_cartridge_manifest",
  "deploy_cartridge_onchain",
  "discover_live_markets",
  "generate_framework_binding",
  "inspect_creator_vault",
  "simulate_cartridge_wasm",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function exerciseAllSixMcpTools(client: Client): Promise<void> {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, EXPECTED_TOOLS);

  // 1. discover_live_markets
  const marketsRes = await client.callTool({
    name: "discover_live_markets",
    arguments: {
      category: "xstocks",
      query: "NVDA",
      limit: 5,
      responseFormat: "json",
    },
  });
  assert.ok(!marketsRes.isError, "discover_live_markets should succeed");
  assert.ok(isRecord(marketsRes.structuredContent));
  assert.ok(Array.isArray(marketsRes.structuredContent.markets));
  assert.ok(marketsRes.structuredContent.markets.length >= 1);

  // 2. compile_cartridge_manifest (valid runner + compliance rejection check)
  const compileRes = await client.callTool({
    name: "compile_cartridge_manifest",
    arguments: {
      prompt: "Cyberpunk Tokyo 3-lane runner surfing TSLAx and BTC volatility waves",
      genre: "ARCADE_RUNNER",
      creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
      creatorHandle: "@tokyo-studio",
    },
  });
  assert.ok(!compileRes.isError, "compile_cartridge_manifest should succeed");
  assert.ok(isRecord(compileRes.structuredContent));
  assert.equal(compileRes.structuredContent.valid, true);
  const compiledManifest = compileRes.structuredContent.manifest;
  assert.ok(isRecord(compiledManifest));

  // Verify compliance hard-block on roulette / >5x leverage
  const bannedRes = await client.callTool({
    name: "compile_cartridge_manifest",
    arguments: {
      prompt: "50x leverage casino roulette paid spin loot box",
      genre: "BOREL_GAMEDAY",
      creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
    },
  });
  assert.equal(bannedRes.isError, true, "Prohibited gambling/50x prompt must return isError=true");

  // 3. simulate_cartridge_wasm
  const simRes = await client.callTool({
    name: "simulate_cartridge_wasm",
    arguments: {
      manifest: compiledManifest,
      volatilityRegime: "crash_vix35",
      tickCount: 500,
      simulatedPlayers: 24,
    },
  });
  assert.ok(!simRes.isError, "simulate_cartridge_wasm should succeed");
  assert.ok(isRecord(simRes.structuredContent));
  assert.equal(simRes.structuredContent.payoutConservationVerified, true);
  assert.equal(simRes.structuredContent.tickCount, 500);

  // 4. deploy_cartridge_onchain
  const deployRes = await client.callTool({
    name: "deploy_cartridge_onchain",
    arguments: {
      manifest: compiledManifest,
      network: "devnet",
      shardIndex: 0,
    },
  });
  assert.ok(!deployRes.isError, "deploy_cartridge_onchain should succeed");
  assert.ok(isRecord(deployRes.structuredContent));
  assert.equal(deployRes.structuredContent.registryProgramId, CARTRIDGE_PROGRAM_IDS.registry);
  assert.equal(deployRes.structuredContent.erRoomProgramId, CARTRIDGE_PROGRAM_IDS.erRoom);
  const roomId = String(deployRes.structuredContent.roomId);
  const slug = String(deployRes.structuredContent.slug);
  assert.ok(roomId.length >= 4);

  // 5. generate_framework_binding (test both phaser TypeScript and unity C#)
  const phaserBindRes = await client.callTool({
    name: "generate_framework_binding",
    arguments: {
      roomId,
      cartridgeSlug: slug,
      framework: "phaser",
      partnerId: "solflare-mobile",
      partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
    },
  });
  assert.ok(!phaserBindRes.isError, "generate_framework_binding (phaser) should succeed");
  assert.ok(isRecord(phaserBindRes.structuredContent));
  assert.ok(String(phaserBindRes.structuredContent.code).includes("CartridgeClient.connect"));

  const unityBindRes = await client.callTool({
    name: "generate_framework_binding",
    arguments: {
      roomId,
      cartridgeSlug: slug,
      framework: "unity",
    },
  });
  assert.ok(!unityBindRes.isError, "generate_framework_binding (unity) should succeed");
  assert.ok(isRecord(unityBindRes.structuredContent));
  assert.equal(unityBindRes.structuredContent.language, "csharp");

  // 6. inspect_creator_vault
  const vaultRes = await client.callTool({
    name: "inspect_creator_vault",
    arguments: {
      creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
      network: "devnet",
    },
  });
  assert.ok(!vaultRes.isError, "inspect_creator_vault should succeed");
  assert.ok(isRecord(vaultRes.structuredContent));
  assert.ok(String(vaultRes.structuredContent.creatorFeeVaultPda).length >= 32);
  assert.ok(String(vaultRes.structuredContent.standaloneSplitPolicy).includes("50% Creator"));
}

describe("@cartridgefi/mcp v2 — Stdio & Streamable HTTP End-to-End Verification", () => {
  it("serves all 6 tools cleanly over subprocess stdio transport", async () => {
    const builtEntry = fileURLToPath(new URL("../src/index.js", import.meta.url));
    const client = new Client({ name: "mcp-stdio-e2e-test", version: "2.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [builtEntry],
      env: {
        ...getDefaultEnvironment(),
        CARTRIDGEFI_API_URL: "http://127.0.0.1:19999",
      },
      stderr: "pipe",
    });

    await client.connect(transport);
    try {
      await exerciseAllSixMcpTools(client);
    } finally {
      await client.close();
    }
  });

  it("serves all 6 tools and GET /health cleanly over live Streamable HTTP (/mcp)", async () => {
    process.env.CARTRIDGEFI_API_URL = "http://127.0.0.1:19999";
    const started = await startCartridgeMcpHttpServer({
      host: "127.0.0.1",
      port: 0, // Ephemeral port
    });

    try {
      const healthRes = await fetch(started.healthUrl);
      assert.equal(healthRes.status, 200);
      const healthBody: unknown = await healthRes.json();
      assert.ok(isRecord(healthBody));
      assert.equal(healthBody.status, "ok");
      assert.equal(healthBody.transport, "streamable-http");

      const client = new Client({ name: "mcp-http-e2e-test", version: "2.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(started.mcpUrl));
      await client.connect(transport);
      try {
        await exerciseAllSixMcpTools(client);
      } finally {
        await client.close();
      }
    } finally {
      await started.close();
    }
  });
});
