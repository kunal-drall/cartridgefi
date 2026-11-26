"use client";

import * as React from "react";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  MAGICBLOCK_CONSTANTS,
  SOLANA_CANONICAL_MINTS,
  SUPPORTED_DEPOSIT_CHAINS,
  type SupportedDepositChain,
} from "@cartridgefi/shared-types";
import { ActionButton, GlassCard, GlassPill, LivePulseDot } from "@cartridgefi/ui-system";
import {
  formatAtomicUsdc,
  formatEloInteger,
  formatShareUnits6,
  useConsoleVault,
  type ConsoleAuthMethod,
} from "./ConsoleVaultContext";

const CHAIN_META: Record<
  SupportedDepositChain,
  { label: string; token: string; routeSecs: string }
> = {
  solana: { label: "Solana", token: "Native USDC / SOL", routeSecs: "0.4s" },
  base: { label: "Base", token: "Base USDC -> Solana USDC", routeSecs: "1.6s" },
  ethereum: { label: "Ethereum", token: "Mainnet USDC / ETH", routeSecs: "2.4s" },
  arbitrum: { label: "Arbitrum", token: "Arb USDC -> Solana USDC", routeSecs: "1.8s" },
  bnb: { label: "BNB Chain", token: "BNB USDT -> Solana USDC", routeSecs: "2.1s" },
  monad: { label: "Monad", token: "Monad USDC -> Solana USDC", routeSecs: "1.4s" },
  polygon: { label: "Polygon", token: "Polygon USDC -> Solana USDC", routeSecs: "1.9s" },
};

const AUTH_OPTIONS: readonly { id: ConsoleAuthMethod; label: string; detail: string }[] = [
  { id: "passkey", label: "Passkey FaceID", detail: "WebAuthn Self-Custody" },
  { id: "apple", label: "Apple Pay / ID", detail: "Instant USD -> USDC" },
  { id: "google", label: "Google Pay", detail: "1-Tap Card Onramp" },
  { id: "solana-wallet", label: "Solana Wallet", detail: "Wallet Standard v1" },
];

const TOPUP_AMOUNTS = [25, 50, 100, 250] as const;

