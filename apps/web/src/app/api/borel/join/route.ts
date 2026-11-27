import { z } from "zod";
import { bigintJson, executeBorelTxs, guardRequest, relayerContext, snapshotJson } from "@/lib/borel/server-api";
import { BorelRuleError, buildJoin, joinableRoom, readRoomState, sessionPubkeyIsValid } from "@/lib/borel/server-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JoinSchema = z.object({
  mode: z.enum(["BLITZ_3M", "MACRO_15M"]),
  stake: z.enum(["PAPER", "DEVNET"]),
  sessionPubkey: z.string().trim().refine(sessionPubkeyIsValid, "sessionPubkey must be a base58 address"),
});

export async function POST(req: Request) {
  const blocked = guardRequest(req, { rateLimit: true });
  if (blocked) return blocked;
  const parsed = JoinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bigintJson({ status: "error", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  const { mode, stake, sessionPubkey } = parsed.data;
  try {
    const ctx = await relayerContext();
    const now = Date.now();
    const room = joinableRoom(mode, stake, now);
    const state = await readRoomState(room, ctx.payer, ctx.signer.address, now);
    if (state.players.get(sessionPubkey)?.joined) {
      return bigintJson({ status: "ok", ...snapshotJson(state, ctx) });
    }
    const tx = await buildJoin(room, sessionPubkey, ctx.payer, state);
    const outcome = await executeBorelTxs(ctx, [tx]);
    if (outcome.status === "ok") {
      return bigintJson({ status: "ok", ...snapshotJson({ ...state, roomExists: true }, ctx, outcome.receipts) });
    }
    return bigintJson({ ...outcome, snapshot: snapshotJson(state, ctx) });
  } catch (err) {
    return bigintJson({ status: "error", reason: err instanceof BorelRuleError || err instanceof Error ? err.message.slice(0, 400) : "Join failed" });
  }
}
