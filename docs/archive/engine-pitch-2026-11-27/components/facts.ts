import devnetProof from "@/data/devnet-proof.json";

/**
 * Every figure rendered in the pitch deck is derived here from a traceable source:
 * - `@/data/devnet-proof.json` (machine copy of docs/DEVNET_PROOF.md, verified 2026-11-26T15:50:50Z)
 * - `programs/cartridge-vault-router/src/lib.rs` constants (fee split + risk caps)
 * - `packages/shared-types/src/manifest.ts` (Borel #001 / Pulse Runner #002 manifests)
 */

export const SLIDE_COUNT = 11;

export const PROGRAMS = [
  {
    key: "registry",
    name: "Registry",
    crate: "cartridge_registry",
    id: devnetProof.programs.cartridgeRegistry.programId,
    role: "Manifests and engine config: genre, markets, formula and fees stored as data",
  },
  {
    key: "er-room",
    name: "ER Room",
    crate: "cartridge_er_room",
    id: devnetProof.programs.cartridgeErRoom.programId,
    role: "Delegated room state, private permissions, VRF and four i128 scoring formulas",
  },
  {
    key: "vault-router",
    name: "Vault Router",
    crate: "cartridge_vault_router",
    id: devnetProof.programs.cartridgeVaultRouter.programId,
    role: "SPL escrow, session risk envelopes, winner payouts and the fee split",
  },
  {
    key: "passport",
    name: "Passport",
    crate: "cartridge_passport",
    id: devnetProof.programs.cartridgePassport.programId,
    role: "Portable market ELO and eligibility, readable by every app",
  },
] as const;

const transactions = devnetProof.transactions;

export const TX_TOTAL = transactions.length;
export const TX_L1 = transactions.filter((t) => t.layer === "Solana Devnet L1").length;
export const TX_ER = transactions.filter((t) => t.layer === "MagicBlock ER").length;
export const TX_TEE = transactions.filter((t) => t.layer === "MagicBlock Private ER (TEE)").length;

/** Solscan-linked accounts in docs/DEVNET_PROOF.md §1–§2: 4 programs + 8 protocol accounts. */
export const LINKED_ACCOUNTS = 12;

export const ER_SESSION_UPDATES = devnetProof.metrics.erSessionStateUpdatesCount;
export const VERIFIED_AT_UTC = devnetProof.verifiedAtUtc;

export const PLATFORM_FEE_ACCOUNT = devnetProof.accounts.platformFeeAccountAta;
export const PLATFORM_FEE_BALANCE_UNITS = BigInt(devnetProof.metrics.platformFeeAccountFinalBalanceUnits);
export const ARENA_PLATFORM_FEE_UNITS = BigInt(devnetProof.metrics.arenaPlatformFeeUnits);
export const ARENA_CREATOR_FEE_UNITS = BigInt(devnetProof.metrics.arenaCreatorFeeUnits);
export const DEVNET_MINT_DECIMALS = 6;

export const BOREL_MANIFEST_PDA = devnetProof.accounts.referenceHarness001ManifestPda;
export const PULSE_MANIFEST_PDA = devnetProof.accounts.referenceHarness002ManifestPda;

export const MAGICBLOCK = {
  delegationProgram: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
  permissionProgram: "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
  esplProgram: "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2",
  router: "devnet-router.magicblock.app",
  tee: "devnet-tee.magicblock.app",
} as const;

/** programs/cartridge-vault-router/src/lib.rs */
export const VAULT_CONSTANTS = {
  maxTotalFeeBps: 1_000,
  maxCreatorShareBps: 5_000,
  partnerWalletShareBps: 4_000,
  partnerCreatorShareBps: 3_000,
  maxLiveLeverage: 5,
  betaMaxRoomPoolUsdc: 500,
  betaMaxGlobalTvlUsdc: 5_000,
} as const;

/** Format integer base units with fixed decimals using bigint only (no floating point). */
export function formatUnits(units: bigint, decimals: number, fractionDigits = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const frac = units % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, fractionDigits);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionDigits > 0 ? `${wholeStr}.${fracStr}` : wholeStr;
}

export function groupDigits(units: bigint): string {
  return units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function solscanAccount(key: string): string {
  return `https://solscan.io/account/${key}?cluster=devnet`;
}

export function shortKey(key: string, head = 6, tail = 4): string {
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

/** "2026-11-26T15:50:50.174Z" -> "2026-11-26 15:50 UTC" */
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
