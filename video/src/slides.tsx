import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile } from 'remotion';
import { C, FONT, PROGRAMS } from './theme';
import { Backdrop, Body, Counter, Glass, Headline, LegCard, Mono, Pill, Rise, SealedCard, SlideFrame, clamp, progress, useRise, useT } from './ui';

/* 01 · Title */
export const S01Title: React.FC = () => {
  const frame = useT();
  const fan = progress(frame, 18, 40);
  const glow = 0.6 + 0.4 * Math.sin(frame / 12);
  return (
    <AbsoluteFill>
      <Backdrop hue={C.blue} />
      <AbsoluteFill style={{ padding: '0 120px', justifyContent: 'center' }}>
        <Rise delay={0}>
          <div style={{ display: 'flex', gap: 16 }}>
            <Pill color={C.green}>● LIVE ON SOLANA DEVNET</Pill>
            <Pill color={C.amber}>MAGICBLOCK BLITZ V10 · ENTERTAINMENT FINANCE · GAMES</Pill>
          </div>
        </Rise>
        <Rise delay={6} style={{ marginTop: 36 }}>
          <Headline size={210} style={{ letterSpacing: '-0.05em' }}>
            Borel
          </Headline>
        </Rise>
        <Rise delay={14} style={{ marginTop: 24 }}>
          <Headline size={68} style={{ color: C.text, maxWidth: 900 }}>
            Fantasy trading with a <span style={{ color: C.amber }}>hidden hand.</span>
          </Headline>
        </Rise>
        <Rise delay={24} style={{ marginTop: 32, maxWidth: 860 }}>
          <Body size={30}>A trading competition with sealed hands: three live market calls, a rank-only ladder, one pivot. Every hand unseals at 00:00.</Body>
        </Rise>
        <Rise delay={34} style={{ marginTop: 48, display: 'flex', gap: 18 }}>
          <Pill color={C.violet}>MagicBlock Ephemeral Rollups</Pill>
          <Pill color={C.teal}>Solana</Pill>
          <Pill color={C.dim}>cartridgefi.vercel.app</Pill>
        </Rise>
      </AbsoluteFill>
      <AbsoluteFill>
        {[0, 1, 2].map((i) => {
          const rot = interpolate(fan, [0, 1], [0, (i - 1) * 14]);
          const x = interpolate(fan, [0, 1], [0, (i - 1) * 170]);
          const y = interpolate(fan, [0, 1], [60, Math.abs(i - 1) * 34]);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 1360 + x,
                top: 330 + y,
                transform: `rotate(${rot}deg)`,
                opacity: interpolate(frame, [10, 26], [0, 1], clamp),
              }}
            >
              <SealedCard
                w={230}
                h={330}
                color={i === 2 ? C.amber : C.blue}
                label={i === 2 ? '3x ?' : 'SEALED'}
                style={i === 2 ? { boxShadow: `0 30px 90px -20px ${C.amber}${Math.round(glow * 200).toString(16).padStart(2, '0')}, inset 0 0 0 6px ${C.stage}` } : undefined}
              />
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* 02 · Problem */
const ProblemLine: React.FC<{ delay: number; text: string; color: string }> = ({ delay, text, color }) => (
  <Rise delay={delay} style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginTop: 26 }}>
    <span style={{ width: 10, height: 10, borderRadius: 5, background: color, marginTop: 14, flexShrink: 0 }} />
    <Body size={28} color={C.text}>
      {text}
    </Body>
  </Rise>
);

export const S02Problem: React.FC = () => {
  const frame = useT();
  const line = progress(frame, 60, 70);
  const pts = Array.from({ length: 40 }, (_, i) => {
    const x = i * 17;
    const y = 90 + Math.sin(i * 0.7) * 26 + Math.sin(i * 0.23) * 30;
    return `${x},${y}`;
  }).join(' ');
  return (
    <SlideFrame n={2} kicker="Problem" title={<>Public positions get copied. And trading is a solitary screen-stare.</>} hue={C.red}>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 380, display: 'flex', gap: 48 }}>
        <Rise delay={14} style={{ flex: 1 }}>
          <Glass style={{ padding: 48, height: 520, boxSizing: 'border-box' }} glow={C.red}>
            <Mono size={20} color={C.red} style={{ letterSpacing: '0.16em' }}>
              VISIBLE = COPYABLE
            </Mono>
            <Headline size={44} style={{ marginTop: 18 }}>
              Show your hand and someone trades against it.
            </Headline>
            <ProblemLine delay={30} color={C.red} text="Open positions on public venues are readable by anyone." />
            <ProblemLine delay={40} color={C.red} text="Copy-trade bots mirror the wallets they can see." />
            <ProblemLine delay={50} color={C.red} text="Big visible entries invite front-running." />
          </Glass>
        </Rise>
        <Rise delay={24} style={{ flex: 1 }}>
          <Glass style={{ padding: 48, height: 520, boxSizing: 'border-box' }}>
            <Mono size={20} color={C.dim} style={{ letterSpacing: '0.16em' }}>
              ALONE AT A CHART
            </Mono>
            <Headline size={44} style={{ marginTop: 18 }}>
              No table, no rivals, no moment.
            </Headline>
            <Body size={28} style={{ marginTop: 26 }}>
              Calling the market is a social instinct, yet the screen gives you a candle, not a crowd that learns who was right.
            </Body>
            <svg width={680} height={180} style={{ marginTop: 28 }}>
              <polyline points={pts} fill="none" stroke={C.faint} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - line} />
            </svg>
          </Glass>
        </Rise>
      </div>
    </SlideFrame>
  );
};

