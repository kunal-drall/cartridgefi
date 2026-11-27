# MagicBlock Solana Blitz: Winners by Round, Winning Patterns, and What Borel Should Do

Researched 2026-11-27 (IST). Every claim below comes from a page that was opened during this research, listed under Sources at the end. Where a round's winners could not be found, the table says **not found** and names the places that were checked.

**Primary source.** MagicBlock posts each round's results as a thread on X (@magicblock). The thread text was read through the public FxTwitter mirror (`api.fxtwitter.com/2/thread/<id>`), which returns the original posts verbatim. Each winner post follows the same pattern: a one-line description of the project and one line on which MagicBlock primitive does what. Most posts also carry a live link and an attached demo video, and v1–v7 posts usually add a GitHub link.

**Numbering.** MagicBlock counts from **v0**. The v9 results thread says "385+ projects built with MagicBlock across ten Blitz editions", meaning v0 through v9. **v10** ("Entertainment Finance") began on Nov 20, 2026, runs for a week, and had no results when this was written.

## Series at a glance

| Round | Results date (UTC) | Theme / format | Submissions | Prizes (USDC) | Winners found? |
|---|---|---|---|---|---|
| v0 | ~Feb 2026 | Weekend; launch edition | 30 | not found | **not found** |
| v1 | 2026-03-17 | Weekend; "real-time and private apps" | 30 | 700 / 400 / 300 / 100 | Yes |
| v2 | ~late Mar 2026 | Weekend; privacy apps | 40 | not found | **not found** |
| v3 | 2026-04-10 | Weekend; open theme | 40 | 500 / 250 / 150 / 100 | Yes |
| v4 | 2026-05-01 | Weekend; **Agentic** (1st reserved for "best agentic build") | 32 | 500 / 250 / 150 / 100 | Yes |
| v5 | 2026-06-22 | Weekend; **Trading** (1st reserved for "best trading build") | 34 | 500 / 250 / 150 / 100 | Yes |
| v6 | 2026-07-17 | Weekend (Jul 10–12); **Mobile**, with Solana Mobile and Blueshift | 41 | 500 / 250 / 150 / 100 | Yes |
| v7 | 2026-08-15 | First full week; **Collaboration** | 65 | not stated on pages read | Yes |
| v8 | 2026-09-17 | One week; "Global Startup Village", with Superteam MY/IE/NL | 36 | not stated on pages read | Yes |
| v9 | 2026-10-15 | One week; Crypto World's Fair edition alongside Colosseum's hackathon | 55 | not stated on pages read | Yes |
| v10 | in progress (kickoff 2026-11-20) | One week; **Entertainment Finance** | n/a | 500 / 250 / 150 / 100 | No results yet |

**Judging criteria stated by MagicBlock**
- v1 results thread: "These winners were selected based on **depth of integration, creativity, and polish**."
- v3 Luma page: "Projects will be judged on **creativity, technical quality, and how meaningfully they use MagicBlock's infrastructure**."
- Eligibility rules: v1 required "either MagicBlock's ephemeral rollup or private ephemeral rollup", v3 said "All submissions must integrate MagicBlock's Ephemeral Rollup", and v4 and v5 said "Any project using Ephemeral Rollups or Private ERs is eligible for all other prizes."
- Third-party summary (devrels.xyz): "Judging weights creativity, technical depth, and how clearly the project shows what only real-time Solana can do."
- The v10 Luma page states no judging criteria.

Abbreviations: **ER** = Ephemeral Rollup, **PER** = Private Ephemeral Rollup (TEE / Intel TDX), **VRF** = MagicBlock VRF, **WC** = Wizardio's Choice.

---

## v0 (Feb 2026): winners not found
- **Known:** 30 submissions. The v2 post says "up from 30 in the last two", and Solana Compass reports "30 at v0". The May 19 retrospective tags several projects as "Blitz v0", including MagicCraft, Cayed, Pixel Wars, Dark Trades and Hyperbiscus. It does not say whether any of them placed.
- **Where I looked:** MagicBlock blog (january2026-recap has no Blitz content; february2026-recap returns 404), build.magicblock.app (home, /builders, /champions), Luma, web searches (standard and extended), and Solana Compass.

