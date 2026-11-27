import { ER_SESSION_UPDATES, MAGICBLOCK, PLATFORM_FEE_ACCOUNT, shortKey, solscanAccount } from "./facts";

const W = 1664;
const H = 548;
const LANE_X = 236;
const LANE_H = 72;
const LANES = [
  { key: "l1", y: 70, title: "Solana L1", sub: "custody + settlement" },
  { key: "er", y: 200, title: "MagicBlock ER", sub: MAGICBLOCK.router.replace(".magicblock.app", "") },
  { key: "tee", y: 330, title: "Private ER", sub: "Intel TDX TEE" },
] as const;

const COL_W = (W - LANE_X) / 7;
const colX = (i: number) => LANE_X + COL_W * i + COL_W / 2;

type LaneKey = (typeof LANES)[number]["key"];
const laneY = (k: LaneKey) => LANES.find((l) => l.key === k)?.y ?? 0;

const C = {
  l1: "#a3aab6",
  er: "#3b82f6",
  tee: "#f5a524",
  settle: "#22c08a",
  hair: "#1a1f2b",
  lane: "#0a0d14",
  void: "#050609",
  fg: "#f3f4f6",
  fg2: "#a3aab6",
  fg3: "#6b7280",
};

type Line = { text: string; account?: string };
const key = (account: string, prefix = ""): Line => ({ text: `${prefix}${shortKey(account)}`, account });

const STEPS: { lane: LaneKey; title: string; lines: Line[] }[] = [
  { lane: "l1", title: "Escrow", lines: [{ text: "RoomVault SPL" }, { text: "vault_router" }] },
  { lane: "l1", title: "Delegate", lines: [key(MAGICBLOCK.delegationProgram), { text: "L1 → rollup" }] },
  { lane: "er", title: "Play", lines: [{ text: `${ER_SESSION_UPDATES} session-key txs` }, { text: "0 wallet popups" }] },
  { lane: "tee", title: "Fog of war", lines: [key(MAGICBLOCK.permissionProgram), { text: "sealed 75% of clock" }] },
  { lane: "er", title: "VRF", lines: [{ text: "verifiable seed" }, { text: "rollup callback" }] },
  { lane: "er", title: "Commit", lines: [{ text: "commit + undelegate" }, { text: "rollup → L1" }] },
  {
    lane: "l1",
    title: "Settle",
    lines: [{ text: "payout + fee split" }, key(PLATFORM_FEE_ACCOUNT), key(MAGICBLOCK.esplProgram, "eSPL ")],
  },
];

const SEGMENT_COLORS = [C.l1, C.er, C.tee, C.tee, C.er, C.settle];

function segmentPath(ax: number, ay: number, bx: number, by: number, r = 18): string {
  if (ay === by) return `M ${ax} ${ay} H ${bx}`;
  const mx = (ax + bx) / 2;
  const dir = by > ay ? 1 : -1;
  return [
    `M ${ax} ${ay}`,
    `H ${mx - r}`,
    `Q ${mx} ${ay} ${mx} ${ay + dir * r}`,
    `V ${by - dir * r}`,
    `Q ${mx} ${by} ${mx + r} ${by}`,
    `H ${bx}`,
  ].join(" ");
}

export function ArchitectureDiagram() {
  const nodes = STEPS.map((s, i) => ({ ...s, x: colX(i), y: laneY(s.lane) }));
  const captionTop = 424;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Room lifecycle: escrow on Solana L1, delegate to MagicBlock ER, play with session keys, hide stances in a private TEE, VRF, commit and undelegate, settle payouts and fees on L1"
      style={{ display: "block" }}
    >
      {LANES.map((lane) => (
        <g key={lane.key}>
          <rect
            x={LANE_X}
            y={lane.y - LANE_H / 2}
            width={W - LANE_X}
            height={LANE_H}
            rx={10}
            fill={C.lane}
            stroke={C.hair}
          />
          <text x={0} y={lane.y - 4} fill={C.fg} fontFamily="var(--font-inter)" fontSize={22} fontWeight={600}>
            {lane.title}
          </text>
          <text
            x={0}
            y={lane.y + 22}
            fill={C.fg3}
            fontFamily="var(--font-jetbrains)"
            fontSize={15}
            style={{ fontVariantNumeric: "tabular-nums slashed-zero" }}
          >
            {lane.sub}
          </text>
        </g>
      ))}

      {nodes.map((n) => (
        <line
          key={`guide-${n.title}`}
          x1={n.x}
          y1={n.y + 22}
          x2={n.x}
          y2={captionTop - 30}
          stroke="#252b38"
          strokeWidth={1.5}
          strokeDasharray="2 7"
        />
      ))}

      {nodes.slice(0, -1).map((a, i) => {
        const b = nodes[i + 1] ?? a;
        return (
          <path
            key={`seg-${a.title}`}
            d={segmentPath(a.x, a.y, b.x, b.y)}
            fill="none"
            stroke={SEGMENT_COLORS[i]}
            strokeWidth={3}
            strokeLinecap="round"
          />
        );
      })}

      {nodes.map((n, i) => {
        const color = i === nodes.length - 1 ? C.settle : n.lane === "tee" ? C.tee : n.lane === "er" ? C.er : C.l1;
        return (
          <g key={`node-${n.title}`}>
            <circle cx={n.x} cy={n.y} r={21} fill={C.void} stroke={color} strokeWidth={2.5} />
            <text
              x={n.x}
              y={n.y + 5.5}
              textAnchor="middle"
              fill={C.fg}
              fontFamily="var(--font-jetbrains)"
              fontSize={15}
              fontWeight={600}
              style={{ fontVariantNumeric: "tabular-nums slashed-zero" }}
            >
              {String(i + 1).padStart(2, "0")}
            </text>
          </g>
        );
      })}

      {nodes.map((n) => (
        <g key={`cap-${n.title}`}>
          <text
            x={n.x}
            y={captionTop}
            textAnchor="middle"
            fill={C.fg}
            fontFamily="var(--font-inter)"
            fontSize={23}
            fontWeight={600}
          >
            {n.title}
          </text>
          {n.lines.map((line, li) => {
            const label = (
              <text
                x={n.x}
                y={captionTop + 32 + li * 25}
                textAnchor="middle"
                fill={line.account ? C.fg : C.fg2}
                fontFamily="var(--font-jetbrains)"
                fontSize={15}
                style={{ fontVariantNumeric: "tabular-nums slashed-zero" }}
              >
                {line.text}
              </text>
            );
            return line.account ? (
              <a key={line.text} href={solscanAccount(line.account)} target="_blank" rel="noreferrer" style={{ pointerEvents: "auto" }}>
                <title>{line.account}</title>
                {label}
              </a>
            ) : (
              <g key={line.text}>{label}</g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
