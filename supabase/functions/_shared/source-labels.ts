import type { RagChunk } from "./rag.ts";

/**
 * A label the model proposed for one retrieved passage. Deliberately untrusted
 * and untyped beyond its shape: the client validates every field against the
 * raw chunk before anything reaches the UI or gets persisted into a saved
 * sheet or a flashcard deck's grounding metadata (src/lib/source-labels.ts).
 */
export type RawSourceLabel = {
  id: string;
  book?: string | null;
  chapter?: string | null;
  section?: string | null;
};

/**
 * The corpus was ingested from PDFs whose filenames became the document name,
 * so a passage renders as "OceanofPDF.comNelson_textbook_of_pediatrics_22nd_
 * edition_-_Robert_M_Kliegman" with a heading stack full of running heads.
 * src/lib/source-display.ts repairs what can be repaired mechanically; this
 * asks a model for the last mile — a real book title and a chapter a student
 * could look up.
 *
 * The prompt's whole job is to keep the model from inventing provenance.
 * Naming a book we cannot justify, or a chapter number that appears nowhere in
 * the retrieved text, would be worse than showing nothing: it manufactures a
 * citation. The client enforces both rules again on the way in.
 */
const SYSTEM_PROMPT = `You label passages retrieved from a medical reference library so a student can see where each one came from.

For every passage you are given, return:
- "book": the real, human-readable title of the work, recovered FROM THE FILENAME ONLY. Fix capitalisation and underscores, drop download-site prefixes and the trailing "PDF", and keep an edition only if the filename states one. If the filename is an opaque code you cannot justify expanding, repeat it unchanged.
- "chapter": where in the book the passage sits, taken ONLY from the heading text or the passage text you are given. Prefer "Chapter <n> — <title>", else the section name alone. If neither gives you something a reader could look up, use null.
- "section": a contents-page entry for this one passage — 3 to 8 words naming the specific topic it covers, e.g. "Transfusion thresholds in acute bleeding". Build it from words that appear in the passage itself. This is what the reader sees in the list before they expand the text, so it must describe THIS passage, not the chapter as a whole. If the passage is a figure caption, a reference list or otherwise has no topic, use null.

Hard rules:
- Never use outside knowledge. Do not guess an author, year, edition, chapter number or chapter title that is not present in the input.
- Every digit you write in "chapter" must already appear in that passage's heading or text.
- "section" must be grounded in the passage's own wording. Do not introduce clinical claims, drugs or numbers the passage does not contain.
- Prefer null over a guess. An unlabelled passage is fine; an invented citation is not.

Return ONLY a JSON array, no prose, no code fences:
[{"id":"<the id given>","book":"<title>","chapter":"<location or null>","section":"<topic or null>"}]`;

/**
 * Enough text to name what a passage is about without sending whole chunks.
 * The topic is almost always established in the opening lines.
 */
const CONTENT_PREVIEW_CHARS = 500;
const HEADING_PREVIEW_CHARS = 200;

/**
 * Asks the model to name the book and chapter behind each retrieved passage.
 *
 * Fail-open by contract: any network error, non-200, or unparseable body
 * resolves to an empty array. The source list already renders correctly from
 * the mechanical repair alone, so a failure here costs polish, never content.
 */
export async function requestSourceLabels(
  openRouterApiKey: string,
  model: string,
  chunks: readonly RagChunk[]
): Promise<RawSourceLabel[]> {
  if (chunks.length === 0) return [];

  const payload = chunks.map((c) => ({
    id: c.id,
    filename: c.guidelineName,
    heading: (c.sectionTitle ?? "").slice(0, HEADING_PREVIEW_CHARS),
    text: c.content.slice(0, CONTENT_PREVIEW_CHARS),
  }));

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": "https://studybuddy.app",
        "X-Title": "StudyBuddy",
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        max_tokens: 900,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });

    if (!response.ok) return [];

    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return [];

    return parseLabelArray(text);
  } catch {
    return [];
  }
}

/**
 * Pulls the JSON array out of a model response, tolerating code fences and
 * stray prose either side of it. Shape only — the client does the real
 * validation.
 */
export function parseLabelArray(text: string): RawSourceLabel[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RawSourceLabel =>
        !!item && typeof item === "object" && typeof (item as RawSourceLabel).id === "string"
    );
  } catch {
    return [];
  }
}