## v1 (results 2026-03-17): 30 projects
Results thread: https://x.com/magicblock/status/2033920649400594876

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **TaskForest** (@task_forest) | Trustless task marketplace where humans and AI agents post bounties, with payment through onchain escrow | ER: "sub-50ms bids" run on ERs, then escrow and payout settle on Solana | taskforest.xyz · github.com/jimmdd/taskforest-protocol |
| 2nd | **Blockrooms** (@0xrguha) | Backrooms-inspired onchain FPS: find real enemies among decoys | ER: game sessions delegated for gasless, low-latency play | block-rooms-frontend.vercel.app · github.com/bruhhgnik/BlockRooms-Frontend |
| 3rd | **Magic Hide and Seek** (@nevvdevv) | Onchain prop hunt | ER: positions and rotations commit in real time; "raycast is verified inside the ER program" | github.com/JustAnotherDevv/Magic-HideAndSeek |
| WC | **Soliton** (@alfrican) | Rule 110 cellular automaton running fully onchain as a shared world | ER: state evolves without mainnet fees | github.com/Alfie/soliton |

**Why these won.** MagicBlock named "depth of integration, creativity, and polish." Three of the four winners are real-time multiplayer games or worlds in which the core loop itself runs in the ER, not just settlement.

## v2 (~late Mar 2026): privacy theme, 40 projects; winners not found
- **Known:** The March recap says v2 was "focused on privacy apps" and drew 40 submissions, and that winners were announced. The post it links (status 2037192368160485827) is the submissions tally, which says "Winners dropping soon". The retrospective tags **WHO RUG US?** (social-deduction game, match state in ER) and **Loofta Pay** (Venmo-style private payments) as "Blitz v2" projects. It does not say whether either placed.
- **Where I looked:** march2026-recap, the full FxTwitter thread of the v2 tally post, web searches (standard and extended), build.magicblock.app, and devrels.xyz.

## v3 (results 2026-04-10): open theme, 40 projects
Results thread: https://x.com/magicblock/status/2042616236304163129

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **privRoll** (@ajeeshRS_) | Private bulk payroll with "zero custom smart contracts" | PER via the Payment API; recipients withdraw custom amounts to hide total income | privroll.getprod.xyz · github.com/ajeeshRS/privRoll |
| 2nd | **Expensee** (@devsh_) | Real-time private salary streaming | TEE/PER: salary accrues in "sub-10ms ticks", then settles to Solana | expensee-seven.vercel.app · github.com/shumhn/Expensee |
| 3rd | **GhostPay** (@0xmeett) | Full payroll: batch transfers, multi-currency FX, approval gates, private payslips, and a "Privacy Proof Panel" | PER: "Public audit receipt onchain, private everything else" | ghostpayy.vercel.app · github.com/mitgajera/ghostpay |
| WC | **Confidential Desk** (@priyansh_ptl18) | Confidential lending | ER for lend/borrow/repay; Private Payments to shield and unshield balances | confidential-desk.priyanshpatel.com · github.com/priyanshpatel18/confidential-desk |

**Why these won.** MagicBlock: "The strongest submissions all leaned into private payments and DeFi… privacy is becoming the most requested primitive." GhostPay also put a visible **privacy proof** in its UI.

## v4 (results 2026-05-01): Agentic, 32 projects
Results thread: https://x.com/magicblock/status/2050198656511562095

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **Forge** (@OxCryptoQueen) | Private payment layer for AI agents to discover, compare and pay for services | Private Payments API: amounts and counterparties hidden | forgeprivacy.vercel.app · github.com/WorldsBestSoftwareDeveloper/forge |
| 2nd | **kestrel** (@priyansh_ptl18, "3-time Blitz winner") | Policy-bound AI trading agents on short BTC markets | ER: markets and agents delegated for high-cadence trading | kestrel.priyanshpatel.com · github.com/priyanshpatel18/kestrel-labs |
| 3rd | **Sealdex** (@acetaminofenol) | Sealed-bid auction in which AI agents bid on graded collectibles | PER: "Bids stay encrypted in Intel TDX hardware, only the winner surfaces back to Solana" | sealdex.fly.dev · github.com/0xNoramiya/sealdex |
| WC | **Whisper Exchange** (@shroomsgotsol) | Marketplace where AI agents sell information to each other | ER: buyer identity and price hidden until settlement | whisper-exchange.vercel.app · github.com/shrooms08/whisper-exchange |

