#!/usr/bin/env node
// Borel founder video: Playwright clip recorder.
//
// Records the demo clips that the Remotion composition consumes:
//   A  1920x1080  Paper room: how-to-play, draft, seal, live ladder, pivot, showdown, receipt (S4)
//   B  1920x1080  Devnet room: seal, the real Solscan link in the lock receipt, then that tx on Solana Explorer (S6)
//   C  1920x1080  /protocol on-chain inspector, scrolled (S6)
//   D  1920x1080  A real transaction from docs/DEVNET_PROOF.md (2026-11-27 own-authority run) on Solana Explorer (S6)
//   M   390x844   Mobile Paper room, compressed walkthrough (S4 cutaway)
//
// Writes <OUT_DIR>/<clip>.webm plus <OUT_DIR>/manifest.json:
//   [{ clip, file, durationSec, description, readyAtSec, url, steps, missing, ... }]
// durationSec is the measured video length; readyAtSec and `steps` are on the video's timeline
// (seconds from the first frame), so the edit can sync actions to the narration.
//
//   node video/scripts/record-clips.mjs                         # all clips -> video/public/clips
//   CLIPS=A,M node video/scripts/record-clips.mjs               # subset (merges into an existing manifest)
//   OUT_DIR=/tmp/dry BASE_URL=https://... node video/scripts/record-clips.mjs
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const require = createRequire('/Volumes/T7/cartridgefi/tests/e2e/package.json');
const { chromium } = require('@playwright/test');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(process.env.OUT_DIR || resolve(HERE, '../public/clips'));
const BASE_URL = (process.env.BASE_URL || 'https://cartridgefi.vercel.app').replace(/\/$/, '');
const ONLY = (process.env.CLIPS || 'A,B,C,D,M').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const SCRATCH = process.env.REC_SCRATCH || join(tmpdir(), 'borel-rec');

// Real transactions from docs/DEVNET_PROOF.md, "Borel live run (own authority) — 2026-11-27T12:03:00.743Z".
// Solscan serves a bot check to automated browsers, so the recorder opens the same signatures on the
// official Solana Explorer (explorer.solana.com), which renders devnet and custom-RPC (MagicBlock ER) txs.
const ER_RPC = 'https://devnet-us.magicblock.app';
const PROOF_TXS = [
  {
    label: 'settle: winner payout + 1% fee into platformFeeAccount on Solana devnet',
    sig: '2oTzABoin7Y48HKxMAneuuGeffB5cAFooiGMEmkiWaiZQbjdohh6FUJYdgKgt56L9Lziq1hreooqZRQsUNnShPKi',
    rpc: null,
  },
  {
    label: 'request_settlement_vrf (MagicBlock VRF) on the MagicBlock ER',
    sig: '4qbDtCvah367v5HiE95jcmWSP3fwwrXjfXX3Ut4UFhKVuoDTMj2apZVRgems6S5pkDk2pGsTnTCrFACH2dZSVNRw',
    rpc: ER_RPC,
  },
];
if (process.env.D_SIG) PROOF_TXS.unshift({ label: 'D_SIG override', sig: process.env.D_SIG, rpc: process.env.D_RPC || null });
const explorerTx = (sig, rpc) =>
  `https://explorer.solana.com/tx/${sig}?` + (rpc ? `cluster=custom&customUrl=${encodeURIComponent(rpc)}` : 'cluster=devnet');
const solscanTx = (sig, rpc) =>
  `https://solscan.io/tx/${sig}?` + (rpc ? `cluster=custom&customUrl=${encodeURIComponent(rpc)}` : 'cluster=devnet');
// Standard mobile emulation UA so the site serves its phone layout in the 390x844 clip.
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

mkdirSync(OUT_DIR, { recursive: true });
let SCRATCH_DIR = SCRATCH;
try { mkdirSync(SCRATCH_DIR, { recursive: true }); } catch { SCRATCH_DIR = mkdtempSync(join(tmpdir(), 'borel-rec-')); }

