"use client";

import { createClient } from "@solana/kit";
import { walletWithoutSigner } from "@solana/kit-plugin-wallet";

/** Borel is Devnet-only. Wallets that do not advertise `solana:devnet` are filtered out by discovery. */
export const WALLET_CHAIN = "solana:devnet" as const;
export const DEVNET_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/**
 * One Wallet Standard client for the app (discovery, connect, signMessage). It carries no payer: the Borel
 * relayer pays every fee (gasless), and the wallet only signs the one room-delegation message at join.
 * On the server the plugin stays in its inert `pending` state, so this is safe to import during SSR.
 */
export const walletClient = createClient().use(
  walletWithoutSigner({ chain: WALLET_CHAIN, storageKey: "borel-wallet" }),
);

export type WalletClient = typeof walletClient;
