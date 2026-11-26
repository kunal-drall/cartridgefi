import { getBase58Decoder } from "@solana/kit";
import {
  BPS_DENOMINATOR,
  ENGINE_GUARDRAILS,
  FP_SCALE,
  PASSPORT_ELIGIBILITY_BITS,
  SOLANA_CANONICAL_MINTS,
  SUPPORTED_DEPOSIT_CHAINS,
  USDC_UNIT,
  formatScaledBigInt,
  type SupportedDepositChain,
} from "@cartridgefi/shared-types";
import { bytesToHex, normalizeToSolanaAddress, sha256Sync, utf8ToBytes } from "./pda-and-deploy.js";
import { MagicBlockSessionSigner } from "./session-signer.js";

export type CashierPaymentRail =
  | "CRYPTO_BRIDGE"
  | "APPLE_PAY"
  | "GOOGLE_PAY"
  | "DEBIT_CARD"
  | "PASSKEY_SESSION";

export interface CreateDepositIntentInput {
  wallet: string;
  sourceChain: SupportedDepositChain;
  paymentRail?: CashierPaymentRail;
  sourceAsset?: string;
  amountUsdcAtomic: bigint;
  mintPasskeySession?: boolean;
  autoSettle?: boolean;
}

export interface DepositIntentReceipt {
  intentId: string;
  wallet: string;
  sourceChain: SupportedDepositChain;
  paymentRail: CashierPaymentRail;
  sourceAsset: string;
  requestedUsdcAtomic: bigint;
  bridgeFeeUsdcAtomic: bigint;
  creditedCanonicalUsdcAtomic: bigint;
  creditedUsdcFormatted: string;
  canonicalSolanaMint: string;
  depositEscrowAddress: string;
  passkeySessionToken: string | null;
  status: string;
  settlementSignature: string;
  unifiedUsdcBalanceAtomic: bigint;
  source: "core_api" | "standalone_fallback";
}

export interface PasskeyBootstrapResult {
  intent: DepositIntentReceipt;
  passkeySessionToken: string;
  sessionSigner: MagicBlockSessionSigner;
}

export interface DevnetFaucetResult {
  wallet: string;
  canonicalMint: string;
  creditedUsdcAtomic: bigint;
  creditedUsdcFormatted: string;
  unifiedUsdcBalanceAtomic: bigint;
  eligibilityBitmask: number;
  faucetSignature: string;
  source: "core_api" | "standalone_fallback";
}

export interface SessionReadyTarget {
  readonly playerWallet: string;
  readonly roomShardPda: string;
  readonly mode: "PAPER" | "LIVE";
  attachSessionSigner?: (signer: MagicBlockSessionSigner) => void;
}

export interface EnsureSessionReadyOptions {
  mode?: "PAPER" | "LIVE" | "PAPER_OR_LIVE";
  suggestedEnvelopeUsdc?: number;
  sourceChain?: SupportedDepositChain;
  paymentRail?: CashierPaymentRail;
  maxLeverage?: number;
}

export interface SessionEnvelopeSummary {
  mode: "PAPER" | "LIVE";
  wallet: string;
  sessionPubkey: string;
  canonicalMint: string;
  fundedUsdcAtomic: bigint;
  fundedUsdcFormatted: string;
  maxLeverage: number;
  passkeySessionToken: string | null;
}

