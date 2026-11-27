import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { TimeScale } from '../ui';
import { S01Title, S02Problem, S03Insight, S06Architecture, S07Proof, S08WhyNow, S09Competition, S10Business, S11Roadmap, S12Ask } from '../slides';
import { Footage, HookLines, LowerThird, PhoneFootage, SceneShell, StillPan, StillTour, UnsealScene, XFADE } from './scenes';
import { LEAD_IN, type Clip, type PitchProps } from './manifest';

const Slow: React.FC<{ k: number; children: React.ReactNode }> = ({ k, children }) => <TimeScale.Provider value={k}>{children}</TimeScale.Provider>;

/** Splits a scene into consecutive parts (fractions of its length), each with its own crossfade. */
const Parts: React.FC<{ frames: number; parts: { share: number; node: (frames: number) => React.ReactNode }[] }> = ({ frames, parts }) => {
  // Boundaries come from cumulative shares, so a part's start never depends on how earlier parts are split.
  let cum = 0;
  let at = 0;
  return (
    <>
      {parts.map((p, i) => {
        cum += p.share;
        const end = i === parts.length - 1 ? frames : Math.round(frames * cum);
        const len = end - at;
        const from = at;
        at = end;
        const last = i === parts.length - 1;
        return (
          <Sequence key={i} from={from} durationInFrames={len + XFADE} layout="none">
            <SceneShell frames={last ? len + 1000 : len} first={i === 0}>
              {p.node(len)}
            </SceneShell>
          </Sequence>
        );
      })}
    </>
  );
};

const findClip = (clips: Record<string, Clip>, ids: string[], test: (c: Clip) => boolean) => {
  for (const id of ids) if (clips[id] && test(clips[id])) return clips[id];
  return Object.values(clips).find(test);
};

const FootageOrStill: React.FC<{ clip?: Clip; fromSec?: number; frames: number; still: string; focus?: [number, number][]; zoom?: [number, number]; rate?: number; note?: string }> = ({
  clip,
  fromSec = 0,
  frames,
  still,
  focus,
  zoom,
  rate = 1,
  note,
}) => {
  const { fps } = useVideoConfig();
  if (!clip) return <StillPan src={still} frames={frames} />;
  const avail = Math.floor(((clip.durationSec - clip.readyAtSec - fromSec) * fps) / rate) - 2;
  if (avail >= frames) return <Footage clip={clip} fromSec={fromSec} frames={frames} focus={focus} zoom={zoom} rate={rate} note={note} />;
  return (
    <>
      <Sequence durationInFrames={Math.max(1, avail)} layout="none">
        <Footage clip={clip} fromSec={fromSec} frames={Math.max(1, avail)} focus={focus} zoom={zoom} rate={rate} />
      </Sequence>
      <Sequence from={Math.max(1, avail)} layout="none">
        <StillPan src={still} frames={frames - avail} />
      </Sequence>
    </>
  );
};

