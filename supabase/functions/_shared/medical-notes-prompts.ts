/**
 * The medical-notes prompts, lifted out so another writer can run them.
 *
 * Originally a verbatim copy of the prompts medical-notes/index.ts carried
 * inline — deliberately not re-indented, because the template literals'
 * whitespace is prompt text. That entrypoint is now a bare serve() over
 * _shared/medical-notes-handler.ts, so this module is the only copy and is
 * edited directly.
 *
 * `family` stands in for the model check the original makes
 * (`model === "anthropic/claude-haiku-4.5"`): "haiku" selects the Claude-tuned
 * prompts, "gptOss" the terse ones.
 */
import type { RagChunk } from "./rag.ts";
import { MEMORY_FOLLOWUP_INSTRUCTION } from "./memory.ts";
import { DEFAULT_SHEET_PLAN, resolveSheetPlan, sectionQuota, type PlannedSection } from "./sheet-plan.ts";
import type { LengthSetting } from "./sheet-sections.ts";

export type PromptFamily = "haiku" | "gptOss";


/**
 * One line of the JSON skeleton. A section's brief is written on a single line
 * with escaped newlines, matching how the placeholder has always been given —
 * a literal newline inside a JSON string value would break the shape the model
 * is being shown.
 */
function schemaLine(section: PlannedSection): string {
  const brief = section.brief.replace(/\n/g, "\\n").replace(/"/g, "'");
  if (section.kind === "list") {
    return `  "${section.key}": [\n    "<${brief} One item per element, no leading number.>",\n    "<...>"\n  ],`;
  }
  return `  "${section.key}": "<${brief}${LABELS_ON_OWN_LINES}>",`;
}

/**
 * Appended to every prose section's brief.
 *
 * Measured across topic kinds, the sections that reliably produced all their
 * labelled lines were the two whose briefs said this outright; the archetype
 * sections, which only said "Structure it as:", wrote the first label and then
 * ran on in prose — Microbiology gave Morphology but not Culture or
 * Identification, Technique gave Preparation but not Landmarks or Steps.
 * Saying it once here beats repeating it in seventeen briefs.
 */
const LABELS_ON_OWN_LINES =
  " Every label above starts on its own line, after a \\n. Write all of them. Do not merge them into a paragraph.";

export interface NotesPromptInput {
  notes: string;
  difficulty?: string;
  length?: string;
  examMode?: string;
  cardsOnly?: boolean;
  // Raw req.json() value; parsed with parseInt below.
  cardCount?: unknown;
  focusCard?: unknown;
  explainMode?: boolean;
  enhanceMode?: string;
  itemText?: string;
  sectionKey?: string;
  sectionItems?: unknown;
  enhanceTopic?: string;
  groundingAttempted: boolean;
  ragChunks: RagChunk[];
  /** True when prior memory turns go into the messages. */
  hasMemory: boolean;
  /**
   * The sections this sheet must contain. Resolved by the handler from the
   * topic's archetype and the request's settings, and sent to the client in
   * the same shape, so the prompt and the renderer can never disagree about
   * what the sheet holds. Empty or absent for cards, explain and enhance.
   */
  plan?: PlannedSection[];
  family: PromptFamily;
}

/**
 * Role/tone header for the two sheet prompts.
 *
 * Replaces the former persona tiers (student / clinician / expert), which
 * changed register only and were never enforced anywhere — the model was free
 * to ignore them and the eval harness could not tell whether it had. The
 * reader level now rides on `difficulty` alone, and the settings line is what
 * carries the request's axes into the prompt for both model families.
 */
function audienceBlock(mode: string, diff: string, len: string): string {
  return `You are a medical educator writing high-yield study material. Your goal is comprehension and retention, pitched at the difficulty level named below.

Mode: ${mode} | Difficulty: ${diff} | Length: ${len}`;
}

export function buildNotesPrompts(input: NotesPromptInput): { systemPrompt: string; userContent: string } {
    const { notes, difficulty, length, examMode, cardsOnly, cardCount, focusCard,
            explainMode,
            enhanceMode, itemText, sectionKey, enhanceTopic,
            groundingAttempted, ragChunks } = input;
    const sectionItems = input.sectionItems as string[] | undefined;

    const mode = examMode || "General";
    const diff = difficulty || "Basic";
    const len = length || "Concise";
    // A caller that sends no plan (an eval harness, a direct call) still gets
    // a coherent sheet: the condition archetype at the requested settings,
    // which is the shape a sheet has always had.
    const plan: PlannedSection[] =
      input.plan?.length
        ? input.plan
        : resolveSheetPlan({ archetype: "condition", examMode: mode, difficulty: diff, length: len });

    const retrievedChunks = ragChunks.length;
    const grounded = retrievedChunks > 0;

    const groundingContextBlock = !groundingAttempted
      ? ""
      : grounded
      ? `Context from verified clinical guidelines (retrieved from our database):
---
${ragChunks
        .map(
          (c, i) =>
            `[source ${i + 1}: ${c.guidelineName}${c.sectionTitle ? " — " + c.sectionTitle : ""}]\n${c.content}`
        )
        .join("\n\n")}
---
Rules:
- Build your output primarily from this context. It outranks your own knowledge on any conflict.
- You may add well-established general knowledge only to fill gaps the context does not cover.
- Do not invent guideline names, numbers, or citations that are not in the context above.
- Fill every field of the JSON output below from standard medical knowledge even where this Context
  is silent. Never leave a field empty, never truncate the sheet, and never refuse to answer — report
  any gap honestly in "sourceCoverage" instead (see the OUTPUT section below).`
      : `No verified guideline context matched this topic. Answer from general medical knowledge, and
still fill every field of the JSON output below completely — never leave a field empty, never truncate
the sheet, and never refuse to answer.`;

    // When grounding was never attempted (disabled, or explain/enhance mode),
    // keep the original mode-based note — saying "not covered by our reference
    // library" would be false when we simply never looked.
    const referenceNote = !groundingAttempted
      ? mode.startsWith("USMLE")
        ? "Exam-aligned with high-yield USMLE resources (e.g., First Aid, guidelines)."
        : "Based on standard medical references and clinical guidelines."
      : grounded
      ? `<Choose based on your own "sourceCoverage.level" below. If "full": "Based on: <guideline name(s) from the Context, verbatim>". If "partial": "Partly based on: <guideline name(s) from the Context, verbatim>. Sections not covered by our library were written from general medical knowledge." Never invent a guideline name not in the Context above.>`
      : "Not covered by our reference library — written from general medical knowledge. Verify before exam or clinical use.";

    let systemPrompt: string;

    // ── GPT-OSS PROMPTS (optimized for reasoning model behavior) ───────────
    const gptOssExplainPrompt = `You are a senior medical educator. A student reviewing a specific flashcard needs a targeted explanation of that exact Q&A pair.

If the input starts with "CARD QUESTION:" and "CARD ANSWER:", explain WHY that answer is correct: the mechanism, clinical reasoning, and what makes it distinguishable. Do not repeat the question or answer.

If the input is just a topic, give a brief focused refresher.

OUTPUT FORMAT:

EXPLANATION
3-5 sentences on the mechanism or reasoning. Lead with the core idea.

WHY THIS ANSWER
One sentence: the key reason this answer is correct over alternatives.

EXAM TIP
One sentence: the classic examiner trap or high-yield test point.

RULES: Under 180 words total. No markdown. No flashcards or full sheets. Start with EXPLANATION directly.`;

    const gptOssCardsPrompt = (count: number) => `You are a medical educator. Generate exactly ${count} USMLE-style flashcards on the given topic.

Mode: ${mode} | Difficulty: ${diff}

${groundingContextBlock}

Think through the highest-yield concepts for this topic, then output ONLY the flashcards in the exact format below. No preamble, no commentary, no explanations outside the cards.

OUTPUT FORMAT — copy this structure exactly:

FLASHCARDS

[one emoji representing the topic on its own line]

Q: [Mechanism][Grounded] Question text ending with question mark?
A: Answer in 1-2 sentences maximum.

Q: [Next Step][General] Question for a topic not in the context?
A: Answer.

[blank line between every card — this is mandatory]

TAGS (pick one per card): [Diagnosis] [Mechanism] [Next Step] [Complication] [Association]

SOURCING TAG (mandatory, second bracket on every Q: line):
- [Grounded] — if this card's content comes directly from the Context above
- [General]  — if no retrieved context covers this card's content

If no Context was provided, every card must be tagged [General].

EMOJI: Pick one that matches the topic — 🫀 cardiac, 🩸 hematology, 🧠 neuro, 🫁 pulmonary, 🦴 ortho, 🩺 general, 💊 pharmacology, 🧬 genetics, 👁️ ophthalmology, 🤰 OB/GYN, 👶 pediatrics, 🧫 micro, ⚗️ biochem, 🩹 trauma, 🛡️ immunology

HARD RULES:
- Exactly ${count} cards. No more, no less.
- Each card: Q: on one line, A: on next line, blank line after.
- Tags in square brackets at start of every Q: line.
- Every Q: line must have exactly two bracket tags: one clinical tag, one sourcing tag.
- Questions end with ?
- Answers: 1-2 sentences only — never more.
- No "Q:" or "A:" anywhere inside question or answer text.
- No numbering. No headers between cards. No explanations.
- Mix clinical vignettes and concept recall cards.`;

    // ── SHARED SHEET OUTPUT CONTRACT ───────────────────────────────────────
    // The JSON skeleton and the length gate are generated from the plan rather
    // than written out, so the sections a topic gets and the counts each one
    // must hit come from one place (_shared/sheet-plan.ts) instead of being
    // restated in prose here, again in the Corti checklist, and again in the
    // scorer. A sheet cannot ask for a section the plan did not choose.
    const schemaLines = plan.map(schemaLine).join("\n");
    const gateLines = plan.map((s) => `- ${s.key}: ${sectionQuota(s)}`).join("\n");
    const coverageKeys = plan.map((s) => s.key).join(", ");

    // Identical JSON schema + length gate + emoji set appended by BOTH model
    // families. Defined once here; the only per-family difference is the
    // preamble (gptOss = terse; haiku = explicit input/mode rules).
    // groundingContextBlock leads the shared contract so retrieved guideline
    // text is in front of the model before the output schema — and is an empty
    // string when grounding was never attempted, leaving the prompt unchanged.
    const sheetSchemaBlock = `${groundingContextBlock}

FORMATTING RULES (non-negotiable):
- Return ONLY a valid JSON object. No markdown fences, no preamble, no
  commentary, no text before or after the JSON.
- Use **double asterisks** inside string values to bold key terms in the
  overview and clinicalApproach fields. The renderer handles this.
- Use arrows (→) inside string values to show clinical flow.
- Numbered list items inside array fields: do NOT include the leading
  number (e.g. "1."). Each array element is already one item.

OUTPUT — return exactly this JSON shape. Write every key listed, in this order,
and no other keys:

{
  "topicEmoji": "<one emoji matching the topic>",
  "topic": "<normalized topic name, e.g. Heart Failure — plain text, no emoji>",
${schemaLines}
  "referenceNote": "${referenceNote}",
  "sourceCoverage": {
    "level": "full | partial | none",
    "uncovered": ["<zero or more of: ${coverageKeys}>"]
  }
}

SOURCE COVERAGE — report honestly, after writing the rest of the sheet:
- "full": every section above rests on the provided Context. "uncovered" is empty.
- "partial": one or more sections were written mainly from your own medical knowledge because the
  Context did not cover them. List those section names in "uncovered".
- "none": the Context was empty or irrelevant to this topic. List every section in "uncovered".
- When in doubt, choose the weaker level. Over-claiming source backing is the worst possible error here —
  worse than under-claiming it.

LENGTH GATE — Length is "${len}". These are HARD CAPS, whatever the topic's
complexity:

${gateLines}

EMOJI OPTIONS:
🫀 cardiac, 🩸 hematology, 🧠 neuro, 🫁 pulmonary, 🦴 ortho, 🩺 general,
💊 pharmacology, 🧬 genetics, 👁️ ophthalmology, 🤰 OB/GYN, 👶 pediatrics,
🧫 micro, ⚗️ biochem, 🩹 trauma, 🛡️ immunology

Start your response with { and end with }. Nothing else.`;

    const gptOssSheetPrompt = `${audienceBlock(mode, diff, len)}

Before writing anything: identify the core medical concept from the input, reason through the highest-yield facts for this reader, then generate the full output below.

${sheetSchemaBlock}`;

    // ── HAIKU 4.5 PROMPTS (Claude-native, based on GPT-OSS with input normalization) ──

    const haikuExplainPrompt = `You are a senior medical educator giving a targeted mid-study clarification.

The student is reviewing a specific flashcard and needs a deeper explanation of that exact question and answer — NOT a general overview of the topic.

If the input starts with "CARD QUESTION:" and "CARD ANSWER:", focus exclusively on explaining WHY that answer is correct: the underlying mechanism, the clinical reasoning, what makes it distinguishable from wrong answers, and what examiners test about it. Do not repeat the question or answer verbatim.

If the input is just a topic name, give a brief high-yield refresher on that topic.

OUTPUT FORMAT (follow exactly, no other sections):

EXPLANATION

3-5 sentences explaining the mechanism or reasoning behind this specific concept. Lead with the core idea. No jargon unless necessary.

WHY THIS ANSWER

One sentence: the single most important reason this answer is correct over alternatives.

EXAM TIP

One sentence: what examiners specifically test or the classic trap on this concept.

RULES:
- Total output under 180 words.
- No flashcards, no full study sheet, no memory hooks section, no reference note.
- No markdown symbols (no #, *, -, **).
- Use plain uppercase section headers exactly as shown above.
- Start directly with EXPLANATION. No preamble.`;

    // ── ENHANCE PROMPTS ──────────────────────────────────────────────────────

    const haikuExpandPrompt = `You are a senior medical educator giving a concise, targeted expansion of a single study point.

The student is reviewing a "${sectionKey}" item from a study sheet on "${enhanceTopic}".

Context — other items in this section:
${Array.isArray(sectionItems) ? sectionItems.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n") : ""}

The specific item to expand:
"${itemText}"

Write EXACTLY 2-3 sentences expanding on the mechanism or deeper "why". Maximum 60 words total — stop after 60 words even mid-thought if needed. Wrap the single most important keyword or phrase per sentence in **double asterisks** for emphasis. Use clinical language. Do not repeat the item verbatim. No headers, no bullets, no markdown fences. Plain prose with **bold markers** only.`;

    const gptOssExpandPrompt = `You are a medical educator expanding a single study point for a medical student.

Topic: ${enhanceTopic}
Section: ${sectionKey}
Item: "${itemText}"
Other items in section: ${Array.isArray(sectionItems) ? sectionItems.join(" | ") : ""}

Write EXACTLY 2-3 sentences on the mechanism. Maximum 60 words. Bold the most important keyword per sentence using **double asterisks**. Plain prose only.`;

    const haikuClinicalPrompt = `You are a senior clinician connecting a study point to real bedside practice.

The student is reviewing a "${sectionKey}" item from a study sheet on "${enhanceTopic}".

The specific item:
"${itemText}"

Write EXACTLY 2 sentences: (1) a brief patient presentation where this item is directly relevant, (2) the clinical decision it drives and why. Maximum 50 words total. Bold the key clinical term per sentence using **double asterisks**. Plain prose only, no headers, no bullets.`;

    const gptOssClinicalPrompt = `You are a clinician tying a study point to a real patient scenario.

Topic: ${enhanceTopic}
Item: "${itemText}"

Write EXACTLY 2 sentences: patient presentation + clinical decision it drives. Maximum 50 words. Bold the key term per sentence using **double asterisks**. Plain prose only.`;

    const haikuCardsPrompt = (count: number) => `You are a medical educator. Generate exactly ${count} USMLE-style flashcards on the given topic.

Mode: ${mode} | Difficulty: ${diff}

${groundingContextBlock}

INPUT HANDLING:
The user input may be one of three types:
1. Raw medical notes — extract the core topic(s) and generate flashcards based on them.
2. A study request (e.g., "I want to study myocardial infarction") — interpret as a request to generate flashcards on that topic.
3. A direct topic name (e.g., "Nephrotic syndrome") — treat as the topic directly.

Internally normalize the input into a clear medical topic, then generate the flashcards below.

OUTPUT FORMAT — copy this structure exactly:

FLASHCARDS

[one emoji representing the topic on its own line]

Q: [Mechanism][Grounded] Question text ending with question mark?
A: Answer in 1-2 sentences maximum.

Q: [Next Step][General] Question for a topic not in the context?
A: Answer.

[blank line between every card — this is mandatory]

TAGS (pick one per card): [Diagnosis] [Mechanism] [Next Step] [Complication] [Association]

SOURCING TAG (mandatory, second bracket on every Q: line):
- [Grounded] — if this card's content comes directly from the Context above
- [General]  — if no retrieved context covers this card's content

If no Context was provided, every card must be tagged [General].

EMOJI: Pick one that matches the topic — 🫀 cardiac, 🩸 hematology, 🧠 neuro, 🫁 pulmonary, 🦴 ortho, 🩺 general, 💊 pharmacology, 🧬 genetics, 👁️ ophthalmology, 🤰 OB/GYN, 👶 pediatrics, 🧫 micro, ⚗️ biochem, 🩹 trauma, 🛡️ immunology

HARD RULES:
- Exactly ${count} cards. No more, no less.
- Each card: Q: on one line, A: on next line, blank line after.
- Tags in square brackets at start of every Q: line.
- Every Q: line must have exactly two bracket tags: one clinical tag, one sourcing tag.
- Questions end with ?
- Answers: 1-2 sentences only — never more.
- No "Q:" or "A:" anywhere inside question or answer text.
- No numbering. No headers between cards. No explanations.
- Mix clinical vignettes and concept recall cards.`;

    const haikuSheetPrompt = `${audienceBlock(mode, diff, len)}

INPUT HANDLING:
The user input may be one of three types:
1. Raw medical notes — extract the core topic(s) and generate study material based on them.
2. A study request (e.g., "I want to study myocardial infarction") — interpret as a request to generate high-yield study material on that topic.
3. A direct topic name (e.g., "Nephrotic syndrome") — treat as the topic directly.

Internally normalize the input into a clear medical topic or concept, then generate the full output below.

MODE RULES:
- USMLE Step 1: Focus on mechanisms, pathophysiology, biochemical pathways, and classic associations.
- USMLE Step 2: Focus on diagnosis, clinical management, next best steps, and patient scenarios.
- General: Provide a balanced clinical overview.

DIFFICULTY RULES:
- Basic: simple language, minimal jargon, define key terms, suitable for early med students.
- Intermediate: assume Year 3-4 medical student level, standard terminology.
- Advanced: clinician-level depth, full technical terminology, include nuanced distinctions.

LENGTH RULES:
- Concise: minimum viable information, ultra-scannable, shortest possible output.
- Moderate: balanced detail, cover all sections adequately.
- Detailed: expand every section fully, include edge cases and nuances.

${sheetSchemaBlock}`;

    const userContent = enhanceMode
      ? `Topic: ${enhanceTopic}\nSection: ${sectionKey}\nItem: ${itemText}`
      : focusCard && !cardsOnly
      ? `Focus specifically on this concept: ${focusCard}\n\nTopic: ${notes}`
      : notes;

    // ── PROMPT SELECTION ───────────────────────────────────────────────────
    const isHaiku = input.family === "haiku";

    if (enhanceMode === "expand") {
      systemPrompt = isHaiku ? haikuExpandPrompt : gptOssExpandPrompt;
    } else if (enhanceMode === "clinical") {
      systemPrompt = isHaiku ? haikuClinicalPrompt : gptOssClinicalPrompt;
    } else if (explainMode) {
      systemPrompt = isHaiku ? haikuExplainPrompt : gptOssExplainPrompt;
    } else if (cardsOnly) {
      // Floor is 3, not 5: a sheet's own deck is 3 cards at Concise. The
      // standalone deck builder still only offers 5-20.
      const count = Math.min(Math.max(parseInt(String(cardCount)) || 12, 3), 20);
      systemPrompt = isHaiku ? haikuCardsPrompt(count) : gptOssCardsPrompt(count);
    } else {
      systemPrompt = isHaiku ? haikuSheetPrompt : gptOssSheetPrompt;
    }

    // Only when there is history to resolve against — the instruction would
    // otherwise point the model at prior turns that don't exist.
    if (input.hasMemory) {
      systemPrompt += MEMORY_FOLLOWUP_INSTRUCTION;
    }

    return { systemPrompt, userContent };
}
