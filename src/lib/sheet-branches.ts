import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parsePartialObject } from "@/lib/parse-partial-sheet";
import type { SectionBody } from "@/types/generated-sheet";

/**
 * Branches, on the client.
 *
 * The sheet is the trunk. A branch answers one question about one line of it
 * — how the management is actually done, how it compares with a look-alike,
 * the mechanism a level down — and can grow branches of its own. The model
 * suggests the questions (the pills under a sheet's lines); the student grows
 * the ones they want, asks their own, or writes their own. A comprehensive
 * sheet is the high-yield sheet with its most useful branches already grown.
 *
 * Every branch is kept as markdown in the student's layer, whatever shape it
 * arrived in — steps, a comparison table, a case — so one renderer shows it,
 * one editor changes it, and export carries it as text.
 *
 * The contract is supabase/functions/_shared/sheet-branch-prompts.ts.
 */

export type BranchType = "mechanism" | "management" | "compare" | "differential" | "case" | "ask" | "note";

/** The types the model suggests. "ask" is the student's question; "note" their own writing. */
export const SUGGESTED_TYPES: readonly BranchType[] = ["mechanism", "management", "compare", "differential", "case"];

/** Types about a second condition, which they name. */
export const NEEDS_VERSUS: readonly BranchType[] = ["compare", "differential"];

/** How deep branches go — the server's MAX_BRANCH_DEPTH. */
export const MAX_BRANCH_DEPTH = 3;

/** How many branches a comprehensive sheet grows per content section. */
export const PICKS_PER_SECTION = 2;

export const BRANCH_TYPE_LABEL: Record<BranchType, string> = {
  management: "Management",
  compare: "Compare",
  differential: "Differential",
  mechanism: "Mechanism",
  case: "Case",
  ask: "Your question",
  note: "Your note",
};

/** What a pill asks for. */
export interface BranchQuestion {
  type: BranchType;
  label: string;
  ask: string;
  versus?: string;
}

/** A suggestion tied to a line of the sheet. */
export interface AnchoredQuestion extends BranchQuestion {
  /** `section:index`. */
  anchor: string;
}

const LIMITS = { label: 80, ask: 300, versus: 80 };

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
};

/**
 * The other condition, read from a label that names it — "vs Paralytic
 * ileus", "Mesenteric ischemia profile" — for a pill that left out "versus".
 * The server's versusFromLabel.
 */
export function versusFromLabel(label: string): string | undefined {
  const t = label.trim();
  const m = /^vs\.?\s+(.+)$/i.exec(t) ?? /^(.+?)\s+profile$/i.exec(t);
  return m?.[1].trim() || undefined;
}

/** A question as it arrived from the model, validated; null when it is not one. */
export function asQuestion(raw: unknown, allowed: readonly BranchType[] = SUGGESTED_TYPES): BranchQuestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const type = allowed.includes(r.type as BranchType) ? (r.type as BranchType) : null;
  const ask = clean(r.ask, LIMITS.ask);
  if (!type || !ask) return null;
  const label = clean(r.label, LIMITS.label) ?? ask.slice(0, LIMITS.label);
  const q: BranchQuestion = { type, label, ask };
  const versus = clean(r.versus, LIMITS.versus) ?? versusFromLabel(label);
  if (NEEDS_VERSUS.includes(type)) {
    if (!versus) return null;
    q.versus = versus;
  }
  return q;
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** Today's branch requests are used up (free and anonymous students). */
export class BranchQuotaError extends Error {
  constructor() {
    super("branch_quota_exceeded");
    this.name = "BranchQuotaError";
  }
}

/** The server predates branches: it ignores the field and answers as a sheet. */
export class BranchOutdatedError extends Error {
  constructor() {
    super("server_outdated");
    this.name = "BranchOutdatedError";
  }
}

export interface BranchSheet {
  /** The sheet's planned section keys, in order. */
  plan: string[];
  /** Its section bodies as the student has them. */
  sections: Record<string, SectionBody>;
  topic: string;
  /** The ids of the passages it was built on. */
  sourceIds: string[];
  examMode?: string;
  difficulty?: string;
}

export type BranchRequestParams =
  | { action: "suggest" }
  | {
      action: "grow";
      anchor: string;
      quote: string;
      question: BranchQuestion;
      /** The branches it grows from, outermost first. */
      path: { label: string; text: string }[];
      /** The sheet's other branches. */
      others: { label: string; ask: string }[];
    };

/**
 * Runs one branch request, handing the reply so far to `onText` as it
 * streams, and resolves to all of it. Throws BranchQuotaError on a 429.
 */
