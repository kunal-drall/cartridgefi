"use client";

import * as React from "react";
import { Coins, ExternalLink, Loader2 } from "lucide-react";
import type { ChainReceipt } from "@/lib/borel/types";
import type { StakeStatusOk } from "@/lib/borel/stakes-client";
import { cn } from "@/lib/utils";
import { FOCUS_RING, formatTestUsdc, shortHash } from "./format";

/**
 * Real-money-shaped stakes stay off until the on-chain staking fixes ship. Default off: only the exact
 * string "true" enables the picker, staked joins, claim panel, ladder chip and receipt stake lines.
 */
export const STAKES_ENABLED = process.env.NEXT_PUBLIC_BOREL_STAKES_ENABLED === "true";

/** Lobby stake choices; "NONE" keeps the room unstaked (no wallet popup at seal). */
export const STAKE_CHOICES = ["NONE", "5", "10", "25"] as const;
export type StakeChoice = (typeof STAKE_CHOICES)[number];

/** Base units (6 decimals) for a lobby choice; 0n for "NONE". */
export function stakeChoiceUnits(choice: StakeChoice): bigint {
  return choice === "NONE" ? 0n : BigInt(choice) * 1_000_000n;
}

/** Your stake in the current room, as the table tracks it. */
export type MyStake =
  | { readonly status: "idle" }
  | { readonly status: "pending"; readonly amountUnits: bigint }
  | { readonly status: "ok"; readonly amountUnits: bigint; readonly receipt: ChainReceipt | null }
  | { readonly status: "error"; readonly reason: string };

export type ClaimState =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "ok"; readonly payoutUnits: bigint; readonly receipt: ChainReceipt }
  | { readonly status: "error"; readonly reason: string };

/**
 * Compact lobby picker: shown only for DEVNET rooms with a wallet connected. Amounts above the
 * wallet's test-USDC balance are disabled, and a link opens the wallet panel's faucet.
 */
export function StakePicker({
  value,
  onChange,
  balanceUnits,
  onGetUsdc,
}: {
  value: StakeChoice;
  onChange: (next: StakeChoice) => void;
  /** Wallet test-USDC balance in base units; null while unknown. */
  balanceUnits: bigint | null;
  onGetUsdc: () => void;
}): React.JSX.Element {
  const short = balanceUnits !== null && balanceUnits < stakeChoiceUnits(value === "NONE" ? "5" : value);
  return (
    <div id="borel-stake-picker" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#9ca3af]">
        <Coins className="h-3.5 w-3.5 text-[#fbbf24]" aria-hidden="true" />
        Stake
      </div>
      <div role="group" aria-label="Stake test-USDC" className="inline-flex rounded-lg border border-white/[0.08] bg-[#0b0c0e] p-0.5">
        {STAKE_CHOICES.map((choice) => {
          const units = stakeChoiceUnits(choice);
          const unaffordable = choice !== "NONE" && balanceUnits !== null && balanceUnits < units;
          return (
            <button
              key={choice}
              id={`borel-stake-amount-${choice.toLowerCase()}`}
              type="button"
              aria-pressed={value === choice}
              disabled={unaffordable}
              title={unaffordable ? "Not enough test-USDC in this wallet" : undefined}
              onClick={() => onChange(choice)}
              className={cn(
                "cf-btn h-11 min-w-11 cursor-pointer rounded-md px-2.5 font-mono text-[12px] font-medium tabular-nums disabled:cursor-not-allowed disabled:opacity-40",
                FOCUS_RING,
                value === choice
                  ? choice === "NONE"
                    ? "bg-[#1d2129] text-[#f3f4f6]"
                    : "bg-[#f59e0b]/15 text-[#fbbf24] shadow-[inset_0_0_0_1px_rgba(245,158,11,0.45)]"
                  : "text-[#9ca3af] hover:text-[#e5e7eb]",
              )}
            >
              {choice === "NONE" ? "No stake" : choice}
            </button>
          );
        })}
      </div>
      <span className="font-mono text-[11px] text-[#9ca3af] tabular-nums">
        test-USDC
        {balanceUnits !== null ? <> · balance {formatTestUsdc(balanceUnits)}</> : null}
      </span>
      {short ? (
        <button
          id="borel-stake-get-usdc"
          type="button"
          onClick={onGetUsdc}
          className={cn(
            "cf-btn -my-2 h-11 cursor-pointer rounded-md px-1 font-mono text-[11px] text-[#93c5fd] underline decoration-[#93c5fd]/40 underline-offset-4 hover:text-[#bfdbfe]",
            FOCUS_RING,
          )}
        >
          Get test-USDC
        </button>
      ) : null}
    </div>
  );
}

/** Shown in place of the picker while staking is switched off. */
export function StakesPausedNote(): React.JSX.Element {
  return (
    <p id="borel-stakes-paused" className="flex items-center gap-1.5 font-mono text-[11px] text-[#9ca3af]">
      <Coins className="h-3.5 w-3.5 text-[#7d8590]" aria-hidden="true" />
      Staked rooms are paused while we finish an on-chain upgrade.
    </p>
  );
}

