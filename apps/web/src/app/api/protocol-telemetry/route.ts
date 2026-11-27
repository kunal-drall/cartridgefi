import { NextResponse } from "next/server";
import type { ReadonlyUint8Array } from "@solana/kit";
import {
  cartridgeErRoom,
  cartridgeRegistry,
  cartridgeVaultRouter,
} from "@cartridgefi/codama-clients";
import devnetProof from "@/data/devnet-proof.json";

async function safeServerRpc<T>(
  endpoint: string,
  method: string,
  params: unknown[],
  timeoutMs = 3500,
): Promise<{ result: T | null; elapsedMs: number }> {
  const start = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const elapsedMs = Math.max(1, Math.round(performance.now() - start));
    if (!res.ok) {
      return { result: null, elapsedMs };
    }
    const parsed = (await res.json()) as { result?: T };
    return { result: parsed.result ?? null, elapsedMs };
  } catch {
    return {
      result: null,
      elapsedMs: Math.max(1, Math.round(performance.now() - start)),
    };
  }
}

function decodeTokenAmountFromBase64(base64Str: string): string | null {
  try {
    const buf = Buffer.from(base64Str, "base64");
    if (buf.length < 72) return null;
    return buf.readBigUInt64LE(64).toString();
  } catch {
    return null;
  }
}

