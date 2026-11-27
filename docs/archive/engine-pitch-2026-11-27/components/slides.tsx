import type * as React from "react";
import styles from "./pitch.module.css";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { LiveLiquidity } from "./LiveLiquidity";
import {
  ARENA_CREATOR_FEE_UNITS,
  ARENA_PLATFORM_FEE_UNITS,
  BOREL_MANIFEST_PDA,
  DEVNET_MINT_DECIMALS,
  LINKED_ACCOUNTS,
  PLATFORM_FEE_ACCOUNT,
  PLATFORM_FEE_BALANCE_UNITS,
  PROGRAMS,
  PULSE_MANIFEST_PDA,
  SLIDE_COUNT,
  TX_ER,
  TX_L1,
  TX_TEE,
  TX_TOTAL,
  VAULT_CONSTANTS,
  VERIFIED_AT_UTC,
  formatUnits,
  formatUtc,
  groupDigits,
  shortKey,
  solscanAccount,
} from "./facts";

export type SlideProps = { index: number };

const C = {
  void: "#050609",
  elevated: "#0a0d14",
  hair: "#1a1f2b",
  hairStrong: "#2a3140",
  fg: "#f3f4f6",
  fg2: "#a3aab6",
  fg3: "#6b7280",
  blue: "#3b82f6",
  amber: "#f5a524",
  green: "#22c08a",
};

const DISPLAY = '"Plus Jakarta Sans", var(--font-inter), sans-serif';
const MONO = "var(--font-jetbrains), ui-monospace, monospace";
const mono: React.CSSProperties = { fontFamily: MONO, fontVariantNumeric: "tabular-nums slashed-zero" };
const display: React.CSSProperties = { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 0.98 };

function Mark({ size = 30 }: { size?: number }) {
  // Cartridge silhouette: a body with a notched label edge.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 3h16l4 4v22H6z" fill="none" stroke={C.fg} strokeWidth={2.4} strokeLinejoin="round" />
      <path d="M11 9h10v8H11z" fill={C.blue} />
      <path d="M10 24h2M14 24h2M18 24h2M22 24h0" stroke={C.fg} strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}

function Frame({
  index,
  headline,
  source,
  children,
  bodyStyle,
}: {
  index: number;
  headline: React.ReactNode;
  source: string;
  children: React.ReactNode;
  bodyStyle?: React.CSSProperties;
}) {
  return (
    <section className={styles.slide} data-slide={index} aria-label={`Slide ${index} of ${SLIDE_COUNT}`}>
      <h2 className={styles.headline}>{headline}</h2>
      <div className={styles.body} style={bodyStyle}>
        {children}
      </div>
      <Footer index={index} source={source} />
    </section>
  );
}

function Footer({ index, source }: { index: number; source: string }) {
  return (
    <footer className={styles.footer}>
      <span className={styles.footerBrand}>
        <Mark size={22} />
        CartridgeFi
      </span>
      <span className={styles.footerSource}>{source}</span>
      <span className={styles.footerCount}>
        {String(index).padStart(2, "0")} / {SLIDE_COUNT}
      </span>
    </footer>
  );
}

function Key({ value, head = 6, tail = 4, color = C.fg2, size = 17 }: { value: string; head?: number; tail?: number; color?: string; size?: number }) {
  return (
    <a
      href={solscanAccount(value)}
      target="_blank"
      rel="noreferrer"
      style={{ ...mono, color, fontSize: size, textDecoration: "none", pointerEvents: "auto" }}
      title={value}
    >
      {shortKey(value, head, tail)}
    </a>
  );
}

/* ------------------------------------------------------------------ 01 */

