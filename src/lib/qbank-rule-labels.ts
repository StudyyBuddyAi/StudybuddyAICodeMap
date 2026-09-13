/**
 * Human labels for the QA gate's rule slugs.
 *
 * The findings' own `detail` strings quote the offending text — an option that
 * ran long, a word shared between stem and key. That is the right thing for a
 * reviewer and the wrong thing for a student, who has not sat the set yet and
 * would be reading a description of the answer. These say what went wrong
 * without saying what it went wrong *with*.
 *
 * Lived on the generation page until generation stopped having a page of its
 * own: a set is now reported at the end of the session it was written for, so
 * the labels have to be reachable from there too.
 */
export const RULE_LABELS: Record<string, string> = {
  "key-longest": "Correct answer stood out by length",
  "banned-option-language": "Vague qualifier in an option",
  "all-or-none-option": "All/none-of-the-above option",
  "duplicate-option": "Two options said the same thing",
  "mixed-option-categories": "Options were not all the same kind of thing",
  "open-lead-in": "Open-ended lead-in",
  "explanation-meta-language": "Explanation exposed the reasoning scaffold",
  "stem-key-cueing": "Stem wording hinted at the answer",
  "question-in-vignette": "Vignette repeated the question",
  "lead-in-not-question": "Lead-in was not a question",
  "duplicate-question": "Overlaps another question in the set",
  "repeated-lead-in": "Asks the same thing as another question",
  "shared-option-pool": "Shares its options with another question",
  "over-bolding": "Too much emphasis in the explanation",
  "no-bolding": "No key phrase emphasised",
  "bolded-distractor": "Emphasis in a distractor explanation",
  "missing-distractor-explanation": "A distractor went unexplained",
  "distractor-explains-key": "The item contradicted its own answer",
  "writer-flagged": "The writer raised a concern",
};

/**
 * The reason a question never reached the session.
 *
 * `disputed` is not a gate rule — it is the cold-answering pass landing
 * somewhere other than the key, which holds an item back for review rather than
 * condemning it. Naming the letter would print the disputed answer, so it does
 * not.
 */
export const DISPUTED_REASON = "disputed" as const;

export const ruleLabel = (rule: string): string => {
  if (rule === DISPUTED_REASON) return "A second read disagreed with the answer";
  return RULE_LABELS[rule] ?? "Quality check failed";
};
