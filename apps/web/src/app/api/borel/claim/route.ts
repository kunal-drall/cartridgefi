import { z } from "zod";
import { bigintJson } from "@/lib/borel/server-api";
import { sessionPubkeyIsValid } from "@/lib/borel/server-chain";
import { STAKES_PAUSED_REASON, StakeRuleError, claimForSession, stakingEnabled } from "@/lib/borel/server-stakes";
import { isRelayerConfigured } from "@/lib/relayer/config";
import { checkRateLimit, clientIpFromRequest } from "@/lib/relayer/rate-limit";
import { RelayerTxError } from "@/lib/relayer/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ClaimSchema = z.object({
  roomId: z.string().trim().min(1).max(64),
  sessionPubkey: z.string().trim().refine(sessionPubkeyIsValid, "sessionPubkey must be a base58 address"),
});

/**
 * POST /api/borel/claim {roomId, sessionPubkey}
 * cartridge_vault_router.claim_prize for a settled envelope, forwarded in the same transaction to the wallet
 * that signed the stake (recorded in the authenticated stake memo). Settle already pushes payouts; this is
 * the idempotent retry. No signature needed: the payout destination is fixed on-chain.
 */
export async function POST(req: Request) {
  if (!stakingEnabled()) return bigintJson({ status: "error", reason: STAKES_PAUSED_REASON }, 503);
  if (!isRelayerConfigured()) {
    return bigintJson({ status: "error", reason: "Relayer is not configured on this deployment" }, 503);
  }
  const parsed = ClaimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bigintJson({ status: "error", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  const verdict = checkRateLimit(`borel-claim:ip:${clientIpFromRequest(req)}`);
  if (!verdict.allowed) {
    const res = bigintJson({ status: "error", reason: `Rate limited — retry in ${verdict.retryAfterSecs}s` }, 429);
    res.headers.set("retry-after", String(verdict.retryAfterSecs));
    return res;
  }
  try {
    return bigintJson({ status: "ok", ...(await claimForSession(parsed.data.roomId, parsed.data.sessionPubkey)) });
  } catch (err) {
    if (err instanceof StakeRuleError) return bigintJson({ status: "error", reason: err.message }, 400);
    if (err instanceof RelayerTxError) return bigintJson({ status: "error", reason: err.message, logs: err.logs }, 502);
    return bigintJson({ status: "error", reason: err instanceof Error ? err.message.slice(0, 400) : "Claim failed" }, 502);
  }
}
