"use client";

import * as React from "react";

const STEPS: ReadonlyArray<{ title: string; body: string; visual: React.ReactNode }> = [
  {
    title: "Call 3 markets",
    body: "Pick three markets, call each one Long (up) or Short (down), and put your 1x, 2x and 3x cards on them. The 3x is your Sniper: it triples that move.",
    visual: (
      <div className="flex flex-wrap gap-1.5 font-mono text-[11px] tabular-nums">
        <span className="rounded border border-[#92400e] bg-[#78350f]/40 px-2 py-1 text-[#fbbf24]">SOL ▲ 3x</span>
        <span className="rounded border border-[#065f46] bg-[#064e3b]/40 px-2 py-1 text-[#34d399]">BTC ▲ 2x</span>
        <span className="rounded border border-[#7f1d1d] bg-[#7f1d1d]/30 px-2 py-1 text-[#f87171]">ETH ▼ 1x</span>
      </div>
    ),
  },
  {
    title: "Seal it, then sweat",
    body: "Sealing publishes only a fingerprint of your hand. Rivals see your rank move with live prices, never your picks. Once per round you can Flip a call or Shield it in cash.",
    visual: (
      <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-7 w-6 rounded border border-[#f59e0b]/30 bg-[repeating-linear-gradient(135deg,#1a1e26_0_4px,#11141b_4px_8px)]"
          />
        ))}
        <span className="ml-1 text-[#9ca3af]">#5</span>
        <span className="text-[#7d8590]">→</span>
        <span className="text-[#34d399]">#2</span>
      </div>
    ),
  },
  {
    title: "Unseal at 00:00",
    body: "Every hand flips face-up at the bell. Score = each market's % move × its card, added up. Highest score takes the table.",
    visual: (
      <div className="font-mono text-[12px] tabular-nums text-[#d1d5db]">
        <span className="text-[#34d399]">+1.0% × 3</span> + <span className="text-[#34d399]">0.5% × 2</span> +{" "}
        <span className="text-[#f87171]">−0.2% × 1</span> = <span className="font-semibold text-[#f3f4f6]">+3.8%</span>
      </div>
    ),
  },
];

/** First-visit rules screen; reopened from the "How to play" button in the table header. */
export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const startRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
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
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-[#22262e] bg-[#0a0d14] shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.10)] sm:rounded-2xl"
      >
        <div className="overflow-y-auto">
          <header className="px-5 pb-3 pt-5 sm:px-7 sm:pt-6">
            <h2
              id="borel-howto-title"
              className="text-[24px] font-bold leading-[1.02] tracking-[-0.035em] text-[#f3f4f6] sm:text-[28px]"
            >
              Call 3 markets. Hide your hand. Unseal at 00:00.
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#9ca3af]">
              Fantasy trading with a sealed hand. Everyone plays the same live 3-minute window; the best read wins.
            </p>
          </header>

          <ol className="space-y-px px-3 pb-3 sm:px-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3.5 rounded-xl px-2 py-3 sm:px-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2563eb]/15 font-mono text-[12px] font-semibold text-[#93c5fd] tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1.5">
                  <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#f3f4f6]">{step.title}</h3>
                  <p className="text-[13px] leading-relaxed text-[#9ca3af]">{step.body}</p>
                  <div className="pt-0.5">{step.visual}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <footer className="flex flex-col gap-2.5 border-t border-[#1c2029] bg-[#0a0d14] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="text-[12px] text-[#9ca3af]">
            Paper rooms are free practice against labelled Pacer bots. Devnet rooms send real devnet transactions.
          </p>
          <button
            ref={startRef}
            id="borel-howto-start"
            type="button"
            onClick={onClose}
            className="cf-btn h-12 shrink-0 cursor-pointer rounded-lg bg-[#2563eb] px-6 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-[#1d4ed8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#93c5fd]"
          >
            Start playing
          </button>
        </footer>
      </div>
    </div>
  );
}

const PHASE_STEPS = [
  { phase: "DRAFT", label: "Build your hand", hint: "Pick 3 markets, call Long or Short, place 1x / 2x / 3x, then Seal." },
  { phase: "SEALED", label: "Sweat it out", hint: "Your hand is hidden. Watch your rank move; Flip or Shield one call, once." },
  { phase: "SHOWDOWN", label: "Showdown", hint: "Every hand is face-up. Share your receipt or start the next room." },
] as const;

/** Persistent "what do I do now" strip that tracks the table phase. */
export function PhaseGuide({ phase }: { phase: (typeof PHASE_STEPS)[number]["phase"] }): React.JSX.Element {
  const activeIndex = PHASE_STEPS.findIndex((s) => s.phase === phase);
  const active = PHASE_STEPS[activeIndex] ?? PHASE_STEPS[0];
  return (
    <section
      id="borel-phase-guide"
      aria-live="polite"
      className="rounded-xl border border-white/[0.08] bg-[#0a0d14] px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
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
                  : "mt-1.5 block truncate font-mono text-[11px] text-[#7d8590]"
              }
            >
              <span className="hidden sm:inline">{i + 1} · </span>
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[13px] leading-snug text-[#d1d5db]">{active.hint}</p>
    </section>
  );
}
