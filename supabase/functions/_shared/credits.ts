/**
 * The daily AI budget: what a Corti call costs, what a day allows, and what a
 * request sets aside before it runs.
 *
 * One place for the numbers, as qbank-limits.ts is for the QBank guest cap: the
 * edge functions charge against it and the page's usage bar will show it, and
 * the two must never disagree. No imports and no Deno API at module scope, so
 * it bundles into the client unchanged.
 *
 * Money is counted in micro-dollars (µ$, a millionth of a dollar), which makes
 * the arithmetic exact: a token at $2 per million is 2 µ$.
 */

/** Corti's list prices, $ per million tokens (docs/corti-provider-spike.md §2). */
export const CORTI_PRICES: Record<string, { input: number; output: number }> = {
  "corti-s1": { input: 2, output: 8 },
  "corti-s1-instant": { input: 2, output: 8 },
  "corti-s1-mini": { input: 1, output: 4 },
  "corti-s1-mini-instant": { input: 1, output: 4 },
};

/** An unpriced model (the unlisted tiny ones) is charged as the dearest, never as free. */
const FALLBACK_PRICE = { input: 2, output: 8 };

/**
 * What one Corti call cost, in µ$. Cached prompt tokens are charged in full:
 * Corti publishes no cache discount, and an over-count is the safe error.
 */
export function costMicros(model: string, promptTokens: number, completionTokens: number): number {
  const price = CORTI_PRICES[model] ?? FALLBACK_PRICE;
  const p = Math.max(0, Math.round(promptTokens || 0));
  const c = Math.max(0, Math.round(completionTokens || 0));
  return p * price.input + c * price.output;
}

/**
 * Tokens for a call Corti never reported on — one aborted or cut off before
 * its usage frame. Measured on these prompts: 3.2–3.9 characters a token in
 * and about 4 out; the lower figures are used so an estimate errs high.
 */
export const CHARS_PER_INPUT_TOKEN = 3.2;
export const CHARS_PER_OUTPUT_TOKEN = 3.9;

/**
 * Output tokens a second, for a call aborted before it answered — a
 * non-streamed reply sends nothing until it is whole, so the only measure of
 * what it spent is how long it ran. corti-s1's reasoning ran at 108 tokens a
 * second on the deep-dive review (2026-11-07); the others are faster, so the
 * same rate under-estimates them slightly. An estimate is never charged to a
 * student (see `charged` in meter.ts) — it is for our own accounting.
 */
export const OUTPUT_TOKENS_PER_SECOND = 108;

export function estimateTokens(input: {
  inputChars: number;
  outputChars: number;
  ms: number;
  maxTokens: number;
  streamed: boolean;
}): { promptTokens: number; completionTokens: number } {
  const promptTokens = Math.ceil(Math.max(0, input.inputChars) / CHARS_PER_INPUT_TOKEN);
  const fromChars = Math.ceil(Math.max(0, input.outputChars) / CHARS_PER_OUTPUT_TOKEN);
  const fromTime = input.streamed ? 0 : Math.ceil((Math.max(0, input.ms) / 1000) * OUTPUT_TOKENS_PER_SECOND);
  const completionTokens = Math.min(Math.max(fromChars, fromTime), Math.max(0, input.maxTokens));
  return { promptTokens, completionTokens };
}

/**
 * A day's budget for every account, in µ$. Sized from the owner's quota —
 * five comprehensive sheets with their deep dives, a 50-card deck and forty
 * QBank questions — measured end to end on Corti on 2026-11-07 at $3.21, and
 * rounded up so that day fits with a little room. It resets at midnight UTC,
 * as the other daily counters do.
 */
export const DAILY_CREDIT_BUDGET_MICROS = 3_250_000;

/**
 * What a request sets aside before its first Corti call, in µ$, and gives
 * back when it ends; what it actually spent is charged call by call as Corti
 * reports it. Set near each request's worst case (its token budgets at list
 * price), not its typical cost, because the hold is what stops a student's
 * parallel requests from spending past the day's budget together. Typical
 * costs measured 2026-11-07 are noted beside each.
 */
export const CREDIT_HOLDS = {
  /** The sheet and its side calls — archetype, outline, warm-up, deck, labels. Typically ~5¢. */
  sheet: 120_000,
  /** A deep dive grown and reviewed. Typically ~4–7¢; the review alone may reason up to 16k tokens. */
  dive: 170_000,
  /** A sheet's suggested deep dives. Typically ~1.7¢. */
  suggest: 30_000,
  /** One section rewritten. */
  section: 40_000,
  /** One deck request (a 50-card deck is three). Typically ~1.1¢. */
  deck: 70_000,
  /**
   * Explain, Expand, Clinical, a personalize action. Typically 0.1–0.3¢; the
   * worst case is its 1,200-token reply (request-limits.ts ASSIST_MAX_TOKENS)
   * on a full 5,000-character input.
   */
  assist: 15_000,
  /** One QBank question, written and checked. Typically ~1.8¢. */
  qbankQuestion: 60_000,
  /** A QBank set's topic routing, once per topic. */
  qbankRoute: 2_000,
  /** A QBank full explanation, on a cache miss. Typically ~1.2¢. */
  qbankExplain: 30_000,
  /** An anatomy part explained, on a cache miss. */
  anatomy: 6_000,
} as const;

export type CreditHoldKind = keyof typeof CREDIT_HOLDS;

/**
 * What each thing typically costs, in µ$, measured 2026-11-07
 * (docs/credits-meter.md): what the usage page says the day's usage limit buys.
 */
export const TYPICAL_COST_MICROS = {
  comprehensiveSheet: 492_000,
  highYieldSheet: 53_000,
  qbankQuestion: 17_900,
  deck50: 41_000,
} as const;

/** How long a hold outlives a request that never gave it back — longer than any request runs. */
export const CREDIT_HOLD_TTL_SECONDS = 300;

/**
 * - `off`: nothing is metered or held.
 * - `record` (the default): every call is metered and charged to the day's
 *   count, holds are taken, and a request that would have been refused is
 *   logged — but nothing is refused. For calibrating before enforcing.
 * - `enforce`: a request that does not fit in what is left today is refused
 *   before any Corti call.
 */
export type CreditsMode = "off" | "record" | "enforce";

export function asCreditsMode(raw: string | undefined | null): CreditsMode {
  return raw === "off" || raw === "enforce" ? raw : "record";
}

/** When the day's count starts again: the next midnight UTC. */
export function creditsResetAt(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

/** The refusal a page can word: what is used, of what, and when it comes back. */
export function creditsExhaustedBody(used: number, budget: number, now: Date = new Date()) {
  return {
    error: "You've reached today's usage limit. It resets at midnight UTC.",
    code: "credits_exhausted",
    used,
    budget,
    resetsAt: creditsResetAt(now),
  };
}
