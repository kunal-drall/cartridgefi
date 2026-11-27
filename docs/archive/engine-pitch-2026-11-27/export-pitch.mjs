#!/usr/bin/env node
// Exports the /pitch deck to 11 PNGs (exactly 1920x1080) and a 16:9 PDF.
//
//   BASE_URL=http://localhost:3100 node scripts/export-pitch.mjs
//
// Outputs:
//   docs/pitch/slide-01.png … slide-11.png
//   docs/CARTRIDGEFI_PITCH_DECK.pdf

import { createRequire } from "node:module";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Resolve Playwright from the e2e workspace so the root package needs no extra dependency.
const requireFromE2E = createRequire(join(repoRoot, "tests/e2e/package.json"));
const { chromium } = requireFromE2E("@playwright/test");

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const SLIDE_COUNT = 11;
const WIDTH = 1920;
const HEIGHT = 1080;
const outDir = join(repoRoot, "docs/pitch");
const pdfPath = join(repoRoot, "docs/CARTRIDGEFI_PITCH_DECK.pdf");

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];

try {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });

  const url = `${BASE_URL}/pitch?print=1`;
  console.log(`Loading ${url}`);
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  if (!response || !response.ok()) {
    throw new Error(`GET ${url} failed with status ${response?.status() ?? "no response"}`);
  }

  await page.waitForSelector(`[data-slide="${SLIDE_COUNT}"]`, { timeout: 60_000 });
  // Wait for the live-market strip to resolve (ready or error) so the as-of stamp is captured.
  await page
    .waitForFunction(() => {
      const el = document.querySelector("[data-live-state]");
      return el !== null && el.getAttribute("data-live-state") !== "loading";
    }, null, { timeout: 30_000 })
    .catch(() => console.warn("Live market strip did not resolve within 30s; exporting without it."));
  // Hide the Next.js dev-mode indicator when exporting from a dev server.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const fontsOk = await page.evaluate(() => document.fonts.check('700 76px "Plus Jakarta Sans"'));
  if (!fontsOk) console.warn("Warning: Plus Jakarta Sans not loaded; falling back to Inter.");

  const liveState = await page.getAttribute("[data-live-state]", "data-live-state").catch(() => null);
  console.log(`Live market strip: ${liveState ?? "absent"}`);

  for (let i = 1; i <= SLIDE_COUNT; i += 1) {
    const locator = page.locator(`[data-slide="${i}"]`);
    const box = await locator.boundingBox();
    if (!box || Math.round(box.width) !== WIDTH || Math.round(box.height) !== HEIGHT) {
      throw new Error(`Slide ${i} is ${box?.width}x${box?.height}, expected ${WIDTH}x${HEIGHT}`);
    }
    const file = join(outDir, `slide-${String(i).padStart(2, "0")}.png`);
    await locator.screenshot({ path: file, animations: "disabled" });
    console.log(`  ✓ ${file}`);
  }

  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdfPath,
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  const { size } = await stat(pdfPath);
  console.log(`  ✓ ${pdfPath} (${(size / 1024).toFixed(0)} KiB)`);

  await context.close();
} finally {
  await browser.close();
}

if (errors.length > 0) {
  console.warn(`\n${errors.length} browser error(s) during export:`);
  for (const e of errors) console.warn(`  - ${e}`);
}
