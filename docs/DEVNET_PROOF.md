# CartridgeFi & Borel (#001) — Live Solana Devnet & MagicBlock ER Proof

**Execution Mode:** `CARTRIDGEFI_STANDALONE_DEV=false` (100% Live On-Chain Execution)  
**Verified Timestamp (UTC):** `2026-11-26T14:36:01.509Z`  
**Solana Devnet L1 RPC:** `https://api.devnet.solana.com`  
**MagicBlock Devnet Router:** `https://devnet-router.magicblock.app` (`https://devnet-us.magicblock.app` · Validator `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`)

---

## 1. Deployed Solana Devnet Program IDs & Binary Rent Audit

| Program | Devnet Address | Optimized `.so` Size | Permanent L1 Rent | Initial Deploy Signature |
| :--- | :--- | :---: | :---: | :--- |
| `cartridge_er_room` | [`Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR`](https://solscan.io/account/Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR?cluster=devnet) | `433,424 B` | `2.20350588 SOL` | [`3fyVCaTVZ6sG7Kxc…`](https://solscan.io/tx/3fyVCaTVZ6sG7KxcuhugKEzUsEm72Q1zydYX3afRk64z8N9E57wzr3gsSbqjqrboxDA5AconJkxeDUAPVsMVFEUh?cluster=devnet) |
| `cartridge_vault_router` | [`6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT`](https://solscan.io/account/6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT?cluster=devnet) | `373,232 B` | `1.89773052 SOL` | [`5Bv4UJaKp7gppFNJ…`](https://solscan.io/tx/5Bv4UJaKp7gppFNJANEfW1fgsMAtjizcyjx2CdPPZm3CwvWvEFcBjhxkB1JuGPFVJAXroA9n9CJKv1JDgTXqwqYM?cluster=devnet) |
| `cartridge_registry` | [`5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr`](https://solscan.io/account/5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr?cluster=devnet) | `188,752 B` | `0.96057212 SOL` | [`52rqwSYQ83sgFnH8…`](https://solscan.io/tx/52rqwSYQ83sgFnH81F3NzEQEYCiAQ1t4xjcTX6vkURiDR9zns5vv7Pqi5m3Eb52F7mEDc574WJ7nhtsJJVPGhcHE?cluster=devnet) |
| `cartridge_passport` | [`5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr`](https://solscan.io/account/5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr?cluster=devnet) | `182,040 B` | `0.92647516 SOL` | [`2RwsMquhEH9XtT27…`](https://solscan.io/tx/2RwsMquhEH9XtT27yu4NMGL79J6Hg3LNbDj1trLWMrU87Fm8bCdGbk141T4Y7Crk5tthwiTkqgeJzWjqyfRmm8JK?cluster=devnet) |

- **Total Permanent Rent Across All 4 Programs:** `5.98828368 SOL` (Peak Sequential Deploy Requirement: `6.91388508 SOL`, `0 SOL` stranded in buffers)
- **Compiler Release Profile (`Cargo.toml`):** `opt-level = "z"`, `lto = "fat"`, `codegen-units = 1`, `overflow-checks = true`

---

## 2. Live Protocol Accounts, Fee Vaults & MagicBlock Integrations

| Account / Integration | Live Devnet Pubkey | Verification |
| :--- | :--- | :--- |
| **Admin & Keeper Authority** | [`D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1`](https://solscan.io/account/D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1?cluster=devnet) | Signed config init, shard lifecycle & ELO settlement |
| **Protocol `EngineConfig` PDA** | [`Aeat6EKd8c6hp6unEB73VxBTRRp6cU87Eh6Y8jJChcGj`](https://solscan.io/account/Aeat6EKd8c6hp6unEB73VxBTRRp6cU87Eh6Y8jJChcGj?cluster=devnet) | `private_beta_mode = true` (`$500` room / `$5,000` global TVL cap) |
| **Explicit `platformFeeAccount`** | [`6eLQk7Y5YeZ1E3BwUYWVbD6PLpDffLzWZ3MPodQXVK8M`](https://solscan.io/account/6eLQk7Y5YeZ1E3BwUYWVbD6PLpDffLzWZ3MPodQXVK8M?cluster=devnet) | Received **`+5000000 micro-USDC`** on L1 settlement |
| **Creator `creatorFeeVault` (50% Split)** | [`Hrsv3zoNvPQi3kTMuy4KByWVx9d3NQdevTcxTdMZ68sB`](https://solscan.io/account/Hrsv3zoNvPQi3kTMuy4KByWVx9d3NQdevTcxTdMZ68sB?cluster=devnet) | Received **`+5000000 micro-USDC`** on L1 settlement |
| **Borel (`#001`) Manifest PDA** | [`64RnhRaWoy6aSE9bxE5oUtjbrLkEeRjqrim6x15WQwpF`](https://solscan.io/account/64RnhRaWoy6aSE9bxE5oUtjbrLkEeRjqrim6x15WQwpF?cluster=devnet) | `DirectionNeutralRelReturn` · `ConvictionWeights` |
| **Pulse Runner (`#002`) Manifest PDA** | [`EibkQeJ8ZZSeWgJKnsopCCr2r3vXuZDv2xScMqsPx24s`](https://solscan.io/account/EibkQeJ8ZZSeWgJKnsopCCr2r3vXuZDv2xScMqsPx24s?cluster=devnet) | `DrawdownPenalizedSharpe` · `ThreeLaneStance` |
| **Settled `RoomShard` PDA** | [`DBdAWGfVt1KBX7FJkzNi5n5MXVNdXhZe1uYyy7NXb5T2`](https://solscan.io/account/DBdAWGfVt1KBX7FJkzNi5n5MXVNdXhZe1uYyy7NXb5T2?cluster=devnet) | Delegated -> ER -> Committed & Undelegated back to L1 |
| **Settled `RoomVault` PDA** | [`36u1tBVCyCWumAmwDJenFWZWWHr9tp7KKxUGmRQCsveU`](https://solscan.io/account/36u1tBVCyCWumAmwDJenFWZWWHr9tp7KKxUGmRQCsveU?cluster=devnet) | `200,000,000 micro-USDC` pool settled; Winner paid **`126666667 micro-USDC`** |
| **MagicBlock Delegation Program** | [`DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`](https://solscan.io/account/DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh?cluster=devnet) | Real L1 delegation + `MagicIntentBundleBuilder` undelegation |
| **MagicBlock Permission Program** | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` | `CreateEphemeralPermissionCpi` -> `UpdateEphemeralPermissionCpi` -> `CloseEphemeralPermissionCpi` |
| **MagicBlock Pricing Oracle (`SOL/USD`)** | `ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu` | Verified live `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd` ER feed |
| **MagicBlock Ephemeral VRF Queue** | `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` | Fulfilled on-chain VRF seed `0x147d2dbf45ced03c5deb8d137f9b23a341ced692cb12cbbfab74a1ae5c452e4f` |

---

## 3. End-to-End Live Transaction Ledger (Solscan Devnet & MagicBlock ER)

| Lifecycle Step | Execution Layer | Live Transaction Link | Verification Details |
| :--- | :--- | :--- | :--- |
| 1a. Initialize EngineConfig & platformFeeAccount | Solana Devnet L1 | [`52WsXBxSq7H4FDbs…`](https://solscan.io/tx/52WsXBxSq7H4FDbs8fSP7tp2d5HWspW3SJ5ctJvM3Nbh6hWYVq5WQcFmDp9TXxzDYprk6tubUQ6t4N9Jt6rv1jLY?cluster=devnet) | EngineConfig PDA Aeat6EKd8c6hp6unEB73VxBTRRp6cU87Eh6Y8jJChcGj -> platformFeeAccount 6eLQk7Y5YeZ1E3BwUYWVbD6PLpDffLzWZ3MPodQXVK8M |
| 1b. Initialize PassportConfig | Solana Devnet L1 | [`2P8MnozYVphiSVyz…`](https://solscan.io/tx/2P8MnozYVphiSVyzB9exsVfNkvpM4wbaw3HUcyQyTioKjqNoc9zq9iVkYsLsQY5VXFvRZDvf6mjzPTcVM1MaBWg5?cluster=devnet) | PassportConfig PDA FE1CJpug9TyoTju4sjX2jFrNzL4wXopcVWUya77ZY96M |
| 1c. Register Borel (#001) Manifest | Solana Devnet L1 | [`mBeYHE2S4Dyq7amT…`](https://solscan.io/tx/mBeYHE2S4Dyq7amTsaCXDc3TwC1mWrR2EQbSPNDx67DQUK4n9Y7cTpnyTSgk1fPR2h9iSXfNhcwAqUaJcdXRp5g?cluster=devnet) | Borel Manifest PDA 64RnhRaWoy6aSE9bxE5oUtjbrLkEeRjqrim6x15WQwpF (50% creatorShareBps) |
| 1d. Register Pulse Runner (#002) Manifest | Solana Devnet L1 | [`2gdzSHWmYDjBR4sH…`](https://solscan.io/tx/2gdzSHWmYDjBR4sHrzVFQmPVNBUYryLy2mtfxg8vJnm6p3s4QcpdJVSUtSZivkLDRdnkc6zcRoYV3G4e6tcLnXx3?cluster=devnet) | Pulse Runner Manifest PDA EibkQeJ8ZZSeWgJKnsopCCr2r3vXuZDv2xScMqsPx24s (same parameterized engine) |
| 2a. Initialize Arena RoomShard + RoomVault | Solana Devnet L1 | [`32i9atjNQmZoHkKV…`](https://solscan.io/tx/32i9atjNQmZoHkKVQ544puYerDjbv1ppMtE33p9peS63YCQJrJYM3HbWy6KBZS9zQf9ooCAeJ4ULhZtFtzt8f62T?cluster=devnet) | RoomShard DBdAWGfVt1KBX7FJkzNi5n5MXVNdXhZe1uYyy7NXb5T2, RoomVault 36u1tBVCyCWumAmwDJenFWZWWHr9tp7KKxUGmRQCsveU |
| 2b. Fund 2 Players & Mint 100 USDC Each | Solana Devnet L1 | [`3LnZpjUL8pHzW84s…`](https://solscan.io/tx/3LnZpjUL8pHzW84sHxT2ufSzpqibUxX9ZVWrCXsp42PNW5nsU6qKfhRKmfmN7hPPB6RxB56xmeKzd1pm1Rk7a46R?cluster=devnet) | Player1=81gpQvkvGfP929gPLQjvR3AodS8oc7QKyEf7qq5q5gp8, Player2=EN8RuakFUhmtUuzmWpVrP3hHTaz1EXb5DKStpeNKJ72y; SessionKeys hold 0 SOL |
| 2c. Player 1 (Long Conviction) Open SessionEnvelope | Solana Devnet L1 | [`2ynq7Mp65djEHQLK…`](https://solscan.io/tx/2ynq7Mp65djEHQLKgunqYqxrD4tmJhmF3Awox2XzKNxSA5cdogUtBVRJC7grdCrZA9BLxmSfJhbLaD7b8ZBHxunt?cluster=devnet) | Envelope=5KEMt6ghiTu49RVgvYvpqwkMsbAYFhojNYHT1ZUeXLhd, EphemeralSessionKey=J6ePz3cKi5nDoT61kmpiJ1MAW7gCSLdhCVLBBLbhHJVR |
| 2c. Player 2 (Short Conviction) Open SessionEnvelope | Solana Devnet L1 | [`2G47ytzp9aM9PwJF…`](https://solscan.io/tx/2G47ytzp9aM9PwJF5sPQryB5cCNgfKXVim8MvfaTcdB1vz8aj9qxyLSrBAicWVGgHFBSfXh7socPscH3ExZXCDLy?cluster=devnet) | Envelope=HbBhNjJA4d57Hnf3hHRYFGYZYYo4B8iNKhhDucGzsNMM, EphemeralSessionKey=3UqoD4Xmk75yizvifQfQTL91ypUbHJ55urWWm8W5G6hb |
| 2d. Delegate RoomShard to MagicBlock ER | Solana Devnet L1 | [`5ixHm26ur2ynAE3Y…`](https://solscan.io/tx/5ixHm26ur2ynAE3YWKRg9jvLFKd7Hww7BDSdVuAv2JZ9L8eHqFN8Qnp6QRr9KYUydnH3wGzULCujv7x1rgbAsuSp?cluster=devnet) | Validator=MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd (https://devnet-us.magicblock.app) |
| 2e. Player 1 (Long Conviction) Init & Delegate PlayerStance | Solana Devnet L1 | [`4ki45D3ZPBvoeaQo…`](https://solscan.io/tx/4ki45D3ZPBvoeaQokVjMSM2JDvNfDdTR2cPes2yeEm776QG2qnBa8QQZdDXsawrgCATVccD6jNV6RgbHTGvg2vK8?cluster=devnet) | PlayerStance PDA HGY4eGyoepYUoXPwgzFgfcYHTXmmdo2Ae9YafUTGDURc delegated to DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh |
| 2e. Player 2 (Short Conviction) Init & Delegate PlayerStance | Solana Devnet L1 | [`51iaLEyoW18MPFkK…`](https://solscan.io/tx/51iaLEyoW18MPFkKFhsR2m1GuVxjKLnXcqWrEDyQWUiqvAgbP9NraDsG516mSYHGjCZ8GngFSTccSec4MMftyfuw?cluster=devnet) | PlayerStance PDA CmoQDNoweFzJBTcmChaoqPKgPmFxJ8UnXN8y4ahkUDzq delegated to DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh |
| 3a. Player 1 (Long Conviction) Join ER Room & Init EphemeralPermission | MagicBlock ER | [`4MZyqCawED9Q8YAs…`](https://solscan.io/tx/4MZyqCawED9Q8YAsq6XQY76i5FkfiiQFhhYXkFsCvqqkMXAEoPdt1Q524iq1AB546x89M3fN6KfmXMZACV7GFP3b?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Permission PDA GiYJhBzr2UaspgmZr6tBSbiKMABWKiyMR57WF6GZ2BXb under ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 |
| 3b. Player 1 (Long Conviction) Session-Key Stance #1 | MagicBlock ER | [`4xxJ1W2KGK1NyfN9…`](https://solscan.io/tx/4xxJ1W2KGK1NyfN9u1HFUoGXejw1KoJP3bEuJKkRUzWuWxFcVNHVpX1eKUwb9MJnJMiwvoVCvefzGurmHRZpKzwG?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Signed & paid solely by 0-SOL SessionKey J6ePz3cKi5nDoT61kmpiJ1MAW7gCSLdhCVLBBLbhHJVR via MagicBlock Router |
| 3c. Player 1 (Long Conviction) Session-Key Stance Shift #2 | MagicBlock ER | [`4UDp2vYPs7km9Fwz…`](https://solscan.io/tx/4UDp2vYPs7km9FwzkUgHTzp9psewD5YeNPuSdFpyiZqmRACqgM6VSvbD6aGS3LV3DrwAadsCt7G8pj1rLbcYuTiY?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Live rebalance #2 against MagicBlock Pricing Oracle ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu |
| 3a. Player 2 (Short Conviction) Join ER Room & Init EphemeralPermission | MagicBlock ER | [`2tvCnUBdUE8KJven…`](https://solscan.io/tx/2tvCnUBdUE8KJvenvndqSpJVcztHiwrKdKNzrS1CT5pPeh2NVTDfqf7HVvW18XMijAWF1CgeMx3vmt8UyYQ3xpMJ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Permission PDA D9md9sDNomsJYBrdXtwaCe4fkotKFg6grAVqzcR2nsfA under ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 |
| 3b. Player 2 (Short Conviction) Session-Key Stance #1 | MagicBlock ER | [`2VSqkAh41nG1yV53…`](https://solscan.io/tx/2VSqkAh41nG1yV53xFDQ3mgCg4kFfxSCxDGTu2BQHcmZwnApihULXonipvErLpKmURY2pfX1Xi78cxsQBUbagY3B?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Signed & paid solely by 0-SOL SessionKey 3UqoD4Xmk75yizvifQfQTL91ypUbHJ55urWWm8W5G6hb via MagicBlock Router |
| 3c. Player 2 (Short Conviction) Session-Key Stance Shift #2 | MagicBlock ER | [`n8FAWYZBuKsgicwb…`](https://solscan.io/tx/n8FAWYZBuKsgicwbab2j8crTsjzrrxFbRXLfSXH49Uyk8hzjHXt8Ph4R7QDrtnPChi15XAxnJrawJYTMN1MktH1?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Live rebalance #2 against MagicBlock Pricing Oracle ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu |
| 3d. Request Live MagicBlock VRF Randomness | MagicBlock ER | [`qh9tyUFXQ1qjeRda…`](https://solscan.io/tx/qh9tyUFXQ1qjeRda168ePCoc3PmXf1Jcq28pCWQcFRtD9kxz1VzL17Sf9ydVo5vDpQUnKuMgU9dLL7RXBW2Fg8L?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Delegated VRF Queue 5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc -> callback_settlement_vrf |
| 3e. Showdown Unseal (Player 1 (Long Conviction)) | MagicBlock ER | [`38WmQ6ooBpRXE342…`](https://solscan.io/tx/38WmQ6ooBpRXE342nhfbbm7fWWSCCi6qDJUXPt4W714R5YWYoCiPxSDEJ3mw8m8AknPCcHZ1iwJ57WkWwWSDNQXR?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Flipped EphemeralPermission is_private=false for final Showdown |
| 3e. Showdown Unseal (Player 2 (Short Conviction)) | MagicBlock ER | [`38i1SytU56caKtfd…`](https://solscan.io/tx/38i1SytU56caKtfdKUqHNscG2HjDnZnUvev74tsL33ZP97SnB3dmzbr6ixMEgDEx8Lug2YCSSfpx8gLZCNEsQRTr?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Flipped EphemeralPermission is_private=false for final Showdown |
| 4a. Evaluate Score (Player 1 (Long Conviction)) | MagicBlock ER | [`2mAbdwyS2QEt2Nic…`](https://solscan.io/tx/2mAbdwyS2QEt2NicHGr5y2ERmkKnbE7GFacB4YD4bc4GvtU4u3WRSPwWAibYskCYA7zRWc8Ti78K14NDX7QHGLhM?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Evaluated deterministic i128 (10^9) score & closed EphemeralPermission |
| 4a. Evaluate Score (Player 2 (Short Conviction)) | MagicBlock ER | [`3rVDEwEnofxs1Anf…`](https://solscan.io/tx/3rVDEwEnofxs1AnfS28iS2izy7cL4YRpX5ziyJ8tjVkdyjjBfzoV9DbA33nmqQ4wRhcNnKdtZiNcrprwJ4pJB3sp?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | Evaluated deterministic i128 (10^9) score & closed EphemeralPermission |
| 4b. Commit & Undelegate PlayerStance (Player 1 (Long Conviction)) | MagicBlock ER | [`3LTYa2ugC3kpurpo…`](https://solscan.io/tx/3LTYa2ugC3kpurpoHrX1UqjTvF2VtrdW1GfeS2jGfsGFdrFe7r9U2ZBThgEgjuf2wtmXrsxRH7jM3sZZJhLts7fm?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | MagicIntentBundleBuilder commit_and_undelegate -> Solana Devnet L1 |
| 4b. Commit & Undelegate PlayerStance (Player 2 (Short Conviction)) | MagicBlock ER | [`ZP8s8tv3vikoM518…`](https://solscan.io/tx/ZP8s8tv3vikoM518Gd7XDQ8cYd86imc7GUALMAawA7SQtBveP65GPqQ52yMCsW3dCQLKKVtBhqQeenmjKSWJNLt?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | MagicIntentBundleBuilder commit_and_undelegate -> Solana Devnet L1 |
| 4c. Settle & Commit+Undelegate RoomShard to L1 | MagicBlock ER | [`5AgBzbm2G9mvnBHZ…`](https://solscan.io/tx/5AgBzbm2G9mvnBHZ1V6UDKfN6USqaCWiGuQq597DSHphQdxhxGTArBTWPeiNG73nb81tY1MgrSXjHjMqKopGhsbw?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app) | MagicIntentBundleBuilder commit_and_undelegate RoomShard -> Solana Devnet L1 |
| 4d. Distribute Pool & Transfer Protocol Fees on L1 | Solana Devnet L1 | [`27epgjWWQroEEoRz…`](https://solscan.io/tx/27epgjWWQroEEoRzZSsFkcAv771KBoZQxVDJBcMoaoki3kjoSR2z2Tbe2GVhwZBZu3h1QqkQhk1xxAS7e6gW1LLQ?cluster=devnet) | Transferred protocol fee into platformFeeAccount (6eLQk7Y5YeZ1E3BwUYWVbD6PLpDffLzWZ3MPodQXVK8M) & creatorFeeVault (Hrsv3zoNvPQi3kTMuy4KByWVx9d3NQdevTcxTdMZ68sB) |
| 4e. Winner Claim Prize Payout on L1 | Solana Devnet L1 | [`k1x9H4Njyz4Qy7wP…`](https://solscan.io/tx/k1x9H4Njyz4Qy7wPb1s4KffW4THvmCEkbUhC99T27frR4kQwgC4Lc1pM68ga6EmEKrEtLmgxW5om7b6Gwd2UpHC?cluster=devnet) | Winner Player 1 claimed Harmonic Shapley payout into 34D8hQiostFTBqTu8qA81gqhenLnxyFSFv33SMFJBR1S |
| 4f. Update Winner Cross-Game Market Passport ELO | Solana Devnet L1 | [`rBzujn1JhsLPKgaY…`](https://solscan.io/tx/rBzujn1JhsLPKgaY6CGgPJZHeY1ujp4m4zgfz1Gp2Rgj5tXhGvdwuVramDAVHAkXryuApGJ95WdZPod6ayR5tED?cluster=devnet) | MarketPassport PDA 2o58gLDDhFbLZGhC6ck7v4xNDVfbp7PWobnwTSrM1JT2 updated on L1 |

---

## 4. Reproducing This Live Proof

```bash
CARTRIDGEFI_STANDALONE_DEV=false pnpm prove:devnet
```
