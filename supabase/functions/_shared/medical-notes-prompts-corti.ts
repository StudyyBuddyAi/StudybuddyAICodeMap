/**
 * The medical-notes prompts, adjusted for Corti's models.
 *
 * Deliberately a set of targeted edits over the originals rather than a
 * rewrite, so a before/after comparison measures these changes and nothing
 * else. Each one answers a failure measured in the Phase 1 comparison
 * (docs/corti-provider-spike.md):
 *
 *   Cards — the original "OUTPUT FORMAT — copy this structure exactly" block
 *   mixes the skeleton with placeholder lines ("[one emoji …]", "[blank line
 *   between every card — this is mandatory]") and with the tag legend. Corti's
 *   models copied it literally: the FLASHCARDS header got dropped (the app's
 *   parser then finds 0 cards), invented tags appeared ("[Adverse Effect]"),
 *   and the TAGS / SOURCING / HARD RULES text was echoed after the last card,
 *   where it lands inside that card's answer. With sparse retrieval, cards
 *   also followed an off-topic passage (lidocaine in a beta-blocker deck). The
 *   block is replaced with rules first, then a literal example, then explicit
 *   first-line / last-line instructions.
 *
 *   Sheets — the length gate was sometimes ignored (a Concise sheet with
 *   Workup, Second-line and Avoid) or collapsed (one key point on a Detailed
 *   sheet), sourceCoverage contradicted itself, and pediatric source passages
 *   pulled a general request toward children. A final checklist with the
 *   concrete counts for the requested length is appended, where it is the
 *   last thing read.
 *
 *   Enhance — the clinical tie-in ran past its 50-word cap.
 */
import { buildNotesPrompts, type NotesPromptInput } from "./medical-notes-prompts.ts";
import { resolveSheetPlan, sectionQuota, type PlannedSection } from "./sheet-plan.ts";

const CARDS_FORMAT_MARKER = "OUTPUT FORMAT — copy this structure exactly:";


function cardsFormatBlock(count: number, topic: string): string {
  return `CARD RULES:
- Write exactly ${count} cards, every one about "${topic}". If a retrieved passage covers a different drug, disease or topic, do not write cards about it.
- Every question line starts with "Q: " followed by exactly two tags: first ONE clinical tag chosen from [Diagnosis] [Mechanism] [Next Step] [Complication] [Association] — no other tag names are allowed — then ONE sourcing tag, [Grounded] if the card comes from the Context above or [General] if it does not. With no Context, every card is [General].
- Every answer line starts with "A: " and is 1-2 sentences.
- Questions end with "?". Mix clinical vignettes with concept recall.
- Topic emoji, one of: 🫀 cardiac, 🩸 hematology, 🧠 neuro, 🫁 pulmonary, 🦴 ortho, 🩺 general, 💊 pharmacology, 🧬 genetics, 👁️ ophthalmology, 🤰 OB/GYN, 👶 pediatrics, 🧫 micro, ⚗️ biochem, 🩹 trauma, 🛡️ immunology

EXAMPLE of the exact layout (two cards shown; content is illustrative only):

FLASHCARDS

🫀

Q: [Mechanism][Grounded] Why does chronic RAAS activation worsen systolic heart failure?
A: Angiotensin II and aldosterone drive sodium retention and myocardial remodeling, which further lowers ejection fraction.

Q: [Next Step][General] A patient with HFrEF remains symptomatic on an ACE inhibitor and beta-blocker. What should be added?
A: Add a mineralocorticoid receptor antagonist and an SGLT2 inhibitor.

YOUR OUTPUT:
- The very first line of your reply is the word FLASHCARDS.
- Then a blank line, the emoji on its own line, a blank line, and the ${count} cards separated by blank lines.
- The last line of your reply is the answer of card ${count}. Do not add tag legends, notes, rule reminders or any other text after it.`;
}

