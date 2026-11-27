"use client";

import * as React from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import devnetProof from "@/data/devnet-proof.json";
import type { DecodedOnchainShard } from "@/app/api/protocol-telemetry/route";
import type { FeeInflowsResponse } from "@/app/api/protocol/fee-inflows/route";
import { BOREL_MARKETS } from "@/lib/borel/types";
import { PYTH_FEEDS, usePythPrices, type PythFeedStatus } from "@/lib/borel/pyth";
import { cn, formatRelativeTime, shortenAddress } from "@/lib/utils";

const FEE_ATA = devnetProof.accounts.platformFeeAccountAta;
const PRIVATE_TEE_VALIDATOR = devnetProof.clusters.magicblockPrivateTeeValidator;
const PROOF_ER_VALIDATOR = devnetProof.clusters.magicblockPublicErValidator;
const PROOF_RUN_DATE = devnetProof.verifiedAtUtc.slice(0, 10);

type ProofCategoryFilter =
  | "all"
  | "delegation_and_vrf"
  | "private_payments_and_fees"
  | "l1_settlement";

const FILTER_TABS: readonly { id: ProofCategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "delegation_and_vrf", label: "ER delegation & VRF" },
  { id: "private_payments_and_fees", label: "Private eSPL & fees" },
  { id: "l1_settlement", label: "L1 settlement" },
];

const PROGRAMS: readonly { name: string; role: string; id: string }[] = [
  {
    name: "cartridge_er_room",
    role: "Sealed hands, pivots and VRF tie-break inside the delegated ER room",
    id: devnetProof.programs.cartridgeErRoom.programId,
  },
  {
    name: "cartridge_vault_router",
    role: "Stake escrow, payout and platformFeeAccount fee split",
    id: devnetProof.programs.cartridgeVaultRouter.programId,
  },
  {
    name: "cartridge_registry",
    role: "Showdown room manifests (duration, fog, pivots)",
    id: devnetProof.programs.cartridgeRegistry.programId,
  },
  {
    name: "cartridge_passport",
    role: "Player rating and eligibility",
    id: devnetProof.programs.cartridgePassport.programId,
  },
];

interface TelemetryResponse {
  probes?: {
    solanaDevnet?: { latencyMs: number | null; slot: number | null };
    magicblockRouter?: {
      latencyMs: number | null;
      routeCount: number | null;
      routes?: Array<{
        identity?: string;
        fqdn: string;
        blockTimeMs?: number;
        countryCode?: string;
      }>;
    };
    magicblockPrivateTee?: { latencyMs: number | null; identity: string | null };
  };
  programStates?: Record<string, { executable: boolean; lamports: string; accountCount?: number }>;
  liveFeeBalanceUnits?: string;
  onchainAccounts?: { roomShards?: DecodedOnchainShard[] };
}

interface RelayerStatus {
  configured: boolean;
  funded: boolean;
  relayer?: string | null;
  balanceLamports?: string;
  floorLamports?: string;
  cluster?: string;
  explorerUrl?: string;
  error?: string;
}

function useJsonPoll<T>(url: string, everyMs: number): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
} {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [tick, setTick] = React.useState<number>(0);

  React.useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as T;
        if (!active) return;
        setData(json);
        setError(res.ok ? null : `HTTP ${res.status}`);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "unreachable");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const id = window.setInterval(() => {
      void load();
    }, everyMs);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [url, everyMs, tick]);

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refresh };
}

function formatUnits6(units: bigint, signed = false): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  const sign = neg ? "−" : signed && abs > 0n ? "+" : "";
  return `${sign}${whole.toLocaleString("en-US")}.${frac}`;
}

function formatLamports(lamports: string | undefined): string {
  if (!lamports) return "—";
  const v = BigInt(lamports);
  return `${(v / 1_000_000_000n).toString()}.${((v % 1_000_000_000n) / 1_000_000n).toString().padStart(3, "0")} SOL`;
}

