"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Loader2, LogOut, Wallet, X } from "lucide-react";
import { cn, shortenAddress } from "@/lib/utils";
import { formatAtomic, PUBLIC_FAUCET_URL } from "@/lib/wallet/assets";
import { isMobileUserAgent, mobileWalletLinks, type MobileWalletLink } from "@/lib/wallet/mobile";
import { useBorelIdentity } from "@/lib/wallet/identity";
import { useBorelWallet, useOptionalBorelWallet } from "./WalletProvider";

const BTN =
  "cf-btn inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#303642] bg-[#171a20] px-2.5 py-1.5 text-xs font-medium text-[#f3f4f6] hover:bg-[#1d2129] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50";

/** Header trigger: "Connect wallet" or the connected address + devnet SOL. */
export function WalletConnectButton(): React.JSX.Element {
  const w = useBorelWallet();
  const label = !w.mounted
    ? "Wallet"
    : w.walletAddress
      ? shortenAddress(w.walletAddress, 4, 4)
      : w.status === "connecting" || w.status === "reconnecting"
        ? "Connecting…"
        : "Connect";
  return (
    <>
      <button
        id="wallet-connect-btn"
        type="button"
        onClick={() => w.setPanelOpen(true)}
        aria-haspopup="dialog"
        className={cn(BTN, "font-mono tabular-nums")}
      >
        {w.walletIcon ? (
          // Wallet Standard icons are data: URIs supplied by the wallet itself.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={w.walletIcon} alt="" width={14} height={14} className="h-3.5 w-3.5 rounded-[3px]" />
        ) : (
          <Wallet className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
        )}
        <span>
          {label}
          {w.mounted && !w.walletAddress && label === "Connect" ? <span className="hidden sm:inline"> wallet</span> : null}
        </span>
        {w.walletAddress && w.solLamports !== null ? (
          <span className="hidden border-l border-[#303642] pl-2 text-[#9ca3af] sm:inline">
            {formatAtomic(w.solLamports, 9, 3)} SOL
          </span>
        ) : null}
      </button>
      {/* Portal: the sticky header is its own stacking context, so the panel must escape it. */}
      {w.panelOpen && w.mounted ? createPortal(<WalletPanel />, document.body) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-[#9ca3af]">{label}</span>
      <span className="font-mono tabular-nums text-[#f3f4f6]">{children}</span>
    </div>
  );
}

function WalletPanel(): React.JSX.Element {
  const w = useBorelWallet();
  const { room } = useBorelIdentity();
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const [mobileLinks, setMobileLinks] = React.useState<MobileWalletLink[] | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    closeRef.current?.focus();
    if (isMobileUserAgent(navigator.userAgent)) setMobileLinks(mobileWalletLinks(window.location.href));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") w.setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    if (!w.walletAddress) return;
    try {
      await navigator.clipboard.writeText(w.walletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const solLow = w.solLamports !== null && w.solLamports < 10_000_000n;

  return (
    <div
      id="wallet-panel-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-panel-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) w.setPanelOpen(false);
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-start sm:justify-end sm:p-4 sm:pt-14"
    >
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-xl border border-[#303642] bg-[#111317] p-4 sm:max-w-sm sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-[#22262e] pb-3">
          <div>
            <h2 id="wallet-panel-title" className="text-sm font-semibold text-[#f3f4f6]">
              {w.walletAddress ? "Your wallet" : "Connect a Solana wallet"}
            </h2>
            <p className="mt-0.5 text-[11px] text-[#9ca3af]">
              Devnet only · fees are paid by the Borel relayer
            </p>
          </div>
          <button
            ref={closeRef}
            id="wallet-panel-close-btn"
            type="button"
            onClick={() => w.setPanelOpen(false)}
            aria-label="Close wallet panel"
            className="cf-btn inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[#303642] bg-[#171a20] text-[#9ca3af] hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {w.walletAddress ? (
          <div className="pt-3">
            <div className="flex items-center gap-2">
              {w.walletIcon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.walletIcon} alt="" width={20} height={20} className="h-5 w-5 rounded" />
              ) : null}
              <span className="text-xs text-[#d1d5db]">{w.walletName}</span>
              <button
                id="wallet-copy-address-btn"
                type="button"
                onClick={copy}
                className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded border border-[#303642] px-1.5 py-0.5 font-mono text-[11px] text-[#d1d5db] hover:text-white"
              >
                {shortenAddress(w.walletAddress, 5, 5)}
                {copied ? <Check className="h-3 w-3 text-[#22c55e]" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
            <div className="mt-2 divide-y divide-[#22262e] rounded-md border border-[#22262e] bg-[#0b0c0e] px-3">
              <Row label="Devnet SOL">
                {w.solLamports === null ? "…" : `${formatAtomic(w.solLamports, 9, 4)} SOL`}
              </Row>
              <Row label="Test-USDC">
                {!w.usdcMint ? (
                  <span className="font-sans text-[#6b7280]">mint not deployed yet</span>
                ) : w.usdc === null ? (
                  "…"
                ) : (
                  `${formatAtomic(w.usdc.atomic, w.usdc.decimals, 2)} USDC`
                )}
              </Row>
              <Row label="Room identity">
                <span className="font-sans text-[11px]">
                  {room.kind === "wallet"
                    ? "wallet-delegated session"
                    : room.kind === "authorizing"
                      ? "awaiting signature…"
                      : room.kind === "declined"
                        ? "anonymous session"
                        : "signs once when you join"}
                </span>
              </Row>
            </div>
            {room.kind === "declined" ? (
              <p className="mt-2 text-[11px] text-[#fbbf24]">{room.reason}</p>
            ) : null}
            <p className="mt-2 text-[11px] text-[#6b7280]">
              Borel runs on Solana Devnet. If your wallet shows Mainnet balances, switch it to Devnet; no real funds are used.
            </p>

            <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
              Get test assets
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                id="wallet-airdrop-sol-btn"
                type="button"
                onClick={() => void w.airdropSol()}
                disabled={w.assetBusy !== null}
                className={cn(BTN, "justify-center")}
              >
                {w.assetBusy === "sol" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                1 devnet SOL
              </button>
              <button
                id="wallet-faucet-usdc-btn"
                type="button"
                onClick={() => void w.claimTestUsdc()}
                disabled={w.assetBusy !== null || !w.faucetOnline}
                title={w.faucetOnline ? undefined : "Test-USDC faucet is coming online"}
                className={cn(BTN, "justify-center")}
              >
                {w.assetBusy === "usdc" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {w.faucetOnline ? "Test-USDC" : w.faucetOnline === null ? "Test-USDC…" : "USDC · coming online"}
              </button>
            </div>
            {solLow && !w.notice ? (
              <p className="mt-2 text-[11px] text-[#9ca3af]">
                You do not need SOL to play; the relayer pays fees.
              </p>
            ) : null}
            {w.notice ? (
              <p
                role="status"
                className={cn(
                  "mt-2 text-[11px]",
                  w.notice.tone === "ok" ? "text-[#22c55e]" : w.notice.tone === "warn" ? "text-[#fbbf24]" : "text-[#f87171]",
                )}
              >
                {w.notice.text}{" "}
                {w.notice.href ? (
                  <a href={w.notice.href} target="_blank" rel="noreferrer" className="underline">
                    faucet.solana.com
                  </a>
                ) : null}
              </p>
            ) : (
              <a
                href={PUBLIC_FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#93c5fd] hover:underline"
              >
                Web faucet <ExternalLink className="h-3 w-3" />
              </a>
            )}

            <button
              id="wallet-disconnect-btn"
              type="button"
              onClick={() => {
                w.disconnect();
                w.setPanelOpen(false);
              }}
              className={cn(BTN, "mt-4 w-full justify-center text-[#fca5a5]")}
            >
              <LogOut className="h-3.5 w-3.5" /> Disconnect
            </button>
          </div>
        ) : (
          <div className="pt-3">
            {w.wallets.length > 0 ? (
              <ul className="space-y-1.5" aria-label="Detected wallets">
                {w.wallets.map((wallet) => (
                  <li key={wallet.name}>
                    <button
                      type="button"
                      onClick={() => w.connect(wallet)}
                      disabled={w.status === "connecting"}
                      className={cn(BTN, "w-full justify-start py-2")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={wallet.icon} alt="" width={20} height={20} className="h-5 w-5 rounded" />
                      <span>{wallet.name}</span>
                      <span className="ml-auto text-[10px] text-[#6b7280]">detected</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p id="wallet-none-detected" className="text-xs text-[#9ca3af]">
                No Solana wallet detected in this browser.
                {mobileLinks ? " Open Borel inside your wallet app to play:" : " Install Phantom, Solflare or Backpack, then reload."}
              </p>
            )}
            {w.connectError ? <p className="mt-2 text-[11px] text-[#f87171]">{w.connectError}</p> : null}
            {mobileLinks && w.wallets.length === 0 ? (
              <ul className="mt-3 space-y-1.5" aria-label="Open in a wallet app">
                {mobileLinks.map((l) => (
                  <li key={l.name}>
                    <a href={l.href} className={cn(BTN, "w-full justify-between py-2")}>
                      Open in {l.name} <ExternalLink className="h-3.5 w-3.5 text-[#9ca3af]" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-[11px] text-[#6b7280]">
              No wallet? You can still play Devnet rooms with an anonymous session key.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Statebar cell content: the real wallet state. */
export function WalletStateReadout(): React.JSX.Element {
  const w = useOptionalBorelWallet();
  if (!w || !w.mounted || !w.walletAddress) {
    return <span className="text-[#9ca3af]">— none connected</span>;
  }
  return (
    <>
      <span className="text-[#f3f4f6]">{shortenAddress(w.walletAddress, 4, 4)}</span>
      <span className="text-[#6b7280]">{w.walletName}</span>
      {w.solLamports !== null ? (
        <span className="text-[#9ca3af]">{formatAtomic(w.solLamports, 9, 3)} SOL</span>
      ) : null}
    </>
  );
}