**Why these won.** First place was reserved for the theme. MagicBlock: "every winning project actually pushed onchain agents forward." Sealdex is an early example of the **sealed-until-settlement** pattern.

## v5 (results 2026-06-22): Trading, 34 projects, partner FlashTrade
Results thread: https://x.com/magicblock/status/2069073796733243637

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **Ghost Stops** (@Magicianafk) | Onchain trailing stops, OCO and bracket orders on FlashTrade V2 perps | ER: the trigger "recomputes every price tick on an ER, then settles to Solana" | ghoststops.magician.wtf · github.com/Magicianhax/ghost-stops |
| 2nd | **Eclipse** (@devsh_) | Privacy-preserving prediction market | ER: positions "virtual and private inside an ER, zero gas, no front-running", settled at resolution | eclipse-predict.vercel.app · github.com/shumhn/Eclipse |
| 3rd | **Shear** (@priyanshudotsol) | Relative-value perps: long SOL / short ETH as one market-neutral position on the SOL/ETH ratio | Oracle-priced fills against a shared USDC pool (the thread does not name a specific MagicBlock primitive) | shear.priyanshu.pro · github.com/priyanshudotsol/Shear |
| WC | **EPOCH** (@NisargPatel5563) | Real-time prediction market, with one ER session per market | ER plus **Magic Actions** for "atomic settlement to Solana mainnet on resolve" | epoch-solana.vercel.app · github.com/nisargpatel7042lva/EPOCH |

**Why these won.** First place was again reserved for the theme. MagicBlock singled out "perp order types, private prediction markets, market-neutral pairs, ER-as-market designs." The winner integrated with a real venue (FlashTrade), and its ER does per-tick price work.

## v6 (Jul 10–12; results 2026-07-17): Mobile, 41 apps
Results thread: https://x.com/magicblock/status/2078122325632028817

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **CapturGO** (@ko_bit_fetch) | Private location-to-earn on Solana Mobile. Solana Compass says it is already live on iOS and Android, with a HERE Technologies partnership | PER: claims route through a PER, so amounts and recipients stay hidden | capturgo.com · github.com/CapturGo/capturgo-magicblock |
| 2nd | **Perps Rider** (@YordanSOL) | Mobile arcade trading game: rev a tachometer to set leverage, and live Pyth prices drive the race | ER for positions; **VRF** opens crates; Pyth (Lazer, per Solana Compass) | perpsrider.com · github.com/EchoWebLV/perps-games |
| 3rd | **Hunch** (@priyanshudotsol, "2-time Blitz winner") | Stake-and-climb fruit-slicing game | ER: every slice is signed from the phone; rows resolve on **VRF** | hunch.priyanshu.pro · github.com/priyanshudotsol/Hunch-magicblock |
| WC | **VeilMarket** (@usainbluntmx) | Private real-time World Cup 2026 prediction markets | ER (gasless bets), PER (hidden stakes), **VRF** resolution | veilmarket.vercel.app · github.com/usainbluntmx/veilmarket |
| Honorable mention | **Loofta Pot** (@lisabeyy) | Private lottery for Solana Mobile | PER | pay.loofta.xyz · github.com/lisabeyy/loofta-pot-mobile |

**Why these won.** The winners are mobile-native and game-like, and they stack primitives (ER + VRF, ER + PER + VRF). First place went to a product that already had distribution and added PER privacy to it. Second place was a **trading game driven by live Pyth prices**, the closest prior winner to Borel's ladder.

## v7 (results 2026-08-15): Collaboration, first full-week format, 65 projects
Results thread: https://x.com/magicblock/status/2088638385938428281

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **BlitzMine** | Real-time mining game: back tiles on a 5x5 grid with SOL, and one tile wins the pot | ER; winning tile picked by **VRF** | blitzmine.up.railway.app · github.com/Monti-27/BlitzMine |
| 2nd | **Tenor** | Private multi-dealer FX RFQ for USD/INR: "five dealers quote blind, and the best price wins" | PER: quotes hidden; the fill settles publicly on Solana | tenor-beryl-beta.vercel.app · github.com/Shaurya2k06/tenor |
| 3rd | **Oobe Protocol** | Open-source MCP server that gives AI agents native Solana tools | ER, Private Payments and VRF exposed as agent tools | mcp.sap.oobeprotocol.ai · github.com/OOBE-PROTOCOL/sap-mcp |
| WC | **Loofta Rip Room** (@lisabeyy, @devsh_) | Pooled pack game: VRF cuts players, survivors vote each other down, and the last ones split the pot | ER for live room state; VRF | loofta.xyz |