function formatAtomicUsdc(atomic: bigint): string {
  const scaled = (atomic * FP_SCALE) / USDC_UNIT;
  return formatScaledBigInt(scaled, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBigIntField(value: unknown, fallback: bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return fallback;
}

/**
 * Unified 7-Chain Deposit Intent Creator (`solana`, `base`, `ethereum`, `arbitrum`, `bnb`, `monad`, `polygon`
 * -> canonical Solana USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`), Apple Pay / Passkey Bootstrapper,
 * and 1-Tap Devnet USDC Faucet Client.
 */
export class CashModalClient {
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  private localSeq: number = 1;
  private readonly offlineLedger = new Map<string, bigint>();

  constructor(options?: { apiBaseUrl?: string; requestTimeoutMs?: number }) {
    const defaultEnvUrl =
      typeof process !== "undefined" && process.env?.CARTRIDGEFI_API_URL
        ? process.env.CARTRIDGEFI_API_URL
        : "http://localhost:8787";
    this.apiBaseUrl = (options?.apiBaseUrl ?? defaultEnvUrl).replace(/\/+$/, "");
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 2_500;
  }

  async createDepositIntent(input: CreateDepositIntentInput): Promise<DepositIntentReceipt> {
    const normalizedWallet = normalizeToSolanaAddress(input.wallet);
    if (!(SUPPORTED_DEPOSIT_CHAINS as readonly string[]).includes(input.sourceChain)) {
      throw new Error(
        `Unsupported deposit chain '${input.sourceChain}'. Supported 7-chain routes: ${SUPPORTED_DEPOSIT_CHAINS.join(", ")}.`,
      );
    }
    if (
      input.amountUsdcAtomic < USDC_UNIT ||
      input.amountUsdcAtomic > ENGINE_GUARDRAILS.betaMaxRoomPoolUsdc
    ) {
      throw new Error(
        `Deposit amountUsdcAtomic (${input.amountUsdcAtomic.toString()}) must be between ${USDC_UNIT.toString()} (1 USDC) and ${ENGINE_GUARDRAILS.betaMaxRoomPoolUsdc.toString()} (500 USDC).`,
      );
    }

    const rail: CashierPaymentRail = input.paymentRail ?? "CRYPTO_BRIDGE";
    const sourceAsset = input.sourceAsset ?? "USDC";

    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/cashier/intent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: normalizedWallet,
          sourceChain: input.sourceChain,
          paymentRail: rail,
          sourceAsset,
          amountUsdcAtomic: Number(input.amountUsdcAtomic),
          mintPasskeySession: input.mintPasskeySession ?? false,
          autoSettle: input.autoSettle ?? true,
        }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (response.ok) {
        const raw: unknown = await response.json();
        if (isRecord(raw) && isRecord(raw.intent)) {
          const it = raw.intent;
          const credited = parseBigIntField(
            it.creditedCanonicalUsdcAtomic,
            input.amountUsdcAtomic,
          );
          return {
            intentId: typeof it.intentId === "string" ? it.intentId : "int_live",
            wallet: normalizedWallet,
            sourceChain: input.sourceChain,
            paymentRail: rail,
            sourceAsset,
            requestedUsdcAtomic: parseBigIntField(
              it.requestedUsdcAtomic,
              input.amountUsdcAtomic,
            ),
            bridgeFeeUsdcAtomic: parseBigIntField(it.bridgeFeeUsdcAtomic, 0n),
            creditedCanonicalUsdcAtomic: credited,
            creditedUsdcFormatted: formatAtomicUsdc(credited),
            canonicalSolanaMint: SOLANA_CANONICAL_MINTS.USDC,
            depositEscrowAddress:
              typeof it.depositEscrowAddress === "string"
                ? it.depositEscrowAddress
                : normalizedWallet,
            passkeySessionToken:
              typeof it.passkeySessionToken === "string" ? it.passkeySessionToken : null,
            status: typeof it.status === "string" ? it.status : "SETTLED_CANONICAL_USDC",
            settlementSignature:
              typeof it.settlementSignature === "string" ? it.settlementSignature : "",
            unifiedUsdcBalanceAtomic: parseBigIntField(
              raw.unifiedUsdcBalanceAtomic,
              credited,
            ),
            source: "core_api",
          };
        }
      }
    } catch {
      // Offline / standalone fallback
    }

    // Pure integer 0 bps fee on native Solana USDC; 10 bps cross-chain solver fee
    const feeBps = input.sourceChain === "solana" ? 0n : 10n;
    const bridgeFeeUsdcAtomic = (input.amountUsdcAtomic * feeBps) / BPS_DENOMINATOR;
    const creditedCanonicalUsdcAtomic = input.amountUsdcAtomic - bridgeFeeUsdcAtomic;

    const seq = this.localSeq;
    this.localSeq += 1;
    const digest = sha256Sync(
      utf8ToBytes(`cashier_intent:${normalizedWallet}:${input.sourceChain}:${seq}`),
    );
    const hex = bytesToHex(digest);
    const sigBytes = new Uint8Array(64);
    sigBytes.set(digest, 0);
    sigBytes.set(digest, 32);
    const settlementSignature = getBase58Decoder().decode(sigBytes);
    const depositEscrowAddress =
      input.sourceChain === "solana"
        ? getBase58Decoder().decode(digest)
        : `0x${hex.slice(0, 40)}`;

    const needsPasskey =
      Boolean(input.mintPasskeySession) ||
      rail === "APPLE_PAY" ||
      rail === "GOOGLE_PAY" ||
      rail === "PASSKEY_SESSION";
    const passkeySessionToken = needsPasskey ? `pk_sess_${hex.slice(16, 48)}` : null;

    const prevBal = this.offlineLedger.get(normalizedWallet) ?? 0n;
    const nextBal = prevBal + creditedCanonicalUsdcAtomic;
    this.offlineLedger.set(normalizedWallet, nextBal);

    return {
      intentId: `int_${hex.slice(0, 20)}`,
      wallet: normalizedWallet,
      sourceChain: input.sourceChain,
      paymentRail: rail,
      sourceAsset,
      requestedUsdcAtomic: input.amountUsdcAtomic,
      bridgeFeeUsdcAtomic,
      creditedCanonicalUsdcAtomic,
      creditedUsdcFormatted: formatAtomicUsdc(creditedCanonicalUsdcAtomic),
      canonicalSolanaMint: SOLANA_CANONICAL_MINTS.USDC,
      depositEscrowAddress,
      passkeySessionToken,
      status: "SETTLED_CANONICAL_USDC",
      settlementSignature,
      unifiedUsdcBalanceAtomic: nextBal,
      source: "standalone_fallback",
    };
  }

  /**
   * Bootstraps an Apple Pay / Google Pay / Passkey cash session settled into canonical Solana USDC
   * alongside a bounded zero-popup `MagicBlockSessionSigner`.
   */
  async bootstrapApplePayOrPasskeySession(params: {
    wallet: string;
    roomShardPda: string;
    amountUsdcAtomic: bigint;
    rail?: "APPLE_PAY" | "GOOGLE_PAY" | "PASSKEY_SESSION";
    sourceChain?: SupportedDepositChain;
    maxLeverage?: number;
  }): Promise<PasskeyBootstrapResult> {
    const rail = params.rail ?? "APPLE_PAY";
    const intent = await this.createDepositIntent({
      wallet: params.wallet,
      sourceChain: params.sourceChain ?? "solana",
      paymentRail: rail,
      amountUsdcAtomic: params.amountUsdcAtomic,
      mintPasskeySession: true,
      autoSettle: true,
    });

    const sessionSigner = await MagicBlockSessionSigner.create({
      ownerWallet: intent.wallet,
      roomShardPda: params.roomShardPda,
      maxUsdcAtomic: intent.creditedCanonicalUsdcAtomic,
      maxLeverage: params.maxLeverage ?? 3,
      mode: "LIVE",
    });

    return {
      intent,
      passkeySessionToken: intent.passkeySessionToken ?? `pk_sess_${intent.intentId}`,
      sessionSigner,
    };
  }

  /**
   * Requests 1-tap Devnet canonical USDC + Market Passport eligibility bitmask (`GEO_ELIGIBLE | CAN_CLAIM_XSTOCKS | SYBIL_VERIFIED`).
   */
  async requestDevnetUsdcFaucet(params: {
    wallet: string;
    amountUsdcAtomic?: bigint;
    eligibilityBitmask?: number;
  }): Promise<DevnetFaucetResult> {
    const normalizedWallet = normalizeToSolanaAddress(params.wallet);
    const requested = params.amountUsdcAtomic ?? 100n * USDC_UNIT;
    const clampedAmount =
      requested < USDC_UNIT
        ? USDC_UNIT
        : requested > ENGINE_GUARDRAILS.betaMaxRoomPoolUsdc
          ? ENGINE_GUARDRAILS.betaMaxRoomPoolUsdc
          : requested;
    const fullMask =
      PASSPORT_ELIGIBILITY_BITS.GEO_ELIGIBLE |
      PASSPORT_ELIGIBILITY_BITS.CAN_CLAIM_XSTOCKS |
      PASSPORT_ELIGIBILITY_BITS.SYBIL_VERIFIED;
    const eligibilityBitmask = params.eligibilityBitmask ?? fullMask;

    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/cashier/devnet-faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: normalizedWallet,
          amountUsdcAtomic: Number(clampedAmount),
          eligibilityBitmask,
        }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (response.ok) {
        const raw: unknown = await response.json();
        if (isRecord(raw)) {
          const credited = parseBigIntField(raw.creditedUsdcAtomic, clampedAmount);
          return {
            wallet: normalizedWallet,
            canonicalMint: SOLANA_CANONICAL_MINTS.USDC,
            creditedUsdcAtomic: credited,
            creditedUsdcFormatted: formatAtomicUsdc(credited),
            unifiedUsdcBalanceAtomic: parseBigIntField(
              raw.unifiedUsdcBalanceAtomic,
              credited,
            ),
            eligibilityBitmask:
              typeof raw.eligibilityBitmask === "number"
                ? raw.eligibilityBitmask
                : eligibilityBitmask,
            faucetSignature:
              typeof raw.faucetSignature === "string" ? raw.faucetSignature : "",
            source: "core_api",
          };
        }
      }
    } catch {
      // Offline / standalone fallback
    }

    const seq = this.localSeq;
    this.localSeq += 1;
    const digest = sha256Sync(utf8ToBytes(`devnet_faucet:${normalizedWallet}:${seq}`));
    const sigBytes = new Uint8Array(64);
    sigBytes.set(digest, 0);
    sigBytes.set(digest, 32);
    const faucetSignature = getBase58Decoder().decode(sigBytes);

    const prev = this.offlineLedger.get(normalizedWallet) ?? 0n;
    const updated = prev + clampedAmount;
    this.offlineLedger.set(normalizedWallet, updated);

    return {
      wallet: normalizedWallet,
      canonicalMint: SOLANA_CANONICAL_MINTS.USDC,
      creditedUsdcAtomic: clampedAmount,
      creditedUsdcFormatted: formatAtomicUsdc(clampedAmount),
      unifiedUsdcBalanceAtomic: updated,
      eligibilityBitmask,
      faucetSignature,
      source: "standalone_fallback",
    };
  }
}

