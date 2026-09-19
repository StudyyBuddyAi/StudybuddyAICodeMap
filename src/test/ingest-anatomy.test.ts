import { describe, it, expect } from "vitest";
import {
  extractLabels,
  aspectFromViewBox,
  parseName,
} from "../../scripts/ingest-anatomy.js";

const svg = (inner: string, attrs = 'viewBox="0 0 400 900"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe("extractLabels", () => {
  it("reads structure names printed as real text", () => {
    const out = extractLabels(
      svg('<text x="1" y="2">Glomerulus</text><text x="3" y="4">Loop of Henle</text>')
    );
    expect(out).toEqual(["Glomerulus", "Loop of Henle"]);
  });

  it("returns nothing when the labels were converted to outlines", () => {
    // The common case in published illustrations: labels are <path> geometry,
    // not text. The panel falls back to a free-text box.
    expect(extractLabels(svg('<path d="M0 0 L10 10"/>'))).toEqual([]);
  });

  it("flattens nested tspans into one label", () => {
    const out = extractLabels(
      svg("<text><tspan>Proximal</tspan> <tspan>convoluted tubule</tspan></text>")
    );
    expect(out).toEqual(["Proximal convoluted tubule"]);
  });

  it("collapses whitespace and newlines inside a label", () => {
    expect(extractLabels(svg("<text>\n  Bowman's\n  capsule\n</text>"))).toEqual([
      "Bowman's capsule",
    ]);
  });

  it("de-duplicates repeated labels", () => {
    expect(extractLabels(svg("<text>Aorta</text><text>Aorta</text>"))).toEqual(["Aorta"]);
  });

  it("drops single characters and anything over 60 chars", () => {
    const long = "x".repeat(61);
    expect(extractLabels(svg(`<text>A</text><text>${long}</text>`))).toEqual([]);
  });

  it("also picks up captions and credits, which curation must prune", () => {
    // Documented, not desired: the regex cannot tell a structure name from a
    // figure caption, so chips may need manual pruning.
    expect(extractLabels(svg("<text>Figure 3 — after Gray's Anatomy</text>"))).toEqual([
      "Figure 3 — after Gray's Anatomy",
    ]);
  });
});

describe("extractLabels — multilingual illustrations", () => {
  const sw = (inner: string) => svg(`<switch>${inner}</switch>`);

  it("keeps the untagged English fallback and drops the translations", () => {
    // Wikimedia's pattern: one <text> per language inside a <switch>, plus an
    // untagged fallback. Without filtering, one diagram yields its whole label
    // set once per language — 106 chips instead of 35 on a real file.
    const out = extractLabels(
      sw(
        '<text systemLanguage="eu">Parotida</text>' +
          '<text systemLanguage="ml">Malayalam</text>' +
          "<text>Parotid</text>"
      )
    );
    expect(out).toEqual(["Parotid"]);
  });

  it("keeps text explicitly tagged English, including region variants", () => {
    const out = extractLabels(
      sw('<text systemLanguage="en">Liver</text><text systemLanguage="fr">Foie</text>') +
        svg('<text systemLanguage="en-GB,en-US">Oesophagus</text>')
    );
    expect(out).toContain("Liver");
    expect(out).toContain("Oesophagus");
    expect(out).not.toContain("Foie");
  });

  it("does not mistake a language prefix for English", () => {
    expect(extractLabels(sw('<text systemLanguage="eng-x">X</text>'))).toEqual([]);
  });

  it("still returns fragments when the source splits a label across nodes", () => {
    // Real limitation, documented rather than hidden: "Small intestine" is two
    // text nodes at different positions, and no regex can rejoin them.
    expect(extractLabels(svg("<text>Small</text><text>intestine</text>"))).toEqual([
      "Small",
      "intestine",
    ]);
  });
});

describe("aspectFromViewBox", () => {
  it("reads a tall ratio from the viewBox", () => {
    expect(aspectFromViewBox(svg("", 'viewBox="0 0 400 900"'))).toBeCloseTo(0.4444, 4);
  });

  it("reads a wide ratio from the viewBox", () => {
    expect(aspectFromViewBox(svg("", 'viewBox="0 0 800 600"'))).toBeCloseTo(1.3333, 4);
  });

  it("tolerates a negative origin and extra whitespace", () => {
    expect(aspectFromViewBox(svg("", 'viewBox=" -10 -20  400 200 "'))).toBeCloseTo(2, 4);
  });

  it("falls back to width and height when there is no viewBox", () => {
    expect(aspectFromViewBox(svg("", 'width="300" height="600"'))).toBeCloseTo(0.5, 4);
  });

  it("returns null when neither is declared, so the client uses its default", () => {
    expect(aspectFromViewBox(svg("", 'id="x"'))).toBeNull();
  });

  it("returns null rather than Infinity for a zero height", () => {
    expect(aspectFromViewBox(svg("", 'viewBox="0 0 400 0"'))).toBeNull();
  });
});

describe("parseName", () => {
  it("splits organ, view and detail on underscores", () => {
    expect(parseName("heart_anterior_chambers.svg")).toEqual({
      organ: "heart",
      view: "anterior",
      title: "heart anterior chambers",
    });
  });

  it("keeps a hyphenated view intact", () => {
    // Splitting on hyphens too would read "cross" as the view and strand
    // "section" into the title.
    expect(parseName("nephron_cross-section_tubules.svg")).toEqual({
      organ: "nephron",
      view: "cross-section",
      title: "nephron cross-section tubules",
    });
  });

  it("handles a name with no view", () => {
    expect(parseName("brain.svg")).toEqual({
      organ: "brain",
      view: null,
      title: "brain",
    });
  });

  it("treats a hyphenated single segment as one organ", () => {
    expect(parseName("nephron-placeholder.svg")).toEqual({
      organ: "nephron-placeholder",
      view: null,
      title: "nephron-placeholder",
    });
  });

  it("does not crash on a malformed name", () => {
    expect(parseName("___.svg").organ).toBe("unknown");
  });
});
