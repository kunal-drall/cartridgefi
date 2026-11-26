# CartridgeFi & Borel (#001) — Multi-Agent Swarm Execution Board

**Orchestrator:** Agent-00 (Chief Architect & DAG Orchestrator)  
**Repository:** `kunal-drall/cartridgefi`  
**Toolchain Matrix:** Node `v22.23.5` · pnpm `12.21.0` · Rust `1.100.0` · Solana Agave CLI `3.1.10` (`platform-tools v1.52`) · Anchor CLI `1.0.2` · `ephemeral-rollups-sdk = 0.18.0`

---

## Verified On-Chain Program IDs & Authorities

| Component | Pubkey |
| :--- | :--- |
| `cartridge-registry` | `5tH1uFw8Lyf8NZ8YvMogwGWjLyRXrKBSJveKVbHm1nvr` |
| `cartridge-er-room` | `Hqi5b6iY9rgnpRW8o5y1vamDU3Y9i6mKq49BDjZVxkFR` |
| `cartridge-vault-router` | `6hzFDMeBERxfzrgnWyzeptHknnMzwTr5u1FmVfG9eRBT` |
| `cartridge-passport` | `5jkGrbF915SoaVbmxbjseUEswVydyXVXXBripyBN8cNr` |
| MagicBlock Delegation Program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| MagicBlock Permission Program (PER TEE) | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` |
| Deployer & Keeper Authority | `D7ba9qSDTubn9S86nsTb1EgDSFE2rjCacGcmMDzfpWs1` |
| Pacer Bots (#1, #2, #3) | `FRLBDfWhskqdGsoNkBMsnxHtQTy6Bkm25NEvsVncGAay`, `7JdpFNAHqeoaYnnS9G1DY9qCyN33UBRyaySfANCHjFRa`, `E5EwXiUfq9wCegbBwNdXpUvubkuJCZC4LDmR8wwQTJsR` |
| Kora Gasless Sponsor | `Giyjg9VusfUXJbNYT2W3gRHpfFPez1kPAE5YcWsmNjPd` |

---

## Wave Status Matrix

| Wave | Priority | Assigned Agents | Scope | Status |
| :--- | :--- | :--- | :--- | :--- |
| **WAVE 0** | P0 Blocking | `Agent-00` | `npx skills` bootstrap + dynamic skill discovery (`skills-lock.json` v2, 13 verified skills), `.mcp.json` + live `solana-mcp` bridge, monorepo scaffolding, `@cartridgefi/shared-types` v2.0 schema + `10^9` `bigint` fixed-point math + 500-tick simulator + binary WS codec | **COMPLETE** |
| **WAVE 1** | P0 Parallel | `Agent-01`, `Agent-02`, `Agent-04` | All 4 Anchor `.so` + JSON IDLs built (`anchor build --ignore-keys`) & `program_autofixer` clean; `@cartridgefi/codama-clients` generated & verified; Rust `core-api` + `ws-mesh` + `keeper-bots` 9/9 green (`Agent-02`); `@cartridgefi/ui-system` + Flagship `/` Landing Page 100% green (`Agent-04`); `tests/onchain/` 8/8 + 100k fuzz green (`Agent-01`) | **COMPLETE** |
| **WAVE 2** | P0 Parallel | `Agent-03`, `Agent-05` | `@cartridgefi/sdk` (7/7) + `@cartridgefi/react` (`<CartridgeDeck/>`) + `cartridgefi` CLI (2/2) + `packages/cartridgefi-skill` + `@cartridgefi/mcp` v2 (`stdio` + HTTP, 2/2) (`Agent-03`); Borel (`/play/borel`) + Pulse Runner (`/play/pulse-runner`) + Vibe Studio (`/studio`) (`Agent-05`) | **COMPLETE** |
| **WAVE 3** | P0 Convergence | `Agent-00`, `Agent-01`, `Agent-02` | All 4 `.so` binaries (`opt-level = "z"`) deployed sequentially to live Solana Devnet (`5.98828368 SOL` permanent rent, `0 SOL` stranded in buffers); `CARTRIDGEFI_STANDALONE_DEV=false pnpm prove:devnet` verified end-to-end across `https://api.devnet.solana.com` & `https://devnet-router.magicblock.app` (`docs/DEVNET_PROOF.md`) | **COMPLETE (LIVE ON DEVNET)** |
| **WAVE 4** | P0 Veto Gate | `Agent-06` | Independent red-team security review, 100,000-vector solvency fuzzing, Vercel offline-daemon resilience check, Playwright headless Desktop (`1440x900`) & Mobile (`390x844`) zero-slop visual & console audit (8/8 green), `docs/AUDIT_LOG.md` signed off | **COMPLETE (SIGNED OFF)** |
