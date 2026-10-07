/**
 * Whether a topic is well-formed text, judged before anything is billed. Run by
 * the flashcards page for instant feedback and by the edge function for real —
 * the page re-exports this file (src/lib/validate-topic.ts), so the two cannot
 * drift.
 *
 * Structural only: it never decides whether text is *medical*, and it does not
 * try to spot gibberish by letter statistics. Medical vocabulary defeats every
 * such rule — "Hirschsprung" has a seven-consonant run and fewer vowels than
 * most keyboard mash. Whether "dsvsdv…" or "banana bread" is a topic is left
 * to the model's decline contract (topic-decline.ts).
 */

/** Two, not three: "MI" is a topic. */
export const TOPIC_MIN_LENGTH = 2;
/** Caps embedding and prompt cost; comfortably above a pasted lecture note. */
export const TOPIC_MAX_LENGTH = 5000;

export type TopicRejection =
  | "too_short"
  | "too_long"
  | "no_letters"
  | "markup"
  | "repetitive"
  | "keyboard_mash";

// Characters that pad a string past too_short without being visible: C0/C1
// controls and the zero-width/bidi-mark family.
// eslint-disable-next-line no-control-regex -- deliberate: strips control characters
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\uFEFF]/g;

const MARKUP_RE = /<\/?[a-zA-Z][^>]*>|javascript:|on(?:error|load|click|mouseover)\s*=/i;

const LETTER_RE = /\p{L}/u;

/** One short unit (1-4 characters) repeated to fill the string: "aaaaaa", "abcabcabc". */
function isRepetitive(compact: string): boolean {
  if (compact.length < 6) return false;
  for (let unit = 1; unit <= 4; unit++) {
    const piece = compact.slice(0, unit);
    if (piece.repeat(Math.ceil(compact.length / unit)).slice(0, compact.length) === compact) return true;
  }
  return false;
}

// Keyboard-row runs typed without looking. Five keys, not four: four-key runs
// turn up inside real words — "puberty" contains "erty".
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const KEYBOARD_RUN = 5;

function isKeyboardMash(compact: string): boolean {
  for (const row of KEYBOARD_ROWS) {
    for (const line of [row, [...row].reverse().join("")]) {
      for (let i = 0; i + KEYBOARD_RUN <= line.length; i++) {
        if (compact.includes(line.slice(i, i + KEYBOARD_RUN))) return true;
      }
    }
  }
  return false;
}

/** null when the text is acceptable. Says nothing about whether it is medical. */
export function validateTopic(raw: unknown): TopicRejection | null {
  const text = (typeof raw === "string" ? raw : "").replace(INVISIBLE_RE, "").trim();
  if (text.length < TOPIC_MIN_LENGTH) return "too_short";
  if (text.length > TOPIC_MAX_LENGTH) return "too_long";
  if (MARKUP_RE.test(text)) return "markup";
  if (!LETTER_RE.test(text)) return "no_letters";
  const compact = text.toLowerCase().replace(/\s+/g, "");
  if (isRepetitive(compact)) return "repetitive";
  if (isKeyboardMash(compact)) return "keyboard_mash";
  return null;
}

export function topicRejectionMessage(reason: TopicRejection): string {
  switch (reason) {
    case "too_short":
      return "Type a little more — a condition, drug or concept to study.";
    case "too_long":
      return `That's too long — keep it under ${TOPIC_MAX_LENGTH.toLocaleString("en")} characters.`;
    case "no_letters":
      return "Use words, not just numbers or symbols.";
    case "markup":
      return "Remove the HTML or code and describe the topic in words.";
    case "repetitive":
    case "keyboard_mash":
      return "That doesn't look like a medical topic. Try something like “heart failure” or “DKA”.";
  }
}
