"use client";

import * as React from "react";
import styles from "./pitch.module.css";
import { SLIDE_COUNT } from "./facts";
import { SLIDES } from "./slides";

const CANVAS_W = 1920;
const CANVAS_H = 1080;

function clampSlide(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(SLIDE_COUNT, Math.max(1, Math.trunc(n)));
}

export function PitchDeck({ initialSlide, printMode }: { initialSlide: number; printMode: boolean }) {
  if (printMode) {
    return (
      <div className={styles.printRoot} data-pitch-print="true">
        <style>{`@page { size: ${CANVAS_W}px ${CANVAS_H}px; margin: 0; } html, body { background: #050609 !important; width: ${CANVAS_W}px; overflow: visible !important; }`}</style>
        {SLIDES.map((SlideComponent, i) => (
          <SlideComponent key={i} index={i + 1} />
        ))}
      </div>
    );
  }
  return <DeckViewer initialSlide={clampSlide(initialSlide)} />;
}

function DeckViewer({ initialSlide }: { initialSlide: number }) {
  const [current, setCurrent] = React.useState(initialSlide);
  const [scale, setScale] = React.useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const hideTimer = React.useRef<number | null>(null);

  const go = React.useCallback((next: number) => {
    setCurrent(clampSlide(next));
  }, []);

  // Fit the 1920x1080 canvas into the viewport.
  React.useLayoutEffect(() => {
    const fit = () => {
      setScale(Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Keep ?s=N in sync without triggering a Next.js navigation.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("s") !== String(current)) {
      url.searchParams.set("s", String(current));
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, [current]);

  // Keyboard navigation.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("button") && (e.key === " " || e.key === "Enter")) return;
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          setCurrent((c) => clampSlide(c + 1));
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          setCurrent((c) => clampSlide(c - 1));
          break;
        case "Home":
          e.preventDefault();
          setCurrent(1);
          break;
        case "End":
          e.preventDefault();
          setCurrent(SLIDE_COUNT);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Back/forward restores the slide from ?s=N.
  React.useEffect(() => {
    const onPop = () => {
      const s = Number(new URL(window.location.href).searchParams.get("s") ?? "1");
      setCurrent(clampSlide(s));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Auto-hide the control bar after pointer inactivity.
  const pokeControls = React.useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2200);
  }, []);

  React.useEffect(() => {
    pokeControls();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [pokeControls]);

  const SlideComponent = SLIDES[current - 1] ?? SLIDES[0]!;

  return (
    <div
      className={styles.viewport}
      onPointerMove={pokeControls}
      role="region"
      aria-roledescription="slide deck"
      aria-label="CartridgeFi pitch deck"
    >
      <div
        className={styles.stage}
        style={{
          transform: `translate(-50%, -50%) scale(${scale ?? 1})`,
          visibility: scale === null ? "hidden" : "visible",
        }}
      >
        <SlideComponent index={current} />
      </div>

      <button
        type="button"
        className={styles.hitLeft}
        aria-label="Previous slide"
        tabIndex={-1}
        onClick={() => go(current - 1)}
      />
      <button
        type="button"
        className={styles.hitRight}
        aria-label="Next slide"
        tabIndex={-1}
        onClick={() => go(current + 1)}
      />

      <div className={`${styles.controls} ${controlsVisible ? styles.controlsVisible : ""}`}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => go(current - 1)}
          disabled={current <= 1}
          aria-label="Previous slide"
        >
          ←
        </button>
        <span className={styles.controlCount} aria-live="polite">
          {String(current).padStart(2, "0")} / {SLIDE_COUNT}
        </span>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => go(current + 1)}
          disabled={current >= SLIDE_COUNT}
          aria-label="Next slide"
        >
          →
        </button>
      </div>
    </div>
  );
}
