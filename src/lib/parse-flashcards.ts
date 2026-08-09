export type ParsedCard = {
  question: string;
  answer: string;
  tag: string;
  topic: string;
  topicEmoji?: string;
};

/**
 * Parse the FLASHCARDS section from streamed AI output.
 * Hardened against malformed boundaries where Q:/A: appears inline within answers.
 */
export function parseFlashcardsFromOutput(output: string, topic: string): ParsedCard[] {
  const idx = output.search(/FLASHCARDS/i);
  if (idx === -1) return [];

  let section = output.slice(idx).replace(/^FLASHCARDS[^\n]*\n?/i, "");
  // Stop at next major section header
  const stop = section.search(/\n\s*REFERENCE\s+NOTE\b/i);
  if (stop !== -1) section = section.slice(0, stop);

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

    // Extract leading [Tag] from question
    let tag = "";
    const tagMatch = question.match(/^\s*\[([^\]]+)\]\s*/);
    if (tagMatch) {
      tag = tagMatch[1].trim();
      question = question.slice(tagMatch[0].length).trim();
    }

    if (!question) continue;

    cards.push({ question, answer, tag, topic: truncatedTopic, topicEmoji });
  }

  return cards;
}
