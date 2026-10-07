import { describe, it, expect } from "vitest";
import JSZip from "jszip"; // docx's own zip library
import { Packer } from "docx";
import type { GeneratedSheet } from "@/types/generated-sheet";
import { emptyLayer, type SheetLayer } from "@/lib/sheet-layer";
import { buildSheetDocument } from "@/lib/sheet-docx";
import { DEFAULT_PRINT_OPTIONS, buildPrintModel, type PrintOptions } from "@/lib/sheet-print";

/**
 * The Word export is checked as Word sees it: the XML inside the .docx.
 */

const sheet: GeneratedSheet = {
  topic: "Heart Failure",
  plan: [
    { key: "overview", title: "Overview", kind: "prose" },
    { key: "keyPoints", title: "Key Points", kind: "list" },
    { key: "drugs", title: "Drugs", kind: "table", columns: ["Drug", "Effect"] },
  ],
  sections: {
    overview: "Definition: The heart **cannot meet** demand.",
    keyPoints: ["BNP rises early", "Loop diuretics relieve congestion"],
    drugs: [["Furosemide", "Offloads fluid"]],
  },
  overview: "",
  memoryHooks: [],
  clinicalApproach: "",
  keyPoints: [],
  examTraps: [],
  flashcards: [{ tag: "Mechanism", question: "Why does BNP rise?", answer: "Ventricular stretch." }],
  referenceNote: "Based on: NICE NG106.",
  sources: [
    {
      id: "s1",
      guidelineName: "nice.pdf",
      book: "NICE NG106",
      sectionTitle: null,
      sourceUrl: "https://www.nice.org.uk/guidance/ng106",
      similarity: 0.8,
      content: "Offer a loop diuretic.",
    },
  ],
};

const context = { topic: "", examMode: "General", difficulty: "Advanced", depth: "highYield" as const, date: new Date("2026-10-07") };

async function docXml(opts: Partial<PrintOptions> = {}, layer: SheetLayer | null = null) {
  const options = { ...DEFAULT_PRINT_OPTIONS, ...opts };
  const doc = await buildSheetDocument(buildPrintModel(sheet, layer, options, context), options);
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const files = Object.keys(zip.files);
  const read = (name: string) => zip.file(name)!.async("string");
  const footers = await Promise.all(files.filter((f) => /word\/footer\d+\.xml/.test(f)).map(read));
  return { document: await read("word/document.xml"), footers: footers.join("\n") };
}

describe("buildSheetDocx", () => {
  it("writes a real Word document: headings, labelled lines, tables, cards, references", async () => {
    const { document, footers } = await docXml();
    expect(document).toContain("Heart Failure");
    expect(document).toContain('w:val="Heading1"'); // one outline level: Word's navigation pane lists every part
    expect(document).toContain("Definition\t");
    expect(document).toContain("cannot meet");
    expect(document).toContain("<w:tblHeader"); // the table's header row repeats across pages
    expect(document).toContain("Furosemide");
    expect(document).toContain("Why does BNP rise?");
    expect(document).toContain("NICE NG106");
    expect(document).toContain("not a substitute for clinical judgment");
    expect(footers).toMatch(/NUMPAGES/);
    expect(footers).toMatch(/PAGE/);
  });

  it("prints a quiz with an answer key, and a two-column body for a cram sheet", async () => {
    const { document } = await docXml({ cards: "quiz", layout: "revision" });
    expect(document).toContain("Self-test");
    expect(document).toContain("Answer key");
    expect(document).toMatch(/<w:cols [^>]*w:num="2"/);
  });

  it("marks the student's highlights, as fills or, in ink-saver, as underlines", async () => {
    const layer: SheetLayer = {
      ...emptyLayer(),
      highlights: [{ id: "h", anchor: "keyPoints:0", quote: "BNP", occurrence: 0, intent: "confusing", at: "" }],
    };
    expect((await docXml({}, layer)).document).toContain('w:fill="FBE3C2"');
    expect((await docXml({ inkSaver: true }, layer)).document).toMatch(/<w:u w:val="wave"/);
  });

  it("leaves out what was turned off", async () => {
    const { document } = await docXml({ cards: "omit", sources: "omit", excluded: ["drugs"] });
    expect(document).not.toContain("Why does BNP rise?");
    expect(document).not.toContain("NICE NG106");
    expect(document).not.toContain("Furosemide");
  });
});
