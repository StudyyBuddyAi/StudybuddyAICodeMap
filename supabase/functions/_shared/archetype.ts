/**
 * What kind of thing is being studied.
 *
 * The sheet's sections are chosen from this, so it has to be settled before
 * the prompt is assembled. It runs as its own small completion rather than
 * being asked of the writing model, because the archetype has to be known
 * *before* the writer is called — and because a one-word answer from a cheap
 * model is both faster and more reliable than a field the writer might forget
 * to emit or contradict later.
 *
 * It costs no wall-clock time: it is started alongside embedding and retrieval
 * and awaited in the same Promise.all, and retrieval is much slower.
 *
 * It fails open. A classifier error, a timeout or an unrecognised answer all
 * return null, and the caller falls back to the condition archetype — which is
 * the sheet's long-standing shape. A sheet must never fail to generate because
 * the thing that chooses its headings had a bad minute.
 */
import { ARCHETYPES, ARCHETYPE_IDS, asArchetype, type ArchetypeId } from "./sheet-sections.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Generous enough that it never trips while retrieval is still running, short
 * enough that a hung classifier cannot delay the writer.
 */
const CLASSIFY_TIMEOUT_MS = 4_000;

/** Long topics are pasted notes; the first lines carry the subject. */
const MAX_INPUT_CHARS = 600;

/**
 * Budget for the whole completion, not just the answer.
 *
 * GPT-OSS is a reasoning model: it thinks before it replies, and the thinking
 * is billed against max_tokens. At the 8 tokens a one-word answer appears to
 * need, every token went to reasoning, `content` came back null and
 * `finish_reason` was "length" — so classification silently failed on every
 * request and every topic fell back to the condition archetype. Measured
 * reasoning for these topics is well under this.
 */
const MAX_OUTPUT_TOKENS = 256;

const SYSTEM_PROMPT = `You classify a medical study topic into exactly one category.

Categories:
${ARCHETYPE_IDS.map((id) => `- ${id}: ${ARCHETYPES[id].hint}`).join("\n")}

Reply with the category name and nothing else — one word, lower case, no punctuation, no explanation.
If the topic spans more than one category, choose the one the student most needs the material organised around.
If nothing fits, reply: condition`;

export interface ArchetypeResult {
  archetype: ArchetypeId | null;
  ms: number;
  /** Why it fell back, for the logs. Null on success. */
  error: string | null;
}

export async function classifyArchetype(
  apiKey: string,
  model: string,
  notes: string
): Promise<ArchetypeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://studybuddy.app",
        "X-Title": "StudyBuddy",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: notes.trim().slice(0, MAX_INPUT_CHARS) },
        ],
        provider: { order: ["Cerebras", "Groq"], allow_fallbacks: true },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { archetype: null, ms: Date.now() - startedAt, error: `http_${response.status}` };
    }

    const body = await response.json();
    const choice = body?.choices?.[0];
    const archetype = asArchetype(choice?.message?.content);
    // A reasoning model that ran out of budget mid-thought returns no content
    // at all. Naming that separately keeps it from reading as "the model
    // answered something odd" in the logs — it answered nothing.
    const error = archetype
      ? null
      : choice?.finish_reason === "length"
      ? "truncated_before_answer"
      : "unrecognised";
    return { archetype, ms: Date.now() - startedAt, error };
  } catch (err: unknown) {
    return {
      archetype: null,
      ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
