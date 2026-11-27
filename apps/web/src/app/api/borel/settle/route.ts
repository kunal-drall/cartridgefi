import { z } from "zod";
import { bigintJson, executeBorelTxs, guardRequest, relayerContext } from "@/lib/borel/server-api";
import { BorelRuleError, buildSettle, parseRoomId, readRoomState } from "@/lib/borel/server-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SettleSchema = z.object({ roomId: z.string().max(64) });

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
    if (state.settled) {
      // Idempotent: anyone may call settle; once settled, return the existing on-chain receipts.
      return bigintJson({ status: "ok", receipts: state.receipts.filter((r) => /^(Room settled|Hand revealed)/.test(r.label)) });
    }
    if (!ctx.funded && !state.roomExists) {
      return bigintJson({
        status: "unfunded",
        reason: `Relayer ${ctx.signer.address} is below the funding floor; this room was never opened on-chain, nothing broadcast`,
        simulationLogs: [],
      });
    }
    const txs = await buildSettle(room, ctx.payer, state, now);
    const outcome = await executeBorelTxs(ctx, txs);
    return bigintJson(outcome);
  } catch (err) {
    return bigintJson({ status: "error", reason: err instanceof BorelRuleError || err instanceof Error ? err.message.slice(0, 400) : "Settle failed" });
  }
}
