import { bigintJson, guardRequest, relayerContext, snapshotJson, verifySessionAuth } from "@/lib/borel/server-api";
import { parseRoomId, readRoomState, sessionPubkeyIsValid } from "@/lib/borel/server-chain";
import { RATE_LIMITS, withRateLimit } from "@/lib/relayer/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getRoom(req: Request): Promise<Response> {
  const blocked = guardRequest(req, { rateLimit: false });
  if (blocked) return blocked;
  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId") ?? "";
  const room = parseRoomId(roomId);
  if (!room) return bigintJson({ status: "error", reason: "Unknown roomId" }, 400);

  // Optional session auth: only an authenticated caller sees their own live score while sealed. The
  // signature travels in request headers, never the URL, so it stays out of logs and history (§5 L2).
  let viewerSession: string | undefined;
  const sessionPubkey = req.headers.get("x-borel-session") ?? "";
  const signature = req.headers.get("x-borel-signature") ?? "";
  const expiresAt = Number(req.headers.get("x-borel-expires-at") ?? "0");
  if (sessionPubkey && signature && sessionPubkeyIsValid(sessionPubkey) && Number.isSafeInteger(expiresAt)) {
    const authError = await verifySessionAuth({
      action: "room",
      roomId,
      sessionPubkey,
      params: {},
      auth: { expiresAt, signature },
    });
    if (!authError) viewerSession = sessionPubkey;
  }

  try {
    const ctx = await relayerContext();
    const state = await readRoomState(room, ctx.payer, ctx.signer.address, Date.now(), viewerSession);
    return bigintJson({ status: "ok", ...snapshotJson(state, ctx) });
  } catch (err) {
    return bigintJson({ status: "error", reason: err instanceof Error ? err.message.slice(0, 400) : "Room read failed" });
  }
}

/** Per-IP rate limit (in-memory per instance): each read walks the room's signatures on devnet RPC. */
export const GET = withRateLimit(RATE_LIMITS.borelRoom, getRoom);