/* 03 · Insight */
const InsightCard: React.FC<{ delay: number; tag: string; title: string; items: string[]; color: string; hero?: boolean }> = ({
  delay,
  tag,
  title,
  items,
  color,
  hero,
}) => (
  <Rise delay={delay} style={{ width: hero ? 520 : 440 }}>
    <Glass style={{ padding: 40, height: 420, boxSizing: 'border-box' }} glow={hero ? color : undefined}>
      <Mono size={20} color={color} style={{ letterSpacing: '0.16em' }}>
        {tag}
      </Mono>
      <Headline size={hero ? 64 : 52} style={{ marginTop: 16, color: hero ? color : C.text }}>
        {title}
      </Headline>
      <div style={{ marginTop: 28 }}>
        {items.map((it) => (
          <Body key={it} size={27} color={hero ? C.text : C.dim} style={{ marginTop: 12 }}>
            {it}
          </Body>
        ))}
      </div>
    </Glass>
  </Rise>
);

const Glyph: React.FC<{ delay: number; children: string }> = ({ delay, children }) => (
  <Rise delay={delay} style={{ fontFamily: FONT.display, fontSize: 96, color: C.faint, fontWeight: 700, width: 90, textAlign: 'center' }}>
    {children}
  </Rise>
);

export const S03Insight: React.FC = () => (
  <SlideFrame n={3} kicker="Insight" title={<>Hidden information is the game.</>} hue={C.amber}>
    <div style={{ position: 'absolute', left: 120, right: 120, top: 330, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <InsightCard delay={14} tag="POKER" title="Hidden hand" items={['Nobody sees your cards', 'You play reads, not rules', 'One reveal settles it']} color={C.dim} />
      <Glyph delay={26}>×</Glyph>
      <InsightCard delay={34} tag="FANTASY SPORTS" title="Live draft" items={['Everyone picks a lineup', 'A live leaderboard', 'Played with friends']} color={C.dim} />
      <Glyph delay={46}>=</Glyph>
      <InsightCard
        delay={56}
        tag="BOREL"
        title="Sealed market hand"
        items={['3 calls on live prices', 'Rank-only ladder', 'Every hand unseals at 00:00']}
        color={C.amber}
        hero
      />
    </div>
    <Rise delay={80} style={{ position: 'absolute', left: 120, top: 800, maxWidth: 1600 }}>
      <Body size={30}>
        In a small room nobody needs protection from copy-traders. Sealing creates <span style={{ color: C.text }}>drama, reads and a shareable reveal</span>.
      </Body>
    </Rise>
  </SlideFrame>
);

/* 04 · Product */
const Screen: React.FC<{ src: string; delay: number; label: string; caption: string; style?: React.CSSProperties; zoom?: number }> = ({
  src,
  delay,
  label,
  caption,
  style,
}) => {
  const rise = useRise(delay, 50);
  return (
    <div style={{ position: 'absolute', ...style, ...rise }}>
      <div
        style={{
          borderRadius: 18,
          overflow: 'hidden',
          border: `1px solid ${C.specular}`,
          boxShadow: '0 40px 120px -30px rgba(0,0,0,0.95)',
          background: C.stage,
        }}
      >
        <Img src={staticFile(src)} style={{ width: '100%', display: 'block' }} />
      </div>
      <div style={{ marginTop: 20 }}>
        <Mono size={20} color={C.amber} style={{ letterSpacing: '0.14em' }}>
          {label}
        </Mono>
        <Body size={26} color={C.text} style={{ marginTop: 6 }}>
          {caption}
        </Body>
      </div>
    </div>
  );
};

export const S04Product: React.FC = () => (
  <SlideFrame n={4} kicker="Product · real screens" title={<>One live window. Three sealed calls. One reveal.</>} hue={C.blue} titleSize={68}>
    <Screen src="shots/shot-sweat.png" delay={14} label="1 · SEALED" caption="Rivals face-down, only ranks move" style={{ left: 120, top: 300, width: 540 }} />
    <Screen src="shots/shot-pivot.png" delay={28} label="2 · PIVOT" caption="Live Pyth ladder, one Flip or Shield" style={{ left: 690, top: 300, width: 540 }} />
    <Screen src="shots/shot-reveal.png" delay={42} label="3 · SHOWDOWN" caption="Every hand unseals at 00:00" style={{ left: 1260, top: 300, width: 540 }} />
    <Rise delay={64} style={{ position: 'absolute', left: 120, top: 890, display: 'flex', gap: 18 }}>
      <Pill color={C.green}>Paper rooms: free, against labelled pacer bots</Pill>
      <Pill color={C.violet}>Devnet rooms: Phantom, Solflare, Backpack wallet connect</Pill>
    </Rise>
  </SlideFrame>
);

/* 05 · How a room works */
const Beat: React.FC<{ i: number; delay: number; title: string; text: string; color: string; children: React.ReactNode }> = ({
  i,
  delay,
  title,
  text,
  color,
  children,
}) => (
  <Rise delay={delay} style={{ width: 316 }}>
    <Glass style={{ padding: 28, height: 470, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <Mono size={18} color={color} style={{ letterSpacing: '0.16em' }}>
        STEP {i}
      </Mono>
      <Headline size={44} style={{ marginTop: 10 }}>
        {title}
      </Headline>
      <div style={{ height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>{children}</div>
      <Body size={23} style={{ marginTop: 'auto' }}>
        {text}
      </Body>
    </Glass>
  </Rise>
);

export const S05Room: React.FC = () => {
  const frame = useT();
  const bar = progress(frame, 20, 110);
  const secs = Math.round(180 * (1 - bar));
  const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const flip = progress(frame, 100, 20);
  return (
    <SlideFrame n={5} kicker="How a room works" title={<>Draft, seal, sweat, pivot once, then the showdown.</>} hue={C.green}>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 330, display: 'flex', justifyContent: 'space-between' }}>
        <Beat i={1} delay={12} title="Draft" color={C.green} text="Three markets from SOL, BTC, ETH, NVDAx, SPY. Long or Short each.">
          <div style={{ display: 'flex', gap: 8 }}>
            <LegCard asset="SOL" side="LONG" mult={2} w={82} h={120} />
            <LegCard asset="BTC" side="SHORT" mult={1} w={82} h={120} />
            <LegCard asset="ETH" side="LONG" mult={3} w={82} h={120} />
          </div>
        </Beat>
        <Beat i={2} delay={22} title="Seal" color={C.blue} text="1x, 2x, 3x cards once each. The 3x is your secret Sniper.">
          <div style={{ display: 'flex', gap: 8 }}>
            {[0, 1, 2].map((k) => (
              <SealedCard key={k} w={82} h={120} label="?" color={k === 2 ? C.amber : C.blue} />
            ))}
          </div>
        </Beat>
        <Beat i={3} delay={32} title="Sweat" color={C.teal} text="Live Pyth prices move the ladder. Rivals only see ranks.">
          <div style={{ width: '100%' }}>
            {['#1  rival', '#2  you', '#3  rival'].map((r, k) => (
              <div
                key={r}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  marginTop: 8,
                  borderRadius: 10,
                  background: k === 1 ? `${C.teal}22` : C.stage,
                  border: `1px solid ${k === 1 ? C.teal : C.border}`,
                }}
              >
                <Mono size={20} color={k === 1 ? C.teal : C.dim}>
                  {r}
                </Mono>
                <Mono size={20} color={C.faint}>
                  ▒▒▒
                </Mono>
              </div>
            ))}
          </div>
        </Beat>
        <Beat i={4} delay={42} title="Pivot" color={C.violet} text="One move per round: Flip a call, or Shield it to bank the move.">
          <div style={{ display: 'flex', gap: 12 }}>
            <Pill color={C.violet} style={{ fontSize: 24, padding: '14px 22px' }}>
              FLIP
            </Pill>
            <Pill color={C.dim} style={{ fontSize: 24, padding: '14px 22px' }}>
              SHIELD
            </Pill>
          </div>
        </Beat>
        <Beat i={5} delay={52} title="Showdown" color={C.amber} text="At 00:00 every hand unseals. Card × move, summed. Best read wins.">
          <div style={{ display: 'flex', gap: 8, transform: `scaleX(${Math.abs(1 - 2 * flip) || 0.02})` }}>
            {flip < 0.5
              ? [0, 1, 2].map((k) => <SealedCard key={k} w={82} h={120} label="?" color={k === 2 ? C.amber : C.blue} />)
              : [
                  <LegCard key="a" asset="SOL" side="LONG" mult={2} w={82} h={120} />,
                  <LegCard key="b" asset="BTC" side="SHORT" mult={1} w={82} h={120} />,
                  <LegCard key="c" asset="ETH" side="LONG" mult={3} w={82} h={120} />,
                ]}
          </div>
        </Beat>
      </div>
      <Rise delay={16} style={{ position: 'absolute', left: 120, right: 120, top: 840 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Mono size={30} color={C.text} style={{ fontWeight: 700, width: 110 }}>
            {clock}
          </Mono>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
            <div style={{ width: `${bar * 100}%`, height: '100%', background: `linear-gradient(90deg, ${C.green}, ${C.amber})` }} />
          </div>
          <Mono size={20} color={C.faint}>
            BLITZ ROOM · 3 MIN
          </Mono>
        </div>
      </Rise>
    </SlideFrame>
  );
};

/* 06 · Architecture */
type NodeSpec = { x: number; y: number; w: number; h: number; layer: 'L1' | 'ER' | 'BRIDGE'; tag: string; title: string; lines: string[] };

const layerColor = (l: NodeSpec['layer']) => (l === 'L1' ? C.teal : l === 'ER' ? C.violet : C.blue);

const ArchNode: React.FC<{ n: NodeSpec; delay: number }> = ({ n, delay }) => {
  const rise = useRise(delay, 20);
  const color = layerColor(n.layer);
  return (
    <div style={{ position: 'absolute', left: n.x, top: n.y, width: n.w, height: n.h, ...rise }}>
      <Glass style={{ width: '100%', height: '100%', padding: '20px 24px', boxSizing: 'border-box', borderRadius: 18 }} glow={color}>
        <Mono size={16} color={color} style={{ letterSpacing: '0.16em' }}>
          {n.tag}
        </Mono>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 30, color: C.text, letterSpacing: '-0.02em', marginTop: 6 }}>{n.title}</div>
        {n.lines.map((l) => (
          <div key={l} style={{ marginTop: 7 }}>
            <Mono size={18} color={C.dim}>
              {l}
            </Mono>
          </div>
        ))}
      </Glass>
    </div>
  );
};

const Arrow: React.FC<{ d: string; start: number; dur?: number; color: string; label?: string; lx?: number; ly?: number; anchor?: 'start' | 'middle' | 'end'; dashed?: boolean }> = ({
  d,
  start,
  dur = 14,
  color,
  label,
  lx = 0,
  ly = 0,
  anchor = 'middle',
  dashed,
}) => {
  const frame = useT();
  const p = progress(frame, start, dur);
  const lo = interpolate(frame, [start + dur * 0.6, start + dur + 6], [0, 1], clamp);
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={3} pathLength={1} strokeDasharray={dashed ? '0.02 0.015' : 1} strokeDashoffset={dashed ? 0 : 1 - p} opacity={dashed ? p : 1} markerEnd={p > 0.95 ? 'url(#arrowhead)' : undefined} />
      {label ? (
        <text x={lx} y={ly} fill={C.dim} fontFamily={FONT.mono} fontSize={17} textAnchor={anchor} opacity={lo}>
          {label}
        </text>
      ) : null}
    </g>
  );
};

export const S06Architecture: React.FC = () => {
  const nodes: NodeSpec[] = [
    {
      x: 120,
      y: 320,
      w: 470,
      h: 270,
      layer: 'L1',
      tag: 'SOLANA DEVNET · L1',
      title: 'Borel programs',
      lines: [`er_room   ${PROGRAMS.room.id}`, `registry  ${PROGRAMS.registry.id}`, `vault     ${PROGRAMS.vault.id}`, `passport  ${PROGRAMS.passport.id}`],
    },
    { x: 725, y: 320, w: 470, h: 270, layer: 'BRIDGE', tag: 'L1 → MAGICBLOCK', title: 'Delegation', lines: [`${PROGRAMS.delegation.id}`, 'delegate_room_shard', 'init_stance_and_delegate', 'relayer-paid: 0 popups, $0 gas'] },
    {
      x: 1330,
      y: 320,
      w: 470,
      h: 270,
      layer: 'ER',
      tag: '① SEALED HANDS · ② LIVE LADDER',
      title: 'Private stances on the ER',
      lines: [`Permission ${PROGRAMS.permission.id}`, 'join_room_and_init_permission', 'submit_stance: seal + 1 pivot', 'max_rebalances = 2 on-chain'],
    },
    { x: 1330, y: 690, w: 470, h: 230, layer: 'ER', tag: '③ FAIR + AUDITABLE', title: 'VRF + 00:00 unseal', lines: ['request_settlement_vrf 4qbDtCva…', 'trigger_showdown_unseal', 'evaluate_player_score (i128)'] },
    { x: 725, y: 690, w: 470, h: 230, layer: 'ER', tag: 'ER → L1', title: 'Commit + undelegate', lines: ['undelegate_player_stance', 'settle_and_commit_shard'] },
    { x: 120, y: 690, w: 470, h: 230, layer: 'L1', tag: 'SOLANA DEVNET · L1', title: 'Settled on Solana', lines: ['test-USDC payout + 1% fee', '→ platformFeeAccount 6LU5nN…frn8', 'record_elo on the passport'] },
  ];
  const delays = [10, 34, 58, 82, 104, 124];
  return (
    <SlideFrame n={6} kicker="Architecture" title={<>Hands stay sealed in a MagicBlock rollup. Results settle on Solana.</>} hue={C.violet} titleSize={64}>
      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0 }}>
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={C.dim} />
          </marker>
        </defs>
        <Arrow d="M 590 455 L 720 455" start={24} color={C.teal} />
        <Arrow d="M 1195 455 L 1325 455" start={48} color={C.blue} />
        <Arrow d="M 1565 590 L 1565 685" start={72} color={C.violet} label="00:00" lx={1590} ly={645} anchor="start" />
        <Arrow d="M 1330 805 L 1200 805" start={94} color={C.violet} />
        <Arrow d="M 725 805 L 595 805" start={114} color={C.teal} />
        <Arrow d="M 355 690 L 355 595" start={134} dur={10} color={C.faint} dashed />
      </svg>
      {nodes.map((n, i) => (
        <ArchNode key={n.title} n={n} delay={delays[i]} />
      ))}
      <Rise delay={140} style={{ position: 'absolute', left: 120, bottom: 92, display: 'flex', gap: 28 }}>
        <Mono size={18} color={C.teal}>■ Solana L1</Mono>
        <Mono size={18} color={C.violet}>■ MagicBlock Ephemeral Rollup</Mono>
        <Mono size={18} color={C.blue}>■ Delegation bridge</Mono>
        <Mono size={18} color={C.faint}>All instructions above ran on devnet, 2026-11-27</Mono>
      </Rise>
    </SlideFrame>
  );
};

