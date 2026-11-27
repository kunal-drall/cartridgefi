import { bigintJson, guardRequest, relayerContext, snapshotJson, verifySessionAuth } from "@/lib/borel/server-api";
import { parseRoomId, readRoomState, sessionPubkeyIsValid } from "@/lib/borel/server-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guardRequest(req, { rateLimit: false });
  if (blocked) return blocked;
  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId") ?? "";
  const room = parseRoomId(roomId);
  if (!room) return bigintJson({ status: "error", reason: "Unknown roomId" }, 400);

  // Optional session auth: only an authenticated caller sees their own live score while sealed.
  let viewerSession: string | undefined;
  const sessionPubkey = url.searchParams.get("sessionPubkey") ?? "";
  const signature = url.searchParams.get("signature") ?? "";
  const expiresAt = Number(url.searchParams.get("expiresAt") ?? "0");
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
