/**
 * Borel adversarial on-chain test: forged room events must be ignored (audit C1).
 *
 * A fresh attacker key (funded with 0.01 SOL by the relayer at `.keys/relayer.json`, never used as a
 * fee payer for the app) sends transactions that write-lock a REAL RoomShard, so they are indexed under
 * the room address exactly like relayer events. `/api/borel/room` must not change because of them.
 *
 * Event model under test (server-chain.ts): L1 memos `borel:v1:join:*` and `borel:v1:settle2:*` count
 * only with the relayer HMAC, inside the phase window, in a relayer-paid transaction; memo-less
 * transactions after endsAt count as TEE commits only when the MagicBlock TEE validator paid the fee.
 * Hands live in TEE stance accounts (lock/pivot are not memo events any more).
 *
 *   1. Real join + real lock through the app API (relayer-paid) in the current BLITZ_3M-PAPER room.
 *   2. Lobby forgeries (after the real lock; the snapshot must match the pre-forgery one): join for unknown sessions with a random MAC and with no MAC, a verbatim replay
 *      of the relayer's genuine join memo (valid MAC) in an attacker-paid tx, and a legacy v1 lock memo.
 *   3. After endsAt (settle window): settle2 with a random MAC, settle2 with no MAC, a legacy v1 settle
 *      with a chosen seed, and a memo-less attacker tx touching the shard (fake "TEE commit").
 *   4. Positive control: the real `/api/borel/settle`; the published seed must not be the forged seed.
 *
 * Assertions after each step: no forged signature appears in receipts, phase follows the schedule
 * (never SETTLED from a forged settle), rows unchanged, no score or hand exposed before the real settle.
 *
 *   node scripts/test-forged-events.ts            # against http://127.0.0.1:3100
 *   BOREL_API_URL=https://… node scripts/test-forged-events.ts
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getUtf8Encoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";

import { borelAuthMessage } from "../apps/web/src/lib/borel/auth.ts";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const BASE = (process.env.BOREL_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const ATTACKER_FUNDING_LAMPORTS = 10_000_000n;
const FORGED_SEED = "f".repeat(64);

function devnetRpcUrl(): string {
  if (process.env.CARTRIDGEFI_RELAYER_RPC_URL) return process.env.CARTRIDGEFI_RELAYER_RPC_URL;
  const envFile = resolve(ROOT, "apps/web/.env.local");
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, "utf8")
      .split("\n")
      .find((l) => l.startsWith("CARTRIDGEFI_RELAYER_RPC_URL="));
    const value = line?.slice("CARTRIDGEFI_RELAYER_RPC_URL=".length).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return "https://api.devnet.solana.com";
}

const rpc = createSolanaRpc(devnetRpcUrl());

/* ---------------------------------- helpers --------------------------------- */

interface Receipt {
  label: string;
  signature: string;
}
interface Row {
  id: string;
  rank: number;
  scoreE9?: string;
  hand?: unknown;
}
interface RoomSnapshot {
  status: string;
  reason?: string;
  roomId: string;
  phase: "LOBBY" | "SEALED" | "SHOWDOWN" | "SETTLED";
  lockAt: number;
  endsAt: number;
  vrfSeed: string;
  seedSource: string | null;
  roomShard: string;
  receipts: Receipt[];
  rows: Row[];
}

const results: { check: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries RPC calls that fail with HTTP 429 / transient transport errors (public devnet throttles). */
async function retry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (i + 1 >= attempts || !/429|Too Many|fetch failed|ECONNRESET|timeout/i.test(msg)) throw err;
      await sleep(800 * 2 ** i);
    }
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/** Room snapshot plus the wall-clock span of the request (the server computes phase inside it). */
async function room(roomId: string): Promise<RoomSnapshot & { requestedAt: number; receivedAt: number }> {
  const requestedAt = Date.now();
  const snap = await api<RoomSnapshot>(`/api/borel/room?roomId=${encodeURIComponent(roomId)}`);
  if (snap.status !== "ok") throw new Error(`room read failed: ${snap.reason ?? JSON.stringify(snap)}`);
  return { ...snap, requestedAt, receivedAt: Date.now() };
}

function expectedPhase(snap: RoomSnapshot, now: number): RoomSnapshot["phase"] {
  if (now < snap.lockAt) return "LOBBY";
  if (now < snap.endsAt - 15_000) return "SEALED";
  return "SHOWDOWN";
}

function memoIx(text: string): Instruction {
  return { programAddress: MEMO_PROGRAM, data: new Uint8Array(getUtf8Encoder().encode(text)) };
}

