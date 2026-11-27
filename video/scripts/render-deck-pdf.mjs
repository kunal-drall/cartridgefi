// Assembles docs/pitch/slide-NN.png into docs/BOREL_PITCH_DECK.pdf (one 1920x1080 page per slide).
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('/Volumes/T7/cartridgefi/tests/e2e/package.json');
const { chromium } = require('@playwright/test');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'docs/pitch');
const files = readdirSync(DIR).filter((f) => /^slide-\d\d\.png$/.test(f)).sort();
const pages = files
  .map((f) => `<div class="p"><img src="data:image/png;base64,${readFileSync(join(DIR, f)).toString('base64')}"/></div>`)
  .join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:1920px 1080px;margin:0}html,body{margin:0;padding:0;background:#050609}
.p{width:1920px;height:1080px;page-break-after:always;overflow:hidden}.p:last-child{page-break-after:auto}
img{width:1920px;height:1080px;display:block}</style></head><body>${pages}</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({ path: join(ROOT, 'docs/BOREL_PITCH_DECK.pdf'), width: '1920px', height: '1080px', printBackground: true, pageRanges: '' });
await browser.close();
console.log(`wrote docs/BOREL_PITCH_DECK.pdf with ${files.length} pages`);
