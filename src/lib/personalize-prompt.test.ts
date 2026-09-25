import { describe, it, expect } from "vitest";
import {
  PERSONALIZE_LIMITS,
  buildPersonalizePrompt,
  parsePersonalizeRequest,
} from "../../supabase/functions/_shared/personalize.ts";

const GRANT = "0b8f6c2e-5a1d-4c3e-9f7a-2d4b6e8a1c3f";

describe("parsePersonalizeRequest", () => {
  it("accepts each action with what it needs", () => {
    expect(parsePersonalizeRequest({ action: "rewrite", style: "simplify", text: "A line." })).toEqual({
      action: "rewrite",
      style: "simplify",
      text: "A line.",
    });
    expect(parsePersonalizeRequest({ action: "card", text: "A line.", focus: "line" })?.focus).toBe("line");
    expect(parsePersonalizeRequest({ action: "explain", text: "A line.", grant: GRANT })?.grant).toBe(GRANT);
  });

  it("refuses anything it cannot run", () => {
    expect(parsePersonalizeRequest(null)).toBeNull();
    expect(parsePersonalizeRequest({ action: "summarize", text: "x" })).toBeNull();
    expect(parsePersonalizeRequest({ action: "rewrite", text: "x" })).toBeNull(); // no style
    expect(parsePersonalizeRequest({ action: "rewrite", style: "custom", text: "x" })).toBeNull(); // no instruction
    expect(parsePersonalizeRequest({ action: "card", text: "   " })).toBeNull();
  });

  it("caps every field, drops a malformed grant, and ignores a focus that is the whole line", () => {
    const req = parsePersonalizeRequest({
      action: "rewrite",
      style: "custom",
      instruction: "x".repeat(500),
      text: "y".repeat(5000),
      focus: "y".repeat(5000),
      grant: "not-a-uuid",
    })!;
    expect(req.instruction).toHaveLength(PERSONALIZE_LIMITS.instruction);
    expect(req.text).toHaveLength(PERSONALIZE_LIMITS.text);
    expect(req.focus).toHaveLength(PERSONALIZE_LIMITS.focus);
    expect(req.grant).toBeUndefined();
    expect(parsePersonalizeRequest({ action: "card", text: "same", focus: "same" })?.focus).toBeUndefined();
  });
});

describe("buildPersonalizePrompt", () => {
  it("asks a rewrite for one line that keeps its label", () => {
    const p = buildPersonalizePrompt(
      { action: "rewrite", style: "simplify", text: "Management: IV insulin.", sectionTitle: "Clinical Approach", topic: "DKA" },
      { examMode: "USMLE Step 2", difficulty: "Basic" }
    );
    expect(p.systemPrompt).toContain('study sheet on "DKA" (USMLE Step 2, Basic)');
    expect(p.systemPrompt).toContain("keep that label");
    // The section is marked as context, so it isn't copied into the rewrite.
    expect(p.userContent).toBe(
      '(From the section "Clinical Approach". Context only — not part of the line.)\nLine to rewrite:\nManagement: IV insulin.'
    );
  });

  it("with a selection, still rewrites the whole line", () => {
    const p = buildPersonalizePrompt({ action: "rewrite", style: "simplify", text: "A and B.", focus: "B" });
    expect(p.systemPrompt).toContain("rewrite the WHOLE line");
  });

  it("carries a custom instruction verbatim", () => {
    const p = buildPersonalizePrompt({ action: "rewrite", style: "custom", instruction: "make it rhyme", text: "x" });
    expect(p.systemPrompt).toContain('"make it rhyme"');
  });

  it("asks a card about the selected passage, in the Q:/A: shape the app parses", () => {
    const p = buildPersonalizePrompt({ action: "card", text: "Full line about potassium.", focus: "potassium" });
    expect(p.systemPrompt).toContain("Q: <");
    expect(p.systemPrompt).toContain("A: <");
    expect(p.userContent.startsWith("Passage: potassium")).toBe(true);
  });

  it("ends an explanation on a check question", () => {
    expect(buildPersonalizePrompt({ action: "explain", text: "x" }).systemPrompt).toContain('"Check:"');
  });
});
