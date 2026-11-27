"use client";

import * as React from "react";
import type { KeyPairSigner } from "@solana/kit";
import {
  FP_SCALE,
  USDC_UNIT,
  formatScaledBigInt,
  type ClaimAssetSymbol,
} from "@cartridgefi/shared-types";
import {
  detectBrowserSolanaWallets,
  fetchWalletDevnetBalances,
  getOrCreateBrowserSessionSigner,
  type DetectedBrowserWallet,
} from "@/lib/solana-wallet";
import { toast } from "sonner";

export type ConsoleAuthMethod = "solana-wallet" | "session-keypair";

export interface EarnedStockHoldings {
  NVDAx: bigint;
  ANTx: bigint;
  SPYx: bigint;
  TSLAx: bigint;
  USDC: bigint;
}

export interface CashierReceipt {
  id: string;
  sourceLabel: string;
  creditedUsdcFormatted: string;
  txSignature: string | null;
  solscanUrl: string | null;
  sessionKeyPubkey: string;
  isPaperCredit: boolean;
}

export interface ConsoleVaultContextValue {
  /** Paper / simulation trading margin (6-decimal USDC units), explicitly separated from on-chain balances */
  cashUsdcAtomic: bigint;
  /** Real live Solana Devnet lamports read via getBalance */
  onchainSolLamports: bigint;
  /** Real live Solana Devnet SPL token balance read via getTokenAccountsByOwner */
  onchainSplAtomic: bigint;
  earnedStocks: EarnedStockHoldings;
  marketEloScaled: bigint;
  matchesPlayed: number;
  winsCount: number;
  sessionKeyActive: boolean;
  sessionKeyPubkey: string;
  sessionSigner: KeyPairSigner | null;
  playerWallet: string;
  connectedBrowserWalletName: string | null;
  detectedWallets: DetectedBrowserWallet[];
  authMethod: ConsoleAuthMethod;
  isCashierOpen: boolean;
  lastCashierReceipt: CashierReceipt | null;
  openCashier: () => void;
  closeCashier: () => void;
  setAuthMethod: (method: ConsoleAuthMethod) => void;
  connectBrowserWallet: (walletId?: string) => Promise<void>;
  rotateSessionKeypair: () => Promise<void>;
  refreshOnchainBalances: () => Promise<void>;
  mintDevnetUsdc: (amountUsdcWhole?: number) => Promise<CashierReceipt>;
  requestDevnetSolAirdrop: () => Promise<CashierReceipt>;
  depositToUnifiedCash: (
    sourceLabel: string,
    amountUsdcWhole: number,
  ) => Promise<CashierReceipt>;
  creditEarnedVaultPrize: (
    asset: ClaimAssetSymbol,
    usdcValueAtomic: bigint,
    referencePrice8: bigint,
  ) => { creditedLabel: string; txSignature: string | null };
  recordRoundElo: (nextEloScaled: bigint, isPodiumWin: boolean) => void;
}

export function formatAtomicUsdc(
  atomic: bigint,
  includeDollar: boolean = true,
): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const whole = abs / USDC_UNIT;
  const cents = ((abs % USDC_UNIT) / 10_000n).toString().padStart(2, "0");
  const formattedWhole = new Intl.NumberFormat("en-US").format(whole);
  const prefix = neg ? "-" : "";
  return includeDollar
    ? `${prefix}$${formattedWhole}.${cents}`
    : `${prefix}${formattedWhole}.${cents}`;
}

export function formatSolLamports(lamports: bigint): string {
  const sol = Number(lamports) / 1e9;
  return `${sol.toFixed(4)} SOL`;
}

export function formatShareUnits6(units: bigint, decimals: number = 3): string {
  const scaled9 = units * 1_000n;
  return formatScaledBigInt(scaled9, decimals);
}

export function formatEloInteger(eloScaled: bigint): string {
  const whole = eloScaled / FP_SCALE;
  return new Intl.NumberFormat("en-US").format(whole);
}

const ConsoleVaultContext =
  React.createContext<ConsoleVaultContextValue | null>(null);

