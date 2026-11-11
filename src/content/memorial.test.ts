import { describe, expect, it } from "vitest";
import { MEMORIAL, memorialComplete } from "./memorial";

describe("the memorial's content", () => {
  it("keeps the family's order: father, mother, brother", () => {
    expect(MEMORIAL.tributes.map((t) => t.name)).toEqual([
      "Dr. Ibrahim Mustafa Shihada",
      "Ruwaida Muhammad Hussein",
      "Dr. Mustafa Ibrahim Shihada",
    ]);
  });

  it("writes the years with an en dash", () => {
    expect(MEMORIAL.tributes.map((t) => t.years)).toEqual(["1953 – 2024", "1960 – 2018", "1987 – 2025"]);
    for (const t of MEMORIAL.tributes) expect(t.years).toMatch(/^\d{4} – \d{4}$/);
  });

  it("keeps the paragraph breaks as written", () => {
    expect(MEMORIAL.tributes.map((t) => t.paragraphs.length)).toEqual([4, 4, 5]);
  });

  it("never says 'died'", () => {
    const all = [MEMORIAL.heading, ...MEMORIAL.tributes.flatMap((t) => [t.name, ...t.paragraphs])].join(" ");
    expect(all).not.toMatch(/\bdied\b/i);
  });
});

describe("memorialComplete", () => {
  it("is complete with the real words in, photos or not", () => {
    expect(MEMORIAL.tributes.every((t) => t.photo === null)).toBe(true);
    expect(memorialComplete(MEMORIAL)).toBe(true);
  });

  it("holds the memorial back while any placeholder is left", () => {
    const draft = structuredClone(MEMORIAL);
    draft.tributes[1].paragraphs[2] = "[Your words]";
    expect(memorialComplete(draft)).toBe(false);
    expect(memorialComplete({ ...MEMORIAL, heading: "[Heading]" })).toBe(false);
  });
});
