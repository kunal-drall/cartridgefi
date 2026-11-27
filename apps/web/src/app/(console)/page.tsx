import * as React from "react";
import type { Metadata } from "next";
import { BorelTable } from "@/games/borel/BorelTable";

export const metadata: Metadata = {
  title: "Borel · Sealed-conviction live market showdowns",
  description:
    "Draft three live markets, seal your conviction, and race a sealed rank ladder to the 00:00 showdown on Solana devnet.",
};

export default function BorelHomePage(): React.JSX.Element {
  return <BorelTable />;
}
