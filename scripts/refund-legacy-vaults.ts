/**
 * Borel — refund the stranded test-USDC in the pre-upgrade (v1) room vaults (docs/specs/STAKES_ONCHAIN_FIXES.md §6).
 *
 * For each legacy vault (relayer authority, unsettled):
 *   L1  cartridge_vault_router.migrate_room_vault_v2: vault + every v1 envelope → v2 layout (counted, funder = default)
 *   L1  cartridge_vault_router.refund_unsettled_room: principal → the envelope's player-key ATA (legacy rule)
 *   L1  forward: player-key ATA → the staking wallet named in the relayer-MAC'd stake memo, then close the ATA
 *       (the player key is re-derived from relayer key material exactly like the app; skipped if not derivable)
 *
 * Run: node scripts/refund-legacy-vaults.ts   (RELAYER_KEYPAIR overrides .keys/relayer.json)
 * Appends the receipts to docs/DEVNET_PROOF.md. Idempotent: migrated vaults and refunded envelopes are skipped.
 */
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";

import {
  STAKE_BUY_IN_UNITS,
  closeAccountIx,
  computeUnitLimitIx,
  createAtaIdempotentIx,
  deriveAta,
  findStakeRecord,
  listRoomEnvelopes,
  migrateLegacyVault,
  readRoomVault,
  refundRoom,
  sendSignedAndConfirm,
  transferCheckedIx,
  type StakeChain,
} from "../apps/web/src/lib/borel/stakes-core.ts";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DEVNET_RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Unsettled relayer-authority vaults from STAKES_ONCHAIN_FIXES.md §6 (keyed by RoomShard). */
const LEGACY_SHARDS: Address[] = [
  address("6VJeEkP2aitptmB3zwSYGg23VXQuxjPpitwLXkHX7YFh"),
  address("Eg67mLqGQKahqeBBGm3aERJMCLi5EB5uJ16VewH1Ygzq"),
  address("A2Pss5KZ6TiYcfi9odE79MVjdYV7E9uSe8Me9Hn58HN"),
  address("BYAktBRVGRUvLG65swnwgXfcz7wQDXLe8HcWgmw6BwM3"),
];
/** Room cycle lengths (lobby + duration) used to re-derive a legacy room id from the stake time. */
const CYCLE_MS = { BLITZ_3M: 45_000 + 180_000, MACRO_15M: 60_000 + 900_000 } as const;

const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const solscanAccount = (a: string) => `https://solscan.io/account/${a}?cluster=devnet`;

