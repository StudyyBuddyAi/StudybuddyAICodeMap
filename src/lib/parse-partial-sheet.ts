import { stripFences } from "./sanitize-json";
import { repairLlmJson } from "./repair-llm-json";
import type { Flashcard, GeneratedSheet } from "@/types/generated-sheet";

/**
 * Reading a half-streamed sheet.
 *
 * The model emits the sheet as one JSON object, so nothing is parseable until
 * the final token — which is why the sheet used to appear all at once. This
 * repairs the truncated tail on each chunk (close the open string, drop the
 * dangling key, close the open brackets) so the sections that *have* arrived
 * can render while the rest is still streaming.
 *
 * `completeKeys` is the part callers actually render off: a key is complete
 * once a later key has started, so a section is never shown mid-write.
 */
export interface PartialSheetResult {
  /** Normalized — every field is safe to hand straight to the renderer. */
  sheet: GeneratedSheet;
  /** Top-level keys whose value is definitely finished, in arrival order. */
  completeKeys: string[];
}

interface ScanState {
  /** Unclosed `{` / `[`, outermost first. */
  stack: string[];
  /** Top-level key names, in the order their `"key":` was seen. */
  keys: string[];
  inString: boolean;
  /** True when the text ends on a backslash inside a string. */
  escaped: boolean;
  /** Index of the last `,` at depth 1 — the last guaranteed-safe cut point. */
  lastTopComma: number;
}

/**
 * Single left-to-right pass. Tracks bracket depth and string state, and picks
 * out top-level keys by looking ahead for the `:` that follows them.
 */
function scan(text: string): ScanState {
  const stack: string[] = [];
  const keys: string[] = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let lastTopComma = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        // A string sitting directly inside the root object is a key only if a
        // colon follows it. Mid-stream there may be nothing after it yet, in
        // which case we can't know — and correctly don't count it.
        if (stack.length === 1 && stack[0] === "{") {
          let j = i + 1;
          while (j < text.length && /\s/.test(text[j])) j++;
          if (text[j] === ":") keys.push(text.slice(stringStart + 1, i));
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringStart = i;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    } else if (ch === "," && stack.length === 1) {
      lastTopComma = i;
    }
  }

  return { stack, keys, inString, escaped, lastTopComma };
}

/** Trailing `,` or a key with no value yet (`"overview":`) — neither can be closed. */
const DANGLING_TAIL_RE = /(?:,|"(?:[^"\\]|\\.)*"\s*:)\s*$/;

/**
 * Make a truncated JSON string parseable: finish the open string literal, drop
 * whatever trailing fragment can't be completed, then close the open brackets.
 */
function repairTail(text: string, state: ScanState): string {
  // Escapes are already valid here — repairLlmJson ran first — so an open
  // string just needs closing.
  let out = state.inString ? `${text}"` : text;

  out = out.trimEnd();
  // Stripping a dangling key can expose the comma before it, so loop.
  let previous: string;
  do {
    previous = out;
    out = out.replace(DANGLING_TAIL_RE, "").trimEnd();
  } while (out !== previous);

  for (let i = state.stack.length - 1; i >= 0; i--) {
    out += state.stack[i] === "{" ? "}" : "]";
  }

  return out;
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((item): item is string => typeof item === "string") : [];

/** Drop half-written cards — a card with no answer yet would render blank. */
function asFlashcards(v: unknown): Flashcard[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (c): c is Record<string, unknown> =>
        !!c && typeof c === "object" && !Array.isArray(c)
    )
    .filter((c) => typeof c.question === "string" && typeof c.answer === "string")
    .map((c) => ({
      tag: asString(c.tag),
      question: c.question as string,
      answer: c.answer as string,
    }));
}

/** Fill every field so a partial object can't crash the renderer. */
function normalize(raw: Record<string, unknown>): GeneratedSheet {
  return {
    topic: typeof raw.topic === "string" ? raw.topic : undefined,
    topicEmoji: typeof raw.topicEmoji === "string" ? raw.topicEmoji : undefined,
    overview: asString(raw.overview),
    memoryHooks: asStringArray(raw.memoryHooks),
    clinicalApproach: asString(raw.clinicalApproach),
    keyPoints: asStringArray(raw.keyPoints),
    examTraps: asStringArray(raw.examTraps),
    flashcards: asFlashcards(raw.flashcards),
    referenceNote: asString(raw.referenceNote),
  };
}

