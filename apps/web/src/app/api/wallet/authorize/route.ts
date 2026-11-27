import { z } from "zod";
import { WalletDelegationSchema, bigintJson, verifyWalletDelegation } from "@/lib/borel/server-api";
import { sessionPubkeyIsValid } from "@/lib/borel/server-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sessionPubkey: z.string().trim().refine(sessionPubkeyIsValid, "sessionPubkey must be a base58 address"),
  delegation: WalletDelegationSchema,
});

/**
 * Verifies the wallet's one-time delegation of an ephemeral session key for a Borel room. Called at join so a
 * bad signature fails loudly up front; every later lock / pivot re-verifies the same delegation statelessly.
 */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bigintJson({ status: "error", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  const { sessionPubkey, delegation } = parsed.data;
  const verdict = await verifyWalletDelegation({ roomId: delegation.roomId, sessionPubkey, delegation });
  if (!verdict.ok) return bigintJson({ status: "error", reason: verdict.reason }, 401);
  return bigintJson({
    status: "ok",
    walletAddress: verdict.walletAddress,
    roomId: delegation.roomId,
    sessionPubkey,
    expiresAt: delegation.expiresAt,
  });
}
