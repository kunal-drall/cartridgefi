/**
 * Borel live price layer — real Pyth Network data only.
 *
 * Feed IDs were resolved on 2026-11-27 against Hermes metadata (keyless endpoint):
 *   curl "https://hermes.pyth.network/v2/price_feeds?query=SOL"   -> Crypto.SOL/USD
 *   curl "https://hermes.pyth.network/v2/price_feeds?query=BTC"   -> Crypto.BTC/USD
 *   curl "https://hermes.pyth.network/v2/price_feeds?query=ETH"   -> Crypto.ETH/USD
 *   curl "https://hermes.pyth.network/v2/price_feeds?query=NVDA"  -> Crypto.NVDAX/USD (24/7 xStock feed;
 *        Pyth also lists Equity.US.NVDA/USD b1073854… which is the cash-equity session feed)
 *   curl "https://hermes.pyth.network/v2/price_feeds?query=SPY"   -> Equity.US.SPY/USD (US session only)
 *
 * Transport. Since the Pyth Core upgrade (2026-08-26) Hermes price routes require
 * `Authorization: Bearer <PYTH_API_KEY>` and accept no browser tokens, and the public Solana
 * mainnet RPC rejects browser origins (403). The browser therefore always streams SSE from the
 * same-origin route /api/pyth/stream, which serves:
 *   1. PYTH_API_KEY set: the Hermes SSE stream (/v2/updates/price/stream), proxied verbatim.
 *   2. No key: Pyth push-feed accounts on Solana mainnet read server-side once a second
 *      (upgraded Pyth Core price-feed program pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou,
 *      receiver rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp). Sponsored feeds (SOL, BTC, ETH)
 *      update on a 1-minute heartbeat or 0.5% deviation; NVDAx is not sponsored and SPY has no account.
 * REST fallback: /api/pyth/latest.
 * Push-feed PDAs = findProgramAddress([u16le(shard 0), feedIdBytes], pyt2F414…), verified on mainnet.
 */

import * as React from "react";
import type { BorelMarket } from "./types";
import { pythToE9 } from "./scoring";

export type PythFeedStatus = "live" | "stale" | "closed" | "error";

export interface PythFeedMeta {
  readonly feedId: string;
  readonly pythSymbol: string;
  readonly label: string;
  readonly session: "24/7" | "us-equity";
  /** Upgraded Pyth Core push-feed account (shard 0) on Solana mainnet, or null if none exists. */
  readonly pushAccount: string | null;
  /** True when Pyth sponsors regular on-chain updates for this push account. */
  readonly sponsored: boolean;
}

export const PYTH_FEEDS: Readonly<Record<BorelMarket, PythFeedMeta>> = {
  "SOL/USD": {
    feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    pythSymbol: "Crypto.SOL/USD",
    label: "SOL/USD",
    session: "24/7",
    pushAccount: "7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE",
    sponsored: true,
  },
  "BTC/USD": {
    feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    pythSymbol: "Crypto.BTC/USD",
    label: "BTC/USD",
    session: "24/7",
    pushAccount: "APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5",
    sponsored: true,
  },
  "ETH/USD": {
    feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    pythSymbol: "Crypto.ETH/USD",
    label: "ETH/USD",
    session: "24/7",
    pushAccount: "7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH",
    sponsored: true,
  },
  "NVDAx/USD": {
    feedId: "4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f",
    pythSymbol: "Crypto.NVDAX/USD",
    label: "NVDAx/USD (xStock)",
    session: "24/7",
    pushAccount: "VSgf6jkwrcs9jbLuR57iN1Gk2c68vT9stZe8G6GGix2",
    sponsored: false,
  },
  "SPY/USD": {
    feedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    pythSymbol: "Equity.US.SPY/USD",
    label: "SPY/USD (US session)",
    session: "us-equity",
    pushAccount: null,
    sponsored: false,
  },
};

/**
 * Equity.US.SPY/USD trading schedule exactly as published in Hermes feed metadata:
 * "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,
 *  1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C"
 */
const US_EQUITY_WEEKLY: readonly (readonly [number, number] | null)[] = [
  [930, 1600], // Mon
  [930, 1600],
  [930, 1600],
  [930, 1600],
  [930, 1600], // Fri
  null, // Sat
  null, // Sun
];
const US_EQUITY_OVERRIDES: Readonly<Record<string, readonly [number, number] | null>> = {
  "0907": null,
  "1126": null,
  "1127": [930, 1300],
  "1224": [930, 1300],
  "1225": null,
  "0101": null,
  "0118": null,
  "0215": null,
  "0326": null,
  "0531": null,
  "0618": null,
  "0705": null,
};