**Why these won.** A simple pot game with a visible random draw took first. Second went to a **blind sealed-quote mechanic** in which the best hidden entry wins.

## v8 (results 2026-09-17): "Global Startup Village", 36 projects from 11 countries
Results thread: https://x.com/magicblock/status/2100585652639371341 · all v8 submissions: https://build.magicblock.app/builders?view=submissions&event=13

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **Herd** (@dezloperr) | Party game for Solana Mobile: "one question, 30 seconds, match the crowd or get cut" | PER: "Answers stay sealed in a Private Ephemeral Rollup"; tables and the coin flip decided by **VRF** | demo video in the results thread (no URL given) |
| 2nd | **Ultra Pong** (@KshitijGajapure) | Eight-player survival Pong in which the arena shrinks | ER: physics at "20 ticks per second"; seeded by **VRF** | ultra-pong.vercel.app |
| 3rd | **Alerith** (@xTrinks) | 3D medieval MMORPG, "three years in the making" | ER: duel arena at "sub-50ms"; loot rolls on **VRF** | alerith.com |
| WC | **HoldOut** (@priyanshudotsol, "3-time Blitz winner") | Hold-or-fold game: fold early and pay a toll, or hold to the bell and split the pot | ER rounds; custody stays on Solana | holdout.priyanshu.pro |

**Why these won.** First place is **structurally the closest prior winner to Borel**: a short timed round, sealed player choices in a PER, a VRF tie-break or coin flip, and a crowd-relative outcome, all on mobile.

## v9 (results 2026-10-15): Crypto World's Fair edition, 55 projects from 21 countries
Results thread: https://x.com/magicblock/status/2110732733379162267 · all v9 submissions: https://build.magicblock.app/builders?view=submissions&event=15

| Place | Project (builder) | What it is | MagicBlock primitives | Links |
|---|---|---|---|---|
| 1st | **Battle Cities** (@CryptoSodi) | Real-time tank combat built in Unity | **VRF** for power-up types and spawn spots, "every drop fair and auditable" | magic.battlecities.com |
| 2nd | **Blackout** (@Anshv7845) | Fog-of-war battle royale: enemy positions, loot and future zones "stay sealed until the match ends" | PER sim at "20 ticks/s"; spawns and zones seeded by **VRF** | blackout.anshverma.tech |
| 3rd | **NoirWire** (@_Noirwire_) | Private order book for perps and spot: resting orders hidden, fills public | PER for matching, margin and liquidations; "4.3ms median order on devnet" | noirwire.com |
| WC | **Nightfall** (@codeswithroh) | Battle royale where "you only see what your torch lights" | PER: positions "even the server can't read", gasless moves at ~100ms | nightfall-blitz.vercel.app |

**Why these won.** Polished real-time games took first. Three of the four winners are **hidden-information** builds on PER (fog of war, sealed orders), and each states a measured latency or tick rate.

## v10 (kickoff 2026-11-20, one week): Entertainment Finance, in progress
- Luma page theme: "Entertainment Finance: apps where you trade, collect, compete and win assets you actually own, with game mechanics on top." Builders may use "anything in the MagicBlock stack", and the page highlights "zero-fee transactions, VRF and privacy." Submissions go through build.magicblock.app. Prizes are 500 / 250 / 150 / 100 USDC. No judging criteria and no winners are listed.
- MagicBlock's Entertainment Finance blog post defines the category as "consumer applications that combine financial ownership, speculation and game mechanics". Its open areas include "prediction markets, social trading, **trading competitions**, skill games with prize pools". It names ER (10 ms blocks, free transactions), Private ER ("encrypted in trusted hardware, while every result stays verifiable"), VRF ("under 10 milliseconds, with a proof anyone can check onchain") and the MagicBlock Price Feed.

---

## Synthesis: strategies that won Blitz rounds most consistently

Base set: 32 placed entries (1st, 2nd, 3rd and WC) across the 8 rounds with known results (v1 and v3–v9), plus one honorable mention.

