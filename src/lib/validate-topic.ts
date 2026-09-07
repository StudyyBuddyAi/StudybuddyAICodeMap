// Mirror of supabase/functions/_shared/validate-topic.ts, duplicated rather
// than imported — Deno edge functions can't reach into src/, and this side
// isn't authoritative anyway: it exists only for instant feedback while
// typing. The server copy is what's actually enforced. Keep both in sync when
// tuning a threshold or adding a rule; src/test/validate-topic.test.ts
// asserts they agree.
//
// This is a structural gate only — it judges whether input is well-formed
// text, never whether it's a *medical* topic. That judgement is left to the
// model (see the decline contract in medical-notes/index.ts), because
// encoding "is this medical" as regexes would false-positive on real medical
// vocabulary, which is full of unusual strings ("β-blocker", "HFpEF").
// Keeping the two concerns separate is what makes these rules safe to run
// unconditionally, before any quota is spent.

export const TOPIC_MIN_LENGTH = 3;
// Caps embedding + prompt cost; comfortably above a pasted lecture note.
export const TOPIC_MAX_LENGTH = 5000;

export type TopicRejection =
  | "too_short"
  | "too_long"
  | "no_letters"
  | "markup"
  | "repetitive"
  | "keyboard_mash";

// Strips characters that could pad an otherwise-empty string past the
// too_short check without being visible to the user typing it: C0/C1 control
// characters, and the zero-width/bidi-mark family (ZWSP, ZWNJ, ZWJ, LRM, RLM,
// BOM/ZWNBSP).
// eslint-disable-next-line no-control-regex -- deliberate: strips control characters as input hygiene
const CONTROL_AND_ZERO_WIDTH_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\uFEFF]/g;

function normalize(raw: string): string {
  return raw.replace(CONTROL_AND_ZERO_WIDTH_RE, "").trim();
}

// Matches an HTML tag, or a small set of script-bearing attribute/scheme
// patterns that could survive without a full tag (e.g. copy-pasted fragments).
const MARKUP_RE =
  /<\/?[a-zA-Z][^>]*>|javascript:|on(?:error|load|click|mouseover)\s*=/i;

const NO_LETTERS_RE = /\p{L}/u;

// A short substring (1-4 chars) repeated to fill most of the string:
// "asdfasdf", "aaaaaaaa", "abcabcabc".
function isRepetitive(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 6) return false;
  for (let unitLen = 1; unitLen <= 4; unitLen++) {
    const unit = compact.slice(0, unitLen);
    if (!unit) continue;
    const repeated = unit.repeat(Math.ceil(compact.length / unitLen)).slice(0, compact.length);
    if (repeated === compact) return true;
  }
  return false;
}

// Keyboard-row runs typed without looking — "qwerty", "asdfgh", "zxcvbnm" —
// checked as substrings so "asdf" inside a longer mash still matches.
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];
const KEYBOARD_MIN_RUN = 4;

function isKeyboardMash(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, "");
  if (compact.length < KEYBOARD_MIN_RUN) return false;
  for (const row of KEYBOARD_ROWS) {
    const reversed = row.split("").reverse().join("");
    for (let start = 0; start + KEYBOARD_MIN_RUN <= row.length; start++) {
      const forwardRun = row.slice(start, start + KEYBOARD_MIN_RUN);
      const reverseRun = reversed.slice(start, start + KEYBOARD_MIN_RUN);
      if (compact.includes(forwardRun) || compact.includes(reverseRun)) return true;
    }
  }
  return false;
}

/** null = structurally acceptable. Says nothing about whether it's medical. */
export function validateTopic(raw: string): TopicRejection | null {
  const text = normalize(raw ?? "");

  if (text.length < TOPIC_MIN_LENGTH) return "too_short";
  if (text.length > TOPIC_MAX_LENGTH) return "too_long";
  if (MARKUP_RE.test(text)) return "markup";
  if (!NO_LETTERS_RE.test(text)) return "no_letters";
  if (isRepetitive(text)) return "repetitive";
  if (isKeyboardMash(text)) return "keyboard_mash";

  return null;
}

export function topicRejectionMessage(reason: TopicRejection): string {
  switch (reason) {
    case "too_short":
      return `Please enter at least ${TOPIC_MIN_LENGTH} characters.`;
    case "too_long":
      return `That's too long — please keep it under ${TOPIC_MAX_LENGTH} characters.`;
    case "no_letters":
      return "Please enter a topic using words, not just numbers or symbols.";
    case "markup":
      return "Please remove any HTML or code from your topic.";
    case "repetitive":
    case "keyboard_mash":
      return "That doesn't look like a real topic — please describe what you'd like to study.";
  }
}
