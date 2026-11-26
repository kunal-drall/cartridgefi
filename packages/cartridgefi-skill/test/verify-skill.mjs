import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1. Verify SKILL.md YAML frontmatter and 4 Core Directives
const skillPath = path.join(pkgRoot, "SKILL.md");
assert.ok(existsSync(skillPath), "SKILL.md must exist");
const skillRaw = readFileSync(skillPath, "utf8");
assert.match(skillRaw, /^---\n[\s\S]+?\n---\n/, "SKILL.md must start with YAML frontmatter");
assert.ok(skillRaw.includes("name: cartridgefi"), "SKILL.md frontmatter must declare name: cartridgefi");
assert.ok(skillRaw.includes("license: MIT"), "SKILL.md frontmatter must declare license: MIT");
assert.ok(skillRaw.includes('version: "2.0.0"'), "SKILL.md metadata must declare version 2.0.0");
assert.ok(skillRaw.includes("Never Generate Custom Custody Contracts"), "Directive 1 missing");
assert.ok(skillRaw.includes("60fps Render Loop Separation"), "Directive 2 missing");
assert.ok(skillRaw.includes("Mandatory Market-Driven World Physics"), "Directive 3 missing");
assert.ok(skillRaw.includes("Automatic 50% Creator Revenue Attribution"), "Directive 4 missing");

// 2. Verify all 5 reference guides exist and have rich content
const requiredRefs = [
  "01-borel-gameday-arena.md",
  "02-arcade-runner-phaser.md",
  "03-openworld-syndicate-3d.md",
  "04-omnichain-fiat-auth.md",
  "05-compliance-hard-rules.md",
];
for (const refFile of requiredRefs) {
  const fullRef = path.join(pkgRoot, "references", refFile);
  assert.ok(existsSync(fullRef), `Missing reference guide: ${refFile}`);
  const content = readFileSync(fullRef, "utf8");
  assert.ok(content.length > 300, `Reference guide ${refFile} is unexpectedly short`);
}

// 3. Verify all 3 manifest templates are valid v2.0 compliant JSON
const requiredTemplates = [
  "manifest.gameday.json",
  "manifest.runner.json",
  "manifest.syndicate.json",
];
for (const tplFile of requiredTemplates) {
  const fullTpl = path.join(pkgRoot, "templates", tplFile);
  assert.ok(existsSync(fullTpl), `Missing manifest template: ${tplFile}`);
  const parsed = JSON.parse(readFileSync(fullTpl, "utf8"));
  assert.equal(parsed.manifestVersion, "2.0.0", `${tplFile} must be manifestVersion 2.0.0`);
  assert.ok(parsed.metadata.creatorFeeShareBps <= 5000, `${tplFile} creatorFeeShareBps must be <= 5000`);
  assert.ok(
    parsed.onboardingAndSession.liveSessionEnvelopeUsdc.maxLeverage <= 5,
    `${tplFile} maxLeverage must be <= 5`,
  );
  assert.ok(
    parsed.magicblockRoomConfig.showdownUnsealSecs < parsed.magicblockRoomConfig.durationSecs,
    `${tplFile} showdownUnsealSecs must be < durationSecs`,
  );
  assert.ok(
    Array.isArray(parsed.scoringAndPrizes.claimMenuAssets) &&
      parsed.scoringAndPrizes.claimMenuAssets.includes("USDC"),
    `${tplFile} claimMenuAssets must include USDC`,
  );
}

console.log("✔ @cartridgefi/skill verified: SKILL.md, 5 reference guides, and 3 manifest v2.0 templates passed.");
