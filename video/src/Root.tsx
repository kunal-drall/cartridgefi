import React from 'react';
import { Composition } from 'remotion';
import { SLIDES } from './slides';
import { FPS, H, W } from './theme';
import { Pitch } from './video/Pitch';
import { TARGET_SEC, loadPitch, type PitchProps } from './video/manifest';

export const SLIDE_FRAMES = 180;

const placeholder: PitchProps = {
  fps: FPS,
  voices: [],
  clips: {},
  sceneFrames: TARGET_SEC.map((s) => s * FPS),
  audioReady: false,
};

export const RemotionRoot: React.FC = () => (
  <>
    {SLIDES.map((s) => (
      <Composition key={s.id} id={s.id} component={s.C} durationInFrames={SLIDE_FRAMES} fps={FPS} width={W} height={H} />
    ))}
    <Composition
      id="Pitch"
      component={Pitch}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={placeholder.sceneFrames.reduce((a, b) => a + b, 0)}
      defaultProps={placeholder}
      calculateMetadata={async ({ props: input }) => {
        const props = await loadPitch(FPS, Boolean(input.noClips));
        return { props, durationInFrames: props.sceneFrames.reduce((a, b) => a + b, 0) };
      }}
    />
  </>
);
