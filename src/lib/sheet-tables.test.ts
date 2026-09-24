import { describe, it, expect } from "vitest";
import { parsePartialSheet, parseSheetOutput } from "./parse-partial-sheet";
import { bodyLines, isTableRows } from "./sheet-plan";
import { sheetToPlainText } from "./sheet-to-text";
import { schemaLine, tableRulesBlock } from "../../supabase/functions/_shared/sheet-schema.ts";
import { resolveSheetPlan } from "../../supabase/functions/_shared/sheet-plan.ts";
import type { GeneratedSheet } from "@/types/generated-sheet";

/**
 * Table sections end to end: the prompt asks for rows under fixed columns, the
 * parser keeps them as rows (mid-stream included), and everything that turns a
 * section back into text reads a row as its cells.
 */

const ROWS = [
  ["Pheochromocytoma", "Episodic **headache**, sweating", "Plasma metanephrines"],
  ["Thyroid storm", "Fever, **AF**", "TSH, free T4"],
];

describe("parsing table sections", () => {
  it("keeps rows as rows", () => {
    const parsed = parseSheetOutput(JSON.stringify({ topic: "HTN crisis", differentials: ROWS }));
    expect(parsed?.sheet.sections?.differentials).toEqual(ROWS);
  });

  it("keeps a row cut off mid-cell while streaming", () => {
    const raw = '{"topic":"HTN crisis","differentials":[["Pheochromocytoma","Episodic head';
    const result = parsePartialSheet(raw)!;
    expect(result.inFlightKey).toBe("differentials");
    expect(result.sheet.sections?.differentials).toEqual([["Pheochromocytoma", "Episodic head"]]);
  });

  it("keeps a row cut off between cells", () => {
    const raw = '{"topic":"HTN crisis","differentials":[["Pheochromocytoma",';
    expect(parsePartialSheet(raw)!.sheet.sections?.differentials).toEqual([["Pheochromocytoma"]]);
  });

  it("reads a model that wrote plain items as a list, not a table", () => {
    const parsed = parseSheetOutput(JSON.stringify({ differentials: ["Pheo", "Thyroid storm"] }));
    expect(parsed?.sheet.sections?.differentials).toEqual(["Pheo", "Thyroid storm"]);
    expect(isTableRows(parsed?.sheet.sections?.differentials)).toBe(false);
  });
});

describe("bodyLines", () => {
  it("reads a row as its cells", () => {
    expect(bodyLines(ROWS)[0]).toBe("Pheochromocytoma | Episodic **headache**, sweating | Plasma metanephrines");
  });
});

describe("exporting a table", () => {
  it("writes the header line, then a line per row", () => {
    const sheet: GeneratedSheet = {
      topic: "HTN crisis",
      plan: [
        {
          key: "differentials",
          title: "Differential Diagnosis",
          kind: "table",
          columns: ["Diagnosis", "Distinguishing feature", "Confirm with"],
        },
      ],
      sections: { differentials: ROWS },
      overview: "",
      memoryHooks: [],
      clinicalApproach: "",
      keyPoints: [],
      examTraps: [],
      flashcards: [],
      referenceNote: "",
    };
    expect(sheetToPlainText(sheet, "", "HTN crisis")).toContain(
      "Differential Diagnosis\nDiagnosis | Distinguishing feature | Confirm with\nPheochromocytoma | Episodic **headache**, sweating | Plasma metanephrines\nThyroid storm"
    );
  });
});

describe("prompting for tables", () => {
  const plan = (req: Parameters<typeof resolveSheetPlan>[0]) => resolveSheetPlan(req);

  it("shows a row skeleton that names each column", () => {
    const ddx = plan({ archetype: "condition", examMode: "USMLE Step 2" }).find((s) => s.key === "differentials")!;
    expect(schemaLine(ddx)).toBe(
      [
        '  "differentials": [',
        '    ["<Diagnosis>", "<Distinguishing feature>", "<Confirm with>"],',
        '    ["<...>", "<...>", "<...>"]',
        "  ],",
      ].join("\n")
    );
  });

  it("states the table rules only when the plan has a table", () => {
    expect(tableRulesBlock(plan({ archetype: "condition", examMode: "USMLE Step 2" }))).toContain("TABLE SECTIONS");
    // A table-free plan's prompt is exactly what it was before tables existed.
    expect(tableRulesBlock(plan({ archetype: "condition", examMode: "General" }))).toBe("");
  });

  it("names every table with its columns and brief", () => {
    const block = tableRulesBlock(plan({ archetype: "pathway", examMode: "USMLE Step 1" }));
    expect(block).toContain("- cofactors (Enzyme | Cofactor | Without it):");
    expect(block).toContain("- deficiencies (Deficiency | Accumulates | Disease):");
  });
});
