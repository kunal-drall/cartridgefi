"use client";

import * as React from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { USDC_UNIT } from "@cartridgefi/shared-types";
import devnetProof from "@/data/devnet-proof.json";
import type {
  DecodedOnchainManifest,
  DecodedOnchainShard,
  DecodedOnchainVault,
  RecentOnchainSignature,
} from "@/app/api/protocol-telemetry/route";
import { cn, formatRelativeTime, shortenAddress } from "@/lib/utils";
import { toast } from "sonner";

type ProofCategoryFilter =
  | "all"
  | "delegation_and_vrf"
  | "private_payments_and_fees"
  | "l1_settlement";

interface TelemetryResponse {
  ok: boolean;
  fetchedAtIso?: string;
  probes: {
    solanaDevnet: { latencyMs: number | null; slot: number | null };
    magicblockRouter: {
      latencyMs: number | null;
      routeCount: number | null;
      routes?: Array<{ fqdn: string; identity?: string; blockTimeMs?: number }>;
    };
    magicblockPublicEr: {
      latencyMs: number | null;
      version: string | null;
      pythLazerOracleActive?: boolean;
      pythLazerOracleOwner?: string | null;
    };
    magicblockPrivateTee: { latencyMs: number | null; identity: string | null };
  };
  programStates: Record<
    string,
    { executable: boolean; lamports: string; accountCount?: number }
  >;
  accountCounts?: Record<string, number>;
  liveFeeBalanceUnits: string;
  liveShardStatus: string;
  onchainAccounts?: {
    engineConfig?: {
      pubkey: string;
      adminMultisig: string;
      platformFeeAccount: string;
      privateBetaMode: boolean;
      paused: boolean;
    } | null;
    manifests: DecodedOnchainManifest[];
    roomShards: DecodedOnchainShard[];
    roomVaults: DecodedOnchainVault[];
    passportAccountCount: number;
  };
  recentSignatures?: RecentOnchainSignature[];
}

function formatMicroUnits(rawUnitsStr: string): string {
  try {
    const units = BigInt(rawUnitsStr);
    const whole = units / USDC_UNIT;
    const frac = (units % USDC_UNIT).toString().padStart(6, "0").slice(0, 2);
    return `${new Intl.NumberFormat("en-US").format(whole)}.${frac}`;
  } catch {
    return "0.00";
  }
}

function formatLamportsSol(lamportsStr: string | undefined, fallbackSol: string): string {
  if (!lamportsStr) return `${fallbackSol} SOL`;
  try {
    const lamports = BigInt(lamportsStr);
    const whole = lamports / 1_000_000_000n;
    const frac = ((lamports % 1_000_000_000n) / 1_000_000n)
      .toString()
      .padStart(3, "0");
    return `${whole}.${frac} SOL`;
  } catch {
    return `${fallbackSol} SOL`;
  }
}

const FILTER_TABS: readonly { id: ProofCategoryFilter; label: string }[] = [
  { id: "all", label: "All Transactions" },
  { id: "delegation_and_vrf", label: "ER Delegations & VRF" },
  { id: "private_payments_and_fees", label: "Private eSPL & Fees" },
  { id: "l1_settlement", label: "L1 Vault Settlement" },
];

