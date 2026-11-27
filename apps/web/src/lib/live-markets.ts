import { PYTH_FEED_IDS, SOLANA_CANONICAL_MINTS } from "@cartridgefi/shared-types";

export interface LiveSpotOrEquityMarket {
  symbol: "SOL-USD" | "BTC-USD" | "NVDAx" | "SPYx" | "TSLAx";
  displaySymbol: string;
  name: string;
  assetClass: "CRYPTO_PERP" | "SOLANA_XSTOCK";
  venue: "PHOENIX_PERP" | "JUPITER_XSTOCKS";
  sourceName: string;
  sourceUrl: string;
  mint?: string;
  pairAddress?: string;
  dexId?: string;
  pythFeedId?: string;
  priceUsd: number;
  price8: string;
  bidUsd: number | null;
  askUsd: number | null;
  change24hPct: number;
  high24hUsd: number | null;
  low24hUsd: number | null;
  volume24hUsd: number;
  liquidityUsd: number | null;
  updatedAtIso: string;
  builderFeeBps: number;
}

export interface LiveKalshiContract {
  ticker: string;
  eventTicker: string;
  eventTitle: string;
  subtitle: string;
  category: string;
  yesBid: number;
  yesAsk: number;
  lastPrice: number;
  impliedProbPct: number;
  volumeContracts: number;
  closeTime: string | null;
  kalshiUrl: string;
}

export interface LiveMarketsSnapshot {
  ok: boolean;
  source: string;
  fetchedAtIso: string;
  markets: LiveSpotOrEquityMarket[];
  kalshiContracts: LiveKalshiContract[];
}

export interface OhlcvBar {
  /** Unix timestamp in seconds (UTC), strictly ascending */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveCandlesResponse {
  ok: boolean;
  symbol: string;
  interval: "5m" | "15m" | "1h";
  source: string;
  poolAddress?: string;
  fetchedAtIso: string;
  bars: OhlcvBar[];
}

export const CANONICAL_XSTOCK_POOLS: Record<
  "NVDAx" | "SPYx" | "TSLAx",
  { mint: string; name: string; primaryPool: string; pythFeedId?: string }
> = {
  NVDAx: {
    mint: SOLANA_CANONICAL_MINTS.NVDAx,
    name: "NVIDIA xStock (Solana SPL)",
    primaryPool: "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6",
    pythFeedId: PYTH_FEED_IDS["NVDAx/USD"],
  },
  SPYx: {
    mint: SOLANA_CANONICAL_MINTS.SPYx,
    name: "S&P 500 xStock (Solana SPL)",
    primaryPool: "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE",
    pythFeedId: PYTH_FEED_IDS["SPYx/USD"],
  },
  TSLAx: {
    mint: SOLANA_CANONICAL_MINTS.TSLAx,
    name: "Tesla xStock (Solana SPL)",
    primaryPool: "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF",
  },
};

function toPrice8(priceUsd: number): string {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return "0";
  return BigInt(Math.round(priceUsd * 1e8)).toString();
}

async function fetchCoinbaseProduct(
  productId: "SOL-USD" | "BTC-USD",
  name: string,
  pythFeedId?: string,
): Promise<LiveSpotOrEquityMarket | null> {
  try {
    const [statsRes, tickerRes] = await Promise.all([
      fetch(`https://api.exchange.coinbase.com/products/${productId}/stats`, {
        headers: { Accept: "application/json", "User-Agent": "CartridgeFi/2.0" },
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }),
      fetch(`https://api.exchange.coinbase.com/products/${productId}/ticker`, {
        headers: { Accept: "application/json", "User-Agent": "CartridgeFi/2.0" },
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }),
    ]);

    if (!statsRes.ok || !tickerRes.ok) return null;

    const stats = (await statsRes.json()) as {
      open?: string;
      high?: string;
      low?: string;
      last?: string;
      volume?: string;
    };
    const ticker = (await tickerRes.json()) as {
      price?: string;
      bid?: string;
      ask?: string;
      volume?: string;
      time?: string;
    };

    const priceUsd = Number(ticker.price ?? stats.last ?? "0");
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

    const openUsd = Number(stats.open ?? priceUsd);
    const change24hPct =
      openUsd > 0 ? ((priceUsd - openUsd) / openUsd) * 100 : 0;
    const baseVolume24h = Number(stats.volume ?? ticker.volume ?? "0");
    const volume24hUsd = Number.isFinite(baseVolume24h)
      ? baseVolume24h * priceUsd
      : 0;

    return {
      symbol: productId,
      displaySymbol: productId === "SOL-USD" ? "SOL-PERP" : "BTC-PERP",
      name,
      assetClass: "CRYPTO_PERP",
      venue: "PHOENIX_PERP",
      sourceName: "Coinbase Exchange",
      sourceUrl: `https://www.coinbase.com/advanced-trade/spot/${productId}`,
      pythFeedId,
      priceUsd,
      price8: toPrice8(priceUsd),
      bidUsd: ticker.bid ? Number(ticker.bid) : null,
      askUsd: ticker.ask ? Number(ticker.ask) : null,
      change24hPct,
      high24hUsd: stats.high ? Number(stats.high) : null,
      low24hUsd: stats.low ? Number(stats.low) : null,
      volume24hUsd,
      liquidityUsd: null,
      updatedAtIso: ticker.time ?? new Date().toISOString(),
      builderFeeBps: 20,
    };
  } catch {
    return null;
  }
}

interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
}

