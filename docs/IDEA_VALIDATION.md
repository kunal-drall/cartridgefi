# Borel — Idea Validation (Colosseum Copilot, 2026-11-27)

Source: Colosseum Copilot v2 project search and project records (skill 2.2.0), queried 15:30 IST. Searches were winner-filtered first, then broadened. Project descriptions below are what the teams submitted; current product status was not re-verified.

## Verdict

**The real-time PvP market loop is no longer novel. The sealed hand is.** Borel clears the bar only if hidden information *is* the game: rivals see your rank move but never your legs, the single Pivot is a decision made against hands you can't see, and the 00:00 unseal is the moment that gets shared. Every UX and architecture choice below follows from that.

## (a) Closest precedents

| Project | Result | What it shipped | Lesson for Borel |
| :--- | :--- | :--- | :--- |
| [Crypto Fantasy League](https://colosseum.com/projects/explore/crypto-fantasy-league-(cfl)) | Breakout · 1st Place Gaming ($25k) | Draft a token squad, pick Long/Short, 5-minute PvP matches valued every 10 ms on **MagicBlock ER + Pyth**, permissionless on-chain finalization, bot-pairing fallback, 5% match fee | The closest match. "10 ms ER + Pyth + PvP" is table stakes now, so it can't be the pitch. Their bot fallback confirms cold-start is real. |
| [The Arena](https://colosseum.com/projects/explore/the-arena) | Radar · 2nd Place Gaming ($20k) | Head-to-head wagered trading matches ("first to 2x", 24 h) | Long matches with a wallet popup per step. Short rooms with zero-popup sessions are a real UX gap. |
| [Pythia](https://colosseum.com/projects/explore/pythia) | Cypherpunk · University Award ($10k) | Prediction market that uses privacy (Arcium) to stop trader herding | Judges reward privacy that changes market behaviour, not privacy as a feature checkbox. |
| Alpha Group Trading, WeLikeSports, Fora | Frontier winners / Cypherpunk 3rd Consumer | Group-chat trading, P2P sports pools, private group prediction markets | Distribution through friend groups works; Borel's receipt should drop into a group chat. |
| TEE/MPC poker (LePoker: Renaissance honorable mention; several 2026 Crypto World's Fair entries whose results aren't published in Copilot yet) | — | Hidden-hand card games on TEEs/MPC | Hidden-information-via-TEE is crowded *in poker*. Applying it to live market hands is the open lane. |

## (b) Weakest assumptions

1. **"Players want to hide positions to stop copy-trading."** In a 3-minute small-stake room nobody front-runs anyone. The defensible reason to seal is drama and reads (poker), not protection. Copy-trade defence only matters for large public tournaments, so it's a later-stage claim.
2. **Liquidity of people.** Rooms need concurrent players. CFL needed bot pairing. Borel must open instantly with clearly labelled pacer rivals and never pretend they're humans.
3. **Stakes and regulation.** Skill-scored outcomes on external prices do not automatically take wagering out of gambling or binary-options rules, and xStocks aren't offered to US persons. Paper-first by default; Devnet stakes are demo-only.
4. **Equity legs outside market hours.** Pyth equity feeds go stale when US markets are closed. Rooms must say so instead of scoring on stale prices.

## (c) Sharpest wedge

> **Fantasy trading with a hidden hand.** Everyone plays the same live window, nobody sees your three calls or where your 3x Sniper sits, and the table only learns who was right at 00:00.

Positioning against CFL: *their squads are public; Borel hands are sealed in a MagicBlock Private ER and revealed in one moment.*

## Adaptations applied to the build

- Lead the UI with the **sealed rank ladder** (rivals as face-down cards with live rank deltas), not with latency numbers.
- **Pacer rivals** run deterministic, labelled strategies on the same real Pyth prices to fill rooms (no randomness, no fake humans).
- **Sealing today vs. target:** the live app publishes a sha256 commitment memo on devnet and keeps the hand encrypted server-side until showdown. The full Private ER path (`submit_stance` under a Permission Program ACL) runs in `scripts/prove-live-devnet.ts`. Moving the live app onto it is the next engineering step.
- **One Pivot** is the core decision. It's shown as spent once used and is enforced server-side, because the deployed program doesn't cap updates (disclosed in `docs/DEVNET_PROOF.md`).
- **Paper by default**; Devnet rooms say exactly what is on-chain. No real-money wagering copy.
- **Equity legs** show `closed`/`stale` honestly; crypto legs are the default draft.
- **Spoiler-free Unsealed Hand Receipt** (outcome glyphs, rank, score, Solscan QR), built for group chats.

## Next uncertainty to test

Do players come back for a second room *because of the reveal*? Measure share-card taps and second-room starts per first room before adding modes.