/**
 * Ergonomic static facade matching `await CashModal.ensureSessionReady(cartridge, { mode: "PAPER_OR_LIVE", suggestedEnvelopeUsdc: 20 })`.
 */
export const CashModal = {
  async ensureSessionReady(
    target: SessionReadyTarget,
    options: EnsureSessionReadyOptions = {},
  ): Promise<SessionEnvelopeSummary> {
    const resolvedMode: "PAPER" | "LIVE" =
      options.mode === "LIVE"
        ? "LIVE"
        : options.mode === "PAPER"
          ? "PAPER"
          : target.mode;
    const maxLeverage = options.maxLeverage ?? 3;
    const envelopeUsdc = Math.max(1, Math.min(500, Math.trunc(options.suggestedEnvelopeUsdc ?? 20)));
    const amountAtomic = BigInt(envelopeUsdc) * USDC_UNIT;

    if (resolvedMode === "PAPER") {
      const signer = await MagicBlockSessionSigner.create({
        ownerWallet: target.playerWallet,
        roomShardPda: target.roomShardPda,
        maxUsdcAtomic: 0n,
        maxLeverage,
        mode: "PAPER",
      });
      target.attachSessionSigner?.(signer);
      return {
        mode: "PAPER",
        wallet: target.playerWallet,
        sessionPubkey: signer.sessionPubkey,
        canonicalMint: SOLANA_CANONICAL_MINTS.USDC,
        fundedUsdcAtomic: 0n,
        fundedUsdcFormatted: "0.00",
        maxLeverage,
        passkeySessionToken: null,
      };
    }

    const cashier = new CashModalClient();
    const intent = await cashier.createDepositIntent({
      wallet: target.playerWallet,
      sourceChain: options.sourceChain ?? "solana",
      paymentRail: options.paymentRail ?? "APPLE_PAY",
      amountUsdcAtomic: amountAtomic,
      mintPasskeySession: true,
      autoSettle: true,
    });

    const signer = await MagicBlockSessionSigner.create({
      ownerWallet: intent.wallet,
      roomShardPda: target.roomShardPda,
      maxUsdcAtomic: intent.creditedCanonicalUsdcAtomic,
      maxLeverage,
      mode: "LIVE",
    });
    target.attachSessionSigner?.(signer);

    return {
      mode: "LIVE",
      wallet: intent.wallet,
      sessionPubkey: signer.sessionPubkey,
      canonicalMint: SOLANA_CANONICAL_MINTS.USDC,
      fundedUsdcAtomic: intent.creditedCanonicalUsdcAtomic,
      fundedUsdcFormatted: intent.creditedUsdcFormatted,
      maxLeverage,
      passkeySessionToken: intent.passkeySessionToken,
    };
  },
} as const;
