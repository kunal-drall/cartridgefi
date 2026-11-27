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
