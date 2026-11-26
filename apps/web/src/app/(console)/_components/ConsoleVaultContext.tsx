"use client";

import * as React from "react";
import {
  FP_SCALE,
  USDC_UNIT,
  formatScaledBigInt,
  type ClaimAssetSymbol,
} from "@cartridgefi/shared-types";

export type ConsoleAuthMethod = "passkey" | "apple" | "google" | "solana-wallet";

export interface EarnedStockHoldings {
  /** 6-decimal fractional share units (`1_000_000n` = `1.000000` share). */
  NVDAx: bigint;
  ANTx: bigint;
  SPYx: bigint;
  TSLAx: bigint;
  /** 6-decimal atomic USDC claimed directly as cash prizes. */
  USDC: bigint;
}

export interface CashierReceipt {
  id: string;
  sourceLabel: string;
  creditedUsdcFormatted: string;
  txSignature: string;
  sessionKeyPubkey: string;
}

export interface ConsoleVaultContextValue {
  cashUsdcAtomic: bigint;
  earnedStocks: EarnedStockHoldings;
  marketEloScaled: bigint;
  matchesPlayed: number;
  winsCount: number;
  sessionKeyActive: boolean;
  sessionKeyPubkey: string;
  playerWallet: string;
  authMethod: ConsoleAuthMethod;
  isCashierOpen: boolean;
  lastCashierReceipt: CashierReceipt | null;
  openCashier: () => void;
  closeCashier: () => void;
  setAuthMethod: (method: ConsoleAuthMethod) => void;
  mintDevnetUsdc: (amountUsdcWhole?: number) => Promise<CashierReceipt>;
  depositToUnifiedCash: (sourceLabel: string, amountUsdcWhole: number) => Promise<CashierReceipt>;
  creditEarnedVaultPrize: (
    asset: ClaimAssetSymbol,
    usdcValueAtomic: bigint,
    referencePrice8: bigint,
  ) => { creditedLabel: string; txSignature: string };
  recordRoundElo: (nextEloScaled: bigint, isPodiumWin: boolean) => void;
}

const DEFAULT_PLAYER_WALLET = "BrL8xQm9vP4kT2nW7yC5fJ3dH6gZ1uQaR8eM4sV2pXnK";
const DEFAULT_SESSION_PUBKEY = "SesK9xVq7mR2pL8wT4nB6yF3cJ5dH1gZ8uQaW4eP2rYv";

const SESSION_KEY_ROTATION: readonly string[] = [
  "SesK9xVq7mR2pL8wT4nB6yF3cJ5dH1gZ8uQaW4eP2rYv",
  "SesK4mNp8vQ3rW9xL2tC7yF5bJ1dH6gZ3uQaE8sK5wXz",
  "SesK7pQr2xM9vL4nW8tB3yF6cJ9dH2gZ5uQaT1mR7vLp",
  "SesK2wLm6qP9vR4xN7tC8yF1bJ4dH9gZ6uQaK3nW8xQr",
];

const DETERMINISTIC_SIGS: readonly string[] = [
  "5xKm9QpL2vR8wN4tB7yF3cJ6dH1gZ9uQaW4eP2rYv8mK3xLp7qR2vN9wT5bC4yF8",
  "4pQr7LmK9vW3xN8tC2yF6bJ5dH4gZ2uQaE9sK6wXz3nM8vQr4pL7xN2wT9bC5yF1",
  "3wLm8QpR4vK7xN2tB9yF5cJ8dH3gZ7uQaT2mR9vLp6xK4wQr8pN3vL7tB2cF9yJ5",
  "2nQr6LmP8vR4xK9tC5yF2bJ7dH8gZ4uQaK5nW3xQr9mL2vQp7rN4xK8tB6cF3yJ9",
];

export function formatAtomicUsdc(atomic: bigint, includeDollar: boolean = true): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const whole = abs / USDC_UNIT;
  const cents = ((abs % USDC_UNIT) / 10_000n).toString().padStart(2, "0");
  const formattedWhole = new Intl.NumberFormat("en-US").format(whole);
  const prefix = neg ? "-" : "";
  return includeDollar ? `${prefix}$${formattedWhole}.${cents}` : `${prefix}${formattedWhole}.${cents}`;
}

export function formatShareUnits6(units: bigint, decimals: number = 3): string {
  const scaled9 = units * 1_000n;
  return formatScaledBigInt(scaled9, decimals);
}

export function formatEloInteger(eloScaled: bigint): string {
  const whole = eloScaled / FP_SCALE;
  return new Intl.NumberFormat("en-US").format(whole);
}

const ConsoleVaultContext = React.createContext<ConsoleVaultContextValue | null>(null);

