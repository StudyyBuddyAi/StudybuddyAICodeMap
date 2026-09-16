export type ParsedCard = {
  question: string;
  answer: string;
  /** Clinical tag only — "Mechanism", "Next Step", … Brackets stripped. */
  tag: string;
  /**
   * Whether the model marked this card [Grounded] (drawn from retrieved
   * guideline context) rather than [General]. Cards produced before the
   * sourcing tag existed carry no such bracket and default to false — an
   * untagged card is genuinely unverified, so false is the honest fallback.
   */
  grounded: boolean;
  topic: string;
  topicEmoji?: string;
};

/** Sourcing tags the model writes as the second bracket on every Q: line. */
const SOURCING_TAGS = new Map<string, boolean>([
  ["grounded", true],
  ["general", false],
]);

/** A line that starts an answer, in either spelling models use. */
const ANSWER_LINE_RE = /^\s*(?:A|Answer)\s*:/i;

/**
 * Prompt-legend lines models echo into a deck: "TAGS (pick one per card): …",
 * "SOURCING TAG: …", "HARD RULES: …". Some write one after every card
 * ("TAGS: [Mechanism]"); others dump the whole legend after the last card,
 * where it would be read as part of that card's answer.
 */
const LEGEND_LINE_RE = /^\s*(?:TAGS\b|SOURCING\s+TAGS?\b|EMOJI\s*:|HARD\s+RULES\b|sourceCoverage\s*:)/i;
const QUESTION_LINE_RE = /^\s*(?:Q|Question)\s*:|^\s*\[[^\]]+\]/i;

/**
 * Drops legend lines between cards, and cuts the deck at a legend line that no
 * further card follows — everything from there on is the echoed prompt.
 */
function stripLegend(section: string): string {
  const lines = section.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!LEGEND_LINE_RE.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }
    const anotherCardFollows = lines.slice(i + 1).some((l) => QUESTION_LINE_RE.test(l));
    if (!anotherCardFollows) break;
  }
  return kept.join("\n");
}

/**
 * Bring model output that drifted from the prompt's format back to it:
 * "Question:"/"Answer:" spellings become Q:/A:, and a question line that
 * starts with its tag bracket but lost its "Q:" prefix gets it back when the
 * next non-blank line is an answer. Claude Haiku 4.5 wrote every question of
 * every deck that way in the provider comparison.
 */
function normalizeCardLines(section: string): string {
  const lines = section.split("\n");
  const nextNonBlank = (from: number) => {
    for (let j = from; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return "";
  };
  return lines
    .map((line, i) => {
      if (/^\s*Question\s*:/i.test(line)) return line.replace(/^\s*Question\s*:/i, "Q:");
      if (/^\s*Answer\s*:/i.test(line)) return line.replace(/^\s*Answer\s*:/i, "A:");
      if (/^\s*\[[^\]]+\]/.test(line) && ANSWER_LINE_RE.test(nextNonBlank(i + 1))) {
        return `Q: ${line.trim()}`;
      }
      return line;
    })
    .join("\n");
}

/**
 * Parse the FLASHCARDS section from streamed AI output.
 * Hardened against malformed boundaries where Q:/A: appears inline within answers.
 *
 * The FLASHCARDS header is preferred but not required: a deck that omits it
 * (several models do, despite the prompt) is read from the top, as long as it
 * has answer lines — plain prose with no A: lines still yields no cards.
 */
export function parseFlashcardsFromOutput(output: string, topic: string): ParsedCard[] {
  const idx = output.search(/FLASHCARDS/i);
  let section: string;
  if (idx !== -1) {
    section = output.slice(idx).replace(/^FLASHCARDS[^\n]*\n?/i, "");
  } else if (output.split("\n").some((line) => ANSWER_LINE_RE.test(line))) {
    section = output.replace(/^\s*\n/, "");
  } else {
    return [];
  }

  // Stop at next major section header
  const stop = section.search(/\n\s*REFERENCE\s+NOTE\b/i);
  if (stop !== -1) section = section.slice(0, stop);
  section = normalizeCardLines(stripLegend(section));

  const truncatedTopic = topic.trim().slice(0, 60);
  let topicEmoji: string | undefined;
  const emojiMatch = section.match(/^\s*([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\s*\n/u);
  if (emojiMatch) {
    topicEmoji = emojiMatch[1];
    section = section.slice(emojiMatch[0].length);
  }
  const cards: ParsedCard[] = [];

  // Hardened regex: require Q: and A: to be at the start of a line (after optional whitespace).
  // This rejects cases where "Q:" or "A:" appear mid-answer as inline text.
  // Match: line-start Q: <question>, then line-start A: <answer>, until next line-start Q: or end.
  const regex = /(?:^|\n)\s*Q\s*:\s*([\s\S]*?)\n\s*A\s*:\s*([\s\S]*?)(?=\n\s*Q\s*:|$)/gi;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(section)) !== null) {
    let question = m[1].trim();
    const answer = m[2].trim();
    if (!question || !answer) continue;

    // Reject malformed cards: if either field still contains an inline Q: or A: marker
    // on a new line, the card is corrupted (parser drift). Skip it entirely.
    if (/\n\s*Q\s*:/i.test(question) || /\n\s*A\s*:/i.test(question)) continue;
    if (/\n\s*Q\s*:/i.test(answer)) continue;

    // Reject cards that are obviously too long (likely two cards merged).
    if (question.length > 800 || answer.length > 800) continue;

    // Extract the leading bracket run from the question. The prompt asks for
    // two brackets — one clinical tag, one sourcing tag — but the order isn't
    // guaranteed and older output has only one, so classify each bracket by
    // its content rather than by position.
    let tag = "";
    let grounded: boolean | null = null;
    const tagBlockMatch = question.match(/^(?:\s*\[[^\]]+\])+/);
    if (tagBlockMatch) {
      const tagBlock = tagBlockMatch[0];
      const rest = question.slice(tagBlock.length).trim();
      const individualTags = [...tagBlock.matchAll(/\[([^\]]+)\]/g)].map((t) => t[1].trim());
      const clinicalTags: string[] = [];
      for (const t of individualTags) {
        const key = t.toLowerCase();
        if (SOURCING_TAGS.has(key)) grounded = SOURCING_TAGS.get(key)!;
        else clinicalTags.push(t);
      }
      tag = clinicalTags[0] ?? "";
      question = rest;
    }

    if (!question) continue;

    cards.push({
      question,
      answer,
      tag,
      grounded: grounded ?? false,
      topic: truncatedTopic,
      topicEmoji,
    });
  }

  return cards;
}
