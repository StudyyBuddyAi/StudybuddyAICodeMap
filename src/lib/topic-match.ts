/** Lowercase, strip punctuation and collapse whitespace. */
export const normaliseTopic = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * True when two topic names refer to the same thing.
 *
 * Exact match after normalising, or one fully containing the other as a whole
 * phrase — "heart failure" matches "Heart Failure" and "Chronic heart failure",
 * but "failure" alone does not match "heart failure", because a bare word
 * overlaps far too much across a medical curriculum.
 */
export function sameTopic(a: string, b: string): boolean {
  const x = normaliseTopic(a);
  const y = normaliseTopic(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Require the shorter side to be a multi-word phrase before allowing
  // containment, so single common words cannot carry a match.
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.split(" ").length < 2) return false;
  return longer.includes(shorter);
}
