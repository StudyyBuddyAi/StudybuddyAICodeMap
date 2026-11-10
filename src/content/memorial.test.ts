import { describe, expect, it } from "vitest";
import { MEMORIAL, memorialComplete, type MemorialContent } from "./memorial";

/** The memorial as it would be once written: every word real, every photo in. */
const finished = (): MemorialContent => ({
  dedication: "In memory of my family and the classmates I lost in the war.",
  signature: "Osama",
  cards: MEMORIAL.cards.map((c) => ({
    ...c,
    names: "Names",
    line: "A line",
    text: ["Words."],
    roll: c.roll ? ["One", "Two"] : undefined,
    photo: `/memorial/${c.id}.jpg`,
  })),
});

describe("memorialComplete", () => {
  it("keeps the memorial unpublished while it still holds placeholders", () => {
    expect(memorialComplete(MEMORIAL)).toBe(false);
  });

  it("publishes once every word and photo is in", () => {
    expect(memorialComplete(finished())).toBe(true);
  });

  it("holds back for one missing photo", () => {
    const c = finished();
    c.cards[1] = { ...c.cards[1], photo: null };
    expect(memorialComplete(c)).toBe(false);
  });

  it("holds back for one placeholder anywhere, even in the class register", () => {
    const c = finished();
    c.cards[2] = { ...c.cards[2], roll: ["One", "[Name]"] };
    expect(memorialComplete(c)).toBe(false);
    expect(memorialComplete({ ...finished(), signature: "[Your name]" })).toBe(false);
  });
});
