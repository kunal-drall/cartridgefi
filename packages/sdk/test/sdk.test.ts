import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  BOREL_GAMEDAY_MANIFEST,
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  CashModal,
  CashModalClient,
  CartridgeClient,
  MAGICBLOCK_CONSTANTS,
  MagicBlockRouterClient,
  MagicBlockSessionSigner,
  PASSPORT_ELIGIBILITY_BITS,
  PULSE_RUNNER_MANIFEST,
  RoomPhaseCode,
  SOLANA_CANONICAL_MINTS,
  SUPPORTED_DEPOSIT_CHAINS,
  StanceNettingEngine,
  USDC_UNIT,
  bytesToHex,
  deriveCartridgeDeploymentPlan,
  sha256Sync,
  utf8ToBytes,
} from "../src/index.js";

describe("@cartridgefi/sdk — Cryptography & PDA Derivation", () => {
  it("matches Node crypto SHA-256 bit-for-bit across boundary message lengths", () => {
    const samples = [
      "",
      "borel-macro-blitz-001",
      "a".repeat(55),
      "b".repeat(56),
      "c".repeat(64),
      "cartridgefi-magicblock-private-er-tee-fog-of-war-0123456789-abcdef-xyz",
    ];
    for (const s of samples) {
      const expected = createHash("sha256").update(s, "utf8").digest("hex");
      const actual = bytesToHex(sha256Sync(utf8ToBytes(s)));
      assert.equal(actual, expected, `SHA-256 mismatch on length ${s.length}`);
    }
  });

  it("derives canonical CartridgeManifestAccount & RoomShard PDAs and Codama instructions", async () => {
    const plan = await deriveCartridgeDeploymentPlan(BOREL_GAMEDAY_MANIFEST, {
      network: "devnet",
      shardIndex: 0,
    });

    assert.equal(plan.registryProgramId, CARTRIDGE_PROGRAM_IDS.registry);
    assert.equal(plan.erRoomProgramId, CARTRIDGE_PROGRAM_IDS.erRoom);
    assert.equal(plan.delegationProgramId, MAGICBLOCK_CONSTANTS.delegationProgramId);
    assert.equal(plan.permissionProgramId, MAGICBLOCK_CONSTANTS.permissionProgramId);
    assert.ok(plan.cartridgeManifestPda.length >= 32);
    assert.ok(plan.roomShardPda.length >= 32);
    assert.ok(plan.registerCartridgeInstruction.byteLength > 8);
    assert.ok(plan.initializeRoomShardInstruction.byteLength > 8);
    assert.match(plan.manifestExplorerUrl, /\?cluster=devnet$/);
  });
});

describe("@cartridgefi/sdk — MagicBlockSessionSigner", () => {
  it("signs zero-popup Ed25519 gameplay envelopes and enforces <=5x leverage, USDC cap, expiry, and custody isolation", async () => {
    const plan = await deriveCartridgeDeploymentPlan(BOREL_GAMEDAY_MANIFEST);

    await assert.rejects(
      () =>
        MagicBlockSessionSigner.create({
          ownerWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
          roomShardPda: plan.roomShardPda,
          maxUsdcAtomic: 50n * USDC_UNIT,
          maxLeverage: 6, // > 5x forbidden
          mode: "LIVE",
        }),
      /maxLeverage/,
    );

    const nowSecs = 1_764_000_000n;
    const signer = await MagicBlockSessionSigner.create(
      {
        ownerWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
        roomShardPda: plan.roomShardPda,
        maxUsdcAtomic: 25n * USDC_UNIT,
        maxLeverage: 5,
        ttlSecs: 120,
        mode: "LIVE",
      },
      nowSecs,
    );

    const env1 = await signer.signSessionAction(
      {
        actionType: "SUBMIT_CONVICTION_WEIGHTS",
        additionalUsdcAtomic: 20n * USDC_UNIT,
        requestedLeverage: 3,
        data: { weightsBps: [5000, 3000, 2000, 0] },
      },
      nowSecs + 10n,
    );
    assert.equal(env1.sequence, 1);
    assert.equal(await signer.verifyActionSignature(env1), true);

    // Reject exceeding 25 USDC session cap
    await assert.rejects(
      () =>
        signer.signSessionAction(
          {
            actionType: "PLAYER_LANE_SWITCH",
            additionalUsdcAtomic: 10n * USDC_UNIT,
            data: { state: "LANE_RIGHT" },
          },
          nowSecs + 15n,
        ),
      /USDC cap exceeded/,
    );

    // Reject SPL Token or Vault Router custody instructions
    await assert.rejects(
      () =>
        signer.signSessionAction(
          {
            actionType: "SUBMIT_CONVICTION_WEIGHTS",
            targetProgramId: CARTRIDGE_PROGRAM_IDS.vaultRouter,
            data: { drain: true },
          },
          nowSecs + 15n,
        ),
      /scope violation/,
    );

    await assert.rejects(
      () =>
        signer.signSessionAction(
          {
            actionType: "SPL_VAULT_TRANSFER",
            data: { amount: 1000 },
          },
          nowSecs + 15n,
        ),
      /scope violation/,
    );

    // Reject expired session
    await assert.rejects(
      () =>
        signer.signSessionAction(
          {
            actionType: "PLAYER_LANE_SWITCH",
            data: { state: "LANE_LEFT" },
          },
          nowSecs + 121n,
        ),
      /expired/,
    );

    signer.revoke();
    assert.equal(signer.isRevoked, true);
  });
});

