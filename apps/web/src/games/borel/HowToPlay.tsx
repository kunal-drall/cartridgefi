"use client";

import * as React from "react";

const STEPS: ReadonlyArray<{ title: string; body: string; visual: React.ReactNode }> = [
  {
    title: "Pick 3 markets",
    body: "Choose three different markets from SOL, BTC, ETH, NVDAx and SPY. Greyed-out markets have no fresh price right now.",
    visual: (
      <div className="flex gap-1.5">
        {["SOL", "BTC", "ETH"].map((m) => (
          <span key={m} className="rounded border border-[#3b82f6] bg-[#2563eb]/15 px-2 py-1 font-mono text-[11px] text-[#f3f4f6]">
            {m}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Call each one",
    body: "Long if you think it goes up over the round, Short if you think it goes down.",
    visual: (
      <div className="flex gap-1.5 font-mono text-[11px]">
        <span className="rounded border border-[#065f46] bg-[#064e3b]/40 px-2 py-1 text-[#34d399]">▲ Long</span>
        <span className="rounded border border-[#7f1d1d] bg-[#7f1d1d]/30 px-2 py-1 text-[#f87171]">▼ Short</span>
      </div>
    ),
  },
  {
    title: "Place your cards",
    body: "Put 1x, 2x and 3x on your three calls, once each. The 3x card is your Sniper: it triples that market's move.",
    visual: (
      <div className="flex gap-1.5 font-mono text-[11px]">
        <span className="rounded border border-[#2a2f39] px-2 py-1 text-[#d1d5db]">1x</span>
        <span className="rounded border border-[#2a2f39] px-2 py-1 text-[#d1d5db]">2x</span>
        <span className="rounded border border-[#92400e] bg-[#78350f]/40 px-2 py-1 text-[#fbbf24]">3x Sniper</span>
      </div>
    ),
  },
  {
    title: "Seal your hand",
    body: "Press Seal. Only a fingerprint of your hand is published, so nobody can see or copy your picks. The round clock starts.",
    visual: (
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-7 w-9 rounded border border-[#2a2f39] bg-[repeating-linear-gradient(135deg,#1a1e26_0_4px,#11141b_4px_8px)]"
          />
        ))}
      </div>
    ),
  },
  {
    title: "Watch the ladder, pivot once",
    body: "Rivals stay face-down; you only see ranks move with live prices. Once per round you can Flip a call (reverse it) or Shield it (bank the move and park it in cash).",
    visual: (
      <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
        <span className="text-[#9ca3af]">#5</span>
        <span className="text-[#6b7280]">→</span>
        <span className="text-[#34d399]">#2</span>
        <span className="ml-2 rounded border border-[#2a2f39] px-2 py-1 text-[#d1d5db]">Flip</span>
        <span className="rounded border border-[#2a2f39] px-2 py-1 text-[#d1d5db]">Shield</span>
      </div>
    ),
  },
  {
    title: "Showdown at 00:00",
    body: "Every hand flips face-up. Your score is each market's % move times its card, added up. Highest score wins. Share your receipt.",
    visual: (
      <span className="font-mono text-lg font-semibold tabular-nums text-[#f3f4f6]">00:00</span>
    ),
  },
];

/** First-visit rules screen; reopened from the "How to play" button in the table header. */
export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const startRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    // Keep the sheet at step 1 on small screens; focusing the footer button must not scroll it.
    startRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#050609]/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        id="borel-howto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="borel-howto-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-xl border border-[#22262e] bg-[#0a0d14] shadow-[0_24px_80px_rgba(0,0,0,0.6)] sm:rounded-xl"
      >
        <header className="border-b border-[#1c2029] px-5 py-4 sm:px-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b7280]">How to play</p>
          <h2 id="borel-howto-title" className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[#f3f4f6]">
            Three market calls. Hidden from everyone. Revealed at 00:00.
          </h2>
          <p className="mt-1.5 text-sm text-[#9ca3af]">
            Borel is fantasy trading with a sealed hand. Everyone plays the same live window; the best read of the market wins.
          </p>
        </header>

        <ol className="grid grid-cols-1 gap-px bg-[#1c2029] sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-2.5 bg-[#0a0d14] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#2a2f39] font-mono text-[11px] text-[#d1d5db]">
                  {i + 1}
                </span>
                <h3 className="text-sm font-semibold text-[#f3f4f6]">{step.title}</h3>
              </div>
              <p className="text-[13px] leading-relaxed text-[#9ca3af]">{step.body}</p>
              <div className="mt-auto pt-1">{step.visual}</div>
            </li>
          ))}
        </ol>

        <section className="border-t border-[#1c2029] px-5 py-4 sm:px-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b7280]">Example score</p>
          <div className="mt-2 grid grid-cols-1 gap-1 font-mono text-[12px] tabular-nums text-[#d1d5db] sm:grid-cols-3">
            <span>SOL Long · +1.0% × 3x = <span className="text-[#34d399]">+3.0%</span></span>
            <span>BTC Short · −0.5% × 2x = <span className="text-[#34d399]">+1.0%</span></span>
            <span>ETH Long · +0.2% × 1x = <span className="text-[#34d399]">+0.2%</span></span>
          </div>
          <p className="mt-1.5 font-mono text-[12px] text-[#f3f4f6] tabular-nums">Hand score +4.2%</p>
        </section>

        <footer className="flex flex-col gap-3 border-t border-[#1c2029] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[12px] text-[#6b7280]">
            Paper rooms are free practice against Pacer bots. Devnet rooms send real Solana devnet transactions.
          </p>
          <button
            ref={startRef}
            id="borel-howto-start"
            type="button"
            onClick={onClose}
            className="h-10 shrink-0 cursor-pointer rounded-md bg-[#2563eb] px-5 text-sm font-medium text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#93c5fd]"
          >
            Start playing
          </button>
        </footer>
      </div>
    </div>
  );
}