async function fetchDexScreenerXStocks(): Promise<LiveSpotOrEquityMarket[]> {
  const mints = [
    CANONICAL_XSTOCK_POOLS.NVDAx.mint,
    CANONICAL_XSTOCK_POOLS.SPYx.mint,
    CANONICAL_XSTOCK_POOLS.TSLAx.mint,
  ].join(",");

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mints}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { pairs?: DexScreenerPair[] };
    const pairs = (data.pairs ?? []).filter((p) => p.chainId === "solana");

    const results: LiveSpotOrEquityMarket[] = [];
    const entries = Object.entries(CANONICAL_XSTOCK_POOLS) as Array<
      [
        "NVDAx" | "SPYx" | "TSLAx",
        (typeof CANONICAL_XSTOCK_POOLS)["NVDAx"],
      ]
    >;

    for (const [symbol, meta] of entries) {
      const matching = pairs
        .filter(
          (p) =>
            p.baseToken?.address?.toLowerCase() === meta.mint.toLowerCase(),
        )
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

      const best = matching[0];
      if (!best || !best.priceUsd) continue;
      const priceUsd = Number(best.priceUsd);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;

      const totalVol24h = matching.reduce(
        (acc, p) => acc + (p.volume?.h24 ?? 0),
        0,
      );
      const totalLiq = matching.reduce(
        (acc, p) => acc + (p.liquidity?.usd ?? 0),
        0,
      );

      const rawDex = best.dexId ?? "raydium";
      const dexLabel = rawDex.charAt(0).toUpperCase() + rawDex.slice(1);

      results.push({
        symbol,
        displaySymbol: symbol,
        name: meta.name,
        assetClass: "SOLANA_XSTOCK",
        venue: "JUPITER_XSTOCKS",
        sourceName: `Solana ${dexLabel} Pool`,
        sourceUrl:
          best.url ??
          `https://dexscreener.com/solana/${best.pairAddress ?? meta.primaryPool}`,
        mint: meta.mint,
        pairAddress: best.pairAddress ?? meta.primaryPool,
        dexId: best.dexId ?? "raydium",
        pythFeedId: meta.pythFeedId,
        priceUsd,
        price8: toPrice8(priceUsd),
        bidUsd: Number((priceUsd * 0.9992).toFixed(4)),
        askUsd: Number((priceUsd * 1.0008).toFixed(4)),
        change24hPct: best.priceChange?.h24 ?? 0,
        high24hUsd: null,
        low24hUsd: null,
        volume24hUsd: totalVol24h,
        liquidityUsd: totalLiq,
        updatedAtIso: new Date().toISOString(),
        builderFeeBps: 20,
      });
    }

    return results;
  } catch {
    return [];
  }
}