describe("@cartridgefi/sdk — StanceNettingEngine", () => {
  it("collapses 120 high-frequency 60fps lane switches into a single checkpoint venue order", () => {
    const startMs = 1_000_000n;
    const engine = new StanceNettingEngine({
      nettingPolicy: "NET_AT_CHECKPOINTS_30S",
      checkpointIntervalMs: 30_000n,
      initialTimestampMs: startMs,
    });

    const lanes = ["LANE_LEFT", "LANE_CENTER", "LANE_RIGHT"] as const;
    for (let i = 0; i < 119; i += 1) {
      const state = lanes[i % 3] ?? "LANE_CENTER";
      const res = engine.recordAction(
        "PLAYER_LANE_SWITCH",
        { state },
        startMs + BigInt(i * 100), // within 11.9s < 30s checkpoint
      );
      assert.equal(res.autoFlushedBatch, null);
    }

    // 120th move crosses the 30,000ms checkpoint boundary, landing on LANE_RIGHT (+10,000 bps)
    const checkpointRes = engine.recordAction(
      "PLAYER_LANE_SWITCH",
      { state: "LANE_RIGHT" },
      startMs + 30_500n,
    );

    assert.ok(checkpointRes.autoFlushedBatch !== null);
    assert.equal(checkpointRes.metrics.rawGameActionsCount, 120);
    assert.equal(checkpointRes.metrics.nettedVenueOrdersCount, 1);
    assert.equal(checkpointRes.metrics.savedPredatorySwapsCount, 119);
    assert.deepEqual(checkpointRes.autoFlushedBatch.netVenueDeltaBps, [10_000, 0, 0, 0]);

    // Reject gross conviction weights > 10,000 bps
    assert.throws(
      () =>
        engine.recordAction("SUBMIT_CONVICTION_WEIGHTS", {
          weightsBps: [6_000, 5_000, 0, 0],
        }),
      /exceeds 10000 bps/,
    );
  });
});

describe("@cartridgefi/sdk — Cashier & MagicBlockRouterClient", () => {
  it("creates 7-chain canonical Solana USDC deposit intents, Apple Pay passkeys, and Devnet faucet credits", async () => {
    const cashier = new CashModalClient({
      apiBaseUrl: "http://127.0.0.1:19999", // Guaranteed offline to verify deterministic integer math
      requestTimeoutMs: 150,
    });

    for (const chain of SUPPORTED_DEPOSIT_CHAINS) {
      const receipt = await cashier.createDepositIntent({
        wallet: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
        sourceChain: chain,
        amountUsdcAtomic: 100n * USDC_UNIT,
      });
      assert.equal(receipt.canonicalSolanaMint, SOLANA_CANONICAL_MINTS.USDC);
      if (chain === "solana") {
        assert.equal(receipt.bridgeFeeUsdcAtomic, 0n);
        assert.equal(receipt.creditedCanonicalUsdcAtomic, 100n * USDC_UNIT);
      } else {
        assert.equal(receipt.bridgeFeeUsdcAtomic, 100_000n); // 10 bps = 0.10 USDC
        assert.equal(receipt.creditedCanonicalUsdcAtomic, 99_900_000n);
      }
    }

    const faucet = await cashier.requestDevnetUsdcFaucet({
      wallet: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot2,
      amountUsdcAtomic: 50n * USDC_UNIT,
    });
    assert.equal(faucet.creditedUsdcAtomic, 50n * USDC_UNIT);
    assert.equal(faucet.canonicalMint, SOLANA_CANONICAL_MINTS.USDC);
  });

  it("builds Private ER TEE challenge URLs and streams 48-byte binary WorldPulseFrame ticks cleanly", async () => {
    const router = new MagicBlockRouterClient({ requestTimeoutMs: 150 });
    const challenge = router.buildPrivateTeeChallengeUrl({
      pubkey: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
      timestampMs: 1_764_000_000_000n,
    });
    assert.ok(challenge.teeLoginUrl.startsWith("https://devnet-tee.magicblock.app/auth/login"));
    assert.equal(challenge.privatePaymentsUrl, "https://payments.magicblock.app");
    assert.equal(
      router.buildAuthenticatedTeeEndpoint("tok_123"),
      "https://devnet-tee.magicblock.app?token=tok_123",
    );

    const receivedFrames: EnrichedMarketPulseForTest[] = [];
    type EnrichedMarketPulseForTest = { symbol: string; price8: bigint };

    await new Promise<void>((resolve) => {
      const sub = router.subscribeWorldPulse(
        {
          forceStandaloneSimulation: true,
          simulationIntervalMs: 20,
        },
        (_raw, enriched) => {
          receivedFrames.push({ symbol: enriched.symbol, price8: enriched.price8 });
          if (receivedFrames.length >= 3) {
            sub.close();
            resolve();
          }
        },
      );
    });

    assert.ok(receivedFrames.length >= 3);
    assert.ok((receivedFrames[0]?.price8 ?? 0n) > 0n);
  });
});

