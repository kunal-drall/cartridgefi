"use client";

import * as React from "react";
import { MagicBlockLockup, SolanaLockup } from "@cartridgefi/ui-system";
import { cn, shortenAddress } from "@/lib/utils";
import { useOptionalConsoleVault } from "@/app/(console)/_components/ConsoleVaultContext";
import { WalletStateReadout } from "@/components/wallet/WalletConnect";
import { DEVNET_RPC_FALLBACK, DEVNET_RPC_PRIMARY } from "@/lib/devnet-rpc";

/** MagicBlock devnet RPC first; the public endpoint only when it fails at the HTTP / network level. */
const SOLANA_DEVNET_RPC = [DEVNET_RPC_PRIMARY, DEVNET_RPC_FALLBACK] as const;
const MAGICBLOCK_ROUTER_RPC = "https://devnet-router.magicblock.app";
const MAGICBLOCK_TEE_RPC = "https://devnet-tee.magicblock.app";

type ProbeState =
  | { status: "pending" }
  | { status: "ok"; value: number | string; rttMs: number }
  | { status: "fail"; reason: string };

async function timedRpc(
  urls: string | readonly string[],
  method: string,
  timeoutMs: number,
): Promise<{ result: unknown; rttMs: number }> {
  const endpoints = typeof urls === "string" ? [urls] : urls;
  let res: Response | null = null;
  let started = 0;
  let failure: unknown = null;
  for (const url of endpoints) {
    started = performance.now();
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (res.ok) break;
    } catch (err) {
      res = null;
      failure = err;
    }
  }
  const rttMs = Math.round(performance.now() - started);
  if (!res) throw failure;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (json.error) throw new Error(`rpc: ${json.error.message ?? "error"}`);
  return { result: json.result, rttMs };
}

function failReason(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "timeout";
  }
  if (err instanceof Error) {
    return err.message.startsWith("HTTP") || err.message.startsWith("rpc:")
      ? err.message
      : "unreachable";
  }
  return "unreachable";
}

function useRpcProbe(
  url: string | readonly string[],
  method: string,
  everyMs: number,
): ProbeState {
  const [state, setState] = React.useState<ProbeState>({ status: "pending" });

  React.useEffect(() => {
    let active = true;
    const run = async (): Promise<void> => {
      try {
        const { result, rttMs } = await timedRpc(url, method, 5_000);
        if (!active) return;
        const value =
          typeof result === "number" || typeof result === "string"
            ? result
            : Array.isArray(result)
              ? result.length
              : "ok";
        setState({ status: "ok", value, rttMs });
      } catch (err) {
        if (active) setState({ status: "fail", reason: failReason(err) });
      }
    };
    void run();
    const id = window.setInterval(() => {
      void run();
    }, everyMs);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [url, method, everyMs]);

  return state;
}

function Dot({ tone }: { tone: "up" | "warn" | "down" }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "up" && "bg-[#10b981]",
        tone === "warn" && "bg-[#f59e0b]",
        tone === "down" && "bg-[#ef4444]",
      )}
    />
  );
}

function Cell({
  label,
  children,
  title,
}: {
  label: string;
  children: React.ReactNode;
  title?: string;
}): React.JSX.Element {
  return (
    <div
      title={title}
      className="flex h-full shrink-0 items-center gap-1.5 border-r border-[#22262e] px-3"
    >
      <span className="font-sans text-[10px] text-[#6b7280]">{label}</span>
      {children}
    </div>
  );
}

function ProbeReadout({
  probe,
  render,
}: {
  probe: ProbeState;
  render: (value: number | string, rttMs: number) => React.ReactNode;
}): React.JSX.Element {
  if (probe.status === "pending") {
    return (
      <>
        <Dot tone="warn" />
        <span className="text-[#6b7280]">— probing</span>
      </>
    );
  }
  if (probe.status === "fail") {
    return (
      <>
        <Dot tone="down" />
        <span className="text-[#9ca3af]">— {probe.reason}</span>
      </>
    );
  }
  return (
    <>
      <Dot tone="up" />
      {render(probe.value, probe.rttMs)}
    </>
  );
}

