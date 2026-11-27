import { NextResponse } from "next/server";
import {
  CARTRIDGE_DEVNET_AUTHORITIES,
  CARTRIDGE_PROGRAM_IDS,
  MAGICBLOCK_CONSTANTS,
} from "@cartridgefi/shared-types";
import { DEVNET_RPC_PRIMARY } from "@/lib/devnet-rpc";

const CONFIGURED_CORE_API =
  process.env.CARTRIDGEFI_API_URL ?? process.env.NEXT_PUBLIC_CORE_API_URL;
const CORE_API_URL = CONFIGURED_CORE_API ?? "http://127.0.0.1:8787";
const DEVNET_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEVNET_RPC_PRIMARY;

export async function GET(): Promise<NextResponse> {
  // When running on Cloud Run (`K_SERVICE`) or Vercel (`VERCEL=1`) without an external
  // `core-api` daemon URL configured, skip localhost probing and verify live Solana Devnet RPC directly.
  const isServerlessFrontend =
    process.env.VERCEL === "1" || Boolean(process.env.K_SERVICE);
  const shouldProbeCoreApi =
    Boolean(CONFIGURED_CORE_API) || !isServerlessFrontend;

  if (shouldProbeCoreApi) {
    try {
      const upstream = await fetch(`${CORE_API_URL}/health`, {
        signal: AbortSignal.timeout(1500),
        cache: "no-store",
      });
      if (upstream.ok) {
        const data = (await upstream.json()) as Record<string, unknown>;
        return NextResponse.json({
          ...data,
          gateway: "next-edge-proxy",
          coreApiConnected: true,
        });
      }
    } catch {
      // Graceful degradation to direct Solana Devnet RPC + deterministic registry
    }
  }

  let devnetRpcConnected = false;
  try {
    const rpcProbe = await fetch(DEVNET_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [CARTRIDGE_PROGRAM_IDS.registry, { encoding: "base64" }],
      }),
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (rpcProbe.ok) {
      const payload = (await rpcProbe.json()) as {
        result?: { value?: { executable?: boolean } | null };
      };
      devnetRpcConnected = Boolean(payload.result?.value?.executable);
    }
  } catch {
    devnetRpcConnected = false;
  }

  return NextResponse.json({
    status: "ok",
    gateway: "vercel-devnet-direct",
    coreApiConnected: false,
    devnetRpcConnected,
    solanaRpcUrl: DEVNET_RPC_URL,
    programs: CARTRIDGE_PROGRAM_IDS,
    authorities: CARTRIDGE_DEVNET_AUTHORITIES,
    magicblock: {
      delegationProgramId: MAGICBLOCK_CONSTANTS.delegationProgramId,
      permissionProgramId: MAGICBLOCK_CONSTANTS.permissionProgramId,
      routerHttp:
        process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL ??
        MAGICBLOCK_CONSTANTS.devnetRouterHttp,
      teeEndpoint:
        process.env.NEXT_PUBLIC_MAGICBLOCK_TEE_URL ??
        MAGICBLOCK_CONSTANTS.devnetTeeBaseEndpoint,
    },
  });
}