// Visible cursor + click ripple (headless recordings have no OS cursor); hides the Next.js dev badge.
const initScript = (w, h, size) => `(() => {
  const install = () => {
    if (document.getElementById('__cf_cursor')) return;
    const s = ${size};
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal{display:none!important}' +
      '#__cf_cursor{position:fixed;left:0;top:0;width:' + s + 'px;height:' + s + 'px;margin:-' + (s / 2) + 'px 0 0 -' + (s / 2) + 'px;border-radius:50%;' +
      'background:rgba(255,255,255,0.16);border:2px solid rgba(255,255,255,0.92);box-shadow:0 0 0 1px rgba(0,0,0,0.5),0 4px 14px rgba(0,0,0,0.45);' +
      'pointer-events:none;z-index:2147483647;transition:transform 120ms ease,background 120ms ease;will-change:transform}' +
      '#__cf_cursor.down{transform:scale(0.78);background:rgba(96,165,250,0.45)}' +
      '.__cf_ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid rgba(96,165,250,0.9);' +
      'pointer-events:none;z-index:2147483646;animation:__cfr 520ms ease-out forwards}' +
      '@keyframes __cfr{from{transform:scale(0.3);opacity:1}to{transform:scale(1.6);opacity:0}}';
    document.documentElement.appendChild(style);
    const c = document.createElement('div');
    c.id = '__cf_cursor';
    c.style.left = (window.__cfX || ${w / 2}) + 'px';
    c.style.top = (window.__cfY || ${h / 2}) + 'px';
    document.documentElement.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; window.__cfX = e.clientX; window.__cfY = e.clientY; }, true);
    window.addEventListener('mousedown', (e) => {
      c.classList.add('down');
      const r = document.createElement('div'); r.className = '__cf_ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
    window.addEventListener('mouseup', () => c.classList.remove('down'), true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

// Remotion's bundled ffprobe (there is no system ffmpeg): measures the real video length.
const COMPOSITOR = resolve(HERE, '../node_modules/@remotion/compositor-darwin-arm64');
function videoDurationSec(file) {
  try {
    const out = execFileSync(join(COMPOSITOR, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      env: { ...process.env, DYLD_LIBRARY_PATH: COMPOSITOR },
      encoding: 'utf8',
    });
    const d = Number.parseFloat(out.trim());
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

function makeRecorder(page, t0, log, W, H) {
  const missing = [];
  const steps = [];
  let mouse = { x: W / 2, y: H / 2 };
  const since = () => +((Date.now() - t0) / 1000).toFixed(2);
  const mark = (label) => steps.push(`${since()}s ${label}`);

  async function moveTo(x, y, ms = 650) {
    // Time-based easing keeps pacing true to the wall clock regardless of CDP latency.
    const sx = mouse.x;
    const sy = mouse.y;
    const start = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
      await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      if (t >= 1) break;
      await sleep(12);
    }
    mouse = { x, y };
  }

  // One in-page round trip per lookup: CDP calls are slow under SwiftShader + screencast, and
  // waitFor + scrollIntoViewIfNeeded + boundingBox cost ~1s per element. Off-screen targets get a
  // smooth in-page scroll (reads as a human scroll on camera) and a second measurement.
  const measure = (el, timeout) =>
    el.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const inView = r.top >= 56 && r.bottom <= window.innerHeight - 40;
      return { x: r.x, y: r.y, width: r.width, height: r.height, inView, disabled: !!e.disabled };
    }, null, { timeout });

  async function box(locator, timeout = 3000) {
    const el = locator.first();
    let b = await measure(el, timeout);
    if (!b.inView && b.width > 0) {
      await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }), null, { timeout });
      await sleep(750);
      b = await measure(el, timeout);
    }
    if (!(b.width > 0 && b.height > 0)) throw new Error('not visible');
    return b;
  }

  /** Idle (with cursor drift) until `sec` seconds after the clip's ready mark; no-op when already late. */
  async function until(sec) {
    const target = (ready + sec) * 1000 + t0;
    if (Date.now() < target - 120) await idle(target - Date.now());
  }
  let ready = 0;
  const setReady = (sec) => { ready = sec; };

  async function hover(locator, label, { timeout = 3000, moveMs = 650 } = {}) {
    try {
      const b = await box(locator, timeout);
      await moveTo(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), moveMs);
      mark(`hover ${label}`);
      return true;
    } catch {
      missing.push(`hover:${label}`);
      return false;
    }
  }

  async function click(locator, label, { pauseAfter = [600, 1000], timeout = 3000, moveMs = 600 } = {}) {
    try {
      const b = await box(locator, timeout);
      if (b.disabled) throw new Error('disabled');
      await moveTo(b.x + b.width / 2, b.y + b.height / 2, moveMs);
      await sleep(jitter(120, 240));
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      mark(`click ${label}`);
      await sleep(jitter(pauseAfter[0], pauseAfter[1]));
      return true;
    } catch (err) {
      missing.push(`click:${label}${err && err.message === 'disabled' ? ' (disabled)' : ''}`);
      log(`  - missing ${label}`);
      return false;
    }
  }

  async function scroll(dy, ms = 1400) {
    const start = Date.now();
    let done = 0;
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const delta = dy * e - done;
      if (Math.abs(delta) >= 1) { await page.mouse.wheel(0, delta); done += delta; }
      if (t >= 1) break;
      await sleep(30);
    }
    mark(`scroll ${Math.round(dy)}`);
  }

  async function scrollTop(ms = 1200) {
    const y = await page.evaluate(() => window.scrollY).catch(() => 0);
    if (y > 0) await scroll(-y - 40, ms);
  }

  async function idle(ms) {
    // Gentle drift so the frame never looks frozen.
    const end = Date.now() + ms;
    while (Date.now() < end - 80) {
      const seg = Math.min(end - Date.now(), jitter(1100, 1800));
      await moveTo(
        Math.min(W - 30, Math.max(30, mouse.x + jitter(-50, 50))),
        Math.min(H - 30, Math.max(60, mouse.y + jitter(-35, 35))),
        Math.max(seg, 16),
      );
    }
  }

  return { missing, steps, since, mark, moveTo, hover, click, scroll, scrollTop, idle, until, setReady };
}

async function waitReady(page, extra = 1200) {
  try { await page.waitForLoadState('load', { timeout: 30000 }); } catch {}
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await sleep(extra);
}

async function dismissOverlay(page, rec) {
  const hasOverlay = await page.evaluate(() => {
    const p = document.querySelector('nextjs-portal');
    return !!(p && p.shadowRoot && p.shadowRoot.querySelector('[data-nextjs-dialog], [data-nextjs-dialog-overlay]'));
  }).catch(() => false);
  if (hasOverlay) {
    rec.missing.push('nextjs-error-overlay (Escape pressed)');
    await page.keyboard.press('Escape').catch(() => {});
  }
}

const $ = (page, sel) => page.locator(sel);

/** Close the first-visit rules screen if it is open (tolerates its absence). */
async function closeHowTo(page, rec, opts) {
  const open = await $(page, '#borel-howto').first().isVisible().catch(() => false);
  if (open) await rec.click($(page, '#borel-howto-start'), 'how-to-play: Start playing', opts);
}

/** Draft SOL long 3x, BTC short 1x, ETH long 2x; narrated order is markets, then calls, then cards. */
async function draftHand(page, rec, { fast = false } = {}) {
  const p = fast ? { pauseAfter: [260, 420], moveMs: 420 } : { pauseAfter: [550, 900] };
  const hand = [
    { market: 'sol', dir: 'long', card: 3 },
    { market: 'btc', dir: 'short', card: 1 },
    { market: 'eth', dir: 'long', card: 2 },
  ];
  for (const [i, leg] of hand.entries()) {
    await rec.click($(page, `#borel-leg-${i}-market-${leg.market}`), `leg ${i + 1} market ${leg.market.toUpperCase()}`, p);
  }
  for (const [i, leg] of hand.entries()) {
    await rec.click($(page, `#borel-leg-${i}-${leg.dir}`), `leg ${i + 1} ${leg.dir.toUpperCase()}`, p);
  }
  for (const [i, leg] of hand.entries()) {
    await rec.click($(page, `#borel-leg-${i}-card-${leg.card}`), `leg ${i + 1} card ${leg.card}x${leg.card === 3 ? ' (Sniper)' : ''}`, p);
  }
}

