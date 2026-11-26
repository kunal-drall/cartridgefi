import { NextResponse } from "next/server";
import devnetProof from "@/data/devnet-proof.json";

async function safeServerRpc<T>(
  endpoint: string,
  method: string,
  params: unknown[],
  timeoutMs = 2800,
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

export async function GET(): Promise<NextResponse> {
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

  const [l1Slot, routerRoutes, erVer, teeId, multiAcc] = await Promise.all([
    safeServerRpc<number>(solanaRpc, "getSlot", [{ commitment: "confirmed" }]),
    safeServerRpc<Array<{ fqdn: string; blockTimeMs: number }>>(
      routerRpc,
      "getRoutes",
      [],
    ),
    safeServerRpc<Record<string, string>>(publicErRpc, "getVersion", []),
    safeServerRpc<{ identity: string }>(teeRpc, "getIdentity", []),
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
  ]);

  const programStates: Record<
    string,
    { executable: boolean; lamports: string }
  > = {};
  let liveFeeBalanceUnits =
    devnetProof.metrics.platformFeeAccountFinalBalanceUnits;
  let liveShardStatus = "Settled & Restored to L1";

  const accList = multiAcc.result?.value;
  if (accList && accList.length >= 6) {
    for (let i = 0; i < 4; i++) {
      const pk = programPubkeys[i]!;
      const item = accList[i];
      if (item) {
        programStates[pk] = {
          executable: item.executable,
          lamports: BigInt(item.lamports).toString(),
        };
      }
    }
    const feeAcc = accList[4];
    if (feeAcc?.data?.[0]) {
      const decoded = decodeTokenAmountFromBase64(feeAcc.data[0]);
      if (decoded !== null) {
        liveFeeBalanceUnits = decoded;
      }
    }
    const shardAcc = accList[5];
    if (shardAcc) {
      liveShardStatus =
        shardAcc.owner === devnetProof.programs.magicblockDelegation
          ? "Active Delegation on ER"
          : "Settled & Restored to L1";
    }
  }

  return NextResponse.json({
    ok: true,
    probes: {
      solanaDevnet: {
        latencyMs: l1Slot.result !== null ? l1Slot.elapsedMs : null,
        slot: l1Slot.result,
      },
      magicblockRouter: {
        latencyMs: routerRoutes.result !== null ? routerRoutes.elapsedMs : null,
        routeCount: routerRoutes.result?.length ?? null,
      },
      magicblockPublicEr: {
        latencyMs: erVer.result !== null ? erVer.elapsedMs : null,
        version: erVer.result?.["solana-core"] ?? null,
      },
      magicblockPrivateTee: {
        latencyMs: teeId.result !== null ? teeId.elapsedMs : null,
        identity: teeId.result?.identity ?? null,
      },
    },
    programStates,
    liveFeeBalanceUnits,
    liveShardStatus,
  });
}
