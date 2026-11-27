import { staticFile } from 'remotion';

export type Clip = {
  id: string;
  file: string;
  readyAtSec: number;
  durationSec: number;
  domain?: string;
  url?: string;
  steps: { t: number; label: string }[];
  solscanAtSec?: number;
  solscanReadyAtSec?: number;
  width?: number;
  height?: number;
};

export type Voice = { scene: number; file: string; durationSec: number };

export type PitchProps = {
  fps: number;
  voices: Voice[];
  clips: Record<string, Clip>;
  sceneFrames: number[];
  audioReady: boolean;
  noClips?: boolean;
};

/** Target scene lengths from docs/FOUNDER_PITCH_SCRIPT.md; used until real narration exists. */
export const TARGET_SEC = [15, 25, 20, 60, 30, 20, 20, 20, 10];
export const SCENES = TARGET_SEC.length;
export const LEAD_IN = 10; // frames before narration starts in each scene
export const TAIL_SEC = 0.7; // breathing room after each line

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const pickDuration = (o: Record<string, unknown>) =>
  num(o.durationSec) ?? num(o.duration_sec) ?? num(o.duration) ?? num(o.seconds) ?? num(o.sec) ?? (num(o.durationMs) !== undefined ? num(o.durationMs)! / 1000 : undefined);

const pickFile = (o: Record<string, unknown>, fallback: string) => {
  const f = (o.file ?? o.src ?? o.path ?? o.audio ?? o.filename) as string | undefined;
  if (!f) return fallback;
  const clean = f.replace(/^\/+/, '').replace(/^.*public\//, '');
  return clean.startsWith('audio/') ? clean : `audio/${clean.replace(/^.*\//, '')}`;
};

const sceneIndex = (key: string, i: number) => {
  const m = String(key).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : i + 1;
};

export const parseVoices = (raw: unknown): Voice[] => {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const list = (Array.isArray(raw) ? raw : Array.isArray(root.scenes) ? root.scenes : Array.isArray(root.files) ? root.files : null) as
    | Record<string, unknown>[]
    | null;
  const entries: [string, Record<string, unknown>][] = list
    ? list.map((o, i) => [String(o.id ?? o.scene ?? o.name ?? o.file ?? i + 1), o])
    : Object.entries(root.scenes && typeof root.scenes === 'object' ? (root.scenes as Record<string, unknown>) : root)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([k, v]) => [k, v as Record<string, unknown>]);
  const out: Voice[] = [];
  entries.forEach(([key, o], i) => {
    const d = pickDuration(o);
    const scene = num(o.scene) ?? sceneIndex(key, i);
    if (d && d > 0.5 && scene >= 1 && scene <= SCENES) out.push({ scene, file: pickFile(o, `audio/s${scene}.mp3`), durationSec: d });
  });
  return out.sort((a, b) => a.scene - b.scene);
};

export const parseClips = (raw: unknown): Record<string, Clip> => {
  if (!raw || typeof raw !== 'object') return {};
  const root = raw as Record<string, unknown>;
  const src = (Array.isArray(root.clips) ? root.clips : Array.isArray(raw) ? raw : null) as Record<string, unknown>[] | null;
  const entries: [string, Record<string, unknown>][] = src
    ? src.map((o, i) => [String(o.clip ?? o.id ?? i), o])
    : Object.entries(root.clips && typeof root.clips === 'object' ? (root.clips as Record<string, unknown>) : root)
        .filter(([, v]) => v && typeof v === 'object' && ((v as Record<string, unknown>).file || (v as Record<string, unknown>).src))
        .map(([k, v]) => [k, v as Record<string, unknown>]);
  const out: Record<string, Clip> = {};
  for (const [id, o] of entries) {
    const lead = 0; // step timestamps are on each video's own timeline
    const file = String(o.file ?? o.src).replace(/^\/+/, '').replace(/^.*public\//, '');
    const steps = (Array.isArray(o.steps) ? o.steps : [])
      .map((s) => {
        if (typeof s === 'string') {
          const m = s.match(/^([\d.]+)s\s+(.*)$/);
          return m ? { t: parseFloat(m[1]) - lead, label: m[2] } : null;
        }
        if (s && typeof s === 'object') {
          const so = s as Record<string, unknown>;
          const t = num(so.t ?? so.at ?? so.atSec ?? so.time);
          const label = String(so.label ?? so.step ?? so.name ?? '');
          return t !== undefined && label ? { t: t - lead, label } : null;
        }
        return null;
      })
      .filter((x): x is { t: number; label: string } => !!x);
    const durationSec = num(o.durationSec) ?? num(o.duration) ?? 0;
    if (!durationSec) continue;
    out[id] = {
      id,
      file: file.startsWith('clips/') ? file : `clips/${file}`,
      readyAtSec: num(o.readyAtSec) ?? 0,
      durationSec,
      domain: typeof o.domain === 'string' ? o.domain : undefined,
      url: typeof o.url === 'string' ? o.url : undefined,
      steps,
      solscanAtSec: num(o.solscanAtSec),
      solscanReadyAtSec: num(o.explorerReadyAtSec) ?? num(o.solscanReadyAtSec),
      width: num(o.width) ?? num((o.viewport as Record<string, unknown> | undefined)?.width),
      height: num(o.height) ?? num((o.viewport as Record<string, unknown> | undefined)?.height),
    };
  }
  return out;
};

const fetchJson = async (path: string) => {
  try {
    const res = await fetch(staticFile(path));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const loadPitch = async (fps: number, noClips = false): Promise<PitchProps> => {
  const [audioRaw, clipRaw, cacheRaw] = await Promise.all([fetchJson('audio/manifest.json'), fetchJson('clips/manifest.json'), fetchJson('cache/manifest.json')]);
  const voices = parseVoices(audioRaw);
  const clips = noClips ? {} : parseClips(clipRaw);
  // scripts/render.sh transcodes each clip to keyframe-dense h264 (much faster to seek than webm).
  const cache = (cacheRaw && typeof cacheRaw === 'object' ? cacheRaw : {}) as Record<string, string>;
  for (const c of Object.values(clips)) if (cache[c.file]) c.file = cache[c.file];
  const audioReady = voices.length > 0;
  const sec = TARGET_SEC.map((t, i) => {
    const v = voices.find((x) => x.scene === i + 1);
    return v ? v.durationSec + TAIL_SEC + LEAD_IN / fps : t;
  });
  // Keep the cut inside 3:00-4:00: pad the product scene if narration runs short.
  const total = sec.reduce((a, b) => a + b, 0);
  if (total < 184) sec[3] += 184 - total;
  const sceneFrames = sec.map((s) => Math.ceil(s * fps));
  return { fps, voices, clips, sceneFrames, audioReady, noClips };
};