// ---------------------------------------------------------------- clips ----

const DESKTOP = { width: 1920, height: 1080, dsf: 1, cursor: 22, ua: undefined };
const MOBILE = { width: 390, height: 844, dsf: 1, cursor: 18, ua: MOBILE_UA, mobile: true };

const CLIPS = {
  A: {
    path: '/',
    readySelector: '#borel-seal-btn',
    device: DESKTOP,
    minUsable: 60,
    description:
      'Live app, Paper room (1920x1080): six-step how-to-play, draft SOL long 3x / BTC short 1x / ETH long 2x, seal, rank-only live ladder on Pyth prices, one Pivot (Flip), showdown unseal, Unsealed Hand Receipt. Paper mode: nothing is broadcast.',
    // Beats are seconds after the ready mark, timed to the S4 narration (video/public/audio/s4.mp3,
    // ~59 s): start S4 audio at readyAtSec in the edit and the actions land on their lines.
    async run(page, rec) {
      const q = { pauseAfter: [120, 220], moveMs: 380 };
      // "Here's the live app, in a paper room. A first visit opens a six-step how-to-play."
      await rec.until(0.4);
      if (await rec.hover($(page, '#borel-howto'), 'how-to-play panel', { timeout: 8000 })) {
        await rec.until(3.0);
        await rec.hover(page.getByText('Pick 3 markets').first(), 'how-to: pick 3 markets');
        await rec.until(4.5);
        await rec.hover(page.getByText('Showdown at 00:00').first(), 'how-to: showdown');
      }
      await rec.until(5.8);
      await closeHowTo(page, rec, q);
      await rec.click($(page, '#borel-stake-paper'), 'mode Paper', q);
      // "I pick three markets from SOL, BTC, ETH, NVDAx and SPY, and call each one long or short."
      await rec.until(7.0);
      await rec.click($(page, '#borel-leg-0-market-sol'), 'leg 1 market SOL', q);
      await rec.until(7.9);
      await rec.click($(page, '#borel-leg-1-market-btc'), 'leg 2 market BTC', q);
      await rec.until(8.8);
      await rec.click($(page, '#borel-leg-2-market-eth'), 'leg 3 market ETH', q);
      await rec.until(10.4);
      await rec.click($(page, '#borel-leg-0-long'), 'leg 1 LONG', q);
      await rec.until(11.3);
      await rec.click($(page, '#borel-leg-1-short'), 'leg 2 SHORT', q);
      await rec.until(12.2);
      await rec.click($(page, '#borel-leg-2-long'), 'leg 3 LONG', q);
      // "I place my conviction cards: one-x, two-x, and the three-x, my Sniper."
      await rec.until(13.9);
      await rec.click($(page, '#borel-leg-1-card-1'), 'leg 2 card 1x', q);
      await rec.until(15.0);
      await rec.click($(page, '#borel-leg-2-card-2'), 'leg 3 card 2x', q);
      await rec.until(16.3);
      await rec.click($(page, '#borel-leg-0-card-3'), 'leg 1 card 3x (Sniper)', q);
      // "Then I seal, and the three-minute clock starts. Rivals can see that I sealed, never what I picked."
      await rec.until(18.4);
      await rec.click($(page, '#borel-seal-btn'), 'Seal hand', q);
      await rec.until(19.8);
      await rec.hover($(page, '#borel-clock'), 'round clock');
      await rec.until(21.8);
      await rec.hover($(page, '#borel-ladder'), 'face-down rivals', { timeout: 6000 });
      // "No wallet needed, or connect Phantom, Solflare or Backpack and claim test-USDC."
      await rec.until(25.2);
      await rec.hover(
        page.getByRole('button', { name: /connect|wallet|phantom|solflare|backpack/i }).first(),
        'wallet connect',
      );
      // "Six labelled pacer bots take the other seats… ranks only… live Pyth prices."
      await rec.until(29.2);
      await rec.hover($(page, '#borel-ladder').getByText(/Pacer/).first(), 'pacer seat');
      await rec.until(33.6);
      await rec.hover($(page, '#borel-ladder'), 'rank-only ladder');
      // "When I'm slipping, I get one pivot: flip a call, or shield it and bank the move. One tap, no popup."
      await rec.until(39.4);
      await rec.click($(page, '#borel-pivot-leg-1'), 'pivot target leg 2 (BTC)', q);
      await rec.until(41.4);
      await rec.hover($(page, '#borel-pivot-flip-btn'), 'Flip option');
      await rec.until(43.0);
      await rec.hover($(page, '#borel-pivot-shield-btn'), 'Shield option');
      await rec.until(45.0);
      await rec.click($(page, '#borel-pivot-flip-btn'), 'Pivot: Flip', q);
      await rec.until(46.0);
      await rec.hover($(page, '#borel-pivot-spent'), 'pivot spent');
      // "Then the clock hits zero, and every hand turns face-up at once."
      await rec.until(47.4);
      await rec.click($(page, '#borel-force-showdown-btn'), 'Ring the bell (showdown at current prices)', q);
      await rec.until(48.4);
      await rec.hover($(page, '#borel-showdown'), 'showdown unseal', { timeout: 6000 });
      // "Now the whole table sees each call, each card, and where every Sniper was hiding."
      await rec.until(51.4);
      await rec.hover($(page, '#borel-ladder'), 'face-up hands');
      // "The receipt is made for a group chat."
      await rec.until(56.0);
      await rec.hover($(page, '#borel-receipt'), 'Unsealed Hand Receipt', { timeout: 6000 });
      await rec.until(61.5);
    },
  },

  B: {
    path: '/',
    readySelector: '#borel-seal-btn',
    device: DESKTOP,
    minUsable: 24,
    description:
      'Live app, Devnet room (1920x1080): draft and seal; the relayer sends real Solana devnet transactions and the lock receipts show Solscan links, then the same Lock transaction opens on the official Solana Explorer.',
    async run(page, rec, meta) {
      await closeHowTo(page, rec, { pauseAfter: [700, 900] });
      await rec.click($(page, '#borel-stake-devnet'), 'mode Devnet', { pauseAfter: [800, 1100] });
      await rec.hover($(page, '#borel-devnet-badge'), 'Devnet badge');
      await sleep(900);
      await draftHand(page, rec, { fast: true });
      // Seal stays disabled until every leg has a fresh price and the hand validates; give the feed time.
      const seal = $(page, '#borel-seal-btn').first();
      for (let i = 0; i < 20 && (await seal.isDisabled().catch(() => false)); i += 1) await rec.idle(900);
      await rec.click(seal, 'Seal hand (Devnet)', { pauseAfter: [600, 800] });
      const link = $(page, '#borel-lock-receipts a[href*="solscan.io/tx"]');
      try {
        await link.first().waitFor({ state: 'visible', timeout: 45000 });
        rec.mark('devnet receipt link visible');
      } catch {
        const unfunded = await $(page, '#borel-unfunded-banner').first().isVisible().catch(() => false);
        rec.missing.push(unfunded ? 'devnet relayer unfunded: no Solscan link' : 'no Solscan link in lock receipts within 45s');
      }
      await rec.hover($(page, '#borel-lock-receipts'), 'lock receipts');
      await sleep(1200);
      const hrefs = await link.evaluateAll((els) => els.map((a) => a.href)).catch(() => []);
      meta.devnetTxs = hrefs;
      if (hrefs.length) {
        await rec.hover(link.last(), 'Solscan link');
        await sleep(1500);
        meta.solscanUrl = hrefs[hrefs.length - 1];
        const u = new URL(meta.solscanUrl);
        const sig = u.pathname.split('/').pop();
        const rpc = u.searchParams.get('cluster') === 'custom' ? u.searchParams.get('customUrl') : null;
        await openExplorer(page, rec, meta, explorerTx(sig, rpc), 'devnet lock tx (Solana Explorer)');
      } else {
        await rec.hover($(page, '#borel-ladder'), 'ladder');
        await rec.idle(4000);
      }
    },
  },

  C: {
    path: '/protocol',
    readySelector: '#protocol-proof-ledger',
    device: DESKTOP,
    minUsable: 24,
    description:
      '/protocol live on-chain inspector (1920x1080): deployed devnet programs, live RPC probe, then a slow scroll through the Borel proof ledger of real devnet / MagicBlock ER transactions.',
    async run(page, rec) {
      await rec.idle(1800);
      await rec.hover(page.locator('h1').first(), 'inspector heading');
      await sleep(900);
      await rec.click($(page, '#protocol-reprobe-btn'), 'Re-probe live RPC', { pauseAfter: [1600, 2000] });
      await rec.scroll(380, 2600);
      await rec.idle(1800);
      await rec.hover($(page, '#protocol-proof-ledger'), 'proof ledger', { timeout: 5000 });
      await sleep(800);
      await rec.scroll(420, 3000);
      await rec.idle(1600);
      const filters = page.locator('[id^="protocol-filter-"]');
      const n = await filters.count().catch(() => 0);
      if (n > 1) {
        await rec.click(filters.nth(1), 'ledger filter 2', { pauseAfter: [1300, 1700] });
        if (n > 2) await rec.click(filters.nth(2), 'ledger filter 3', { pauseAfter: [1300, 1700] });
        await rec.click(filters.nth(0), 'ledger filter all', { pauseAfter: [1000, 1300] });
      }
      await rec.hover($(page, '#protocol-proof-ledger a[href*="solscan.io/tx"]'), 'Solscan tx link');
      await sleep(1000);
      await rec.scroll(520, 3200);
      await rec.idle(2000);
      await rec.scrollTop(2600);
      await rec.idle(1200);
    },
  },

  D: {
    path: null, // opens an explorer transaction page directly
    device: DESKTOP,
    minUsable: 16,
    description:
      'Real transaction from the 2026-11-27 own-authority Borel live run (docs/DEVNET_PROOF.md), opened on the official Solana Explorer (1920x1080). Solscan links for the same signatures are in the manifest.',
    async run(page, rec, meta) {
      for (const tx of PROOF_TXS) {
        if (await openExplorer(page, rec, meta, explorerTx(tx.sig, tx.rpc), tx.label)) {
          meta.tx = { label: tx.label, signature: tx.sig, solscanUrl: solscanTx(tx.sig, tx.rpc), explorerUrl: explorerTx(tx.sig, tx.rpc) };
          return;
        }
      }
      rec.missing.push('no explorer transaction rendered');
    },
  },

  M: {
    path: '/',
    readySelector: '#borel-seal-btn',
    device: MOBILE,
    minUsable: 40,
    description:
      'Mobile 390x844: how-to-play, draft, seal, live ladder, Pivot, showdown and receipt in a Paper room.',
    async run(page, rec) {
      if (await rec.hover($(page, '#borel-howto'), 'how-to-play', { timeout: 8000 })) {
        await rec.idle(1600);
        await rec.scroll(500, 1800);
        await rec.idle(800);
      }
      await closeHowTo(page, rec, { pauseAfter: [800, 1000] });
      await rec.scrollTop(800);
      await draftHand(page, rec, { fast: true });
      await rec.click($(page, '#borel-seal-btn'), 'Seal hand', { pauseAfter: [1000, 1300] });
      await rec.hover($(page, '#borel-ladder'), 'ladder', { timeout: 6000 });
      await rec.idle(4500);
      await rec.click($(page, '#borel-pivot-leg-1'), 'pivot target leg 2', { pauseAfter: [400, 600] });
      await rec.click($(page, '#borel-pivot-shield-btn'), 'Pivot: Shield', { pauseAfter: [1000, 1300] });
      await rec.click($(page, '#borel-force-showdown-btn'), 'Ring the bell', { pauseAfter: [600, 800] });
      await rec.hover($(page, '#borel-showdown'), 'showdown', { timeout: 6000 });
      await rec.idle(2600);
      await rec.hover($(page, '#borel-ladder'), 'face-up hands');
      await rec.idle(2200);
      await rec.hover($(page, '#borel-receipt'), 'receipt', { timeout: 6000 });
      await rec.idle(3000);
    },
  },
};

