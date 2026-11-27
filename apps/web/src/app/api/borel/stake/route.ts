import { z } from "zod";
import { address, isAddress } from "@solana/kit";
import { bigintJson } from "@/lib/borel/server-api";
import { sessionPubkeyIsValid } from "@/lib/borel/server-chain";
import {
  STAKES_PAUSED_REASON,
  StakeRuleError,
  buildStakeForWallet,
  stakingEnabled,
  getStakeStatus,
  submitSignedStake,
  verifyStakeAuth,
} from "@/lib/borel/server-stakes";
import { isRelayerConfigured } from "@/lib/relayer/config";
import { checkRateLimit, clientIpFromRequest } from "@/lib/relayer/rate-limit";
import { RelayerTxError } from "@/lib/relayer/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RoomId = z.string().trim().min(1).max(64);
const SessionPubkey = z.string().trim().refine(sessionPubkeyIsValid, "sessionPubkey must be a base58 address");
const Wallet = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "wallet must be a base58 Solana address")
  .refine((v) => isAddress(v), "wallet must be a valid Solana address");

const BuildSchema = z.object({
  action: z.literal("build"),
  roomId: RoomId,
  sessionPubkey: SessionPubkey,
  wallet: Wallet,
  /** test-USDC base units (6 decimals) as a decimal string. */
  amountUnits: z.string().regex(/^\d{1,12}$/, "amountUnits must be an integer string"),
  auth: z.object({
    expiresAt: z.number().int().positive(),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/),
  }),
});

const SubmitSchema = z.object({
  action: z.literal("submit"),
  roomId: RoomId,
  sessionPubkey: SessionPubkey,
  wallet: Wallet,
  transaction: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, "transaction must be base64").max(2_400),
  token: z.string().regex(/^[0-9a-f]{64}$/, "token must be 64 hex chars"),
});

const PostSchema = z.discriminatedUnion("action", [BuildSchema, SubmitSchema]);

function issues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

function limited(keys: string[]) {
  for (const key of keys) {
    const verdict = checkRateLimit(key);
    if (!verdict.allowed) {
      const res = bigintJson({ status: "error", reason: `Rate limited — retry in ${verdict.retryAfterSecs}s` }, 429);
      res.headers.set("retry-after", String(verdict.retryAfterSecs));
      return res;
    }
  }
  return null;
}

function failure(err: unknown, fallback: string) {
  if (err instanceof StakeRuleError) return bigintJson({ status: "error", reason: err.message }, 400);
  if (err instanceof RelayerTxError) return bigintJson({ status: "error", reason: err.message, logs: err.logs }, 502);
  return bigintJson({ status: "error", reason: err instanceof Error ? err.message.slice(0, 400) : fallback }, 502);
}

/**
 * POST /api/borel/stake
 *   {action:"build", roomId, sessionPubkey, wallet, amountUnits, auth}
 *     → {status:"ok", transaction (base64, relayer + player signed), token, envelope, roomVault, ...}
 *   {action:"submit", roomId, sessionPubkey, wallet, transaction (wallet-signed), token}
 *     → {status:"ok", envelope, receipt}
 */
export async function POST(req: Request) {
  if (!stakingEnabled()) return bigintJson({ status: "error", reason: STAKES_PAUSED_REASON }, 503);
  if (!isRelayerConfigured()) {
    return bigintJson({ status: "error", reason: "Relayer is not configured on this deployment" }, 503);
  }
  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bigintJson({ status: "error", reason: issues(parsed.error) }, 400);
  const body = parsed.data;
  const blocked = limited([`borel-stake:ip:${clientIpFromRequest(req)}`, `borel-stake:wallet:${body.wallet}`]);
  if (blocked) return blocked;

  if (body.action === "build") {
    const amountUnits = BigInt(body.amountUnits);
    const authError = await verifyStakeAuth({
      roomId: body.roomId,
      sessionPubkey: body.sessionPubkey,
      walletAddress: body.wallet,
      amountUnits,
      expiresAt: body.auth.expiresAt,
      signature: body.auth.signature,
    });
    if (authError) return bigintJson({ status: "error", reason: authError }, 401);
    try {
      const built = await buildStakeForWallet({
        roomId: body.roomId,
        sessionPubkey: body.sessionPubkey,
        wallet: address(body.wallet),
        amountUnits,
        nowMs: Date.now(),
      });
      return bigintJson({ status: "ok", ...built });
    } catch (err) {
      return failure(err, "Stake build failed");
    }
  }

  try {
    const result = await submitSignedStake({
      roomId: body.roomId,
      sessionPubkey: body.sessionPubkey,
      wallet: address(body.wallet),
      transaction: body.transaction,
      token: body.token,
      nowMs: Date.now(),
    });
    return bigintJson({ status: "ok", ...result });
  } catch (err) {
    return failure(err, "Stake submit failed");
  }
}

const StatusSchema = z.object({ roomId: RoomId, sessionPubkey: SessionPubkey });

/** GET /api/borel/stake?roomId=&sessionPubkey= → on-chain SessionRiskEnvelope + RoomVault status. */
export async function GET(req: Request) {
  if (!stakingEnabled()) return bigintJson({ status: "error", reason: STAKES_PAUSED_REASON }, 503);
  if (!isRelayerConfigured()) {
    return bigintJson({ status: "error", reason: "Relayer is not configured on this deployment" }, 503);
  }
  const url = new URL(req.url);
  const parsed = StatusSchema.safeParse({ roomId: url.searchParams.get("roomId"), sessionPubkey: url.searchParams.get("sessionPubkey") });
  if (!parsed.success) return bigintJson({ status: "error", reason: issues(parsed.error) }, 400);
  const blocked = limited([`borel-stake-status:ip:${clientIpFromRequest(req)}`]);
  if (blocked) return blocked;
  try {
    return bigintJson({ status: "ok", ...(await getStakeStatus(parsed.data.roomId, parsed.data.sessionPubkey)) });
  } catch (err) {
    return failure(err, "Stake status failed");
  }
}
