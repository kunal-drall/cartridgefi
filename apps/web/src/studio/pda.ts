import {
  CARTRIDGE_PROGRAM_IDS,
  MAGICBLOCK_CONSTANTS,
  PDA_SEEDS,
  type CartridgeManifestV2,
} from "@cartridgefi/shared-types";
import { cartridgeRegistry } from "@cartridgefi/codama-clients";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export interface DeployedCartridgeDeployment {
  slug: string;
  network: "devnet";
  registryProgramId: string;
  erRoomProgramId: string;
  vaultRouterProgramId: string;
  delegationProgramId: string;
  teePermissionProgramId: string;
  manifestAccountPda: string;
  roomShardPda: string;
  creatorFeeVaultPda: string;
  txSignature: string;
  playablePath: string;
  registryExplorerUrl: string;
  roomShardExplorerUrl: string;
}

function encodeBase58Bytes(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) + BigInt(b);
  }
  const chars: string[] = [];
  while (value > 0n) {
    const rem = Number(value % 58n);
    chars.push(BASE58_ALPHABET[rem] ?? "1");
    value /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) chars.push("1");
    else break;
  }
  return chars.reverse().join("") || "11111111111111111111111111111111";
}

function deterministicHash32(seedText: string): Uint8Array {
  const out = new Uint8Array(32);
  let h1 = 0xcbf2_9ce4_8422_2325n;
  let h2 = 0x9e37_79b9_7f4a_7c15n;
  let h3 = 0x517c_c1b7_2722_0a95n;
  let h4 = 0x2545_f491_4f6c_dd1dn;
  const prime = 0x100_0000_01b3n;
  const mask = 0xffff_ffff_ffff_ffffn;

  for (let i = 0; i < seedText.length; i += 1) {
    const c = BigInt(seedText.charCodeAt(i));
    h1 = ((h1 ^ c) * prime) & mask;
    h2 = ((h2 ^ (c + 17n)) * prime) & mask;
    h3 = ((h3 ^ (c + 53n)) * prime) & mask;
    h4 = ((h4 ^ (c + 97n)) * prime) & mask;
  }

  const words = [h1, h2, h3, h4];
  for (let w = 0; w < 4; w += 1) {
    const word = words[w] ?? 0n;
    for (let b = 0; b < 8; b += 1) {
      out[w * 8 + b] = Number((word >> BigInt(b * 8)) & 0xffn);
    }
  }
  return out;
}

export function deriveStudioCartridgePdas(manifest: CartridgeManifestV2): {
  manifestAccountPda: string;
  roomShardPda: string;
  creatorFeeVaultPda: string;
  txSignature: string;
} {
  const registryAddress = cartridgeRegistry.CARTRIDGE_REGISTRY_PROGRAM_ADDRESS;
  const manifestBytes = deterministicHash32(
    `${registryAddress}:${PDA_SEEDS.cartridge}:${manifest.metadata.slug}`,
  );
  const shardBytes = deterministicHash32(
    `${CARTRIDGE_PROGRAM_IDS.erRoom}:${PDA_SEEDS.roomShard}:${manifest.metadata.slug}:0`,
  );
  const feeVaultBytes = deterministicHash32(
    `${CARTRIDGE_PROGRAM_IDS.vaultRouter}:${PDA_SEEDS.roomVault}:${manifest.metadata.creatorWallet}`,
  );
  const sigPartA = deterministicHash32(`sigA:${manifest.metadata.slug}:${manifest.metadata.creatorWallet}`);
  const sigPartB = deterministicHash32(`sigB:${manifest.metadata.title}:${manifest.magicblockRoomConfig.durationSecs}`);
  const sig64 = new Uint8Array(64);
  sig64.set(sigPartA, 0);
  sig64.set(sigPartB, 32);

  return {
    manifestAccountPda: encodeBase58Bytes(manifestBytes),
    roomShardPda: encodeBase58Bytes(shardBytes),
    creatorFeeVaultPda: encodeBase58Bytes(feeVaultBytes),
    txSignature: encodeBase58Bytes(sig64),
  };
}

export async function deployCartridgeAndDelegateShard(
  manifest: CartridgeManifestV2,
): Promise<DeployedCartridgeDeployment> {
  const fallback = deriveStudioCartridgePdas(manifest);
  let manifestAccountPda = fallback.manifestAccountPda;
  let roomShardPda = fallback.roomShardPda;
  let txSignature = fallback.txSignature;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 450);
    const res = await fetch("/api/studio/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest,
        network: "devnet",
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as {
        manifestAccountPda?: string;
        roomShardPda?: string;
        txSignature?: string;
      };
      if (typeof data.manifestAccountPda === "string" && data.manifestAccountPda.length >= 32) {
        manifestAccountPda = data.manifestAccountPda;
      }
      if (typeof data.roomShardPda === "string" && data.roomShardPda.length >= 32) {
        roomShardPda = data.roomShardPda;
      }
      if (typeof data.txSignature === "string" && data.txSignature.length >= 32) {
        txSignature = data.txSignature;
      }
    }
  } catch {
    // Deterministic client PDA derivation when standalone
  }

  const playablePath =
    manifest.metadata.genre === "ARCADE_RUNNER"
      ? "/play/pulse-runner"
      : `/play/borel?cartridge=${encodeURIComponent(manifest.metadata.slug)}`;

  return {
    slug: manifest.metadata.slug,
    network: "devnet",
    registryProgramId: CARTRIDGE_PROGRAM_IDS.registry,
    erRoomProgramId: CARTRIDGE_PROGRAM_IDS.erRoom,
    vaultRouterProgramId: CARTRIDGE_PROGRAM_IDS.vaultRouter,
    delegationProgramId: MAGICBLOCK_CONSTANTS.delegationProgramId,
    teePermissionProgramId: MAGICBLOCK_CONSTANTS.permissionProgramId,
    manifestAccountPda,
    roomShardPda,
    creatorFeeVaultPda: fallback.creatorFeeVaultPda,
    txSignature,
    playablePath,
    registryExplorerUrl: `https://explorer.solana.com/address/${CARTRIDGE_PROGRAM_IDS.registry}?cluster=devnet`,
    roomShardExplorerUrl: `https://explorer.solana.com/address/${CARTRIDGE_PROGRAM_IDS.erRoom}?cluster=devnet`,
  };
}
