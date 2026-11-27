import type { KeyPairSigner } from "@solana/kit";
import type { SerializedInstructionPayload } from "@cartridgefi/sdk";
import type { CartridgeManifestV2 } from "@cartridgefi/shared-types";
import {
  executeOrSimulateInstructionOnDevnet,
  type DevnetExecutionResult,
} from "@/lib/solana-wallet";

export interface DeployedCartridgeDeployment {
  slug: string;
  network: "devnet";
  registryProgramId: string;
  erRoomProgramId: string;
  vaultRouterProgramId: string;
  delegationProgramId: string;
  teePermissionProgramId: string;
  engineConfigPda: string;
  manifestAccountPda: string;
  roomShardPda: string;
  roomVaultPda: string;
  creatorFeeVaultPda: string;
  manifestExistsOnDevnet: boolean;
  registerCartridgeInstruction: SerializedInstructionPayload;
  initializeRoomShardInstruction: SerializedInstructionPayload;
  devnetExecution: DevnetExecutionResult | null;
  playablePath: string;
  manifestSolscanUrl: string;
  erProgramSolscanUrl: string;
}

export async function deployCartridgeAndDelegateShard(
  manifest: CartridgeManifestV2,
  signer?: KeyPairSigner | null,
): Promise<DeployedCartridgeDeployment> {
  const res = await fetch("/api/studio/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      manifest,
      creatorWallet: signer?.address ?? manifest.metadata.creatorWallet,
      shardIndex: 0,
    }),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? "Failed to derive canonical deployment plan");
  }

  const data = (await res.json()) as {
    slug: string;
    registryProgramId: string;
    erRoomProgramId: string;
    vaultRouterProgramId: string;
    delegationProgramId: string;
    permissionProgramId: string;
    engineConfigPda: string;
    manifestPda: string;
    roomShardPda: string;
    roomVaultPda: string;
    creatorFeeVaultPda: string;
    onchainStatus: {
      manifestExistsOnDevnet: boolean;
    };
    registerCartridgeInstruction: SerializedInstructionPayload;
    initializeRoomShardInstruction: SerializedInstructionPayload;
    playableUrl: string;
    explorerUrl: string;
    erProgramSolscanUrl: string;
  };

  let devnetExecution: DevnetExecutionResult | null = null;
  if (signer) {
    devnetExecution = await executeOrSimulateInstructionOnDevnet(
      signer,
      data.registerCartridgeInstruction,
    );
  }

  return {
    slug: data.slug,
    network: "devnet",
    registryProgramId: data.registryProgramId,
    erRoomProgramId: data.erRoomProgramId,
    vaultRouterProgramId: data.vaultRouterProgramId,
    delegationProgramId: data.delegationProgramId,
    teePermissionProgramId: data.permissionProgramId,
    engineConfigPda: data.engineConfigPda,
    manifestAccountPda: data.manifestPda,
    roomShardPda: data.roomShardPda,
    roomVaultPda: data.roomVaultPda,
    creatorFeeVaultPda: data.creatorFeeVaultPda,
    manifestExistsOnDevnet: data.onchainStatus.manifestExistsOnDevnet,
    registerCartridgeInstruction: data.registerCartridgeInstruction,
    initializeRoomShardInstruction: data.initializeRoomShardInstruction,
    devnetExecution,
    playablePath: data.playableUrl,
    manifestSolscanUrl: data.explorerUrl,
    erProgramSolscanUrl: data.erProgramSolscanUrl,
  };
}