function TitleSlide({ index }: SlideProps) {
  return (
    <section className={styles.slide} data-slide={index} aria-label={`Slide ${index} of ${SLIDE_COUNT}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Mark size={44} />
        <span style={{ ...display, fontSize: 44, letterSpacing: "-0.03em" }}>CartridgeFi</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 140 }}>
        <h1 style={{ ...display, fontSize: 112, margin: 0, maxWidth: 1580, textWrap: "balance" }}>
          The execution &amp; settlement engine for <span style={{ whiteSpace: "nowrap" }}>real-market</span> apps on Solana.
        </h1>
        <p style={{ margin: "48px 0 0", fontSize: 34, lineHeight: 1.3, color: C.fg2, maxWidth: 1600 }}>
          Parameterized Anchor programs on MagicBlock ephemeral rollups. No custom contracts per app.
        </p>
      </div>
      <div
        style={{
          position: "absolute",
          left: 128,
          right: 128,
          bottom: 48,
          display: "flex",
          gap: 56,
          paddingTop: 22,
          borderTop: `1px solid ${C.hair}`,
          ...mono,
          fontSize: 19,
          color: C.fg2,
        }}
      >
        <span>Seed stage</span>
        <span>
          <span style={{ color: C.green }}>●</span> Live on Solana devnet
        </span>
        <span>{PROGRAMS.length} programs deployed</span>
        <span style={{ marginLeft: "auto", color: C.fg3 }}>
          01 / {SLIDE_COUNT}
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 02 */

const WALLS = [
  { stat: "~400 ms", label: "Slow blocks", detail: "One L1 slot per move is too slow for live multiplayer play" },
  { stat: "1 popup", label: "Wallet friction", detail: "A signature prompt for every single action" },
  { stat: "Public", label: "Copy-trade leakage", detail: "Open account state lets rivals mirror positions live" },
  { stat: "Months", label: "Custom contracts", detail: "Every new app needs its own program and audit" },
];

function ProblemSlide({ index }: SlideProps) {
  return (
    <Frame
      index={index}
      headline="Market liquidity is already on-chain. Consumer market apps hit four walls before launch."
      source="Solana L1 slot target ≈ 400 ms · markets: tokenized stocks, perps, prediction markets"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 48 }}>
        {WALLS.map((w) => (
          <div key={w.label} style={{ borderTop: `2px solid ${C.hairStrong}`, paddingTop: 36 }}>
            <div style={{ ...mono, fontSize: 68, fontWeight: 500, letterSpacing: "-0.03em", color: C.fg }}>{w.stat}</div>
            <div style={{ marginTop: 36, fontSize: 30, fontWeight: 600, letterSpacing: "-0.015em" }}>{w.label}</div>
            <div style={{ marginTop: 14, fontSize: 24, lineHeight: 1.35, color: C.fg2 }}>{w.detail}</div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 03 */

const PRIMITIVES = [
  { name: "MagicBlock ephemeral rollups", detail: "Delegate accounts, update in real time, commit back to L1" },
  { name: "Intel TDX private rollups", detail: "Hardware-sealed state with a programmable unseal" },
  { name: "xStocks · Kalshi via DFlow", detail: "Equities and event contracts as Solana SPL tokens" },
  { name: "Coding agents", detail: "Prompt-built apps need a safe, standard backend" },
];

function WhyNowSlide({ index }: SlideProps) {
  return (
    <Frame
      index={index}
      headline={
        <>
          Fast private rollups and tokenized <span style={{ whiteSpace: "nowrap" }}>real-world</span> markets now exist on Solana.
        </>
      }
      source="Live figures fetched from /api/markets at render time · Raydium pools via DexScreener"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 96, rowGap: 56 }}>
        {PRIMITIVES.map((p, i) => (
          <div key={p.name} style={{ display: "grid", gridTemplateColumns: "72px 1fr", alignItems: "baseline" }}>
            <span style={{ ...mono, fontSize: 22, color: C.fg3 }}>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em" }}>{p.name}</div>
              <div style={{ marginTop: 12, fontSize: 25, lineHeight: 1.35, color: C.fg2 }}>{p.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <LiveLiquidity
        style={{
          marginTop: 72,
          display: "flex",
          flexWrap: "wrap",
          gap: "12px 36px",
          padding: "22px 28px",
          border: `1px solid ${C.hair}`,
          borderRadius: 12,
          background: C.elevated,
          ...mono,
          fontSize: 19,
        }}
      />
    </Frame>
  );
}

/* ------------------------------------------------------------------ 04 */

function SolutionSlide({ index }: SlideProps) {
  return (
    <Frame
      index={index}
      headline="Four parameterized Anchor programs replace a custom contract for every market app."
      source="programs/* · program IDs from docs/DEVNET_PROOF.md · caps from cartridge_vault_router (MAX_LIVE_LEVERAGE, BETA_MAX_ROOM_POOL_USDC)"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
        {PROGRAMS.map((p, i) => (
          <div
            key={p.key}
            style={{
              background: C.elevated,
              border: `1px solid ${C.hair}`,
              borderRadius: 14,
              padding: "32px 30px 28px",
              height: 330,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ ...mono, fontSize: 18, color: C.fg3 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ ...display, fontSize: 42, marginTop: 20 }}>{p.name}</span>
            <span style={{ marginTop: 18, fontSize: 22, lineHeight: 1.4, color: C.fg2 }}>{p.role}</span>
            <span style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Key value={p.id} size={17} />
              <span style={{ ...mono, fontSize: 15, color: C.green }}>devnet</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 40 }}>
        <div style={{ borderTop: `1px solid ${C.hairStrong}`, paddingTop: 24 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>Session risk envelopes</div>
          <div style={{ marginTop: 10, fontSize: 23, color: C.fg2 }}>
            Scoped session key · leverage ≤ {VAULT_CONSTANTS.maxLiveLeverage}× · room pool ≤{" "}
            {VAULT_CONSTANTS.betaMaxRoomPoolUsdc} USDC during beta
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.hairStrong}`, paddingTop: 24 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>Gasless onboarding</div>
          <div style={{ marginTop: 10, fontSize: 23, color: C.fg2 }}>
            Kora fee sponsorship behind a program allowlist; no SOL needed to play
          </div>
        </div>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 05 */

function ArchitectureSlide({ index }: SlideProps) {
  return (
    <Frame
      index={index}
      headline="One room, end to end: escrow on L1, play in a rollup, seal stances in a TEE, settle on L1."
      source={`Each step maps to a verified transaction in docs/DEVNET_PROOF.md §3 (verified ${formatUtc(VERIFIED_AT_UTC)})`}
      bodyStyle={{ paddingBottom: 128 }}
    >
      <ArchitectureDiagram />
    </Frame>
  );
}

/* ------------------------------------------------------------------ 06 */

const PRODUCT_ROWS: { label: string; borel: React.ReactNode; pulse: React.ReactNode; mono?: boolean }[] = [
  { label: "Genre", borel: "Game-day conviction arena", pulse: "3-lane arcade runner" },
  { label: "Round", borel: "60 s", pulse: "90 s", mono: true },
  { label: "Privacy", borel: "TEE fog of war · 75% of clock", pulse: "TEE fog of war · 75% of clock" },
  { label: "Scoring formula", borel: "DIRECTION_NEUTRAL_REL_RETURN", pulse: "DIRECTION_NEUTRAL_SHARPE_PLUS_SURVIVAL", mono: true },
  { label: "Markets", borel: "SOL-PERP · NVDAx · SPYx · Kalshi", pulse: "SOL-PERP · NVDAx · Kalshi", mono: true },
  { label: "Manifest on devnet", borel: <Key value={BOREL_MANIFEST_PDA} color={C.fg} size={19} />, pulse: <Key value={PULSE_MANIFEST_PDA} color={C.fg} size={19} /> },
  { label: "Custom Rust", borel: "0 lines", pulse: "0 lines", mono: true },
];

function ProductSlide({ index }: SlideProps) {
  const cell: React.CSSProperties = { padding: "13px 0", borderTop: `1px solid ${C.hair}`, fontSize: 23 };
  return (
    <Frame
      index={index}
      headline="Two different games, the same four programs. Each game is a manifest, not a contract."
      source="packages/shared-types/src/manifest.ts · both manifest PDAs are owned by cartridge_registry on devnet"
      bodyStyle={{ paddingBottom: 132 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 1fr", columnGap: 48 }}>
        <div />
        <div style={{ paddingBottom: 18 }}>
          <div style={{ ...display, fontSize: 40 }}>Borel</div>
          <div style={{ ...mono, marginTop: 8, fontSize: 18, color: C.fg3 }}>#001 · /play/borel</div>
        </div>
        <div style={{ paddingBottom: 18 }}>
          <div style={{ ...display, fontSize: 40 }}>Pulse Runner</div>
          <div style={{ ...mono, marginTop: 8, fontSize: 18, color: C.fg3 }}>#002 · /play/pulse-runner</div>
        </div>
        {PRODUCT_ROWS.map((r) => (
          <div key={r.label} style={{ display: "contents" }}>
            <div style={{ ...cell, color: C.fg3, fontSize: 22 }}>{r.label}</div>
            <div style={{ ...cell, ...(r.mono ? { ...mono, fontSize: 20 } : {}), color: C.fg }}>{r.borel}</div>
            <div style={{ ...cell, ...(r.mono ? { ...mono, fontSize: 20 } : {}), color: C.fg }}>{r.pulse}</div>
          </div>
        ))}
        <div style={{ ...cell, color: C.fg3, fontSize: 22 }}>Programs</div>
        <div style={{ ...cell, gridColumn: "2 / span 2", display: "flex", gap: 40, color: C.green, ...mono, fontSize: 19 }}>
          {PROGRAMS.map((p) => (
            <span key={p.key}>{p.crate}</span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 07 */

const SURFACES = [
  { name: "SKILL.md", pkg: "packages/cartridgefi-skill", detail: "5 protocol references and 3 manifest templates an agent loads before writing code" },
  { name: "MCP server", pkg: "@cartridgefi/mcp", detail: "6 tools: discover markets, compile, simulate, deploy, bind, inspect vault" },
  { name: "CLI + Studio", pkg: "packages/cli · /studio", detail: "Prompt to manifest in the terminal, or in the browser at /studio" },
  { name: "<CartridgeDeck/>", pkg: "@cartridgefi/react", detail: "Drop-in React embed that lets any wallet host a market app" },
];

function AgenticSlide({ index }: SlideProps) {
  return (
    <Frame
      index={index}
      headline="Agents go from prompt to a devnet market app through four surfaces we already built."
      source="packages/cartridgefi-skill · packages/mcp-server/src/server.ts (6 registerTool calls) · packages/cli · packages/react-deck"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, ...mono, fontSize: 22, color: C.fg2, marginBottom: 44 }}>
        {["prompt", "manifest", "simulate", "devnet programs", "wallet embed"].map((s, i, arr) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span style={{ color: i === 0 ? C.fg : i === arr.length - 1 ? C.green : C.fg2 }}>{s}</span>
            {i < arr.length - 1 ? <span style={{ color: C.fg3 }}>→</span> : null}
          </span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
        {SURFACES.map((s) => (
          <div
            key={s.name}
            style={{
              borderTop: `2px solid ${C.blue}`,
              background: C.elevated,
              borderRadius: "0 0 14px 14px",
              padding: "30px 30px 34px",
              height: 300,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ ...display, fontSize: 38, letterSpacing: "-0.03em" }}>{s.name}</span>
            <span style={{ ...mono, marginTop: 16, fontSize: 17, color: C.blue }}>{s.pkg}</span>
            <span style={{ marginTop: "auto", fontSize: 23, lineHeight: 1.4, color: C.fg2 }}>{s.detail}</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 08 */

function SplitBar({ parts }: { parts: { label: string; bps: number; color: string; fg: string }[] }) {
  return (
    <div style={{ display: "flex", height: 88, borderRadius: 10, overflow: "hidden", gap: 3 }}>
      {parts.map((p) => (
        <div
          key={p.label}
          style={{
            flex: p.bps,
            background: p.color,
            color: p.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            fontSize: 26,
            fontWeight: 600,
          }}
        >
          <span>{p.label}</span>
          <span style={{ ...mono, fontSize: 28 }}>{p.bps / 100}%</span>
        </div>
      ))}
    </div>
  );
}

function BusinessSlide({ index }: SlideProps) {
  const v = VAULT_CONSTANTS;
  const partnerProtocolBps = 10_000 - v.partnerWalletShareBps - v.partnerCreatorShareBps;
  return (
    <Frame
      index={index}
      headline="Revenue is a capped fee on every settled room, split on-chain by the vault router."
      source="programs/cartridge-vault-router/src/lib.rs · compute_pool_and_fee_distribution · proof run: devnet-proof.json metrics"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 440px", gap: 96, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 52 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
              <span style={{ fontSize: 28, fontWeight: 600 }}>Direct app</span>
              <span style={{ ...mono, fontSize: 17, color: C.fg3 }}>creator share ≤ MAX_CREATOR_SHARE_BPS {groupDigits(BigInt(v.maxCreatorShareBps))}</span>
            </div>
            <SplitBar
              parts={[
                { label: "Creator", bps: v.maxCreatorShareBps, color: "#1c2433", fg: C.fg },
                { label: "Protocol", bps: 10_000 - v.maxCreatorShareBps, color: C.blue, fg: "#ffffff" },
              ]}
            />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
              <span style={{ fontSize: 28, fontWeight: 600 }}>Inside a partner wallet</span>
              <span style={{ ...mono, fontSize: 17, color: C.fg3 }}>
                PARTNER_WALLET {groupDigits(BigInt(v.partnerWalletShareBps))} · PARTNER_CREATOR {groupDigits(BigInt(v.partnerCreatorShareBps))} bps
              </span>
            </div>
            <SplitBar
              parts={[
                { label: "Partner", bps: v.partnerWalletShareBps, color: "#2a2416", fg: C.fg },
                { label: "Creator", bps: v.partnerCreatorShareBps, color: "#1c2433", fg: C.fg },
                { label: "Protocol", bps: partnerProtocolBps, color: C.blue, fg: "#ffffff" },
              ]}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 44, paddingTop: 8 }}>
          <div>
            <div style={{ ...display, fontSize: 96, letterSpacing: "-0.045em" }}>≤{v.maxTotalFeeBps / 100}%</div>
            <div style={{ marginTop: 22, fontSize: 23, lineHeight: 1.4, color: C.fg2 }}>
              max fee per room pool · MAX_TOTAL_FEE_BPS {groupDigits(BigInt(v.maxTotalFeeBps))}
            </div>
          </div>
          <div>
            <div style={{ ...display, fontSize: 96, letterSpacing: "-0.045em" }}>
              {formatUnits(ARENA_CREATOR_FEE_UNITS, DEVNET_MINT_DECIMALS, 0)}
              <span style={{ color: C.fg3 }}> / </span>
              {formatUnits(ARENA_PLATFORM_FEE_UNITS, DEVNET_MINT_DECIMALS, 0)}
            </div>
            <div style={{ marginTop: 22, fontSize: 23, lineHeight: 1.4, color: C.fg2 }}>
              creator / protocol devnet test tokens from one settled proof room, paid to <Key value={PLATFORM_FEE_ACCOUNT} size={20} color={C.fg} />
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 09 */

function TractionSlide({ index }: SlideProps) {
  const stats = [
    { value: String(PROGRAMS.length), label: "Anchor programs on devnet", sub: `${LINKED_ACCOUNTS} Solscan-linked accounts` },
    { value: String(TX_TOTAL), label: "verified transactions", sub: `${TX_L1} L1 · ${TX_ER} ER · ${TX_TEE} TEE` },
    {
      value: formatUnits(PLATFORM_FEE_BALANCE_UNITS, DEVNET_MINT_DECIMALS, 2),
      label: "devnet test tokens in platformFeeAccount",
      sub: `${groupDigits(PLATFORM_FEE_BALANCE_UNITS)} base units · 6 decimals`,
    },
  ];
  return (
    <Frame
      index={index}
      headline={`The full room lifecycle is verified on devnet: ${TX_TOTAL} transactions across L1, rollup and TEE.`}
      source={`docs/DEVNET_PROOF.md · verified ${formatUtc(VERIFIED_AT_UTC)} · reproduce: pnpm prove:blitz · devnet only, no mainnet users yet`}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.25fr", gap: 64 }}>
        {stats.map((s) => (
          <div key={s.label}>
            <div style={{ ...display, fontSize: 168, letterSpacing: "-0.05em", lineHeight: 0.9 }}>{s.value}</div>
            <div style={{ marginTop: 28, fontSize: 28, fontWeight: 600, lineHeight: 1.25 }}>{s.label}</div>
            <div style={{ ...mono, marginTop: 12, fontSize: 19, color: C.fg3 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 72,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
          paddingTop: 26,
          borderTop: `1px solid ${C.hair}`,
        }}
      >
        {PROGRAMS.map((p) => (
          <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ ...mono, fontSize: 17, color: C.fg3 }}>{p.crate}</span>
            <Key value={p.id} head={8} tail={6} color={C.fg} size={20} />
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 10 */

const ROADMAP = [
  { title: "Reference apps + creator bounties", detail: "Borel and Pulse Runner as forkable starting points", status: "Apps live on devnet", color: C.green },
  { title: "Default skill for coding agents", detail: "SKILL.md + MCP inside Claude Code, Cursor and Codex", status: "Built, in repo", color: C.blue },
  { title: "Wallet embeds", detail: "<CartridgeDeck/> with a 40% partner fee share", status: "Built, in repo", color: C.blue },
  {
    title: "Audit + mainnet",
    detail: `Lift beta caps (${VAULT_CONSTANTS.betaMaxRoomPoolUsdc} USDC room · ${groupDigits(BigInt(VAULT_CONSTANTS.betaMaxGlobalTvlUsdc))} USDC TVL) after audit`,
    status: "Next",
    color: C.fg3,
  },
];

function RoadmapSlide({ index }: SlideProps) {
  return (
    <Frame
      index={index}
      headline="Reference apps seed creators, coding agents multiply them, wallets bring the users."
      source="Beta caps: BETA_MAX_ROOM_POOL_USDC / BETA_MAX_GLOBAL_TVL_USDC in cartridge_vault_router · no dates committed"
    >
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 11, right: 0, top: 11, height: 2, background: C.hairStrong }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 40, position: "relative" }}>
          {ROADMAP.map((r, i) => (
            <div key={r.title}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  background: C.void,
                  border: `3px solid ${r.color}`,
                }}
              />
              <div style={{ ...mono, marginTop: 36, fontSize: 20, color: C.fg3 }}>{String(i + 1).padStart(2, "0")}</div>
              <div style={{ ...display, marginTop: 14, fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.03em", minHeight: 88 }}>
                {r.title}
              </div>
              <div style={{ marginTop: 20, fontSize: 23, lineHeight: 1.4, color: C.fg2, minHeight: 96 }}>{r.detail}</div>
              <div style={{ ...mono, marginTop: 24, fontSize: 18, color: r.color }}>{r.status}</div>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ 11 */

const USE_OF_FUNDS = [
  "Security audit of the four programs",
  "Mainnet launch with first wallet-embed partners",
  "Creator bounty pool for new market apps",
];

function VisionSlide({ index }: SlideProps) {
  return (
    <section className={styles.slide} data-slide={index} aria-label={`Slide ${index} of ${SLIDE_COUNT}`}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 150 }}>
        <h2 style={{ ...display, fontSize: 104, margin: 0, maxWidth: 1600, textWrap: "balance" }}>
          The execution layer where the next 100M users experience equities, macro events and perps.
        </h2>
        <div style={{ marginTop: 88, display: "grid", gridTemplateColumns: "560px 1fr", gap: 64, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>The ask</div>
            <div style={{ marginTop: 14, fontSize: 25, lineHeight: 1.4, color: C.fg2 }}>
              A seed round to take CartridgeFi from devnet to audited mainnet.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            {USE_OF_FUNDS.map((u, i) => (
              <div key={u} style={{ borderTop: `2px solid ${C.blue}`, paddingTop: 20 }}>
                <span style={{ ...mono, fontSize: 18, color: C.fg3 }}>{String(i + 1).padStart(2, "0")}</span>
                <div style={{ marginTop: 10, fontSize: 25, lineHeight: 1.35 }}>{u}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Footer index={index} source="Live proof console: /protocol · reference apps: /play/borel, /play/pulse-runner · agent stack: /studio" />
    </section>
  );
}

export const SLIDES: ((props: SlideProps) => React.JSX.Element)[] = [
  TitleSlide,
  ProblemSlide,
  WhyNowSlide,
  SolutionSlide,
  ArchitectureSlide,
  ProductSlide,
  AgenticSlide,
  BusinessSlide,
  TractionSlide,
  RoadmapSlide,
  VisionSlide,
];
