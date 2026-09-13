// Highlight ranges over a question stem.
//
// A highlight is stored as [start, end) character offsets into the stem's
// plain text, never as markup: the stem is rendered as text, and offsets are
// the only representation that survives a save, a resume and a re-render
// without ever passing model-written text through innerHTML.

import type { HighlightRange } from "./qbank-types";

/** Sorted, non-overlapping, with touching ranges joined into one. */
export const normalizeRanges = (ranges: HighlightRange[], textLength?: number): HighlightRange[] => {
  const clamped = ranges
    .map(([s, e]): HighlightRange => {
      const max = textLength ?? Number.MAX_SAFE_INTEGER;
      return [Math.max(0, Math.min(s, max)), Math.max(0, Math.min(e, max))];
    })
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged: HighlightRange[] = [];
  for (const [s, e] of clamped) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
};

export const addHighlight = (
  ranges: HighlightRange[],
  range: HighlightRange,
  textLength?: number
): HighlightRange[] => normalizeRanges([...ranges, range], textLength);

/** Removes the highlight covering `offset`, if there is one. */
export const removeHighlightAt = (ranges: HighlightRange[], offset: number): HighlightRange[] =>
  ranges.filter(([s, e]) => !(offset >= s && offset < e));

export interface TextSegment {
  text: string;
  start: number;
  highlighted: boolean;
}

/** Splits text into alternating plain and highlighted runs. */
export const segmentText = (text: string, ranges: HighlightRange[]): TextSegment[] => {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [s, e] of normalizeRanges(ranges, text.length)) {
    if (s > cursor) segments.push({ text: text.slice(cursor, s), start: cursor, highlighted: false });
    segments.push({ text: text.slice(s, e), start: s, highlighted: true });
    cursor = e;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), start: cursor, highlighted: false });
  if (segments.length === 0) segments.push({ text: "", start: 0, highlighted: false });
  return segments;
};
