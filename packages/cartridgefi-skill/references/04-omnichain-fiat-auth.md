# Pattern 04 — 7-Chain USDC Cashier, Apple Pay, Passkeys & Gasless Session Keys

## Canonical Solana USDC Settlement
CartridgeFi eliminates fragmented multi-token liquidity. Deposits from all **7 supported chains** (`solana`, `base`, `ethereum`, `arbitrum`, `bnb`, `monad`, `polygon`) plus **Apple Pay**, **Google Pay**, and **Debit Card** settle 100% into canonical Solana `USDC` (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`):

- Native `solana` USDC deposit fee: `0 bps`
- Cross-chain intent solver fee: `10 bps` (`(amountUsdcAtomic * 10n) / 10_000n`)
- Gas sponsorship: **Kora Paymaster** sponsors Solana L1 delegation & settlement fees so players never need SOL for gas.

## Zero-Popup Ephemeral Session Keys (`MagicBlockSessionSigner`)
Every match creates an in-memory WebCrypto Ed25519 session key (`@solana/kit` `generateKeyPairSigner`) bounded by `SessionEnvelopeConfig`:
1. **Bounded USDC Exposure**: `maxUsdcAtomic <= 500_000_000n` (`500 USDC` beta room cap).
2. **Hard Leverage Guard**: `maxLeverage` integer in `[1, 5]`.
3. **Strict Program & Action Isolation**: Only gameplay stance instructions on `cartridge-er-room` (`Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR`) are permitted. SPL Token (`Tokenkeg...`), Token-2022, and Vault Router withdrawal instructions are hard-blocked client-side and on-chain.
4. **TTL & Instant Revocation**: Automatic expiry check on every signature + `client.disconnect()` / `signer.revoke()`.

## SDK Example
```ts
import { CashModalClient, USDC_UNIT } from "@cartridgefi/sdk";

const cashier = new CashModalClient();

// Cross-chain Base -> Canonical Solana USDC intent + Apple Pay Passkey bootstrap
const session = await cashier.bootstrapApplePayOrPasskeySession({
  wallet: "D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1",
  roomShardPda: "Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR",
  amountUsdcAtomic: 50n * USDC_UNIT,
  rail: "APPLE_PAY",
  sourceChain: "base",
  maxLeverage: 3,
});
```