export async function runBranchRequest(
  sheet: BranchSheet,
  params: BranchRequestParams,
  opts: { signal?: AbortSignal; onText?: (text: string) => void } = {}
): Promise<string> {
  const { examMode, difficulty, ...rest } = sheet;
  const response = await callMedicalNotes(
    { notes: sheet.topic, examMode, difficulty, useMemory: false, useGrounding: false, branch: { ...rest, ...params } },
    { signal: opts.signal }
  );
  if (response.status === 429) throw new BranchQuotaError();
  if (!response.ok || !response.body) throw new Error(`branch request failed: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let parsed: { __meta?: unknown; choices?: { delta?: { content?: unknown } }[] } | null = null;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // a partial frame
      }
      if (parsed?.__meta) {
        reader.cancel().catch(() => {});
        throw new BranchOutdatedError();
      }
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta !== "string") continue;
      text += delta;
      opts.onText?.(text);
    }
  }
  if (!text.trim()) throw new Error("branch request returned nothing");
  return text;
}

// ── Reading the suggestions ──────────────────────────────────────────────────

/**
 * The pills in a suggest reply so far: each one validated, and tied to a line
 * the sheet has (`lineExists`). Until the reply closes, the last pill may be
 * half-written, so it waits.
 */
export function readSuggestions(
  text: string,
  lineExists: (anchor: string) => boolean
): { pills: AnchoredQuestion[]; closed: boolean; pending: string | null } {
  const parsed = parsePartialObject(text);
  if (!parsed) return { pills: [], closed: false, pending: null };
  const raw = Array.isArray(parsed.value.pills) ? parsed.value.pills : [];
  const settled = parsed.closed ? raw : raw.slice(0, -1);
  // The pill still being written: its line, once the number is whole — the
  // field after it has begun — so the page can hold its place.
  let pending: string | null = null;
  const last = parsed.closed ? null : (raw[raw.length - 1] as Record<string, unknown> | undefined);
  if (last && typeof last === "object" && typeof last.section === "string" && typeof last.type === "string") {
    const line = typeof last.line === "number" ? last.line : NaN;
    const anchor = `${last.section}:${line}`;
    if (Number.isInteger(line) && line >= 0 && lineExists(anchor)) pending = anchor;
  }
  const pills: AnchoredQuestion[] = [];
  const seen = new Set<string>();
  for (const p of settled) {
    const q = asQuestion(p);
    if (!q) continue;
    const r = p as Record<string, unknown>;
    const line = typeof r.line === "number" ? r.line : typeof r.line === "string" ? Number(r.line) : NaN;
    if (typeof r.section !== "string" || !Number.isInteger(line) || line < 0) continue;
    const anchor = `${r.section}:${line}`;
    if (!lineExists(anchor)) continue;
    const key = `${anchor}|${q.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pills.push({ ...q, anchor });
  }
  return { pills, closed: parsed.closed, pending };
}

// ── Reading a branch ─────────────────────────────────────────────────────────

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A table cell kept on one line, its pipes escaped out. */
const cell = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim();

/** Bold the leading label of a "Label: text" line. */
const boldLabel = (line: string) => {
  const m = /^([A-Z][A-Za-z ]{1,20}):\s*(.*)$/.exec(line);
  return m ? `**${m[1]}:** ${m[2]}` : line;
};

/**
 * A branch body, in whatever shape its type arrived in, as the markdown it is
 * kept as. Works on a half-streamed body too, so the panel can show it grow.
 */
export function branchMarkdown(
  type: BranchType,
  body: Record<string, unknown>,
  ctx: { topic: string; versus?: string }
): string {
  const parts: string[] = [];
  switch (type) {
    case "management": {
      const steps = strings(body.steps);
      if (steps.length) parts.push(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
      const watch = strings(body.watch);
      if (watch.length) parts.push(`#### Watch for\n${watch.map((w) => `- ${w}`).join("\n")}`);
      break;
    }
    case "compare": {
      const rows = (Array.isArray(body.rows) ? body.rows : []).filter(Array.isArray) as unknown[][];
      const cells = rows.map((r) => r.slice(0, 3).map((c) => cell(typeof c === "string" ? c : ""))).filter((r) => r.some(Boolean));
      if (cells.length) {
        const head = `| | ${cell(ctx.topic)} | ${cell(ctx.versus ?? "Look-alike")} |`;
        const lines = cells.map((r) => `| ${[...r, "", "", ""].slice(0, 3).join(" | ")} |`);
        parts.push([head, "| --- | --- | --- |", ...lines].join("\n"));
      }
      const takeaway = str(body.takeaway);
      if (takeaway) parts.push(`> ${takeaway}`);
      break;
    }
    case "differential": {
      const profile = strings(body.profile);
      if (profile.length) parts.push(profile.map((l) => `- ${boldLabel(l)}`).join("\n"));
      break;
    }
    case "case": {
      const stem = str(body.stem);
      if (stem) parts.push(stem);
      const question = str(body.question);
      if (question) parts.push(`**${question.replace(/\*\*/g, "")}**`);
      const answer = str(body.answer);
      const reasoning = str(body.reasoning);
      if (answer || reasoning) {
        parts.push([`> **Answer:** ${answer}`, ...(reasoning ? [">", `> ${reasoning}`] : [])].join("\n"));
      }
      break;
    }
    default:
      parts.push(...strings(body.paragraphs));
  }
  return parts.join("\n\n");
}

export interface BranchReply {
  markdown: string;
  /** What it proposes growing next. */
  next: BranchQuestion[];
  /** Whether the sheet's passages backed it; null when the reply did not say. */
  covered: boolean | null;
  closed: boolean;
}

/** A grow reply so far, read into the branch it makes. */
export function readBranch(text: string, type: BranchType, ctx: { topic: string; versus?: string }): BranchReply {
  const parsed = parsePartialObject(text);
  if (!parsed) return { markdown: "", next: [], covered: null, closed: false };
  const { value, closed } = parsed;
  const next = (Array.isArray(value.next) ? (closed ? value.next : value.next.slice(0, -1)) : [])
    .map((q) => asQuestion(q))
    .filter((q): q is BranchQuestion => q !== null)
    .slice(0, 3);
  return {
    markdown: branchMarkdown(type, value, ctx),
    next,
    covered: typeof value.covered === "boolean" ? value.covered : null,
    closed,
  };
}

// ── Markdown, as a branch is kept ────────────────────────────────────────────

export type BranchBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "ordered"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "callout"; lines: string[] }
  | { kind: "answer"; lines: string[] };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/**
 * The blocks of a branch's markdown: paragraphs, "#### " headings, numbered
 * and bulleted lists, "|" tables and "> " callouts. A callout that opens with
 * "**Answer:**" is a case's answer, hidden until asked for. Nothing else is
 * markup: the renderer shows text as text.
 */
export function markdownBlocks(md: string): BranchBlock[] {
  const blocks: BranchBlock[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const take = (test: (l: string) => boolean) => {
    const out: string[] = [];
    while (i < lines.length && test(lines[i])) out.push(lines[i++]);
    return out;
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
    } else if (/^#{1,6}\s/.test(t)) {
      blocks.push({ kind: "heading", text: t.replace(/^#{1,6}\s+/, "") });
      i++;
    } else if (/^\d+[.)]\s/.test(t)) {
      blocks.push({ kind: "ordered", items: take((l) => /^\s*\d+[.)]\s/.test(l)).map((l) => l.trim().replace(/^\d+[.)]\s+/, "")) });
    } else if (/^[-*•]\s/.test(t)) {
      blocks.push({ kind: "bullets", items: take((l) => /^\s*[-*•]\s/.test(l)).map((l) => l.trim().replace(/^[-*•]\s+/, "")) });
    } else if (t.startsWith("|")) {
      const rows = take((l) => l.trim().startsWith("|")).map(splitRow);
      const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c) || c === ""));
      const [header = [], ...rest] = body;
      blocks.push({ kind: "table", header, rows: rest });
    } else if (t.startsWith(">")) {
      const quoted = take((l) => l.trim().startsWith(">")).map((l) => l.trim().replace(/^>\s?/, ""));
      const kind = /^\*\*Answer:?\*\*/i.test(quoted[0] ?? "") ? "answer" : "callout";
      blocks.push({ kind, lines: quoted });
    } else {
      const para = take((l) => {
        const s = l.trim();
        return !!s && !/^(#{1,6}\s|\d+[.)]\s|[-*•]\s|\||>)/.test(s);
      });
      blocks.push({ kind: "paragraph", text: para.map((l) => l.trim()).join(" ") });
    }
  }
  return blocks;
}

/** A branch's text without its markup — for the prompt of a branch grown from it, and for a card. */
export function plainText(md: string): string {
  return md
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\|\s*-{2,}.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── What a comprehensive sheet grows ─────────────────────────────────────────

/**
 * The suggestions a comprehensive sheet grows up front: the first
 * PICKS_PER_SECTION of each content section, in the order the model ranked
 * them. The study aids get none — their pills wait for the student.
 */
export function comprehensivePicks<T extends { anchor: string }>(pills: T[], contentKeys: string[]): T[] {
  const taken = new Map<string, number>();
  return pills.filter((p) => {
    const section = p.anchor.slice(0, p.anchor.lastIndexOf(":"));
    if (!contentKeys.includes(section)) return false;
    const n = taken.get(section) ?? 0;
    if (n >= PICKS_PER_SECTION) return false;
    taken.set(section, n + 1);
    return true;
  });
}
