import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const ER_ROOM_PROGRAM = "DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W";
const PLATFORM_FEE_ACCOUNT = "6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8";

function attachZeroErrorGuards(page: Page): {
  consoleErrors: string[];
  pageErrors: string[];
  dialogsOpened: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const dialogsOpened: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
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

async function expectCleanPage(
  page: Page,
  guards: ReturnType<typeof attachZeroErrorGuards>,
): Promise<void> {
  const overflowPx = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflowPx).toBeLessThanOrEqual(2);
  expect(guards.consoleErrors).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
  expect(guards.dialogsOpened).toEqual([]);
}

test.describe("Borel — sealed-conviction live market showdowns", () => {
  test("1. Paper room: draft a sealed 3-leg hand, sweat the ladder, pivot once, unseal at showdown", async ({
    page,
  }, testInfo) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Borel");

    // First visit opens the rules; it can be dismissed and reopened from the header.
    await expect(page.locator("#borel-howto")).toBeVisible({ timeout: 15_000 });
    await page.locator("#borel-howto-start").click();
    await expect(page.locator("#borel-howto")).toHaveCount(0);
    await page.locator("#borel-howto-open").click();
    await expect(page.locator("#borel-howto")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#borel-howto")).toHaveCount(0);
    await expect(page.locator("#borel-phase-guide")).toContainText("Build your hand");

    await expect(page.locator("#borel-stake-paper")).toBeVisible();
    // The seal button enables once the table has hydrated and live Pyth prices have arrived.
    const seal = page.locator("#borel-seal-btn");
    await expect(seal).toBeEnabled({ timeout: 30_000 });

    // Draft: three distinct live crypto markets with the 1x / 2x / 3x cards assigned once each.
    await page.locator("#borel-leg-0-market-sol").click();
    await page.locator("#borel-leg-1-market-btc").click();
    await page.locator("#borel-leg-2-market-eth").click();
    await page.locator("#borel-leg-0-card-3").click();
    await page.locator("#borel-leg-1-card-2").click();
    await page.locator("#borel-leg-2-card-1").click();
    await page.locator("#borel-leg-0-long").click();
    await page.locator("#borel-leg-1-long").click();
    await page.locator("#borel-leg-2-short").click();

    await expect(seal).toBeEnabled();
    await seal.click();

    // Sealing publishes only a sha256 commitment of the hand (rendered truncated).
    await expect(page.locator("#borel-commitment")).toContainText(/[0-9a-f]{10}…[0-9a-f]{10}/);
    await expect(page.locator("#borel-ladder")).toBeVisible();
    await expect(page.locator("#borel-ladder-you")).toBeVisible();
    await expect(page.locator("#borel-ladder")).toContainText("hand sealed");

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `01-borel-sealed-${testInfo.project.name}.png`),
      fullPage: false,
    });

    // Exactly one pivot: shield leg 1, then the control is spent.
    await page.locator("#borel-pivot-leg-0").click();
    await page.locator("#borel-pivot-shield-btn").click();
    await expect(page.locator("#borel-pivot-spent")).toBeVisible();
    await expect(page.locator("#borel-pivot-flip-btn")).toHaveCount(0);

    // End the paper round at current prices and unseal every hand.
    await page.locator("#borel-force-showdown-btn").click();
    await expect(page.locator("#borel-showdown")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#borel-phase-guide")).toContainText("Showdown");
    await expect(page.locator("#borel-receipt")).toBeVisible();
    await expect(page.locator("#borel-receipt")).toContainText("Paper round");

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `02-borel-showdown-${testInfo.project.name}.png`),
      fullPage: false,
    });

    await expectCleanPage(page, guards);
  });

  test("2. Devnet room: sealing goes through the relayer and never fabricates a signature", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440x900",
      "The relayer rate-limits joins per IP; one Devnet run per suite.",
    );
    const guards = attachZeroErrorGuards(page);

    const status = await request.get("/api/relayer/status");
    expect(status.ok()).toBe(true);
    const relayer: unknown = await status.json();
    const funded =
      typeof relayer === "object" &&
      relayer !== null &&
      "funded" in relayer &&
      relayer.funded === true;

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#borel-howto-start").click({ timeout: 15_000 });
    const seal = page.locator("#borel-seal-btn");
    await expect(seal).toBeEnabled({ timeout: 30_000 });
    await page.locator("#borel-stake-devnet").click();
    await expect(page.locator("#borel-devnet-badge")).toBeVisible();
    await seal.click();

    if (funded) {
      // A funded relayer must surface real, clickable Solscan devnet links.
      await expect(
        page.locator('#borel-lock-receipts a[href*="solscan.io/tx/"]').first(),
      ).toBeVisible({ timeout: 45_000 });
    } else {
      await expect(page.locator("#borel-unfunded-banner")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('a[href*="solscan.io/tx/"]')).toHaveCount(0);
    }

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `03-borel-devnet-${testInfo.project.name}.png`),
      fullPage: false,
    });

    await expectCleanPage(page, guards);
  });

  test("3. /play/borel serves the same table and cut routes are gone", async ({ page, request }) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/play/borel", { waitUntil: "domcontentloaded" });
    await page.locator("#borel-howto-start").click({ timeout: 15_000 });
    await expect(page.locator("#borel-seal-btn")).toBeVisible();

    for (const removed of ["/play/pulse-runner", "/studio"]) {
      const res = await request.get(removed);
      expect(res.status(), removed).toBe(404);
    }

    await expectCleanPage(page, guards);
  });

  test("4. /protocol inspector shows live program IDs, fee account and proof ledger", async ({
    page,
  }, testInfo) => {
    const guards = attachZeroErrorGuards(page);
    await page.goto("/protocol", { waitUntil: "domcontentloaded" });

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("Protocol Inspector");

    for (const id of [
      ER_ROOM_PROGRAM,
      "Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR",
      "BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc",
      "B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF",
      PLATFORM_FEE_ACCOUNT,
    ]) {
      await expect(page.locator("body")).toContainText(id);
    }

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
      path: join(SCREENSHOT_DIR, `04-protocol-${testInfo.project.name}.png`),
      fullPage: false,
    });

    await expectCleanPage(page, guards);
  });
});
