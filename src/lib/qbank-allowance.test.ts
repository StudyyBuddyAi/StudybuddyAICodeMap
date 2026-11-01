import { describe, it, expect } from "vitest";
import {
  examBlockFor,
  FREE_DAILY_QBANK_QUESTIONS,
  largestSetSize,
} from "../../supabase/functions/_shared/qbank-allowance.ts";

describe("largestSetSize", () => {
  it("gives an unlimited account the whole block", () => {
    expect(largestSetSize(null, 20)).toBe(20);
  });

  it("stops at what a free account has left", () => {
    expect(FREE_DAILY_QBANK_QUESTIONS).toBe(10);
    expect(largestSetSize(10, 20)).toBe(10);
    expect(largestSetSize(7, 20)).toBe(7);
    expect(largestSetSize(3.6, 20)).toBe(3);
  });

  it("never goes past the block", () => {
    expect(largestSetSize(25, 20)).toBe(20);
  });

  it("is zero once the day is used up", () => {
    expect(largestSetSize(0, 20)).toBe(0);
    expect(largestSetSize(-2, 20)).toBe(0);
  });
});

describe("examBlockFor", () => {
  it("is the full 20-question, 30-minute USMLE block for Pro", () => {
    expect(examBlockFor(null)).toEqual({ size: 20, minutes: 30 });
  });

  it("is a 10-question, 15-minute half block on the free plan", () => {
    expect(examBlockFor(10)).toEqual({ size: 10, minutes: 15 });
  });

  it("never asks a free account for more than it has left", () => {
    expect(examBlockFor(7)).toEqual({ size: 7, minutes: 10.5 });
    expect(examBlockFor(0)).toBeNull();
  });
});
