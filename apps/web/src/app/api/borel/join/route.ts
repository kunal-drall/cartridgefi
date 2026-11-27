import { z } from "zod";
import { bigintJson, executeBorelTxs, guardRequest, relayerContext, snapshotJson } from "@/lib/borel/server-api";
import { BorelRuleError, buildJoin, joinOnEr, joinableRoom, readRoomState, sessionPubkeyIsValid } from "@/lib/borel/server-chain";
import type { ChainReceipt } from "@/lib/borel/types";
import { clientIpFromRequest } from "@/lib/relayer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JoinSchema = z.object({
  mode: z.enum(["BLITZ_3M", "MACRO_15M"]),
  stake: z.enum(["PAPER", "DEVNET"]),
  sessionPubkey: z.string().trim().refine(sessionPubkeyIsValid, "sessionPubkey must be a base58 address"),
  /** DEVNET only: seat the player in the staked variant of the room (players there must stake to be counted). */
  staked: z.boolean().optional(),
});

/**
 * POST /api/borel/join — L1: (first player) register manifest, open + delegate the RoomShard to the
 * MagicBlock TEE validator; fund the derived player key, init_stance_and_delegate, HMAC join memo.
 * ER: join_room_and_init_permission creates the stance's private Permission Program ACL.
 */
export async function POST(req: Request) {
  const blocked = guardRequest(req, { rateLimit: true });
  if (blocked) return blocked;
  const parsed = JoinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bigintJson({ status: "error", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  const { mode, stake, sessionPubkey, staked } = parsed.data;
  try {
    const ctx = await relayerContext();
    const now = Date.now();
    const room = joinableRoom(mode, stake, now, staked === true);
    const state = await readRoomState(room, ctx.payer, ctx.signer.address, now);
    if (state.players.get(sessionPubkey)?.joined) {
      return bigintJson({ status: "ok", ...snapshotJson(state, ctx) });
    }
    // Seat cap per client IP per room is enforced from the on-chain join registry (room-scoped HMAC tag).
    const txs = await buildJoin(room, sessionPubkey, ctx.payer, state, clientIpFromRequest(req));
    const outcome = await executeBorelTxs(ctx, txs);
    if (outcome.status !== "ok") return bigintJson({ ...outcome, snapshot: snapshotJson(state, ctx) });

    // ER step. A failure here is not fatal: the lock sends join_room_and_init_permission first if needed.
    const receipts: ChainReceipt[] = [...outcome.receipts];
    let erNote: string | null = null;
    if (room.staked) {
      // Staked room: the ER join counts the player on the RoomShard, so it waits for the stake (lock or settle).
      erNote = "Staked room: the MagicBlock ER join runs when you seal, after your stake lands";
    } else {
      try {
        const erJoin = await joinOnEr(room, sessionPubkey, ctx.signer, state.roomShardPda);
        // L1 receipt last: its Solscan link is public; the ER join is redacted to non-members until unseal.
        const l1Join = receipts.pop();
        receipts.push(erJoin);
        if (l1Join) receipts.push(l1Join);
      } catch (err) {
        erNote = err instanceof Error ? err.message.slice(0, 300) : "MagicBlock ER join deferred";
      }
    }
    return bigintJson({ status: "ok", ...snapshotJson({ ...state, roomExists: true }, ctx, receipts), ...(erNote ? { erNote } : {}) });
  } catch (err) {
    return bigintJson({ status: "error", reason: err instanceof BorelRuleError || err instanceof Error ? err.message.slice(0, 400) : "Join failed" });
  }
}
