import { describe, expect, it } from "vitest";
import { MAX_DAILY_SHEETS, MAX_DAILY_CARDS } from "@/hooks/use-usage-limit";
import {
  ANON_CITATION_LIMIT,
  FREE_CITATION_LIMIT,
} from "@/hooks/use-citation-usage";
import {
  LIMITS,
  PRICING,
  formatLimit,
  formatPrice,
  isWithinLimit,
  limitFor,
  tierOf,
  type Tier,
} from "@/config/product";

/**
 * `src/config/product.ts` is what the UI *says*. The hooks below are what the
 * app actually *enforces*. If those two drift, the product goes back to telling
 * users one number while applying another — the exact defect product.ts exists
 * to remove.
 *
 * This test shipped before the hooks were rewired to read from product.ts, so
 * the rewiring landed on a green guard rather than creating the gap it exists to
 * close.
 *
 * Now that the hooks re-export from product.ts, the cross-source assertions are
 * near-tautological on their own — they only catch someone re-introducing a
 * divergent local constant. So the literal expectations below carry the real
 * weight: they pin the actual shipped numbers, and any change to the single
 * source has to be made deliberately, in two places, with the price and copy
 * consequences visible in the same diff.
 */
describe("product config parity with enforced limits", () => {
  it("pins the shipped daily allowances", () => {
    // Literals on purpose: after the hooks were rewired to read from config,
    // comparing config to hook proves nothing on its own.
    expect(LIMITS.sheets.free).toBe(5);
    expect(LIMITS.cards.free).toBe(5);
    expect(LIMITS.citations.anon).toBe(1);
    expect(LIMITS.citations.free).toBe(3);
    expect(LIMITS.citations.pro).toBe(Infinity);
  });

  it("matches the sheet quota the usage hook enforces", () => {
    expect(LIMITS.sheets.free).toBe(MAX_DAILY_SHEETS);
  });

  it("matches the flashcard quota the usage hook enforces", () => {
    expect(LIMITS.cards.free).toBe(MAX_DAILY_CARDS);
  });

  it("matches the citation quotas the citation hook enforces", () => {
    expect(LIMITS.citations.anon).toBe(ANON_CITATION_LIMIT);
    expect(LIMITS.citations.free).toBe(FREE_CITATION_LIMIT);
  });

  it("keeps anonymous allowances no larger than free ones", () => {
    // A tier that gets *more* by not signing in would be a pricing bug, and
    // would also make every "sign in for more" prompt a lie.
    expect(LIMITS.citations.anon).toBeLessThanOrEqual(LIMITS.citations.free);
    expect(LIMITS.sheets.anon).toBeLessThanOrEqual(LIMITS.sheets.free);
    expect(LIMITS.cards.anon).toBeLessThanOrEqual(LIMITS.cards.free);
  });

  it("gives Pro strictly more than free on every metered feature", () => {
    for (const key of ["sheets", "cards", "citations"] as const) {
      expect(LIMITS[key].pro).toBeGreaterThan(LIMITS[key].free);
    }
  });
});

describe("display formatting", () => {
  it("renders finite limits as their number", () => {
    expect(formatLimit(3)).toBe("3");
  });

  it("renders an unbounded limit as a word, not 'Infinity'", () => {
    expect(formatLimit(Infinity)).toBe("unlimited");
    expect(formatLimit(LIMITS.citations.pro)).toBe("unlimited");
  });

  it("renders one price, matching the configured figure", () => {
    expect(formatPrice()).toBe(`$${PRICING.pro.monthly}`);
    expect(formatPrice()).toBe("$5");
  });
});

describe("quota truth table", () => {
  const cases: Array<{
    isPro: boolean;
    isAnonymous: boolean;
    tier: Tier;
    citationLimit: number;
  }> = [
    { isPro: false, isAnonymous: true, tier: "anon", citationLimit: 1 },
    { isPro: false, isAnonymous: false, tier: "free", citationLimit: 3 },
    { isPro: true, isAnonymous: false, tier: "pro", citationLimit: Infinity },
    // Pro wins over anonymous: an anon session holding a live entitlement is Pro.
    { isPro: true, isAnonymous: true, tier: "pro", citationLimit: Infinity },
  ];

  for (const { isPro, isAnonymous, tier, citationLimit } of cases) {
    it(`resolves isPro=${isPro} isAnonymous=${isAnonymous} to "${tier}"`, () => {
      expect(tierOf({ isPro, isAnonymous })).toBe(tier);
      expect(limitFor("citations", tier)).toBe(citationLimit);
    });
  }

  it("allows use below the limit and blocks at it", () => {
    expect(isWithinLimit(0, "citations", "anon")).toBe(true);
    // One use exhausts the anonymous allowance — at the limit, not below it.
    expect(isWithinLimit(1, "citations", "anon")).toBe(false);

    expect(isWithinLimit(2, "citations", "free")).toBe(true);
    expect(isWithinLimit(3, "citations", "free")).toBe(false);
  });

  it("never blocks Pro, however much they have used", () => {
    expect(isWithinLimit(9999, "citations", "pro")).toBe(true);
    expect(isWithinLimit(9999, "sheets", "pro")).toBe(true);
    expect(isWithinLimit(9999, "cards", "pro")).toBe(true);
  });

  it("preserves the old hook behaviour for sheets and cards", () => {
    // Before the rewire: `count >= MAX && !isPro`. anon and free share a limit,
    // so both must still block at exactly 5.
    for (const tier of ["anon", "free"] as const) {
      expect(isWithinLimit(4, "sheets", tier)).toBe(true);
      expect(isWithinLimit(5, "sheets", tier)).toBe(false);
      expect(isWithinLimit(5, "cards", tier)).toBe(false);
    }
  });
});