/* 07 · Live proof */
const ProofStat: React.FC<{ delay: number; to: number; label: string; sub: string; color: string }> = ({ delay, to, label, sub, color }) => (
  <Rise delay={delay} style={{ flex: 1 }}>
    <Glass style={{ padding: 40, height: 380, boxSizing: 'border-box' }} glow={color}>
      <Counter to={to} start={delay + 6} dur={36} style={{ fontSize: 150, fontWeight: 700, color, letterSpacing: '-0.04em', lineHeight: 1 }} />
      <Headline size={36} style={{ marginTop: 16 }}>
        {label}
      </Headline>
      <Body size={23} style={{ marginTop: 12 }}>
        {sub}
      </Body>
    </Glass>
  </Rise>
);

export const S07Proof: React.FC = () => {
  const frame = useT();
  const layers = [...Array(7).fill('L1'), ...Array(14).fill('ER'), ...Array(6).fill('L1')] as string[];
  return (
    <SlideFrame n={7} kicker="Live proof · Solana devnet" title={<>A full staked, sealed room has run on devnet.</>} hue={C.teal}>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 330, display: 'flex', gap: 40 }}>
        <ProofStat delay={12} to={27} label="confirmed devnet transactions" sub="One Borel room, join to payout, own-authority run 2026-11-27" color={C.teal} />
        <ProofStat delay={24} to={14} label="executed on the MagicBlock ER" sub="private join, seal, pivot, VRF, unseal, score, commit" color={C.violet} />
        <Rise delay={36} style={{ flex: 1 }}>
          <Glass style={{ padding: 40, height: 380, boxSizing: 'border-box' }} glow={C.green}>
            <Counter to={1} start={42} dur={20} suffix="%" style={{ fontSize: 150, fontWeight: 700, color: C.green, letterSpacing: '-0.04em', lineHeight: 1 }} />
            <Headline size={36} style={{ marginTop: 16 }}>
              fee into platformFeeAccount
            </Headline>
            <Body size={23} style={{ marginTop: 12 }}>
              Real SPL stakes (test-USDC), winner paid, passport ELO recorded
            </Body>
          </Glass>
        </Rise>
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 760 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {layers.map((l, i) => {
            const on = interpolate(frame, [56 + i * 2.4, 62 + i * 2.4], [0, 1], clamp);
            const col = l === 'L1' ? C.teal : C.violet;
            return <div key={i} style={{ flex: 1, height: 44, borderRadius: 8, background: col, opacity: 0.15 + 0.85 * on, boxShadow: on > 0.9 ? `0 0 20px ${col}66` : undefined }} />;
          })}
        </div>
        <Rise delay={120} style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between' }}>
          <Mono size={19}>VRF 4qbDtCva…VNRw</Mono>
          <Mono size={19}>settle 4XUDfYKH…mokQ</Mono>
          <Mono size={19}>1% fee 2oTzABoi…hPKi</Mono>
          <Mono size={19} color={C.green}>0 wallet popups · $0 player gas</Mono>
          <Mono size={19} color={C.teal}>solscan.io · docs/DEVNET_PROOF.md</Mono>
        </Rise>
      </div>
    </SlideFrame>
  );
};

