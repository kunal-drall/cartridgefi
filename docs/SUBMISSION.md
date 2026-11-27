# Borel — MagicBlock Submission

## 1. Project name

Borel

## 2. Project description

**What it does.** Borel is a real-time multiplayer market game: fantasy trading with a hidden hand. Every player in a room drafts three live market calls (LONG or SHORT across SOL, BTC, ETH, NVDAx and SPY) and places 1x, 2x and 3x conviction cards on them; the 3x card is a secret "Sniper". The hand is sealed. During the round, rivals see only a live rank ladder driven by real Pyth prices, never each other's picks. Each player gets one Pivot: flip a call or shield it to cash. At 00:00 every hand unseals, scores settle with integer fixed-point math, and the table learns who read the market best. Paper rooms are free practice against labelled bots; Devnet rooms run on-chain through a gasless relayer.

**How it uses MagicBlock.**
- **Ephemeral Rollups (Delegation Program `DELeGGv…`):** each room shard and player stance is delegated to a MagicBlock ER, so hand updates and pivots execute in milliseconds with no wallet popups (relayer-sponsored fees, per-room session keys).
- **Private access (Permission Program `ACLseo…`):** players join through `join_room_and_init_permission`, and sealed hands are written with `submit_stance` under per-player permissions, so nobody can read or copy a hand before `trigger_showdown_unseal`.
- **VRF:** `request_settlement_vrf` supplies the settlement randomness used for the deterministic tie-break.
- **Commit and undelegate:** `undelegate_player_stance` and `settle_and_commit_shard` return the settled room to Solana L1.

The full lifecycle has run live on devnet (links below). The web app's Devnet rooms already create and delegate rooms on-chain; their sealing step currently publishes a sha256 commitment and keeps the hand encrypted server-side until showdown, and moving it onto the private-ER `submit_stance` path is the next step.

## 3. Category

Games

## 4. Project website

https://cartridgefi.vercel.app (game) · https://cartridgefi.vercel.app/protocol (live on-chain inspector)

## 5. GitHub repository

https://github.com/kunal-drall/cartridgefi

## 6. Pitch and demo video

Pending render: `artifacts/borel-founder-pitch-demo.mp4` → public link added here.

## 7. Explorer links and integration proof

Full Borel room lifecycle on the Borel deployment (section 8), signed by the Borel relayer on 2026-11-27: 8 deployment/initialization transactions plus a 27-transaction room lifecycle (14 of them on the MagicBlock ER), every one listed in `docs/DEVNET_PROOF.md` ("Borel live run (own authority)"). Highlights:

| Step | Explorer |
| :--- | :--- |
| `register_cartridge` + `initialize_room_shard` | https://solscan.io/tx/3f5wZhUtC42pbjNEcYorraD5mqRY7SvN51UYpsQA43Jk98y2GPp4ksTnpfnrjA1t4GY7Zrd6NBC8qvGWFxKEzbCJ?cluster=devnet |
| `delegate_room_shard` → MagicBlock Delegation Program | https://solscan.io/tx/3UBBsBbhrowCL6M8TQpNZunmSK4hdYs3WXcRYqnjKUUh1d6Q3MjJd3BqE6yNEhsZvrsqrqrkxFCYEKqYuPCBRSSV?cluster=devnet |
| Private join `join_room_and_init_permission` (Permission Program, ER) | https://solscan.io/tx/3DMVyVjso3VuAbDLLPaVJsHDv1vLfowDvi28SmQ4ojaHcuBP8LPeztt4uiBaQoGtk47FD17U8rBatT1T1TwWHJcZ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app |
| Sealed hand `submit_stance` (ER) | https://solscan.io/tx/5E3E1BEkzR9VdQxFB74RkJEwFEhcax2zUuPRbiyU3GXn3rwi22TmbMhSDsgxFBTD2JyYyBYfAfTaqUASgdGvFjWq?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app |
| Pivot `submit_stance` FLIP (ER) | https://solscan.io/tx/5ZuXyya19biVfBxNY9Lf2de8a6RpdPABCAfYXbUjPbDiE9hqU646uQz5fryoNLyQ2ZimjJ4BgD9sf3ABXaNcaHce?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app |
| `request_settlement_vrf` — MagicBlock VRF (ER) | https://solscan.io/tx/4qbDtCvah367v5HiE95jcmWSP3fwwrXjfXX3Ut4UFhKVuoDTMj2apZVRgems6S5pkDk2pGsTnTCrFACH2dZSVNRw?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app |
| `trigger_showdown_unseal` (ER) | https://solscan.io/tx/51QKaxGYmi24hrkmRJmhkgjBYC2XLeWVUgWvGdpLriVnNYWTUUUkix2J6GQoQvYYFbnJdCwkdM9o2zTSWigZgtjc?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app |
| `evaluate_player_score`, i128 fixed point (ER) | https://solscan.io/tx/23wqb7sdjNJvgvNZEWQ1TfDH9UgmVXxqEZ3831AEbzFHuMvpbgSrotLGjdT6yTBvdmF6zyfYG6DPEAFe7hEySJTw?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app |
| `settle_and_commit_shard` → commit + undelegate to L1 | https://solscan.io/tx/4XUDfYKHsefRqHSGokKjYEaLbNs6bsz7aMu5wLXGo22Vmir41CyQqoiDyPapTFNNjDQHj11bjMDk52V1ZNGumokQ?cluster=custom&customUrl=https%3A%2F%2Fdevnet-us.magicblock.app |
| SPL stake, 10 test-USDC into room escrow | https://solscan.io/tx/4mLHwS3XTCSgUuXG6Ntu8XevhiystAPnXe2oZiyVnHz4LPQUd8vJVXkvMN8RW6BHHWo1FNhQ4hs4QR1kWw44uWHi?cluster=devnet |
| Settlement payout + 1% fee into `platformFeeAccount` | https://solscan.io/tx/2oTzABoin7Y48HKxMAneuuGeffB5cAFooiGMEmkiWaiZQbjdohh6FUJYdgKgt56L9Lziq1hreooqZRQsUNnShPKi?cluster=devnet |
| `record_elo_and_vault_credit` (passport ELO) | https://solscan.io/tx/59E2KXbrbNCDwHZK36Bx2Zik2Ru4D5P2Nv6KFJnhFgkqgwRFZeBEd4zCw1WPX2y94nM9CkvsdfJwqJEWEKxAeCD9?cluster=devnet |
| Live app relayer `lock` (production, earlier deployment) | https://solscan.io/tx/374vJPvC6hW7ZBemsdmU9VNDk5HtDejsEiFg16grJb412LimcTpDvVo125asvMy8tkdaUD5Z99rJhPGuGB1fp1Qa?cluster=devnet |

