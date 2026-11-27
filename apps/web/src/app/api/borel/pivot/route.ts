import { z } from "zod";
import { AuthSchema, bigintJson, executeBorelTxs, guardRequest, relayerContext, verifySessionAuth } from "@/lib/borel/server-api";
import { BorelRuleError, buildPivot, parseRoomId, readRoomState, sessionPubkeyIsValid } from "@/lib/borel/server-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PivotSchema = z.object({
  roomId: z.string().max(64),
  sessionPubkey: z.string().trim().refine(sessionPubkeyIsValid, "sessionPubkey must be a base58 address"),
  pivot: z.object({
    legIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    kind: z.enum(["FLIP", "SHIELD"]),
  }),
  auth: AuthSchema,
});

export async function POST(req: Request) {
  const blocked = guardRequest(req, { rateLimit: true });
  if (blocked) return blocked;
  const parsed = PivotSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bigintJson({ status: "error", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  const { roomId, sessionPubkey, pivot: requested, auth } = parsed.data;
  const room = parseRoomId(roomId);
  if (!room) return bigintJson({ status: "error", reason: "Unknown roomId" }, 400);
  const authError = await verifySessionAuth({ action: "pivot", roomId, sessionPubkey, params: requested, auth });
  if (authError) return bigintJson({ status: "error", reason: authError });
  try {
    const ctx = await relayerContext();
    if (!ctx.funded) {
      return bigintJson({
        status: "unfunded",
        reason: `Relayer ${ctx.signer.address} is below the funding floor; no sealed hand exists on-chain to pivot, nothing broadcast`,
        simulationLogs: [],
      });
    }
    const now = Date.now();
    const state = await readRoomState(room, ctx.payer, ctx.signer.address, now);
    const { tx, pivot } = await buildPivot(room, sessionPubkey, requested.legIndex, requested.kind, ctx.payer, state, now);
    const outcome = await executeBorelTxs(ctx, [tx]);
    if (outcome.status === "ok") return bigintJson({ status: "ok", receipt: outcome.receipts[0], pivot });
    return bigintJson({ ...outcome, pivot });
  } catch (err) {
    return bigintJson({ status: "error", reason: err instanceof BorelRuleError || err instanceof Error ? err.message.slice(0, 400) : "Pivot failed" });
  }
}