function bytesEqualPrefix(a: Uint8Array, b: ReadonlyUint8Array): boolean {
  if (a.length < b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function decodeUtf8Fixed(bytes: ReadonlyUint8Array): string {
  const end = bytes.indexOf(0);
  const slice = end >= 0 ? bytes.subarray(0, end) : bytes;
  return new TextDecoder().decode(slice).trim();
}

function toHex(bytes: ReadonlyUint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return out;
}

export interface DecodedOnchainManifest {
  pubkey: string;
  creator: string;
  creatorFeeVault: string;
  creatorShareBps: number;
  genreCode: number;
  durationSecs: number;
  fogOfWarBps: number;
  maxRebalances: number;
  manifestUri: string;
  totalRoomsCreated: string;
  lamports: number;
}

export interface DecodedOnchainShard {
  pubkey: string;
  owner: string;
  delegatedToMagicBlock: boolean;
  shardIndex: number;
  cartridgeManifest: string;
  authority: string;
  phase: number;
  isPrivateFog: boolean;
  playerCount: number;
  evaluatedCount: number;
  roomPoolUsdc: string;
  vrfFulfilled: boolean;
  vrfSeedHex: string;
  lamports: number;
}

export interface DecodedOnchainVault {
  pubkey: string;
  roomShard: string;
  usdcMint: string;
  platformFeeAccount: string;
  creatorShareBps: number;
  totalFeeBps: number;
  roomPoolUsdc: string;
  totalDistributedUsdc: string;
  totalClaimedUsdc: string;
  settled: boolean;
  lamports: number;
}

export interface RecentOnchainSignature {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: boolean;
  programLabel: string;
}

let cachedTelemetry: { expiresAt: number; payload: Record<string, unknown> } | null =
  null;

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cachedTelemetry && cachedTelemetry.expiresAt > now) {
    return NextResponse.json(cachedTelemetry.payload);
  }

  const solanaRpc =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    devnetProof.clusters.solanaDevnetRpc;
  const routerRpc =
    process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL ??
    devnetProof.clusters.magicblockRouterRpc;
  const publicErRpc = devnetProof.clusters.magicblockPublicErRpc;
  const teeRpc =
    process.env.NEXT_PUBLIC_MAGICBLOCK_TEE_URL ??
    devnetProof.clusters.magicblockPrivateTeeRpc;

  const programPubkeys = [
    devnetProof.programs.cartridgeErRoom.programId,
    devnetProof.programs.cartridgeVaultRouter.programId,
    devnetProof.programs.cartridgeRegistry.programId,
    devnetProof.programs.cartridgePassport.programId,
  ];

  type RawProgramAccountEntry = {
    pubkey: string;
    account: {
      lamports: number;
      owner: string;
      data: [string, string];
    };
  };

  type RawSigEntry = {
    signature: string;
    slot: number;
    blockTime: number | null;
    err: unknown;
  };

  const [
    l1Slot,
    routerRoutes,
    erVer,
    teeId,
    erOracleInfo,
    multiAcc,
    registryAccounts,
    erRoomAccounts,
    vaultAccounts,
    passportAccounts,
    erRoomSigs,
    feeAccSigs,
  ] = await Promise.all([
    safeServerRpc<number>(solanaRpc, "getSlot", [{ commitment: "confirmed" }]),
    safeServerRpc<
      Array<{ fqdn: string; identity?: string; blockTimeMs?: number }>
    >(routerRpc, "getRoutes", []),
    safeServerRpc<Record<string, string>>(publicErRpc, "getVersion", []),
    safeServerRpc<{ identity: string }>(teeRpc, "getIdentity", []),
    safeServerRpc<{
      value: { owner: string; lamports: number; data: [string, string] } | null;
    }>(publicErRpc, "getAccountInfo", [
      "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
      { encoding: "base64" },
    ]),
    safeServerRpc<{
      value: Array<{
        executable: boolean;
        lamports: number;
        owner: string;
        data: [string, string];
      } | null>;
    }>(solanaRpc, "getMultipleAccounts", [
      [
        ...programPubkeys,
        devnetProof.accounts.platformFeeAccountAta,
        devnetProof.accounts.settledRoomShardPda,
      ],
      { encoding: "base64", commitment: "confirmed" },
    ]),
    safeServerRpc<RawProgramAccountEntry[]>(solanaRpc, "getProgramAccounts", [
      devnetProof.programs.cartridgeRegistry.programId,
      { encoding: "base64", commitment: "confirmed" },
    ]),
    safeServerRpc<RawProgramAccountEntry[]>(solanaRpc, "getProgramAccounts", [
      devnetProof.programs.cartridgeErRoom.programId,
      { encoding: "base64", commitment: "confirmed" },
    ]),
    safeServerRpc<RawProgramAccountEntry[]>(solanaRpc, "getProgramAccounts", [
      devnetProof.programs.cartridgeVaultRouter.programId,
      { encoding: "base64", commitment: "confirmed" },
    ]),
    safeServerRpc<RawProgramAccountEntry[]>(solanaRpc, "getProgramAccounts", [
      devnetProof.programs.cartridgePassport.programId,
      { encoding: "base64", commitment: "confirmed" },
    ]),
    safeServerRpc<RawSigEntry[]>(solanaRpc, "getSignaturesForAddress", [
      devnetProof.programs.cartridgeErRoom.programId,
      { limit: 12 },
    ]),
    safeServerRpc<RawSigEntry[]>(solanaRpc, "getSignaturesForAddress", [
      devnetProof.accounts.platformFeeAccountAta,
      { limit: 8 },
    ]),
  ]);

  const programStates: Record<
    string,
    { executable: boolean; lamports: string; accountCount: number }
  > = {};

  const accountCounts: Record<string, number> = {
    [devnetProof.programs.cartridgeErRoom.programId]:
      erRoomAccounts.result?.length ?? 0,
    [devnetProof.programs.cartridgeVaultRouter.programId]:
      vaultAccounts.result?.length ?? 0,
    [devnetProof.programs.cartridgeRegistry.programId]:
      registryAccounts.result?.length ?? 0,
    [devnetProof.programs.cartridgePassport.programId]:
      passportAccounts.result?.length ?? 0,
  };

  let liveFeeBalanceUnits: string | null = null;
  let liveShardStatus = "Unknown";

  const accList = multiAcc.result?.value;
  if (accList && accList.length >= 6) {
    for (let i = 0; i < 4; i++) {
      const pk = programPubkeys[i]!;
      const item = accList[i];
      if (item) {
        programStates[pk] = {
          executable: item.executable,
          lamports: BigInt(item.lamports).toString(),
          accountCount: accountCounts[pk] ?? 0,
        };
      }
    }
    const feeAcc = accList[4];
    if (feeAcc?.data?.[0]) {
      liveFeeBalanceUnits = decodeTokenAmountFromBase64(feeAcc.data[0]);
    }
    const shardAcc = accList[5];
    if (shardAcc) {
      liveShardStatus =
        shardAcc.owner === devnetProof.programs.magicblockDelegation
          ? "Delegated to MagicBlock ER"
          : "Committed & Restored on Solana L1";
    }
  }

  // Decode live Borsh accounts from cartridge-registry
  const manifestDisc =
    cartridgeRegistry.getCartridgeManifestAccountDiscriminatorBytes();
  const engineDisc = cartridgeRegistry.getEngineConfigDiscriminatorBytes();
  const manifestDecoder =
    cartridgeRegistry.getCartridgeManifestAccountDecoder();
  const engineDecoder = cartridgeRegistry.getEngineConfigDecoder();

  let engineConfigDecoded: {
    pubkey: string;
    adminMultisig: string;
    platformFeeAccount: string;
    privateBetaMode: boolean;
    paused: boolean;
    maxRoomPoolUsdc: string;
    currentGlobalTvlUsdc: string;
  } | null = null;

  const manifests: DecodedOnchainManifest[] = [];
  for (const entry of registryAccounts.result ?? []) {
    try {
      const bytes = new Uint8Array(
        Buffer.from(entry.account.data[0], "base64"),
      );
      if (bytesEqualPrefix(bytes, manifestDisc)) {
        const decoded = manifestDecoder.decode(bytes);
        manifests.push({
          pubkey: entry.pubkey,
          creator: decoded.creator,
          creatorFeeVault: decoded.creatorFeeVault,
          creatorShareBps: decoded.creatorShareBps,
          genreCode: decoded.genreCode,
          durationSecs: decoded.durationSecs,
          fogOfWarBps: decoded.fogOfWarBps,
          maxRebalances: decoded.maxRebalances,
          manifestUri: decodeUtf8Fixed(decoded.manifestUri),
          totalRoomsCreated: decoded.totalRoomsCreated.toString(),
          lamports: entry.account.lamports,
        });
      } else if (bytesEqualPrefix(bytes, engineDisc)) {
        const decoded = engineDecoder.decode(bytes);
        engineConfigDecoded = {
          pubkey: entry.pubkey,
          adminMultisig: decoded.adminMultisig,
          platformFeeAccount: decoded.platformFeeAccount,
          privateBetaMode: decoded.privateBetaMode,
          paused: decoded.paused,
          maxRoomPoolUsdc: decoded.maxRoomPoolUsdc.toString(),
          currentGlobalTvlUsdc: decoded.currentGlobalTvlUsdc.toString(),
        };
      }
    } catch {
      // Skip unrecognized account sizes
    }
  }

  // Decode live RoomShard accounts from cartridge-er-room
  const shardDisc = cartridgeErRoom.getRoomShardDiscriminatorBytes();
  const shardDecoder = cartridgeErRoom.getRoomShardDecoder();
  const roomShards: DecodedOnchainShard[] = [];

  for (const entry of erRoomAccounts.result ?? []) {
    try {
      const bytes = new Uint8Array(
        Buffer.from(entry.account.data[0], "base64"),
      );
      if (bytesEqualPrefix(bytes, shardDisc)) {
        const decoded = shardDecoder.decode(bytes);
        roomShards.push({
          pubkey: entry.pubkey,
          owner: entry.account.owner,
          delegatedToMagicBlock:
            entry.account.owner === devnetProof.programs.magicblockDelegation,
          shardIndex: decoded.shardIndex,
          cartridgeManifest: decoded.cartridgeManifest,
          authority: decoded.authority,
          phase: Number(decoded.phase),
          isPrivateFog: decoded.isPrivateFog,
          playerCount: decoded.playerCount,
          evaluatedCount: decoded.evaluatedCount,
          roomPoolUsdc: decoded.roomPoolUsdc.toString(),
          vrfFulfilled: decoded.vrfFulfilled,
          vrfSeedHex: `0x${toHex(decoded.vrfSeed)}`,
          lamports: entry.account.lamports,
        });
      }
    } catch {
      // Skip unrecognized account sizes
    }
  }

  // Decode live RoomVault accounts from cartridge-vault-router
  const vaultDisc = cartridgeVaultRouter.getRoomVaultDiscriminatorBytes();
  const vaultDecoder = cartridgeVaultRouter.getRoomVaultDecoder();
  const roomVaults: DecodedOnchainVault[] = [];

  for (const entry of vaultAccounts.result ?? []) {
    try {
      const bytes = new Uint8Array(
        Buffer.from(entry.account.data[0], "base64"),
      );
      if (bytesEqualPrefix(bytes, vaultDisc)) {
        const decoded = vaultDecoder.decode(bytes);
        roomVaults.push({
          pubkey: entry.pubkey,
          roomShard: decoded.roomShard,
          usdcMint: decoded.usdcMint,
          platformFeeAccount: decoded.platformFeeAccount,
          creatorShareBps: decoded.creatorShareBps,
          totalFeeBps: decoded.totalFeeBps,
          roomPoolUsdc: decoded.roomPoolUsdc.toString(),
          totalDistributedUsdc: decoded.totalDistributedUsdc.toString(),
          totalClaimedUsdc: decoded.totalClaimedUsdc.toString(),
          settled: decoded.settled,
          lamports: entry.account.lamports,
        });
      }
    } catch {
      // Skip unrecognized account sizes
    }
  }

  // Merge recent live Devnet signatures
  const seenSigs = new Set<string>();
  const recentSignatures: RecentOnchainSignature[] = [];
  for (const s of erRoomSigs.result ?? []) {
    if (!seenSigs.has(s.signature)) {
      seenSigs.add(s.signature);
      recentSignatures.push({
        signature: s.signature,
        slot: s.slot,
        blockTime: s.blockTime,
        err: Boolean(s.err),
        programLabel: "cartridge_er_room",
      });
    }
  }
  for (const s of feeAccSigs.result ?? []) {
    if (!seenSigs.has(s.signature)) {
      seenSigs.add(s.signature);
      recentSignatures.push({
        signature: s.signature,
        slot: s.slot,
        blockTime: s.blockTime,
        err: Boolean(s.err),
        programLabel: "platformFeeAccount (SPL)",
      });
    }
  }
  recentSignatures.sort((a, b) => b.slot - a.slot);

  const payload = {
    ok: true,
    fetchedAtIso: new Date().toISOString(),
    probes: {
      solanaDevnet: {
        latencyMs: l1Slot.result !== null ? l1Slot.elapsedMs : null,
        slot: l1Slot.result,
      },
      magicblockRouter: {
        latencyMs: routerRoutes.result !== null ? routerRoutes.elapsedMs : null,
        routeCount: routerRoutes.result?.length ?? null,
        routes: routerRoutes.result ?? [],
      },
      magicblockPublicEr: {
        latencyMs: erVer.result !== null ? erVer.elapsedMs : null,
        version: erVer.result?.["solana-core"] ?? null,
        pythLazerOracleActive: Boolean(erOracleInfo.result?.value),
        pythLazerOracleOwner: erOracleInfo.result?.value?.owner ?? null,
      },
      magicblockPrivateTee: {
        latencyMs: teeId.result !== null ? teeId.elapsedMs : null,
        identity: teeId.result?.identity ?? null,
      },
    },
    programStates,
    accountCounts,
    liveFeeBalanceUnits:
      liveFeeBalanceUnits ??
      devnetProof.metrics.platformFeeAccountFinalBalanceUnits,
    liveShardStatus,
    onchainAccounts: {
      engineConfig: engineConfigDecoded,
      manifests,
      roomShards,
      roomVaults,
      passportAccountCount: passportAccounts.result?.length ?? 0,
    },
    recentSignatures: recentSignatures.slice(0, 16),
  };

  cachedTelemetry = {
    expiresAt: now + 6_000,
    payload,
  };

  return NextResponse.json(payload);
}
