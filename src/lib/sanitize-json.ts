/**
 * Strip markdown fences that some models wrap around JSON output.
 * Call this on the assembled stream text before JSON.parse().
 */
export function sanitizeJsonOutput(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return cleaned;
}

/**
 * Strip an opening ``` fence without requiring the closing one. Use this on
 * partial stream text, where the closing fence hasn't been emitted yet.
 */
export function stripLeadingFence(raw: string): string {
  const trimmed = raw.trimStart();
  return trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "")
    : trimmed;
}
