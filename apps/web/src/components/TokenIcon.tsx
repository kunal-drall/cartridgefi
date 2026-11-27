import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Token marks downloaded once from Jupiter's token registry
 * (lite-api.jup.ag/tokens/v2/search?query=<mint>) and served from /public/tokens.
 * Keys cover both chart symbols (SOL-USD) and plain tickers (SOL).
 * ETH uses the official ethereum.org diamond (ethereum-org-website/public/images/assets/
 * eth-diamond-purple.png) placed once on a round badge to match the other marks.
 */
const TOKEN_ICON_SRC: Readonly<Record<string, string>> = {
  SOL: "/tokens/sol.webp",
  "SOL-USD": "/tokens/sol.webp",
  WSOL: "/tokens/sol.webp",
  BTC: "/tokens/btc.webp",
  "BTC-USD": "/tokens/btc.webp",
  ETH: "/tokens/eth.png",
  "ETH-USD": "/tokens/eth.png",
  USDC: "/tokens/usdc.webp",
  NVDAX: "/tokens/nvdax.webp",
  SPYX: "/tokens/spyx.webp",
  TSLAX: "/tokens/tslax.webp",
};

/** Venue / wallet monogram tints (no official SVG vendored; monogram badge by design). */
const MONOGRAM_TINT: Readonly<Record<string, string>> = {
  KALSHI: "#0f9f6e",
  RAYDIUM: "#5a3fd1",
  COINBASE: "#1652f0",
  PHANTOM: "#7c6cf0",
  SOLFLARE: "#e88a1a",
  BACKPACK: "#d6403a",
  MAGICBLOCK: "#3b82f6",
  SOLANA: "#14b8a6",
};

export interface TokenIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function TokenIcon({
  symbol,
  size = 16,
  className,
}: TokenIconProps): React.JSX.Element {
  const key = symbol.toUpperCase();
  const src = TOKEN_ICON_SRC[key];

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn("shrink-0 rounded-full bg-[#171a20]", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const tint = MONOGRAM_TINT[key] ?? "#303642";
  const glyph = key.replace(/[^A-Z0-9]/g, "").slice(0, key.length > 4 ? 1 : 2);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[4px] font-sans font-semibold leading-none text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, Math.round(size * 0.42)),
        backgroundColor: tint,
      }}
    >
      {glyph}
    </span>
  );
}