describe("@cartridgefi/sdk — CartridgeClient End-to-End Lifecycle", () => {
  it("supports 40/30/30 partner wallet attribution, CashModal, action emission, Showdown unseal, xStock claim, and geo fallback", async () => {
    const client = await CartridgeClient.connect({
      cartridgeSlug: PULSE_RUNNER_MANIFEST.metadata.slug,
      partnerId: "solflare-mobile",
      partnerFeeVault: CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
      mode: "LIVE",
      forceStandaloneSimulation: true,
      simulationIntervalMs: 25,
    });

    assert.equal(client.feeAttribution.partnerWalletActive, true);
    assert.equal(client.feeAttribution.partnerShareBps, 4_000);
    assert.equal(client.feeAttribution.creatorShareBps, 3_000);
    assert.equal(client.feeAttribution.engineShareBps, 3_000);

    const sessionSummary = await CashModal.ensureSessionReady(client, {
      mode: "LIVE",
      suggestedEnvelopeUsdc: 25,
    });
    assert.equal(sessionSummary.fundedUsdcAtomic, 25n * USDC_UNIT);

    let tickSeen = false;
    const unsub = client.onWorldTick((frame) => {
      if (frame.price8 > 0n) {
        tickSeen = true;
      }
    });
    await new Promise((r) => setTimeout(r, 40));
    unsub();
    assert.equal(tickSeen, true);

    const actionReceipt = await client.emitAction("PLAYER_LANE_SWITCH", {
      state: "LANE_RIGHT",
    });
    assert.equal(actionReceipt.nettingMetrics.rawGameActionsCount, 1);
    assert.deepEqual(actionReceipt.nettingMetrics.currentStanceVectorBps, [10_000, 0, 0, 0]);

    const unseal = await client.triggerShowdownUnseal();
    assert.equal(unseal.phaseCode, RoomPhaseCode.Showdown);
    assert.equal(unseal.fogEncrypted, false);
    assert.ok(unseal.triggerShowdownInstruction.byteLength >= 8);

    // Eligible winner claims NVDAx via Jupiter xStocks
    const nvdaClaim = await client.claimStockPrize("NVDAx", {
      payoutUsdcAtomic: 142_800_000n, // $142.80 -> ~1.0000 NVDAx at $142.80
      eligibilityBitmask:
        PASSPORT_ELIGIBILITY_BITS.GEO_ELIGIBLE | PASSPORT_ELIGIBILITY_BITS.CAN_CLAIM_XSTOCKS,
    });
    assert.equal(nvdaClaim.settledAsset, "NVDAx");
    assert.equal(nvdaClaim.settledMint, SOLANA_CANONICAL_MINTS.NVDAx);
    assert.equal(nvdaClaim.geoFallbackApplied, false);
    assert.ok(nvdaClaim.deliveredUnitsAtomic > 0n);

    // Restricted jurisdiction automatically falls back to canonical USDC
    const fallbackClaim = await client.claimStockPrize("NVDAx", {
      payoutUsdcAtomic: 50n * USDC_UNIT,
      eligibilityBitmask: 0,
    });
    assert.equal(fallbackClaim.settledAsset, "USDC");
    assert.equal(fallbackClaim.settledMint, SOLANA_CANONICAL_MINTS.USDC);
    assert.equal(fallbackClaim.geoFallbackApplied, true);

    const deployReceipt = await client.deployManifestOnChain(BOREL_GAMEDAY_MANIFEST, "devnet");
    assert.equal(deployReceipt.slug, BOREL_GAMEDAY_MANIFEST.metadata.slug);
    assert.ok(deployReceipt.playableStudioUrl.includes("borel-macro-blitz-001"));

    client.disconnect();
  });
});