interface KalshiRawMarket {
  ticker?: string;
  yes_sub_title?: string;
  subtitle?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
  volume_fp?: string;
  close_time?: string;
}

interface KalshiRawEvent {
  event_ticker?: string;
  title?: string;
  category?: string;
  markets?: KalshiRawMarket[];
}

async function fetchLiveKalshiContracts(): Promise<LiveKalshiContract[]> {
  try {
    const [fedRes, openRes] = await Promise.all([
      fetch(
        "https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXFEDDECISION&status=open&with_nested_markets=true",
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4500),
          cache: "no-store",
        },
      ),
      fetch(
        "https://api.elections.kalshi.com/trade-api/v2/events?limit=40&status=open&with_nested_markets=true",
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4500),
          cache: "no-store",
        },
      ),
    ]);

    const events: KalshiRawEvent[] = [];
    if (fedRes.ok) {
      const fedData = (await fedRes.json()) as { events?: KalshiRawEvent[] };
      events.push(...(fedData.events ?? []));
    }
    if (openRes.ok) {
      const openData = (await openRes.json()) as { events?: KalshiRawEvent[] };
      events.push(...(openData.events ?? []));
    }

    const seenTickers = new Set<string>();
    const contracts: LiveKalshiContract[] = [];

    for (const ev of events) {
      const eventTicker = ev.event_ticker ?? "";
      const eventTitle = ev.title ?? eventTicker;
      const category = ev.category ?? "Macro";

      for (const m of ev.markets ?? []) {
        const ticker = m.ticker ?? "";
        if (!ticker || seenTickers.has(ticker)) continue;

        const yesBid = Number(m.yes_bid_dollars ?? "0");
        const yesAsk = Number(m.yes_ask_dollars ?? "0");
        const lastPrice = Number(m.last_price_dollars ?? "0");
        const volumeContracts = Number(m.volume_fp ?? "0");

        if (volumeContracts < 250 || (lastPrice <= 0 && yesAsk <= 0)) {
          continue;
        }

        seenTickers.add(ticker);
        const mid =
          yesBid > 0 && yesAsk > 0
            ? (yesBid + yesAsk) / 2
            : lastPrice > 0
              ? lastPrice
              : yesAsk;

        contracts.push({
          ticker,
          eventTicker,
          eventTitle,
          subtitle: m.yes_sub_title || m.subtitle || "Yes",
          category,
          yesBid,
          yesAsk,
          lastPrice: lastPrice > 0 ? lastPrice : mid,
          impliedProbPct: Math.round(mid * 1000) / 10,
          volumeContracts,
          closeTime: m.close_time ?? null,
          kalshiUrl: `https://kalshi.com/markets/${eventTicker.split("-")[0]?.toLowerCase() ?? ""}`,
        });
      }
    }

    contracts.sort((a, b) => b.volumeContracts - a.volumeContracts);
    return contracts.slice(0, 12);
  } catch {
    return [];
  }
}

let cachedMarkets: { expiresAt: number; data: LiveMarketsSnapshot } | null = null;

export async function getLiveMarketsSnapshot(): Promise<LiveMarketsSnapshot> {
  const now = Date.now();
  if (cachedMarkets && cachedMarkets.expiresAt > now) {
    return cachedMarkets.data;
  }

  const [solMarket, btcMarket, xStocks, kalshiContracts] = await Promise.all([
    fetchCoinbaseProduct("SOL-USD", "Solana / USD", PYTH_FEED_IDS["SOL/USD"]),
    fetchCoinbaseProduct("BTC-USD", "Bitcoin / USD"),
    fetchDexScreenerXStocks(),
    fetchLiveKalshiContracts(),
  ]);

  const markets: LiveSpotOrEquityMarket[] = [];
  if (solMarket) markets.push(solMarket);
  if (btcMarket) markets.push(btcMarket);
  markets.push(...xStocks);

  const snapshot: LiveMarketsSnapshot = {
    ok: markets.length > 0,
    source: "live-multi-venue (Coinbase Exchange + Solana DexScreener + Kalshi)",
    fetchedAtIso: new Date().toISOString(),
    markets,
    kalshiContracts,
  };

  if (markets.length > 0) {
    cachedMarkets = {
      expiresAt: now + 8_000,
      data: snapshot,
    };
  }

  return snapshot;
}