/* 08 · Why now */
const NowCard: React.FC<{ delay: number; tag: string; title: string; text: string; color: string }> = ({ delay, tag, title, text, color }) => (
  <Rise delay={delay} style={{ flex: 1 }}>
    <Glass style={{ padding: 44, height: 500, boxSizing: 'border-box' }}>
      <div style={{ width: 56, height: 6, borderRadius: 3, background: color }} />
      <Mono size={20} color={color} style={{ letterSpacing: '0.16em', display: 'block', marginTop: 28 }}>
        {tag}
      </Mono>
      <Headline size={46} style={{ marginTop: 16 }}>
        {title}
      </Headline>
      <Body size={26} style={{ marginTop: 22 }}>
        {text}
      </Body>
    </Glass>
  </Rise>
);

export const S08WhyNow: React.FC = () => (
  <SlideFrame n={8} kicker="Why now" title={<>Private, real-time state on Solana is finally practical.</>} hue={C.violet}>
    <div style={{ position: 'absolute', left: 120, right: 120, top: 360, display: 'flex', gap: 40 }}>
      <NowCard
        delay={14}
        tag="INFRA"
        color={C.violet}
        title="Rollups that keep a secret"
        text="MagicBlock Ephemeral Rollups add access-controlled state (Permission Program) and VRF, then commit back to Solana."
      />
      <NowCard delay={26} tag="MARKETS" color={C.teal} title="Draftable markets on-chain" text="Pyth streams crypto and tokenized-equity prices (xStocks such as NVDAx) that a room can score in real time." />
      <NowCard
        delay={38}
        tag="BEHAVIOUR"
        color={C.amber}
        title="Calling outcomes is mainstream"
        text="Prediction markets made it a habit. MagicBlock's Entertainment Finance push names trading competitions outright."
      />
    </div>
  </SlideFrame>
);

