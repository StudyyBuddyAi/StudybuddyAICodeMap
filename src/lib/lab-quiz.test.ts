import { describe, it, expect } from "vitest";
import { LAB_RANGES, formatLabValue, makeLabQuizItem, parseLabRange } from "./lab-quiz";

const seeded = (seed = 5) => {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
};

describe("parseLabRange", () => {
  it("reads two-sided ranges with units, decimals and thousands separators", () => {
    expect(parseLabRange({ name: "K", conventional: "3.5–5.0 mEq/L" })).toMatchObject({ low: 3.5, high: 5, unit: "mEq/L", decimals: 1 });
    expect(parseLabRange({ name: "WBC", conventional: "4,500–11,000/mm³" })).toMatchObject({ low: 4500, high: 11000, decimals: 0 });
    expect(parseLabRange({ name: "pH", conventional: "7.35–7.45" })).toMatchObject({ low: 7.35, high: 7.45, unit: "", decimals: 2 });
  });

  it("leaves out one-sided and non-range values", () => {
    expect(parseLabRange({ name: "LDL", conventional: "< 130 mg/dL" })).toBeNull();
    expect(parseLabRange({ name: "A1c", conventional: "≤ 6%" })).toBeNull();
    expect(parseLabRange({ name: "BMI", conventional: "weight (kg) ÷ height (m)²" })).toBeNull();
  });

  it("finds plenty of ranges in the lab panel", () => {
    expect(LAB_RANGES.length).toBeGreaterThan(50);
  });
});

describe("makeLabQuizItem", () => {
  it("always grades the value the student sees against the range", () => {
    const random = seeded();
    for (let i = 0; i < 500; i++) {
      const item = makeLabQuizItem(random);
      const { low, high } = item.range;
      const expected = item.value < low ? "low" : item.value > high ? "high" : "normal";
      expect(item.answer).toBe(expected);
      expect(item.valueLabel.length).toBeGreaterThan(0);
    }
  });

  it("asks all three answers over a round", () => {
    const random = seeded(9);
    const seen = new Set(Array.from({ length: 60 }, () => makeLabQuizItem(random).answer));
    expect(seen).toEqual(new Set(["low", "normal", "high"]));
  });

  it("formats like the published range", () => {
    const wbc = parseLabRange({ name: "WBC", conventional: "4,500–11,000/mm³" })!;
    expect(formatLabValue(14250, wbc)).toBe("14,250");
    const k = parseLabRange({ name: "K", conventional: "3.5–5.0 mEq/L" })!;
    expect(formatLabValue(6.14, k)).toBe("6.1");
  });
});