async function main(): Promise<void> {
  const keyPath = process.env.RELAYER_KEYPAIR ?? resolve(ROOT, ".keys/relayer.json");
  const secret = new Uint8Array(JSON.parse(readFileSync(keyPath, "utf8")) as number[]);
  const relayer = await createKeyPairSignerFromBytes(secret);
  // Same domain-separated key material as apps/web/src/lib/relayer/config.ts deriveRelayerKeyMaterial().
  const secretB58 = getBase58Decoder().decode(secret);
  const keyMaterial = (domain: string) => new Uint8Array(createHmac("sha256", secretB58).update(domain).digest());
  const deployment = JSON.parse(readFileSync(resolve(ROOT, "apps/web/src/data/borel-deployment.json"), "utf8")) as {
    authority: string;
    testUsdcMint: string;
    testUsdcDecimals: number;
    platformFeeAccount: string;
  };
  if (relayer.address !== deployment.authority) throw new Error(`Relayer ${relayer.address} is not the vault authority`);
  const rpc = createSolanaRpc(DEVNET_RPC);
  const receipts: { step: string; signature: string }[] = [];

  const sendIxs = async (label: string, ixs: Instruction[]): Promise<string> => {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(relayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const sig = await sendSignedAndConfirm(rpc, signed);
    receipts.push({ step: label, signature: sig });
    console.log(`  ${label}\n     ${solscanTx(sig)}`);
    return sig;
  };

  const chain: StakeChain = {
    rpc,
    relayer,
    mint: address(deployment.testUsdcMint),
    decimals: deployment.testUsdcDecimals,
    platformFeeAccount: address(deployment.platformFeeAccount),
    send: sendIxs,
    mac: (body) => createHmac("sha256", keyMaterial("borel:stake-memo:v1")).update(body).digest("hex").slice(0, 32),
  };

  /** Re-derives the app's per-(room, session) player key from the stake memo's session and the stake time. */
  const derivePlayer = async (session: string, stakeAtMs: number, want: Address): Promise<KeyPairSigner | null> => {
    for (const mode of ["BLITZ_3M", "MACRO_15M"] as const) {
      const k0 = Math.floor(stakeAtMs / CYCLE_MS[mode]);
      for (let k = k0 - 2; k <= k0 + 2; k += 1) {
        for (const suffix of ["-S", ""]) {
          const roomId = `${mode}-DEVNET-${k}${suffix}`;
          const signer = await createKeyPairSignerFromPrivateKeyBytes(keyMaterial(`borel:player:v1:${roomId}:${session}`));
          if (signer.address === want) return signer;
        }
      }
    }
    return null;
  };

  let refundedUnits = 0n;
  const rows: string[] = [];
  for (const shard of LEGACY_SHARDS) {
    console.log(`RoomShard ${shard}`);
    await migrateLegacyVault(chain, shard, STAKE_BUY_IN_UNITS.BLITZ_3M);
    const vault = await readRoomVault(chain, shard);
    if (!vault) throw new Error(`No room vault for ${shard}`);
    const envelopes = await listRoomEnvelopes(chain, shard);
    // Resolve each legacy envelope's staking wallet + player signer BEFORE the refund lands.
    const forwards: { player: KeyPairSigner; wallet: Address; units: bigint; envelope: Address }[] = [];
    for (const env of envelopes) {
      if (env.state.refunded || env.state.funder !== SYSTEM_PROGRAM) continue;
      const record = await findStakeRecord(chain, shard, env.address);
      if (!record) {
        console.log(`  envelope ${env.address}: no relayer stake memo; refund stays with player key ${env.state.player}`);
        continue;
      }
      const tx = await rpc.getTransaction(record.signature as Signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }).send();
      const atMs = Number(tx?.blockTime ?? 0n) * 1000;
      const player = atMs > 0 ? await derivePlayer(record.session, atMs, env.state.player) : null;
      if (!player) {
        console.log(`  envelope ${env.address}: player key not derivable; refund stays with ${env.state.player}`);
        continue;
      }
      forwards.push({ player, wallet: record.wallet, units: env.state.principalUsdc, envelope: env.address });
    }
    const poolBefore = vault.state.roomPoolUsdc;
    await refundRoom(chain, shard);
    const after = await readRoomVault(chain, shard);
    refundedUnits += poolBefore - (after?.state.roomPoolUsdc ?? poolBefore);
    for (const f of forwards) {
      const playerAta = await deriveAta(f.player.address, chain.mint);
      const walletAta = await deriveAta(f.wallet, chain.mint);
      await sendIxs(`forward legacy refund ${f.units} units: player key ${f.player.address} → staking wallet ${f.wallet}`, [
        computeUnitLimitIx(100_000),
        createAtaIdempotentIx(relayer, walletAta, f.wallet, chain.mint),
        transferCheckedIx(playerAta, chain.mint, walletAta, f.player, f.units, chain.decimals),
        closeAccountIx(playerAta, relayer.address, f.player),
      ]);
    }
    rows.push(
      `| [\`${vault.address.slice(0, 8)}…\`](${solscanAccount(vault.address)}) | [\`${shard.slice(0, 8)}…\`](${solscanAccount(shard)}) | ${poolBefore} | ${envelopes.length} | ${after?.state.settled ? "settled (fully refunded)" : "open"} |`,
    );
  }
  console.log(`Refunded ${refundedUnits} test-USDC units`);

  const docPath = resolve(ROOT, "docs/DEVNET_PROOF.md");
  const lines = [
    "",
    "---",
    "",
    `## Legacy stake vaults refunded after the vault-router upgrade — ${new Date().toISOString()}`,
    "",
    `The four pre-upgrade vaults (STAKES_ONCHAIN_FIXES.md §6) were migrated to the v2 layout with \`migrate_room_vault_v2\` and refunded with the authority-only \`refund_unsettled_room\` (relayer \`${relayer.address}\`). Legacy envelopes have no recorded funder, so the program refunds the player key; each refund was then forwarded to the staking wallet named in the relayer-MAC'd stake memo. ${refundedUnits} test-USDC units returned in total.`,
    "",
    "| RoomVault | RoomShard | Pool before (units) | Envelopes | After |",
    "| :--- | :--- | ---: | ---: | :--- |",
    ...rows,
    "",
    "| Step | Solscan |",
    "| :--- | :--- |",
    ...receipts.map((r) => `| ${r.step.replace(/\|/g, "/")} | [\`${r.signature.slice(0, 16)}…\`](${solscanTx(r.signature)}) |`),
    "",
  ];
  writeFileSync(docPath, readFileSync(docPath, "utf8") + lines.join("\n"));
  console.log(`Appended ${receipts.length} receipts to docs/DEVNET_PROOF.md`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
