"use client";

import * as React from "react";
import {
  CARTRIDGE_PROGRAM_IDS,
  FIRST_PARTY_CARTRIDGE_CATALOG,
  USDC_UNIT,
  type CartridgeGenre,
} from "@cartridgefi/shared-types";
import { GlassPill, HardwareCartridgeCard, LivePulseDot } from "@cartridgefi/ui-system";

type GenreFilter = "ALL" | CartridgeGenre;

const FILTER_OPTIONS: readonly { id: GenreFilter; label: string }[] = [
  { id: "ALL", label: "All Genres" },
  { id: "BOREL_GAMEDAY", label: "Game-Day Arena" },
  { id: "ARCADE_RUNNER", label: "Arcade Runner" },
  { id: "SYNDICATE_TURF", label: "Syndicate Turf" },
  { id: "PREDICTION_BRACKET", label: "Prediction Bracket" },
];

interface CartridgeLiveTelemetry {
  slotCode: string;
  basePlayers: number;
  baseCreatorEarnedAtomicUsdc: bigint;
  stepFeeAtomicUsdc: bigint;
  playHref: string;
  badgeLabel: string;
}

const TELEMETRY_BY_SLUG: Record<string, CartridgeLiveTelemetry> = {
  "borel-macro-blitz-001": {
    slotCode: "#001",
    basePlayers: 1420,
    baseCreatorEarnedAtomicUsdc: 18_420_500_000n,
    stepFeeAtomicUsdc: 2_500_000n,
    playHref: "/play/borel",
    badgeLabel: "Reference Harness #001",
  },
  "pulse-runner-nvda-sol": {
    slotCode: "#002",
    basePlayers: 680,
    baseCreatorEarnedAtomicUsdc: 7_845_000_000n,
    stepFeeAtomicUsdc: 1_500_000n,
    playHref: "/play/pulse-runner",
    badgeLabel: "Forkable Genre Proof",
  },
  "vice-bourse-syndicate": {
    slotCode: "#003",
    basePlayers: 510,
    baseCreatorEarnedAtomicUsdc: 5_290_250_000n,
    stepFeeAtomicUsdc: 1_750_000n,
    playHref: "/play/borel?cartridge=vice-bourse-syndicate",
    badgeLabel: "Studio Preview",
  },
  "champions-prop-clash": {
    slotCode: "#004",
    basePlayers: 890,
    baseCreatorEarnedAtomicUsdc: 4_120_000_000n,
    stepFeeAtomicUsdc: 1_250_000n,
    playHref: "/play/borel?cartridge=champions-prop-clash",
    badgeLabel: "Community Cartridge",
  },
};

const DETERMINISTIC_PLAYER_OFFSETS = [0, 4, 9, 6, 12, 8, 14, 11] as const;

function formatAtomicUsdc(atomic: bigint): string {
  const whole = atomic / USDC_UNIT;
  const cents = ((atomic % USDC_UNIT) / 10_000n).toString().padStart(2, "0");
  const formattedWhole = new Intl.NumberFormat("en-US").format(whole);
  return `${formattedWhole}.${cents} USDC`;
}