const candleCache = new Map<
  string,
  { expiresAt: number; data: LiveCandlesResponse }
>();

export async function getLiveCandles(
  symbolRaw: string,
  intervalRaw: string,
): Promise<LiveCandlesResponse> {
  const symbol =
    symbolRaw === "BTC-USD" ||
    symbolRaw === "NVDAx" ||
    symbolRaw === "SPYx" ||
    symbolRaw === "TSLAx"
      ? symbolRaw
      : "SOL-USD";

  const interval: "5m" | "15m" | "1h" =
    intervalRaw === "15m" || intervalRaw === "1h" ? intervalRaw : "5m";

  const cacheKey = `${symbol}:${interval}`;
  const now = Date.now();
  const hit = candleCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return hit.data;
  }

  if (symbol === "SOL-USD" || symbol === "BTC-USD") {
    const granularity =
      interval === "1h" ? 3600 : interval === "15m" ? 900 : 300;
    try {
      const res = await fetch(
        `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${granularity}`,
        {
          headers: { Accept: "application/json", "User-Agent": "CartridgeFi/2.0" },
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        },
      );
      if (res.ok) {
        // Coinbase returns [time, low, high, open, close, volume] descending
        const raw = (await res.json()) as Array<
          [number, number, number, number, number, number]
        >;
        const seen = new Set<number>();
        const bars: OhlcvBar[] = [];
        for (const row of raw) {
          const [t, low, high, open, close, volume] = row;
          if (typeof t !== "number" || seen.has(t)) continue;
          seen.add(t);
          bars.push({
            time: t,
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
            volume: Number(volume),
          });
        }
        bars.sort((a, b) => a.time - b.time);

        const payload: LiveCandlesResponse = {
          ok: bars.length > 0,
          symbol,
          interval,
          source: `Coinbase Exchange (${symbol})`,
          fetchedAtIso: new Date().toISOString(),
          bars: bars.slice(-180),
        };
        if (bars.length > 0) {
          candleCache.set(cacheKey, { expiresAt: now + 12_000, data: payload });
        }
        return payload;
      }
    } catch {
      // Handled below
    }
  } else {
    const poolMeta = CANONICAL_XSTOCK_POOLS[symbol];
    let poolAddress = poolMeta.primaryPool;

    // If markets cache has an updated highest-liquidity pool, prefer it
    const liveSnap = cachedMarkets?.data;
    const liveEntry = liveSnap?.markets.find((m) => m.symbol === symbol);
    if (liveEntry?.pairAddress) {
      poolAddress = liveEntry.pairAddress;
    }

    const timeframe = interval === "1h" ? "hour" : "minute";
    const aggregate = interval === "1h" ? 1 : interval === "15m" ? 15 : 5;

    try {
      const res = await fetch(
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=120`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          data?: {
            attributes?: {
              ohlcv_list?: Array<
                [number, number, number, number, number, number]
              >;
            };
          };
        };
        const list = json.data?.attributes?.ohlcv_list ?? [];
        const seen = new Set<number>();
        const bars: OhlcvBar[] = [];
        for (const row of list) {
          const [t, open, high, low, close, volume] = row;
          if (typeof t !== "number" || seen.has(t)) continue;
          seen.add(t);
          bars.push({
            time: t,
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
            volume: Number(volume),
          });
        }
        bars.sort((a, b) => a.time - b.time);

        const payload: LiveCandlesResponse = {
          ok: bars.length > 0,
          symbol,
          interval,
          source: `GeckoTerminal Solana Raydium (${poolAddress.slice(0, 6)}…)`,
          poolAddress,
          fetchedAtIso: new Date().toISOString(),
          bars,
        };
        if (bars.length > 0) {
          candleCache.set(cacheKey, { expiresAt: now + 15_000, data: payload });
        }
        return payload;
      }
    } catch {
      // Handled below
    }
  }

  return {
    ok: false,
    symbol,
    interval,
    source: "upstream-unavailable",
    fetchedAtIso: new Date().toISOString(),
    bars: [],
  };
}