export interface OnchainStatebarProps {
  className?: string;
}

/**
 * Bottom on-chain status bar. Every value is measured from this browser:
 * - Solana devnet slot via getSlot on rpc.magicblock.app/devnet (falls back to api.devnet.solana.com)
 * - MagicBlock router round-trip via getRoutes on devnet-router.magicblock.app
 * - Private ER TEE reachability via getHealth on devnet-tee.magicblock.app
 * - Session signer state from ConsoleVaultContext
 */
export function OnchainStatebar({
  className,
}: OnchainStatebarProps): React.JSX.Element {
  const devnet = useRpcProbe(SOLANA_DEVNET_RPC, "getSlot", 8_000);
  const router = useRpcProbe(MAGICBLOCK_ROUTER_RPC, "getRoutes", 6_000);
  const tee = useRpcProbe(MAGICBLOCK_TEE_RPC, "getHealth", 15_000);
  const vault = useOptionalConsoleVault();
  const sessionKeyActive = vault?.sessionKeyActive ?? false;
  const sessionKeyPubkey = vault?.sessionKeyPubkey ?? "";

  return (
    <footer
      aria-label="On-chain network status"
      className={cn(
        "z-30 h-7 w-full overflow-x-auto overflow-y-hidden border-t border-[#22262e] bg-[#0b0c0e] font-mono text-[11px] tabular-nums text-[#d1d5db]",
        className,
      )}
    >
      <div className="flex h-full min-w-max items-center">
        <Cell label="Solana devnet" title="getSlot · rpc.magicblock.app/devnet (fallback api.devnet.solana.com)">
          <ProbeReadout
            probe={devnet}
            render={(slot, rtt) => (
              <>
                <span className="text-[#f3f4f6]">
                  {typeof slot === "number" ? slot.toLocaleString("en-US") : slot}
                </span>
                <span className="text-[#6b7280]">{rtt}ms</span>
              </>
            )}
          />
        </Cell>
        <Cell
          label="MagicBlock router RTT"
          title="getRoutes round-trip · devnet-router.magicblock.app"
        >
          <ProbeReadout
            probe={router}
            render={(routes, rtt) => (
              <>
                <span className="text-[#f3f4f6]">{rtt}ms</span>
                <span className="text-[#6b7280]">
                  {typeof routes === "number" ? `${routes} ER routes` : ""}
                </span>
              </>
            )}
          />
        </Cell>
        <Cell label="TEE" title="getHealth · devnet-tee.magicblock.app">
          <ProbeReadout
            probe={tee}
            render={(health, rtt) => (
              <>
                <span className="text-[#f3f4f6]">
                  {health === "ok" ? "reachable" : String(health)}
                </span>
                <span className="text-[#6b7280]">{rtt}ms</span>
              </>
            )}
          />
        </Cell>
        <Cell label="Session key" title="Ed25519 WebCrypto session signer">
          {sessionKeyActive ? (
            <>
              <Dot tone="up" />
              <span className="text-[#f3f4f6]">
                {shortenAddress(sessionKeyPubkey, 4, 4)}
              </span>
            </>
          ) : (
            <>
              <Dot tone="warn" />
              <span className="text-[#9ca3af]">
                {vault ? "— not generated yet" : "— no session on this page"}
              </span>
            </>
          )}
        </Cell>
        <Cell label="Wallet" title="Wallet Standard · Solana devnet">
          <WalletStateReadout />
        </Cell>
        <div className="ml-auto flex h-full shrink-0 items-center gap-2 border-l border-[#22262e] px-3 font-sans text-[10px] text-[#6b7280]">
          <SolanaLockup size="sm" clearspace={false} />
          <span>Settled on Solana</span>
          <span aria-hidden="true" className="text-[#303642]">|</span>
          <MagicBlockLockup size="sm" clearspace={false} />
        </div>
      </div>
    </footer>
  );
}
