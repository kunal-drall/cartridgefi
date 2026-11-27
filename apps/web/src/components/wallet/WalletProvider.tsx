"use client";

import * as React from "react";
import { address, isAddress, type Address } from "@solana/kit";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { walletClient } from "@/lib/wallet/client";
import {
  envTestUsdcMint,
  fetchSolLamports,
  fetchTokenAtomic,
  requestDevnetAirdrop,
  type AirdropResult,
} from "@/lib/wallet/assets";

type UiWallet = ReturnType<typeof useWallets>[number];

export type FaucetNotice = { tone: "ok" | "warn" | "error"; text: string; href?: string } | null;

interface WalletContextValue {
  /** False during SSR and the first client render: wallet detection is client-only. */
  mounted: boolean;
  wallets: readonly UiWallet[];
  status: ReturnType<typeof useWalletStatus>;
  walletAddress: Address | null;
  walletName: string | null;
  walletIcon: string | null;
  connect: (wallet: UiWallet) => void;
  disconnect: () => void;
  connectError: string | null;
  solLamports: bigint | null;
  usdc: { atomic: bigint; decimals: number } | null;
  usdcMint: Address | null;
  faucetOnline: boolean | null;
  refreshBalances: () => void;
  airdropSol: () => Promise<void>;
  claimTestUsdc: () => Promise<void>;
  assetBusy: "sol" | "usdc" | null;
  notice: FaucetNotice;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

const WalletContext = React.createContext<WalletContextValue | null>(null);

function airdropNotice(r: AirdropResult): FaucetNotice {
  if (r.status === "ok") return { tone: "ok", text: `Airdrop confirmed · ${r.signature.slice(0, 8)}…` };
  return { tone: r.status === "error" ? "error" : "warn", text: r.reason, href: "https://faucet.solana.com" };
}

export function BorelWalletProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const wallets = useWallets(walletClient);
  const connected = useConnectedWallet(walletClient);
  const status = useWalletStatus(walletClient);
  const connectAction = useConnect(walletClient);
  const disconnectAction = useDisconnect(walletClient);

  const walletAddress =
    connected && isAddress(connected.account.address) ? address(connected.account.address) : null;

  const [solLamports, setSolLamports] = React.useState<bigint | null>(null);
  const [usdc, setUsdc] = React.useState<{ atomic: bigint; decimals: number } | null>(null);
  const [usdcMint, setUsdcMint] = React.useState<Address | null>(null);
  const [faucetOnline, setFaucetOnline] = React.useState<boolean | null>(null);
  const [assetBusy, setAssetBusy] = React.useState<"sol" | "usdc" | null>(null);
  const [notice, setNotice] = React.useState<FaucetNotice>(null);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [connectError, setConnectError] = React.useState<string | null>(null);

  // Faucet availability + mint (probed server-side so a missing route never shows as a browser 404).
  React.useEffect(() => {
    if (!mounted) return;
    let active = true;
    const envMint = envTestUsdcMint();
    if (envMint) setUsdcMint(envMint);
    fetch("/api/wallet/assets", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ faucetOnline: boolean; mint: string | null }>) : null))
      .then((body) => {
        if (!active || !body) return;
        setFaucetOnline(body.faucetOnline);
        if (body.mint && isAddress(body.mint)) setUsdcMint(address(body.mint));
      })
      .catch(() => {
        if (active) setFaucetOnline(false);
      });
    return () => {
      active = false;
    };
  }, [mounted, refreshTick]);

  // Live balances for the connected wallet (devnet SOL + test-USDC when the mint is known).
  React.useEffect(() => {
    if (!walletAddress) {
      setSolLamports(null);
      setUsdc(null);
      return;
    }
    let active = true;
    const load = () => {
      fetchSolLamports(walletAddress)
        .then((v) => active && setSolLamports(v))
        .catch(() => undefined);
      if (usdcMint) {
        fetchTokenAtomic(walletAddress, usdcMint)
          .then((v) => active && setUsdc(v))
          .catch(() => undefined);
      }
    };
    load();
    const id = window.setInterval(load, 20_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [walletAddress, usdcMint, refreshTick]);

  const refreshBalances = React.useCallback(() => setRefreshTick((t) => t + 1), []);

  const connect = React.useCallback(
    (wallet: UiWallet) => {
      setConnectError(null);
      connectAction.dispatchAsync(wallet).catch((err: unknown) => {
        setConnectError(err instanceof Error ? err.message.slice(0, 160) : "Connection was rejected");
      });
    },
    [connectAction],
  );

  const disconnect = React.useCallback(() => {
    disconnectAction.dispatchAsync().catch(() => undefined);
    setNotice(null);
  }, [disconnectAction]);

  const airdropSol = React.useCallback(async () => {
    if (!walletAddress) return;
    setAssetBusy("sol");
    setNotice(null);
    try {
      setNotice(airdropNotice(await requestDevnetAirdrop(walletAddress)));
      refreshBalances();
    } finally {
      setAssetBusy(null);
    }
  }, [walletAddress, refreshBalances]);

  const claimTestUsdc = React.useCallback(async () => {
    if (!walletAddress || !faucetOnline) return;
    setAssetBusy("usdc");
    setNotice(null);
    try {
      const res = await fetch("/api/borel/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress }),
      });
      const body = (await res.json().catch(() => null)) as
        | { status?: string; reason?: string; signature?: string; mint?: string }
        | null;
      if (body?.status === "ok") {
        if (body.mint && isAddress(body.mint)) setUsdcMint(address(body.mint));
        setNotice({
          tone: "ok",
          text: body.signature ? `Test-USDC sent · ${body.signature.slice(0, 8)}…` : "Test-USDC sent",
        });
        refreshBalances();
      } else {
        setNotice({ tone: "error", text: body?.reason ?? `Faucet failed (HTTP ${res.status})` });
      }
    } catch {
      setNotice({ tone: "error", text: "Faucet unreachable" });
    } finally {
      setAssetBusy(null);
    }
  }, [walletAddress, faucetOnline, refreshBalances]);

  const value = React.useMemo<WalletContextValue>(
    () => ({
      mounted,
      wallets: mounted ? wallets : [],
      status,
      walletAddress: mounted ? walletAddress : null,
      walletName: mounted && connected ? connected.wallet.name : null,
      walletIcon: mounted && connected ? connected.wallet.icon : null,
      connect,
      disconnect,
      connectError,
      solLamports,
      usdc,
      usdcMint,
      faucetOnline,
      refreshBalances,
      airdropSol,
      claimTestUsdc,
      assetBusy,
      notice,
      panelOpen,
      setPanelOpen,
    }),
    [
      mounted,
      wallets,
      status,
      walletAddress,
      connected,
      connect,
      disconnect,
      connectError,
      solLamports,
      usdc,
      usdcMint,
      faucetOnline,
      refreshBalances,
      airdropSol,
      claimTestUsdc,
      assetBusy,
      notice,
      panelOpen,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useBorelWallet(): WalletContextValue {
  const ctx = React.useContext(WalletContext);
  if (!ctx) throw new Error("useBorelWallet must be used inside <BorelWalletProvider>");
  return ctx;
}

export function useOptionalBorelWallet(): WalletContextValue | null {
  return React.useContext(WalletContext);
}
