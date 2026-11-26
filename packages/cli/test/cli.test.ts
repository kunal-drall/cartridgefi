import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  CartridgeManifestV2Schema,
} from "@cartridgefi/sdk";
import { runCli } from "../src/index.js";

const execFileAsync = promisify(execFile);

function createMemoryIo(cwd: string): {
  stdoutLines: string[];
  stderrLines: string[];
  io: { stdout: (l: string) => void; stderr: (l: string) => void; cwd: string };
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    io: {
      cwd,
      stdout: (l: string) => stdoutLines.push(l),
      stderr: (l: string) => stderrLines.push(l),
    },
  };
}

describe("cartridgefi CLI — init, simulate, dev, and publish", () => {
  it("scaffolds a complete phaser-volatility-runner project and passes simulate, dev, and publish", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cartridgefi-cli-test-"));

    try {
      // 1. init
      const initCapture = createMemoryIo(tmpDir);
      const initCode = await runCli(
        [
          "init",
          "neon-runner",
          "--template",
          "phaser-volatility-runner",
          "--creator-wallet",
          CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper,
        ],
        initCapture.io,
      );
      assert.equal(initCode, 0, initCapture.stderrLines.join("\n"));

      const projectDir = path.join(tmpDir, "neon-runner");
      const manifestRaw = await readFile(path.join(projectDir, "cartridge.manifest.json"), "utf8");
      const parsedManifest = CartridgeManifestV2Schema.parse(JSON.parse(manifestRaw));
      assert.equal(parsedManifest.metadata.slug, "neon-runner");
      assert.equal(parsedManifest.metadata.genre, "ARCADE_RUNNER");

      const gameCode = await readFile(path.join(projectDir, "src/game.ts"), "utf8");
      assert.ok(gameCode.includes("CartridgeClient.connect"));
      assert.ok(gameCode.includes("PLAYER_LANE_SWITCH"));

      // 2. simulate (crash_vix35 JSON + tabular)
      const simCapture = createMemoryIo(projectDir);
      const simCode = await runCli(
        ["simulate", "./cartridge.manifest.json", "--regime", "crash_vix35", "--json"],
        simCapture.io,
      );
      assert.equal(simCode, 0, simCapture.stderrLines.join("\n"));
      const simReport = JSON.parse(simCapture.stdoutLines.join("\n")) as {
        payoutConservationVerified: boolean;
        tickCount: number;
        volatilityRegime: string;
      };
      assert.equal(simReport.payoutConservationVerified, true);
      assert.equal(simReport.tickCount, 500);
      assert.equal(simReport.volatilityRegime, "crash_vix35");

      // 3. dev --replay-tape nvda-earnings-nov26 --ticks 10
      const devCapture = createMemoryIo(projectDir);
      const devCode = await runCli(
        ["dev", "--replay-tape", "nvda-earnings-nov26", "--ticks", "10"],
        devCapture.io,
      );
      assert.equal(devCode, 0, devCapture.stderrLines.join("\n"));
      const devOutput = devCapture.stdoutLines.join("\n");
      assert.ok(devOutput.includes("40 ER gameplay actions collapsed"));
      assert.ok(devOutput.includes("predatory swaps prevented"));

      // 4. publish --network devnet --json
      const pubCapture = createMemoryIo(projectDir);
      const pubCode = await runCli(
        [
          "publish",
          "./cartridge.manifest.json",
          "--network",
          "devnet",
          "--creator-wallet",
          CARTRIDGE_DEVNET_AUTHORITIES.pacerBot1,
          "--api-url",
          "http://127.0.0.1:19999",
          "--json",
        ],
        pubCapture.io,
      );
      assert.equal(pubCode, 0, pubCapture.stderrLines.join("\n"));
      const pubReceipt = JSON.parse(pubCapture.stdoutLines.join("\n")) as {
        registryProgramId: string;
        erRoomProgramId: string;
        cartridgeManifestPda: string;
        roomShardPda: string;
        manifestExplorerUrl: string;
      };
      assert.equal(pubReceipt.registryProgramId, CARTRIDGE_PROGRAM_IDS.registry);
      assert.equal(pubReceipt.erRoomProgramId, CARTRIDGE_PROGRAM_IDS.erRoom);
      assert.ok(pubReceipt.cartridgeManifestPda.length >= 32);
      assert.ok(pubReceipt.roomShardPda.length >= 32);
      assert.ok(pubReceipt.manifestExplorerUrl.includes("explorer.solana.com"));

      // 5. Reject prohibited gambling/loot-box manifest in simulate
      const badPath = path.join(projectDir, "bad.manifest.json");
      const badManifest = {
        ...parsedManifest,
        metadata: {
          ...parsedManifest.metadata,
          title: "Crypto Casino Jackpot Loot Box Spin",
        },
      };
      await writeFile(badPath, JSON.stringify(badManifest, null, 2), "utf8");
      const badCapture = createMemoryIo(projectDir);
      const badCode = await runCli(["simulate", badPath], badCapture.io);
      assert.equal(badCode, 1);
      assert.ok(badCapture.stderrLines.join("\n").includes("Compliance"));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes the compiled bin entrypoint via node subprocess cleanly", async () => {
    const cliEntry = fileURLToPath(new URL("../src/index.js", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      cliEntry,
      "simulate",
      "borel-macro-blitz-001",
      "--regime",
      "calm",
    ]);
    assert.ok(stdout.includes("CARTRIDGEFI FIXED-POINT SIMULATION GATE"));
    assert.ok(stdout.includes("Conservation Proof: VERIFIED"));
  });
});