/* 09 · Competition */
const Dot: React.FC<{ x: number; y: number; delay: number; label: string; sub: string; color: string; hero?: boolean; align?: 'left' | 'right' }> = ({
  x,
  y,
  delay,
  label,
  sub,
  color,
  hero,
  align = 'left',
}) => {
  const rise = useRise(delay, 14);
  const size = hero ? 34 : 22;
  return (
    <div style={{ position: 'absolute', left: x, top: y, ...rise }}>
      <div style={{ width: size, height: size, borderRadius: size / 2, background: color, boxShadow: hero ? `0 0 40px ${color}` : undefined, transform: 'translate(-50%, -50%)' }} />
      <div
        style={{
          position: 'absolute',
          top: -22,
          [align === 'left' ? 'left' : 'right']: align === 'left' ? 30 : size + 24,
          whiteSpace: 'nowrap',
          textAlign: align,
        }}
      >
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: hero ? 40 : 30, color: hero ? color : C.text, letterSpacing: '-0.02em' }}>{label}</div>
        <Mono size={18} color={C.dim}>
          {sub}
        </Mono>
      </div>
    </div>
  );
};

export const S09Competition: React.FC = () => {
  const frame = useT();
  const ax = progress(frame, 8, 24);
  const X0 = 240;
  const X1 = 1680;
  const Y0 = 330;
  const Y1 = 940;
  const mx = (X0 + X1) / 2;
  const my = (Y0 + Y1) / 2;
  return (
    <SlideFrame n={9} kicker="Competition" title={<>Others show the squad. Borel seals the hand.</>} hue={C.amber}>
      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0 }}>
        <line x1={mx} y1={Y0} x2={mx} y2={Y0 + (Y1 - Y0) * ax} stroke={C.faint} strokeWidth={2} />
        <line x1={X0} y1={my} x2={X0 + (X1 - X0) * ax} y2={my} stroke={C.faint} strokeWidth={2} />
        <rect x={mx} y={Y0} width={(X1 - mx) * ax} height={my - Y0} fill={`${C.amber}0D`} />
      </svg>
      <Rise delay={20} style={{ position: 'absolute', left: mx + 16, top: Y0 }}>
        <Mono size={18} color={C.faint}>▲ HAND SEALED UNTIL REVEAL</Mono>
      </Rise>
      <Rise delay={20} style={{ position: 'absolute', left: mx + 16, top: Y1 - 26 }}>
        <Mono size={18} color={C.faint}>▼ POSITIONS PUBLIC</Mono>
      </Rise>
      <Rise delay={20} style={{ position: 'absolute', left: X0, top: my + 14 }}>
        <Mono size={18} color={C.faint}>◀ QUESTIONS & CARDS</Mono>
      </Rise>
      <Rise delay={20} style={{ position: 'absolute', right: 1920 - X1, top: my + 14 }}>
        <Mono size={18} color={C.faint}>LIVE MARKETS ▶</Mono>
      </Rise>
      <Dot x={300} y={440} delay={34} label="Herd" sub="sealed answers in a Private ER + VRF · Blitz v8 1st" color={C.dim} />
      <Dot x={1060} y={760} delay={46} label="Crypto Fantasy League" sub="public PvP squads on ER + Pyth · Colosseum Breakout" color={C.dim} />
      <Dot x={1060} y={856} delay={56} label="Polymarket · Kalshi" sub="event contracts, public order books" color={C.dim} />
      <Dot x={1560} y={430} delay={76} label="Borel" sub="sealed hands on live markets" color={C.amber} hero align="right" />
    </SlideFrame>
  );
};