/** Navigate to an explorer transaction page; returns true once a confirmed transaction is visible. */
async function openExplorer(page, rec, meta, url, label) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    rec.mark(`goto ${new URL(url).host} (${label})`);
  } catch (err) {
    rec.missing.push(`explorer navigation (${label}): ${String(err.message).slice(0, 80)}`);
    return false;
  }
  const status = page.getByText(/^(Success|Finalized|Confirmed)$/i).first();
  try {
    await status.waitFor({ state: 'visible', timeout: 25000 });
  } catch {
    rec.missing.push(`explorer did not render a confirmed tx for ${label}`);
    return false;
  }
  meta.explorerUrl = url;
  meta.explorerReadyAtSec = rec.since();
  rec.mark(`explorer tx rendered (${label})`);
  await sleep(1400);
  await rec.hover(page.getByText(/^Signature$/i).first(), 'signature');
  await sleep(1300);
  await rec.hover(status, 'status');
  await sleep(1300);
  await rec.scroll(420, 2400);
  await rec.idle(2200);
  await rec.scroll(380, 2200);
  await rec.idle(1800);
  return true;
}

// ----------------------------------------------------------------- main ----

async function recordClip(browser, id, spec) {
  const log = (m) => console.log(`[${id}] ${m}`);
  const d = spec.device;
  const vidDir = mkdtempSync(join(SCRATCH_DIR, `vid-${id}-`));
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dsf,
    recordVideo: { dir: vidDir, size: { width: d.width * d.dsf, height: d.height * d.dsf } },
    colorScheme: 'dark',
    userAgent: d.ua,
    locale: 'en-US',
  });
  await context.addInitScript(initScript(d.width, d.height, d.cursor));
  const t0 = Date.now();
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  const rec = makeRecorder(page, t0, log, d.width, d.height);
  const meta = {};
  let url = spec.path === null ? null : BASE_URL + spec.path;
  if (url) {
    log(`goto ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (err) {
      rec.missing.push(`goto: ${String(err.message).slice(0, 80)}`);
    }
    await waitReady(page);
    if (spec.readySelector) {
      // Hydrated UI, not just network idle: the choreography's beat clock starts from here.
      try { await page.locator(spec.readySelector).first().waitFor({ state: 'visible', timeout: 25000 }); } catch { rec.missing.push(`ready:${spec.readySelector}`); }
      await sleep(600);
    }
    await dismissOverlay(page, rec);
  }
  await page.mouse.move(d.width / 2, d.height / 2).catch(() => {});
  const readyAtSec = rec.since();
  rec.setReady(readyAtSec);
  log(`ready at ${readyAtSec}s`);

  try {
    await spec.run(page, rec, meta);
  } catch (err) {
    rec.missing.push(`choreography error: ${String(err.message || err).slice(0, 120)}`);
    log(`choreography error ${err.message}`);
  }
  await dismissOverlay(page, rec);

  const usable = rec.since() - readyAtSec;
  if (usable < spec.minUsable) {
    log(`padding ${(spec.minUsable - usable).toFixed(1)}s`);
    await rec.idle((spec.minUsable - usable) * 1000 + 500);
  }

  try { await page.screenshot({ path: join(SCRATCH_DIR, `end-${id}.png`) }); } catch {}
  await sleep(500);
  const video = page.video();
  const durationSec = rec.since();
  const finalUrl = page.url();
  await context.close();
  const src = video ? await video.path() : null;
  const dest = join(OUT_DIR, `${id}.webm`);
  if (src && existsSync(src)) {
    copyFileSync(src, dest);
    rmSync(vidDir, { recursive: true, force: true });
  } else {
    rec.missing.push('video file not produced');
  }
  if (!url) url = meta.explorerUrl || finalUrl;
  // The screencast starts after page creation, so the file is shorter than the wall clock by a
  // constant lead-in. Shift every timestamp onto the video's own timeline (verified against the
  // on-screen round clock in a dry run).
  const videoSec = existsSync(dest) ? videoDurationSec(dest) : null;
  const offset = videoSec ? Math.max(0, +(durationSec - videoSec).toFixed(2)) : 0;
  const toVideo = (s) => +Math.max(0, s - offset).toFixed(2);
  const shift = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /AtSec$/.test(k) && typeof v === 'number' ? toVideo(v) : v]));
  log(`saved ${dest} (video ${videoSec ?? '?'}s, wall ${durationSec}s, missing ${rec.missing.length})`);
  return {
    clip: id,
    file: `clips/${id}.webm`,
    durationSec: videoSec ? +videoSec.toFixed(2) : durationSec,
    description: spec.description,
    width: d.width * d.dsf,
    height: d.height * d.dsf,
    readyAtSec: toVideo(readyAtSec),
    url,
    ...shift(meta),
    wallClockSec: durationSec,
    screencastLeadInSec: offset,
    steps: rec.steps.map((s) => {
      const i = s.indexOf('s ');
      return `${toVideo(Number.parseFloat(s.slice(0, i)))}s ${s.slice(i + 2)}`;
    }),
    missing: rec.missing,
    pageErrors: [...new Set(pageErrors)].slice(0, 10),
    consoleErrors: [...new Set(consoleErrors)].slice(0, 10),
    recordedAt: new Date().toISOString(),
  };
}

const manifestPath = join(OUT_DIR, 'manifest.json');
let manifest = [];
if (existsSync(manifestPath)) {
  try {
    const prev = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(prev)) manifest = prev;
  } catch { manifest = []; }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const id of ONLY) {
    const spec = CLIPS[id];
    if (!spec) { console.warn(`unknown clip ${id}`); continue; }
    const entry = await recordClip(browser, id, spec);
    manifest = manifest.filter((m) => m.clip !== id);
    manifest.push(entry);
    manifest.sort((a, b) => a.clip.localeCompare(b.clip));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
} finally {
  await browser.close();
}
console.log(`manifest -> ${manifestPath}`);
