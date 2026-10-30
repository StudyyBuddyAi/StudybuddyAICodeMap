/**
 * "High, low or normal?" — a lab-values lightning round for the wait before a
 * set's first question exists.
 *
 * Reading a lab value against its range is a skill every vignette leans on,
 * so the twenty seconds are spent on something exam-shaped rather than on a
 * spinner. Built from the reference ranges the player's lab panel already
 * shows (lab-values.ts): no request, no cost, works offline.
 *
 * Only plain "a–b unit" ranges take part. One-sided ranges ("< 200 mg/dL"),
 * ratios and the BMI bands are left out, because "normal" for those is not a
 * band a value can sit inside.
 */
import { LAB_TABS, type LabValue } from "@/lib/lab-values";

export type LabVerdict = "low" | "normal" | "high";

export interface LabRange {
  name: string;
  note?: string;
  low: number;
  high: number;
  unit: string;
  /** Decimals the published range uses, so a generated value reads the same way. */
  decimals: number;
  /** The range as published, shown after the answer. */
  label: string;
}

export interface LabQuizItem {
  range: LabRange;
  value: number;
  /** The value formatted like the range ("4,200", "6.1"). */
  valueLabel: string;
  answer: LabVerdict;
}

const RANGE = /^([\d,.]+)\s*–\s*([\d,.]+)\s*(.*)$/;

const parse = (n: string) => Number(n.replace(/,/g, ""));
const decimalsOf = (n: string) => (n.includes(".") ? n.split(".")[1].length : 0);

/** A published value as a two-sided range, or null when it is not one. */
export function parseLabRange(value: LabValue): LabRange | null {
  const m = RANGE.exec(value.conventional.trim());
  if (!m) return null;
  const low = parse(m[1]);
  const high = parse(m[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  return {
    name: value.name,
    note: value.note,
    low,
    high,
    unit: m[3].trim(),
    decimals: Math.max(decimalsOf(m[1]), decimalsOf(m[2])),
    label: value.conventional,
  };
}

/** Every range that can take part, across the panel's tabs. */
export const LAB_RANGES: LabRange[] = LAB_TABS.flatMap((tab) =>
  tab.groups.flatMap((g) => g.values.map(parseLabRange).filter((r): r is LabRange => r !== null))
);

/** Rounds to the range's decimals, with thousands separators where it uses them. */
export function formatLabValue(value: number, range: LabRange): string {
  const rounded = Number(value.toFixed(range.decimals));
  return range.label.includes(",")
    ? rounded.toLocaleString("en-US", { maximumFractionDigits: range.decimals, minimumFractionDigits: range.decimals })
    : rounded.toFixed(range.decimals);
}

/**
 * One question. Abnormal values sit clearly outside the range — 10-45% beyond
 * the limit it crosses — because the round is about reading a value, not about
 * splitting hairs at the boundary. Normal values stay off the very edges.
 */
export function makeLabQuizItem(random: () => number = Math.random, pool: LabRange[] = LAB_RANGES): LabQuizItem {
  const range = pool[Math.floor(random() * pool.length)];
  const roll = random();
  const answer: LabVerdict = roll < 1 / 3 ? "low" : roll < 2 / 3 ? "normal" : "high";
  const span = range.high - range.low;
  let value: number;
  if (answer === "normal") {
    value = range.low + span * (0.15 + random() * 0.7);
  } else if (answer === "high") {
    value = range.high * (1.1 + random() * 0.35);
  } else {
    // Below the low limit; a low limit of zero cannot be undercut, so that
    // range answers "high" or "normal" instead.
    value = range.low > 0 ? range.low * (0.55 + random() * 0.35) : range.high * (1.1 + random() * 0.35);
  }
  const shown = Number(value.toFixed(range.decimals));
  // The verdict is read off the rounded value the student actually sees.
  const verdict: LabVerdict = shown < range.low ? "low" : shown > range.high ? "high" : "normal";
  return { range, value: shown, valueLabel: formatLabValue(shown, range), answer: verdict };
}
