// Checks measured by the suite but not wired into production. Each one is
// kept here, beside its measurement, until the numbers earn it a place in
// supabase/functions/_shared (docs/qbank/accuracy-2026-11.md §6). The
// ambiguity review started here and earned it (qbank-verify checkAmbiguity).
import { CORTI, config, LETTERS, type Item, type Letter } from "./common.mts";

const parse = (raw: string) => {
  const t = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
};
const optionsOf = (it: Item) => LETTERS.map((k) => `${k.toUpperCase()}. ${it.options[k]}`).join("\n");

/**
 * Does the explanation argue for the keyed option? A reading question, not a
 * medical one: the checker sees the options and the explanation, never the
 * key or the per-option notes (whose letters would give the key away).
 *
 * Measured 2026-11-02: catches every planted mislabelled key, but so does the
 * second blind read on corti-s1-mini-instant, which went to production; on top
 * of it this added nothing.
 */
export async function checkKeyConsistency(it: Item, model?: string) {
  try {
    const raw = await CORTI.cortiComplete(config, {
      ...(model ? { model } : { model: config.verifierModel }),
      temperature: 0,
      maxTokens: 200,
      json: true,
      messages: [
        {
          role: "system",
          content: `You check a multiple-choice question for an editing error. You are given its five options and the explanation its author wrote. You are not told the answer key.

Decide which ONE option the explanation argues is the correct answer: the option it explains as right, not one it mentions in order to rule out. Judge only what the explanation says, not what you believe the right answer is.

Return ONE JSON object and nothing else:
{"argued":"a"|"b"|"c"|"d"|"e"|"unclear"}

Use "unclear" only if the explanation does not single out any option.`,
        },
        {
          role: "user",
          content: `Options:\n${optionsOf(it)}\n\nExplanation:\n${it.explanation.trim()}${it.teachingPoint?.trim() ? `\n\nTeaching point: ${it.teachingPoint.trim()}` : ""}`,
        },
      ],
      signal: AbortSignal.timeout(45_000),
    });
    const argued = String(parse(raw)?.argued ?? "").trim().toLowerCase();
    if (!LETTERS.includes(argued as Letter)) return { argued: null, consistent: true, error: argued === "unclear" ? null : `off-enum: ${argued}` };
    return { argued, consistent: argued === it.correctOption, error: null };
  } catch (err) {
    return { argued: null, consistent: true, error: err instanceof Error ? err.message : String(err) };
  }
}
