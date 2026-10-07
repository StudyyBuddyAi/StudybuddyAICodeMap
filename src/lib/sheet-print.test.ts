import { describe, it, expect } from "vitest";
import type { GeneratedSheet, SheetSource } from "@/types/generated-sheet";
import { emptyLayer, type SheetLayer } from "@/lib/sheet-layer";
import {
  DEFAULT_PRINT_OPTIONS,
  buildPrintModel,
  buildReferences,
  cssString,
  exportFileName,
  toSpans,
  type PrintOptions,
} from "@/lib/sheet-print";

/**
 * The exported sheet is built as data before it is rendered, so what reaches
 * paper — which lines, whose edits, which marks — is checked here.
 */

const sheet: GeneratedSheet = {
  topic: "Heart Failure",
  topicEmoji: "🫀",
  plan: [
    { key: "overview", title: "Overview", kind: "prose" },
    { key: "keyPoints", title: "Key Points", kind: "list" },
    { key: "drugs", title: "Drugs", kind: "table", columns: ["Drug", "Effect"] },
  ],
  sections: {
    overview: "Definition: The heart **cannot meet** demand.\n\nCause: Ischaemic heart disease is the commonest.",
    keyPoints: ["BNP rises early", "Loop diuretics relieve **congestion**"],
    drugs: [
      ["Furosemide", "Offloads fluid"],
      ["Bisoprolol", "Improves survival"],
    ],
  },
  overview: "",
  memoryHooks: [],
  clinicalApproach: "",
  keyPoints: [],
  examTraps: [],
  flashcards: [{ tag: "Mechanism", question: "Why does BNP rise?", answer: "Ventricular stretch." }],
  referenceNote: "Based on: NICE NG106.",
};

const context = {
  topic: "heart failure",
  examMode: "USMLE Step 2",
  difficulty: "Advanced",
  depth: "highYield" as const,
  date: new Date("2026-10-07T12:00:00Z"),
};

const build = (opts: Partial<PrintOptions> = {}, layer: SheetLayer | null = null) =>
  buildPrintModel(sheet, layer, { ...DEFAULT_PRINT_OPTIONS, ...opts }, context);

describe("buildPrintModel", () => {
  it("lays the plan out in order, numbered, with labels lifted off prose lines", () => {
    const m = build();
    expect(m.title).toBe("Heart Failure");
    expect(m.sections.map((s) => [s.number, s.title, s.kind])).toEqual([
      [1, "Overview", "prose"],
      [2, "Key Points", "list"],
      [3, "Drugs", "table"],
    ]);
    const [first] = m.sections[0].lines;
    expect(first.label).toBe("Definition");
    expect(first.spans).toEqual([{ text: "The heart " }, { text: "cannot meet", bold: true }, { text: " demand." }]);
    // The blank line between prose paragraphs is not a line.
    expect(m.sections[0].lines).toHaveLength(2);
    expect(m.sections[2].rows[1][0]).toEqual([{ text: "Bisoprolol" }]);
    expect(m.meta).toMatchObject({ examMode: "USMLE Step 2", depth: "High-yield", date: "7 October 2026" });
  });

  it("leaves out excluded sections and renumbers the rest", () => {
    const m = build({ excluded: ["keyPoints"] });
    expect(m.sections.map((s) => [s.number, s.key])).toEqual([
      [1, "overview"],
      [2, "drugs"],
    ]);
  });

  it("prints the student's sheet: edits, removals, additions, notes and highlights", () => {
    const layer: SheetLayer = {
      ...emptyLayer(),
      edits: {
        "keyPoints:0": { anchor: "keyPoints:0", text: "BNP rises with wall stress", source: "user", original: "BNP rises early", at: "" },
      },
      hidden: ["overview:2"],
      additions: [{ id: "a", section: "keyPoints", text: "Check potassium on spironolactone", source: "user", at: "" }],
      notes: [{ id: "n", anchor: "keyPoints:1", text: "Watch the creatinine", source: "user", at: "" }],
      highlights: [{ id: "h", anchor: "keyPoints:1", quote: "relieve congestion", occurrence: 0, intent: "memorize", at: "" }],
      cards: [{ id: "c", question: "First-line diuretic?", answer: "Furosemide", anchor: "keyPoints:1", at: "" }],
    };
    const m = build({}, layer);
    expect(m.hasMine).toBe(true);
    expect(m.sections[0].lines).toHaveLength(1); // the Cause line was removed
    const [edited, marked, added] = m.sections[1].lines;
    expect(edited).toMatchObject({ mine: "edited", spans: [{ text: "BNP rises with wall stress" }] });
    expect(marked.notes).toEqual([{ text: "Watch the creatinine", ai: false }]);
    expect(marked.spans).toEqual([
      { text: "Loop diuretics " },
      { text: "relieve ", mark: "memorize" },
      { text: "congestion", bold: true, mark: "memorize" },
    ]);
    expect(added).toMatchObject({ mine: "added" });
    expect(m.cards.map((c) => c.mine)).toEqual([false, true]);

    // Turned off, none of it reaches paper.
    const plain = build({ mine: false }, layer);
    expect(plain.hasMine).toBe(false);
    expect(plain.sections[1].lines).toHaveLength(2);
    expect(plain.cards).toHaveLength(1);
  });

  it("drops cards and references when asked to", () => {
    const m = build({ cards: "omit", sources: "omit" });
    expect(m.cards).toEqual([]);
    expect(m.referenceNote).toBe("");
    expect(m.references).toEqual([]);
  });
});

describe("toSpans", () => {
  it("keeps a highlight that crosses a bold run whole", () => {
    expect(toSpans("a **bc** d", [{ start: 1, end: 4, intent: "key" }])).toEqual([
      { text: "a" },
      { text: " ", mark: "key" },
      { text: "bc", bold: true, mark: "key" },
      { text: " d" },
    ]);
  });
});

describe("buildReferences", () => {
  const src = (over: Partial<SheetSource>): SheetSource => ({
    id: Math.random().toString(36),
    guidelineName: "nelson.pdf",
    sectionTitle: null,
    sourceUrl: null,
    similarity: 0.8,
    content: "Text.",
    ...over,
  });

  it("numbers one reference per book, with its chapters and printed pages", () => {
    const refs = buildReferences(
      [
        src({ book: "Nelson Textbook of Pediatrics", chapter: "Chapter 469 — Heart Failure", sectionTitle: "x › 2301", chunkIndex: 2 }),
        src({ book: "Nelson Textbook of Pediatrics", chapter: "Chapter 469 — Heart Failure", chunkIndex: 1 }),
        src({ guidelineName: "nice.pdf", book: "NICE NG106", similarity: 0.6, sourceUrl: "https://nice.org.uk/ng106" }),
      ],
      false
    );
    expect(refs.map((r) => [r.number, r.title])).toEqual([
      [1, "Nelson Textbook of Pediatrics"],
      [2, "NICE NG106"],
    ]);
    expect(refs[0].chapters).toHaveLength(1);
    expect(refs[0].chapters[0].heading).toBe("Chapter 469 — Heart Failure");
    expect(refs[1].url).toBe("https://nice.org.uk/ng106");
  });
});

describe("export helpers", () => {
  it("makes a file name the Save dialog can use", () => {
    expect(exportFileName('Heart: "failure" / HFrEF', new Date("2026-10-07T00:00:00Z"))).toBe(
      "Heart failure HFrEF — StudyBuddy sheet 2026-10-07"
    );
  });

  it("escapes a title for a CSS content string", () => {
    expect(cssString('A "quoted" \\ title\nnext')).toBe('"A \\"quoted\\" \\\\ title next"');
  });
});