const PHASE_STEPS = [
  { phase: "DRAFT", label: "Build your hand", hint: "Pick 3 markets, call Long or Short, place your 1x / 2x / 3x cards, then press Seal hand." },
  { phase: "SEALED", label: "Sweat it out", hint: "Your hand is hidden. Watch your rank move with live prices. You can Flip or Shield one call, once." },
  { phase: "SHOWDOWN", label: "Showdown", hint: "All hands are revealed. Check your final rank, then share your receipt or start the next room." },
] as const;

/** Persistent "what do I do now" strip that tracks the table phase. */
export function PhaseGuide({ phase }: { phase: (typeof PHASE_STEPS)[number]["phase"] }): React.JSX.Element {
  const activeIndex = PHASE_STEPS.findIndex((s) => s.phase === phase);
  const active = PHASE_STEPS[activeIndex] ?? PHASE_STEPS[0];
  return (
    <section
      id="borel-phase-guide"
      aria-live="polite"
      className="rounded-xl border border-white/[0.08] bg-[#0a0d14] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
    >
      <ol className="grid grid-cols-3 gap-2">
        {PHASE_STEPS.map((s, i) => (
          <li key={s.phase} aria-current={i === activeIndex ? "step" : undefined}>
            <span
              className={
                i === activeIndex
                  ? "block h-1 rounded-full bg-[#3b82f6]"
                  : i < activeIndex
                    ? "block h-1 rounded-full bg-[#3b82f6]/35"
                    : "block h-1 rounded-full bg-white/[0.07]"
              }
            />
            <span
              className={
                i === activeIndex
                  ? "mt-1.5 block truncate font-mono text-[11px] font-medium text-[#f3f4f6]"
                  : "mt-1.5 block truncate font-mono text-[11px] text-[#6b7280]"
              }
            >
              {i + 1} · {s.label}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[13px] leading-snug text-[#d1d5db]">{active.hint}</p>
    </section>
  );
}
