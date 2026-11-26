import {
  BOREL_GAMEDAY_MANIFEST,
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  MAGICBLOCK_CONSTANTS,
  PULSE_RUNNER_MANIFEST,
  VICE_BOURSE_MANIFEST,
  type CartridgeManifestV2,
} from "@cartridgefi/sdk";

export const CLI_TEMPLATES = [
  "borel-gameday",
  "phaser-volatility-runner",
  "threejs-syndicate-turf",
] as const;

export type CliTemplateName = (typeof CLI_TEMPLATES)[number];

export interface ScaffoldedProjectFiles {
  manifest: CartridgeManifestV2;
  files: Record<string, string>;
}

function sanitizeSlug(rawName: string): string {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  return cleaned.length >= 3 ? cleaned : "my-cartridge-game";
}

function buildGameSource(template: CliTemplateName, slug: string): string {
  if (template === "phaser-volatility-runner") {
    return `import { CartridgeClient, CashModal } from "@cartridgefi/sdk";

/**
 * 60fps Phaser 3 / Canvas 3-Lane Volatility Runner wired to CartridgeFi Engine.
 * Render loop reads 48-byte WorldPulseFrame telemetry; lane swipes emit 0-gas ER session actions.
 */
export async function bootVolatilityRunner(): Promise<CartridgeClient> {
  const cartridge = await CartridgeClient.connect({
    cartridgeSlug: "${slug}",
    partnerId: "first-party-studio",
    mode: "PAPER",
  });

  await CashModal.ensureSessionReady(cartridge, {
    mode: "PAPER_OR_LIVE",
    suggestedEnvelopeUsdc: 20,
  });

  cartridge.onMarketPulse(({ symbol, priceFormatted, velocityBps, volatilitySigmaMilli, phase }) => {
    const trackSpeedMultiplier = 1 + Math.min(3, Math.floor(Math.abs(velocityBps) / 25));
    const spawnLiquidationBarrier = volatilitySigmaMilli >= 2500;
    console.info(
      \`[RUNNER TICK] \${symbol} $\${priceFormatted} | speed=\${trackSpeedMultiplier}x | barrier=\${spawnLiquidationBarrier} | phase=\${phase}\`,
    );
  });

  // Zero-popup Ed25519 ER action buffered via StanceNettingEngine (30s checkpoint netting)
  await cartridge.emitAction("PLAYER_LANE_SWITCH", { state: "LANE_RIGHT" });
  return cartridge;
}
`;
  }

  if (template === "threejs-syndicate-turf") {
    return `import { CartridgeClient, CashModal } from "@cartridgefi/sdk";

/**
 * Three.js Sector Turf & Private ER TEE Crew Heist wired to CartridgeFi Engine.
 */
export async function bootSyndicateTurf(): Promise<CartridgeClient> {
  const cartridge = await CartridgeClient.connect({
    cartridgeSlug: "${slug}",
    partnerId: "first-party-studio",
    mode: "PAPER",
  });

  await CashModal.ensureSessionReady(cartridge, {
    mode: "PAPER_OR_LIVE",
    suggestedEnvelopeUsdc: 25,
  });

  cartridge.onMarketPulse(({ symbol, priceFormatted, volatilitySigmaMilli, isFogEncrypted }) => {
    console.info(
      \`[SYNDICATE TURF] \${symbol} $\${priceFormatted} | sigma=\${volatilitySigmaMilli}m | teeFog=\${isFogEncrypted}\`,
    );
  });

  await cartridge.emitAction("CLAIM_DISTRICT_TURF", {
    districtIndex: 0,
    convictionBps: 7_500,
  });

  return cartridge;
}
`;
  }

  return `import { CartridgeClient, CashModal } from "@cartridgefi/sdk";

/**
 * Borel-Style Game-Day Blind Conviction Arena wired to CartridgeFi Engine.
 * Rival stances remain hardware-encrypted inside MagicBlock Private ER TEE until T-15s Showdown.
 */
export async function bootBorelGamedayArena(): Promise<CartridgeClient> {
  const cartridge = await CartridgeClient.connect({
    cartridgeSlug: "${slug}",
    partnerId: "first-party-studio",
    mode: "PAPER",
  });

  await CashModal.ensureSessionReady(cartridge, {
    mode: "PAPER_OR_LIVE",
    suggestedEnvelopeUsdc: 20,
  });

  cartridge.onMarketPulse(({ symbol, priceFormatted, phase, isFogEncrypted }) => {
    console.info(
      \`[BOREL ARENA] \${symbol} $\${priceFormatted} | phase=\${phase} | fogSealed=\${isFogEncrypted}\`,
    );
  });

  await cartridge.emitAction("SUBMIT_CONVICTION_WEIGHTS", {
    weightsBps: [5_000, 3_500, 1_500, 0],
    kalshiBinaryCall: 2,
    kalshiProbBps: 6_500,
  });

  return cartridge;
}
`;
}

export function buildTemplateProject(params: {
  projectName: string;
  template: CliTemplateName;
  creatorWallet?: string;
}): ScaffoldedProjectFiles {
  const slug = sanitizeSlug(params.projectName);
  const baseManifest =
    params.template === "phaser-volatility-runner"
      ? PULSE_RUNNER_MANIFEST
      : params.template === "threejs-syndicate-turf"
        ? VICE_BOURSE_MANIFEST
        : BOREL_GAMEDAY_MANIFEST;

  const creatorWallet =
    params.creatorWallet?.trim() || CARTRIDGE_DEVNET_AUTHORITIES.deployerAndKeeper;

  const manifest: CartridgeManifestV2 = {
    ...baseManifest,
    metadata: {
      ...baseManifest.metadata,
      slug,
      creatorWallet,
      creatorFeeShareBps: 5_000,
    },
  };

  const packageJson = {
    name: slug,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      simulate: "cartridgefi simulate ./cartridge.manifest.json --regime calm",
      dev: "cartridgefi dev --replay-tape nvda-earnings-nov26 --ticks 20",
      publish: "cartridgefi publish ./cartridge.manifest.json --network devnet",
    },
    dependencies: {
      "@cartridgefi/sdk": "^2.0.0",
    },
  };

  const tsconfigJson = {
    compilerOptions: {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
      outDir: "./dist",
    },
    include: ["src/**/*"],
  };

  const readme = `# ${manifest.metadata.title} (\`${slug}\`)

Built on **CartridgeFi Engine v2.0** (Solana + MagicBlock Private Ephemeral Rollups).
Zero custom custody contracts — 50% net venue builder fees accrue automatically to \`${creatorWallet}\`.

## Audited Engine Program IDs
- **Cartridge Registry**: \`${CARTRIDGE_PROGRAM_IDS.registry}\`
- **Cartridge ER Room**: \`${CARTRIDGE_PROGRAM_IDS.erRoom}\`
- **MagicBlock Delegation**: \`${MAGICBLOCK_CONSTANTS.delegationProgramId}\`
- **Private ER TEE Permission**: \`${MAGICBLOCK_CONSTANTS.permissionProgramId}\`

## Workflow
\`\`\`bash
npx cartridgefi simulate ./cartridge.manifest.json --regime crash_vix35
npx cartridgefi dev --replay-tape nvda-earnings-nov26 --ticks 20
npx cartridgefi publish ./cartridge.manifest.json --network devnet
\`\`\`
`;

  return {
    manifest,
    files: {
      "cartridge.manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
      "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
      "tsconfig.json": `${JSON.stringify(tsconfigJson, null, 2)}\n`,
      "src/game.ts": buildGameSource(params.template, slug),
      "README.md": readme,
    },
  };
}
