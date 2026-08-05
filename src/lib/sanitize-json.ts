/**
 * Strip the markdown fence some models wrap around JSON output.
 *
 * The opening and closing fences are handled independently, so this works on
 * partial stream text (where the closing fence hasn't been emitted yet) as
 * well as on a finished response.
 */
export function stripFences(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  }
  // The closing fence only exists once the model has finished.
  return cleaned.replace(/\s*```$/, "").trim();
}