export function UnifiedCashierModal(): React.JSX.Element | null {
  const {
    isCashierOpen,
    closeCashier,
    cashUsdcAtomic,
    earnedStocks,
    marketEloScaled,
    sessionKeyActive,
    sessionKeyPubkey,
    authMethod,
    setAuthMethod,
    mintDevnetUsdc,
    depositToUnifiedCash,
    lastCashierReceipt,
  } = useConsoleVault();

  const [selectedChain, setSelectedChain] = React.useState<SupportedDepositChain>("base");
  const [selectedAmount, setSelectedAmount] = React.useState<number>(100);
  const [isMinting, setIsMinting] = React.useState<boolean>(false);
  const [isDepositing, setIsDepositing] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!isCashierOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeCashier();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCashierOpen, closeCashier]);

  if (!isCashierOpen) {
    return null;
  }

  const activeChainInfo = CHAIN_META[selectedChain];

  const handleMintDevnet = async (): Promise<void> => {
    setIsMinting(true);
    try {
      await mintDevnetUsdc(100);
    } finally {
      setIsMinting(false);
    }
  };

  const handleFiatOrChainDeposit = async (mode: "fiat" | "chain"): Promise<void> => {
    setIsDepositing(true);
    try {
      const label =
        mode === "fiat"
          ? authMethod === "google"
            ? "Google Pay Instant Onramp -> Solana USDC"
            : "Apple Pay / Passkey Instant Onramp -> Solana USDC"
          : `${activeChainInfo.label} Intent Solver (${activeChainInfo.routeSecs}) -> Solana USDC`;
      await depositToUnifiedCash(label, selectedAmount);
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <div
      id="unified-cashier-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cashier-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closeCashier();
        }
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
    >
      <GlassCard
        id="unified-cashier-modal-card"
        variant="stage"
        accent="emerald"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-3xl p-4 sm:rounded-2xl sm:p-6"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <GlassPill tone="emerald" size="xs">
                Unified 7-Chain &amp; Apple Pay Cashier
              </GlassPill>
              <GlassPill tone="cyan" size="xs">
                Kora $0 Gas · 0 Popups
              </GlassPill>
            </div>
            <h2
              id="cashier-modal-title"
              className="mt-2 font-display text-xl font-bold text-white sm:text-2xl"
            >
              Unified Cash &amp; Earned Stock Vault
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              All 7 chains and Apple Pay / Google Pay settle 100% into canonical Solana{" "}
              <code translate="no" className="font-mono text-slate-200">
                USDC ({SOLANA_CANONICAL_MINTS.USDC.slice(0, 6)}…{SOLANA_CANONICAL_MINTS.USDC.slice(-4)})
              </code>
              .
            </p>
          </div>

          <button
            id="close-cashier-modal-btn"
            type="button"
            onClick={closeCashier}
            aria-label="Close Unified Cashier Modal"
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-slate-300 transition-colors hover:border-white/25 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Live Unified Balance + 1-Tap Devnet Faucet */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="rounded-2xl border border-white/10 bg-[#050609]/95 p-4 sm:col-span-7">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Unified Cash Balance</span>
              <span className="font-mono text-[11px] text-[#00F59B] tabular-nums">
                Market ELO {formatEloInteger(marketEloScaled)}
              </span>
            </div>
            <div
              id="cashier-modal-usdc-balance"
              className="mt-1 font-mono text-3xl font-bold text-white tabular-nums"
            >
              {formatAtomicUsdc(cashUsdcAtomic)}{" "}
              <span className="text-xs font-medium text-slate-400">USDC</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400 tabular-nums">
              <LivePulseDot tone={sessionKeyActive ? "emerald" : "amber"} size="sm" />
              <span translate="no">
                Session Key: {sessionKeyPubkey.slice(0, 8)}…{sessionKeyPubkey.slice(-4)}
              </span>
            </div>
          </div>

          {/* 1-Tap Devnet Faucet Box */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#00F59B]/35 bg-[#00F59B]/[0.07] p-4 sm:col-span-5">
            <div>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#00F59B]">
                Instant Judge &amp; Devnet Sandbox
              </span>
              <p className="mt-1 text-xs leading-snug text-slate-200">
                Mint $100.00 Devnet USDC &amp; initialize scoped zero-popup MagicBlock Session Key.
              </p>
            </div>
            <ActionButton
              id="mint-devnet-usdc-btn"
              variant="emerald"
              size="md"
              disabled={isMinting}
              onClick={() => {
                void handleMintDevnet();
              }}
              className="mt-3 w-full"
            >
              {isMinting ? "Minting Devnet USDC…" : "Mint 100 Devnet USDC"}
            </ActionButton>
          </div>
        </div>

        {/* Auth & Passkey Selector */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300">1-Tap Passkey, Apple Pay &amp; Wallet Onboarding</span>
            <span translate="no" className="font-mono text-[11px] text-slate-400">
              Kora Sponsor: {CARTRIDGE_DEVNET_AUTHORITIES.koraSponsor.slice(0, 6)}…
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AUTH_OPTIONS.map((opt) => {
              const selected = authMethod === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`cashier-auth-${opt.id}`}
                  type="button"
                  onClick={() => setAuthMethod(opt.id)}
                  className={`cursor-pointer rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                    selected
                      ? "border-[#00F59B]/55 bg-[#00F59B]/12 text-white"
                      : "border-white/10 bg-[#050609]/80 text-slate-300 hover:border-white/25"
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400">{opt.detail}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Deposit Amount + 7-Chain & Apple Pay Action */}
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#050609]/90 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-300">
              Select Amount &amp; Source Chain (Auto-Bridges &lt;= 4s)
            </span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Top-up USDC amount">
              {TOPUP_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  id={`cashier-amount-${amt}`}
                  type="button"
                  onClick={() => setSelectedAmount(amt)}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                    selectedAmount === amt
                      ? "border-[#00D4FF]/60 bg-[#00D4FF]/15 text-[#67E8F9]"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          {/* 7 Chains */}
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Deposit source chain">
            {SUPPORTED_DEPOSIT_CHAINS.map((chain) => {
              const active = selectedChain === chain;
              return (
                <button
                  key={chain}
                  id={`cashier-chain-${chain}`}
                  type="button"
                  onClick={() => setSelectedChain(chain)}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF] ${
                    active
                      ? "border-[#00D4FF] bg-[#00D4FF]/15 text-white font-semibold"
                      : "border-white/10 bg-[#0A0D14] text-slate-400 hover:border-white/25 hover:text-slate-200"
                  }`}
                >
                  {CHAIN_META[chain].label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#0A0D14] px-3 py-2 font-mono text-[11px] text-slate-300 tabular-nums">
            <span>{activeChainInfo.token}</span>
            <span className="text-[#00D4FF]">Intent Settlement ~{activeChainInfo.routeSecs}</span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <ActionButton
              id="cashier-apple-pay-btn"
              variant="glass"
              size="md"
              disabled={isDepositing}
              onClick={() => {
                void handleFiatOrChainDeposit("fiat");
              }}
            >
              Apple Pay / Google Pay +${selectedAmount} USDC
            </ActionButton>
            <ActionButton
              id="cashier-bridge-deposit-btn"
              variant="ghost"
              size="md"
              disabled={isDepositing}
              onClick={() => {
                void handleFiatOrChainDeposit("chain");
              }}
            >
              Bridge ${selectedAmount} from {activeChainInfo.label}
            </ActionButton>
          </div>
        </div>

        {/* Live Confirmation Receipt */}
        <div aria-live="polite">
          {lastCashierReceipt ? (
            <div
              id="cashier-receipt-banner"
              className="mt-4 rounded-xl border border-[#00F59B]/40 bg-[#00F59B]/10 p-3 font-mono text-xs text-slate-100 tabular-nums"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#00F59B]">
                  Credited {lastCashierReceipt.creditedUsdcFormatted} USDC
                </span>
                <span className="text-[11px] text-slate-300">{lastCashierReceipt.sourceLabel}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span translate="no">
                  Tx: {lastCashierReceipt.txSignature.slice(0, 14)}…{lastCashierReceipt.txSignature.slice(-8)}
                </span>
                <span translate="no">
                  Session Key Ready ({MAGICBLOCK_CONSTANTS.sessionKeyProgramId.slice(0, 8)}…)
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Earned Stock Vault Snapshot */}
        <div className="mt-4 border-t border-white/[0.08] pt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">
              Earned Stock Vault (RFS #3 · Portable Across All Cartridges)
            </span>
            <span translate="no" className="font-mono text-[10px] text-slate-400">
              Passport: {CARTRIDGE_PROGRAM_IDS.passport.slice(0, 8)}…
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-[#050609]/85 p-2.5 font-mono tabular-nums">
              <div translate="no" className="text-[11px] text-slate-400">
                NVDAx
              </div>
              <div className="mt-0.5 text-sm font-bold text-[#00F59B]">
                {formatShareUnits6(earnedStocks.NVDAx, 3)} sh
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#050609]/85 p-2.5 font-mono tabular-nums">
              <div translate="no" className="text-[11px] text-slate-400">
                ANTx
              </div>
              <div className="mt-0.5 text-sm font-bold text-[#C4B5FD]">
                {formatShareUnits6(earnedStocks.ANTx, 3)} sh
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#050609]/85 p-2.5 font-mono tabular-nums">
              <div translate="no" className="text-[11px] text-slate-400">
                SPYx
              </div>
              <div className="mt-0.5 text-sm font-bold text-[#00D4FF]">
                {formatShareUnits6(earnedStocks.SPYx, 3)} sh
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#050609]/85 p-2.5 font-mono tabular-nums">
              <div translate="no" className="text-[11px] text-slate-400">
                Prize USDC
              </div>
              <div className="mt-0.5 text-sm font-bold text-[#FFB020]">
                {formatAtomicUsdc(earnedStocks.USDC)}
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
