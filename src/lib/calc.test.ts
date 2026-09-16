import { describe, it, expect } from "vitest";
import { evaluate, formatResult } from "./calc";

describe("evaluate", () => {
  it("respects precedence and parentheses", () => {
    expect(evaluate("2+3×4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("10 − 4 − 3")).toBe(3);
    expect(evaluate("100÷5÷2")).toBe(10);
  });

  it("handles unary minus and percent", () => {
    expect(evaluate("-3+5")).toBe(2);
    expect(evaluate("2*-3")).toBe(-6);
    expect(evaluate("--4")).toBe(4);
    expect(evaluate("50%*80")).toBe(40);
  });

  it("works for the arithmetic a vignette actually asks for", () => {
    // Anion gap: Na − (Cl + HCO3)
    expect(evaluate("140-(104+24)")).toBe(12);
    // BMI: 70 kg / 1.75 m²
    expect(formatResult(evaluate("70/(1.75*1.75)")!)).toBe("22.8571428571");
  });

  it("returns null instead of throwing on bad input", () => {
    expect(evaluate("")).toBeNull();
    expect(evaluate("4/0")).toBeNull();
    expect(evaluate("2+")).toBeNull();
    expect(evaluate("(2+3")).toBeNull();
    expect(evaluate("2+3)")).toBeNull();
    expect(evaluate("1..2")).toBeNull();
    expect(evaluate("alert(1)")).toBeNull();
  });
});

describe("formatResult", () => {
  it("hides floating-point noise", () => {
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
  });
});
