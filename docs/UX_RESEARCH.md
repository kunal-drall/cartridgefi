# Borel UX Research — what makes a market game feel like a game (2026-11-27)

Method: headless Chromium (Playwright, SwiftShader) screenshots at 1440x900 and 390x844 of each product, plus our own table in every phase. Screenshots live in `artifacts/ux/research/` (references), `artifacts/ux/before/` and `artifacts/ux/after/` (Borel). Sites that blocked bots or were offline were covered through web sources, cited inline. Nothing below is from memory.

## Pages studied

| Product | URL | Result |
| :--- | :--- | :--- |
| Crypto Fantasy League | https://cfl.fun | HTTP 402 "Deployment Paused" (both sizes). Used docs instead: [Rush mode](https://crypto-fantasy-league-1.gitbook.io/crypto-fantasy-league-docs/modes/rush), [Token squad](https://crypto-fantasy-league-1.gitbook.io/crypto-fantasy-league-docs/core-gameplay/token-squad.md), [Long/Short](https://crypto-fantasy-league-1.gitbook.io/crypto-fantasy-league-docs/core-gameplay/long-and-short.md), [Token Boost](https://crypto-fantasy-league-1.gitbook.io/crypto-fantasy-league-docs/core-gameplay/token-boost.md), [Colosseum page](https://colosseum.com/projects/explore/crypto-fantasy-league-(cfl)) |
| Polymarket | https://polymarket.com | Navigation timed out twice (bot wall). Used [avark.agency prediction-market patterns](https://avark.agency/learn/prediction-market-design-patterns), [SI review](https://www.si.com/prediction-markets/reviews/polymarket), [next.io app review](https://next.io/prediction-markets/polymarket/app/) |
| fomo | https://fomo.family | Captured. `fomo-*.png` |
| Hyperliquid | https://app.hyperliquid.xyz/trade | Captured. `hyperliquid-*.png` |
| pump.fun | https://pump.fun | Captured. `pumpfun-*.png` |
| Perps Rider (Blitz v6, 2nd) | https://perpsrider.com | Captured. `perpsrider-*.png` |
| HoldOut (Blitz v8, WC) | https://holdout.priyanshu.pro | Captured. `holdout-*.png` (`/play` is 404) |
| Ultra Pong (Blitz v8, 2nd) | https://ultra-pong.vercel.app | Captured. `ultrapong-*.png` |
| Hunch (Blitz v6, 3rd) | https://hunch.priyanshu.pro | Captured (nav-only shell). `hunch-*.png` |
| Blackout (Blitz v9, 2nd) | https://blackout.anshverma.tech | Captured (story intro, "headphones recommended"). `blackout-*.png` |
| Nightfall (Blitz v9, WC) | https://nightfall-blitz.vercel.app | Mobile captured; desktop screenshot timed out on WebGL |
| Battle Cities (Blitz v9, 1st) | https://magic.battlecities.com | Captured (Unity loader at 62%) |
| BlitzMine (v7, 1st), VeilMarket (v6, WC) | blitzmine.up.railway.app, veilmarket.vercel.app | 404, offline |
| Herd (Blitz v8, 1st) | no live URL in the results thread | Only source: [picked-off README table](https://github.com/IhorMuliar/picked-off) ("one question, 30 s, match the crowd; answers sealed in a private rollup") |
| Wordle | https://www.nytimes.com/games/wordle/index.html | Captured behind consent wall. Used [Wikipedia](https://en.wikipedia.org/wiki/Wordle), [NYT help](https://thenewyorktimeshelpcenter.helpjuice.com/360011158491-New-York-Times-Games/24611727334932-Wordle), [Game Developer interview](https://www.gamedeveloper.com/marketing/josh-wardle-reflects-on-the-the-unconventional-road-to-wordle-s-success) |
| Mobile poker | — | [PokerNews: vertical clients](https://www.pokernews.com/news/2020/03/vertical-poker-clients-36721.htm), [PokerNews: GGPoker squeeze](https://www.pokernews.com/news/2020/02/spin-gold-jackpot-sit-and-go-now-live-on-ggpoker-36707.htm), [PokerStrategy: time-bank bar](https://www.pokerstrategy.com/?p=42709), [PokerListings: GG final table](https://www.pokerlistings.com/news/impressive-final-table-features-at-ggpoker) |
| Game feel | — | [Tuts+ "Smoke & mirrors of good countdowns"](https://code.tutsplus.com/the-smoke-mirrors-of-good-countdowns-1--cms-28347t), [Apple HIG haptics](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/playing-haptics.json), [Juice it or lose it, GDC 2012](https://gdcvault.com/play/1016487/contactUs) |

## What the best ones do

**First 10 seconds.** Every game-like reference states the whole game in one line above the fold: HoldOut "How long can you hold? Ten players. One market. One pot." with one dark *Play a round* button; Perps Rider "Pick a market. Call long or short. Rev the engine… bank your position" with a full-width *Launch game*; Ultra Pong "Eight walls. Two lives. One survivor." plus a live match preview counting down "2 · GET READY". Herd's pitch is eleven words. None open with settings or telemetry.

**Primary action clarity.** One full-width, high-contrast primary per screen (Perps Rider's green *Launch game*, pump.fun's *Agree and continue*, fomo's *Download app*). Mobile poker clients put labelled Fold/Check/Bet buttons in the bottom thumb zone for one-handed play (PokerNews). Polymarket makes the outcome buttons visible straight from the feed card (next.io).

**Motion and tension.** Countdowns go yellow, then red, then bigger and flashing in the final seconds (Tuts+). PokerStars shows a running-down bar before the time bank starts. GGPoker lets players *squeeze* the river card "to increase the tension", with an 8–10 s reveal window. Ultra Pong's preview uses a big centred "2 · GET READY".

**Feedback.** Hyperliquid and pump.fun colour every delta and keep numerals tabular so ticks never move the layout. Polymarket's trade flow has *no* celebratory moment (avark.agency calls it a gap), which is an opening for us.

**Identity.** Ultra Pong gives every seat a colour chip and name (P1–P8) on the arena. fomo is built around leaderboards ("become a legend, top the leaderboard").

**Rewards and share loops.** Wordle's share is a header plus a colour grid, with no letters and no link ("if you throw up a link there it kind of looks crappy"). It opens the native share sheet on phones and falls back to "copied to clipboard" elsewhere. 1.2M results were shared on Twitter in 13 days (Wikipedia). CFL runs a "Share-to-Earn" boost (docs index).

**Sound.** Blackout opens with "headphones recommended". Game studios prototype the reveal sound first (snippet-level source, unverified). Apple: haptics should complement other feedback, stay consistent and be optional.

## Borel before (screenshots in `artifacts/ux/before/`)

- 390x844 draft: ~440 px of header, settings, phase guide and statebar sit above leg 1. Only one leg card fits above the sticky seal bar.
- While Pyth connects, the feed note under "Draft your hand" wraps to three lines, then collapses to one, and `error`/`connecting` badges flash next to market names. The leg cards jump under the thumb. This is the "missed leg taps" from the last recording.
- How-to sheet: six steps plus an example; on mobile the *Start playing* button is three screens down.
- At 00:00 on mobile the result hero renders above the viewport. The climax happens off-screen.
- Seal and unseal are plain state swaps. The clock only turns amber at 15 s.
- The receipt is a 1200x630 card shrunk to 358 px: unreadable on a phone. No native share. Buttons are 32 px.
- Muted text `#6b7280` on `#0a0d14` is 4.0:1 (fails AA). There are no focus rings. Mode/stake (32 px), Long/Short (40 px) and receipt buttons (32 px) are under 44 px.
- A leg at −0.0004 % prints `+0.000%` in red (sign taken from the raw score, text from the rounded one). ETH uses an "E" monogram.

## Top 10 gaps, ranked by impact

1. **The climax is off-screen on mobile.** The 00:00 unseal is the moment we want shared, and phones never see it.
2. **The draft moves under the thumb.** The feed note wraps and badges flash during the first seconds, so taps miss.
3. **The first 10 s don't say what the game is.** The table opens on settings; the rules are a long sheet with the CTA below the fold.
4. **Draft controls aren't thumb-sized or summarised.** Some targets are under 44 px, and the seal bar doesn't show what you're about to seal.
5. **No final-15 s tension.** A single colour change; no per-second pulse, no "10 / 5" call-outs.
6. **Seal has no ceremony.** Nothing says "your hand is now locked and hidden".
7. **Win/loss is ambiguous.** #1 and #6 look alike; there's no outcome stamp or tiered copy.
8. **The share card doesn't work on a phone.** Landscape, tiny text, no `navigator.share`.
9. **Rank changes are silent.** No feedback on your own move, nothing for screen readers.
10. **Polish and accessibility debt.** AA contrast, focus rings, the red `+0.000%`, ETH monogram, price-badge width changes.

## Fixes shipped (in rank order)

1. A full-screen **unseal sequence** at 00:00: the clock hits 00:00, a "Hands unsealed" beat, your rank counts in with a tier stamp (Took the table / Podium / Mid-table / Last seat) and the score. The page scrolls to the top so phones land on the result. Tap or Esc to continue. Reduced motion skips straight to the final frame.
2. A **stable draft**: the feed status is a fixed one-line slot, badges reserve their width, and prices use tabular figures in fixed-width boxes. Nothing above the leg cards changes height after load.
3. **One-line promise** on the table ("Call 3 markets. Hide your hand. Unseal at 00:00."). A compact mobile header puts mode and stake on one row. The How-to sheet is three steps with a sticky *Start playing* button.
4. **Thumb-ready draft**: all draft controls are 44 px or taller, 3x is labelled Sniper, and the sticky seal bar shows a live hand summary (e.g. `SOL ▲3x · BTC ▲2x · ETH ▼1x`) above a full-width *Seal hand*.
5. **Final-15 s tension**: the clock goes amber with a per-second pulse, then red with a larger pulse at 5 s. The progress bar pulses. A "Showdown in N" label appears. Screen readers hear 10 s and 5 s.
6. **Seal ceremony**: the cards flip to locked backs one by one and a "Sealed" stamp shows the commitment.
7. **Clear outcome**: the showdown hero is tiered and coloured (gold #1, green podium, neutral mid-table, red last), with "beat N of M seats".
8. **A share card that works on phones**: a square 1080x1080 card with a large spoiler-free glyph row, rank, score and room. *Share* uses `navigator.share` (the PNG file where supported, otherwise text), plus *Copy text* and *Download PNG*.
9. **Rank feedback**: your ladder row flashes green or red when you move, and a polite `aria-live` region announces "You moved up to #3".
10. **Polish and accessibility**: muted text raised to `#7d8590` (5.2:1), visible focus rings on every control, 44 px targets, the sign colour taken from the displayed rounding, and the official ethereum.org ETH diamond in `public/tokens/eth.png`.

**Next (not shipped):** opt-in sound (seal thunk, last-5 s tick, unseal chord) through WebAudio behind a mute toggle that starts off; Android haptics on seal and pivot taps; a GGPoker-style "squeeze" press-and-hold to reveal your own rank first.
