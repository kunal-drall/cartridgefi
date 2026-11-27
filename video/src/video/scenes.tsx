import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT } from '../theme';
import { Backdrop, Glass, LegCard, Mono, Pill, SealedCard, clamp, progress } from '../ui';
import type { Clip } from './manifest';

export const XFADE = 14;

/** Fades and gently scales a scene in and out so consecutive scenes overlap into a smooth cut. */
export const SceneShell: React.FC<{ frames: number; children: React.ReactNode; first?: boolean }> = ({ frames, children, first }) => {
  const f = useCurrentFrame();
  const fadeIn = first ? 1 : interpolate(f, [0, XFADE], [0, 1], clamp);
  const fadeOut = interpolate(f, [frames, frames + XFADE], [1, 0], clamp);
  const scale = interpolate(f, [0, XFADE], [first ? 1 : 1.035, 1], clamp) * interpolate(f, [frames, frames + XFADE], [1, 0.985], clamp);
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut), transform: `scale(${scale})` }}>
      {children}
    </AbsoluteFill>
  );
};

export const LowerThird: React.FC<{ kicker: string; title: string; from?: number; to: number; color?: string; top?: boolean }> = ({ kicker, title, from = 16, to, color = C.amber, top }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame: f - from, fps, config: { damping: 200 } });
  const out = interpolate(f, [to - 12, to], [1, 0], clamp);
  const o = Math.min(inS, out);
  return (
    <div style={top ? { position: 'absolute', right: 72, top: 44, opacity: o, transform: `translateX(${(1 - inS) * 40}px)` } : { position: 'absolute', left: 72, bottom: 64, opacity: o, transform: `translateX(${(1 - inS) * -40}px)` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: 'rgba(10,13,20,0.86)',
          border: `1px solid ${C.border}`,
          borderTop: `1px solid ${C.specular}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: 6, background: color }} />
        <div style={{ padding: '14px 26px 16px 20px' }}>
          <Mono size={17} color={color} style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            {kicker}
          </Mono>
          <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 34, color: C.text, letterSpacing: '-0.02em', marginTop: 2 }}>{title}</div>
        </div>
      </div>
    </div>
  );
};

export const UrlBadge: React.FC<{ label?: string }> = ({ label = 'cartridgefi.vercel.app' }) => {
  const f = useCurrentFrame();
  const pulse = 0.5 + 0.5 * Math.sin(f / 8);
  return (
    <div style={{ position: 'absolute', right: 72, top: 56, opacity: interpolate(f, [6, 20], [0, 1], clamp) }}>
      <Pill color={C.green} style={{ background: 'rgba(10,13,20,0.86)', fontSize: 20 }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: C.green, opacity: 0.4 + 0.6 * pulse }} />
        LIVE · {label}
      </Pill>
    </div>
  );
};

const prettyStep = (s: string) =>
  s
    .replace(/^(click|hover|key|goto|scroll)\s+/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Live product footage in a framed stage, with slow push-in/pan, step captions and the URL badge. */
export const Footage: React.FC<{
  clip: Clip;
  fromSec: number;
  frames: number;
  focus?: [number, number][]; // normalized focus points (x,y) visited over the shot
  zoom?: [number, number];
  badge?: string;
  captions?: boolean;
  rate?: number;
  note?: string;
}> = ({ clip, fromSec, frames, focus = [[0.5, 0.5], [0.5, 0.5]], zoom = [1.0, 1.16], badge, captions = true, rate = 1, note }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = progress(f, 0, frames);
  const seg = Math.min(focus.length - 2, Math.floor(p * (focus.length - 1)));
  const local = p * (focus.length - 1) - seg;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const fx = focus[seg][0] + (focus[seg + 1][0] - focus[seg][0]) * ease(local);
  const fy = focus[seg][1] + (focus[seg + 1][1] - focus[seg][1]) * ease(local);
  const z = zoom[0] + (zoom[1] - zoom[0]) * ease(p);
  const W = 1776;
  const H = 999;
  const tx = (0.5 - fx) * W * (z - 1);
  const ty = (0.5 - fy) * H * (z - 1);
  const startSec = clip.readyAtSec + fromSec;
  const nowSec = startSec + (f / fps) * rate;
  const step = captions ? [...clip.steps].reverse().find((s) => !/^scroll/i.test(s.label) && s.t <= nowSec && s.t >= startSec - 1 && nowSec - s.t < 5) : undefined;
  const caption = note ?? (step ? prettyStep(step.label) : undefined);
  const label = badge ?? (clip.domain && !/localhost/.test(clip.domain) ? clip.domain : 'cartridgefi.vercel.app');
  return (
    <AbsoluteFill>
      <Backdrop hue={C.blue} />
      <div
        style={{
          position: 'absolute',
          left: (1920 - W) / 2,
          top: (1080 - H) / 2,
          width: W,
          height: H,
          borderRadius: 20,
          overflow: 'hidden',
          border: `1px solid ${C.specular}`,
          background: C.stage,
        }}
      >
        <div style={{ width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${z})`, transformOrigin: 'center center' }}>
          <OffthreadVideo src={staticFile(clip.file)} trimBefore={Math.max(0, Math.round(startSec * fps))} playbackRate={rate} muted style={{ width: W, height: H, objectFit: 'cover' }} />
        </div>
      </div>
      <UrlBadge label={label} />
      {caption ? (
        <div style={{ position: 'absolute', right: 72, bottom: 64 }}>
          <Pill color={C.dim} style={{ background: 'rgba(10,13,20,0.86)', fontSize: 19 }}>
            ▸ {caption}
          </Pill>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Portrait (phone-width) footage in a device frame, beside a caption. */
export const PhoneFootage: React.FC<{ clip: Clip; fromSec: number; frames: number }> = ({ clip, fromSec, frames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cw = clip.width ?? 390;
  const ch = clip.height ?? 844;
  const H = 900;
  const W = Math.round((cw / ch) * H);
  const startSec = clip.readyAtSec + fromSec;
  const rise = spring({ frame: f, fps, config: { damping: 200 } });
  const nowSec = startSec + f / fps;
  const step = [...clip.steps].reverse().find((s) => s.t <= nowSec && s.t >= startSec - 1 && nowSec - s.t < 5);
  return (
    <AbsoluteFill>
      <Backdrop hue={C.teal} />
      <div
        style={{
          position: 'absolute',
          left: 1100 - W / 2,
          top: (1080 - H) / 2 - 12,
          width: W + 24,
          height: H + 24,
          borderRadius: 54,
          background: '#0b0e15',
          border: `1px solid ${C.specular}`,
          padding: 12,
          boxSizing: 'border-box',
          transform: `translateY(${(1 - rise) * 40}px)`,
          opacity: rise,
        }}
      >
        <div style={{ width: W, height: H, borderRadius: 42, overflow: 'hidden', background: C.stage }}>
          <OffthreadVideo src={staticFile(clip.file)} trimBefore={Math.max(0, Math.round(startSec * fps))} muted style={{ width: W, height: H, objectFit: 'cover' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 380, width: 620, opacity: rise }}>
        <Mono size={20} color={C.teal} style={{ letterSpacing: '0.16em' }}>
          PHONE · {cw} PX WIDE
        </Mono>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 60, color: C.text, letterSpacing: '-0.035em', lineHeight: 0.98, marginTop: 14 }}>
          The same room, in your pocket.
        </div>
        {step ? (
          <div style={{ marginTop: 28 }}>
            <Pill color={C.dim}>▸ {prettyStep(step.label)}</Pill>
          </div>
        ) : null}
      </div>
      <UrlBadge label={clip.domain && !/localhost/.test(clip.domain) ? clip.domain : 'cartridgefi.vercel.app'} />
    </AbsoluteFill>
  );
};

/** Screenshot with a slow Ken Burns move (fallback when a clip is missing, and for the hook). */
export const StillPan: React.FC<{ src: string; frames: number; from?: [number, number, number]; to?: [number, number, number]; badge?: boolean }> = ({
  src,
  frames,
  from = [1.0, 0.5, 0.5],
  to = [1.14, 0.45, 0.45],
  badge = true,
}) => {
  const f = useCurrentFrame();
  const p = progress(f, 0, frames);
  const z = from[0] + (to[0] - from[0]) * p;
  const fx = from[1] + (to[1] - from[1]) * p;
  const fy = from[2] + (to[2] - from[2]) * p;
  const W = 1776;
  const H = 999;
  return (
    <AbsoluteFill>
      <Backdrop hue={C.blue} />
      <div
        style={{
          position: 'absolute',
          left: (1920 - W) / 2,
          top: (1080 - H) / 2,
          width: W,
          height: H,
          borderRadius: 20,
          overflow: 'hidden',
          border: `1px solid ${C.specular}`,
          boxShadow: '0 40px 140px -30px rgba(0,0,0,0.95)',
          background: C.stage,
        }}
      >
        <Img
          src={staticFile(src)}
          style={{ width: W, height: H, objectFit: 'cover', transform: `translate(${(0.5 - fx) * W * (z - 1)}px, ${(0.5 - fy) * H * (z - 1)}px) scale(${z})` }}
        />
      </div>
      {badge ? <UrlBadge /> : null}
    </AbsoluteFill>
  );
};

/** Sequence of real app screenshots with Ken Burns moves (used when a demo clip is unavailable). */
export const StillTour: React.FC<{ shots: { src: string; caption: string }[]; frames: number }> = ({ shots, frames }) => {
  const f = useCurrentFrame();
  const per = Math.floor(frames / shots.length);
  const i = Math.min(shots.length - 1, Math.floor(f / per));
  const local = f - i * per;
  const fade = interpolate(local, [0, 10], [i === 0 ? 1 : 0, 1], clamp);
  const s = shots[i];
  const dir = i % 2 === 0;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: fade }}>
        <StillPan src={s.src} frames={per} from={dir ? [1.0, 0.5, 0.5] : [1.12, 0.4, 0.45]} to={dir ? [1.12, 0.42, 0.45] : [1.0, 0.5, 0.5]} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', right: 72, bottom: 64 }}>
        <Pill color={C.dim} style={{ background: 'rgba(10,13,20,0.86)', fontSize: 19 }}>
          ▸ {s.caption}
        </Pill>
      </div>
    </AbsoluteFill>
  );
};