export function ConsoleVaultProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [cashUsdcAtomic, setCashUsdcAtomic] = React.useState<bigint>(250_000_000n);
  const [earnedStocks, setEarnedStocks] = React.useState<EarnedStockHoldings>({
    NVDAx: 1_850_000n, // 1.850 sh
    ANTx: 2_400_000n, // 2.400 sh
    SPYx: 720_000n, // 0.720 sh
    TSLAx: 0n,
    USDC: 142_500_000n, // $142.50 USDC
  });
  const [marketEloScaled, setMarketEloScaled] = React.useState<bigint>(1_482_000_000_000n);
  const [matchesPlayed, setMatchesPlayed] = React.useState<number>(18);
  const [winsCount, setWinsCount] = React.useState<number>(11);
  const [sessionKeyActive, setSessionKeyActive] = React.useState<boolean>(true);
  const [sessionKeyPubkey, setSessionKeyPubkey] =
    React.useState<string>(DEFAULT_SESSION_PUBKEY);
  const [authMethod, setAuthMethod] = React.useState<ConsoleAuthMethod>("passkey");
  const [isCashierOpen, setIsCashierOpen] = React.useState<boolean>(false);
  const [lastCashierReceipt, setLastCashierReceipt] =
    React.useState<CashierReceipt | null>(null);
  const actionCounterRef = React.useRef<number>(0);

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

      const safeWhole = Math.max(10, Math.min(1000, Math.trunc(amountUsdcWhole)));
      const deltaAtomic = BigInt(safeWhole) * USDC_UNIT;
      let remoteSig: string | null = null;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 350);
        const res = await fetch("/api/cashier/faucet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet: DEFAULT_PLAYER_WALLET,
            amountUsdcAtomic: deltaAtomic.toString(),
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const payload = (await res.json()) as { txSignature?: string };
          if (typeof payload.txSignature === "string" && payload.txSignature.length >= 16) {
            remoteSig = payload.txSignature;
          }
        }
      } catch {
        // Deterministic local fallback when running standalone without core-api
      }

      const nextSessionKey =
        SESSION_KEY_ROTATION[idx % SESSION_KEY_ROTATION.length] ?? DEFAULT_SESSION_PUBKEY;
      const txSignature =
        remoteSig ?? DETERMINISTIC_SIGS[idx % DETERMINISTIC_SIGS.length]!;

      setCashUsdcAtomic((prev) => prev + deltaAtomic);
      setSessionKeyActive(true);
      setSessionKeyPubkey(nextSessionKey);

      const receipt: CashierReceipt = {
        id: `faucet-${idx + 1}`,
        sourceLabel: "Devnet USDC Faucet + Kora Session Init",
        creditedUsdcFormatted: formatAtomicUsdc(deltaAtomic),
        txSignature,
        sessionKeyPubkey: nextSessionKey,
      };
      setLastCashierReceipt(receipt);
      return receipt;
    },
    [],
  );

  const depositToUnifiedCash = React.useCallback(
    async (sourceLabel: string, amountUsdcWhole: number): Promise<CashierReceipt> => {
      const idx = actionCounterRef.current;
      actionCounterRef.current += 1;

      const safeWhole = Math.max(10, Math.min(2500, Math.trunc(amountUsdcWhole)));
      const deltaAtomic = BigInt(safeWhole) * USDC_UNIT;
      const nextSessionKey =
        SESSION_KEY_ROTATION[idx % SESSION_KEY_ROTATION.length] ?? DEFAULT_SESSION_PUBKEY;
      const txSignature = DETERMINISTIC_SIGS[idx % DETERMINISTIC_SIGS.length]!;

      setCashUsdcAtomic((prev) => prev + deltaAtomic);
      setSessionKeyActive(true);
      setSessionKeyPubkey(nextSessionKey);

      const receipt: CashierReceipt = {
        id: `deposit-${idx + 1}`,
        sourceLabel,
        creditedUsdcFormatted: formatAtomicUsdc(deltaAtomic),
        txSignature,
        sessionKeyPubkey: nextSessionKey,
      };
      setLastCashierReceipt(receipt);
      return receipt;
    },
    [],
  );

  const creditEarnedVaultPrize = React.useCallback(
    (
      asset: ClaimAssetSymbol,
      usdcValueAtomic: bigint,
      referencePrice8: bigint,
    ): { creditedLabel: string; txSignature: string } => {
      const idx = actionCounterRef.current;
      actionCounterRef.current += 1;
      const txSignature = DETERMINISTIC_SIGS[idx % DETERMINISTIC_SIGS.length]!;

      if (asset === "USDC" || referencePrice8 <= 0n) {
        setCashUsdcAtomic((prev) => prev + usdcValueAtomic);
        setEarnedStocks((prev) => ({
          ...prev,
          USDC: prev.USDC + usdcValueAtomic,
        }));
        return {
          creditedLabel: `${formatAtomicUsdc(usdcValueAtomic)} USDC`,
          txSignature,
        };
      }

      // usdcValueAtomic is 10^6, referencePrice8 is 10^8 => shareUnits6 = (usdcValueAtomic * 10^8) / referencePrice8
      const shareUnits6 = (usdcValueAtomic * 100_000_000n) / referencePrice8;
      const nonZeroUnits = shareUnits6 > 0n ? shareUnits6 : 10_000n;

      setEarnedStocks((prev) => ({
        ...prev,
        [asset]: prev[asset] + nonZeroUnits,
      }));

      return {
        creditedLabel: `+${formatShareUnits6(nonZeroUnits, 3)} ${asset} (${formatAtomicUsdc(usdcValueAtomic)})`,
        txSignature,
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
      earnedStocks,
      marketEloScaled,
      matchesPlayed,
      winsCount,
      sessionKeyActive,
      sessionKeyPubkey,
      playerWallet: DEFAULT_PLAYER_WALLET,
      authMethod,
      isCashierOpen,
      lastCashierReceipt,
      openCashier,
      closeCashier,
      setAuthMethod,
      mintDevnetUsdc,
      depositToUnifiedCash,
      creditEarnedVaultPrize,
      recordRoundElo,
    }),
    [
      cashUsdcAtomic,
      earnedStocks,
      marketEloScaled,
      matchesPlayed,
      winsCount,
      sessionKeyActive,
      sessionKeyPubkey,
      authMethod,
      isCashierOpen,
      lastCashierReceipt,
      openCashier,
      closeCashier,
      mintDevnetUsdc,
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
    throw new Error("useConsoleVault must be used within a ConsoleVaultProvider");
  }
  return ctx;
}
