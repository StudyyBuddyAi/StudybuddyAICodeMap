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
 *
 * Every tier is classified by Corti, whichever model then writes the sheet. It
 * was GPT-OSS through OpenRouter; the sections a sheet gets are now decided on
 * the same provider as the premium writer, and a free sheet's plan no longer
 * depends on OpenRouter at all.
 */
import { asCortiModel, cortiChatCompletion, cortiConfigFromEnv, type CortiModel } from "./corti.ts";
import { ARCHETYPES, ARCHETYPE_IDS, asArchetype, type ArchetypeId } from "./sheet-sections.ts";

/**
 * The strongest non-reasoning model, as the QBank router uses for the same
 * kind of call: a misclassification gives the whole sheet the wrong sections,
 * and `-instant` answers a one-word prompt in about a second. Overridable with
 * CORTI_ARCHETYPE_MODEL, so a regression is an env rollback, not a redeploy.
 */
const DEFAULT_ARCHETYPE_MODEL: CortiModel = "corti-s1-instant";

/**
 * Generous enough that it never trips while retrieval is still running, short
 * enough that a hung classifier cannot delay the writer. It bounds the whole
 * attempt, the Corti token exchange included — that request carries no signal
 * of its own.
 */
const CLASSIFY_TIMEOUT_MS = 4_000;

/** Long topics are pasted notes; the first lines carry the subject. */
const MAX_INPUT_CHARS = 600;

/**
 * A one-word answer. `-instant` models do not reason before replying, so none
 * of the budget goes to hidden thinking; the headroom is for stray punctuation
 * or whitespace, which asArchetype strips.
 */
const MAX_OUTPUT_TOKENS = 16;

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

/**
 * Classifies, retrying once.
 *
 * Asked directly and repeatedly, the model is stable — six of six on each of
 * several topics. A live run still produced one miss, where an organism was
 * written as a condition: not the model changing its mind but the call itself
 * failing and the caller falling open. Retrieval retries once for the same
 * reason and the same measured cause, and the budget is there, since this runs
 * beside retrieval rather than before it.
 */
export async function classifyArchetype(notes: string): Promise<ArchetypeResult> {
  const startedAt = Date.now();
  const model = asCortiModel(Deno.env.get("CORTI_ARCHETYPE_MODEL"), DEFAULT_ARCHETYPE_MODEL);
  const first = await classifyOnce(model, notes);
  if (first.archetype) return { ...first, ms: Date.now() - startedAt };
  const second = await classifyOnce(model, notes);
  return {
    archetype: second.archetype,
    ms: Date.now() - startedAt,
    // Keep the first reason when the retry fails the same way, so the logs
    // name what actually went wrong rather than only the last attempt.
    error: second.archetype ? null : `${first.error}|${second.error}`,
  };
}

async function classifyOnce(model: CortiModel, notes: string): Promise<ArchetypeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, CLASSIFY_TIMEOUT_MS);
  });

  const attempt = async (): Promise<ArchetypeResult> => {
    const response = await cortiChatCompletion(cortiConfigFromEnv(), {
      model,
      temperature: 0,
      maxTokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: notes.trim().slice(0, MAX_INPUT_CHARS) },
      ],
      signal: controller.signal,
    });

    if (!response.ok) {
      return { archetype: null, ms: Date.now() - startedAt, error: `http_${response.status}` };
    }

    const body = await response.json();
    const choice = body?.choices?.[0];
    const archetype = asArchetype(choice?.message?.content);
    // Out of budget before a recognisable word is a different failure from
    // "the model answered something odd", so the logs name it separately.
    const error = archetype
      ? null
      : choice?.finish_reason === "length"
      ? "truncated_before_answer"
      : "unrecognised";
    return { archetype, ms: Date.now() - startedAt, error };
  };

  // The loser of the race still settles later — an aborted fetch rejects —
  // and an unhandled rejection can take the isolate down with it.
  const work = attempt();
  work.catch(() => {});

  try {
    return await Promise.race([work, timedOut]);
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
