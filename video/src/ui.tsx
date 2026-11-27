import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT } from './theme';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Slows slide animations when a slide is reused as a longer video scene (1 = deck timing). */
export const TimeScale = createContext(1);
export const useT = () => {
  const frame = useCurrentFrame();
  const scale = useContext(TimeScale);
  return frame / scale;
};

export const useRise = (delay: number, distance = 28) => {
  const frame = useT();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 120, mass: 0.8 } });
  return { opacity: s, transform: `translateY(${(1 - s) * distance}px)` } as React.CSSProperties;
};

export const Rise: React.FC<{ delay?: number; distance?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  delay = 0,
  distance = 28,
  style,
  children,
}) => {
  const rise = useRise(delay, distance);
  return <div style={{ ...style, ...rise }}>{children}</div>;
};

export const progress = (frame: number, start: number, dur: number) =>
  interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) });

export const Backdrop: React.FC<{ hue?: string }> = ({ hue = C.blue }) => {
  const frame = useT();
  const drift = Math.sin(frame / 90) * 40;
  return (
    <AbsoluteFill style={{ background: C.void, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: 1400,
          height: 1400,
          left: 900 + drift,
          top: -700,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${hue}22 0%, transparent 62%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 1200,
          height: 1200,
          left: -500,
          top: 500 - drift,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${C.violet}14 0%, transparent 60%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        }}
      />
    </AbsoluteFill>
  );
};

export const Glass: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode; glow?: string }> = ({ style, children, glow }) => (
  <div
    style={{
      position: 'relative',
      background: C.glass,
      border: `1px solid ${C.border}`,
      borderTop: `1px solid ${C.specular}`,
      borderRadius: 22,
      boxShadow: glow ? `0 0 0 1px ${glow}33, 0 24px 80px -20px ${glow}55` : '0 24px 80px -30px rgba(0,0,0,0.8)',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Kicker: React.FC<{ n: string; label: string; color?: string }> = ({ n, label, color = C.blue }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.18em', color: C.dim, textTransform: 'uppercase' }}>
    <span style={{ color, fontWeight: 700 }}>{n}</span>
    <span style={{ width: 40, height: 1, background: C.faint }} />
    <span>{label}</span>
  </div>
);

export const Headline: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 74, style }) => (
  <div
    style={{
      fontFamily: FONT.display,
      fontWeight: 700,
      fontSize: size,
      letterSpacing: '-0.035em',
      lineHeight: 0.98,
      color: C.text,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Body: React.FC<{ children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties }> = ({
  children,
  size = 28,
  color = C.dim,
  style,
}) => <div style={{ fontFamily: FONT.body, fontSize: size, lineHeight: 1.4, color, ...style }}>{children}</div>;

export const Mono: React.FC<{ children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties }> = ({
  children,
  size = 22,
  color = C.dim,
  style,
}) => (
  <span style={{ fontFamily: FONT.mono, fontSize: size, color, fontVariantNumeric: 'tabular-nums slashed-zero', ...style }}>{children}</span>
);

export const Pill: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color = C.blue, style }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 16px',
      borderRadius: 999,
      border: `1px solid ${color}55`,
      background: `${color}14`,
      color,
      fontFamily: FONT.mono,
      fontSize: 20,
      letterSpacing: '0.04em',
      ...style,
    }}
  >
    {children}
  </span>
);

export const Counter: React.FC<{ to: number; start: number; dur?: number; style?: React.CSSProperties; suffix?: string }> = ({
  to,
  start,
  dur = 40,
  style,
  suffix = '',
}) => {
  const frame = useT();
  const p = progress(frame, start, dur);
  const v = Math.round(to * p);
  return (
    <span style={{ fontFamily: FONT.mono, fontVariantNumeric: 'tabular-nums slashed-zero', ...style }}>
      {v.toLocaleString('en-US')}
      {suffix}
    </span>
  );
};

/** Standard slide frame: kicker + headline at top, footer with URL and slide number. */
export const SlideFrame: React.FC<{
  n: number;
  kicker: string;
  title: React.ReactNode;
  hue?: string;
  titleSize?: number;
  children?: React.ReactNode;
  showFooter?: boolean;
}> = ({ n, kicker, title, hue = C.blue, titleSize = 74, children, showFooter = true }) => {
  const nn = String(n).padStart(2, '0');
  return (
    <AbsoluteFill>
      <Backdrop hue={hue} />
      <AbsoluteFill style={{ padding: '96px 120px 0 120px' }}>
        <Rise delay={0}>
          <Kicker n={nn} label={kicker} color={hue} />
        </Rise>
        <Rise delay={4} style={{ marginTop: 28, maxWidth: 1600 }}>
          <Headline size={titleSize}>{title}</Headline>
        </Rise>
      </AbsoluteFill>
      <AbsoluteFill>{children}</AbsoluteFill>
      {showFooter ? (
        <div
          style={{
            position: 'absolute',
            left: 120,
            right: 120,
            bottom: 48,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: FONT.mono,
            fontSize: 18,
            color: C.faint,
            letterSpacing: '0.08em',
          }}
        >
          <span>
            <span style={{ color: C.dim, fontWeight: 700 }}>BOREL</span> · cartridgefi.vercel.app
          </span>
          <span>DEVNET STAGE · {nn}</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Face-down playing card used for sealed hands. */
export const SealedCard: React.FC<{ w?: number; h?: number; style?: React.CSSProperties; label?: string; color?: string }> = ({
  w = 150,
  h = 210,
  style,
  label,
  color = C.blue,
}) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: 16,
      border: `1px solid ${C.specular}`,
      background: `repeating-linear-gradient(135deg, ${color}26 0 10px, ${C.stage} 10px 20px)`,
      boxShadow: `0 20px 60px -20px ${color}66, inset 0 0 0 6px ${C.stage}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...style,
    }}
  >
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 10,
        background: C.stage,
        border: `1px solid ${C.border}`,
        fontFamily: FONT.mono,
        fontSize: 18,
        color: color,
        letterSpacing: '0.12em',
      }}
    >
      {label ?? 'SEALED'}
    </div>
  </div>
);

/** Face-up market leg card. */
export const LegCard: React.FC<{ asset: string; side: 'LONG' | 'SHORT'; mult: 1 | 2 | 3; w?: number; h?: number; style?: React.CSSProperties }> = ({
  asset,
  side,
  mult,
  w = 150,
  h = 210,
  style,
}) => {
  const sideColor = side === 'LONG' ? C.green : C.red;
  const sniper = mult === 3;
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 16,
        border: `1px solid ${sniper ? C.amber : C.specular}`,
        background: C.stage,
        boxShadow: sniper ? `0 20px 60px -16px ${C.amber}77` : '0 20px 60px -24px rgba(0,0,0,0.9)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 16,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span style={{ fontFamily: FONT.mono, fontSize: 18, color: sideColor, letterSpacing: '0.1em' }}>
        {side === 'LONG' ? '▲' : '▼'} {side}
      </span>
      <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: w * 0.22, color: C.text, letterSpacing: '-0.03em' }}>{asset}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: w < 120 ? 18 : 20, color: sniper ? C.amber : C.dim }}>{sniper ? (w < 120 ? '3x ★' : '3x SNIPER') : `${mult}x`}</span>
    </div>
  );
};
