import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

/** A JPEG's width and height, from its start-of-frame marker. */
function jpegSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  for (let i = 2; i < b.length - 9; ) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`no frame size in ${file}`);
}

describe("the memorial's photos", () => {
  const all = MEMORIAL.tributes.flatMap((t) => t.photos.map((p) => ({ t, p })));

  it("gives every tribute its photos", () => {
    expect(MEMORIAL.tributes.map((t) => t.photos.length)).toEqual([2, 1, 4]);
  });

  it("points at files that exist, with the shape they really have", () => {
    for (const { p } of all) {
      const file = path.join(process.cwd(), "public", p.src);
      expect(existsSync(file), p.src).toBe(true);
      const { w, h } = jpegSize(file);
      expect(Math.abs(w / h - p.aspect), p.src).toBeLessThan(0.002);
    }
  });

  it("names, for a screen reader, only people the tributes name", () => {
    const names = MEMORIAL.tributes.map((t) => t.name);
    for (const { t, p } of all) {
      expect(p.alt, p.src).toContain(t.name);
      const rest = p.alt.replace(t.name, "").replace(/^ and |^$/, "");
      if (rest) expect(names).toContain(rest);
    }
  });

  it("picks a cover photo that exists", () => {
    for (const t of MEMORIAL.tributes) expect(t.photos[t.cover ?? 0]).toBeDefined();
  });
});

describe("memorialComplete", () => {
  it("is complete with the real words in", () => {
    expect(memorialComplete(MEMORIAL)).toBe(true);
  });

  it("holds the memorial back while any placeholder is left", () => {
    const draft = structuredClone(MEMORIAL);
    draft.tributes[1].paragraphs[2] = "[Your words]";
    expect(memorialComplete(draft)).toBe(false);
    expect(memorialComplete({ ...MEMORIAL, heading: "[Heading]" })).toBe(false);
  });
});
