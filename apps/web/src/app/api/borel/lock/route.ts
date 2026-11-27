import { z } from "zod";
import { BOREL_MARKETS, type HandLeg } from "@/lib/borel/types";
import { validateHand } from "@/lib/borel/scoring";
import { AuthSchema, bigintJson, executeErAction, guardRequest, relayerContext, verifySessionAuth } from "@/lib/borel/server-api";
import { BorelRuleError, buildLock, parseRoomId, readRoomState, readStanceHand, sessionPubkeyIsValid } from "@/lib/borel/server-chain";
import { getStakeStatus } from "@/lib/borel/server-stakes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LegSchema = z.object({
  market: z.enum(BOREL_MARKETS),
  direction: z.enum(["LONG", "SHORT"]),
  conviction: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Ignored: entry prices are always set server-side from fresh Pyth data. */
  entryPriceE9: z.string().regex(/^\d{1,30}$/).optional(),
});

const LockSchema = z.object({
  roomId: z.string().max(64),
  sessionPubkey: z.string().trim().refine(sessionPubkeyIsValid, "sessionPubkey must be a base58 address"),
  hand: z.array(LegSchema).length(3),
  commitment: z.string().regex(/^[0-9a-f]{64}$/),
  salt: z.string().regex(/^[0-9a-f]{2,128}$/).optional(),
  auth: AuthSchema,
});

export async function POST(req: Request) {
  const blocked = guardRequest(req, { rateLimit: true });
  if (blocked) return blocked;
  const parsed = LockSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bigintJson({ status: "error", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  const { roomId, sessionPubkey, commitment, salt, auth } = parsed.data;
  const room = parseRoomId(roomId);
  if (!room) return bigintJson({ status: "error", reason: "Unknown roomId" }, 400);
  const legs: HandLeg[] = parsed.data.hand.map((l) => ({ market: l.market, direction: l.direction, conviction: l.conviction }));
  const validation = validateHand(legs);
  if (!validation.ok) return bigintJson({ status: "error", reason: validation.reason });
  const authError = await verifySessionAuth({ action: "lock", roomId, sessionPubkey, params: { hand: legs, commitment, salt }, auth });
  if (authError) return bigintJson({ status: "error", reason: authError });
  try {
    const ctx = await relayerContext();
    if (!ctx.funded) {
      return bigintJson({
        status: "unfunded",
        reason: `Relayer ${ctx.signer.address} is below the funding floor; no stance exists on the MagicBlock ER to seal into, nothing broadcast`,
        simulationLogs: [],
      });
    }
    const now = Date.now();
    const state = await readRoomState(room, ctx.payer, ctx.signer.address, now);
    // submit_stance on the MagicBlock Private ER (TEE); the stance stays permissioned until unseal.
    const stakeConfirmed = room.staked ? await getStakeStatus(roomId, sessionPubkey).then((s) => s.staked, () => false) : false;
    const action = await buildLock(room, sessionPubkey, legs, commitment, salt, ctx.payer, state, now, stakeConfirmed);
    const outcome = await executeErAction(ctx, action);
    if (outcome.status !== "ok") return bigintJson(outcome);
    const sealed = await readStanceHand(action.stancePda);
    if (!sealed) return bigintJson({ status: "error", reason: "Sealed stance could not be read back from the MagicBlock ER" });
    return bigintJson({ status: "ok", receipt: outcome.receipt, hand: sealed.hand });
  } catch (err) {
    return bigintJson({ status: "error", reason: err instanceof BorelRuleError || err instanceof Error ? err.message.slice(0, 400) : "Lock failed" });
  }
}