/** One-line hint for DEVNET rooms without a wallet: staking is optional and needs a wallet. */
export function StakeConnectHint({ onConnect }: { onConnect: () => void }): React.JSX.Element {
  return (
    <p className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-[#9ca3af]">
      <Coins className="h-3.5 w-3.5 text-[#fbbf24]" aria-hidden="true" />
      Optional: stake test-USDC on this room.
      <button
        id="borel-stake-connect"
        type="button"
        onClick={onConnect}
        className={cn(
          "cf-btn -my-2 h-11 cursor-pointer rounded-md px-1 text-[#93c5fd] underline decoration-[#93c5fd]/40 underline-offset-4 hover:text-[#bfdbfe]",
          FOCUS_RING,
        )}
      >
        Connect a wallet
      </button>
    </p>
  );
}

/** "1%" / "1.25%" from basis points, integer math only. */
export function bpsLabel(bps: bigint): string {
  const frac = bps % 100n;
  return `${(bps / 100n).toString()}${frac === 0n ? "" : `.${frac.toString().padStart(2, "0").replace(/0$/, "")}`}%`;
}

function ReceiptLink({ receipt, label }: { receipt: ChainReceipt; label: string }): React.JSX.Element {
  return (
    <a
      href={receipt.explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 rounded text-[#93c5fd] tabular-nums hover:underline", FOCUS_RING)}
    >
      {label} {shortHash(receipt.signature, 5, 5)}
      <ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}

/**
 * Showdown stake panel: stake, pool, the 1% platform fee and your payout as read from the room vault,
 * plus a popup-free Claim when settlement left the payout in the vault.
 */
export function StakePayoutPanel({
  myStake,
  status,
  statusNote,
  claimState,
  onClaim,
}: {
  myStake: Extract<MyStake, { status: "ok" }>;
  status: StakeStatusOk | null;
  /** Shown while the vault has not reported a settled payout yet. */
  statusNote: string;
  claimState: ClaimState;
  onClaim: () => void;
}): React.JSX.Element {
  const vault = status?.vault ?? null;
  const feeBps = BigInt(vault?.feeBps ?? 0);
  const poolUnits = vault?.poolUnits ?? 0n;
  const feeUnits = (poolUnits * feeBps) / 10_000n;
  const settled = status?.settled === true;
  const payoutUnits = claimState.status === "ok" ? claimState.payoutUnits : (status?.payoutUnits ?? 0n);
  const net = payoutUnits - myStake.amountUnits;
  const canClaim = settled && status !== null && !status.claimed && status.payoutUnits > 0n && claimState.status !== "ok";
  const rows: ReadonlyArray<readonly [string, string, string?]> = [
    ["Your stake", formatTestUsdc(myStake.amountUnits)],
    ["Room pool", vault ? formatTestUsdc(poolUnits) : "—"],
    [`Platform fee · ${vault ? bpsLabel(feeBps) : "1%"}`, vault ? formatTestUsdc(feeUnits) : "—"],
    ["Your payout", settled ? formatTestUsdc(payoutUnits) : "—", settled ? (net > 0n ? "text-[#34d399]" : net < 0n ? "text-[#f87171]" : "text-[#f3f4f6]") : undefined],
  ];
  return (
    <section
      id="borel-stake-panel"
      aria-live="polite"
      className="rounded-xl border border-[#f59e0b]/30 bg-[#0a0d14] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#f3f4f6]">
          <Coins className="h-4 w-4 text-[#fbbf24]" aria-hidden="true" />
          Stake payout
        </h2>
        <span className="font-mono text-[11px] text-[#9ca3af]">test-USDC · devnet</span>
      </div>
      <dl className="mt-2 divide-y divide-[#22262e] font-mono text-[12px] tabular-nums">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="flex items-center justify-between py-1.5">
            <dt className="text-[#9ca3af]">{label}</dt>
            <dd className={cn("font-semibold", tone ?? "text-[#e5e7eb]")}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#9ca3af]">
        {myStake.receipt ? <ReceiptLink receipt={myStake.receipt} label="Stake tx" /> : <span>Stake confirmed</span>}
        {claimState.status === "ok" ? (
          <ReceiptLink receipt={claimState.receipt} label="Payout tx" />
        ) : settled && status?.claimed ? (
          <span className="text-[#34d399]">Paid to your wallet at settle</span>
        ) : settled && status && status.payoutUnits === 0n ? (
          <span>No payout this room</span>
        ) : !settled ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {statusNote}
          </span>
        ) : null}
      </div>
      {claimState.status === "error" ? (
        <p className="mt-2 font-mono text-[11px] text-[#f87171]">{claimState.reason}</p>
      ) : null}
      {canClaim ? (
        <button
          id="borel-claim-btn"
          type="button"
          onClick={onClaim}
          disabled={claimState.status === "pending"}
          className={cn(
            "cf-btn mt-3 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#f59e0b] text-[15px] font-semibold text-[#14100a] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-60",
            FOCUS_RING,
          )}
        >
          {claimState.status === "pending" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Coins className="h-4 w-4" />}
          {claimState.status === "pending" ? "Claiming…" : `Claim ${formatTestUsdc(status.payoutUnits)} test-USDC`}
        </button>
      ) : null}
    </section>
  );
}