function transferIx(from: Address, to: Address, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from, role: 3 },
      { address: to, role: 1 },
    ],
    data,
  };
}

async function sendTx(payer: KeyPairSigner, instructions: Instruction[]): Promise<string> {
  const { value: blockhash } = await retry(() => rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  await retry(() => rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send());
  for (let i = 0; i < 60; i += 1) {
    const { value } = await retry(() => rpc.getSignatureStatuses([signature as Signature]).send());
    const s = value[0];
    if (s?.err) throw new Error(`tx ${signature} failed: ${JSON.stringify(s.err, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return signature;
    await sleep(700);
  }
  throw new Error(`tx ${signature} not confirmed`);
}

const randomMac = (): string => randomBytes(16).toString("hex");

function assertUntouched(
  label: string,
  before: RoomSnapshot,
  after: RoomSnapshot & { requestedAt: number; receivedAt: number },
  forged: readonly string[],
): void {
  const receiptSigs = new Set(after.receipts.map((r) => r.signature));
  const leaked = forged.filter((s) => receiptSigs.has(s));
  check(`${label}: no forged signature in receipts`, leaked.length === 0, leaked.length ? leaked.join(",") : `${after.receipts.length} receipts, all relayer-authored`);
  const allowed = new Set([expectedPhase(after, after.requestedAt), expectedPhase(after, after.receivedAt)]);
  check(
    `${label}: phase follows the schedule, not the forgery`,
    allowed.has(after.phase),
    `phase=${after.phase} expected=${[...allowed].join("|")}`,
  );
  check(`${label}: no settle seed published`, after.vrfSeed === "" && after.seedSource === null, `vrfSeed="${after.vrfSeed.slice(0, 16)}"`);
  const sameRows =
    after.rows.length === before.rows.length && after.rows.every((r, i) => r.id === before.rows[i]?.id);
  check(`${label}: rows unchanged`, sameRows, `${after.rows.length} row(s)`);
  const exposed = after.rows.filter((r) => r.scoreE9 !== undefined || r.hand !== undefined);
  check(`${label}: no score or hand exposed while sealed`, exposed.length === 0, exposed.length ? JSON.stringify(exposed) : "");
}

/* ----------------------------------- main ----------------------------------- */

async function main(): Promise<void> {
  const keypairPath = process.env.RELAYER_KEYPAIR ?? resolve(ROOT, ".keys/relayer.json");
  const relayer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]));
  const attacker = await generateKeyPairSigner();
  const session = await generateKeyPairSigner();
  const fakeSession = (await generateKeyPairSigner()).address;
  const fakeSession2 = (await generateKeyPairSigner()).address;
  console.log(`API ${BASE}\nrelayer ${relayer.address}\nattacker ${attacker.address}\nsession ${session.address}`);

  const fundSig = await sendTx(relayer, [transferIx(relayer.address, attacker.address, ATTACKER_FUNDING_LAMPORTS)]);
  console.log(`funded attacker with 0.01 SOL: ${fundSig}`);

  // Join early in a lobby so the forgeries and the real lock all land before lockAt (45 s lobby, 225 s cycle,
  // lock jitter <= 5 s; the API seats a player in the current room until lockAt - 10 s).
  const CYCLE_MS = 225_000;
  const LOBBY_MS = 45_000;
  const msIntoCycle = Date.now() % CYCLE_MS;
  if (LOBBY_MS - 5_000 - msIntoCycle < 32_000) {
    const wait = CYCLE_MS - msIntoCycle + 1_000;
    console.log(`waiting ${Math.ceil(wait / 1000)}s for the next lobby to open…`);
    await sleep(wait);
  }

  // 1. Real join (relayer-paid) opens / joins the current paper room on-chain.
  const join = await api<RoomSnapshot>("/api/borel/join", { mode: "BLITZ_3M", stake: "PAPER", sessionPubkey: session.address });
  if (join.status !== "ok") throw new Error(`join failed: ${join.reason ?? JSON.stringify(join)}`);
  const roomId = join.roomId;
  const roomShard = address(join.roomShard);
  console.log(`room ${roomId} shard ${roomShard} lockAt ${new Date(join.lockAt).toISOString()} endsAt ${new Date(join.endsAt).toISOString()}`);

  // Genuine relayer join memo for this session (valid MAC), to replay from the attacker.
  const sigs = await retry(() => rpc.getSignaturesForAddress(roomShard, { limit: 50, commitment: "confirmed" }).send());
  const genuineJoinMemo = sigs
    .flatMap((s) => (s.memo ?? "").split("; ").map((p) => p.replace(/^\[\d+\]\s*/, "").trim()))
    .find((t) => t.startsWith(`borel:v1:join:${session.address}:`));
  check("genuine relayer join memo found for replay", Boolean(genuineJoinMemo), genuineJoinMemo ? `${genuineJoinMemo.slice(0, 40)}…` : "");

  // Real lock first (session-signed, sealed in the TEE): lock memos are no longer events, so ordering it
  // before the forgeries keeps it inside the lock window even when devnet confirmations are slow.
  const hand = [
    { market: "SOL/USD", direction: "LONG", conviction: 3 },
    { market: "BTC/USD", direction: "LONG", conviction: 2 },
    { market: "ETH/USD", direction: "SHORT", conviction: 1 },
  ];
  const commitment = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 60_000;
  const lockSig = await signBytes(
    session.keyPair.privateKey,
    borelAuthMessage({ action: "lock", roomId, sessionPubkey: session.address, params: { hand, commitment }, expiresAt }),
  );
  const lock = await api<{ status: string; reason?: string }>("/api/borel/lock", {
    roomId,
    sessionPubkey: session.address,
    hand,
    commitment,
    auth: { expiresAt, signature: getBase58Decoder().decode(lockSig) },
  });
  check("real session-signed lock accepted", lock.status === "ok", lock.reason ?? "");

  const before = await room(roomId);

  // 2. Lobby forgeries (join window still open).
  const forged: string[] = [];
  const index = transferIx(attacker.address, roomShard, 0n);
  forged.push(
    ...(await Promise.all([
      sendTx(attacker, [
        index,
        memoIx(`borel:v1:join:${fakeSession}:PAPER:h=${randomMac()}`),
        memoIx(`borel:v1:join:${fakeSession2}:PAPER`),
        // Legacy v1 lock memo (hands moved to TEE stance accounts; must be inert).
        memoIx(`borel:v1:lock:${session.address}:${randomBytes(32).toString("hex")}:${randomBytes(48).toString("base64url")}:h=${randomMac()}`),
      ]),
      ...(genuineJoinMemo ? [sendTx(attacker, [index, memoIx(genuineJoinMemo)])] : []),
    ])),
  );
  console.log(`lobby forgeries: ${forged.join(", ")}`);
  await sleep(2_500);
  const afterForgery = await room(roomId);
  assertUntouched("lobby forgeries", before, afterForgery, forged);

  const afterLobby = afterForgery;

  // 3. Settle-window forgeries (blockTime >= endsAt).
  const waitMs = afterLobby.endsAt + 3_000 - Date.now();
  if (waitMs > 0) {
    console.log(`waiting ${Math.ceil(waitMs / 1000)}s for the settle window…`);
    await sleep(waitMs);
  }
  const settleForged = await Promise.all([
    sendTx(attacker, [
      index,
      memoIx(`borel:v1:settle2:0=1,1=1,2=1,3=1:h=${randomMac()}`),
      memoIx(`borel:v1:settle2:0=999999999999`),
      memoIx(`borel:v1:settle:${FORGED_SEED}:0=1,1=1,2=1,3=1:h=${randomMac()}`),
    ]),
    // Memo-less tx after endsAt: looks like a TEE commit candidate, but the attacker paid the fee.
    sendTx(attacker, [transferIx(attacker.address, roomShard, 0n)]),
  ]);
  forged.push(...settleForged);
  console.log(`settle-window forgeries: ${settleForged.join(", ")}`);
  await sleep(4_000);
  const afterSettleForgery = await room(roomId);
  assertUntouched("settle-window forgeries", afterLobby, afterSettleForgery, forged);

  // 4. Positive control: the real settle still works and ignores the forged seed.
  const settle = await api<{ status: string; reason?: string }>("/api/borel/settle", { roomId });
  check("real relayer settle succeeds", settle.status === "ok", settle.reason ?? "");
  await sleep(3_000);
  const settled = await room(roomId);
  check("phase SETTLED only after the real settle", settled.phase === "SETTLED", `phase=${settled.phase}`);
  check("published seed is not the forged seed", settled.vrfSeed !== FORGED_SEED && settled.vrfSeed.length === 64, settled.vrfSeed.slice(0, 16));
  check(
    "seed source names a relayer signature, not a forged one",
    settled.seedSource !== null && !forged.some((s) => settled.seedSource?.includes(s)),
    settled.seedSource ?? "",
  );
  check("no forged signature in final receipts", !settled.receipts.some((r) => forged.includes(r.signature)), `${settled.receipts.length} receipts`);

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      { roomId, roomShard, attacker: attacker.address, fundSig, forged, passed: results.length - failed.length, failed: failed.length },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
