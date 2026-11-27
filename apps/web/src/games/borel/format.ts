import { SCALE, type BorelMarket } from "@/lib/borel/types";

export const MARKET_SHORT: Record<BorelMarket, string> = {
  "SOL/USD": "SOL",
  "BTC/USD": "BTC",
  "ETH/USD": "ETH",
  "NVDAx/USD": "NVDAx",
  "SPY/USD": "SPY",
};

export const EQUITY_MARKETS: ReadonlySet<BorelMarket> = new Set<BorelMarket>([
  "NVDAx/USD",
  "SPY/USD",
]);

const GROUPED = new Intl.NumberFormat("en-US");

/** "$1,234.56" from a 1e9 fixed-point price using integer math only. */
export function formatPriceE9(priceE9: bigint | undefined): string {
  if (priceE9 === undefined || priceE9 <= 0n) return "—";
  const whole = priceE9 / SCALE;
  const cents = ((priceE9 % SCALE) / 10_000_000n).toString().padStart(2, "0");
  return `$${GROUPED.format(whole)}.${cents}`;
}

/** "02:59" from milliseconds (floored to whole seconds, never negative). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(total / 60).toString().padStart(2, "0");
  const secs = (total % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

export function shortHash(value: string, head = 6, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** "+0.021%" — percent with three decimals (0.1 bp resolution) so close ladders stay legible. */
export function formatScorePctPrecise(scoreE9: bigint): string {
  const milliPct = scoreE9 / 10_000n; // 1e9 = 100% → 1 unit = 0.001%
  const negative = milliPct < 0n;
  const abs = negative ? -milliPct : milliPct;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, "0");
  return `${negative ? "−" : "+"}${whole.toString()}.${frac}%`;
}
