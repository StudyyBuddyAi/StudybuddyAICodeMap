import { useEffect, useState } from "react";
import { renderOrder, sectionHasBody } from "@/lib/sheet-plan";
import type { GeneratedSheet } from "@/types/generated-sheet";

/**
 * The sheet's contents as data, shared by the section rail, the sections menu
 * and the generator — kept out of the component files so fast refresh can
 * reload those on their own.
 */

export type SectionState = "done" | "live" | "waiting" | "idle";

export interface SectionEntry {
  key: string;
  title: string;
  state: SectionState;
}

/**
 * The sections to list. Mid-stream every planned section is listed, so the
 * list holds its shape from the first frame; once the sheet is whole, only the
 * ones with something in them.
 */
export function listSections(
  sheet: GeneratedSheet,
  streaming: boolean,
  readyKeys: string[],
  liveKey?: string
): SectionEntry[] {
  const order = renderOrder(sheet);
  if (!streaming) {
    return order
      .filter((s) => sectionHasBody(sheet, s.key))
      .map((s) => ({ key: s.key, title: s.title, state: "idle" as const }));
  }
  // The parser's key when it names a listed section; otherwise, sections
  // arrive in order, so the first one not yet written is the one in flight.
  const live = order.some((s) => s.key === liveKey)
    ? liveKey
    : order.find((s) => !readyKeys.includes(s.key))?.key;
  return order.map((s) => ({
    key: s.key,
    title: s.title,
    state: readyKeys.includes(s.key) ? "done" : s.key === live ? "live" : "waiting",
  }));
}

export function jumpToSection(key: string) {
  document
    .querySelector(`[data-section-key="${key}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The section the reader is on: whichever card crosses a thin band a fifth of
 * the way down the viewport — below the sticky nav and topic bar, where the
 * eye actually is. `resetToken` changes per sheet, so a new sheet starts at
 * its first section rather than wherever the last one was left.
 */
export function useActiveSection(keys: string[], resetToken: unknown): string {
  const signature = keys.join("|");
  const [active, setActive] = useState(keys[0] ?? "");

  useEffect(() => {
    setActive(signature.split("|")[0] ?? "");
  }, [resetToken]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per sheet only

  useEffect(() => {
    const els = signature
      .split("|")
      .map((k) => document.querySelector<HTMLElement>(`[data-section-key="${k}"]`))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        );
        const key = topmost.target.getAttribute("data-section-key");
        if (key) setActive(key);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [signature]);

  // At the top of the page no card has reached the band yet, and a section
  // list that arrives after mount (the plan) has nothing tracked at all: the
  // first section is where the reader is.
  return keys.includes(active) ? active : keys[0] ?? "";
}

/** Shared by every button in the topic bar, so they read as one set. */
export const TOPIC_BAR_BUTTON =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:border-primary/50 hover:text-foreground disabled:cursor-default disabled:opacity-50 data-[state=open]:border-primary data-[state=open]:text-foreground";
