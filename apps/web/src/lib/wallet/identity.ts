"use client";

import * as React from "react";
import { getBase58Decoder } from "@solana/kit";
import {
  WALLET_DELEGATION_MAX_TTL_MS,
  borelWalletDelegationMessage,
  rememberWalletDelegation,
  walletDelegationFor,
  type WalletDelegation,
} from "@/lib/borel/auth";
import { walletClient } from "./client";

/**
 * Who the Devnet room player is. With a connected wallet the player is the wallet: it signs one delegation at
 * join and the ephemeral session key acts for it (popup-free locks / pivots). Without one, the anonymous
 * ephemeral session key is the player.
 */
export type BorelIdentityState =
  | { kind: "anonymous" }
  | { kind: "authorizing"; walletAddress: string; roomId: string }
  | { kind: "wallet"; walletAddress: string; roomId: string; expiresAt: number }
  | { kind: "declined"; walletAddress: string; roomId: string; reason: string };

let state: BorelIdentityState = { kind: "anonymous" };
const listeners = new Set<() => void>();

function setState(next: BorelIdentityState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: BorelIdentityState = { kind: "anonymous" };

/**
 * Room-player identity for UI (e.g. show the wallet as the player name). `connectedWallet` is the wallet
 * currently connected (null when none); `room` is the delegation state for the last joined Devnet room.
 */
export function useBorelIdentity(): { connectedWallet: string | null; room: BorelIdentityState } {
  const room = React.useSyncExternalStore(subscribe, () => state, () => serverSnapshot);
  const connected = React.useSyncExternalStore(
    walletClient.wallet.subscribe,
    () => walletClient.wallet.getState().connected,
    () => null,
  );
  return { connectedWallet: connected?.account.address ?? null, room };
}

function rejectionReason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel|declin/i.test(text)) return "Wallet signature declined — playing with an anonymous session key";
  if (/not support|signMessage/i.test(text)) return "This wallet cannot sign messages — playing with an anonymous session key";
  return `Wallet authorization failed: ${text.slice(0, 140)}`;
}

/**
 * At join: if a wallet is connected, ask it to sign ONE message delegating `sessionPubkey` for `roomId`, have
 * the server verify it, and remember it so every later signed request carries it. Never throws.
 */
export async function authorizeWalletForRoom(args: {
  roomId: string;
  sessionPubkey: string;
  roomEndsAt: number | null;
}): Promise<BorelIdentityState> {
  const { connected } = walletClient.wallet.getState();
  if (!connected) {
    setState({ kind: "anonymous" });
    return state;
  }
  const walletAddress = connected.account.address;
  const existing = walletDelegationFor(args.roomId, args.sessionPubkey);
  if (existing && existing.walletAddress === walletAddress) {
    setState({ kind: "wallet", walletAddress, roomId: args.roomId, expiresAt: existing.expiresAt });
    return state;
  }
  setState({ kind: "authorizing", walletAddress, roomId: args.roomId });
  const now = Date.now();
  const expiresAt = Math.min(
    now + WALLET_DELEGATION_MAX_TTL_MS - 60_000,
    (args.roomEndsAt ?? now + 15 * 60_000) + 5 * 60_000,
  );
  try {
    const message = borelWalletDelegationMessage({
      roomId: args.roomId,
      sessionPubkey: args.sessionPubkey,
      walletAddress,
      expiresAt,
    });
    const sig = await walletClient.wallet.signMessage(message);
    const delegation: WalletDelegation = {
      walletAddress,
      roomId: args.roomId,
      expiresAt,
      signature: getBase58Decoder().decode(sig),
    };
    const res = await fetch("/api/wallet/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionPubkey: args.sessionPubkey, delegation }),
    });
    const body = (await res.json().catch(() => null)) as { status?: string; reason?: string } | null;
    if (body?.status !== "ok") {
      setState({ kind: "declined", walletAddress, roomId: args.roomId, reason: body?.reason ?? `Server rejected wallet authorization (HTTP ${res.status})` });
      return state;
    }
    rememberWalletDelegation(args.sessionPubkey, delegation);
    setState({ kind: "wallet", walletAddress, roomId: args.roomId, expiresAt });
  } catch (err) {
    setState({ kind: "declined", walletAddress, roomId: args.roomId, reason: rejectionReason(err) });
  }
  return state;
}