/** Two-line Blitz-winner-format hook over the sealed ladder. */
export const HookLines: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f - start, fps, config: { damping: 200 } });
  const b = spring({ frame: f - start - 18, fps, config: { damping: 200 } });
  return (
    <div style={{ position: 'absolute', left: 72, right: 72, bottom: 64 }}>
      <Glass style={{ padding: '26px 34px', maxWidth: 1560 }}>
        <div style={{ opacity: a, transform: `translateY(${(1 - a) * 16}px)`, fontFamily: FONT.display, fontWeight: 700, fontSize: 42, letterSpacing: '-0.03em', color: C.text }}>
          Seal a 3-leg market hand. Climb a live ladder. Unseal at <span style={{ color: C.amber }}>00:00</span>.
        </div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 16}px)`, marginTop: 12 }}>
          <Mono size={22} color={C.dim}>
            <span style={{ color: C.violet }}>Permission Program</span> seals hands · <span style={{ color: C.violet }}>Ephemeral Rollup</span> carries stances +
            pivots · <span style={{ color: C.violet }}>VRF</span> breaks ties
          </Mono>
        </div>
      </Glass>
    </div>
  );
};

/* ---------- 00:00 unseal climax: public read vs the table ---------- */

type Seat = { name: string; legs: { asset: string; side: 'LONG' | 'SHORT'; mult: 1 | 2 | 3 }[]; weights: string; rankBefore: number[]; finalRank: number };

// Final hands from devnet room borel-live-mwyxjvb8 (submit_stance after the pivot), slot order [SOL, BTC, ETH, NVDAx]. Player A won (final_score 308348).
const SEATS: Seat[] = [
  {
    name: 'Player A',
    legs: [
      { asset: 'SOL', side: 'LONG', mult: 3 },
      { asset: 'BTC', side: 'SHORT', mult: 1 },
      { asset: 'ETH', side: 'SHORT', mult: 2 },
    ],
    weights: '[3000, -1000, -2000, 0]',
    rankBefore: [2, 1, 2, 1, 2],
    finalRank: 1,
  },
  {
    name: 'Player B',
    legs: [
      { asset: 'BTC', side: 'LONG', mult: 1 },
      { asset: 'NVDAx', side: 'LONG', mult: 3 },
    ],
    weights: '[0, 1000, 0, 3000]',
    rankBefore: [1, 2, 1, 2, 1],
    finalRank: 2,
  },
];

const hexNoise = (seed: number, len: number) => {
  let s = seed;
  let out = '';
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out += '░▒▓█'[s % 4];
  }
  return out;
};

export const UnsealScene: React.FC<{ frames: number }> = ({ frames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const unsealAt = Math.round(frames * 0.42);
  const countFrom = 5;
  const secsLeft = Math.max(0, Math.ceil(countFrom - (f / unsealAt) * countFrom));
  const sealed = f < unsealAt;
  const flash = interpolate(f, [unsealAt - 2, unsealAt + 3, unsealAt + 18], [0, 1, 0], clamp);
  const flip = progress(f, unsealAt, 16);
  const vrfIn = spring({ frame: f - unsealAt - 40, fps, config: { damping: 200 } });
  const intro = spring({ frame: f - 4, fps, config: { damping: 200 } });
  const tick = Math.floor(f / 18);
  const clock = sealed ? `00:0${secsLeft}` : '00:00';
  return (
    <AbsoluteFill>
      <Backdrop hue={sealed ? C.violet : C.amber} />
      <AbsoluteFill style={{ padding: '64px 72px', justifyContent: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: intro }}>
          <Mono size={22} color={C.dim} style={{ letterSpacing: '0.18em' }}>
            SHOWDOWN · ONE ROOM, TWO VIEWS
          </Mono>
          <div
            style={{
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: sealed ? 96 : 132,
              color: sealed ? C.text : C.amber,
              fontVariantNumeric: 'tabular-nums slashed-zero',
              textShadow: sealed ? undefined : `0 0 60px ${C.amber}aa`,
              lineHeight: 1,
            }}
          >
            {clock}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 36, marginTop: 40, alignItems: 'flex-start' }}>
          {/* Left: public read */}
          <Glass style={{ flex: 1, padding: 32, opacity: intro }} glow={sealed ? C.violet : C.amber}>
            <Mono size={20} color={C.violet} style={{ letterSpacing: '0.16em' }}>
              PUBLIC READ · PlayerStance accounts on the ER
            </Mono>
            <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 40, color: C.text, marginTop: 10, letterSpacing: '-0.02em' }}>
              {sealed ? 'Nothing readable until the unseal' : 'Unsealed: every weight is public'}
            </div>
            {SEATS.map((s, i) => (
              <div key={s.name} style={{ marginTop: 28, padding: 22, borderRadius: 14, background: C.stage, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Mono size={22} color={C.text}>
                    {s.name} · weight_bps
                  </Mono>
                  <Mono size={20} color={sealed ? C.red : C.green}>
                    {sealed ? '■ private · Permission ACL' : '● public after trigger_showdown_unseal'}
                  </Mono>
                </div>
                <div style={{ marginTop: 14 }}>
                  <Mono size={34} color={sealed ? C.faint : C.amber} style={{ letterSpacing: sealed ? '0.08em' : '0.02em' }}>
                    {sealed ? hexNoise(tick * 7 + i * 13, 22) : s.weights}
                  </Mono>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 26, minHeight: 64 }}>
              {!sealed ? (
                <div style={{ opacity: vrfIn, marginBottom: 12 }}>
                  <Pill color={C.green} style={{ fontSize: 19 }}>
                    Player A wins · score 308348 · 1% fee → platformFeeAccount
                  </Pill>
                </div>
              ) : null}
              <Mono size={18} color={C.faint}>
                Recreated from devnet room borel-live-mwyxjvb8 · pivots 5ZuXyya1…, 4fEHPwXZ…
              </Mono>
            </div>
          </Glass>
          {/* Right: the table */}
          <Glass style={{ flex: 1, padding: 32, opacity: intro }}>
            <Mono size={20} color={C.teal} style={{ letterSpacing: '0.16em' }}>
              THE TABLE · rank-only ladder
            </Mono>
            <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 40, color: C.text, marginTop: 10, letterSpacing: '-0.02em' }}>
              {sealed ? 'Ranks move. Hands stay face-down.' : 'Every hand flips at once'}
            </div>
            {SEATS.map((s, i) => {
              const rank = sealed ? s.rankBefore[tick % s.rankBefore.length] : s.finalRank;
              return (
                <div key={s.name} style={{ marginTop: 28, padding: 22, borderRadius: 14, background: C.stage, border: `1px solid ${!sealed && rank === 1 ? C.amber : C.border}`, display: 'flex', alignItems: 'center', gap: 24 }}>
                  <Mono size={44} color={!sealed && rank === 1 ? C.amber : C.dim} style={{ fontWeight: 700, width: 70 }}>
                    #{rank}
                  </Mono>
                  <Mono size={22} color={C.text} style={{ width: 130 }}>
                    {s.name}
                  </Mono>
                  <div style={{ display: 'flex', gap: 10, transform: `scaleX(${Math.max(0.02, Math.abs(1 - 2 * flip))})` }}>
                    {flip < 0.5
                      ? [0, 1, 2].map((k) => <SealedCard key={k} w={92} h={128} label="?" color={k === 2 ? C.amber : C.blue} />)
                      : [
                          ...s.legs.map((l) => <LegCard key={l.asset} asset={l.asset} side={l.side} mult={l.mult} w={92} h={128} />),
                          ...(s.legs.length < 3 ? [<SealedCard key="sh" w={92} h={128} label="SHIELD" color={C.dim} />] : []),
                        ]}
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 26, minHeight: 64, opacity: vrfIn, transform: `translateY(${(1 - vrfIn) * 14}px)` }}>
              <Pill color={C.violet} style={{ fontSize: 19 }}>
                VRF tie-break · 4qbDtCva… · fair + auditable
              </Pill>
            </div>
          </Glass>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.amber, opacity: flash * 0.35, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};
