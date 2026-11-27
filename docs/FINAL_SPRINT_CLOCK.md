# Final Sprint Clock — 2026-11-27 (Asia/Kolkata)

T+0 measured at **14:56 IST**. Hard deadline **17:30 IST**, internal finish target **17:05 IST** (25-min buffer).
Available working time at T+0: **129 minutes** to target.

| Window (IST) | Wave | Owner | Exit criterion |
| :--- | :--- | :--- | :--- |
| 14:56–15:10 | 0 · Audit & bootstrap | Orchestrator | CLIs audited, git pack corruption fixed, deps installed, shared dev server on :3100 |
| 15:10–16:10 | 1 · Parallel build | Graphics, Terminal UI, Relayer, Pitch, Backend, Video-prep agents | Each agent's scope typechecks; no agent runs `next build` |
| 16:10–16:25 | 2 · Integrate & ship | Orchestrator | `pnpm build` green, Vercel production deploy live, env vars set |
| 16:25–16:45 | 3 · Record & export | Video agent, Pitch agent | Live-URL clips captured, deck PDF + PNGs exported from production |
| 16:45–17:00 | 4 · Compose & audit | Video agent, Orchestrator | MP4 1920x1080, 180–240 s, h264 + aac, 12 keyframes inspected |
| 17:00–17:05 | 5 · Release | Orchestrator | Secret scan clean, commit + push to `main`, final summary |

## Environment audit (T+0)

| Tool | State |
| :--- | :--- |
| Node / pnpm / cargo | v22.23.4 / 12.21.0 / 1.95.0 |
| Vercel CLI | authenticated (`npx vercel@latest`) |
| gcloud | authenticated, Cloud Run project already hosts `cartridgefi` service |
| gh | authenticated |
| solana CLI | installed outside PATH; original relayer key `D7ba9q…` is **not** on this machine |
| ffmpeg | not installed system-wide; Playwright ships a recording-only ffmpeg |
| Playwright | chromium headless shell installed |

## Scope decisions

- A fresh **Devnet-only** relayer keypair is generated for this project and kept in `.keys/` (gitignored) and server-only Vercel env. The previous authority key is unavailable, so relayer transactions are limited to instructions a new signer is permitted to call.
- Claims in the pitch deck and video use only figures verifiable from `docs/DEVNET_PROOF.md`, live APIs, or Solscan at recording time.

## Pivot — 15:15 IST

A new brief replaced the engine/pitch/video sprint with a single product: **Borel, sealed-conviction live market showdowns**.

- Stopped: pitch-deck, founder-video and Rust-services agents. The deck is archived in `docs/archive/engine-pitch-2026-11-27/`; the video pipeline stays local (`video/`, gitignored). `cartridgefi-core-api` and `cartridgefi-ws-mesh` had already deployed to Cloud Run and are left running, unused by Borel.
- Redirected: chain (Borel room lifecycle on the deployed programs), UI (single Borel table at `/`), data (Pyth feeds, mock-data sweep, Pulse Runner/Studio removal, `/protocol` inspector).
- Colosseum Copilot connected 15:27; findings in `docs/IDEA_VALIDATION.md`.
- Independent security review at 15:58 found release blockers (see `docs/AUDIT_LOG.md` §4); fixes timeboxed to 16:35.
