import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOREL_GAMEDAY_MANIFEST,
  CARTRIDGE_DEVNET_AUTHORITIES,
  FP_SCALE,
  PULSE_RUNNER_MANIFEST,
  RoomPhaseCode,
  compilePromptToManifest,
  computeDirectionNeutralRelativeReturn,
  computeDrawdownPenalizedSharpe,
  computeKalshiBrierScore,
  computeMultiStageCarryScore,
  computePoolAndFeeDistribution,
  computeUpdatedMarketElo,
  decodeWorldPulseFrame,
  encodeWorldPulseFrame,
  exportCartridgeManifestJsonSchema,
  simulateCartridgeEconomy,
  validateManifestCompliance,
} from "../src/index.js";

describe("@cartridgefi/shared-types Wave 0 verification", () => {
  it("validates first-party Borel and Pulse Runner manifests and exports JSON Schema", () => {
    const borelCheck = validateManifestCompliance(BOREL_GAMEDAY_MANIFEST);
    assert.equal(borelCheck.valid, true, borelCheck.violations.join("; "));

    const pulseCheck = validateManifestCompliance(PULSE_RUNNER_MANIFEST);
    assert.equal(pulseCheck.valid, true, pulseCheck.violations.join("; "));

    const schema = exportCartridgeManifestJsonSchema();
    assert.equal(typeof schema, "object");
  });

  it("hard-blocks casino loot box prompts while compiling valid prompts", () => {
    const bad = compilePromptToManifest({
      prompt: "Build a paid loot box roulette slot machine on SOL",
      genre: "BOREL_GAMEDAY",
      creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
    });
    assert.equal(bad.compliance.valid, false);
    assert.ok(bad.compliance.violations.length >= 1);

    const good = compilePromptToManifest({
      prompt: "Cyberpunk 3-lane volatility sprint on TSLAx and BTC with Kalshi Fed gates",
      genre: "ARCADE_RUNNER",
      creatorWallet: CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
    });
    assert.equal(good.compliance.valid, true, good.compliance.violations.join("; "));
    assert.equal(good.manifest.metadata.creatorFeeShareBps, 5000);
  });

  it("computes deterministic 10^9 bigint fixed-point skill & ELO formulas accurately", () => {
    // Market crashes -10% across both assets; player shorted Asset 0 (-0.6) and stayed flat Asset 1 (0.0) with beta_bench = 1.0:
    // Asset returns = -0.10 each -> bench mean = -0.10.
    // Weighted return = (-0.6)*(-0.10) = +0.06; minus 1.0 * (-0.10) = +0.16 * 10^9!
    const rel = computeDirectionNeutralRelativeReturn(
      [
        { weightScaled: -600_000_000n, entryPrice: 100_000_000n, exitPrice: 90_000_000n },
        { weightScaled: 0n, entryPrice: 200_000_000n, exitPrice: 180_000_000n },
      ],
      FP_SCALE,
    );
    assert.equal(rel, 160_000_000n);

    const sharpe = computeDrawdownPenalizedSharpe(
      [15_000_000n, 20_000_000n, 18_000_000n, 22_000_000n],
      5_000_000n,
      500_000_000n,
    );
    assert.ok(sharpe > 0n);

    // Perfect forecast (f=1.0, o=1.0) -> Brier score = 1.0 * 10^9
    const perfectBrier = computeKalshiBrierScore([
      { forecastProbScaled: FP_SCALE, outcomeScaled: FP_SCALE },
    ]);
    assert.equal(perfectBrier, FP_SCALE);

    // Multi-stage carry: S1 = 0.5, S2 = 0.2, M_max = 1.5 -> S2 * (1 + 0.5 * 0.5) = 0.2 * 1.25 = 0.25 * 10^9
    const carry = computeMultiStageCarryScore(500_000_000n, 200_000_000n, 1_500_000_000n);
    assert.equal(carry, 250_000_000n);

    // Equal ELO (1200 vs 1200), 1st place (p=1.0) in LIVE mode (K=32) -> expected = 0.5 -> delta = +16.0 * 10^9
    const elo = computeUpdatedMarketElo(
      1_200n * FP_SCALE,
      1_200n * FP_SCALE,
      FP_SCALE,
      "LIVE",
    );
    assert.equal(elo.expectedScoreScaled, 500_000_000n);
    assert.equal(elo.deltaEloScaled, 16n * FP_SCALE);
  });

  it("enforces payout + fee conservation across standalone (50/50) and partner wallet (40/30/30) splits", () => {
    const standalone = computePoolAndFeeDistribution({
      roomPoolUsdc: 123_456_789n,
      totalFeeBps: 250,
      creatorShareBps: 5000,
      partnerWalletActive: false,
      playerScores: [
        { player: "p1", scoreScaled: 210_000_000n },
        { player: "p2", scoreScaled: 140_000_000n },
        { player: "p3", scoreScaled: -10_000_000n },
        { player: "p4", scoreScaled: -80_000_000n },
      ],
    });
    assert.ok(standalone.totalDistributedUsdc <= standalone.roomPoolUsdc);
    assert.equal(standalone.partnerFeeUsdc, 0n);

    const partner = computePoolAndFeeDistribution({
      roomPoolUsdc: 100_000_000n,
      totalFeeBps: 250,
      creatorShareBps: 5000,
      partnerWalletActive: true,
      playerScores: [
        { player: "p1", scoreScaled: 100_000_000n },
        { player: "p2", scoreScaled: 50_000_000n },
      ],
    });
    assert.equal(partner.totalFeeUsdc, 2_500_000n);
    assert.equal(partner.partnerFeeUsdc, 1_000_000n); // 40%
    assert.equal(partner.creatorFeeUsdc, 750_000n); // 30%
    assert.equal(partner.platformFeeUsdc, 750_000n); // 30%
    assert.equal(partner.totalDistributedUsdc, partner.roomPoolUsdc);
  });

  it("runs 500-tick calm and crash_vix35 simulations and round-trips binary WorldPulse frames", () => {
    const calm = simulateCartridgeEconomy(BOREL_GAMEDAY_MANIFEST, "calm", 500, 24);
    const crash = simulateCartridgeEconomy(PULSE_RUNNER_MANIFEST, "crash_vix35", 500, 24);
    assert.equal(calm.payoutConservationVerified, true);
    assert.equal(crash.payoutConservationVerified, true);

    const encoded = encodeWorldPulseFrame({
      phase: RoomPhaseCode.FogOfWar,
      assetIndex: 0,
      timestampMs: 1_795_548_000_000n,
      price8: 18_542_000_000n,
      velocityBps: 42,
      volatilitySigmaMilli: 2650,
      countdownRemainingMs: 28_400,
      playerRank: 2,
      totalPlayers: 48,
      topLeaderScoreScaled: 145_000_000n,
      activeRoomsCount: 14,
      isFogEncrypted: true,
      vrfVerified: true,
    });
    const decoded = decodeWorldPulseFrame(encoded);
    assert.equal(decoded.phase, RoomPhaseCode.FogOfWar);
    assert.equal(decoded.price8, 18_542_000_000n);
    assert.equal(decoded.isFogEncrypted, true);
    assert.equal(decoded.vrfVerified, true);
  });
});
