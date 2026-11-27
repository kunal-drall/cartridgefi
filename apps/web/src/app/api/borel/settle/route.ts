import { z } from "zod";
import { bigintJson, guardRequest, relayerContext } from "@/lib/borel/server-api";
import { BorelRuleError, parseRoomId, readRoomState, roomShardOnL1, runSettlement } from "@/lib/borel/server-chain";
import { distributeRoomPayouts, getStakeStatus, receiptJson } from "@/lib/borel/server-stakes";
import type { ChainReceipt } from "@/lib/borel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SettleSchema = z.object({ roomId: z.string().max(64) });

/** Waits (bounded) for the MagicBlock commit to hand the RoomShard back to Solana L1. */
async function waitForL1Commit(read: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await read()) return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

/**
 * POST /api/borel/settle — anyone may call after 00:00; idempotent. Settle memo (fresh Pyth prices) →
 * MagicBlock VRF → trigger_showdown_unseal + evaluate_player_score → undelegate_player_stance →
 * settle_and_commit_shard (back to L1) → stake payouts (when anyone staked).
 */
export async function POST(req: Request) {
  const blocked = guardRequest(req, { rateLimit: true });
  if (blocked) return blocked;
  const parsed = SettleSchema.safeParse(await req.json().catch(() => null));
  const room = parsed.success ? parseRoomId(parsed.data.roomId) : null;
  if (!room) return bigintJson({ status: "error", reason: "Unknown roomId" }, 400);
  try {
    const ctx = await relayerContext();
    const now = Date.now();
    const state = await readRoomState(room, ctx.payer, ctx.signer.address, now);
    const committed = state.settled !== null && !state.roomDelegated;
    let receipts: ChainReceipt[] = [];
    let pending: string | null = null;
    let note: string | null = null;
    if (!committed) {
      if (!ctx.funded) {
        return bigintJson({
          status: "unfunded",
          reason: `Relayer ${ctx.signer.address} is below the funding floor; settlement not broadcast`,
          simulationLogs: [],
        });
      }
      const isStaked = (session: string) => getStakeStatus(room.roomId, session).then((s) => s.staked, () => false);
      const result = await runSettlement(room, ctx.signer, state, now, isStaked);
      receipts = result.receipts;
      pending = result.pending;
      note = result.note;
      if (pending) return bigintJson({ status: "error", reason: pending, receipts });
    }

    // Stake payouts (separate module): only once the RoomShard is back on L1.
    const onL1 = note ? false : await waitForL1Commit(() => roomShardOnL1(room, ctx.payer), 15_000);
    let payouts: string | null = note;
    if (onL1) {
      const distribution = await distributeRoomPayouts(room.roomId);
      if (distribution.status === "ok") {
        receipts.push(...distribution.receipts.map((r) => receiptJson(r)));
        if (distribution.errors.length > 0) payouts = distribution.errors.join("; ").slice(0, 400);
      } else if (distribution.status !== "no-stakes") {
        payouts = distribution.reason;
      }
    } else if (!note) {
      payouts = "RoomShard commit to Solana L1 not observed yet; payouts run on the next settle call";
    }

    // Idempotent: once settled, the existing L1 receipts (settle memo + MagicBlock commits) are returned too.
    const final = await readRoomState(room, ctx.payer, ctx.signer.address, Date.now());
    const seen = new Set(receipts.map((r) => r.signature));
    const l1 = final.receipts.filter((r) => /^(Settle|MagicBlock TEE)/.test(r.label) && !seen.has(r.signature));
    return bigintJson({ status: "ok", receipts: [...receipts, ...l1], vrfSeed: final.vrfSeed, ...(payouts ? { payouts } : {}) });
  } catch (err) {
    return bigintJson({ status: "error", reason: err instanceof BorelRuleError || err instanceof Error ? err.message.slice(0, 400) : "Settle failed" });
  }
}