const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** True while the US cash-equity session (per the Pyth schedule above) is open. */
export function isUsEquitySessionOpen(nowMs: number): boolean {
  const parts = Object.fromEntries(
    NY_PARTS.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]),
  );
  const mmdd = `${parts.month}${parts.day}`;
  const hhmm = Number(parts.hour) * 100 + Number(parts.minute);
  const window =
    mmdd in US_EQUITY_OVERRIDES
      ? US_EQUITY_OVERRIDES[mmdd]
      : US_EQUITY_WEEKLY[WEEKDAY_INDEX[parts.weekday ?? "Sun"] ?? 6];
  return Boolean(window && hhmm >= window[0] && hhmm < window[1]);
}

/** Max publish age before a feed is shown as stale. Push feeds heartbeat every 60s. */
const STALE_AFTER_MS = { hermes: 15_000, pushFeed: 150_000 } as const;

export type PythTransport = "hermes" | "solana-push-feed";

export interface PythQuote {
  readonly priceE9: bigint;
  readonly publishTimeMs: number;
}

export function classifyFeed(
  market: BorelMarket,
  quote: PythQuote | undefined,
  transport: PythTransport,
  nowMs: number,
): PythFeedStatus {
  const meta = PYTH_FEEDS[market];
  if (meta.session === "us-equity" && !isUsEquitySessionOpen(nowMs)) return "closed";
  if (!quote) return "error";
  const limit = transport === "hermes" ? STALE_AFTER_MS.hermes : STALE_AFTER_MS.pushFeed;
  return nowMs - quote.publishTimeMs > limit ? "stale" : "live";
}

/* ----------------------------- decoding ----------------------------- */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Decode a Pyth receiver `PriceUpdateV2` account:
 * disc[8] | write_authority[32] | verification_level (0=Partial{u8},1=Full) |
 * feed_id[32] | price i64 | conf u64 | exponent i32 | publish_time i64 | …
 */
export function decodePriceUpdateV2(
  dataBase64: string,
  expectedFeedId: string,
): PythQuote | null {
  const bytes = base64ToBytes(dataBase64);
  if (bytes.length < 8 + 32 + 1 + 32 + 28) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8 + 32;
  o += bytes[o] === 0 ? 2 : 1;
  if (bytesToHex(bytes.subarray(o, o + 32)) !== expectedFeedId) return null;
  o += 32;
  const price = view.getBigInt64(o, true);
  o += 16; // price + conf
  const expo = view.getInt32(o, true);
  o += 4;
  const publishTime = view.getBigInt64(o, true);
  if (price <= 0n) return null;
  return { priceE9: pythToE9(price, expo), publishTimeMs: Number(publishTime) * 1000 };
}