Note: in this run the stake escrow and payout are SPL transfers from a relayer-held escrow; routing them through `cartridge_vault_router`'s own payout instructions is next. An earlier 21-transaction run on the 2026-11-26 deployment is also in `docs/DEVNET_PROOF.md`.

## 8. On-chain addresses (Solana devnet)

**Borel deployment (2026-11-27, own authority).** Upgrade authority, EngineConfig admin, PassportConfig admin and mint authority are all the Borel relayer `Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg` (verified on-chain).

| Account | Address |
| :--- | :--- |
| Program `cartridge_er_room` | [`DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W`](https://solscan.io/account/DDZt6hCBapvBuUMcQipQip2TT2keVuLCsmdFzhG7771W?cluster=devnet) |
| Program `cartridge_vault_router` | [`Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR`](https://solscan.io/account/Db58xzW5iaYdZABeRRpds3UrvYQyRQSRAkPTHdypFuUR?cluster=devnet) |
| Program `cartridge_registry` | [`BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc`](https://solscan.io/account/BXbbMC5nLzYqMPvty73S9v4G5V3nCjGWkvqRRWAAmdKc?cluster=devnet) |
| Program `cartridge_passport` | [`B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF`](https://solscan.io/account/B9ctvYvbegGf5rDAwufAzjNbiAyH147MS7WkpohC9SMF?cluster=devnet) |
| Test-USDC mint (6 dp) | [`32CRMQ5gBzDv45kAKXVNLb7qfvoPAxRNp6dnnhkUnRtw`](https://solscan.io/account/32CRMQ5gBzDv45kAKXVNLb7qfvoPAxRNp6dnnhkUnRtw?cluster=devnet) |
| `platformFeeAccount` (fee vault, SPL ATA) | [`6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8`](https://solscan.io/account/6LU5nN8fAbezBnsx8nLhAxvnY7KJc697fLW67qUnfrn8?cluster=devnet) |
| EngineConfig PDA | [`7NE1vxxMpPNBTmY9b22fbZ2gkP9vEDc3ck35T5aNqZin`](https://solscan.io/account/7NE1vxxMpPNBTmY9b22fbZ2gkP9vEDc3ck35T5aNqZin?cluster=devnet) |
| PassportConfig PDA | [`DHhQBaL5ybFbWrRvTjhk95wsgpW23oNUQ8SQ5wn6vVpn`](https://solscan.io/account/DHhQBaL5ybFbWrRvTjhk95wsgpW23oNUQ8SQ5wn6vVpn?cluster=devnet) |
| Borel relayer wallet (fee payer, authority) | [`Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg`](https://solscan.io/account/Fc54gfodfqwq8QZe8M1Zy5ARYdYE7skRynVJGA4UYmWg?cluster=devnet) |
| MagicBlock Delegation Program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| MagicBlock Permission Program | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` |

**Earlier deployment (2026-11-26).** Used by the 21-transaction live run linked in section 7: `cartridge_er_room` `Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR`, `cartridge_vault_router` `6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT`, `cartridge_registry` `5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr`, `cartridge_passport` `5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr`, RoomShard `Gd3Q9c7wUU5JqfFC5TJi5xPRAdpLjbRrKZiB9YTWQR1k`.