1. **Make the MagicBlock primitive the game mechanic, not the plumbing.** "Depth of integration" is the one criterion MagicBlock states explicitly. The winners put the core loop inside the ER or PER: bids, raycasts, per-tick stop triggers, 20-tick physics, matching engines, sealed answers. Builds that only settle through an ER did not take first.
2. **Use the sealed-until-reveal pattern on a Private ER.** It is the most repeated winning design from v4 on: Sealdex (v4, 3rd), Eclipse (v5, 2nd), VeilMarket (v6, WC), Tenor (v7, 2nd, "quote blind, best price wins"), **Herd (v8, 1st, "answers stay sealed")**, Blackout (v9, 2nd, "sealed until the match ends"), NoirWire (v9, 3rd) and Nightfall (v9, WC). 14 of the 32 placed entries explicitly use PER, TEE or Private Payments (15 if Eclipse's "private inside an ER" is counted), and MagicBlock said in v3 that "privacy is becoming the most requested primitive."
3. **Stack VRF on top.** VRF first appears in a winner blurb in v6, then shows up in 11 of the 16 placed entries from v6 to v9 and in all four of the v7–v9 first and second places except Tenor. MagicBlock's blurbs call it out as "fair and auditable."
4. **Back it with a measured number.** Nearly every blurb includes a figure: "sub-50ms bids", "sub-10ms ticks", "every price tick", "20 ticks per second", "4.3ms median order on devnet", "~100ms". MagicBlock's own Entertainment Finance pitch uses the same language (10 ms blocks, VRF under 10 ms). "Show what only real-time Solana can do" is concrete, not rhetorical.
5. **Ship a real-time multiplayer game with polish, ideally on mobile.** Games won 1st in v7, v8 and v9 and dominated v1. Mobile was the theme in v6, and v8's winner (Herd) was built for Solana Mobile. "Polish" is a stated criterion, and most winner posts carry a demo video (sometimes the team's own clip) plus a live URL.
6. **Fit the round's theme exactly.** In v4 and v5, first place was reserved for the theme ("best agentic build", "best trading build"), and v5's winner also integrated a real venue (FlashTrade). For v10 the theme is Entertainment Finance, and "trading competitions" is listed by name.
7. **Show a real product, distribution and a repeat-builder track record.** CapturGO (v6, 1st) was already live on iOS and Android with a HERE partnership, and Alerith (v8, 3rd) was "three years in the making." Repeat winners recur (priyanshudotsol 3x, priyansh_ptl18 3x, devsh_ 3x, lisabeyy), all with polished live deployments and public repos. MagicBlock also presents Blitz as the entry point to Forge and its Hacker House, so a team that can show it will keep building is a plus.

## Implications for Borel (sealed 3-leg market hands in Private ER rooms, live rank-only ladder on Pyth, one pivot, VRF tie-break, unseal at 00:00)

Borel combines the three strongest winning ingredients: the PER sealed-reveal of Herd, Blackout and Tenor, live Pyth prices as in Perps Rider, and VRF fairness as in BlitzMine and Battle Cities. It also matches v10's "trading competitions" wording. The pitch has to *prove* each of these on screen, not just claim it.