function formatPriceE9(v: bigint): string {
  const whole = v / 1_000_000_000n;
  const cents = ((v % 1_000_000_000n) / 10_000_000n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${cents}`;
}

const STATUS_TONE: Record<PythFeedStatus, string> = {
  live: "text-[#34d399]",
  stale: "text-[#fbbf24]",
  closed: "text-[#9ca3af]",
  error: "text-[#f87171]",
};

function Pane({
  title,
  meta,
  children,
  className,
  id,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}): React.JSX.Element {
  return (
    <section id={id} className={cn("min-w-0 bg-[#111317]", className)}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[#22262e] px-3 py-1.5">
        <h2 className="text-xs font-semibold text-[#f3f4f6]">{title}</h2>
        {meta ? <span className="font-mono text-[10px] text-[#6b7280]">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "text-[#f3f4f6]",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0 bg-[#111317] px-3 py-2.5">
      <div className="text-[10px] text-[#6b7280]">{label}</div>
      <div className={cn("mt-0.5 truncate font-mono text-sm tabular-nums", tone)}>{value}</div>
      {sub ? <div className="truncate font-mono text-[10px] text-[#6b7280]">{sub}</div> : null}
    </div>
  );
}

export function BorelProtocolInspector(): React.JSX.Element {
  const telemetry = useJsonPoll<TelemetryResponse>("/api/protocol-telemetry", 15_000);
  const relayer = useJsonPoll<RelayerStatus>("/api/relayer/status", 15_000);
  const inflows = useJsonPoll<FeeInflowsResponse>("/api/protocol/fee-inflows", 30_000);
  const pyth = usePythPrices(BOREL_MARKETS);
  const [filter, setFilter] = React.useState<ProofCategoryFilter>("all");
  const [nowMs, setNowMs] = React.useState<number | null>(null);

  React.useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const t = telemetry.data;
  const routes = t?.probes?.magicblockRouter?.routes ?? [];
  const shards = t?.onchainAccounts?.roomShards ?? [];
  const vrfShards = shards.filter((s) => s.vrfFulfilled);
  const ledger =
    filter === "all"
      ? devnetProof.transactions
      : devnetProof.transactions.filter((tx) => tx.category === filter);
  const vrfTx = devnetProof.transactions.find((tx) => tx.step.includes("VRF"));
  const rel = relayer.data;

  return (
    <div className="flex flex-col gap-px border border-[#22262e] bg-[#22262e]">
      <div className="flex flex-col justify-between gap-3 bg-[#111317] px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-[-0.018em] text-[#f3f4f6]">
            Borel · Protocol Inspector &amp; Live Execution Console
          </h1>
          <p className="mt-0.5 text-xs text-[#9ca3af]">
            Live Solana devnet, MagicBlock ER / TEE and Pyth state behind every sealed-conviction showdown.
            Rows marked <span className="text-[#fbbf24]">proof run</span> are historical records from {PROOF_RUN_DATE}.
          </p>
        </div>
        <button
          id="protocol-reprobe-btn"
          type="button"
          onClick={() => {
            telemetry.refresh();
            relayer.refresh();
          }}
          className="cf-btn inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129]"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", telemetry.loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px lg:grid-cols-5">
        <Stat
          label="Solana devnet slot"
          value={t?.probes?.solanaDevnet?.slot?.toLocaleString("en-US") ?? "—"}
          sub={t?.probes?.solanaDevnet?.latencyMs != null ? `${t.probes.solanaDevnet.latencyMs}ms server RTT` : telemetry.error ?? "probing"}
        />
        <Stat
          label="MagicBlock ER validators"
          value={t?.probes?.magicblockRouter?.routeCount ?? "—"}
          sub={t?.probes?.magicblockRouter?.latencyMs != null ? `router ${t.probes.magicblockRouter.latencyMs}ms` : "router probing"}
        />
        <Stat
          label="Private ER (TDX TEE)"
          value={t?.probes?.magicblockPrivateTee?.identity ? shortenAddress(t.probes.magicblockPrivateTee.identity, 6, 6) : "—"}
          sub={t?.probes?.magicblockPrivateTee?.latencyMs != null ? `${t.probes.magicblockPrivateTee.latencyMs}ms` : "probing"}
          tone="text-[#fbbf24]"
        />
        <Stat
          label="platformFeeAccount"
          value={t?.liveFeeBalanceUnits ? formatUnits6(BigInt(t.liveFeeBalanceUnits)) : "—"}
          sub="live SPL balance (6 dp)"
          tone="text-[#34d399]"
        />
        <Stat
          label="Relayer"
          value={rel ? (rel.configured ? (rel.funded ? "funded" : "unfunded") : "not configured") : "—"}
          sub={rel?.balanceLamports ? formatLamports(rel.balanceLamports) : relayer.error ?? "probing"}
          tone={rel?.funded ? "text-[#34d399]" : "text-[#fbbf24]"}
        />
      </div>

      <Pane title="Deployed programs" meta="getAccountInfo · getProgramAccounts (live)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="bg-[#0e1014] text-[10px] text-[#6b7280]">
                <th className="px-3 py-1.5 font-medium">Program</th>
                <th className="px-3 py-1.5 font-medium">Program ID</th>
                <th className="px-3 py-1.5 font-medium">Role in Borel</th>
                <th className="px-3 py-1.5 text-right font-medium">Executable</th>
                <th className="px-3 py-1.5 text-right font-medium">PDAs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {PROGRAMS.map((p) => {
                const state = t?.programStates?.[p.id];
                return (
                  <tr key={p.id} className="cf-row-hover">
                    <td className="px-3 py-1.5 font-mono text-[#e5e7eb]">{p.name}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      <a
                        href={`https://solscan.io/account/${p.id}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#93c5fd] hover:underline"
                      >
                        {p.id}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 text-[#9ca3af]">{p.role}</td>
                    <td className={cn("px-3 py-1.5 text-right font-mono", state?.executable ? "text-[#34d399]" : "text-[#6b7280]")}>
                      {state ? (state.executable ? "yes" : "no") : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#f3f4f6]">
                      {state?.accountCount ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Pane>

      <div className="grid grid-cols-1 gap-px lg:grid-cols-2">
        <Pane title="ER validators" meta="getRoutes · devnet-router.magicblock.app (live)">
          <ul className="divide-y divide-[#1a1d24] font-mono text-[11px] tabular-nums">
            {routes.map((r) => (
              <li key={r.fqdn} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate text-[#e5e7eb]">{r.fqdn.replace(/^https:\/\//, "").replace(/\/$/, "")}</span>
                  <span className="block truncate text-[10px] text-[#6b7280]">{r.identity ?? "—"}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[10px]">
                  {r.identity === PRIVATE_TEE_VALIDATOR ? (
                    <span className="rounded-[3px] border border-[#f59e0b]/40 px-1 text-[#fbbf24]">TEE</span>
                  ) : null}
                  {r.identity === PROOF_ER_VALIDATOR ? (
                    <span className="rounded-[3px] border border-[#303642] px-1 text-[#9ca3af]">proof run</span>
                  ) : null}
                  <span className="text-[#9ca3af]">{r.countryCode ?? ""}</span>
                  <span className="text-[#f3f4f6]">{r.blockTimeMs != null ? `${r.blockTimeMs}ms` : "—"}</span>
                </span>
              </li>
            ))}
            {routes.length === 0 ? (
              <li className="px-3 py-3 text-[#6b7280]">— {telemetry.error ?? (telemetry.loading ? "probing router" : "router returned no routes")}</li>
            ) : null}
          </ul>
        </Pane>

        <Pane title="VRF tie-break proof" meta="MagicBlock VRF">
          <div className="space-y-px bg-[#22262e]">
            <div className="bg-[#111317] px-3 py-2 font-mono text-[11px]">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-sans text-[#6b7280]">Live room shards with fulfilled VRF</span>
                <span className="text-[#9ca3af]">{shards.length > 0 ? `${vrfShards.length}/${shards.length}` : "—"}</span>
              </div>
              {vrfShards.slice(0, 3).map((s) => (
                <div key={s.pubkey} className="mt-1 flex justify-between gap-2">
                  <a
                    href={`https://solscan.io/account/${s.pubkey}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#93c5fd] hover:underline"
                  >
                    {shortenAddress(s.pubkey, 5, 5)}
                  </a>
                  <span className="truncate text-[#d1d5db]">{shortenAddress(s.vrfSeedHex, 10, 6)}</span>
                </div>
              ))}
            </div>
            <dl className="bg-[#111317] px-3 py-2 font-mono text-[11px]">
              <div className="mb-1 font-sans text-[10px] text-[#fbbf24]">Proof run · {PROOF_RUN_DATE}</div>
              <div className="flex justify-between gap-2">
                <dt className="font-sans text-[#6b7280]">Queue</dt>
                <dd className="truncate text-[#d1d5db]">{devnetProof.metrics.vrfQueue}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-sans text-[#6b7280]">Seed</dt>
                <dd className="truncate text-[#d1d5db]">{shortenAddress(devnetProof.metrics.vrfSeedHex, 12, 8)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="font-sans text-[#6b7280]">Fulfilled</dt>
                <dd className="text-[#34d399]">{devnetProof.metrics.vrfFulfilled ? "yes" : "no"}</dd>
              </div>
              {vrfTx ? (
                <div className="flex justify-between gap-2">
                  <dt className="font-sans text-[#6b7280]">Request tx</dt>
                  <dd>
                    <a href={vrfTx.solscanUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline">
                      {shortenAddress(vrfTx.signature, 8, 6)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </Pane>
      </div>

      <div className="grid grid-cols-1 gap-px lg:grid-cols-2">
        <Pane title="platformFeeAccount inflows" meta="getSignaturesForAddress + getTransaction (live, 30s)">
          <div className="flex items-center justify-between gap-2 border-b border-[#1a1d24] px-3 py-1.5 font-mono text-[11px]">
            <span className="truncate text-[#9ca3af]">{FEE_ATA}</span>
            <span className="shrink-0 text-[#34d399]">
              {inflows.data?.balanceUnits ? formatUnits6(BigInt(inflows.data.balanceUnits)) : "—"}
            </span>
          </div>
          <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="bg-[#0e1014] text-[10px] text-[#6b7280]">
                <th className="px-3 py-1 font-sans font-medium">Signature</th>
                <th className="px-3 py-1 text-right font-sans font-medium">Δ balance</th>
                <th className="px-3 py-1 text-right font-sans font-medium">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {(inflows.data?.rows ?? []).map((r) => (
                <tr key={r.signature}>
                  <td className="px-3 py-1">
                    <a href={`https://solscan.io/tx/${r.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-[#93c5fd] hover:underline">
                      {shortenAddress(r.signature, 8, 6)}
                    </a>
                    {r.err ? <span className="ml-1 text-[#f87171]">failed</span> : null}
                  </td>
                  <td className={cn("px-3 py-1 text-right", r.deltaUnits !== null && BigInt(r.deltaUnits) > 0n ? "text-[#34d399]" : "text-[#9ca3af]")}>
                    {r.deltaUnits !== null ? formatUnits6(BigInt(r.deltaUnits), true) : "—"}
                  </td>
                  <td className="px-3 py-1 text-right text-[#6b7280]">
                    {nowMs !== null && r.blockTime ? formatRelativeTime(r.blockTime) : "—"}
                  </td>
                </tr>
              ))}
              {(inflows.data?.rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-[#6b7280]">
                    — {inflows.data?.error ?? inflows.error ?? (inflows.loading ? "loading signatures" : "no signatures")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Pane>

        <Pane title="Pyth price feeds" meta={pyth.transport ? `transport: ${pyth.transport}` : "connecting"}>
          <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="bg-[#0e1014] text-[10px] text-[#6b7280]">
                <th className="px-3 py-1 font-sans font-medium">Market</th>
                <th className="px-3 py-1 text-right font-sans font-medium">Price</th>
                <th className="px-3 py-1 text-right font-sans font-medium">Published</th>
                <th className="px-3 py-1 text-right font-sans font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {BOREL_MARKETS.map((m) => {
                const price = pyth.pricesE9[m];
                const status = pyth.status[m];
                const pt = pyth.publishTimeMs[m];
                return (
                  <tr key={m}>
                    <td className="px-3 py-1">
                      <span className="block text-[#e5e7eb]">{PYTH_FEEDS[m].label}</span>
                      <span className="block text-[10px] text-[#6b7280]">{PYTH_FEEDS[m].pythSymbol}</span>
                    </td>
                    <td className="px-3 py-1 text-right text-[#f3f4f6]">{price !== undefined ? formatPriceE9(price) : "—"}</td>
                    <td className="px-3 py-1 text-right text-[#6b7280]">
                      {pt !== undefined && nowMs !== null ? formatRelativeTime(Math.floor(pt / 1000)) : "—"}
                    </td>
                    <td className={cn("px-3 py-1 text-right", status ? STATUS_TONE[status] : "text-[#6b7280]")}>{status ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Pane>
      </div>

      <Pane title="Relayer" meta="GET /api/relayer/status (live)">
        <dl className="grid grid-cols-1 gap-px bg-[#22262e] font-mono text-[11px] sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-[#111317] px-3 py-2">
            <dt className="font-sans text-[10px] text-[#6b7280]">Live relayer</dt>
            <dd className="truncate">
              {rel?.relayer ? (
                <a href={rel.explorerUrl ?? `https://solscan.io/account/${rel.relayer}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-[#93c5fd] hover:underline">
                  {rel.relayer}
                </a>
              ) : (
                <span className="text-[#9ca3af]">— {rel?.error ?? (rel && !rel.configured ? "relayer key not configured" : "probing")}</span>
              )}
            </dd>
          </div>
          <div className="bg-[#111317] px-3 py-2">
            <dt className="font-sans text-[10px] text-[#6b7280]">Balance / floor</dt>
            <dd className="text-[#f3f4f6]">
              {formatLamports(rel?.balanceLamports)} / {formatLamports(rel?.floorLamports)}
            </dd>
          </div>
          <div className="bg-[#111317] px-3 py-2">
            <dt className="font-sans text-[10px] text-[#6b7280]">Cluster</dt>
            <dd className="text-[#f3f4f6]">{rel?.cluster ?? "—"}</dd>
          </div>
          <div className="bg-[#111317] px-3 py-2">
            <dt className="font-sans text-[10px] text-[#fbbf24]">Proof-run relayer wallet</dt>
            <dd className="truncate text-[#9ca3af]">{devnetProof.accounts.relayerWallet}</dd>
          </div>
        </dl>
      </Pane>

      <section id="protocol-proof-ledger" className="bg-[#111317]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#22262e] px-3 py-2">
          <div>
            <h2 className="text-xs font-semibold text-[#f3f4f6]">
              Proof-run ledger · {ledger.length} transactions
            </h2>
            <p className="text-[10px] text-[#fbbf24]">Historical devnet + ER + TEE run, {PROOF_RUN_DATE}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                id={`protocol-filter-${tab.id}`}
                type="button"
                aria-pressed={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  "cf-btn h-7 cursor-pointer rounded-[4px] border px-2.5 text-[11px] font-medium",
                  filter === tab.id
                    ? "border-[#3b82f6] bg-[#2563eb]/20 text-white"
                    : "border-[#303642] bg-[#171a20] text-[#9ca3af] hover:text-white",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="bg-[#0e1014] text-[10px] text-[#6b7280]">
                <th className="px-3 py-1.5 font-medium">Step</th>
                <th className="px-3 py-1.5 font-medium">Layer</th>
                <th className="px-3 py-1.5 font-medium">Signature</th>
                <th className="px-3 py-1.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {ledger.map((tx) => (
                <tr key={tx.signature} className="cf-row-hover">
                  <td className="px-3 py-1.5 text-[#f3f4f6]">{tx.step}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-[#9ca3af]">{tx.layer}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums">
                    <a href={tx.solscanUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline">
                      {shortenAddress(tx.signature, 8, 8)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-[#9ca3af]">{tx.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
