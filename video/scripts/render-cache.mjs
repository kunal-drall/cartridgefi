// Transcodes every clip in public/clips/manifest.json to keyframe-dense h264 under public/cache/
// (webm seeks are slow in OffthreadVideo) and writes public/cache/manifest.json mapping clip -> cache file.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
let m = {};
try {
  m = JSON.parse(fs.readFileSync('public/clips/manifest.json', 'utf8'));
} catch {}
const list = Array.isArray(m.clips) ? m.clips : Array.isArray(m) ? m : Object.values(m.clips && typeof m.clips === 'object' ? m.clips : m);
const map = {};
fs.mkdirSync('public/cache', { recursive: true });
for (const c of list) {
  if (!c || typeof c !== 'object') continue;
  const f = String(c.file || c.src || '').replace(/^\/+/, '').replace(/^.*public\//, '');
  if (!f) continue;
  const rel = f.startsWith('clips/') ? f : `clips/${f}`;
  const src = `public/${rel}`;
  if (!fs.existsSync(src)) continue;
  const out = `cache/${rel.replace(/^clips\//, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.[a-z0-9]+$/i, '')}.mp4`;
  const dst = `public/${out}`;
  if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) {
    console.log('transcode', rel);
    execFileSync('npx', ['remotion', 'ffmpeg', '-y', '-v', 'error', '-i', src, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-g', '15', '-pix_fmt', 'yuv420p', dst], { stdio: 'inherit' });
  }
  map[rel] = out;
}
fs.writeFileSync('public/cache/manifest.json', JSON.stringify(map, null, 2));
console.log('cache map', map);