/**
 * The counts restated as the last thing the model reads, where Corti's models
 * attend to them. Built from the plan so it cannot drift from the schema above
 * it — the two used to be separate lists of the same six sections.
 */
function sheetChecklist(plan: PlannedSection[], length: string): string {
  const quotas = plan.map((s) => `${s.key} ${sectionQuota(s)}`).join("; ");
  const tables = plan.filter((s) => s.kind === "table" && s.columns?.length);
  const tableCheck = tables.length
    ? `\n- Every row of ${tables.map((s) => `${s.key} has exactly ${s.columns!.length} strings`).join(", and every row of ")}. No header row.`
    : "";
  return `

FINAL CHECK — verify each point before you write the closing }:
- The sheet has exactly these keys, in this order: ${plan.map((s) => s.key).join(", ")}, referenceNote, sourceCoverage. Do not add a section that is not on that list, and do not leave one out.
- Length is "${length}": ${quotas}.${tableCheck}
- Write for the audience and exam the request names. A retrieved passage from a pediatrics or adult textbook does not narrow the audience.
- sourceCoverage must agree with itself: "full" means "uncovered" is empty; "none" lists every section; "partial" lists at least one section but not all of them.
- referenceNote is a finished sentence — never the instruction text in angle brackets.
- No fact appears in two sections, except a Memory Hook that encodes one of the two or three central facts.`;
}

export function buildCortiNotesPrompts(input: NotesPromptInput): { systemPrompt: string; userContent: string } {
  const base = buildNotesPrompts(input);
  let systemPrompt = base.systemPrompt;

  if (input.enhanceMode === "clinical") {
    systemPrompt += "\n\nBefore answering, count: exactly 2 sentences and no more than 50 words in total.";
  } else if (input.enhanceMode === "expand") {
    systemPrompt += "\n\nBefore answering, count: 2 or 3 sentences and no more than 60 words in total.";
  } else if (input.explainMode) {
    // Explain met its contract on every Corti arm; left unchanged.
  } else if (input.cardsOnly) {
    // The shared grounding block is written for the sheet and tells a card
    // deck to "fill every field of the JSON output below" and not to
    // "truncate the sheet" — contradicting the plain-text card format.
    systemPrompt = systemPrompt
      .replace(
        /- Fill every field of the JSON output below from standard medical knowledge even where this Context\n {2}is silent\. Never leave a field empty, never truncate the sheet, and never refuse to answer — report\n {2}any gap honestly in "sourceCoverage" instead \(see the OUTPUT section below\)\./,
        "- Where the Context is silent, still write the full deck from standard medical knowledge and tag those cards [General]. Never refuse."
      )
      .replace(
        /Answer from general medical knowledge, and\nstill fill every field of the JSON output below completely — never leave a field empty, never truncate\nthe sheet, and never refuse to answer\./,
        "Write the full deck from general medical knowledge and tag every card [General]. Never refuse."
      );
    const at = systemPrompt.indexOf(CARDS_FORMAT_MARKER);
    if (at !== -1) {
      const count = Math.min(Math.max(parseInt(String(input.cardCount)) || 12, 3), 20);
      // The original block runs to the end of the cards prompt; any memory
      // instruction appended after it is carried over.
      const memoryTail = input.hasMemory ? systemPrompt.slice(systemPrompt.lastIndexOf("\n\nIMPORTANT: You have access")) : "";
      systemPrompt = systemPrompt.slice(0, at) + cardsFormatBlock(count, input.notes.trim()) + memoryTail;
    }
  } else {
    const length = input.length || "Concise";
    // Mirrors the fallback in buildNotesPrompts, so the checklist always
    // describes the same sections the schema above it asked for.
    const plan = input.plan?.length
      ? input.plan
      : resolveSheetPlan({
          archetype: "condition",
          examMode: input.examMode,
          difficulty: input.difficulty,
          length,
        });
    systemPrompt += sheetChecklist(plan, length);
  }

  return { systemPrompt, userContent: base.userContent };
}
