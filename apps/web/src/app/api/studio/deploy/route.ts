import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  CARTRIDGE_PROGRAM_IDS,
  CartridgeManifestV2Schema,
  MAGICBLOCK_CONSTANTS,
  simulateCartridgeEconomy,
  validateManifestCompliance,
} from "@cartridgefi/shared-types";

const CORE_API_URL = process.env.CARTRIDGEFI_API_URL ?? "http://127.0.0.1:8787";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) {
    num = (num << 8n) + BigInt(b);
  }
  let encoded = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    num /= 58n;
    encoded = (BASE58_ALPHABET[rem] ?? "1") + encoded;
  }
  for (const b of bytes) {
    if (b === 0) encoded = `1${encoded}`;
    else break;
  }
  return encoded || "1";
}

function deterministicAddress(seedLabel: string): string {
  const digest = createHash("sha256").update(seedLabel).digest();
  return encodeBase58(digest);
}

export async function POST(req: Request): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 },
    );
  }

  const candidate =
    typeof rawBody === "object" &&
    rawBody !== null &&
    "manifest" in rawBody
      ? (rawBody as { manifest: unknown }).manifest
      : rawBody;

  const parsed = CartridgeManifestV2Schema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Manifest schema validation failed",
        issues: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      },
      { status: 422 },
    );
  }

  const compliance = validateManifestCompliance(parsed.data);
  if (!compliance.valid) {
    return NextResponse.json(
      {
        error: "Compliance guardrail blocked deployment",
        violations: compliance.violations,
      },
      { status: 422 },
    );
  }

  const configuredApi =
    process.env.CARTRIDGEFI_API_URL ?? process.env.NEXT_PUBLIC_CORE_API_URL;
  if (Boolean(configuredApi) || process.env.VERCEL !== "1") {
    try {
      const upstream = await fetch(`${configuredApi ?? CORE_API_URL}/v1/rooms/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: parsed.data,
          network: "devnet",
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (upstream.ok) {
        const deployed = (await upstream.json()) as Record<string, unknown>;
        return NextResponse.json({
          ...deployed,
          routedVia: "cartridge-core-api",
        });
      }
    } catch {
      // Standalone deterministic derivation fallback
    }
  }

  const slug = parsed.data.metadata.slug;
  const manifestPda = deterministicAddress(
    `cartridge:${CARTRIDGE_PROGRAM_IDS.registry}:${slug}`,
  );
  const roomShardPda = deterministicAddress(
    `room_shard:${CARTRIDGE_PROGRAM_IDS.erRoom}:${slug}:0`,
  );
  const permissionPda = deterministicAddress(
    `permission:${MAGICBLOCK_CONSTANTS.permissionProgramId}:${roomShardPda}`,
  );
  const sim = simulateCartridgeEconomy(parsed.data, "calm", 500, 24);

  return NextResponse.json({
    routedVia: "standalone-deterministic",
    network: "devnet",
    roomId: `room_${slug}_shard0`,
    slug,
    registryProgramId: CARTRIDGE_PROGRAM_IDS.registry,
    erRoomProgramId: CARTRIDGE_PROGRAM_IDS.erRoom,
    delegationProgramId: MAGICBLOCK_CONSTANTS.delegationProgramId,
    permissionProgramId: MAGICBLOCK_CONSTANTS.permissionProgramId,
    manifestPda,
    roomShardPda,
    permissionPda,
    explorerUrl: `https://explorer.solana.com/address/${CARTRIDGE_PROGRAM_IDS.erRoom}?cluster=devnet`,
    playableUrl:
      parsed.data.metadata.genre === "ARCADE_RUNNER"
        ? `/play/pulse-runner?cartridge=${encodeURIComponent(slug)}`
        : `/play/borel?cartridge=${encodeURIComponent(slug)}`,
    simulation: sim,
  });
}
