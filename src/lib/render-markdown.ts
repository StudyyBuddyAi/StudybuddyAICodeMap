/**
 * Minimal safe markdown subset renderer for QBank explanation / teaching-point
 * text (model- and DB-supplied).
 *
 * The model output is treated as untrusted: HTML is escaped BEFORE the inline
 * markdown transforms are applied, so raw `<script>`, `<img onerror=...>` etc.
 * can never reach the DOM as active markup through the caller's
 * dangerouslySetInnerHTML. Only the two inline transforms the UI supports are
 * re-introduced: **bold** → <strong> and *italic* → <em>.
 */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function renderMarkdown(text: string): string {
  if (text == null || text === "") return "";
  // Escape first so only the transforms below may introduce markup.
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}
