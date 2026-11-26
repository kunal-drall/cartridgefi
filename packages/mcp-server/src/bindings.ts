import { CARTRIDGE_PROGRAM_IDS, MAGICBLOCK_CONSTANTS } from "@cartridgefi/sdk";

export type SupportedBindingFramework = "react" | "phaser" | "threejs" | "unity";

export interface GeneratedFrameworkBinding {
  framework: SupportedBindingFramework;
  language: "tsx" | "typescript" | "csharp";
  filename: string;
  installCommand: string;
  roomId: string;
  cartridgeSlug: string;
  partnerId: string;
  feeSplitPolicy: string;
  code: string;
}

export function generateFrameworkBindingCode(params: {
  roomId: string;
  cartridgeSlug: string;
  framework: SupportedBindingFramework;
  partnerId?: string;
  partnerFeeVault?: string;
}): GeneratedFrameworkBinding {
  const partnerId = params.partnerId?.trim() || "first-party-studio";
  const vault = params.partnerFeeVault?.trim() || "";
  const hasPartnerVault = vault.length > 0;
  const feeSplitPolicy = hasPartnerVault
    ? `40% Partner Wallet (${vault}) / 30% Creator / 30% CartridgeFi Engine`
    : "50% Creator / 50% CartridgeFi Engine";

  if (params.framework === "react") {
    const partnerPropLine = hasPartnerVault
      ? `\n      partnerFeeVault="${vault}"`
      : "";
    const code = `"use client";

import * as React from "react";
import { CartridgeDeck } from "@cartridgefi/react";

/**
 * CartridgeFi React + Partner Wallet Embed Binding
 * Room ID        : ${params.roomId}
 * Cartridge Slug : ${params.cartridgeSlug}
 * Registry Prog  : ${CARTRIDGE_PROGRAM_IDS.registry}
 * ER Room Prog   : ${CARTRIDGE_PROGRAM_IDS.erRoom}
 * Fee Split      : ${feeSplitPolicy}
 */
export function EmbeddedMarketGameStage(): React.JSX.Element {
  return (
    <CartridgeDeck
      partnerId="${partnerId}"${partnerPropLine}
      defaultCartridgeSlug="${params.cartridgeSlug}"
      defaultFrameMode="${hasPartnerVault ? "solflare" : "standalone"}"
    />
  );
}
`;
    return {
      framework: "react",
      language: "tsx",
      filename: "EmbeddedMarketGameStage.tsx",
      installCommand: "pnpm add @cartridgefi/react @cartridgefi/sdk @cartridgefi/ui-system",
      roomId: params.roomId,
      cartridgeSlug: params.cartridgeSlug,
      partnerId,
      feeSplitPolicy,
      code,
    };
  }

  if (params.framework === "phaser") {
    const code = `import { CartridgeClient, CashModal, type EnrichedMarketPulse } from "@cartridgefi/sdk";

/**
 * CartridgeFi Phaser 3 / 4 Arcade Runner Binding (60fps Render Loop Separation)
 * Room ID  : ${params.roomId}
 * Slug     : ${params.cartridgeSlug}
 * TEE Prog : ${MAGICBLOCK_CONSTANTS.permissionProgramId}
 */
export class MarketRunnerBridge {
  private client: CartridgeClient | null = null;
  private unsubscribePulse: (() => void) | null = null;
  public latestTrackSpeed: number = 1;
  public spawnVolatilityHazard: boolean = false;

  async boot(): Promise<void> {
    this.client = await CartridgeClient.connect({
      cartridgeSlug: "${params.cartridgeSlug}",
      partnerId: "${partnerId}",${hasPartnerVault ? `\n      partnerFeeVault: "${vault}",` : ""}
      mode: "PAPER",
    });

    await CashModal.ensureSessionReady(this.client, {
      mode: "PAPER_OR_LIVE",
      suggestedEnvelopeUsdc: 20,
    });

    this.unsubscribePulse = this.client.onMarketPulse((pulse: EnrichedMarketPulse) => {
      this.latestTrackSpeed = 1 + Math.min(3, Math.floor(Math.abs(pulse.velocityBps) / 20));
      this.spawnVolatilityHazard = pulse.volatilitySigmaMilli >= 2_400;
    });
  }

  async onPlayerSwipeLane(lane: "LANE_LEFT" | "LANE_CENTER" | "LANE_RIGHT"): Promise<void> {
    if (!this.client) return;
    await this.client.emitAction("PLAYER_LANE_SWITCH", { state: lane });
  }

  shutdown(): void {
    this.unsubscribePulse?.();
    this.client?.disconnect();
    this.client = null;
  }
}
`;
    return {
      framework: "phaser",
      language: "typescript",
      filename: "MarketRunnerBridge.ts",
      installCommand: "pnpm add @cartridgefi/sdk phaser",
      roomId: params.roomId,
      cartridgeSlug: params.cartridgeSlug,
      partnerId,
      feeSplitPolicy,
      code,
    };
  }

  if (params.framework === "threejs") {
    const code = `import { CartridgeClient, CashModal, type ClaimStockPrizeReceipt } from "@cartridgefi/sdk";

/**
 * CartridgeFi Three.js Sector Turf & Private ER TEE Heist Binding
 * Room ID : ${params.roomId}
 * Slug    : ${params.cartridgeSlug}
 */
export async function createSyndicateWorldController() {
  const client = await CartridgeClient.connect({
    cartridgeSlug: "${params.cartridgeSlug}",
    partnerId: "${partnerId}",${hasPartnerVault ? `\n    partnerFeeVault: "${vault}",` : ""}
    mode: "PAPER",
  });

  await CashModal.ensureSessionReady(client, {
    mode: "PAPER_OR_LIVE",
    suggestedEnvelopeUsdc: 25,
  });

  let stormIntensityMilli = 1_500;
  const unsub = client.onWorldTick((frame) => {
    stormIntensityMilli = frame.volatilitySigmaMilli;
  });

  return {
    roomId: client.roomId,
    getStormIntensityMilli: () => stormIntensityMilli,
    captureDistrict: (districtIndex: 0 | 1 | 2 | 3, convictionBps: number = 8_000) =>
      client.emitAction("CLAIM_DISTRICT_TURF", { districtIndex, convictionBps }),
    unsealShowdown: () => client.triggerShowdownUnseal(),
    claimEquityLoot: (): Promise<ClaimStockPrizeReceipt> => client.claimStockPrize("NVDAx"),
    dispose: () => {
      unsub();
      client.disconnect();
    },
  };
}
`;
    return {
      framework: "threejs",
      language: "typescript",
      filename: "SyndicateWorldController.ts",
      installCommand: "pnpm add @cartridgefi/sdk three",
      roomId: params.roomId,
      cartridgeSlug: params.cartridgeSlug,
      partnerId,
      feeSplitPolicy,
      code,
    };
  }

  const unityCode = `using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

namespace CartridgeFi.Unity
{
    /// <summary>
    /// CartridgeFi Unity WebGL / Native Bridge pre-wired to Room ${params.roomId} (${params.cartridgeSlug}).
    /// Routes zero-popup session stances to MagicBlock Private ER (${CARTRIDGE_PROGRAM_IDS.erRoom}).
    /// </summary>
    public sealed class CartridgeRoomController : IDisposable
    {
        public const string RoomId = "${params.roomId}";
        public const string CartridgeSlug = "${params.cartridgeSlug}";
        public const string ErRoomProgramId = "${CARTRIDGE_PROGRAM_IDS.erRoom}";
        public const string DelegationProgramId = "${MAGICBLOCK_CONSTANTS.delegationProgramId}";

        private readonly HttpClient _http;
        private readonly string _apiBaseUrl;

        public CartridgeRoomController(string apiBaseUrl = "http://localhost:8787")
        {
            _apiBaseUrl = apiBaseUrl.TrimEnd('/');
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        }

        public async Task<bool> SubmitLaneStanceAsync(string playerPubkey, string sessionPubkey, string lane)
        {
            string json = $"{{\\"player\\":\\"{playerPubkey}\\",\\"ephemeralSessionKey\\":\\"{sessionPubkey}\\",\\"lane\\":\\"{lane}\\"}}";
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var response = await _http.PostAsync($"{_apiBaseUrl}/v1/rooms/{RoomId}/stance", content);
            return response.IsSuccessStatusCode;
        }

        public void Dispose()
        {
            _http.Dispose();
        }
    }
}
`;

  return {
    framework: "unity",
    language: "csharp",
    filename: "CartridgeRoomController.cs",
    installCommand: "Copy CartridgeRoomController.cs into Assets/Scripts/CartridgeFi/",
    roomId: params.roomId,
    cartridgeSlug: params.cartridgeSlug,
    partnerId,
    feeSplitPolicy,
    code: unityCode,
  };
}
