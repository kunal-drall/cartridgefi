/**
 * Session-key request authentication shared by the Borel client and server.
 * The player's ephemeral ed25519 session key signs a canonical message so the relayer only
 * acts for the holder of that key. Isomorphic: no Node- or DOM-only APIs.
 */
export type BorelAuthAction = "lock" | "pivot" | "room";

/** Signed requests expire quickly to bound replay. */
export const AUTH_MAX_TTL_MS = 120_000;

function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function borelAuthMessage(fields: {
  action: BorelAuthAction;
  roomId: string;
  sessionPubkey: string;
  params: unknown;
  expiresAt: number;
}): Uint8Array {
  return new TextEncoder().encode(`borel-auth:v1:${canonical(fields)}`);
}

/**
 * Wallet delegation: a real wallet (Phantom, Solflare, Backpack, ...) signs ONE human-readable message at
 * join authorizing the ephemeral session key for one room, so later locks and pivots stay popup-free.
 * The server verifies the wallet's ed25519 signature before treating the session as the wallet's.
 */
export interface WalletDelegation {
  walletAddress: string;
  roomId: string;
  /** Epoch ms after which the delegation is void. */
  expiresAt: number;
  /** Base58 ed25519 signature by `walletAddress` over borelWalletDelegationMessage(...). */
  signature: string;
}

/** A delegation never outlives this window (rooms run 3–15 min). */
export const WALLET_DELEGATION_MAX_TTL_MS = 2 * 60 * 60 * 1000;

export function borelWalletDelegationMessage(fields: {
  roomId: string;
  sessionPubkey: string;
  walletAddress: string;
  expiresAt: number;
}): Uint8Array {
  return new TextEncoder().encode(
    [
      "Borel wants you to authorize a session key for one Devnet room.",
      "This signature sends no transaction and costs nothing.",
      "",
      `borel-wallet-delegation:v1:${canonical(fields)}`,
    ].join("\n"),
  );
}

const delegations = new Map<string, WalletDelegation>();
const delegationKey = (roomId: string, sessionPubkey: string) => `${roomId}|${sessionPubkey}`;

/** Client-side registry: remembers the delegation so signed lock/pivot requests carry it. */
export function rememberWalletDelegation(sessionPubkey: string, delegation: WalletDelegation): void {
  delegations.set(delegationKey(delegation.roomId, sessionPubkey), delegation);
}

export function walletDelegationFor(roomId: string, sessionPubkey: string): WalletDelegation | undefined {
  const d = delegations.get(delegationKey(roomId, sessionPubkey));
  if (d && d.expiresAt <= Date.now()) {
    delegations.delete(delegationKey(roomId, sessionPubkey));
    return undefined;
  }
  return d;
}
