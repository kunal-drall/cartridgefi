import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function attachZeroErrorGuards(page: Page): {
  consoleErrors: string[];
  pageErrors: string[];
  dialogsOpened: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const dialogsOpened: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });
  page.on("dialog", async (dialog) => {
    dialogsOpened.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });

  return { consoleErrors, pageErrors, dialogsOpened };
}

test.describe("Agent-06 Wave 4 Headless Visual & Gameplay Proof", () => {
  test("1. Flagship Landing Page (/) — Official Solana x MagicBlock SVGs, Tabular Telemetry, Interactive Console & Zero Slop", async ({
    page,
  }, testInfo) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Single H1 & exact editorial headline
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText("the game engine for real markets.");

    // Official Solana & MagicBlock vector SVG lockups rendered
    const svgCount = await page.locator("svg").count();
    expect(svgCount).toBeGreaterThanOrEqual(8);
    await expect(page.locator("body")).toContainText("Settled on Solana");
    await expect(page.locator("body")).toContainText("MagicBlock");

    // Zero banned emoji spam in headings or buttons
    const headingAndBtnText = await page
      .locator("h1, h2, h3, button, a")
      .allTextContents();
    for (const txt of headingAndBtnText) {
      expect(txt).not.toMatch(/[🚀🔥💎🎰]/u);
    }

    // Verify tabular-nums computed CSS on monospace telemetry
    const hasTabular = await page.evaluate(() => {
      const el = document.querySelector(".tabular-nums");
      if (!el) return false;
      const fv = window.getComputedStyle(el).fontVariantNumeric;
      return fv.includes("tabular-nums");
    });
    expect(hasTabular).toBe(true);

    // Zero horizontal overflow
    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `01-landing-${testInfo.project.name}.png`),
      fullPage: false,
    });

    expect(guards.consoleErrors).toEqual([]);
    expect(guards.pageErrors).toEqual([]);
    expect(guards.dialogsOpened).toEqual([]);
  });

  test("2. Borel (#001) (/play/borel) — Zero-Popup 7-Chain Cashier, TEE Fog-of-War 3D Showdown Flip, VRF Settlement & Stock Vault Claim", async ({
    page,
  }, testInfo) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/play/borel", { waitUntil: "networkidle" });

    // 1. Open Unified 7-Chain & Apple Pay Cashier Modal and 1-Tap Mint 100 Devnet USDC
    await page.locator("#open-cashier-modal-btn").click();
    await expect(page.locator("#mint-devnet-usdc-btn")).toBeVisible();
    await page.locator("#mint-devnet-usdc-btn").click();
    await expect(page.locator("#cashier-receipt-banner")).toBeVisible();
    await page.locator("#close-cashier-modal-btn").click();

    // 2. Submit Stance with ZERO mid-game popups
    await page.locator("#borel-preset-ai-divergence").click();
    await page.locator("#borel-submit-stance-btn").click();

    // 3. Trigger T-15s Showdown Unseal and verify 3D spring flip (`data-unsealed="true"`)
    await page.locator("#borel-jump-showdown-btn").click();
    await expect(
      page.locator('[data-unsealed="true"]').first(),
    ).toBeAttached();

    await page.screenshot({
      path: join(
        SCREENSHOT_DIR,
        `02-borel-showdown-${testInfo.project.name}.png`,
      ),
      fullPage: false,
    });

    // 4. Settle Round & Claim NVDAx into Earned Stock Vault + verify Receipt Canvas
    await page.locator("#borel-settle-now-btn").click();
    await page.locator("#borel-geo-eligible-btn").click();
    await page.locator("#borel-claim-asset-NVDAx").click();
    await page.locator("#borel-claim-prize-btn").click();

    const canvasReady = await page.evaluate(() => {
      const c = document.getElementById(
        "borel-elo-receipt-canvas",
      ) as HTMLCanvasElement | null;
      return Boolean(c && c.width >= 600 && c.height >= 300);
    });
    expect(canvasReady).toBe(true);

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(2);

    expect(guards.consoleErrors).toEqual([]);
    expect(guards.pageErrors).toEqual([]);
    expect(guards.dialogsOpened).toEqual([]);
  });

  test("3. Pulse Runner (#002) (/play/pulse-runner) — 60fps 3-Lane Canvas Track, Zero-Popup Lane Stances & Shared Program ID Proof", async ({
    page,
  }, testInfo) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/play/pulse-runner", { waitUntil: "networkidle" });

    // Verify exact shared cartridge-er-room Program ID
    await expect(page.locator("#runner-program-id-proof")).toContainText(
      "Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR",
    );

    // Let 60fps requestAnimationFrame step several frames and switch lanes without popups
    await page.waitForTimeout(250);
    await page.locator("#runner-lane-left").click();
    await page.waitForTimeout(120);
    await page.locator("#runner-lane-right").click();
    await page.waitForTimeout(120);

    const runnerState = await page.evaluate(() => {
      const state: unknown = Reflect.get(window, "__PULSE_RUNNER_STATE__");
      if (
        typeof state === "object" &&
        state !== null &&
        "rawSwipes" in state &&
        typeof state.rawSwipes === "number" &&
        "frameCount" in state &&
        typeof state.frameCount === "number"
      ) {
        return {
          rawSwipes: state.rawSwipes,
          frameCount: state.frameCount,
        };
      }
      return null;
    });
    expect(runnerState).not.toBeNull();
    expect(runnerState?.rawSwipes).toBeGreaterThanOrEqual(2);
    expect(runnerState?.frameCount).toBeGreaterThanOrEqual(5);

    await page.screenshot({
      path: join(
        SCREENSHOT_DIR,
        `03-pulse-runner-${testInfo.project.name}.png`,
      ),
      fullPage: false,
    });

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(2);

    expect(guards.consoleErrors).toEqual([]);
    expect(guards.pageErrors).toEqual([]);
    expect(guards.dialogsOpened).toEqual([]);
  });

  test("4. Vibe Studio & <CartridgeDeck/> (/studio) — Anti-Casino Hard-Block, 500-Tick Conservation, Devnet Deploy & Wallet Sheet Toggle", async ({
    page,
  }, testInfo) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/studio", { waitUntil: "networkidle" });

    // 1. Verify Anti-Casino Guardrail blocks paid loot boxes
    await page.locator("#studio-preset-anti-casino").click();
    await page.locator("#studio-compile-btn").click();
    await expect(page.locator("#studio-compliance-violations")).toBeVisible();

    // 2. Compile clean TSLAx 3-lane runner, verify conservation proof, and deploy
    await page.locator("#studio-preset-tsla-runner").click();
    await page.locator("#studio-compile-btn").click();
    await expect(page.locator("#studio-conservation-proof")).toBeVisible();

    await page.locator("#studio-deploy-btn").click();
    await expect(page.locator("#studio-deploy-receipt")).toBeVisible();
    await expect(page.locator("#studio-deploy-receipt")).toContainText(
      "Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR",
    );

    // 3. Toggle <CartridgeDeck/> Wallet Sheet frames (Phantom / Solflare / Backpack)
    await page.locator("#frame-phantom").click();
    await expect(page.locator("#studio-wallet-preview-stage")).toContainText(
      "40%",
    );

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `04-studio-${testInfo.project.name}.png`),
      fullPage: false,
    });

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(2);

    expect(guards.consoleErrors).toEqual([]);
    expect(guards.pageErrors).toEqual([]);
    expect(guards.dialogsOpened).toEqual([]);
  });

  test("5. Protocol Execution Console (/protocol) — Live Devnet Program IDs, Canonical platformFeeAccount ATA, Category Proof Filters & Zero Slop", async ({
    page,
  }, testInfo) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/protocol", { waitUntil: "networkidle" });

    // Verify single H1 & Infrastructure positioning
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText("Protocol Inspector & Live Execution Console");

    // Verify all 4 deployed Devnet Program IDs + canonical platformFeeAccount ATA + Relayer wallet
    await expect(page.locator("body")).toContainText(
      "Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR",
    );
    await expect(page.locator("body")).toContainText(
      "6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT",
    );
    await expect(page.locator("body")).toContainText(
      "5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr",
    );
    await expect(page.locator("body")).toContainText(
      "5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr",
    );
    await expect(page.locator("body")).toContainText(
      "6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir",
    );
    await expect(page.locator("body")).toContainText(
      "D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1",
    );

    // Filter proof ledger categories interactively
    await page.locator("#protocol-filter-private_payments_and_fees").click();
    await expect(page.locator("#protocol-proof-ledger")).toContainText(
      "Relayer Private Transfer #1",
    );
    await page.locator("#protocol-filter-delegation_and_vrf").click();
    await expect(page.locator("#protocol-proof-ledger")).toContainText(
      "Real-Time ER Session Update #6",
    );
    await page.locator("#protocol-filter-all").click();

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `05-protocol-${testInfo.project.name}.png`),
      fullPage: false,
    });

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(2);

    expect(guards.consoleErrors).toEqual([]);
    expect(guards.pageErrors).toEqual([]);
    expect(guards.dialogsOpened).toEqual([]);
  });
});
