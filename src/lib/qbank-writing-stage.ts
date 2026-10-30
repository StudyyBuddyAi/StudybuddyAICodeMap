/**
 * Where the writer is with a set's FIRST question, for the waiting screen.
 *
 * Read off the raw stream by field NAME only — which of the question's keys
 * have appeared — never by value. The stream carries the whole question, key
 * included, so nothing derived from its content may reach the screen; a stage
 * name says only how far along the item is. Questions are written in order and
 * each key once, so the first occurrence of a key belongs to question one.
 *
 * Real stages, rather than a looping spinner, because an uncertain wait feels
 * longer than an explained one (see docs/qbank/topic-selection-ux.md §10).
 */

export type WritingStage = "routing" | "planning" | "reasoning" | "case" | "question" | "explanation" | "checking";

export const WRITING_STAGES: { id: WritingStage; label: string }[] = [
  { id: "routing", label: "Routing your topics" },
  { id: "planning", label: "Planning the set" },
  { id: "reasoning", label: "Working out the reasoning" },
  { id: "case", label: "Writing the patient case" },
  { id: "question", label: "Writing the question and options" },
  { id: "explanation", label: "Writing the explanation" },
  { id: "checking", label: "Quality checks and a blind second read" },
];

export const stageIndex = (stage: WritingStage): number => WRITING_STAGES.findIndex((s) => s.id === stage);

/**
 * The first question's stage, from the stream so far and how many questions
 * have closed in it. Once one has closed it is being checked; before the
 * questions array opens the model is still on the plan.
 */
export function firstItemStage(content: string, closedQuestions: number): WritingStage {
  if (closedQuestions >= 1) return "checking";
  const at = content.indexOf('"questions"');
  if (at < 0) return "planning";
  const body = content.slice(at);
  if (/"(?:explanation|distractorExplanations|teachingPoint)"\s*:/.test(body)) return "explanation";
  if (/"(?:leadIn|options)"\s*:/.test(body)) return "question";
  if (/"vignette"\s*:/.test(body)) return "case";
  return "reasoning";
}