interface HermesParsedUpdate {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

function quoteFromHermes(update: HermesParsedUpdate): PythQuote | null {
  const price = BigInt(update.price.price);
  if (price <= 0n) return null;
  return {
    priceE9: pythToE9(price, update.price.expo),
    publishTimeMs: update.price.publish_time * 1000,
  };
}

const MARKET_BY_FEED_ID: ReadonlyMap<string, BorelMarket> = new Map(
  (Object.entries(PYTH_FEEDS) as Array<[BorelMarket, PythFeedMeta]>).map(([m, f]) => [
    f.feedId,
    m,
  ]),
);

/* --------------------------- server-safe REST --------------------------- */

const HERMES_URL = "https://hermes.pyth.network";
const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export interface LatestPricesResult {
  pricesE9: Partial<Record<BorelMarket, bigint>>;
  status: Partial<Record<BorelMarket, PythFeedStatus>>;
  publishTimeMs: Partial<Record<BorelMarket, number>>;
  transport: PythTransport;
}

async function fetchPushFeedQuotes(
  markets: readonly BorelMarket[],
  rpcUrl: string,
): Promise<Partial<Record<BorelMarket, PythQuote>>> {
  const withAccounts = markets.filter((m) => PYTH_FEEDS[m].pushAccount !== null);
  if (withAccounts.length === 0) return {};
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [
        withAccounts.map((m) => PYTH_FEEDS[m].pushAccount),
        { encoding: "base64", commitment: "confirmed" },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: { value: Array<{ data: [string, string] } | null> };
    error?: { message?: string };
  };
  if (!json.result) throw new Error(json.error?.message ?? "Solana RPC error");
  const out: Partial<Record<BorelMarket, PythQuote>> = {};
  json.result.value.forEach((acct, i) => {
    const market = withAccounts[i];
    if (!acct || !market) return;
    const quote = decodePriceUpdateV2(acct.data[0], PYTH_FEEDS[market].feedId);
    if (quote) out[market] = quote;
  });
  return out;
}

async function fetchHermesQuotes(
  markets: readonly BorelMarket[],
  apiKey: string,
): Promise<Partial<Record<BorelMarket, PythQuote>>> {
  const qs = markets.map((m) => `ids[]=${PYTH_FEEDS[m].feedId}`).join("&");
  const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?${qs}&parsed=true`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
  const json = (await res.json()) as { parsed?: HermesParsedUpdate[] };
  const out: Partial<Record<BorelMarket, PythQuote>> = {};
  for (const update of json.parsed ?? []) {
    const market = MARKET_BY_FEED_ID.get(update.id.replace(/^0x/, ""));
    const quote = quoteFromHermes(update);
    if (market && quote) out[market] = quote;
  }
  return out;
}

/** Shared in-process cache so many SSE clients and scoring routes cost one upstream read. */
const QUOTE_CACHE_MS = 900;
const quoteCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Partial<Record<BorelMarket, PythQuote>>> }
>();

function serverTransport(): PythTransport {
  return typeof process !== "undefined" && process.env.PYTH_API_KEY ? "hermes" : "solana-push-feed";
}

async function cachedQuotes(
  markets: readonly BorelMarket[],
): Promise<Partial<Record<BorelMarket, PythQuote>>> {
  const key = [...markets].sort().join(",");
  const hit = quoteCache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.promise;
  const apiKey = process.env.PYTH_API_KEY;
  const promise = (
    apiKey
      ? fetchHermesQuotes(markets, apiKey)
      : fetchPushFeedQuotes(markets, process.env.PYTH_SOLANA_RPC_URL ?? DEFAULT_MAINNET_RPC)
  ).catch(() => ({}));
  quoteCache.set(key, { expiresAt: now + QUOTE_CACHE_MS, promise });
  return promise;
}

/**
 * Latest Pyth prices for scoring (server routes and scripts only).
 * Hermes REST when PYTH_API_KEY is set, otherwise the on-chain push-feed accounts.
 */
export async function fetchLatestPricesE9(
  markets: readonly BorelMarket[],
): Promise<LatestPricesResult> {
  const transport = serverTransport();
  const quotes = await cachedQuotes(markets);
  const now = Date.now();
  const result: LatestPricesResult = { pricesE9: {}, status: {}, publishTimeMs: {}, transport };
  for (const market of markets) {
    const quote = quotes[market];
    result.status[market] = classifyFeed(market, quote, transport, now);
    if (quote) {
      result.pricesE9[market] = quote.priceE9;
      result.publishTimeMs[market] = quote.publishTimeMs;
    }
  }
  return result;
}

/** One SSE/REST payload in Hermes `parsed` shape (prices re-expressed at expo -9). */
export interface PythWirePayload {
  transport: PythTransport;
  parsed: HermesParsedUpdate[];
}

export function toWirePayload(result: LatestPricesResult): PythWirePayload {
  const parsed: HermesParsedUpdate[] = [];
  for (const [market, priceE9] of Object.entries(result.pricesE9) as Array<[BorelMarket, bigint]>) {
    const pt = result.publishTimeMs[market];
    if (pt === undefined) continue;
    parsed.push({
      id: PYTH_FEEDS[market].feedId,
      price: { price: priceE9.toString(), expo: -9, publish_time: Math.floor(pt / 1000) },
    });
  }
  return { transport: result.transport, parsed };
}

export function parseMarketsParam(raw: string | null): BorelMarket[] {
  const all = Object.keys(PYTH_FEEDS) as BorelMarket[];
  if (!raw) return all;
  const wanted = new Set(raw.split(","));
  const picked = all.filter((m) => wanted.has(m));
  return picked.length > 0 ? picked : all;
}

/* ------------------------------ browser hook ------------------------------ */

export interface PythPricesState {
  pricesE9: Partial<Record<BorelMarket, bigint>>;
  status: Partial<Record<BorelMarket, PythFeedStatus>>;
  publishTimeMs: Partial<Record<BorelMarket, number>>;
  transport: PythTransport | null;
}

const EMPTY_STATE: PythPricesState = {
  pricesE9: {},
  status: {},
  publishTimeMs: {},
  transport: null,
};

function sameRecord<T>(a: Partial<Record<string, T>>, b: Partial<Record<string, T>>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** Parse an SSE byte stream from fetch() and call onData for every `data:` payload. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onData: (payload: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("");
      if (data) onData(data);
      sep = buffer.indexOf("\n\n");
    }
  }
}

/**
 * Live Pyth prices for the given markets via same-origin SSE (/api/pyth/stream), falling back
 * to REST polling (/api/pyth/latest). State updates are coalesced to one per animation frame
 * and skipped when nothing changed; the stream is aborted on unmount.
 */
export function usePythPrices(markets: readonly BorelMarket[]): PythPricesState {
  const key = markets.join(",");
  const [state, setState] = React.useState<PythPricesState>(EMPTY_STATE);

  React.useEffect(() => {
    const list = key ? (key.split(",") as BorelMarket[]) : [];
    if (list.length === 0) return;

    let disposed = false;
    let transport: PythTransport | null = null;
    const quotes: Partial<Record<BorelMarket, PythQuote>> = {};
    const abort = new AbortController();
    let pollId: number | null = null;
    let rafId: number | null = null;
    const query = `markets=${encodeURIComponent(list.join(","))}`;

    const flush = (): void => {
      rafId = null;
      if (disposed) return;
      const now = Date.now();
      const next: PythPricesState = { pricesE9: {}, status: {}, publishTimeMs: {}, transport };
      for (const m of list) {
        const q = quotes[m];
        next.status[m] = transport ? classifyFeed(m, q, transport, now) : "error";
        if (q) {
          next.pricesE9[m] = q.priceE9;
          next.publishTimeMs[m] = q.publishTimeMs;
        }
      }
      setState((prev) =>
        prev.transport === next.transport &&
        sameRecord(prev.pricesE9, next.pricesE9) &&
        sameRecord(prev.status, next.status) &&
        sameRecord(prev.publishTimeMs, next.publishTimeMs)
          ? prev
          : next,
      );
    };
    const schedule = (): void => {
      if (rafId === null && !disposed) rafId = window.requestAnimationFrame(flush);
    };
    const ingest = (payload: string): void => {
      try {
        const json = JSON.parse(payload) as Partial<PythWirePayload>;
        transport = json.transport ?? "hermes";
        for (const update of json.parsed ?? []) {
          const m = MARKET_BY_FEED_ID.get(update.id.replace(/^0x/, ""));
          const q = quoteFromHermes(update);
          if (!m || !q) continue;
          const prev = quotes[m];
          if (prev && prev.publishTimeMs > q.publishTimeMs) continue;
          quotes[m] = q;
        }
        schedule();
      } catch {
        // Ignore malformed payloads.
      }
    };

    const startPolling = (): void => {
      if (disposed || pollId !== null) return;
      const poll = async (): Promise<void> => {
        try {
          const res = await fetch(`/api/pyth/latest?${query}`, {
            cache: "no-store",
            signal: abort.signal,
          });
          if (res.ok) ingest(await res.text());
        } catch {
          // Keep last quotes; staleness surfaces through status.
        }
      };
      void poll();
      pollId = window.setInterval(() => {
        void poll();
      }, 2_000);
    };

    const startStream = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/pyth/stream?${query}`, {
          signal: abort.signal,
          cache: "no-store",
          headers: { Accept: "text/event-stream" },
        });
        if (res.status !== 200 || !res.body) {
          startPolling();
          return;
        }
        await readSse(res.body, ingest);
        if (!disposed) startPolling();
      } catch {
        if (!disposed) startPolling();
      }
    };

    void startStream();
    // Re-evaluate staleness / session state once a second (no-op when unchanged).
    const statusId = window.setInterval(schedule, 1_000);

    return () => {
      disposed = true;
      abort.abort();
      window.clearInterval(statusId);
      if (pollId !== null) window.clearInterval(pollId);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [key]);

  return state;
}
