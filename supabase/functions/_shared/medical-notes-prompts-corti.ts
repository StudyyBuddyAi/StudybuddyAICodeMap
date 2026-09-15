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

const CARDS_FORMAT_MARKER = "OUTPUT FORMAT — copy this structure exactly:";

const GATES: Record<string, { hooks: string; keyPoints: string; traps: string; cards: string; clinical: string }> = {
  Concise: {
    hooks: "exactly 3",
    keyPoints: "exactly 5",
    traps: "exactly 3",
    cards: "exactly 3",
    clinical: "ONLY Diagnosis, Management (first-line only) and Complications (max 2). Do NOT write Workup, Second-line, Definitive or Avoid lines at all",
  },
  Moderate: {
    hooks: "3 or 4",
    keyPoints: "6 to 8",
    traps: "exactly 4",
    cards: "exactly 4",
    clinical: "every subsection, at moderate depth",
  },
  Detailed: {
    hooks: "exactly 5",
    keyPoints: "8 to 10",
    traps: "5 or 6",
    cards: "exactly 5",
    clinical: "every subsection, fully expanded",
  },
};

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

function sheetChecklist(length: string): string {
  const gate = GATES[length] ?? GATES.Concise;
  return `

FINAL CHECK — verify each point before you write the closing }:
- Length is "${length}": memoryHooks ${gate.hooks} items; keyPoints ${gate.keyPoints} items; examTraps ${gate.traps} items; flashcards ${gate.cards} items.
- clinicalApproach contains ${gate.clinical}.
- Write for the audience and exam the request names. A retrieved passage from a pediatrics or adult textbook does not narrow the audience.
- sourceCoverage must agree with itself: "full" means "uncovered" is empty; "none" lists every section; "partial" lists at least one section but not all of them.
- referenceNote is a finished sentence — never the instruction text in angle brackets.`;
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
        /- Fill every field of the JSON output below from standard medical knowledge even where this Context\n  is silent\. Never leave a field empty, never truncate the sheet, and never refuse to answer — report\n  any gap honestly in "sourceCoverage" instead \(see the OUTPUT section below\)\./,
        "- Where the Context is silent, still write the full deck from standard medical knowledge and tag those cards [General]. Never refuse."
      )
      .replace(
        /Answer from general medical knowledge, and\nstill fill every field of the JSON output below completely — never leave a field empty, never truncate\nthe sheet, and never refuse to answer\./,
        "Write the full deck from general medical knowledge and tag every card [General]. Never refuse."
      );
    const at = systemPrompt.indexOf(CARDS_FORMAT_MARKER);
    if (at !== -1) {
      const count = Math.min(Math.max(parseInt(String(input.cardCount)) || 12, 5), 20);
      // The original block runs to the end of the cards prompt; any memory
      // instruction appended after it is carried over.
      const memoryTail = input.hasMemory ? systemPrompt.slice(systemPrompt.lastIndexOf("\n\nIMPORTANT: You have access")) : "";
      systemPrompt = systemPrompt.slice(0, at) + cardsFormatBlock(count, input.notes.trim()) + memoryTail;
    }
  } else {
    systemPrompt += sheetChecklist(input.length || "Concise");
  }

  return { systemPrompt, userContent: base.userContent };
}
