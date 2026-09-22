import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared state for the sheet reader: where in the document the reader is, and
 * whether the ambient field behind it is switched on.
 *
 * The section tones already existed as design tokens (`--section-*`) but were
 * only ever used for card glows. They are the natural colour vocabulary for
 * "which section am I in", so the rail and the background both read from here.
 */

const SECTION_TONE: Record<string, string> = {
  overview: "--section-summary",
  memoryHooks: "--section-memoryhooks",
  clinicalApproach: "--section-clinical",
  keyPoints: "--section-keypoints",
  examTraps: "--section-examtraps",
  diagram: "--section-visuals",
  illustration: "--section-visuals",
  flashcards: "--section-flashcards",
  referenceNote: "--section-keypoints",
};

export function toneTokenFor(key: string | null): string {
  return (key && SECTION_TONE[key]) || "--sb-accent";
}

/**
 * Fraction down the viewport treated as "what the reader is looking at". Kept
 * high in the viewport so the first section stays current at the top of the page.
 */
const FOCUS_LINE = 0.28;

export interface ReadingPosition {
  /** Section under the focus line, or null before anything has been measured. */
  activeKey: string | null;
  /** 0 at the top of the sheet, 1 once the last section has been reached. */
  progress: number;
}

/**
 * Tracks the reader against the sheet's own section cards.
 *
 * Nine elements is few enough that measuring them all on a rAF-throttled scroll
 * is cheaper and far more predictable than an IntersectionObserver with a
 * threshold ladder — and it gives a continuous progress value for free, which
 * an observer cannot.
 */
export function useReadingPosition(
  containerRef: React.RefObject<HTMLElement>,
  /** Re-measure when the sheet's shape changes (new sheet, streamed section). */
  revision: unknown
): ReadingPosition {
  const [position, setPosition] = useState<ReadingPosition>({ activeKey: null, progress: 0 });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const measure = () => {
      frame.current = null;
      const container = containerRef.current;
      if (!container) return;

      const focusY = window.innerHeight * FOCUS_LINE;
      const sections = container.querySelectorAll<HTMLElement>("[data-section-key]");
      if (sections.length === 0) return;

      let activeKey = sections[0].dataset.sectionKey ?? null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= focusY) {
          activeKey = section.dataset.sectionKey ?? activeKey;
        }
      }

      // The sheet is "finished" once its last section reaches the focus line,
      // not once the page bottoms out — otherwise progress sticks below 1 on a
      // sheet shorter than the viewport.
      const rect = container.getBoundingClientRect();
      const travel = Math.max(rect.height - window.innerHeight * (1 - FOCUS_LINE), 1);
      const progress = Math.min(Math.max((focusY - rect.top) / travel, 0), 1);

      setPosition((prev) =>
        prev.activeKey === activeKey && Math.abs(prev.progress - progress) < 0.004
          ? prev
          : { activeKey, progress }
      );
    };

    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [containerRef, revision]);

  return position;
}

const FIELD_PREF_KEY = "sb_ambient_field";

export interface AmbientFieldPreference {
  /** False hides the field entirely — the page falls back to a flat background. */
  enabled: boolean;
  /** True means: draw the field, but never move it. */
  reducedMotion: boolean;
  toggle: () => void;
}

/**
 * Motion behind body text is the part of this that carries real risk — it is
 * documented to raise cognitive load and to make text harder to concentrate on,
 * so the field is off for anyone who asked their OS to reduce motion, and
 * anyone else can switch it off and have that remembered.
 */
export function useAmbientFieldPreference(): AmbientFieldPreference {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(FIELD_PREF_KEY) !== "off";
  });

  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FIELD_PREF_KEY, next ? "on" : "off");
      } catch {
        // Private mode: the preference just doesn't survive the session.
      }
      return next;
    });
  }, []);

  return { enabled, reducedMotion, toggle };
}

/** Scrolls a section card to the top of the reading area. */
export function scrollToSection(key: string, smooth: boolean) {
  const target = document.querySelector<HTMLElement>(`[data-section-key="${key}"]`);
  target?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}
