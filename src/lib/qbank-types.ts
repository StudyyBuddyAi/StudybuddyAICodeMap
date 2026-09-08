// Shared QBank types. The session engine lives entirely in
// `src/contexts/QBankContext.tsx`; this file is the single source of truth for
// the question/session shapes the client works with.

export type Difficulty = "Easy" | "Medium" | "Hard";
export type OptionKey = "a" | "b" | "c" | "d" | "e";

export interface QuestionMedia {
  file_url: string;
  media_type: string;
  caption: string | null;
  attribution: string | null;
  license: string;
  display_context: 'stem' | 'explanation' | 'both';
  display_order: number;
}

export interface Question {
  id: string;
  subject: string;
  domain: string;
  topic: string;
  difficulty: Difficulty;
  competency: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  // Answer fields are NOT sent when a session starts — they are populated after
  // grading (from submit_answer) or when loading a completed session for review
  // (get_session_review). Undefined until then.
  correct_option?: OptionKey;
  explanation?: string;
  teaching_point?: string;
  media?: QuestionMedia[];
}

export interface SessionAnswer {
  question_id: string;
  selected_option: OptionKey;
  is_correct: boolean;
  time_taken_ms: number;
}

/**
 * What a generated session needs to keep generating after the player has taken
 * over — and, more to the point, what it needs to RESUME after a refresh.
 *
 * Everything here is persisted alongside the session. `generationId` is the
 * thread back to the rows in the table, so a reload can reconcile the session
 * against questions that were written while the tab was closed. `nextIndex` and
 * `covered` are what a resumed run needs to avoid renumbering questions over
 * the top of each other or re-covering ground the set already covered.
 */
export interface SessionGeneration {
  generationId: string;
  /** The student's topic, verbatim — a resumed run needs it to keep writing. */
  topic: string;
  /** The system the first wave routed to. Every later wave reuses it. */
  system: string | null;
  systemName: string | null;
  /** How many questions the set is meant to end with. */
  target: number;
  nextIndex: number;
  covered: string[];
}

export interface SessionState {
  // Server session id, created up front by start_qbank_session.
  sessionId: string | null;
  questions: Question[];
  currentIndex: number;
  answers: SessionAnswer[];
  startedAt: number;
  questionStartedAt: number;
  accumulatedMs: number;
  resumedAt: number;
  skippedIds: string[];
  flaggedIds: string[];
  /**
   * How many questions this session will end up with.
   *
   * Distinct from `questions.length` only while a generated set is still being
   * written: the player shows "Q2 of 20" from the moment the session starts,
   * and it is what tells the difference between "this is the last question" and
   * "the next one has not been written yet". Reconciled down to the real count
   * when generation finishes, so a set that ended short says so rather than
   * waiting forever for questions that are not coming.
   */
  expectedTotal: number;
  /** Null for a curated session — those are complete the moment they start. */
  generation: SessionGeneration | null;
}

// ─── On-demand generation ───────────────────────────────────────────────────
// Shapes for questions the student generates rather than draws from the
// curated bank. A draft is what the model emits and the preview renders; once
// the edge function has persisted it, it becomes an ordinary `Question` and
// every existing code path (player, grading, review, summary) treats it the
// same as a curated one.

export type ReasoningOrder = "1st" | "2nd" | "3rd";

/** Where a `questions` row came from. Curated rows are the hand-authored bank. */
export type QuestionOrigin = "curated" | "generated";

/**
 * The model's self-reported rule check. Every field is expected true — the
 * prompt tells the model to fix the item rather than emit a false — so a false
 * here is a signal the model knowingly shipped a flawed item, which is worth
 * surfacing even though the machine gate in qbank-qa.ts is what actually
 * decides. Deliberately loose: an unknown key must not break the parse.
 */
export type SelfCheck = Record<string, boolean>;

export interface SuggestedImage {
  needed: "Yes" | "No" | "Optional";
  type: string;
  searchTags: string[];
  mustShow: string;
}

/**
 * One generated question as it arrives from the model, before persistence.
 *
 * `reasoningChain` is internal scaffolding: it is stored on the row's
 * generation_meta for review and must never be rendered to a student, since it
 * spells out the answer. The preview page is the one place a draft is shown,
 * and it shows the same fields the player would.
 */
export interface GeneratedQuestionDraft {
  index: number;
  system: string;
  domain: string;
  subtopic: string;
  competency: string;
  difficulty: Difficulty;
  reasoningOrder: ReasoningOrder;
  reasoningChain: string;
  vignette: string;
  leadIn: string;
  options: Record<OptionKey, string>;
  correctOption: OptionKey;
  explanation: string;
  distractorExplanations: Partial<Record<OptionKey, string>>;
  teachingPoint: string;
  suggestedImage?: SuggestedImage;
  selfCheck?: SelfCheck;
  reviewerFlag?: string;
}
