import * as React from "react";
import { getLiveMarketsSnapshot } from "@/lib/live-markets";
import { MarketsWorkstation } from "@/components/MarketsWorkstation";
import { UI_SYSTEM_TAILWIND_SAFELIST } from "./_components/ui-safelist";

void UI_SYSTEM_TAILWIND_SAFELIST.length;

export const dynamic = "force-dynamic";

export default async function MarketsHomePage(): Promise<React.JSX.Element> {
  const initialMarkets = await getLiveMarketsSnapshot();
  return <MarketsWorkstation initialMarkets={initialMarkets} />;
}