/* 10 · Business model */
const BizCard: React.FC<{ delay: number; big: string; title: string; text: string; status: string; statusColor: string; color: string }> = ({
  delay,
  big,
  title,
  text,
  status,
  statusColor,
  color,
}) => (
  <Rise delay={delay} style={{ flex: 1 }}>
    <Glass style={{ padding: 44, height: 540, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <Mono size={88} color={color} style={{ fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>
        {big}
      </Mono>
      <Headline size={42} style={{ marginTop: 26 }}>
        {title}
      </Headline>
      <Body size={25} style={{ marginTop: 18 }}>
        {text}
      </Body>
      <div style={{ marginTop: 'auto' }}>
        <Pill color={statusColor}>{status}</Pill>
      </div>
    </Glass>
  </Rise>
);

export const S10Business: React.FC = () => (
  <SlideFrame n={10} kicker="Business model" title={<>Revenue is a protocol fee in bps, routed <span style={{ whiteSpace: 'nowrap' }}>on-chain.</span></>} hue={C.blue}>
    <div style={{ position: 'absolute', left: 120, right: 120, top: 340, display: 'flex', gap: 40 }}>
      <BizCard
        delay={14}
        big="bps"
        color={C.blue}
        title="Protocol fee"
        text="A basis-point fee on staked rooms. The devnet run routed 1% of a test-USDC pot into platformFeeAccount 6LU5nN…frn8."
        status="LIVE ON DEVNET · TEST-USDC"
        statusColor={C.teal}
      />
      <BizCard
        delay={26}
        big="$→"
        color={C.amber}
        title="Sponsored rooms"
        text="A protocol or brand funds the prize pool for a game-day window; players join free."
        status="PLANNED"
        statusColor={C.amber}
      />
      <BizCard
        delay={38}
        big="50/50"
        color={C.violet}
        title="Creator / host split"
        text="vault_router already splits fees 50/50 or 40/30/30. Hosts who fill rooms earn a share."
        status="IN PROGRAM · PLANNED FOR HOSTS"
        statusColor={C.violet}
      />
    </div>
  </SlideFrame>
);

/* 11 · Roadmap */
const Phase: React.FC<{ delay: number; tag: string; title: string; items: string[]; color: string; active?: boolean }> = ({ delay, tag, title, items, color, active }) => (
  <Rise delay={delay} style={{ flex: 1 }}>
    <Glass style={{ padding: 40, height: 470, boxSizing: 'border-box' }} glow={active ? color : undefined}>
      <Mono size={20} color={color} style={{ letterSpacing: '0.16em' }}>
        {tag}
      </Mono>
      <Headline size={46} style={{ marginTop: 14 }}>
        {title}
      </Headline>
      {items.map((it) => (
        <div key={it} style={{ display: 'flex', gap: 14, marginTop: 20 }}>
          <span style={{ color, fontFamily: FONT.mono, fontSize: 24 }}>{active ? '✓' : '○'}</span>
          <Body size={25} color={active ? C.text : C.dim}>
            {it}
          </Body>
        </div>
      ))}
    </Glass>
  </Rise>
);

export const S11Roadmap: React.FC = () => {
  const frame = useT();
  const line = progress(frame, 10, 60);
  return (
    <SlideFrame n={11} kicker="Roadmap" title={<>Devnet today. The private path next. Mainnet after an audit.</>} hue={C.teal}>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 318, height: 4, background: C.border, borderRadius: 2 }}>
        <div style={{ width: `${line * 100}%`, height: '100%', background: `linear-gradient(90deg, ${C.teal}, ${C.violet}, ${C.faint})`, borderRadius: 2 }} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 350, display: 'flex', gap: 40 }}>
        <Phase
          delay={14}
          tag="NOW · SHIPPED"
          title="Playable on devnet"
          color={C.teal}
          active
          items={['Paper + devnet rooms, wallet connect live', '27-tx room: stakes, 1% fee, passport ELO', 'Labelled pacer rivals on live Pyth prices']}
        />
        <Phase
          delay={26}
          tag="NEXT"
          title="Private by default"
          color={C.violet}
          items={['Live app seals via submit_stance on the ER', 'VRF tie-break in-app (today: blockhash)', 'Payouts via vault_router (today: relayer escrow)']}
        />
        <Phase delay={38} tag="LATER" title="Mainnet beta" color={C.dim} items={['Audit, then paper-first mainnet', 'Sponsored game-day rooms', 'Cross-game ELO passport + reveal receipts']} />
      </div>
      <Rise delay={70} style={{ position: 'absolute', left: 120, top: 860 }}>
        <Body size={26}>
          North-star metric: <span style={{ color: C.text }}>second-room starts per first room</span>. Does the reveal bring players back?
        </Body>
      </Rise>
    </SlideFrame>
  );
};

