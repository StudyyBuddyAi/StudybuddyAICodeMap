import { describe, it, expect } from "vitest";
import {
  allowedSetSizes,
  examBlockFor,
  FREE_DAILY_QBANK_QUESTIONS,
} from "../../supabase/functions/_shared/qbank-allowance.ts";

const SIZES = [5, 10, 15, 20];

describe("allowedSetSizes", () => {
  it("offers every size to an unlimited account", () => {
    expect(allowedSetSizes(null, SIZES)).toEqual(SIZES);
  });

  it("drops sizes the free allowance cannot cover", () => {
    expect(FREE_DAILY_QBANK_QUESTIONS).toBe(10);
    expect(allowedSetSizes(10, SIZES)).toEqual([5, 10]);
  });

  it("offers what is left when it falls between the fixed sizes", () => {
    expect(allowedSetSizes(7, SIZES)).toEqual([5, 7]);
    expect(allowedSetSizes(3, SIZES)).toEqual([3]);
  });

  it("offers nothing once the day is used up", () => {
    expect(allowedSetSizes(0, SIZES)).toEqual([]);
    expect(allowedSetSizes(-2, SIZES)).toEqual([]);
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