export const Pitch: React.FC<PitchProps> = ({ voices, clips, sceneFrames, fps }) => {
  const product = findClip(clips, ['A'], (c) => !/protocol|solscan|explorer|studio|pulse/.test(c.url ?? '') && !/mobile/i.test(c.id));
  const devnet = clips.B && clips.B.id !== product?.id ? clips.B : undefined;
  const mobile = Object.values(clips).find((c) => /mobile|phone|390/i.test(`${c.id} ${c.file}`) || (c.width !== undefined && c.width < 600));
  const protocol = findClip(clips, ['C', 'E'], (c) => /protocol/.test(c.url ?? c.file));
  const solscan =
    findClip(clips, ['D'], (c) => /solscan|explorer/.test(c.url ?? c.file)) ?? Object.values(clips).find((c) => c.solscanReadyAtSec !== undefined);
  // Explorer finishes loading the tx ~20.5 s into clip D (checked frame by frame), so start just after.
  const solscanFrom = solscan ? Math.max(0, Math.min(20.8, solscan.durationSec - 7) - solscan.readyAtSec) : 0;

  const scenes: { lt?: [string, string, string?]; parts: { share: number; node: (f: number) => React.ReactNode }[] }[] = [
    {
      lt: undefined,
      parts: [
        { share: 0.42, node: () => <S01Title /> },
        {
          share: 0.58,
          node: (f) => (
            <>
              <StillPan src="shots/table-sweat.png" frames={f} from={[1.0, 0.45, 0.45]} to={[1.16, 0.4, 0.5]} />
              <HookLines start={10} />
            </>
          ),
        },
      ],
    },
    { lt: ['Problem', 'Public positions, solo screens', C.red], parts: [{ share: 1, node: () => <Slow k={1.7}><S02Problem /></Slow> }] },
    { lt: ['Insight', 'Hidden information is the game'], parts: [{ share: 1, node: () => <Slow k={1.6}><S03Insight /></Slow> }] },
    {
      lt: ['Live app · paper room', 'Draft, seal, sweat, pivot', C.green],
      parts: [
        {
          share: 0.36,
          node: (f) =>
            product ? (
              <FootageOrStill
                clip={product}
                fromSec={Math.max(0, 25.7 - product.readyAtSec)}
                rate={1.1}
                frames={f}
                still="shots/table-hand.png"
                focus={[[0.5, 0.5], [0.4, 0.55], [0.35, 0.5], [0.5, 0.5]]}
                zoom={[1.0, 1.1]}
              />
            ) : (
              <StillTour
                frames={f}
                shots={[
                  { src: 'shots/home.png', caption: 'six-step how-to-play' },
                  { src: 'shots/table-draft.png', caption: 'pick 3 markets' },
                  { src: 'shots/table-hand.png', caption: 'call each, place 1x / 2x / 3x' },
                  { src: 'shots/table-sealed.png', caption: 'seal: only a sha256 fingerprint is published' },
                ]}
              />
            ),
        },
        {
          share: 0.14,
          node: (f) => (
            <FootageOrStill
              clip={devnet}
              fromSec={devnet ? Math.max(0, 62.5 - devnet.readyAtSec) : 0}
              frames={f}
              still="shots/table-sweat.png"
              focus={[[0.62, 0.6], [0.7, 0.72]]}
              zoom={[1.05, 1.22]}
            />
          ),
        },
        {
          share: 0.18,
          node: (f) =>
            mobile && ((mobile.width ?? 1920) < 900 || (mobile.height ?? 0) > (mobile.width ?? 1920)) ? (
              <PhoneFootage clip={mobile} fromSec={Math.max(0, 66 - mobile.readyAtSec)} frames={f} />
            ) : (
              <StillTour
                frames={f}
                shots={[
                  { src: 'shots/table-sweat.png', caption: 'rank-only ladder on live Pyth prices' },
                  { src: 'shots/table-pivot.png', caption: 'one pivot: flip or shield' },
                ]}
              />
            ),
        },
        { share: 0.32, node: (f) => <UnsealScene frames={f} /> },
      ],
    },
    { lt: ['Under the hood', 'MagicBlock, in headline order', C.violet], parts: [{ share: 1, node: () => <Slow k={3}><S06Architecture /></Slow> }] },
    {
      lt: ['Proof · Solana devnet', '27 confirmed transactions', C.teal],
      parts: [
        { share: 0.48, node: () => <Slow k={1.3}><S07Proof /></Slow> },
        { share: 0.26, node: (f) => <FootageOrStill clip={protocol} fromSec={protocol ? Math.max(0, 10.5 - protocol.readyAtSec) : 0} frames={f} still="shots/protocol.png" zoom={[1.0, 1.1]} focus={[[0.5, 0.4], [0.5, 0.55]]} /> },
        { share: 0.26, node: (f) => <FootageOrStill clip={solscan} fromSec={solscanFrom} frames={f} still="shots/protocol.png" zoom={[1.0, 1.12]} focus={[[0.45, 0.3], [0.5, 0.45]]} note="settle tx 2oTzABoi… · winner paid + 1% fee → platformFeeAccount" /> },
      ],
    },
    {
      lt: ['Why now · competition', 'Sealed hands on live markets', C.amber],
      parts: [
        { share: 0.42, node: () => <Slow k={1.2}><S08WhyNow /></Slow> },
        { share: 0.58, node: () => <Slow k={1.4}><S09Competition /></Slow> },
      ],
    },
    {
      lt: ['Business · roadmap', 'Paper first, fees on-chain', C.blue],
      parts: [
        { share: 0.5, node: () => <Slow k={1.2}><S10Business /></Slow> },
        { share: 0.5, node: () => <Slow k={1.2}><S11Roadmap /></Slow> },
      ],
    },
    { lt: undefined, parts: [{ share: 1, node: () => <S12Ask /> }] },
  ];

  let start = 0;
  const starts = sceneFrames.map((f) => {
    const s = start;
    start += f;
    return s;
  });

  return (
    <AbsoluteFill style={{ background: C.void }}>
      {scenes.map((sc, i) => {
        const frames = sceneFrames[i];
        const last = i === scenes.length - 1;
        return (
          <Sequence key={`v${i}`} from={starts[i]} durationInFrames={frames + (last ? 0 : XFADE)} layout="none">
            <SceneShell frames={last ? frames + 1000 : frames} first={i === 0}>
              <Parts frames={frames} parts={sc.parts} />
              {sc.lt ? <LowerThird kicker={sc.lt[0]} title={sc.lt[1]} color={sc.lt[2]} from={18} to={Math.min(frames - 6, 18 + 150)} top={i !== 3} /> : null}
            </SceneShell>
          </Sequence>
        );
      })}
      {voices.map((v) => (
        <Sequence key={`a${v.scene}`} from={starts[v.scene - 1] + LEAD_IN} durationInFrames={Math.ceil(v.durationSec * fps) + 15} layout="none">
          <Audio src={staticFile(v.file)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
