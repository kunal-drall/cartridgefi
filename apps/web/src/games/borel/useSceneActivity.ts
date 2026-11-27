"use client";

import * as React from "react";

export interface SceneActivity {
  /** True only while the tab is visible and the canvas host intersects the viewport. */
  active: boolean;
  reducedMotion: boolean;
}

/**
 * Tracks whether a WebGL host should keep rendering: pauses on hidden tabs and
 * off-screen hosts, and reports the user's prefers-reduced-motion preference.
 */
export function useSceneActivity(
  hostRef: React.RefObject<HTMLElement | null>,
): SceneActivity {
  const [pageVisible, setPageVisible] = React.useState<boolean>(true);
  const [inView, setInView] = React.useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = React.useState<boolean>(false);

  React.useEffect(() => {
    const syncVisibility = (): void => {
      setPageVisible(document.visibilityState === "visible");
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = (): void => setReducedMotion(motionQuery.matches);
    syncMotion();
    motionQuery.addEventListener("change", syncMotion);

    let observer: IntersectionObserver | null = null;
    const host = hostRef.current;
    if (host && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (entry) setInView(entry.isIntersecting);
      });
      observer.observe(host);
    }

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      motionQuery.removeEventListener("change", syncMotion);
      observer?.disconnect();
    };
  }, [hostRef]);

  return { active: pageVisible && inView, reducedMotion };
}
