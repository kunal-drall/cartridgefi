import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BOREL_GAMEDAY_MANIFEST,
  CartridgeClient,
  CartridgeManifestV2Schema,
  FIRST_PARTY_CARTRIDGE_CATALOG,
  FP_SCALE,
  MagicBlockSessionSigner,
  PULSE_RUNNER_MANIFEST,
  StanceNettingEngine,
  USDC_UNIT,
  deriveCartridgeDeploymentPlan,
  formatScaledBigInt,
  simulateCartridgeEconomy,
  validateManifestCompliance,
  type CartridgeManifestV2,
  type VolatilityRegime,
} from "@cartridgefi/sdk";
import {
  CLI_TEMPLATES,
  buildTemplateProject,
  type CliTemplateName,
} from "./templates.js";

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  cwd?: string;
}

const DEFAULT_IO: CliIo = {
  stdout: (line: string) => console.log(line),
  stderr: (line: string) => console.error(line),
};

interface ParsedFlags {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseCliArgs(argv: readonly string[]): ParsedFlags {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const token = argv[i] ?? "";
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx > 2) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (token === "-h") {
      flags.help = true;
    } else if (token === "-v") {
      flags.version = true;
    } else {
      positionals.push(token);
    }
    i += 1;
  }

  return { positionals, flags };
}

function formatAtomicUsdc(atomicStr: string): string {
  const atomic = BigInt(atomicStr);
  const scaled = (atomic * FP_SCALE) / USDC_UNIT;
  return formatScaledBigInt(scaled, 2);
}

async function loadManifestFromPathOrSlug(
  targetArg: string | undefined,
  cwd: string,
): Promise<CartridgeManifestV2> {
  if (targetArg) {
    const builtin = FIRST_PARTY_CARTRIDGE_CATALOG.find((m) => m.metadata.slug === targetArg);
    if (builtin) {
      return builtin;
    }
  }
  const resolvedPath = path.resolve(cwd, targetArg ?? "./cartridge.manifest.json");
  const content = await readFile(resolvedPath, "utf8");
  const rawJson: unknown = JSON.parse(content);
  return CartridgeManifestV2Schema.parse(rawJson);
}

function printHelp(io: CliIo): void {
  io.stdout(`CartridgeFi CLI v2.0.0 — Multi-Genre Real-Market Game Engine on Solana & MagicBlock

Usage:
  cartridgefi init <dir> [--template borel-gameday | phaser-volatility-runner | threejs-syndicate-turf] [--creator-wallet <PUBKEY>]
  cartridgefi simulate [manifestPath] [--regime calm | crash_vix35] [--ticks 500] [--json]
  cartridgefi dev [--replay-tape nvda-earnings-nov26] [--ticks 20] [--manifest ./cartridge.manifest.json]
  cartridgefi publish [manifestPath] [--network devnet | mainnet-beta] [--creator-wallet <PUBKEY>] [--json]
`);
}

async function handleInitCommand(
  positionals: readonly string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
  cwd: string,
): Promise<number> {
  const dirArg = positionals[1];
  if (!dirArg) {
    io.stderr("Error: Missing target directory. Usage: cartridgefi init <dir> [--template ...]");
    return 1;
  }

  const rawTemplate = typeof flags.template === "string" ? flags.template : "borel-gameday";
  if (!(CLI_TEMPLATES as readonly string[]).includes(rawTemplate)) {
    io.stderr(
      `Error: Unknown template '${rawTemplate}'. Supported templates: ${CLI_TEMPLATES.join(", ")}`,
    );
    return 1;
  }
  const template = rawTemplate as CliTemplateName;
  const creatorWallet =
    typeof flags["creator-wallet"] === "string" ? flags["creator-wallet"] : undefined;

  const targetRoot = path.resolve(cwd, dirArg);
  const projectName = path.basename(targetRoot);
  const scaffold = buildTemplateProject({
    projectName,
    template,
    creatorWallet,
  });

  const compliance = validateManifestCompliance(scaffold.manifest);
  if (!compliance.valid) {
    io.stderr(`Error: Generated manifest failed compliance: ${compliance.violations.join("; ")}`);
    return 1;
  }

  for (const [relPath, fileContent] of Object.entries(scaffold.files)) {
    const absPath = path.join(targetRoot, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, fileContent, "utf8");
  }

  io.stdout(`✔ Scaffolded CartridgeFi v2.0 project '${scaffold.manifest.metadata.slug}' (${template})`);
  io.stdout(`  Directory      : ${targetRoot}`);
  io.stdout(`  Manifest       : ${path.join(targetRoot, "cartridge.manifest.json")}`);
  io.stdout(`  Client Entry   : ${path.join(targetRoot, "src/game.ts")}`);
  io.stdout(`  Creator Split  : 50% Creator (${scaffold.manifest.metadata.creatorWallet})`);
  io.stdout(`  Next Step      : cartridgefi simulate ${path.join(dirArg, "cartridge.manifest.json")}`);
  return 0;
}

