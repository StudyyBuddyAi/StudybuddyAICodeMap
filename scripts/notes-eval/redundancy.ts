/**
 * How much of a sheet says again what an earlier section already said.
 *
 * A line counts as repeated when one line in an EARLIER section already holds
 * most of its content terms — at least three of them, and at least half of the
 * line's own. Terms come from the app's recall matcher (section-recall), so
 * "patients", "diagnosis" and the like never make two lines look alike.
 *
 * It is a word-overlap proxy, not a judgment: a paraphrase can slip past it,
 * and a topic whose name recurs in every line (sensitivity and specificity)
 * reads a little high. Checked against a model judge that counted repeated
 * facts across 50 sheets, it tracked the judge at r ≈ 0.6 — enough to compare
 * two prompt sets over a run, not to grade one sheet. It needs no model call.
 */
import { terms } from "../../src/lib/section-recall.ts";

export interface SectionLines {
  key: string;
  lines: string[];
}

export interface Redundancy {
  /** Lines with enough content to compare (three terms or more). */
  lines: number;
  repeated: number;
  share: number;
  /** The section with the largest share of repeated lines, if any repeat. */
  worst: { key: string; share: number } | null;
}

/** A section body as lines: prose by line, a list by item, a table by row. */
export function bodyToLines(body: unknown): string[] {
  if (typeof body === "string") return body.split(/\n+/);
  if (!Array.isArray(body)) return [];
  return body.map((item) => (Array.isArray(item) ? item.join(" ") : String(item)));
}

export function sheetRedundancy(sections: SectionLines[]): Redundancy {
  const termSets = sections.map((s) => ({
    key: s.key,
    lines: s.lines.map((l) => new Set(terms(l.replace(/^\s*\d+\.\s*/, "")))).filter((t) => t.size >= 3),
  }));

  let lines = 0;
  let repeated = 0;
  let worst: Redundancy["worst"] = null;
  termSets.forEach((section, i) => {
    const earlier = termSets.slice(0, i).flatMap((s) => s.lines);
    let hits = 0;
    for (const line of section.lines) {
      const hit = earlier.some((prior) => {
        let shared = 0;
        for (const t of line) if (prior.has(t)) shared++;
        return shared >= 3 && shared / line.size >= 0.5;
      });
      if (hit) hits++;
    }
    lines += section.lines.length;
    repeated += hits;
    const share = section.lines.length ? hits / section.lines.length : 0;
    if (hits && (!worst || share > worst.share)) worst = { key: section.key, share };
  });

  return { lines, repeated, share: lines ? repeated / lines : 0, worst };
}
