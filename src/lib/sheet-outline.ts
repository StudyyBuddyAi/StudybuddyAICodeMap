/**
 * Two frames a sheet's stream may send (supabase/functions/_shared/sheet-outline.ts):
 *
 *   - outline, with the plan: whether the topic is one thing or a group, and
 *     the blocks a group is taught in;
 *   - warmup, whenever it is written: two questions the sheet is about to
 *     answer, often arriving while the sheet already streams.
 *
 * Validated here like every frame the page reads; a frame that doesn't
 * validate is ignored and the page waits as it always has.
 */

export type TopicShape = "single" | "linked" | "compare" | "survey";

export interface WarmupQuestion {
  q: string;
  options: string[];
  answer: number;
  why: string;
  /** The block that teaches it, by its title on the sheet. */
  block?: string;
}

export interface SheetOutline {
  shape: TopicShape;
  /** What orders the blocks, e.g. "timing after birth". */
  axis: string;
  blocks: string[];
}

const SHAPES: readonly TopicShape[] = ["single", "linked", "compare", "survey"];

const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

export const isGroupShape = (shape: TopicShape | null | undefined) => shape === "compare" || shape === "survey";

export function parseOutline(raw: unknown): SheetOutline | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!SHAPES.includes(r.shape as TopicShape)) return null;
  const blocks = Array.isArray(r.blocks) ? r.blocks.map((b) => text(b, 120)).filter((b): b is string => !!b).slice(0, 5) : [];
  return { shape: r.shape as TopicShape, axis: text(r.axis, 80) ?? "", blocks };
}

/** At most two questions that hold together; a block they name must be one of the sheet's. */
export function parseWarmup(raw: unknown, blocks: readonly string[]): WarmupQuestion[] {
  const out: WarmupQuestion[] = [];
  for (const w of Array.isArray(raw) ? raw.slice(0, 2) : []) {
    if (!w || typeof w !== "object") continue;
    const x = w as Record<string, unknown>;
    const q = text(x.q, 200);
    const why = text(x.why, 240);
    const options = Array.isArray(x.options) ? x.options.map((o) => text(o, 90)) : [];
    const answer = typeof x.answer === "number" && Number.isInteger(x.answer) ? x.answer : -1;
    if (!q || !why || options.length < 3 || options.length > 4 || options.some((o) => !o)) continue;
    if (answer < 0 || answer >= options.length) continue;
    const block = text(x.block, 120);
    out.push({ q, why, options: options as string[], answer, ...(block && blocks.includes(block) ? { block } : {}) });
  }
  return out;
}
