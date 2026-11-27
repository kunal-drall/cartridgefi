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

/**
 * Sign of a score as the player sees it: scores that round to "+0.000%" count as flat, so a
 * −0.0004% leg never renders red next to a "+0.000%" label.
 */
export function displaySign(scoreE9: bigint): -1 | 0 | 1 {
  const milliPct = scoreE9 / 10_000n;
  if (milliPct > 0n) return 1;
  if (milliPct < 0n) return -1;
  return 0;
}

/** Text colour for a score, keyed to its displayed (rounded) sign. */
export function scoreToneClass(scoreE9: bigint): string {
  const sign = displaySign(scoreE9);
  if (sign > 0) return "text-[#34d399]";
  if (sign < 0) return "text-[#f87171]";
  return "text-[#d1d5db]";
}

/** Shared keyboard focus ring for every Borel control (visible on the dark table surfaces). */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#93c5fd] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d14]";

/** "10.00" from test-USDC base units (6 decimals), floored to cents with integer math only. */
export function formatTestUsdc(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 1_000_000n;
  const cents = ((abs % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}${GROUPED.format(whole)}.${cents}`;
}

/** "10" for whole amounts, "12.50" otherwise: for tight chips such as the ladder stake badge. */
export function formatTestUsdcCompact(units: bigint): string {
  return units % 1_000_000n === 0n ? GROUPED.format(units / 1_000_000n) : formatTestUsdc(units);
}