export function CartridgeWallSection(): React.JSX.Element {
  const [activeFilter, setActiveFilter] = React.useState<GenreFilter>("ALL");
  const [settlementTick, setSettlementTick] = React.useState<number>(0);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setSettlementTick((prev) => prev + 1);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const filteredCatalog = React.useMemo(
    () =>
      activeFilter === "ALL"
        ? FIRST_PARTY_CARTRIDGE_CATALOG
        : FIRST_PARTY_CARTRIDGE_CATALOG.filter(
            (manifest) => manifest.metadata.genre === activeFilter,
          ),
    [activeFilter],
  );

  const playerOffset =
    DETERMINISTIC_PLAYER_OFFSETS[settlementTick % DETERMINISTIC_PLAYER_OFFSETS.length] ?? 0;

  const totalPlayers = FIRST_PARTY_CARTRIDGE_CATALOG.reduce((acc, item) => {
    const meta = TELEMETRY_BY_SLUG[item.metadata.slug];
    return acc + (meta ? meta.basePlayers + playerOffset : 100);
  }, 0);

  return (
    <section
      id="cartridge-wall"
      aria-labelledby="cartridge-wall-heading"
      className="scroll-mt-24 border-y border-white/[0.06] bg-[#0A0D14]/65 py-20 lg:py-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <GlassPill tone="cyan" size="xs">
                Any Genre · One Financial Physics Engine
              </GlassPill>
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-400 tabular-nums">
                <LivePulseDot tone="emerald" size="sm" />
                {new Intl.NumberFormat("en-US").format(totalPlayers)} Active Players Across{" "}
                {FIRST_PARTY_CARTRIDGE_CATALOG.length} Cartridges
              </span>
            </div>
            <h2
              id="cartridge-wall-heading"
              className="font-display text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl text-balance"
            >
              From endless runners to open-world syndicates.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-400">
              Every cartridge below executes against the exact same deployed{" "}
              <code translate="no" className="font-mono text-slate-200">
                cartridge-er-room
              </code>{" "}
              contract (<code translate="no" className="font-mono text-slate-300">{CARTRIDGE_PROGRAM_IDS.erRoom.slice(0, 8)}…</code>)—proving parameterized multi-genre game physics without writing custom smart contracts.
            </p>
          </div>

          {/* Genre Filter Pills */}
          <div
            role="group"
            aria-label="Filter cartridges by game genre"
            className="flex flex-wrap items-center gap-1.5"
          >
            {FILTER_OPTIONS.map((opt) => {
              const selected = activeFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`genre-filter-${opt.id}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveFilter(opt.id)}
                  className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F59B] ${
                    selected
                      ? "border-[#00F59B] bg-[#00F59B]/15 text-[#00F59B] font-semibold"
                      : "border-white/10 bg-[#050609]/80 text-slate-300 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hardware Cartridge Grid */}
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {filteredCatalog.map((manifest, index) => {
            const slug = manifest.metadata.slug;
            const meta = TELEMETRY_BY_SLUG[slug] ?? {
              slotCode: `#00${index + 1}`,
              basePlayers: 320,
              baseCreatorEarnedAtomicUsdc: 2_500_000_000n,
              stepFeeAtomicUsdc: 1_000_000n,
              playHref: "/play/borel",
              badgeLabel: "Verified Cartridge",
            };

            const livePlayers = meta.basePlayers + playerOffset + (index % 2 === 0 ? 2 : 0);
            const liveEarnedAtomic =
              meta.baseCreatorEarnedAtomicUsdc +
              BigInt(settlementTick) * meta.stepFeeAtomicUsdc;

            return (
              <HardwareCartridgeCard
                key={slug}
                id={`cartridge-card-${slug}`}
                slotCode={meta.slotCode}
                slug={slug}
                title={manifest.metadata.title}
                subtitle={manifest.metadata.subtitle}
                genre={manifest.metadata.genre}
                engineTarget={manifest.metadata.engineTarget}
                creatorHandle={manifest.metadata.creatorHandle}
                creatorFeeShareBps={manifest.metadata.creatorFeeShareBps}
                concurrentPlayers={livePlayers}
                creatorEarnedUsdcFormatted={formatAtomicUsdc(liveEarnedAtomic)}
                tickIntervalMs={manifest.magicblockRoomConfig.tickIntervalMs}
                durationSecs={manifest.magicblockRoomConfig.durationSecs}
                isPrivateTee={
                  manifest.magicblockRoomConfig.privacyMode ===
                  "PRIVATE_TEE_FOG_OF_WAR"
                }
                assets={manifest.marketUniverse.map((m) => m.symbol)}
                playHref={meta.playHref}
                forkHref={`/studio?fork=${slug}`}
                badgeLabel={meta.badgeLabel}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