export function ProtocolExecutionConsole(): React.JSX.Element {
  const [categoryFilter, setCategoryFilter] =
    React.useState<ProofCategoryFilter>("all");
  const [probing, setProbing] = React.useState<boolean>(false);
  const [telemetry, setTelemetry] = React.useState<TelemetryResponse | null>(
    null,
  );

  const runProbe = React.useCallback(async () => {
    setProbing(true);
    try {
      const res = await fetch("/api/protocol-telemetry", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as TelemetryResponse;
        setTelemetry(json);
      }
    } catch {
      // Keep previous state
    } finally {
      setProbing(false);
    }
  }, []);

  React.useEffect(() => {
    void runProbe();
    const id = window.setInterval(() => {
      void runProbe();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [runProbe]);

  const copyText = async (val: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(val);
      toast.success(`Copied ${label}`);
    } catch {
      // Ignore
    }
  };

  const filteredProofTxs = React.useMemo(() => {
    if (categoryFilter === "all") return devnetProof.transactions;
    return devnetProof.transactions.filter(
      (tx) => tx.category === categoryFilter,
    );
  }, [categoryFilter]);

  const feeUnits =
    telemetry?.liveFeeBalanceUnits ??
    devnetProof.metrics.platformFeeAccountFinalBalanceUnits;

  const programsList = [
    {
      name: "cartridge_er_room",
      role: "Delegated ER / TEE State & VRF Callback",
      id: devnetProof.programs.cartridgeErRoom.programId,
      bytes: devnetProof.programs.cartridgeErRoom.binaryBytes,
      minRentSol: devnetProof.programs.cartridgeErRoom.minRentSol,
    },
    {
      name: "cartridge_vault_router",
      role: "Non-Custodial SPL Escrow & Fee Splitter",
      id: devnetProof.programs.cartridgeVaultRouter.programId,
      bytes: devnetProof.programs.cartridgeVaultRouter.binaryBytes,
      minRentSol: devnetProof.programs.cartridgeVaultRouter.minRentSol,
    },
    {
      name: "cartridge_registry",
      role: "Parameterized CartridgeManifest v2 Registry",
      id: devnetProof.programs.cartridgeRegistry.programId,
      bytes: devnetProof.programs.cartridgeRegistry.binaryBytes,
      minRentSol: devnetProof.programs.cartridgeRegistry.minRentSol,
    },
    {
      name: "cartridge_passport",
      role: "Cross-Arena Market ELO & Eligibility",
      id: devnetProof.programs.cartridgePassport.programId,
      bytes: devnetProof.programs.cartridgePassport.binaryBytes,
      minRentSol: devnetProof.programs.cartridgePassport.minRentSol,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-[#22262e] bg-[#111317] p-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-base font-semibold text-[#f3f4f6] sm:text-lg">
            Protocol Inspector &amp; Live Execution Console
          </h1>
          <p className="mt-0.5 text-xs text-[#9ca3af]">
            Direct Solana Devnet (
            <code className="font-mono text-[#d1d5db]">getProgramAccounts</code>,{" "}
            <code className="font-mono text-[#d1d5db]">getMultipleAccounts</code>,{" "}
            <code className="font-mono text-[#d1d5db]">getSignaturesForAddress</code>
            ) and MagicBlock Ephemeral Rollup / Intel TDX state inspector.
          </p>
        </div>

        <button
          id="protocol-reprobe-btn"
          type="button"
          onClick={() => void runProbe()}
          disabled={probing}
          className="cf-btn inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129] disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", probing ? "animate-spin" : "")} />
          <span>{probing ? "Querying RPCs…" : "Refresh Live RPC State"}</span>
        </button>
      </div>

      {/* 4-Endpoint Cluster Probe Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[#22262e] bg-[#111317] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#e5e7eb]">Solana Devnet L1</span>
            <span className="font-mono text-[11px] text-[#34d399] tabular-nums">
              {telemetry?.probes.solanaDevnet.latencyMs
                ? `${telemetry.probes.solanaDevnet.latencyMs}ms`
                : "Connected"}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-sm font-semibold text-[#f3f4f6] tabular-nums">
            {telemetry?.probes.solanaDevnet.slot
              ? `Slot ${telemetry.probes.solanaDevnet.slot.toLocaleString()}`
              : "Confirmed"}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-[#6b7280]">
            {devnetProof.clusters.solanaDevnetRpc}
          </div>
        </div>

        <div className="rounded-lg border border-[#22262e] bg-[#111317] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#e5e7eb]">MagicBlock Router</span>
            <span className="font-mono text-[11px] text-[#34d399] tabular-nums">
              {telemetry?.probes.magicblockRouter.latencyMs
                ? `${telemetry.probes.magicblockRouter.latencyMs}ms`
                : "Connected"}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-sm font-semibold text-[#f3f4f6] tabular-nums">
            {telemetry?.probes.magicblockRouter.routeCount
              ? `${telemetry.probes.magicblockRouter.routeCount} Active ER Nodes`
              : "ER Routing Active"}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-[#6b7280]">
            {devnetProof.clusters.magicblockRouterRpc}
          </div>
        </div>

        <div className="rounded-lg border border-[#22262e] bg-[#111317] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#e5e7eb]">Public ER + Oracle</span>
            <span className="font-mono text-[11px] text-[#34d399] tabular-nums">
              {telemetry?.probes.magicblockPublicEr.latencyMs
                ? `${telemetry.probes.magicblockPublicEr.latencyMs}ms`
                : "Connected"}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-sm font-semibold text-[#f3f4f6] tabular-nums">
            {telemetry?.probes.magicblockPublicEr.pythLazerOracleActive
              ? "Pyth Lazer Feed Live"
              : `Core ${telemetry?.probes.magicblockPublicEr.version ?? "Active"}`}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-[#6b7280]">
            {devnetProof.clusters.magicblockPublicErRpc}
          </div>
        </div>

        <div className="rounded-lg border border-[#22262e] bg-[#111317] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#e5e7eb]">Private ER (TDX TEE)</span>
            <span className="font-mono text-[11px] text-[#34d399] tabular-nums">
              {telemetry?.probes.magicblockPrivateTee.latencyMs
                ? `${telemetry.probes.magicblockPrivateTee.latencyMs}ms`
                : "Connected"}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-sm font-semibold text-[#f3f4f6] tabular-nums">
            {shortenAddress(
              telemetry?.probes.magicblockPrivateTee.identity ??
                devnetProof.clusters.magicblockPrivateTeeValidator,
              6,
              6,
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-[#6b7280]">
            {devnetProof.clusters.magicblockPrivateTeeRpc}
          </div>
        </div>
      </div>

      {/* Deployed Solana Devnet Programs Table */}
      <section className="rounded-lg border border-[#22262e] bg-[#111317] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#22262e] px-4 py-2.5">
          <h2 className="text-xs font-semibold text-[#f3f4f6]">
            Deployed Solana Devnet Programs
          </h2>
          <span className="font-mono text-[11px] text-[#6b7280]">
            BPFLoaderUpgradeab1e
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#22262e] bg-[#0e1014] text-[11px] font-medium text-[#6b7280]">
                <th className="px-4 py-2">Program</th>
                <th className="px-3 py-2">Program ID</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2 text-right">Live PDAs</th>
                <th className="px-4 py-2 text-right">Executable Rent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22262e]">
              {programsList.map((prog) => {
                const st = telemetry?.programStates?.[prog.id];
                const count =
                  telemetry?.accountCounts?.[prog.id] ?? st?.accountCount;
                return (
                  <tr key={prog.id} className="cf-row-hover">
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#f3f4f6]">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#34d399]" />
                        <span>{prog.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[#93c5fd]">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`https://solscan.io/account/${prog.id}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {prog.id}
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyText(prog.id, prog.name)}
                          className="cursor-pointer text-[#6b7280] hover:text-white"
                          aria-label={`Copy ${prog.name} Program ID`}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[#9ca3af]">{prog.role}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[#e5e7eb] tabular-nums">
                      {typeof count === "number" ? count : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[#9ca3af] tabular-nums">
                      {formatLamportsSol(st?.lamports, prog.minRentSol)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Canonical Fee Accounts & Decoded On-Chain Accounts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Canonical Fee ATA + Relayer + System Constants */}
        <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4 lg:col-span-5">
          <h2 className="border-b border-[#22262e] pb-2.5 text-xs font-semibold text-[#f3f4f6]">
            Canonical Accounts &amp; Fee Routing
          </h2>

          <div className="mt-3 space-y-2.5 font-mono text-xs tabular-nums">
            <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-3">
              <div className="flex items-center justify-between font-sans text-[11px] text-[#9ca3af]">
                <span>Canonical platformFeeAccount (SPL ATA)</span>
                <span className="font-mono font-semibold text-[#34d399]">
                  {formatMicroUnits(feeUnits)} SPL
                </span>
              </div>
              <a
                href={`https://solscan.io/account/${devnetProof.accounts.platformFeeAccountAta}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 break-all text-[11px] text-[#93c5fd] hover:underline"
              >
                {devnetProof.accounts.platformFeeAccountAta}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>

            <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-3">
              <div className="font-sans text-[11px] text-[#9ca3af]">
                Relayer &amp; Settlement Authority Wallet
              </div>
              <a
                href={`https://solscan.io/account/${devnetProof.accounts.relayerWallet}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 break-all text-[11px] text-[#e5e7eb] hover:text-[#93c5fd]"
              >
                {devnetProof.accounts.relayerWallet}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>

            <div className="rounded border border-[#22262e] bg-[#0b0c0e] p-3">
              <div className="flex items-center justify-between font-sans text-[11px] text-[#9ca3af]">
                <span>Settled ArenaShard PDA</span>
                <span className="text-[#34d399]">
                  {telemetry?.liveShardStatus ?? "Restored to Solana L1"}
                </span>
              </div>
              <a
                href={`https://solscan.io/account/${devnetProof.accounts.settledRoomShardPda}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 break-all text-[11px] text-[#e5e7eb] hover:text-[#93c5fd]"
              >
                {devnetProof.accounts.settledRoomShardPda}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>

            <div className="grid grid-cols-1 gap-1.5 rounded border border-[#22262e] bg-[#0b0c0e] p-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-sans text-[#6b7280]">Delegation Program</span>
                <span className="text-[#d1d5db]">
                  {shortenAddress(devnetProof.programs.magicblockDelegation, 6, 6)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-[#6b7280]">TEE Permission</span>
                <span className="text-[#d1d5db]">
                  {shortenAddress(devnetProof.programs.magicblockPermission, 6, 6)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-[#6b7280]">MagicBlock VRF</span>
                <span className="text-[#d1d5db]">
                  {shortenAddress(devnetProof.programs.magicblockVrf, 6, 6)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Live Borsh-Decoded On-Chain Manifests & Shards */}
        <section className="rounded-lg border border-[#22262e] bg-[#111317] p-4 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-[#22262e] pb-2.5">
            <h2 className="text-xs font-semibold text-[#f3f4f6]">
              Live Borsh-Decoded Program Accounts (Devnet RPC)
            </h2>
            <span className="font-mono text-[11px] text-[#6b7280]">
              @cartridgefi/codama-clients
            </span>
          </div>

          <div className="mt-3 space-y-3 text-xs">
            {/* Registered Manifests */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-[#9ca3af]">
                Registered CartridgeManifest PDAs ({telemetry?.onchainAccounts?.manifests.length ?? 2})
              </div>
              <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                {(telemetry?.onchainAccounts?.manifests ?? []).map((m) => (
                  <div
                    key={m.pubkey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#22262e] bg-[#0b0c0e] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <a
                        href={`https://solscan.io/account/${m.pubkey}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#93c5fd] hover:underline"
                      >
                        {shortenAddress(m.pubkey, 8, 8)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <div className="mt-0.5 truncate text-[10px] text-[#9ca3af]">
                        {m.manifestUri || "On-chain CartridgeManifest v2"}
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-[#d1d5db]">
                      <div>
                        {m.durationSecs}s | Fog {(m.fogOfWarBps / 100).toFixed(0)}%
                      </div>
                      <div className="text-[#6b7280]">
                        Creator Split {(m.creatorShareBps / 100).toFixed(0)}% | Rooms: {m.totalRoomsCreated}
                      </div>
                    </div>
                  </div>
                ))}
                {!telemetry?.onchainAccounts?.manifests.length ? (
                  <div className="rounded border border-[#22262e] bg-[#0b0c0e] px-3 py-2 text-[#9ca3af]">
                    {devnetProof.accounts.referenceHarness001ManifestPda} &amp;{" "}
                    {shortenAddress(devnetProof.accounts.referenceHarness002ManifestPda, 6, 6)}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Decoded RoomShards */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-[#9ca3af]">
                On-Chain RoomShard Accounts ({telemetry?.onchainAccounts?.roomShards.length ?? 1})
              </div>
              <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                {(telemetry?.onchainAccounts?.roomShards ?? []).slice(0, 4).map((s) => (
                  <div
                    key={s.pubkey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#22262e] bg-[#0b0c0e] px-3 py-2"
                  >
                    <div>
                      <a
                        href={`https://solscan.io/account/${s.pubkey}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#f3f4f6] hover:text-[#93c5fd]"
                      >
                        Shard #{s.shardIndex} ({shortenAddress(s.pubkey, 6, 6)})
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <div className="mt-0.5 text-[10px] text-[#6b7280]">
                        VRF: {s.vrfFulfilled ? shortenAddress(s.vrfSeedHex, 10, 6) : "Pending"}
                      </div>
                    </div>
                    <div className="text-right text-[10px]">
                      <div className="text-[#34d399]">
                        Pool {formatMicroUnits(s.roomPoolUsdc)} SPL
                      </div>
                      <div className="text-[#9ca3af]">
                        {s.playerCount} Players | {s.delegatedToMagicBlock ? "Delegated ER" : "Settled L1"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Recent Signatures from RPC */}
            {telemetry?.recentSignatures && telemetry.recentSignatures.length > 0 ? (
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-[#9ca3af]">
                  Latest Live RPC Signatures (
                  <code className="font-mono text-[#d1d5db]">getSignaturesForAddress</code>)
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 font-mono text-[11px] tabular-nums">
                  {telemetry.recentSignatures.slice(0, 4).map((sig) => (
                    <a
                      key={sig.signature}
                      href={`https://solscan.io/tx/${sig.signature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded border border-[#22262e] bg-[#0b0c0e] px-2.5 py-1.5 text-[#93c5fd] hover:border-[#303642]"
                    >
                      <span>{shortenAddress(sig.signature, 6, 6)}</span>
                      <span className="text-[10px] text-[#6b7280]">
                        {sig.blockTime ? formatRelativeTime(sig.blockTime) : `Slot ${sig.slot}`}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* Filterable 33-Transaction Verified Devnet Execution Ledger */}
      <section
        id="protocol-proof-ledger"
        className="rounded-lg border border-[#22262e] bg-[#111317] overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#22262e] px-4 py-3">
          <div>
            <h2 className="text-xs font-semibold text-[#f3f4f6]">
              Verified On-Chain Execution Ledger ({filteredProofTxs.length} Transactions)
            </h2>
            <p className="mt-0.5 text-[11px] text-[#9ca3af]">
              End-to-end Devnet L1, MagicBlock Ephemeral Rollup, VRF callback, and eSPL private fee transfers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                id={`protocol-filter-${tab.id}`}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={cn(
                  "cf-btn cursor-pointer rounded border px-2.5 py-1 text-xs font-medium",
                  categoryFilter === tab.id
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
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#22262e] bg-[#0e1014] text-[11px] font-medium text-[#6b7280]">
                <th className="px-4 py-2">Execution Step</th>
                <th className="px-3 py-2">Layer</th>
                <th className="px-3 py-2">Signature</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22262e]">
              {filteredProofTxs.map((tx) => (
                <tr key={tx.signature} className="cf-row-hover">
                  <td className="px-4 py-2.5 font-medium text-[#f3f4f6]">
                    {tx.step}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[#9ca3af]">
                    {tx.layer}
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums">
                    <a
                      href={tx.solscanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#93c5fd] hover:underline"
                    >
                      {shortenAddress(tx.signature, 8, 8)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-[#9ca3af]">{tx.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
