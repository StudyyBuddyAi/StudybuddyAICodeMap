import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";

/**
 * The AI actions a student can run on their own sheet. The contract lives in
 * supabase/functions/_shared/personalize.ts; this is the client's mirror.
 */
export type PersonalizeAction = "rewrite" | "card" | "explain";
export type RewriteStyle = "simplify" | "deeper" | "shorter" | "example" | "mnemonic" | "custom";

/** In menu order, with what each is called on the sheet. */
export const REWRITE_STYLES: { style: Exclude<RewriteStyle, "custom">; label: string; hint: string }[] = [
  { style: "simplify", label: "Simplify", hint: "Plain words, same facts" },
  { style: "deeper", label: "Go deeper", hint: "Add the why" },
  { style: "shorter", label: "Shorter", hint: "Just the fact" },
  { style: "example", label: "Patient example", hint: "As a one-line case" },
  { style: "mnemonic", label: "Mnemonic", hint: "A device that sticks" },
];

export interface PersonalizeParams {
  action: PersonalizeAction;
  style?: RewriteStyle;
  instruction?: string;
  /** The whole line or item. */
  text: string;
  /** What the student selected in it, if less than all of it. */
  focus?: string;
  sectionTitle?: string;
  topic?: string;
  /** The premium sheet's grant, for a student without Pro. */
  grant?: string;
  examMode?: string;
  difficulty?: string;
}

/** The server said this needs Pro (or a premium sheet's grant). */
export class ProRequiredError extends Error {
  constructor() {
    super("pro_required");
    this.name = "ProRequiredError";
  }
}

/**
 * The server predates personalize mode. It ignores the field and answers the
 * request as a sheet — a stream that opens with `__meta` frames (the plan, the
 * model), which a personalize reply never sends. Stopped at the first one.
 */
export class ServerOutdatedError extends Error {
  constructor() {
    super("server_outdated");
    this.name = "ServerOutdatedError";
  }
}

/** Strips a pair of wrapping quotes and joins a reply onto one line. */
export function oneLine(text: string): string {
  let t = text.trim().replace(/\s*\n+\s*/g, " ");
  if (/^["“'].*["”']$/.test(t)) t = t.slice(1, -1).trim();
  return t;
}

/** A card reply ("Q: …" then "A: …"), or null when it isn't one. */
export function parseCardText(text: string): { question: string; answer: string } | null {
  const q = /(?:^|\n)\s*Q:\s*([\s\S]+?)\s*(?=\n\s*A:)/i.exec(text);
  const a = /(?:^|\n)\s*A:\s*([\s\S]+?)\s*$/i.exec(text);
  const question = q?.[1].replace(/\s+/g, " ").trim();
  const answer = a?.[1].replace(/\s+/g, " ").trim();
  return question && answer ? { question, answer } : null;
}

/**
 * Runs one action, streaming the reply into `onText` as it arrives, and
 * resolves to the whole reply. Throws ProRequiredError on a 403.
 */
export async function runPersonalize(
  params: PersonalizeParams,
  opts: { signal?: AbortSignal; onText?: (text: string) => void } = {}
): Promise<{ text: string; model: ModelUsed | null }> {
  const { examMode, difficulty, ...request } = params;
  const response = await callMedicalNotes(
    {
      notes: params.text,
      examMode,
      difficulty,
      useMemory: false,
      useGrounding: false,
      personalize: request,
    },
    { signal: opts.signal }
  );
  if (response.status === 403) throw new ProRequiredError();
  if (!response.ok || !response.body) throw new Error(`personalize failed: ${response.status}`);
  const model = parseModelUsed(response.headers);

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
        throw new ServerOutdatedError();
      }
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        text += delta;
        opts.onText?.(text);
      }
    }
  }
  if (!text.trim()) throw new Error("personalize returned nothing");
  return { text: text.trim(), model };
}