**What the 3–4 minute video should emphasize**
1. **0:00–0:20: a hook in MagicBlock's tweet format.** One line: what Borel is, plus one line on which primitive does what, with a number. Model it on Herd's "one question, 30 seconds, match the crowd or get cut." For example: "Build a 3-leg market hand. Nobody can see it, not even us. Live rank on Pyth, one pivot, unseal at 00:00." The first seconds are what MagicBlock is likely to clip into its winner post.
2. **Prove the seal.** Show two players side by side. Player B's screen and a public-RPC or explorer read of the room account show **nothing readable** while the clock runs, and only the rank moves. Then show the 00:00 unseal moment as the climax. GhostPay's "Privacy Proof Panel" and Herd's sealed answers show that MagicBlock rewards making privacy *visible*.
3. **Show the real-time numbers on screen.** Overlay measured devnet figures: ladder update cadence on Pyth ticks, pivot confirmation latency in the ER, VRF fulfilment time with a link to the onchain proof, and zero fees per action. Use only numbers we measured ourselves; winners quote real devnet figures, such as "4.3ms median order on devnet."
4. **Make the VRF tie-break a visible moment.** Show who tied, the VRF request and the proof link, framed as "fair and auditable" (MagicBlock's own wording for Battle Cities).
5. **Show game feel and mobile.** Film at least one full round on a phone-width (390px) viewport with several live players, and show the countdown, pivot and reveal as gameplay rather than dashboard screens. Polish and mobile won v6 and v8.
6. **Close with Entertainment Finance and the Forge path.** Use MagicBlock's own words ("trade, compete and win assets you actually own"), the live URL and the repo. Keep the story to the single game. Leave the wider CartridgeFi engine out of the video, because every winning blurb describes one concrete product.

**What the submission should include**
- A live URL (https://cartridgefi.vercel.app), a **public GitHub repo** and a short demo video. Winner posts typically link a live app and a video, and most v1–v7 posts also link a GitHub repo.
- A two-line description written in the winner format: line 1 is what the game is; line 2 is "Hands stay sealed in a MagicBlock Private Ephemeral Rollup, the ladder runs on an Ephemeral Rollup off Pyth prices, ties broken by MagicBlock VRF."
- Devnet transaction or account links for delegation, the sealed hand, the pivot, the VRF request and fulfilment, and the commit/undelegate at unseal.

**Primitives to showcase, in order of visibility**
1. **Private Ephemeral Rollup (TEE)**: the headline. Sealed hands with a provable reveal is the most repeated winning pattern and Borel's core mechanic.
2. **Ephemeral Rollup real-time loop**: the live rank-only ladder on Pyth and the instant, gasless pivot. Quote the tick rate.
3. **VRF**: the tie-break, with its proof shown. It appears in most v6–v9 winners.
4. **Supporting only**: session keys for popup-free play, and Magic Actions or commit for settlement. EPOCH (v5, WC) was credited for Magic Actions settlement, but session keys were not credited in any placed winner's blurb; the only mention found is Hyperbiscus in the retrospective, which is not tied to a placement.

---

## Sources (all opened during this research)
- MagicBlock results threads on X, read verbatim through the FxTwitter mirror `api.fxtwitter.com/2/thread/<id>`:
  - v1: https://x.com/magicblock/status/2033920649400594876
  - v2 submissions tally (not winners): https://x.com/magicblock/status/2037192368160485827
  - v3: https://x.com/magicblock/status/2042616236304163129
  - v4: https://x.com/magicblock/status/2050198656511562095
  - v5: https://x.com/magicblock/status/2069073796733243637
  - v6: https://x.com/magicblock/status/2078122325632028817
  - v7: https://x.com/magicblock/status/2088638385938428281
  - v8: https://x.com/magicblock/status/2100585652639371341
  - v9: https://x.com/magicblock/status/2110732733379162267
  - "10 coolest apps" retrospective, v0–v4 (May 19, 2026): https://x.com/magicblock/status/2056763119041728841
- MagicBlock blog recaps: https://www.magicblock.xyz/blog/march2026-recap · https://www.magicblock.xyz/blog/april2026-recap · https://www.magicblock.xyz/blog/may2026-recap · https://www.magicblock.xyz/blog/june2026-recap · https://www.magicblock.xyz/blog/july2026-recap · https://www.magicblock.xyz/blog/august2026-recap · https://www.magicblock.xyz/blog/september2026-recap · https://www.magicblock.xyz/blog/january2026-recap (no Blitz content)
- MagicBlock Entertainment Finance post: https://www.magicblock.xyz/blog/entertainment-finance-on-magicblock
- Luma event pages: v1 https://luma.com/a4k69n9j · v3 https://luma.com/paozkqa6 · v4 https://luma.com/kfv9avi8 · v5 https://luma.com/x57f72d7 · v10 https://luma.com/hedv5sgh
- MagicBlock builder portal: https://build.magicblock.app (and /builders, /champions; no per-round winner lists found)
- Solana Compass v6 article: https://solanacompass.com/news/magicblock-solana-blitz-v6-41-mobile-apps-three-winners-one-weekend
- Solana Compass MagicBlock project page: https://solanacompass.com/projects/magicblock
- eGamers v7 preview: https://egamers.io/solana-blitz-v7-kicks-off-monday-as-magicblock-hands-builders-five-app-ideas/
- KuCoin repost of the v8 results headline: https://www.kucoin.com/news/community/SOL/6aaded1962cf370007431052
- devrels.xyz builder review (third-party): https://devrels.xyz/articles/magicblock-builders-review
- Attempted but unreadable: coinlaunch.space Blitz listing (HTTP 403); magicblock.xyz/blog/february2026-recap and october2026-recap (HTTP 404).
