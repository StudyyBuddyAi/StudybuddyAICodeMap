/**
 * AI actions on a student's own sheet: rewrite a line the way they asked, turn
 * a passage into a flashcard, explain a passage they marked as confusing.
 *
 * A Pro feature, and uncapped for Pro: no daily quota, no premium-hook
 * consumption. A sheet generated as premium for a free or anonymous student
 * carries the same entitlement, proven by the grant the server recorded when
 * it streamed that sheet (premium_sheet_grants) — never by a client flag.
 *
 * Kept free of Deno-only imports so the app's tests can check exactly what the
 * model is shown.
 */

export type PersonalizeAction = "rewrite" | "card" | "explain";

export type RewriteStyle = "simplify" | "deeper" | "shorter" | "example" | "mnemonic" | "custom";

export const REWRITE_STYLES: readonly RewriteStyle[] = ["simplify", "deeper", "shorter", "example", "mnemonic", "custom"];

export interface PersonalizeRequest {
  action: PersonalizeAction;
  /** rewrite only. */
  style?: RewriteStyle;
  /** rewrite + custom only: what the student asked for, in their words. */
  instruction?: string;
  /** The whole line or item the action is about. */
  text: string;
  /** The part of it the student selected, when they selected less than all of it. */
  focus?: string;
  sectionTitle?: string;
  topic?: string;
  /** Proof that this sheet was generated as premium, for a student without Pro. */
  grant?: string;
}

/**
 * Size limits. A line is short; these only stop the endpoint being used to
 * send a document. The output cap keeps a rewrite a line and a card a card.
 */
export const PERSONALIZE_LIMITS = {
  text: 1200,
  focus: 400,
  instruction: 200,
  title: 80,
  topic: 120,
} as const;

export const PERSONALIZE_MAX_TOKENS = 400;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collapses a free-text field to one clean line of at most `max` characters. */
const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
};

/** The request, validated; null when it names nothing runnable. */
export function parsePersonalizeRequest(raw: unknown): PersonalizeRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (action !== "rewrite" && action !== "card" && action !== "explain") return null;
  const text = clean(r.text, PERSONALIZE_LIMITS.text);
  if (!text) return null;

  const req: PersonalizeRequest = { action, text };
  if (action === "rewrite") {
    const style = REWRITE_STYLES.includes(r.style as RewriteStyle) ? (r.style as RewriteStyle) : null;
    if (!style) return null;
    req.style = style;
    if (style === "custom") {
      const instruction = clean(r.instruction, PERSONALIZE_LIMITS.instruction);
      if (!instruction) return null;
      req.instruction = instruction;
    }
  }
  const focus = clean(r.focus, PERSONALIZE_LIMITS.focus);
  if (focus && focus !== text) req.focus = focus;
  const sectionTitle = clean(r.sectionTitle, PERSONALIZE_LIMITS.title);
  if (sectionTitle) req.sectionTitle = sectionTitle;
  const topic = clean(r.topic, PERSONALIZE_LIMITS.topic);
  if (topic) req.topic = topic;
  if (typeof r.grant === "string" && UUID_RE.test(r.grant)) req.grant = r.grant;
  return req;
}

export const isGrantId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** What each rewrite style asks for. */
const STYLE_TASK: Record<Exclude<RewriteStyle, "custom">, string> = {
  simplify:
    "Rewrite it in plain words a first-year medical student understands at first read: swap jargon for everyday words, spell out abbreviations, and turn arrow chains into a sentence. Keep every fact.",
  deeper: "Keep the fact and add the mechanism behind it — the why — in the same line.",
  shorter: "Cut it to the shortest line that still states the fact.",
  example: "Rewrite it as a one-sentence patient example in which this fact decides what the doctor does.",
  mnemonic: "Turn it into a memory device — a mnemonic, analogy or vivid image that encodes the fact — followed by the fact itself in a few words.",
};

export interface PersonalizeContext {
  examMode?: string;
  difficulty?: string;
}

/** The system and user messages for one action. */
export function buildPersonalizePrompt(
  req: PersonalizeRequest,
  ctx: PersonalizeContext = {}
): { systemPrompt: string; userContent: string } {
  const topic = req.topic ?? "a medical topic";
  const reader = [ctx.examMode, ctx.difficulty].filter(Boolean).join(", ");
  const about = `a student's study sheet on "${topic}"${reader ? ` (${reader})` : ""}`;
  // Context is labelled as context: a bare "Section: …" line was copied into
  // the rewrite as if it were part of it.
  const where = req.sectionTitle ? `(From the section "${req.sectionTitle}". Context only — not part of the line.)\n` : "";
  const focusLine = req.focus ? `\nThe student selected this part of it: "${req.focus}"` : "";

  if (req.action === "rewrite") {
    const task =
      req.style === "custom"
        ? `Rewrite it the way the student asked: "${req.instruction}". If what they asked is not a way of rewriting this line, rewrite it as clearly as you can instead.`
        : STYLE_TASK[req.style as Exclude<RewriteStyle, "custom">];
    // The reply replaces the whole line when the student accepts it. Asked to
    // "weight" a selection, the model rewrote only the selection — accepting
    // that would have deleted the rest of the line.
    const focusRule = req.focus
      ? "\n- The student selected part of the line. Give that part the most attention, but rewrite the WHOLE line: everything else in it must still be there."
      : "";
    const keepRule =
      req.style === "shorter"
        ? "- Keep every fact; cut only words."
        : "- Keep every fact, drug, dose and number already in the line.";
    return {
      systemPrompt: `You are a medical educator editing one line of ${about}. Your reply replaces the line on the student's sheet.

${task}

Rules:
- Reply with the rewritten line only: no preamble, no quotation marks, no explanation after it.
- One line. Plain text, with **double asterisks** around the single most important term.
${keepRule}${focusRule}
- If the line starts with a label such as "Management:", keep that label at the start. Never add a label the line does not have.
- Stay accurate. Never add a drug, dose, threshold or number you are not certain of.`,
      userContent: `${where}Line to rewrite:\n${req.text}${focusLine}`,
    };
  }

  if (req.action === "card") {
    const target = req.focus ?? req.text;
    return {
      systemPrompt: `You are a medical educator writing one flashcard from ${about}.

The card must make the student recall the fact in the passage they chose — not a different fact from the same line.

Reply with exactly two lines and nothing else:
Q: <a question ending in ?, answerable from the passage, that does not give the answer away>
A: <the answer in one short sentence>

Stay accurate. Never add a number or drug the passage does not support.`,
      userContent: `Passage: ${target}${req.focus ? `\n\n${where}The line it comes from:\n${req.text}` : ""}`,
    };
  }

  // explain
  return {
    systemPrompt: `You are a medical educator. A student marked part of ${about} as confusing. Make it click.

Write 2 or 3 short sentences in plain words: what it means, and why it is true. Then a final line that starts with "Check:" and asks one quick question the student can answer to see whether they have got it.

Plain text, with **double asterisks** around the key term once. Under 90 words. No preamble.`,
    userContent: `${where}Line:\n${req.text}${focusLine}`,
  };
}