async function handleSimulateCommand(
  positionals: readonly string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
  cwd: string,
): Promise<number> {
  const manifestPathArg = positionals[1];
  let rawManifestObj: unknown;
  const builtin = manifestPathArg
    ? FIRST_PARTY_CARTRIDGE_CATALOG.find((m) => m.metadata.slug === manifestPathArg)
    : undefined;

  if (builtin) {
    rawManifestObj = builtin;
  } else {
    const resolvedPath = path.resolve(cwd, manifestPathArg ?? "./cartridge.manifest.json");
    try {
      const content = await readFile(resolvedPath, "utf8");
      rawManifestObj = JSON.parse(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.stderr(`Error reading manifest at ${resolvedPath}: ${msg}`);
      return 1;
    }
  }

  const parsed = CartridgeManifestV2Schema.safeParse(rawManifestObj);
  if (!parsed.success) {
    io.stderr("Compliance & Schema Gate FAILED:");
    for (const issue of parsed.error.issues) {
      io.stderr(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    return 1;
  }

  const compliance = validateManifestCompliance(parsed.data);
  if (!compliance.valid) {
    io.stderr("Compliance Gate FAILED:");
    for (const v of compliance.violations) {
      io.stderr(`  - ${v}`);
    }
    return 1;
  }

  const rawRegime = typeof flags.regime === "string" ? flags.regime : "calm";
  if (rawRegime !== "calm" && rawRegime !== "crash_vix35") {
    io.stderr("Error: --regime must be 'calm' or 'crash_vix35'.");
    return 1;
  }
  const regime: VolatilityRegime = rawRegime;
  const ticks =
    typeof flags.ticks === "string" ? Math.max(20, Math.min(5_000, Number(flags.ticks) || 500)) : 500;

  const report = simulateCartridgeEconomy(parsed.data, regime, ticks, 24);
  if (!report.payoutConservationVerified) {
    io.stderr("CRITICAL: Payout conservation invariant failed!");
    return 1;
  }

  if (flags.json === true) {
    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  }

  io.stdout("┌──────────────────────────────────────────────────────────────────────────┐");
  io.stdout(`│ CARTRIDGEFI FIXED-POINT SIMULATION GATE · ${report.slug.padEnd(30)} │`);
  io.stdout("├──────────────────────────────────────────────────────────────────────────┤");
  io.stdout(
    `│ Regime              : ${report.volatilityRegime.padEnd(16)} Ticks : ${String(report.tickCount).padEnd(8)} Players : ${String(report.simulatedPlayers).padEnd(4)} │`,
  );
  io.stdout(
    `│ Score Percentiles   : P90=${report.p90ScoreFormatted}   Median=${report.medianScoreFormatted}   P10=${report.p10ScoreFormatted}          │`,
  );
  io.stdout(
    `│ Room Pool (USDC)    : $${formatAtomicUsdc(report.roomPoolUsdcAtomic)} (${report.roomPoolUsdcAtomic} atomic)                    │`,
  );
  io.stdout(
    `│ Total Distributed   : $${formatAtomicUsdc(report.totalDistributedUsdcAtomic)} · Conservation Proof: VERIFIED (<= Pool) │`,
  );
  io.stdout(
    `│ Creator Revenue Est : $${report.projectedMonthlyCreatorFeeUsdcFormatted}/mo (50% Creator Split @ 40 rooms/day)        │`,
  );
  io.stdout("├──────────────────────────────────────────────────────────────────────────┤");
  for (const winner of report.topPodium) {
    io.stdout(
      `│ Rank #${winner.rank}  ${winner.player.padEnd(12)} Score: ${winner.scoreFormatted.padStart(9)}   Payout: $${formatAtomicUsdc(winner.payoutUsdcAtomic).padStart(8)} USDC │`,
    );
  }
  io.stdout("└──────────────────────────────────────────────────────────────────────────┘");
  return 0;
}

function deterministicTapeStep(seed: bigint): { next: bigint; deltaBps: number; sigmaMilli: number } {
  let x = seed & 0xffff_ffff_ffff_ffffn;
  if (x === 0n) x = 0x9e37_79b9_7f4a_7c15n;
  x ^= x >> 12n;
  x ^= (x << 25n) & 0xffff_ffff_ffff_ffffn;
  x ^= x >> 27n;
  const v = (x * 0x2545_f491_4f6c_dd1dn) & 0xffff_ffff_ffff_ffffn;
  const centered = Number(v % 91n) - 45;
  const sigmaMilli = 1_500 + Number(v % 2_100n);
  return { next: x, deltaBps: centered, sigmaMilli };
}

async function handleDevCommand(
  flags: Record<string, string | boolean>,
  io: CliIo,
  cwd: string,
): Promise<number> {
  const replayTape =
    typeof flags["replay-tape"] === "string" ? flags["replay-tape"] : "nvda-earnings-nov26";
  const tickLimit =
    typeof flags.ticks === "string" ? Math.max(1, Math.min(500, Number(flags.ticks) || 12)) : 12;

  let manifest: CartridgeManifestV2 = PULSE_RUNNER_MANIFEST;
  if (typeof flags.manifest === "string") {
    manifest = await loadManifestFromPathOrSlug(flags.manifest, cwd);
  } else {
    try {
      manifest = await loadManifestFromPathOrSlug("./cartridge.manifest.json", cwd);
    } catch {
      manifest = PULSE_RUNNER_MANIFEST;
    }
  }

  const plan = await deriveCartridgeDeploymentPlan(manifest, { network: "devnet" });
  const startMs = 1_764_000_000_000n;
  const netting = new StanceNettingEngine({
    nettingPolicy: "NET_AT_CHECKPOINTS_30S",
    checkpointIntervalMs: 30_000n,
    initialTimestampMs: startMs,
  });
  const sessionSigner = await MagicBlockSessionSigner.create({
    ownerWallet: manifest.metadata.creatorWallet,
    roomShardPda: plan.roomShardPda,
    maxUsdcAtomic: 0n,
    maxLeverage: manifest.onboardingAndSession.liveSessionEnvelopeUsdc.maxLeverage,
    mode: "PAPER",
  });

  let seed = 0x4e56_4441_5f54_4150n;
  for (let i = 0; i < replayTape.length; i += 1) {
    seed = ((seed ^ BigInt(replayTape.charCodeAt(i))) * 0x100_0000_01b3n) & 0xffff_ffff_ffff_ffffn;
  }

  let nvdaPrice8 = 14_280_000_000n;
  const lanes = ["LANE_LEFT", "LANE_CENTER", "LANE_RIGHT"] as const;

  io.stdout(`▶ CartridgeFi Local Replay & Stance Netting Inspector`);
  io.stdout(`  Cartridge      : ${manifest.metadata.slug} (${manifest.metadata.genre})`);
  io.stdout(`  Replay Tape    : ${replayTape} (${tickLimit} deterministic ticks)`);
  io.stdout(`  RoomShard PDA  : ${plan.roomShardPda}`);
  io.stdout(`  Session Signer : ${sessionSigner.sessionPubkey} (0-Popup Ed25519)`);
  io.stdout("────────────────────────────────────────────────────────────────────────────");

  for (let t = 1; t <= tickLimit; t += 1) {
    const step = deterministicTapeStep(seed);
    seed = step.next;
    nvdaPrice8 = nvdaPrice8 + (nvdaPrice8 * BigInt(step.deltaBps)) / 10_000n;
    const simulatedNowMs = startMs + BigInt(t * 6_500); // crosses 30s checkpoint every 5 ticks

    // Simulate 4 rapid 60fps reflex lane switches per replay tick
    for (let burst = 0; burst < 4; burst += 1) {
      const lane = lanes[(t + burst) % 3] ?? "LANE_RIGHT";
      netting.recordAction("PLAYER_LANE_SWITCH", { state: lane }, simulatedNowMs);
      await sessionSigner.signSessionAction({
        actionType: "PLAYER_LANE_SWITCH",
        data: { lane, tick: t },
      });
    }

    const metrics = netting.getTelemetry();
    const priceStr = formatScaledBigInt(nvdaPrice8 * 10n, 2);
    const sigmaStr = `${Math.floor(step.sigmaMilli / 1000)}.${(step.sigmaMilli % 1000)
      .toString()
      .padStart(3, "0")}σ`;

    io.stdout(
      `  Tick #${String(t).padStart(2, "0")} | NVDAx $${priceStr.padStart(7)} (${String(step.deltaBps).padStart(3)} bps, ${sigmaStr}) | RawMoves=${String(metrics.rawGameActionsCount).padStart(3)} | NettedOrders=${String(metrics.nettedVenueOrdersCount).padStart(2)} | SavedSwaps=${String(metrics.savedPredatorySwapsCount).padStart(3)}`,
    );
  }

  netting.flushCheckpoint("SETTLEMENT", startMs + BigInt((tickLimit + 1) * 7_000));
  const finalMetrics = netting.getTelemetry();
  io.stdout("────────────────────────────────────────────────────────────────────────────");
  io.stdout(
    `✔ Replay complete: ${finalMetrics.rawGameActionsCount} ER gameplay actions collapsed into ${finalMetrics.nettedVenueOrdersCount} venue orders (${finalMetrics.savedPredatorySwapsCount} predatory swaps prevented).`,
  );
  return 0;
}

async function handlePublishCommand(
  positionals: readonly string[],
  flags: Record<string, string | boolean>,
  io: CliIo,
  cwd: string,
): Promise<number> {
  const manifestPathArg = positionals[1];
  let manifest: CartridgeManifestV2;
  try {
    manifest = await loadManifestFromPathOrSlug(manifestPathArg, cwd);
  } catch {
    manifest = BOREL_GAMEDAY_MANIFEST;
  }

  if (typeof flags["creator-wallet"] === "string" && flags["creator-wallet"].trim().length > 0) {
    manifest = {
      ...manifest,
      metadata: {
        ...manifest.metadata,
        creatorWallet: flags["creator-wallet"].trim(),
      },
    };
  }

  const rawNetwork = typeof flags.network === "string" ? flags.network : "devnet";
  if (rawNetwork !== "devnet" && rawNetwork !== "mainnet-beta") {
    io.stderr("Error: --network must be 'devnet' or 'mainnet-beta'.");
    return 1;
  }

  const compliance = validateManifestCompliance(manifest);
  if (!compliance.valid) {
    io.stderr("Publish blocked by Compliance Gate:");
    for (const v of compliance.violations) {
      io.stderr(`  - ${v}`);
    }
    return 1;
  }

  const apiBaseUrl =
    typeof flags["api-url"] === "string"
      ? flags["api-url"]
      : process.env.CARTRIDGEFI_API_URL ?? "http://localhost:8787";

  const client = await CartridgeClient.connect({
    cartridgeSlug: manifest.metadata.slug,
    manifest,
    apiBaseUrl,
    network: rawNetwork,
  });

  try {
    const receipt = await client.deployManifestOnChain(manifest, rawNetwork);
    if (flags.json === true) {
      io.stdout(JSON.stringify(receipt, null, 2));
      return 0;
    }

    io.stdout("┌──────────────────────────────────────────────────────────────────────────────────┐");
    io.stdout(`│ CARTRIDGEFI ON-CHAIN DEPLOYMENT RECEIPT (${receipt.network.toUpperCase().padEnd(12)})                       │`);
    io.stdout("├──────────────────────────────────────────────────────────────────────────────────┤");
    io.stdout(`│ Cartridge Slug      : ${receipt.slug}`);
    io.stdout(`│ Room ID             : ${receipt.roomId}`);
    io.stdout(`│ Creator Wallet      : ${receipt.creatorAddress}`);
    io.stdout(`│ Manifest PDA        : ${receipt.cartridgeManifestPda}`);
    io.stdout(`│ RoomShard PDA       : ${receipt.roomShardPda}`);
    io.stdout(`│ Creator Vault PDA   : ${receipt.creatorFeeVaultPda}`);
    io.stdout(`│ Registry Program    : ${receipt.registryProgramId}`);
    io.stdout(`│ ER Room Program     : ${receipt.erRoomProgramId}`);
    io.stdout(`│ Delegation Program  : ${receipt.delegationProgramId}`);
    io.stdout(`│ TEE Permission Prog : ${receipt.permissionProgramId}`);
    io.stdout(`│ Core-API Registered : ${receipt.deployedViaCoreApi ? "YES (Live Lobby Active)" : "OFFLINE_PREPARED (Codama Payload Ready)"}`);
    io.stdout(`│ Manifest Explorer   : ${receipt.manifestExplorerUrl}`);
    io.stdout(`│ RoomShard Explorer  : ${receipt.roomShardExplorerUrl}`);
    io.stdout(`│ Playable Studio URL : ${receipt.playableStudioUrl}`);
    io.stdout("└──────────────────────────────────────────────────────────────────────────────────┘");
    return 0;
  } finally {
    client.disconnect();
  }
}

export async function runCli(argv: readonly string[], io: CliIo = DEFAULT_IO): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const { positionals, flags } = parseCliArgs(argv);

  if (flags.version === true) {
    io.stdout("2.0.0");
    return 0;
  }
  const command = positionals[0];
  if (!command || flags.help === true) {
    printHelp(io);
    return 0;
  }

  try {
    switch (command) {
      case "init":
        return await handleInitCommand(positionals, flags, io, cwd);
      case "simulate":
        return await handleSimulateCommand(positionals, flags, io, cwd);
      case "dev":
        return await handleDevCommand(flags, io, cwd);
      case "publish":
        return await handlePublishCommand(positionals, flags, io, cwd);
      default:
        io.stderr(`Unknown command '${command}'. Run 'cartridgefi --help' for usage.`);
        return 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`CartridgeFi CLI Error: ${message}`);
    return 1;
  }
}
