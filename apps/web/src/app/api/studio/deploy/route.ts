import { NextResponse } from "next/server";
import { deriveCartridgeDeploymentPlan } from "@cartridgefi/sdk";
import {
  CartridgeManifestV2Schema,
  simulateCartridgeEconomy,
  validateManifestCompliance,
} from "@cartridgefi/shared-types";
import devnetProof from "@/data/devnet-proof.json";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? devnetProof.clusters.solanaDevnetRpc;

async function checkOnchainAccountExists(pubkey: string): Promise<{
  exists: boolean;
  lamports: number;
  owner: string | null;
}> {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [pubkey, { encoding: "base64", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      result?: { value: { lamports: number; owner: string } | null };
    };
    const val = json.result?.value;
    if (!val) return { exists: false, lamports: 0, owner: null };
    return { exists: true, lamports: val.lamports, owner: val.owner };
  } catch {
    return { exists: false, lamports: 0, owner: null };
  }
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

  const bodyObj =
    typeof rawBody === "object" && rawBody !== null
      ? (rawBody as { manifest?: unknown; creatorWallet?: unknown; shardIndex?: unknown })
      : {};

  const candidate = "manifest" in bodyObj ? bodyObj.manifest : rawBody;

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

  const manifestWithCreator =
    typeof bodyObj.creatorWallet === "string" &&
    bodyObj.creatorWallet.trim().length >= 32
      ? {
          ...parsed.data,
          metadata: {
            ...parsed.data.metadata,
            creatorWallet: bodyObj.creatorWallet.trim(),
          },
        }
      : parsed.data;

  const shardIndex =
    typeof bodyObj.shardIndex === "number" &&
    Number.isInteger(bodyObj.shardIndex) &&
    bodyObj.shardIndex >= 0
      ? bodyObj.shardIndex
      : 0;

  // Derive real canonical off-curve Solana PDAs & Borsh Codama instruction payloads
  const plan = await deriveCartridgeDeploymentPlan(manifestWithCreator, {
    shardIndex,
    network: "devnet",
  });

  // Check live Solana Devnet state for the derived Manifest PDA & Shard PDA
  const [manifestChainState, shardChainState] = await Promise.all([
    checkOnchainAccountExists(plan.cartridgeManifestPda),
    checkOnchainAccountExists(plan.roomShardPda),
  ]);

  const sim = simulateCartridgeEconomy(manifestWithCreator, "calm", 500, 24);

  return NextResponse.json({
    routedVia: "codama-canonical-pda",
    network: "devnet",
    roomId: plan.roomId,
    slug: plan.slug,
    slugHashHex: plan.slugHashHex,
    eventIdHex: plan.eventIdHex,
    shardIndex: plan.shardIndex,
    creatorAddress: plan.creatorAddress,
    engineConfigPda: plan.engineConfigPda,
    manifestPda: plan.cartridgeManifestPda,
    manifestBump: plan.cartridgeManifestBump,
    roomShardPda: plan.roomShardPda,
    roomShardBump: plan.roomShardBump,
    roomVaultPda: plan.roomVaultPda,
    creatorFeeVaultPda: plan.creatorFeeVaultPda,
    registryProgramId: plan.registryProgramId,
    erRoomProgramId: plan.erRoomProgramId,
    vaultRouterProgramId: plan.vaultRouterProgramId,
    delegationProgramId: plan.delegationProgramId,
    permissionProgramId: plan.permissionProgramId,
    onchainStatus: {
      manifestExistsOnDevnet: manifestChainState.exists,
      manifestLamports: manifestChainState.lamports,
      shardExistsOnDevnet: shardChainState.exists,
      shardOwner: shardChainState.owner,
    },
    registerCartridgeInstruction: plan.registerCartridgeInstruction,
    initializeRoomShardInstruction: plan.initializeRoomShardInstruction,
    explorerUrl: `https://solscan.io/account/${plan.cartridgeManifestPda}?cluster=devnet`,
    erProgramSolscanUrl: `https://solscan.io/account/${plan.erRoomProgramId}?cluster=devnet`,
    playableUrl:
      manifestWithCreator.metadata.genre === "ARCADE_RUNNER"
        ? `/play/pulse-runner?cartridge=${encodeURIComponent(plan.slug)}`
        : `/play/borel?cartridge=${encodeURIComponent(plan.slug)}`,
    simulation: sim,
  });
}
