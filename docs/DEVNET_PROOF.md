# CartridgeFi Protocol (`v0.1.0-blitz-protocol`) — MagicBlock Blitz v10 Live On-Chain Proof

**Positioning:** Technical Entertainment Finance Protocol (`Infra + DeFi + Privacy`)  
**Execution Mode:** `CARTRIDGEFI_STANDALONE_DEV=false` (100% Live On-Chain Execution)  
**Verified Timestamp (UTC):** `2026-11-26T15:50:50.174Z`  
**Solana Devnet L1 RPC:** `https://api.devnet.solana.com`  
**MagicBlock Router RPC:** `https://devnet-router.magicblock.app` (`https://devnet-us.magicblock.app` · Validator `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`)  
**MagicBlock Private ER TEE:** `https://devnet-tee.magicblock.app` (Intel TDX Validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`)

---

## 1. Deployed Protocol Program IDs & Priority Rent Audit

| Priority | Program | Devnet Program ID | SBF Size | Rent-Exempt Min |
| :---: | :--- | :--- | :---: | :---: |
| **#1** | `cartridge_er_room` | [`Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR`](https://solscan.io/account/Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR?cluster=devnet) | `435,080 B` | `2.21085664 SOL` |
| **#2** | `cartridge_vault_router` | [`6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT`](https://solscan.io/account/6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT?cluster=devnet) | `373,232 B` | `1.89666880 SOL` |
| **#3** | `cartridge_registry` | [`5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr`](https://solscan.io/account/5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr?cluster=devnet) | `188,752 B` | `0.95951040 SOL` |
| **#4** | `cartridge_passport` | [`5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr`](https://solscan.io/account/5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr?cluster=devnet) | `182,040 B` | `0.92541344 SOL` |

- **Compiler Profile (`Cargo.toml`):** `opt-level = "z"`, `lto = "fat"`, `codegen-units = 1`, `overflow-checks = true` (zero raw OS `strip`)

---

## 2. `build.magicblock.app` Submission Identity & Fee Accounts

| Submission Field | Live Devnet Pubkey | On-Chain Verification |
| :--- | :--- | :--- |
| **Relayer / App Wallet** | [`D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1`](https://solscan.io/account/D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1?cluster=devnet) | Signed TEE auth, `delegateSpl`, 3x private fee-paying transfers, in-TEE `transferSpl`, and `withdrawSpl` |
| **`platformFeeAccount` (Canonical ATA)** | [`6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir`](https://solscan.io/account/6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir?cluster=devnet) | Canonical SPL ATA of owner [`Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd`](https://solscan.io/account/Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd?cluster=devnet) for mint [`F6chXtYN1UUtxY1eNcbjnRDqnMWVYNUtqUqiy52pzWm1`](https://solscan.io/account/F6chXtYN1UUtxY1eNcbjnRDqnMWVYNUtqUqiy52pzWm1?cluster=devnet); Balance **`15070000` units** (`+5000000` Arena + `+60000` Private Transfers) |
| **`platformFeeAccount` Owner** | [`Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd`](https://solscan.io/account/Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd?cluster=devnet) | Protocol Treasury Authority |
| **Devnet SPL Mint (6 Decimals)** | [`F6chXtYN1UUtxY1eNcbjnRDqnMWVYNUtqUqiy52pzWm1`](https://solscan.io/account/F6chXtYN1UUtxY1eNcbjnRDqnMWVYNUtqUqiy52pzWm1?cluster=devnet) | Shared across `RoomVault` escrow & eSPL (`SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2`) |
| **Protocol `EngineConfig` PDA** | [`Aeat6EKd8c6hp6unEB73VxBTRRp6cU87Eh6Y8jJChcGj`](https://solscan.io/account/Aeat6EKd8c6hp6unEB73VxBTRRp6cU87Eh6Y8jJChcGj?cluster=devnet) | Bound to canonical `platformFeeAccount` `6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir` |
| **Reference Harness #001 Manifest** | [`64RnhRaWoy6aSE9bxE5oUtjbrLkEeRjqrim6x15WQwpF`](https://solscan.io/account/64RnhRaWoy6aSE9bxE5oUtjbrLkEeRjqrim6x15WQwpF?cluster=devnet) | Protocol Integration Demo #001 (`DirectionNeutralRelReturn`) |
| **Settled `RoomShard` PDA** | [`8weMvjPkTajFRoWfokrBd3U5qi7sZQbZSvA4G2Ram9tE`](https://solscan.io/account/8weMvjPkTajFRoWfokrBd3U5qi7sZQbZSvA4G2Ram9tE?cluster=devnet) | Delegated -> 6x Session Updates -> VRF `0xbf045a4c5d10a34e728c51e2…` -> Undelegated to L1 |
| **eSPL Global Vault PDA** | [`DQXB3giWy64aRTW8oDMwoUkjq8X8zkfsA6Eewy1uzXEE`](https://solscan.io/account/DQXB3giWy64aRTW8oDMwoUkjq8X8zkfsA6Eewy1uzXEE?cluster=devnet) | Initialized & active under `SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2` |

---

## 3. Category A — Program Delegations, 6x Real-Time Session Updates, VRF & L1 Settlement

| Step | Layer | Solscan Proof | Verification Notes |
| :--- | :--- | :--- | :--- |
| 1d. Initialize ArenaShard & RoomVault on L1 | Solana Devnet L1 | [`SEXNey74rZfL2T6D…`](https://solscan.io/tx/SEXNey74rZfL2T6DAT4Dzh1Q3mc3UQZaisVznzEENXcMwdUcpvK7sC9b3YztS6ZXdHktNTDWQk3osqJcwebnM59?cluster=devnet) | RoomShard 8weMvjPkTajFRoWfokrBd3U5qi7sZQbZSvA4G2Ram9tE bound to canonical platformFeeAccount 6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir |
| 1e. Fund 2 Players & Mint 100 USDC Principal Each | Solana Devnet L1 | [`e3UZ9e6ehe89pbkj…`](https://solscan.io/tx/e3UZ9e6ehe89pbkjELx8uCvWCKw8qpyQnZRsjnAPgjm95Zcku5yXFZJwRxgZNif9bHfBWmhCYfB2Q7UBgCQ7Y8M?cluster=devnet) | Player1=D8yuJCu6XuRTWgxKo3JcWQEcskiEKHckeT8ZuUziDGG4, Player2=s8rVWMf8S6uxnDVfnPQDKE28GLuvUK5ymYtY7aNWRi5 |
| 1f. Participant A (Long Conviction) Open SessionRiskEnvelope | Solana Devnet L1 | [`1cRGKVJ8StmvAYYn…`](https://solscan.io/tx/1cRGKVJ8StmvAYYnLKFPcQFhdC4Kjk4bCXtBQBthboNZQHMd7u5YFkXX6uEsq9Puesediv7ZEukem187qLUTUxb?cluster=devnet) | Envelope HmyAkaxUvEm7NUmXZAxyx1F5czjbUeNqhPhnpLrff2qN -> SessionKey 7hBwEGSRhX4AZwSypUs4iRhXstmfY6FYDkFcs6Mb5g5e |
| 1f. Participant B (Short Conviction) Open SessionRiskEnvelope | Solana Devnet L1 | [`2HrCcb15B2h5vNYW…`](https://solscan.io/tx/2HrCcb15B2h5vNYWNgFqw9yqMncUba7VvSmu9v5fo5J5C6vE7A9yMpg5uYdD81oebL5Ha6RyKE9jW1vsPLMBgbdb?cluster=devnet) | Envelope HsLnUJK1X9EeEedTgHvBP2UErVn8VtKcpsTizdB3wyST -> SessionKey BvemA3bvHt6mmcrQcgBjbzDbitVXdkgpbhLaEDM6fMsZ |
| 1g. Delegate ArenaShard to MagicBlock Delegation Program | Solana Devnet L1 | [`2zBDRUDSBmZLXb1H…`](https://solscan.io/tx/2zBDRUDSBmZLXb1Hxd5ueF4T9wDBMsZGWWmBeEX5cs4jGT77cajumEcKbogvudBQYVHS68Mgqyq1cWeu8s864T6W?cluster=devnet) | Delegated 8weMvjPkTajFRoWfokrBd3U5qi7sZQbZSvA4G2Ram9tE -> DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh (validator=MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd) |
| 1h. Participant A (Long Conviction) Init & Delegate PlayerStance | Solana Devnet L1 | [`3fkyDnRvmboQrCoe…`](https://solscan.io/tx/3fkyDnRvmboQrCoe2B7HAvU7BdLEwpbkLReMiFS4cctS7rgmABvgq998nnr5ZgHYFwGZb3Gzudw6wmZRhfyG3hHG?cluster=devnet) | Delegated DdCKSstknmPVypqkmYz11AiT61mQ1NvF5kdYJaXNTxkn -> DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh |
| 1h. Participant B (Short Conviction) Init & Delegate PlayerStance | Solana Devnet L1 | [`pZWefRKtPTge6GCG…`](https://solscan.io/tx/pZWefRKtPTge6GCGynMygyitChjmYcECSv3t8cnFKSMi1ukg8MCK2a4rsMBHXLc8odUpMRwSddeLh9zm7L33kvq?cluster=devnet) | Delegated FRG4c8cDh3g1MVTbUh8qe6tDxyZYVVxBroHGmKYpG7hE -> DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh |
| 1i. Participant A (Long Conviction) Init ER EphemeralPermission | MagicBlock ER | [`5rxkhBfJt6JsP1Kf…`](https://solscan.io/tx/5rxkhBfJt6JsP1KfP4rz1HqhfXshtYs3Mg8aJ75dcVnaf772ysBcdTng6eb4q2sztKqtPnWf31i8JQYvMhX6jBm4?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Permission PDA A5kFom1DQW17pxpFYYrvhWjWcePD8HFJ6Nppqad1aSFD (ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1) |
| 1j.1 Real-Time ER Session Update #1 | MagicBlock ER | [`xLVE6dm3x8Wx4W1U…`](https://solscan.io/tx/xLVE6dm3x8Wx4W1UaqnnsjNssxDdQGe2r628yvKz2C4EBCadteu9DHZUS7h6rWLu4Fy6dS6huLtTnkC7VrMjNRw?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Participant A (Long Conviction) zero-popup SessionKey (7hBwEGSR…) weights=[3000,7000,0,0] |
| 1j.2 Real-Time ER Session Update #2 | MagicBlock ER | [`WMEX7x36wNqmRQSo…`](https://solscan.io/tx/WMEX7x36wNqmRQSoVt3bmjd9hGAbAaqgDcBDcmFoJ72eMxkW6uCas3GqA9gZiJGVEzZHT5gQHgBRuoB2Gb8QRPe?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Participant A (Long Conviction) zero-popup SessionKey (7hBwEGSR…) weights=[3500,6500,0,0] |
| 1j.3 Real-Time ER Session Update #3 | MagicBlock ER | [`3wKGSgi1Fs6f5JjT…`](https://solscan.io/tx/3wKGSgi1Fs6f5JjTETmyozxkJxUwUvuydUSnYbophfGZFPiu1Es92x7R3DR5wH51gdBSs9G8pBcPUbBbkaSPZ8B8?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Participant A (Long Conviction) zero-popup SessionKey (7hBwEGSR…) weights=[4000,6000,0,0] |
| 1i. Participant B (Short Conviction) Init ER EphemeralPermission | MagicBlock ER | [`5q8J6bCDHqNrMVwn…`](https://solscan.io/tx/5q8J6bCDHqNrMVwn94Ld2LJysn7XuuvhGFMmk2oFJSQ9qsgxrpzjZpNyxxRg1BJ1Ajqn9R2CdryQKWHCM5Huqtmj?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Permission PDA 8D1Hx444xbR3BeoX7kXRo7icv8Vc3jet1mhrCsMTyFV9 (ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1) |
| 1j.4 Real-Time ER Session Update #4 | MagicBlock ER | [`7E7X7rniTbovZr52…`](https://solscan.io/tx/7E7X7rniTbovZr52okGz4bQoBnoEeDWZjhLKRSsiLVnZ4nK8B27SyPA1xNpZrwSYHz7FtLBqSEbZdAs3q9cHE3M?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Participant B (Short Conviction) zero-popup SessionKey (BvemA3bv…) weights=[-3000,-7000,0,0] |
| 1j.5 Real-Time ER Session Update #5 | MagicBlock ER | [`2nkJZ9jy7Baf7Pm3…`](https://solscan.io/tx/2nkJZ9jy7Baf7Pm3WRMFnyKtSeyD1RGDTQARGqjSre2wpLujYVWuLuvZ5wYnb6A7Xvqx35d2T1FkTGNpgMFx717E?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Participant B (Short Conviction) zero-popup SessionKey (BvemA3bv…) weights=[-3500,-6500,0,0] |
| 1j.6 Real-Time ER Session Update #6 | MagicBlock ER | [`5mNQQ5z3unmCQMDA…`](https://solscan.io/tx/5mNQQ5z3unmCQMDAZFtfSeqXY5iPFZ4vjfyUNWCtg5rrgLGx6sxiU41EQ1oAEP6fCXXkaW8Xg4oQNujqRtCb4FkW?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Participant B (Short Conviction) zero-popup SessionKey (BvemA3bv…) weights=[-4000,-6000,0,0] |
| 1k. Request Live MagicBlock VRF Randomness | MagicBlock ER | [`3gJanrfejfoicdLX…`](https://solscan.io/tx/3gJanrfejfoicdLXrqmGxrMe3Gk9TB3e77t84HXaPZrQFbMzxPQpGbh5rhw66qJN97EnJ6TqHQoaEvQtz4JV8XvM?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Delegated queue 5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc -> callback_settlement_vrf |
| 1l. Showdown Permission Unseal (Participant A (Long Conviction)) | MagicBlock ER | [`G1MRLfDLHRLJgdQ7…`](https://solscan.io/tx/G1MRLfDLHRLJgdQ7HnEZyEeUjz7Rw5DoNAdhNg8QLZ92E2ZQj6V34uukPpvobBpMweaHnU8kukaxSMUrcu5HkR9?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | UpdateEphemeralPermissionCpi -> public Showdown state |
| 1l. Showdown Permission Unseal (Participant B (Short Conviction)) | MagicBlock ER | [`KrzVqcDH7yzsbeKJ…`](https://solscan.io/tx/KrzVqcDH7yzsbeKJgKYuA7ABG2AkCTrTNC3sdWAqWXyPRhvdu8sDSR9fwdX2EynwGsMeSKKSpSzBTSFMKGzYZnK?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | UpdateEphemeralPermissionCpi -> public Showdown state |
| 1m. Evaluate Deterministic Score (Participant A (Long Conviction)) | MagicBlock ER | [`49TeWtpa82HDjqtW…`](https://solscan.io/tx/49TeWtpa82HDjqtWpmQXC5F55d5CtJKXFEcjFCqoZGBgKXeiULKrwmVTAtqhuLuXNpD3tedm6sSTZMNAnx4FEGuM?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | i128 (10^9) fixed-point score + CloseEphemeralPermissionCpi |
| 1m. Evaluate Deterministic Score (Participant B (Short Conviction)) | MagicBlock ER | [`2eyRHqXdEaeFgbXo…`](https://solscan.io/tx/2eyRHqXdEaeFgbXozvJWy5ow6NmJM7mCgkZX4Me89scfQFgNXDkjpnwNMx526NoL34JuUbdvan1oHXSWuuYMhmzL?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | i128 (10^9) fixed-point score + CloseEphemeralPermissionCpi |
| 1n. Commit & Undelegate PlayerStance (Participant A (Long Conviction)) | MagicBlock ER | [`4LAxWRTqpwVf3GCx…`](https://solscan.io/tx/4LAxWRTqpwVf3GCxcYraC9J3b7StC33ZqCi2MxEvekA72FQ8RhmKc8UvPJgnb8gtiRqAMhtbUfG23gXuXaYJUBWZ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | MagicIntentBundleBuilder::commit_and_undelegate -> Solana Devnet L1 |
| 1n. Commit & Undelegate PlayerStance (Participant B (Short Conviction)) | MagicBlock ER | [`4oPn9rQGRRsnCxhw…`](https://solscan.io/tx/4oPn9rQGRRsnCxhwBoycTydgAzpzP2Lpzho31msQdprWkMp4e4bY1V7JKXgj5jm4WQXkun4JKpRZA8tdKeW2REXq?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | MagicIntentBundleBuilder::commit_and_undelegate -> Solana Devnet L1 |
| 1o. Settle & Commit+Undelegate ArenaShard to L1 | MagicBlock ER | [`3Ljspf1XppENsm75…`](https://solscan.io/tx/3Ljspf1XppENsm75dzu7utizmAobbxQCP7L8L4S1kcLUksLN1VR6HzCqbpPVG4orw3xzr5tQSsJ2czFLrGSs9EE9?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | MagicIntentBundleBuilder::commit_and_undelegate -> Solana Devnet L1 |
| 1p. Settle Arena Pool & Pay Protocol Fee on L1 | Solana Devnet L1 | [`4HBq6pLiRajjwHzu…`](https://solscan.io/tx/4HBq6pLiRajjwHzu65LEasQEMYbpSpqXDreGA1sERxaXuCHX4MqkRofV2yG6bQn3vEHW6XDBueqgEGmafVXpBusV?cluster=devnet) | Credited canonical platformFeeAccount (6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir) + creatorFeeVault |
| 1q. Winner Claim Payout on L1 | Solana Devnet L1 | [`5q2XBveFNbUnf8Wz…`](https://solscan.io/tx/5q2XBveFNbUnf8Wzxdek9hkPAwczcXUUnmJUWcXKzfVMe26oLsFQWXkEnXLoyuJjawbM1K8UMcDYGQUi6nns5WQe?cluster=devnet) | Winner D8yuJCu6XuRTWgxKo3JcWQEcskiEKHckeT8ZuUziDGG4 claimed Harmonic Shapley payout |
| 1r. Update Cross-Game Market ELO Passport on L1 | Solana Devnet L1 | [`3EDExdtwzuvBSXrH…`](https://solscan.io/tx/3EDExdtwzuvBSXrHDdFmaeibqnRo3UCoGDEfdseDXCr5utZ4fd8mvdW5sJ8zsU7zf642AtWmJ13NUcLm6mT6wbWf?cluster=devnet) | MarketPassport PDA H9UVqeXPiZDHnU2zyjcdgdzxJyWkMDL5nrL5dJ8YE6NS |

---

## 4. Category B — Relayer Private eSPL Payments, TEE Auth & `platformFeeAccount`

| Step | Layer | Solscan Proof | Verification Notes |
| :--- | :--- | :--- | :--- |
| 2a. Fund Relayer Canonical ATA & Recipient ATAs | Solana Devnet L1 | [`4nvfgrv6MyQSjfxm…`](https://solscan.io/tx/4nvfgrv6MyQSjfxmhKwCKx6hxq9wHug1XkWrLue6kZro5kJcgKBY8kqMCVQCmP7of9PKg8gPULMUvJ1E7VWVr4h1?cluster=devnet) | Relayer ATA 5utFSmRYYepNJWj4Uuz7AYLey5CFqMSAQ1MF1mBhj3QU funded with 25,000,000 units of F6chXtYN1UUtxY1eNcbjnRDqnMWVYNUtqUqiy52pzWm1 |
| 2b. Relayer SDK `delegateSpl` into Private ER TEE | Solana Devnet L1 | [`4joJKzqR2N9zuwHN…`](https://solscan.io/tx/4joJKzqR2N9zuwHNd3tCPesNkPvRXFF7PZbLPiTSaXSbuZMFcwf9iK8LPWLoWS97v44RtKdWtUTp2NnSgrKuZ5vx?cluster=devnet) | Deposited & delegated 5,000,000 units via SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2 to TEE MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo |
| 2c.1 Relayer Private Transfer #1 (Encrypted TEE Magic ATA + Fee) | Solana Devnet L1 | [`3CsEpDT6HLBif5dM…`](https://solscan.io/tx/3CsEpDT6HLBif5dMsWNDYXJk9uk2QDrdBwQrv4neRBJSfHSSmYmugLZmKUAZziSycKCn3QFoFCCLNcq6rpUXSZH3?cluster=devnet) | Encrypted ix 34 -> TEE MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo; paid 15000 token fee (100 bps) into platformFeeAccount 6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir |
| 2c.2 Relayer Private Transfer #2 (Encrypted TEE Magic ATA + Fee) | Solana Devnet L1 | [`2YG9tGwG71WL8hTL…`](https://solscan.io/tx/2YG9tGwG71WL8hTLwfkjVuRbMxtHU5wQkfpj25PNB8RK8D2wVcMj2dpAGgjY88U5SkV9WutZytmwRFLmPPjYWmf9?cluster=devnet) | Encrypted ix 34 -> TEE MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo; paid 20000 token fee (100 bps) into platformFeeAccount 6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir |
| 2c.3 Relayer Private Transfer #3 (Encrypted TEE Magic ATA + Fee) | Solana Devnet L1 | [`AFy5keK578KJGcvr…`](https://solscan.io/tx/AFy5keK578KJGcvrhx6rdMEpjb5m7Fo8EfnXTh91F2cXubAc3MomHgLGz6MpsuPiX1fSXVVSneyJhNaUPTBfmmB?cluster=devnet) | Encrypted ix 34 -> TEE MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo; paid 25000 token fee (100 bps) into platformFeeAccount 6YR5GiT8KmnbPdhx5siRHBPWTtnxE3FQCGjkwyzbMzir |
| 2d. In-TEE SDK `transferSpl` (Private Ephemeral -> Ephemeral) | MagicBlock Private ER (TEE) | [`2WYxkTdTPX9B5qQY…`](https://solscan.io/tx/2WYxkTdTPX9B5qQYAmJFebaJsBEsTtCX1CZCopzuj3pwejiHCezCR5C7gmucaXYSdFrrSRuatvAHyFJRNdWR1MYQ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) | Executed inside Intel TDX TEE (https://devnet-tee.magicblock.app) via EnsureMagicAtaDestination + SPL Transfer |
| 2e. Relayer SDK `withdrawSpl` Shuttle Withdrawal to Base L1 | Solana Devnet L1 | [`4V7kkHif9B3MgLbe…`](https://solscan.io/tx/4V7kkHif9B3MgLbeUuGmnWd9zMP5AhSWnQ6buXipLnMvG7pyePZQm4iXmyqLPMWLkTP6LJYRoBpCCxfAcpygKuYm?cluster=devnet) | Withdrew 1,000,000 units from TEE MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo -> 5utFSmRYYepNJWj4Uuz7AYLey5CFqMSAQ1MF1mBhj3QU |

---

## 5. Reproducing This Proof

```bash
CARTRIDGEFI_STANDALONE_DEV=false pnpm prove:blitz
```

---

## Borel live app — status 2026-11-27 16:10 IST (superseded)

> Superseded at 17:05 IST: the relayer was funded with 10 devnet SOL and the full lifecycle ran live. See **Borel live run** below, plus the production app's own `join`/`lock` transactions, e.g. [`374vJPvC…`](https://solscan.io/tx/374vJPvC6hW7ZBemsdmU9VNDk5HtDejsEiFg16grJb412LimcTpDvVo125asvMy8tkdaUD5Z99rJhPGuGB1fp1Qa?cluster=devnet).

The Borel table at https://cartridgefi.vercel.app sends room actions through a server-side relayer, `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg` ([Solscan](https://solscan.io/account/Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg?cluster=devnet)). The devnet RPC faucet returned HTTP 410 ("faucet closed") and **the relayer holds 0 SOL**, so no Borel transaction has been broadcast yet. **This section therefore lists no signatures.** The historical run above was signed by a different authority (`D7ba9q…`) on 2026-11-26.

What is verified today, by `simulateTransaction` (`sigVerify: false`) against the deployed devnet programs, using the funded proof-run authority as a labelled stand-in fee payer:

```text
# Room opened (cartridge_er_room.initialize_room_shard) + PlayerStance initialized & delegated to MagicBlock ER — simulation OK (133358 CU, 1164 bytes)
Program 5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr invoke [1]   Instruction: RegisterCartridge
Program Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR invoke [1]   Instruction: InitializeRoomShard
Program Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR invoke [1]   Instruction: InitStanceAndDelegate
Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]
```

To produce live links once the relayer holds at least 0.15 devnet SOL:

```sh
cd /Volumes/T7/cartridgefi && node scripts/prove-live-devnet.ts
```

The script runs the full lifecycle (join → delegate → `submit_stance` on the ER → pivot → `request_settlement_vrf` → `trigger_showdown_unseal` → undelegate → `settle_and_commit_shard`) and appends real Solscan links to this file. SPL stakes, `platformFeeAccount` fee routing and `record_elo` need the original authority (test-mint and passport admin), so neither the app nor the script can run them with the new relayer.

---

## Borel live run — 2026-11-27T11:35:43.089Z

Relayer authority `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg` (fresh Devnet key; no deployer/admin key used). Room `borel-live-mwywkypu`, RoomShard [`Gd3Q9c7wUU5JqfFC5TJi5xPRAdpLjbRrKZiB9YTWQR1k`](https://solscan.io/account/Gd3Q9c7wUU5JqfFC5TJi5xPRAdpLjbRrKZiB9YTWQR1k?cluster=devnet), VRF seed `0xa00255436e6b253e94e6b7278c2e1cf45617b2cb4e98a41048839a6544916379`.
Hand → slot mapping: [SOL/USD, BTC/USD, ETH/USD, NVDAx/USD], weight_bps = ±conviction × 1000; one pivot enforced on-chain by max_rebalances = 2. Fee-free paper room: no SPL stake, no distribute/claim, no passport ELO write (admin-only).

| Step | Layer | Solscan |
| :--- | :--- | :--- |
| register_cartridge (borel-live-mwywkypu) + initialize_room_shard Gd3Q9c7wUU5JqfFC5TJi5xPRAdpLjbRrKZiB9YTWQR1k | Solana Devnet L1 | [`2hvj9BwvhC1qtVog…`](https://solscan.io/tx/2hvj9BwvhC1qtVogKgDHjxm38wwhT36yCVqwDjgPYqLp9cFsxzn6n1WV48wzwEPf8r7AqfbFHi8ekjZTQ6KpFLFC?cluster=devnet) |
| fund 2 player keys (0.03 SOL each, relayer-sponsored) | Solana Devnet L1 | [`zjFLyB9xRhRjDX4T…`](https://solscan.io/tx/zjFLyB9xRhRjDX4TP7VhQ92jY2HrVYFx7CKSPw3FbNpPHQUVd9vVv2eUPtYLtLWAT8feHb23GjKPXYEpAo7X9wP?cluster=devnet) |
| Player A: initialize_passport + hand commitment sha256=97dfb3cff04ff3f8… | Solana Devnet L1 | [`37LFvkuBnUgx2XK9…`](https://solscan.io/tx/37LFvkuBnUgx2XK9TcQZeV9nQsBoynQ2VP5NzViQkCpCcM9P1eNyRppCX838cqpqTCRCNNobruP3D9FAhgESELSy?cluster=devnet) |
| Player B: initialize_passport + hand commitment sha256=d35735025c338593… | Solana Devnet L1 | [`5cMoPPZQ1Tidjm4m…`](https://solscan.io/tx/5cMoPPZQ1Tidjm4msNkbWWXDkfEUHC3nqvr5eS6SQJz7z67cfJh8Tx5b9rxHURMGyhmqHQL33kDWrzzDv2q9w925?cluster=devnet) |
| delegate_room_shard → MagicBlock Delegation Program | Solana Devnet L1 | [`XTyXmR1PfJuVtHqB…`](https://solscan.io/tx/XTyXmR1PfJuVtHqBPYwJ2fULkhLahkG22gp8DQDMdUgLnrKSaq1h4KTQJNCUgfxu3YdSSAs5o1ELhmsG2ZJifx2?cluster=devnet) |
| Player A: init_stance_and_delegate (PlayerStance 4L1CQ1xpcdwhjrAzerxrCRsQsEr6QxhBeVAqiBZ5NZYU) | Solana Devnet L1 | [`5Aa9a9KUMJU8yn8e…`](https://solscan.io/tx/5Aa9a9KUMJU8yn8eCLqD1Dz3ZRQip6AekC3gXsHewYd9fqCg8LipifMSsm6dAnS3byJSiuqnBAWGrtht1VH4M5vd?cluster=devnet) |
| Player B: init_stance_and_delegate (PlayerStance B9Up5mBcLStfeojThSzWeXxnUJFqrNYPBsrcuz66v5uP) | Solana Devnet L1 | [`HKoYPyK2iXQrtwnQ…`](https://solscan.io/tx/HKoYPyK2iXQrtwnQ5zsmmyRjXuGziJvgh6qUHK6QayVQsd7PrkDD6Av1xn5tceZQmSx7tHSgDQK7QpKcaU6ZLVK?cluster=devnet) |
| Player A: join_room_and_init_permission (private Fog-of-War) | MagicBlock ER | [`MXKUqpJGvj45qzid…`](https://solscan.io/tx/MXKUqpJGvj45qzidoaYwj8jpeYb4aAgE5A6bXSPTfGY2R59YzfTdErLNnpXbChzdoWunQDToVr81fSXpx9LkosQ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: join_room_and_init_permission (private Fog-of-War) | MagicBlock ER | [`2e6Sfavr8p4kzxxz…`](https://solscan.io/tx/2e6Sfavr8p4kzxxzFjF1qyua3Ux9Kgn9LTWwPBmruPVJXPUxWppXUk9c9SKLFdAFjaAQMYLpB7PAkdRGzwrYQLAh?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: submit_stance — sealed hand weights [3000,-1000,2000,0] | MagicBlock ER | [`5UToD8EA1WfwL1eV…`](https://solscan.io/tx/5UToD8EA1WfwL1eVWYcJ1TmQMo1HokggjxpGHa39TGDpxpyMierG2oFWCLRN2nKgAxA5G5umL9iGvaZDgQTvd9ij?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: submit_stance — sealed hand weights [-2000,1000,0,3000] | MagicBlock ER | [`2R9b94kmvsa6uJEo…`](https://solscan.io/tx/2R9b94kmvsa6uJEouZykp8gMDv4GV4x3A4gmTFwKhakBfA3dUuJGW7fgcXcFUdKTMiCydaatKxAYhPTxYjbTqxDu?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: submit_stance — pivot FLIP leg 3 → [3000,-1000,-2000,0] (max_rebalances=2 caps further moves) | MagicBlock ER | [`25YzeLXxjnp3wHPt…`](https://solscan.io/tx/25YzeLXxjnp3wHPttKYKvkAxYixYkUBecGZFLH85BNoaqjmTKuexKVSwXSxrXeHuqpvW6Fi2rfZpeLzoRTixzFop?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: submit_stance — pivot SHIELD leg 2 → [0,1000,0,3000] (max_rebalances=2 caps further moves) | MagicBlock ER | [`3W146awibjJufJSJ…`](https://solscan.io/tx/3W146awibjJufJSJeeiEiketFjp4URLhGC3L9ApjGKR7ShaEzAHTbr5gdFDvex6b9evsZe9tGJdKWwzBimm7eJx7?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| request_settlement_vrf (MagicBlock VRF) | MagicBlock ER | [`5iU3iP8mNTRAifbo…`](https://solscan.io/tx/5iU3iP8mNTRAifboZBeZ9rv5RDeu2QFddF7V9coFkQFu7BgdQtJMEtpXZuBqNULrbMSr6FeDFwQh7SS9mFa8HcPG?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: trigger_showdown_unseal | MagicBlock ER | [`5tVx2j9fNc4evBP9…`](https://solscan.io/tx/5tVx2j9fNc4evBP9cJkfzQeBx4S897TtfmjgkW9SZNsnZk94ghrnPmg8xiCTok4vGgwJ3xYsbqSrUZAVoVwfsFmg?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: trigger_showdown_unseal | MagicBlock ER | [`3RHYypTkSZ64hiow…`](https://solscan.io/tx/3RHYypTkSZ64hiowYk2qSGDZ17GCCjovSuWuoF8HAmNcXmmzZ7DETVceAki9gVuDvjJLoCWtfAZogeZYUHMY94Qr?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: evaluate_player_score (i128 1e9 fixed point) | MagicBlock ER | [`axSmhVZh45xKVdNW…`](https://solscan.io/tx/axSmhVZh45xKVdNWbmvQt3V2e28Ghn3krvHh7KueYh4AydwLQMAq4JSJGBhRQiyRacD2a1LEo5EuVDuUBm5dNMd?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: evaluate_player_score (i128 1e9 fixed point) | MagicBlock ER | [`5d7Df5V63CaV4bXG…`](https://solscan.io/tx/5d7Df5V63CaV4bXGPhUCXsU4EtyMEtPBywtu8ZqKXgvmYDVsT9G2Puj9oditSFQ66orgKKt3CKxRHDzAV6nF9KcP?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: undelegate_player_stance (commit → L1) | MagicBlock ER | [`3nmzV8fXy7tN6syX…`](https://solscan.io/tx/3nmzV8fXy7tN6syXgLoV9NXzSK8USQNj9Dmu8yM58z8MCKwnbcDhduS6wLfmXL34Yoe7XYu4urPFuwsvyq5ZCMqd?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: undelegate_player_stance (commit → L1) | MagicBlock ER | [`4hoNGnkwZ5haXCBJ…`](https://solscan.io/tx/4hoNGnkwZ5haXCBJq9q3Y2grzADMXpr3KckvFcosA6NXBG5THTHnBVZ4GJbxX8g64NMy5EeNAxq7ytpAhh41WYdR?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| settle_and_commit_shard (commit + undelegate RoomShard → L1) | MagicBlock ER | [`5X74AZj4REQSa2mf…`](https://solscan.io/tx/5X74AZj4REQSa2mfG2L3t2C5jRmaRbdxnHMqkxYQkjzBabf7bjbUvQ9HDmrsMjid53XjMMiXk82hi5yjkKrhP9nn?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |

---

## Borel redeploy under own authority (2026-11-27)

The original upgrade/admin key (`D7ba9q…`) is not available to this team, so the four programs were redeployed as fresh copies whose upgrade authority, EngineConfig admin, PassportConfig admin/keeper and test-USDC mint authority is the relayer [`Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg`](https://solscan.io/account/Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg?cluster=devnet). These are the live IDs the app uses. The program IDs in section 1 and the transactions above belong to the **historical proof run (2026-11-26)**.

| Program | Live Devnet program ID | Size | Deploy tx |
| :--- | :--- | :--- | :--- |
| `cartridge_registry` | [`BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc`](https://solscan.io/account/BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc?cluster=devnet) | `187,448 B` | [`5ouyy5UErMCj…`](https://solscan.io/tx/5ouyy5UErMCjKECPb9gDBsMfvi6z83bQ9zsv7S8XFAFkAzzWmwWaLc7APKo77TQzgAuDwNGgpjbeg9pZsYXgVvw7?cluster=devnet) |
| `cartridge_er_room` | [`DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W`](https://solscan.io/account/DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W?cluster=devnet) | `435,728 B` | [`5S8aCcnMhMZp…`](https://solscan.io/tx/5S8aCcnMhMZpaGgNgsmqeUaYjpEQpZHj7tU9YYAvoa5TWMcA16LZ1jcU2wFRb2bdccBC3iCcYR7PTHs1rJnv7oBi?cluster=devnet) |
| `cartridge_vault_router` | [`Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR`](https://solscan.io/account/Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR?cluster=devnet) | `374,216 B` | [`3EfCqjj9uYHu…`](https://solscan.io/tx/3EfCqjj9uYHuoV5khHNveyiLEKW2tmWcMD6NBWS479Z2JcSjgX9FnzFphfMJC9zf5RSqU8UV3nGUVfjaHwHY2Ycf?cluster=devnet) |
| `cartridge_passport` | [`B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF`](https://solscan.io/account/B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF?cluster=devnet) | `180,736 B` | [`wpdiq9Wu3ya8…`](https://solscan.io/tx/wpdiq9Wu3ya8oKpVC6t8tpwmAsWL9ybSpd58t9QPQy6inHYahw1AnmkCjBsfqrtiXNxpqvtDtXA4e8FH5qKETPx?cluster=devnet) |

| Account | Address | Init tx |
| :--- | :--- | :--- |
| Borel test-USDC mint (6 dp, relayer mint authority) | [`32CRMQ5gBzDv45kAKXVNLb7qfvoPAxRNp6dnnhkUnRtw`](https://solscan.io/account/32CRMQ5gBzDv45kAKXVNLb7qfvoPAxRNp6dnnhkUnRtw?cluster=devnet) | [`5CCMViMUZwXF…`](https://solscan.io/tx/5CCMViMUZwXFqtECuVGf97fDGFDEwsbGkgHYaWYN8bnoYAtYadYZCNQEu3vyvnXKctZmwEXGD3GmTwkQQYkpgX3p?cluster=devnet) |
| platformFeeAccount (ATA of treasury `DaQPvQ4Ewg7oK3Tgubkg8Rz54t8SBkCWrAjCCUzK2kcX`) | [`6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8`](https://solscan.io/account/6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8?cluster=devnet) | [`29faSabSB4kv…`](https://solscan.io/tx/29faSabSB4kvnYVAQEiwjZfKKketHSpeTPVTqSiz7Kvtvq8BQiEc6zoGgpeNjjtHpiPDSqQSMszpyWn2qNp2KxWs?cluster=devnet) |
| EngineConfig PDA (admin = relayer, private beta caps) | [`7NE1vxxMpPNBTmY9b22fbZ2gkP9vEDc3ck35T5aNqZin`](https://solscan.io/account/7NE1vxxMpPNBTmY9b22fbZ2gkP9vEDc3ck35T5aNqZin?cluster=devnet) | [`62NTWmBafL3Q…`](https://solscan.io/tx/62NTWmBafL3Qiar8vddPmD5MptqKpjNBooZJLnXmvytQSc3VizG7tSvEBgRRFd3yGh8a8nWCKkBdTkspbqMVtLYV?cluster=devnet) |
| PassportConfig PDA (admin = keeper = relayer) | [`DHhQBaL5ybFbWrRvTjhk95wsgpW23oNUQ8SQ5wn6vVpn`](https://solscan.io/account/DHhQBaL5ybFbWrRvTjhk95wsgpW23oNUQ8SQ5wn6vVpn?cluster=devnet) | [`3wYduGC2YniZ…`](https://solscan.io/tx/3wYduGC2YniZ1GdzgZvybj1bQMCFiNBggWC4NuPiyHU2qBJkMHdqtiUphhPEqQWamvHE7ZGpD77EXDrb3TFF3bkG?cluster=devnet) |

Faucet: `POST /api/borel/faucet` mints 100 test-USDC per wallet every 10 minutes. First live drip: [`RZucgkGukSUD…`](https://solscan.io/tx/RZucgkGukSUDJEisNp2XEYNVXdcjXJJT91qTQjkoYDNco1xTeryzemq9fiium8LrsjxtGzhhAJpRrNPUM5V5aJk?cluster=devnet). Reproduce with `node scripts/init-borel-own-authority.ts` (idempotent).

---

## Borel live run (own authority) — 2026-11-27T12:03:00.743Z

Relayer authority `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg` = upgrade authority of the redeployed programs (registry `BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc`, er_room `DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W`, passport `B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF`), test-USDC mint authority (`32CRMQ5gBzDv45kAKXVNLb7qfvoPAxRNp6dnnhkUnRtw`) and PassportConfig admin; fees land in platformFeeAccount [`6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8`](https://solscan.io/account/6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8?cluster=devnet). Room `borel-live-mwyxjvb8`, RoomShard [`FkizWRXjRn5MAJ4QtAt8pxJq5tHH4Z4NA1QVrt96B1xc`](https://solscan.io/account/FkizWRXjRn5MAJ4QtAt8pxJq5tHH4Z4NA1QVrt96B1xc?cluster=devnet), VRF seed `0xa1031d7e64ccfe23978aa5353ca2076283284bfcbcdaecf9453a7c3e863ee541`.
Hand → slot mapping: [SOL/USD, BTC/USD, ETH/USD, NVDAx/USD], weight_bps = ±conviction × 1000; one pivot enforced on-chain by max_rebalances = 2. SPL stakes (10 test-USDC each) are escrowed in the relayer ATA and settled to the highest on-chain final_score with a 1% fee into platformFeeAccount; cartridge_vault_router.distribute_pool_and_fees is not exercised in this run.

| Step | Layer | Solscan |
| :--- | :--- | :--- |
| register_cartridge (borel-live-mwyxjvb8) + initialize_room_shard FkizWRXjRn5MAJ4QtAt8pxJq5tHH4Z4NA1QVrt96B1xc | Solana Devnet L1 | [`3f5wZhUtC42pbjNE…`](https://solscan.io/tx/3f5wZhUtC42pbjNEcYorraD5mqRY7SvN51UYpsQA43Jk98y2GPp4ksTnpfnrjA1t4GY7Zrd6NBC8qvGWFxKEzbCJ?cluster=devnet) |
| fund 2 player keys (0.03 SOL each, relayer-sponsored) | Solana Devnet L1 | [`2ozFiHKVMf7JbPkY…`](https://solscan.io/tx/2ozFiHKVMf7JbPkYELsedUNogdinHau48qmeJ26gpBwwLbZAL7VY5iDJBVEdEsg4CJvUgZadQEphrrLBT6j2o9AR?cluster=devnet) |
| Player A: initialize_passport + hand commitment sha256=bd486bcf1706f937… | Solana Devnet L1 | [`HaeipsXWtKL9RYyU…`](https://solscan.io/tx/HaeipsXWtKL9RYyUijpBJ6au9NGRBPrRrwJsue8maVDbvHhxvGt6we4j1wi5Wi82c53b7CTYuyYANXouiQnumw9?cluster=devnet) |
| Player B: initialize_passport + hand commitment sha256=ec23250e947a478f… | Solana Devnet L1 | [`2GWKSMarrPn58JRC…`](https://solscan.io/tx/2GWKSMarrPn58JRCAQxv58AP2Xt5qrkAJ4aHcK9XBuN8ZXbKYR1gZESidriEkA3EkosNzkk7gD4HGKJvBKUxb4si?cluster=devnet) |
| delegate_room_shard → MagicBlock Delegation Program | Solana Devnet L1 | [`3UBBsBbhrowCL6M8…`](https://solscan.io/tx/3UBBsBbhrowCL6M8TQpNZunmSK4hdYs3WXcRYqnjKUUh1d6Q3MjJd3BqE6yNEhsZvrsqrqrkxFCYEKqYuPCBRSSV?cluster=devnet) |
| Player A: init_stance_and_delegate (PlayerStance G9GGYCREyTYS5cwNT1ZMFYRR2wj6YKomd5C1FukDzTgq) | Solana Devnet L1 | [`4BKcYjywJ6uJpnnq…`](https://solscan.io/tx/4BKcYjywJ6uJpnnqPbLUFQW7vGMpv6NEddWeKmDrGiebqNScFA9xcRwHwF3rpWhaT72zQoeUoAzh6QeqBTMnEyrx?cluster=devnet) |
| Player B: init_stance_and_delegate (PlayerStance 58zbzsvKK1xVnvHM5yqTb6M9PYhwcLo6baMutEuBybZW) | Solana Devnet L1 | [`2GaL8uRAB5gkMNFy…`](https://solscan.io/tx/2GaL8uRAB5gkMNFymokNZKtHpkPuDh3DZXetuhh2kafU3WjANCPpJP5af6JBpR29DeyaLd7i2ghYFbUMrwjh2PzX?cluster=devnet) |
| Player A: join_room_and_init_permission (private Fog-of-War) | MagicBlock ER | [`3DMVyVjso3VuAbDL…`](https://solscan.io/tx/3DMVyVjso3VuAbDLLPaVJsHDv1vLfowDvi28SmQ4ojaHcuBP8LPeztt4uiBaQoGtk47FD17U8rBatT1T1TwWHJcZ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: join_room_and_init_permission (private Fog-of-War) | MagicBlock ER | [`2yK9A28V5fsVy5U7…`](https://solscan.io/tx/2yK9A28V5fsVy5U7JiWsnh7ri3LSd8vNG67LpMe9C9C2hGabVnDftCMSaKGh5gvPrfCGpKuuMGQjUBLHJ6X4pYH9?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: submit_stance — sealed hand weights [3000,-1000,2000,0] | MagicBlock ER | [`5E3E1BEkzR9VdQxF…`](https://solscan.io/tx/5E3E1BEkzR9VdQxFB74RkJEwFEhcax2zUuPRbiyU3GXn3rwi22TmbMhSDsgxFBTD2JyYyBYfAfTaqUASgdGvFjWq?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: submit_stance — sealed hand weights [-2000,1000,0,3000] | MagicBlock ER | [`4y8zKrtXJB196PYU…`](https://solscan.io/tx/4y8zKrtXJB196PYUTjNnU4nMzxqGYUMRaJth1hWPZQgwAtdvNbTeDhPFrtru6jHLoY1i3oREucmibw4GZ8L7DUnp?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: submit_stance — pivot FLIP leg 3 → [3000,-1000,-2000,0] (max_rebalances=2 caps further moves) | MagicBlock ER | [`5ZuXyya19biVfBxN…`](https://solscan.io/tx/5ZuXyya19biVfBxNY9Lf2de8a6RpdPABCAfYXbUjPbDiE9hqU646uQz5fryoNLyQ2ZimjJ4BgD9sf3ABXaNcaHce?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: submit_stance — pivot SHIELD leg 2 → [0,1000,0,3000] (max_rebalances=2 caps further moves) | MagicBlock ER | [`4fEHPwXZitx9fwcs…`](https://solscan.io/tx/4fEHPwXZitx9fwcs9Q9x73rzLugLZpdz9CRk73PVWbxDasjU73uLtU75h1uE2abLTYCKsUahZcGpMMBfNKSfiPxC?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| request_settlement_vrf (MagicBlock VRF) | MagicBlock ER | [`4qbDtCvah367v5Hi…`](https://solscan.io/tx/4qbDtCvah367v5HiE95jcmWSP3fwwrXjfXX3Ut4UFhKVuoDTMj2apZVRgems6S5pkDk2pGsTnTCrFACH2dZSVNRw?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: trigger_showdown_unseal | MagicBlock ER | [`51QKaxGYmi24hrkm…`](https://solscan.io/tx/51QKaxGYmi24hrkmRJmhkgjBYC2XLeWVUgWvGdpLriVnNYWTUUUkix2J6GQoQvYYFbnJdCwkdM9o2zTSWigZgtjc?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: trigger_showdown_unseal | MagicBlock ER | [`2yGZJiEAdxJZD56a…`](https://solscan.io/tx/2yGZJiEAdxJZD56aatfAXkDT68477f6hvkCRyeJYxXRY8nRgjt1KCudEMnoj6xf5nhf74Spiu1zEZVow9FeqhjdU?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: evaluate_player_score (i128 1e9 fixed point) | MagicBlock ER | [`23wqb7sdjNJvgvNZ…`](https://solscan.io/tx/23wqb7sdjNJvgvNZEWQ1TfDH9UgmVXxqEZ3831AEbzFHuMvpbgSrotLGjdT6yTBvdmF6zyfYG6DPEAFe7hEySJTw?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: evaluate_player_score (i128 1e9 fixed point) | MagicBlock ER | [`5JrRpzfXMrBByVVR…`](https://solscan.io/tx/5JrRpzfXMrBByVVRQKEaoukJcDZAxcsYqmmnN5ojbXLhn3HLWgDGqwBPvyWfwKphv3z3y3LWAkYTunYfcCVfZkbh?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player A: undelegate_player_stance (commit → L1) | MagicBlock ER | [`4cf6z4h36GfDsysx…`](https://solscan.io/tx/4cf6z4h36GfDsysxSjM4iwgoZwT3DQZP28GYCKyUYoxmWUJ89HvrZqEkW9boUyTPTF7wNXkmUXCWTweHVivFWt5r?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| Player B: undelegate_player_stance (commit → L1) | MagicBlock ER | [`4gdN5dpdAhLmCVrS…`](https://solscan.io/tx/4gdN5dpdAhLmCVrSndbRhjaFgjmtMnBoYug6WzLyD2Rf5ekV2XsxrS1SdJKcKEqxycow58io9jH4xvyHDj9eBNjh?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| settle_and_commit_shard (commit + undelegate RoomShard → L1) | MagicBlock ER | [`4XUDfYKHsefRqHSG…`](https://solscan.io/tx/4XUDfYKHsefRqHSGokKjYEaLbNs6bsz7aMu5wLXGo22Vmir41CyQqoiDyPapTFNNjDQHj11bjMDk52V1ZNGumokQ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) |
| faucet: mint 100 test-USDC to each player ATA (relayer = mint authority) | Solana Devnet L1 | [`4fjtmrMDj4DxbUcc…`](https://solscan.io/tx/4fjtmrMDj4DxbUcc9z6Mw7X3T2itnjiC9rGLDFfDRWfyZtQyyAtDa4maZvonCYc3dfPk1GGoV9Qrj5Pf3Ugsoozv?cluster=devnet) |
| Player A: SPL stake 10 test-USDC → room escrow 4Rys34Gh47Rx543NMjb2ixDe8zVZ2oV77Hg8wuDkuWfJ | Solana Devnet L1 | [`4mLHwS3XTCSgUuXG…`](https://solscan.io/tx/4mLHwS3XTCSgUuXG6Ntu8XevhiystAPnXe2oZiyVnHz4LPQUd8vJVXkvMN8RW6BHHWo1FNhQ4hs4QR1kWw44uWHi?cluster=devnet) |
| Player B: SPL stake 10 test-USDC → room escrow 4Rys34Gh47Rx543NMjb2ixDe8zVZ2oV77Hg8wuDkuWfJ | Solana Devnet L1 | [`2AZtc2cbi7FvhELb…`](https://solscan.io/tx/2AZtc2cbi7FvhELb4fAbT3ze1mXrJVxCH7GqJAwDo9vLYkBuU6H9kYGNhUbhKyXVcAv1Jzzvn9K4kJkVAB8dU9qk?cluster=devnet) |
| settle: winner Player A (final_score 308348) paid 19800000 units + 200000 units (1%) → platformFeeAccount 6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8 | Solana Devnet L1 | [`2oTzABoin7Y48HKx…`](https://solscan.io/tx/2oTzABoin7Y48HKxMAneuuGeffB5cAFooiGMEmkiWaiZQbjdohh6FUJYdgKgt56L9Lziq1hreooqZRQsUNnShPKi?cluster=devnet) |
| Player A: cartridge_passport.record_elo_and_vault_credit (win, relayer = PassportConfig admin) | Solana Devnet L1 | [`59E2KXbrbNCDwHZK…`](https://solscan.io/tx/59E2KXbrbNCDwHZK36Bx2Zik2Ru4D5P2Nv6KFJnhFgkqgwRFZeBEd4zCw1WPX2y94nM9CkvsdfJwqJEWEKxAeCD9?cluster=devnet) |
| Player B: cartridge_passport.record_elo_and_vault_credit (loss, relayer = PassportConfig admin) | Solana Devnet L1 | [`4EL4EKCHEVLmSaMp…`](https://solscan.io/tx/4EL4EKCHEVLmSaMpmnQhPZei1fbQ8Mv1bYNuDdHUzAUiyjoipnPyqF887Hq9TmP9RbhsqMiCDzt2dUPj7R5CWxod?cluster=devnet) |
