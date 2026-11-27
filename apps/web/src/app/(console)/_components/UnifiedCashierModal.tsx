"use client";

import * as React from "react";
import { Copy, ExternalLink, KeyRound, RefreshCw, Wallet, X } from "lucide-react";
import devnetProof from "@/data/devnet-proof.json";
import {
  formatAtomicUsdc,
  formatEloInteger,
  formatShareUnits6,
  formatSolLamports,
  useConsoleVault,
} from "./ConsoleVaultContext";
import { toast } from "sonner";

const PAPER_MARGIN_PRESETS = [50, 100, 250, 500] as const;

export function UnifiedCashierModal(): React.JSX.Element | null {
  const {
    isCashierOpen,
    closeCashier,
    cashUsdcAtomic,
    onchainSolLamports,
    onchainSplAtomic,
    earnedStocks,
    marketEloScaled,
    sessionKeyPubkey,
    playerWallet,
    connectedBrowserWalletName,
    detectedWallets,
    connectBrowserWallet,
    rotateSessionKeypair,
    refreshOnchainBalances,
    mintDevnetUsdc,
    requestDevnetSolAirdrop,
    lastCashierReceipt,
  } = useConsoleVault();

  const [selectedPreset, setSelectedPreset] = React.useState<number>(100);
  const [busyAction, setBusyAction] = React.useState<
    "paper" | "sol" | "refresh" | null
  >(null);

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

  if (!isCashierOpen) return null;

  const copyAddress = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Clipboard unavailable");
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4"
    >
      <div
        id="unified-cashier-modal-card"
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl border border-[#303642] bg-[#111317] p-5 sm:rounded-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#22262e] pb-4">
          <div>
            <h2
              id="cashier-modal-title"
              className="text-base font-semibold text-[#f3f4f6]"
            >
              Wallet, Session Signer &amp; Margin
            </h2>
            <p className="mt-1 text-xs text-[#9ca3af]">
              Connect a browser Solana wallet or sign zero-popup Ephemeral Rollup updates with your local WebCrypto Ed25519 keypair.
            </p>
          </div>
          <button
            id="close-cashier-modal-btn"
            type="button"
            onClick={closeCashier}
            aria-label="Close Wallet Modal"
            className="cf-btn inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[#303642] bg-[#171a20] text-[#9ca3af] hover:text-white active:scale-[0.97]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Active On-Chain Keys & Live Devnet Balances */}
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-[#22262e] bg-[#0b0c0e] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#9ca3af]">
                Active Solana Devnet Address
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    setBusyAction("refresh");
                    await refreshOnchainBalances();
                    setBusyAction(null);
                  }}
                  className="cf-btn inline-flex cursor-pointer items-center gap-1 rounded border border-[#303642] bg-[#171a20] px-2 py-0.5 text-[11px] text-[#d1d5db] hover:text-white"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${busyAction === "refresh" ? "animate-spin" : ""}`}
                  />
                  Refresh RPC
                </button>
                {playerWallet ? (
                  <a
                    href={`https://solscan.io/account/${playerWallet}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-[#303642] bg-[#171a20] px-2 py-0.5 text-[11px] text-[#93c5fd] hover:text-white"
                  >
                    Solscan
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs text-[#f3f4f6] tabular-nums">
                {playerWallet || "Generating Ed25519 keypair…"}
              </code>
              {playerWallet ? (
                <button
                  type="button"
                  onClick={() => void copyAddress(playerWallet, "wallet address")}
                  className="cf-btn shrink-0 cursor-pointer rounded p-1 text-[#9ca3af] hover:bg-[#171a20] hover:text-white"
                  title="Copy address"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#22262e] pt-3">
              <div>
                <div className="text-[11px] text-[#6b7280]">Devnet SOL (On-Chain)</div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-[#f3f4f6] tabular-nums">
                  {formatSolLamports(onchainSolLamports)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#6b7280]">Devnet SPL (On-Chain)</div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-[#f3f4f6] tabular-nums">
                  {formatAtomicUsdc(onchainSplAtomic, false)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#6b7280]">Paper Margin</div>
                <div
                  id="cashier-modal-usdc-balance"
                  className="mt-0.5 font-mono text-xs font-semibold text-[#34d399] tabular-nums"
                >
                  {formatAtomicUsdc(cashUsdcAtomic)}
                </div>
              </div>
            </div>
          </div>

          {/* Browser Wallet Standard Discovery + Ed25519 Session Key Rotation */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              id="connect-browser-wallet-btn"
              type="button"
              onClick={() => void connectBrowserWallet()}
              className="cf-btn flex cursor-pointer items-center justify-between rounded-md border border-[#303642] bg-[#171a20] px-3 py-2.5 text-left text-xs hover:bg-[#1d2129] active:scale-[0.98]"
            >
              <span className="flex items-center gap-2 font-medium text-[#f3f4f6]">
                <Wallet className="h-4 w-4 text-[#3b82f6]" />
                {connectedBrowserWalletName
                  ? `Connected: ${connectedBrowserWalletName}`
                  : detectedWallets.length > 0
                    ? `Connect ${detectedWallets[0]?.name}`
                    : "Connect Browser Wallet"}
              </span>
              <span className="font-mono text-[10px] text-[#9ca3af]">
                {detectedWallets.length > 0
                  ? `${detectedWallets.length} detected`
                  : "Phantom / Solflare"}
              </span>
            </button>

            <button
              id="rotate-session-key-btn"
              type="button"
              onClick={() => void rotateSessionKeypair()}
              className="cf-btn flex cursor-pointer items-center justify-between rounded-md border border-[#303642] bg-[#171a20] px-3 py-2.5 text-left text-xs hover:bg-[#1d2129] active:scale-[0.98]"
            >
              <span className="flex items-center gap-2 font-medium text-[#f3f4f6]">
                <KeyRound className="h-4 w-4 text-[#34d399]" />
                Rotate Session Keypair
              </span>
              <span className="font-mono text-[10px] text-[#9ca3af]">
                {sessionKeyPubkey ? `${sessionKeyPubkey.slice(0, 4)}…` : "Ed25519"}
              </span>
            </button>
          </div>

          {/* Funding Controls: Real Devnet SOL Airdrop + Paper Margin Credit */}
          <div className="rounded-md border border-[#22262e] bg-[#0b0c0e] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#e5e7eb]">
                Session Funding &amp; Devnet Faucet
              </span>
              <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
                ELO {formatEloInteger(marketEloScaled)}
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-4 gap-1.5">
              {PAPER_MARGIN_PRESETS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setSelectedPreset(amt)}
                  className={`cf-btn cursor-pointer rounded border py-1.5 font-mono text-xs font-medium tabular-nums ${
                    selectedPreset === amt
                      ? "border-[#3b82f6] bg-[#2563eb]/20 text-white"
                      : "border-[#22262e] bg-[#111317] text-[#9ca3af] hover:text-white"
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                id="mint-devnet-usdc-btn"
                type="button"
                disabled={busyAction !== null}
                onClick={async () => {
                  setBusyAction("paper");
                  try {
                    await mintDevnetUsdc(selectedPreset);
                  } finally {
                    setBusyAction(null);
                  }
                }}
                className="cf-btn h-9 cursor-pointer rounded-md bg-[#2563eb] px-3 text-xs font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
              >
                {busyAction === "paper"
                  ? "Crediting…"
                  : `Add $${selectedPreset} Paper Margin`}
              </button>

              <button
                id="request-devnet-sol-btn"
                type="button"
                disabled={busyAction !== null}
                onClick={async () => {
                  setBusyAction("sol");
                  try {
                    await requestDevnetSolAirdrop();
                  } finally {
                    setBusyAction(null);
                  }
                }}
                className="cf-btn h-9 cursor-pointer rounded-md border border-[#303642] bg-[#171a20] px-3 text-xs font-medium text-[#e5e7eb] hover:bg-[#1d2129] disabled:opacity-50"
              >
                {busyAction === "sol"
                  ? "Requesting RPC…"
                  : "Request 0.5 Devnet SOL"}
              </button>
            </div>
          </div>

          {/* Settled Round Holdings */}
          <div className="rounded-md border border-[#22262e] bg-[#0b0c0e] p-3.5">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-[#9ca3af]">
                Settled Arena Vault Ledger
              </span>
              <a
                href={`https://solscan.io/account/${devnetProof.accounts.platformFeeAccountAta}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11px] text-[#9ca3af] hover:text-white"
              >
                SPL Mint {devnetProof.accounts.splMint.slice(0, 6)}…
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <div className="grid grid-cols-4 gap-2 font-mono text-xs tabular-nums">
              <div className="rounded border border-[#22262e] bg-[#111317] p-2">
                <div className="text-[10px] text-[#6b7280]">NVDAx</div>
                <div className="mt-0.5 font-medium text-[#f3f4f6]">
                  {formatShareUnits6(earnedStocks.NVDAx, 3)}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#111317] p-2">
                <div className="text-[10px] text-[#6b7280]">SPYx</div>
                <div className="mt-0.5 font-medium text-[#f3f4f6]">
                  {formatShareUnits6(earnedStocks.SPYx, 3)}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#111317] p-2">
                <div className="text-[10px] text-[#6b7280]">TSLAx</div>
                <div className="mt-0.5 font-medium text-[#f3f4f6]">
                  {formatShareUnits6(earnedStocks.TSLAx, 3)}
                </div>
              </div>
              <div className="rounded border border-[#22262e] bg-[#111317] p-2">
                <div className="text-[10px] text-[#6b7280]">USDC Won</div>
                <div className="mt-0.5 font-medium text-[#f3f4f6]">
                  {formatAtomicUsdc(earnedStocks.USDC)}
                </div>
              </div>
            </div>
          </div>

          {/* Honest Receipt Banner (Only links to Solscan when a real signature exists) */}
          {lastCashierReceipt ? (
            <div
              id="cashier-receipt-banner"
              className="rounded-md border border-[#303642] bg-[#171a20] p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[#f3f4f6]">
                  {lastCashierReceipt.sourceLabel}
                </span>
                <span className="font-mono font-semibold text-[#34d399] tabular-nums">
                  {lastCashierReceipt.creditedUsdcFormatted}
                </span>
              </div>
              {lastCashierReceipt.txSignature && lastCashierReceipt.solscanUrl ? (
                <a
                  href={lastCashierReceipt.solscanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-[#93c5fd] hover:underline"
                >
                  Solscan Tx: {lastCashierReceipt.txSignature.slice(0, 16)}…
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <div className="mt-1 font-mono text-[11px] text-[#9ca3af]">
                  Off-chain simulation credit (Session key: {sessionKeyPubkey.slice(0, 8)}…)
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