function build(
  parsed: Record<string, unknown>,
  keys: string[],
  allComplete: boolean
): PartialSheetResult {
  const present = keys.filter((key, i) => key in parsed && keys.indexOf(key) === i);
  // The most recent key is still being written — unless the text parsed as-is,
  // or that key got dropped during repair (in which case it isn't here at all
  // and everything that survived is finished).
  const inFlight =
    !allComplete && present[present.length - 1] === keys[keys.length - 1];
  return {
    sheet: normalize(parsed),
    completeKeys: inFlight ? present.slice(0, -1) : present,
  };
}

/**
 * Parse however much of a streamed sheet has arrived.
 *
 * Returns null when the text isn't a JSON object at all — a prose preamble, a
 * legacy text blob, or damage too deep to repair. Callers should treat that as
 * "nothing to show yet" and fall back to parsing the full response at the end.
 */
export function parsePartialSheet(raw: string): PartialSheetResult | null {
  // Repair escaping first: one unescaped quote in a flashcard would otherwise
  // stall the reveal at that section for the rest of the stream.
  const text = repairLlmJson(stripFences(raw));
  if (!text.startsWith("{")) return null;

  // Already valid — the object closed, so every key in it is finished.
  const direct = tryParse(text);
  if (direct) return build(direct, scan(text).keys, true);

  const state = scan(text);
  const repaired = tryParse(repairTail(text, state));
  if (repaired) return build(repaired, state.keys, false);

  // Repair failed (a partial key name, a half-written number). Fall back to the
  // last completed top-level pair, which is always safe to close.
  if (state.lastTopComma < 0) return null;
  const truncated = text.slice(0, state.lastTopComma);
  const truncatedState = scan(truncated);
  const salvaged = tryParse(repairTail(truncated, truncatedState));
  if (!salvaged) return null;
  return build(salvaged, truncatedState.keys, true);
}

/**
 * How much of the response survived.
 * - `ok`       — parsed as sent
 * - `repaired` — the model's escaping was fixed; the sheet is still complete
 * - `partial`  — the response was cut short; some sections are missing
 */
export type SheetParseStatus = "ok" | "repaired" | "partial";

export interface SheetParseResult {
  sheet: GeneratedSheet;
  status: SheetParseStatus;
}

/** In dev, name the exact substring that defeated the parse. */
function logParseFailure(text: string, error: unknown): void {
  if (!import.meta.env.DEV) return;
  const message = error instanceof Error ? error.message : String(error);
  const at = /position (\d+)/.exec(message);
  const context = at
    ? text.slice(Math.max(0, +at[1] - 80), +at[1] + 80)
    : text.slice(-160);
  console.warn(
    `[sheet] JSON.parse failed: ${message}\n--- context ---\n${context}\n---------------`
  );
}

/**
 * Parse a finished response, giving up as little as possible.
 *
 * A single unescaped quote used to discard the entire sheet and dump raw JSON
 * at the reader, so this degrades in steps instead: exact parse, then escaping
 * repair, then whatever sections completed before the damage. Returns null only
 * when the text isn't a JSON sheet at all, which is the caller's cue to fall
 * back to the legacy text renderer.
 */
export function parseSheetOutput(raw: string): SheetParseResult | null {
  const text = stripFences(raw);
  if (!text.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Normalize even on the happy path, so a field the model omitted can't
      // reach the renderer as undefined.
      return { sheet: normalize(parsed as Record<string, unknown>), status: "ok" };
    }
  } catch (error) {
    logParseFailure(text, error);
  }

  const repaired = tryParse(repairLlmJson(text));
  if (repaired) return { sheet: normalize(repaired), status: "repaired" };

  // Structurally broken — salvage the sections that completed.
  const partial = parsePartialSheet(raw);
  if (partial && partial.completeKeys.length > 0) {
    return { sheet: partial.sheet, status: "partial" };
  }

  return null;
}