export function ConsoleVaultProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  // Honest initial state: 0 matches played, 0 earned stocks until real rounds settle
  const [cashUsdcAtomic, setCashUsdcAtomic] =
    React.useState<bigint>(100_000_000n);
  const [onchainSolLamports, setOnchainSolLamports] =
    React.useState<bigint>(0n);
  const [onchainSplAtomic, setOnchainSplAtomic] = React.useState<bigint>(0n);
  const [earnedStocks, setEarnedStocks] = React.useState<EarnedStockHoldings>({
    NVDAx: 0n,
    ANTx: 0n,
    SPYx: 0n,
    TSLAx: 0n,
    USDC: 0n,
  });
  const [marketEloScaled, setMarketEloScaled] =
    React.useState<bigint>(1_200_000_000_000n);
  const [matchesPlayed, setMatchesPlayed] = React.useState<number>(0);
  const [winsCount, setWinsCount] = React.useState<number>(0);

  const [sessionSigner, setSessionSigner] =
    React.useState<KeyPairSigner | null>(null);
  const [sessionKeyPubkey, setSessionKeyPubkey] = React.useState<string>("");
  const [browserWalletAddress, setBrowserWalletAddress] =
    React.useState<string | null>(null);
  const [connectedBrowserWalletName, setConnectedBrowserWalletName] =
    React.useState<string | null>(null);
  const [detectedWallets, setDetectedWallets] = React.useState<
    DetectedBrowserWallet[]
  >([]);
  const [authMethod, setAuthMethod] =
    React.useState<ConsoleAuthMethod>("session-keypair");
  const [isCashierOpen, setIsCashierOpen] = React.useState<boolean>(false);
  const [lastCashierReceipt, setLastCashierReceipt] =
    React.useState<CashierReceipt | null>(null);

  const actionCounterRef = React.useRef<number>(0);
  const activeWallet = browserWalletAddress ?? sessionKeyPubkey;

  // Boot real Ed25519 WebCrypto Session Signer & discover browser Solana wallets
  React.useEffect(() => {
    let mounted = true;
    setDetectedWallets(detectBrowserSolanaWallets());

    void getOrCreateBrowserSessionSigner(false).then(async (signer) => {
      if (!mounted) return;
      setSessionSigner(signer);
      setSessionKeyPubkey(signer.address);
      const balances = await fetchWalletDevnetBalances(signer.address);
      if (!mounted) return;
      setOnchainSolLamports(balances.lamports);
      setOnchainSplAtomic(balances.splAtomic);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const refreshOnchainBalances = React.useCallback(async () => {
    if (!activeWallet) return;
    const balances = await fetchWalletDevnetBalances(activeWallet);
    setOnchainSolLamports(balances.lamports);
    setOnchainSplAtomic(balances.splAtomic);
  }, [activeWallet]);

  const connectBrowserWallet = React.useCallback(async (walletId?: string) => {
    const list = detectBrowserSolanaWallets();
    setDetectedWallets(list);
    const target = walletId
      ? list.find((w) => w.id === walletId) ?? list[0]
      : list[0];

    if (!target) {
      toast.error("No browser Solana wallet detected (install Phantom, Solflare, or Backpack). Using Ed25519 session signer.");
      return;
    }

    try {
      const resp = await target.provider.connect();
      const pubkey =
        resp?.publicKey?.toBase58() ?? target.provider.publicKey?.toBase58();
      if (pubkey) {
        setBrowserWalletAddress(pubkey);
        setConnectedBrowserWalletName(target.name);
        setAuthMethod("solana-wallet");
        const balances = await fetchWalletDevnetBalances(pubkey);
        setOnchainSolLamports(balances.lamports);
        setOnchainSplAtomic(balances.splAtomic);
        toast.success(`Connected ${target.name} (${pubkey.slice(0, 4)}…${pubkey.slice(-4)})`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Wallet connection rejected",
      );
    }
  }, []);

  const rotateSessionKeypair = React.useCallback(async () => {
    const signer = await getOrCreateBrowserSessionSigner(true);
    setSessionSigner(signer);
    setSessionKeyPubkey(signer.address);
    if (!browserWalletAddress) {
      const balances = await fetchWalletDevnetBalances(signer.address);
      setOnchainSolLamports(balances.lamports);
      setOnchainSplAtomic(balances.splAtomic);
    }
    toast.success(
      `Generated fresh Ed25519 session signer (${signer.address.slice(0, 6)}…)`,
    );
  }, [browserWalletAddress]);

  const openCashier = React.useCallback(() => {
    setIsCashierOpen(true);
  }, []);

  const closeCashier = React.useCallback(() => {
    setIsCashierOpen(false);
  }, []);

  const mintDevnetUsdc = React.useCallback(
    async (amountUsdcWhole: number = 100): Promise<CashierReceipt> => {
      const idx = actionCounterRef.current;
      actionCounterRef.current += 1;

      const safeWhole = Math.max(
        10,
        Math.min(1000, Math.trunc(amountUsdcWhole)),
      );
      const deltaAtomic = BigInt(safeWhole) * USDC_UNIT;
      let realSig: string | null = null;
      let solscanUrl: string | null = null;
      let isPaperCredit = true;

      try {
        const res = await fetch("/api/cashier/faucet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: activeWallet,
            amountUsdcAtomic: deltaAtomic.toString(),
            requestDevnetSol: false,
          }),
        });
        if (res.ok) {
          const payload = (await res.json()) as {
            txSignature?: string | null;
            solscanTxUrl?: string | null;
            onchainLamports?: string;
            onchainSplAtomic?: string;
            status?: string;
          };
          if (payload.txSignature) {
            realSig = payload.txSignature;
            solscanUrl = payload.solscanTxUrl ?? null;
            isPaperCredit = false;
          }
          if (payload.onchainLamports) {
            setOnchainSolLamports(BigInt(payload.onchainLamports));
          }
          if (payload.onchainSplAtomic) {
            setOnchainSplAtomic(BigInt(payload.onchainSplAtomic));
          }
        }
      } catch {
        // Offline paper margin credit
      }

      setCashUsdcAtomic((prev) => prev + deltaAtomic);

      const receipt: CashierReceipt = {
        id: `credit-${idx + 1}`,
        sourceLabel: isPaperCredit
          ? "Paper Simulation Margin Credit"
          : "Solana Devnet Relayer Credit",
        creditedUsdcFormatted: formatAtomicUsdc(deltaAtomic),
        txSignature: realSig,
        solscanUrl,
        sessionKeyPubkey,
        isPaperCredit,
      };
      setLastCashierReceipt(receipt);
      toast.success(`Added ${formatAtomicUsdc(deltaAtomic)} paper trading margin`);
      return receipt;
    },
    [activeWallet, sessionKeyPubkey],
  );

  const requestDevnetSolAirdrop = React.useCallback(async (): Promise<CashierReceipt> => {
    const idx = actionCounterRef.current;
    actionCounterRef.current += 1;
    let realSig: string | null = null;
    let solscanUrl: string | null = null;
    let airdropErr: string | null = null;

    try {
      const res = await fetch("/api/cashier/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: activeWallet,
          requestDevnetSol: true,
        }),
      });
      const payload = (await res.json()) as {
        txSignature?: string | null;
        solscanTxUrl?: string | null;
        onchainLamports?: string;
        airdropError?: string | null;
      };
      realSig = payload.txSignature ?? null;
      solscanUrl = payload.solscanTxUrl ?? null;
      airdropErr = payload.airdropError ?? null;
      if (payload.onchainLamports) {
        setOnchainSolLamports(BigInt(payload.onchainLamports));
      }
    } catch (err) {
      airdropErr = err instanceof Error ? err.message : "Devnet RPC error";
    }

    if (realSig) {
      toast.success("0.5 Devnet SOL airdrop submitted on Solana Devnet");
    } else {
      toast.warning(
        airdropErr
          ? `Solana Devnet faucet rate-limited: ${airdropErr}`
          : "Solana Devnet public faucet rate-limited; use faucet.solana.com for live SOL.",
      );
    }

    const receipt: CashierReceipt = {
      id: `airdrop-${idx + 1}`,
      sourceLabel: realSig
        ? "Solana Devnet 0.5 SOL Airdrop"
        : `Devnet Faucet Rate-Limited (${airdropErr ?? "429"})`,
      creditedUsdcFormatted: realSig ? "0.5000 SOL" : "0.0000 SOL",
      txSignature: realSig,
      solscanUrl,
      sessionKeyPubkey,
      isPaperCredit: !realSig,
    };
    setLastCashierReceipt(receipt);
    return receipt;
  }, [activeWallet, sessionKeyPubkey]);

  const depositToUnifiedCash = React.useCallback(
    async (
      sourceLabel: string,
      amountUsdcWhole: number,
    ): Promise<CashierReceipt> => {
      const idx = actionCounterRef.current;
      actionCounterRef.current += 1;

      const safeWhole = Math.max(
        10,
        Math.min(2500, Math.trunc(amountUsdcWhole)),
      );
      const deltaAtomic = BigInt(safeWhole) * USDC_UNIT;
      setCashUsdcAtomic((prev) => prev + deltaAtomic);

      const receipt: CashierReceipt = {
        id: `deposit-${idx + 1}`,
        sourceLabel: `${sourceLabel} (Paper Simulation)`,
        creditedUsdcFormatted: formatAtomicUsdc(deltaAtomic),
        txSignature: null,
        solscanUrl: null,
        sessionKeyPubkey,
        isPaperCredit: true,
      };
      setLastCashierReceipt(receipt);
      return receipt;
    },
    [sessionKeyPubkey],
  );

  const creditEarnedVaultPrize = React.useCallback(
    (
      asset: ClaimAssetSymbol,
      usdcValueAtomic: bigint,
      referencePrice8: bigint,
    ): { creditedLabel: string; txSignature: string | null } => {
      if (asset === "USDC" || referencePrice8 <= 0n) {
        setCashUsdcAtomic((prev) => prev + usdcValueAtomic);
        setEarnedStocks((prev) => ({
          ...prev,
          USDC: prev.USDC + usdcValueAtomic,
        }));
        return {
          creditedLabel: `${formatAtomicUsdc(usdcValueAtomic)} USDC`,
          txSignature: null,
        };
      }

      const shareUnits6 = (usdcValueAtomic * 100_000_000n) / referencePrice8;
      const nonZeroUnits = shareUnits6 > 0n ? shareUnits6 : 10_000n;

      setEarnedStocks((prev) => ({
        ...prev,
        [asset]: prev[asset] + nonZeroUnits,
      }));

      return {
        creditedLabel: `+${formatShareUnits6(nonZeroUnits, 4)} ${asset} (${formatAtomicUsdc(usdcValueAtomic)})`,
        txSignature: null,
      };
    },
    [],
  );

  const recordRoundElo = React.useCallback(
    (nextEloScaled: bigint, isPodiumWin: boolean): void => {
      setMarketEloScaled(nextEloScaled);
      setMatchesPlayed((prev) => prev + 1);
      if (isPodiumWin) {
        setWinsCount((prev) => prev + 1);
      }
    },
    [],
  );

  const value = React.useMemo<ConsoleVaultContextValue>(
    () => ({
      cashUsdcAtomic,
      onchainSolLamports,
      onchainSplAtomic,
      earnedStocks,
      marketEloScaled,
      matchesPlayed,
      winsCount,
      sessionKeyActive: Boolean(sessionKeyPubkey),
      sessionKeyPubkey,
      sessionSigner,
      playerWallet: activeWallet,
      connectedBrowserWalletName,
      detectedWallets,
      authMethod,
      isCashierOpen,
      lastCashierReceipt,
      openCashier,
      closeCashier,
      setAuthMethod,
      connectBrowserWallet,
      rotateSessionKeypair,
      refreshOnchainBalances,
      mintDevnetUsdc,
      requestDevnetSolAirdrop,
      depositToUnifiedCash,
      creditEarnedVaultPrize,
      recordRoundElo,
    }),
    [
      cashUsdcAtomic,
      onchainSolLamports,
      onchainSplAtomic,
      earnedStocks,
      marketEloScaled,
      matchesPlayed,
      winsCount,
      sessionKeyPubkey,
      sessionSigner,
      activeWallet,
      connectedBrowserWalletName,
      detectedWallets,
      authMethod,
      isCashierOpen,
      lastCashierReceipt,
      openCashier,
      closeCashier,
      connectBrowserWallet,
      rotateSessionKeypair,
      refreshOnchainBalances,
      mintDevnetUsdc,
      requestDevnetSolAirdrop,
      depositToUnifiedCash,
      creditEarnedVaultPrize,
      recordRoundElo,
    ],
  );

  return (
    <ConsoleVaultContext.Provider value={value}>
      {children}
    </ConsoleVaultContext.Provider>
  );
}

export function useConsoleVault(): ConsoleVaultContextValue {
  const ctx = React.useContext(ConsoleVaultContext);
  if (!ctx) {
    throw new Error(
      "useConsoleVault must be used within a ConsoleVaultProvider",
    );
  }
  return ctx;
}
