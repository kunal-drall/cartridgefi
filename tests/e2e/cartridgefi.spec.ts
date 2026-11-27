import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const ER_ROOM_PROGRAM = "DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W";
const PLATFORM_FEE_ACCOUNT = "6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const isMobileProject = (testInfo: TestInfo): boolean => testInfo.project.name.startsWith("mobile");

/** A context matching the project, with a real mobile user agent on the mobile project. */
async function projectPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const mobile = isMobileProject(testInfo);
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    ...(mobile ? { userAgent: IPHONE_UA } : {}),
  });
  return context.newPage();
}

/** A per-run documentation-range IP so limiter tests never share counters with other tests or retries. */
function testClientIp(range: "198.51.100" | "203.0.113" = "198.51.100"): string {
  return `${range}.${1 + Math.floor(Math.random() * 254)}`;
}

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
      // A funded relayer must surface real, clickable Solscan links, unless the server honestly refuses
      // the seat: the per-network seat cap (repeated runs from one IP within a room window) or a closed
      // lobby. A refusal must never come with a transaction link.
      const txLink = page.locator('#borel-lock-receipts a[href*="solscan.io/tx/"]').first();
      const refusal = page.locator("#borel-lock-receipts", {
        hasText: /already holds \d+ seats in this room|Room lobby is closed/,
      });
      await expect(txLink.or(refusal)).toBeVisible({ timeout: 60_000 });
      if (!(await txLink.isVisible())) {
        await expect(page.locator('#borel-lock-receipts a[href*="solscan.io/tx/"]')).toHaveCount(0);
      }
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

  test("5. Wallet connect sheet opens and closes cleanly; mobile offers wallet-app deep links", async ({
    browser,
  }, testInfo) => {
    const page = await projectPage(browser, testInfo);
    const guards = attachZeroErrorGuards(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#borel-howto-start").click({ timeout: 15_000 });

    const trigger = page.locator("#wallet-connect-btn");
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    // Headless Chromium has no wallet extension: the trigger settles on "Connect" once mounted.
    await expect(trigger).toContainText("Connect", { timeout: 15_000 });

    const backdrop = page.locator("#wallet-panel-backdrop");
    const sheet = page.getByRole("dialog", { name: "Connect a Solana wallet" });
    await trigger.click();
    await expect(sheet).toBeVisible();
    await expect(page.locator("#wallet-panel-close-btn")).toBeFocused();
    await expect(page.locator("#wallet-none-detected")).toBeVisible();

    const walletApps = sheet.getByRole("link", { name: /^Open in / });
    if (isMobileProject(testInfo)) {
      await expect(walletApps).toHaveCount(3);
      const phantom = sheet.getByRole("link", { name: "Open in Phantom" });
      const href = (await phantom.getAttribute("href")) ?? "";
      expect(href).toMatch(/^https:\/\/phantom\.app\/ul\/browse\/[^?]+\?ref=/);
      // The deep link reopens exactly this page inside Phantom's in-app browser.
      const target = decodeURIComponent(href.slice("https://phantom.app/ul/browse/".length).split("?")[0] ?? "");
      expect(target).toBe(page.url());
      expect(decodeURIComponent(href.split("?ref=")[1] ?? "")).toBe(new URL(page.url()).origin);
      await expect(sheet.getByRole("link", { name: "Open in Solflare" })).toHaveAttribute(
        "href",
        /^https:\/\/solflare\.com\/ul\/v1\/browse\//,
      );
      await expect(sheet.getByRole("link", { name: "Open in Backpack" })).toHaveAttribute(
        "href",
        /^https:\/\/backpack\.app\/ul\/v1\/browse\//,
      );
    } else {
      await expect(walletApps).toHaveCount(0);
    }

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `05-wallet-sheet-${testInfo.project.name}.png`),
      fullPage: false,
    });

    // Close three ways: the close button, Escape, and a click on the backdrop.
    await page.locator("#wallet-panel-close-btn").click();
    await expect(backdrop).toHaveCount(0);
    await trigger.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(backdrop).toHaveCount(0);
    await trigger.click();
    await expect(sheet).toBeVisible();
    await backdrop.click({ position: { x: 8, y: 8 } });
    await expect(backdrop).toHaveCount(0);

    await expectCleanPage(page, guards);
    await page.context().close();
  });

  test("6. /api/borel/faucet rejects malformed wallet addresses with 400 before any relayer work", async ({
    request,
  }) => {
    const status = await request.get("/api/relayer/status");
    const relayer = (await status.json()) as { configured?: boolean };
    test.skip(relayer.configured !== true, "Faucet answers 503 before validation when no relayer is configured.");

    const headers = { "x-forwarded-for": testClientIp() };
    for (const wallet of ["not-a-wallet", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", "1".repeat(45), "", 42]) {
      const res = await request.post("/api/borel/faucet", { data: { wallet }, headers });
      expect(res.status(), JSON.stringify(wallet)).toBe(400);
      const body = (await res.json()) as { status?: string; reason?: string; signature?: string };
      expect(body.status).toBe("error");
      expect(body.reason ?? "").toContain("wallet");
      expect(body.signature).toBeUndefined();
    }
    const missing = await request.post("/api/borel/faucet", {
      data: "not json",
      headers: { ...headers, "content-type": "application/json" },
    });
    expect(missing.status()).toBe(400);
  });

  test("7. Read APIs carry RateLimit headers and answer 429 with Retry-After when over budget", async ({
    request,
  }, testInfo) => {
    const ip = testClientIp();
    const routes: Array<[string, number]> = [
      ["/api/pyth/latest", 120],
      ["/api/relayer/status", 120],
      ["/api/protocol/fee-inflows", 120],
      ["/api/protocol-telemetry", 120],
      ["/api/borel/room?roomId=BLITZ_3M-PAPER-1", 120],
    ];
    for (const [path, limit] of routes) {
      const res = await request.get(path, { headers: { "x-forwarded-for": ip } });
      expect(res.status(), path).toBeLessThan(500);
      const h = res.headers();
      expect(h["ratelimit-limit"], path).toBe(String(limit));
      expect(h["ratelimit-policy"], path).toBe(`${limit};w=60`);
      // Exact counts are not asserted: other clients behind the same key may share the window.
      const remaining = Number(h["ratelimit-remaining"]);
      expect(Number.isInteger(remaining), path).toBe(true);
      expect(remaining, path).toBeGreaterThanOrEqual(0);
      expect(remaining, path).toBeLessThan(limit);
      expect(Number(h["ratelimit-reset"]), path).toBeGreaterThan(0);
    }

    // The SSE stream reports its own budget; abort right after the headers arrive.
    const baseURL = testInfo.project.use.baseURL ?? "http://127.0.0.1:3100";
    const abort = new AbortController();
    const stream = await fetch(`${baseURL}/api/pyth/stream?markets=SOL/USD`, {
      headers: { "x-forwarded-for": ip },
      signal: abort.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("ratelimit-policy")).toBe("60;w=60");
    abort.abort();

    // Exhaust the fee-inflows budget (served from its 30 s cache) from a fresh IP: request 121 is refused.
    // Only meaningful locally: Vercel overwrites x-forwarded-for, so on a deployment every request counts
    // against the runner's real IP and the "fresh IP" premise does not hold.
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseURL)) return;
    const flood = testClientIp("203.0.113");
    for (let i = 0; i < 120; i += 1) {
      const ok = await request.get("/api/protocol/fee-inflows", { headers: { "x-forwarded-for": flood } });
      expect(ok.status()).toBe(200);
    }
    const limited = await request.get("/api/protocol/fee-inflows", { headers: { "x-forwarded-for": flood } });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers()["ratelimit-remaining"]).toBe("0");
    const body = (await limited.json()) as { status?: string; ok?: boolean; error?: string };
    expect(body).toMatchObject({ status: "error", ok: false, error: "rate_limited" });
  });
});
