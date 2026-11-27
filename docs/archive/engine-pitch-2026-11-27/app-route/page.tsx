import type { Metadata } from "next";
import { PitchDeck } from "@/pitch/PitchDeck";

export const metadata: Metadata = {
  title: "Pitch",
  description:
    "CartridgeFi seed deck: the parameterized execution and settlement engine for real-market apps on Solana and MagicBlock.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PitchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const slide = Number(first(params.s) ?? "1");
  const printMode = first(params.print) === "1";

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&display=block"
        precedence="default"
      />
      <PitchDeck initialSlide={Number.isFinite(slide) ? slide : 1} printMode={printMode} />
    </>
  );
}
