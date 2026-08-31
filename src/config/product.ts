/**
 * Single source of truth for product *values* — price, quotas, access rules,
 * feature readiness.
 *
 * These were hand-duplicated across six files and had drifted: the landing page
 * and FAQ said $5/mo while the upgrade modal said $4.99; citations were
 * described as Pro-only in one place, "on every generation" in another, and are
 * in fact metered per tier. Everything that states a number to the user reads it
 * from here.
 *
 * Copy lives in `src/config/en.json`, not here. This file holds only values a
 * translation would leave alone.
 *
 * ⚠️ The counts below must equal what the quota hooks actually enforce.
 * `src/test/product-limits.test.ts` asserts that and fails the moment they drift.
 */

export const PRICING = {
  pro: { monthly: 5, currency: "USD" },
} as const;

/**
 * Daily allowances per tier. Always a number so consumers can compare directly
 * without a type guard — `Infinity` renders through `formatLimit`.
 *
 * ⚠️ `Infinity` does not survive `JSON.stringify` (it becomes `null`). Harmless
 * while these are compile-time constants; if limits ever move to remote config,
 * switch to a sentinel and guard explicitly.
 */
export const LIMITS = {
  sheets: { anon: 5, free: 5, pro: Infinity },
  cards: { anon: 5, free: 5, pro: Infinity },
  citations: { anon: 1, free: 3, pro: Infinity },
} as const;

/**
 * Access rules are a separate concept from counting. The QBank is not "0 per
 * day" for anonymous users — it is unavailable until they have an account,
 * which is a different sentence and a different UI.
 */
export const ACCESS = {
  qbank: { anon: "requiresAuth" },
} as const;

/**
 * Feature readiness, so marketing copy cannot claim something the app does not
 * do. The landing page previously advertised "fully mobile-optimized" a few
 * hundred pixels above a card listing mobile as "Coming soon".
 */
export const FEATURES = {
  mobileApp: "planned",
  studyGroups: "planned",
  clinicalCases: "planned",
} as const;

export type Tier = "anon" | "free" | "pro";

/**
 * The one place "unlimited" is spelled — and therefore the one place a
 * translation will need to touch when a second locale lands.
 */
export const formatLimit = (n: number): string =>
  n === Infinity ? "unlimited" : String(n);

/** Price as displayed, e.g. "$5". Kept here so no surface hard-codes the figure. */
export const formatPrice = (): string => `$${PRICING.pro.monthly}`;

// ── Tier resolution ────────────────────────────────────────────────────────
// Pure, so the quota truth table can be tested without mounting a hook against
// Supabase and react-query. The hooks below own *fetching* auth state; they do
// not own the rules for what that state permits.

/**
 * Which tier a viewer is in. Pro wins over anonymous: an anonymous session that
 * somehow carries an active Pro entitlement is still Pro.
 */
export const tierOf = ({
  isPro,
  isAnonymous,
}: {
  isPro: boolean;
  isAnonymous: boolean;
}): Tier => (isPro ? "pro" : isAnonymous ? "anon" : "free");

/** Daily allowance for one metered feature at one tier. */
export const limitFor = (feature: keyof typeof LIMITS, tier: Tier): number =>
  LIMITS[feature][tier];

/**
 * Whether another use is allowed. Strictly `<`: a viewer who has used their
 * whole allowance is at the limit, not below it.
 *
 * This is a UI hint only — the edge functions enforce the real limit server-side
 * and a stale count here can never buy an extra generation.
 */
export const isWithinLimit = (
  used: number,
  feature: keyof typeof LIMITS,
  tier: Tier
): boolean => used < limitFor(feature, tier);