/* 12 · Vision & ask */
export const S12Ask: React.FC = () => (
  <SlideFrame n={12} kicker="Vision & ask" title={<>Every live market window can be a table.</>} hue={C.amber} titleSize={92}>
    <Rise delay={14} style={{ position: 'absolute', left: 120, top: 380, maxWidth: 1300 }}>
      <Body size={32}>Borel turns watching the market into a game you play with friends: hands sealed, rank on the ladder, one reveal at 00:00.</Body>
    </Rise>
    <div style={{ position: 'absolute', left: 120, right: 120, top: 540, display: 'flex', gap: 32 }}>
      {[
        { t: 'Hosts & communities', d: 'to run the first sealed rooms and game-day windows', c: C.amber },
        { t: 'Ecosystem support', d: 'to take the Private ER path from devnet to mainnet', c: C.violet },
        { t: 'Players', d: 'to tell us whether the reveal brings them back', c: C.teal },
      ].map((a, i) => (
        <Rise key={a.t} delay={30 + i * 10} style={{ flex: 1 }}>
          <Glass style={{ padding: 36, height: 230, boxSizing: 'border-box' }}>
            <Mono size={18} color={a.c} style={{ letterSpacing: '0.16em' }}>
              WE&apos;RE LOOKING FOR
            </Mono>
            <Headline size={40} style={{ marginTop: 14 }}>
              {a.t}
            </Headline>
            <Body size={25} style={{ marginTop: 12 }}>
              {a.d}
            </Body>
          </Glass>
        </Rise>
      ))}
    </div>
    <Rise delay={70} style={{ position: 'absolute', left: 120, top: 850, display: 'flex', alignItems: 'center', gap: 28 }}>
      <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 56, color: C.text, letterSpacing: '-0.03em' }}>cartridgefi.vercel.app</span>
      <Pill color={C.green}>PLAY A ROOM NOW</Pill>
    </Rise>
  </SlideFrame>
);

export const SLIDES: { id: string; C: React.FC }[] = [
  { id: 'slide-01', C: S01Title },
  { id: 'slide-02', C: S02Problem },
  { id: 'slide-03', C: S03Insight },
  { id: 'slide-04', C: S04Product },
  { id: 'slide-05', C: S05Room },
  { id: 'slide-06', C: S06Architecture },
  { id: 'slide-07', C: S07Proof },
  { id: 'slide-08', C: S08WhyNow },
  { id: 'slide-09', C: S09Competition },
  { id: 'slide-10', C: S10Business },
  { id: 'slide-11', C: S11Roadmap },
  { id: 'slide-12', C: S12Ask },
];
