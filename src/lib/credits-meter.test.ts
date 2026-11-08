import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CREDIT_HOLDS,
  DAILY_CREDIT_BUDGET_MICROS,
  asCreditsMode,
  costMicros,
  creditsExhaustedBody,
  creditsResetAt,
  estimateTokens,
} from "../../supabase/functions/_shared/credits.ts";
import {
  createMeter,
  reserveCredits,
  spendRow,
  startCredits,
  type MeterClient,
} from "../../supabase/functions/_shared/meter.ts";
import { NOTES_FIELD_LIMITS, oversizedNotesField } from "../../supabase/functions/_shared/request-limits.ts";
import { isStaff } from "../../supabase/functions/_shared/staff.ts";
import type { CortiCallRecord } from "../../supabase/functions/_shared/corti.ts";

const call = (over: Partial<CortiCallRecord> = {}): CortiCallRecord => ({
  tag: "sheet.writer",
  model: "corti-s1-instant",
  stream: true,
  maxTokens: 8192,
  inputChars: 3200,
  outputChars: 3900,
  ms: 18_000,
  status: 200,
  outcome: "ok",
  usage: { prompt_tokens: 2882, completion_tokens: 1580, prompt_tokens_details: { cached_tokens: 2579 } },
  ...over,
});

/** A Supabase client stand-in: records inserts and answers RPCs from a table of replies. */
function fakeClient(rpcReplies: Record<string, { data: unknown; error: { message: string } | null }> = {}) {
  const inserts: unknown[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  let insertError: { message: string } | null = null;
  const client: MeterClient = {
    from: () => ({ insert: (rows: unknown) => Promise.resolve((inserts.push(rows), { error: insertError })) }),
    rpc: (name, args) => Promise.resolve((rpcs.push({ name, args }), rpcReplies[name] ?? { data: null, error: null })),
  };
  return { client, inserts, rpcs, failInserts: (m: string) => (insertError = { message: m }) };
}

const withEnv = (vars: Record<string, string>) => {
  vi.stubGlobal("Deno", { env: { get: (k: string) => vars[k] } });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prices", () => {
  it("counts a token at its list price in µ$", () => {
    expect(costMicros("corti-s1-instant", 1_000_000, 0)).toBe(2_000_000);
    expect(costMicros("corti-s1-instant", 2882, 1580)).toBe(2882 * 2 + 1580 * 8);
    expect(costMicros("corti-s1-mini-instant", 1000, 1000)).toBe(5000);
    expect(costMicros("corti-s1", 0, 3523)).toBe(28_184);
  });

  it("charges an unpriced model as the dearest, never as free", () => {
    expect(costMicros("corti-s1-tiny-instant", 10, 10)).toBe(costMicros("corti-s1-instant", 10, 10));
  });

  it("fits the day it was sized for: five comprehensive sheets, a 50-card deck and forty questions", () => {
    // Measured on Corti 2026-11-07 (docs/credits-meter.md): 49.2¢, 4.1¢, 1.79¢.
    const day = 5 * 492_000 + 41_000 + 40 * 17_900;
    expect(day).toBeLessThanOrEqual(DAILY_CREDIT_BUDGET_MICROS);
    expect(DAILY_CREDIT_BUDGET_MICROS - day).toBeLessThan(100_000);
  });
});

describe("estimates", () => {
  it("errs high from length, and from time for a reply that never arrived", () => {
    expect(estimateTokens({ inputChars: 320, outputChars: 39, ms: 0, maxTokens: 100, streamed: true })).toEqual({ promptTokens: 100, completionTokens: 10 });
    // A review aborted at 100 s: about 10.8k tokens of reasoning, never past its budget.
    expect(estimateTokens({ inputChars: 0, outputChars: 0, ms: 100_000, maxTokens: 16_000, streamed: false }).completionTokens).toBe(10_800);
    expect(estimateTokens({ inputChars: 0, outputChars: 0, ms: 600_000, maxTokens: 16_000, streamed: false }).completionTokens).toBe(16_000);
  });
});

describe("the ledger row", () => {
  const ctx = { userId: "u1", requestId: "r1", fn: "medical-notes", charge: true };

  it("charges what Corti reported", () => {
    const row = spendRow(call(), ctx);
    expect(row).toMatchObject({
      user_id: "u1",
      feature: "sheet.writer",
      prompt_tokens: 2882,
      completion_tokens: 1580,
      cached_tokens: 2579,
      cost_micros: 2882 * 2 + 1580 * 8,
      estimated: false,
      charged: true,
      outcome: "ok",
    });
  });

  it("records our timeouts and broken networks at an estimate, uncharged", () => {
    for (const outcome of ["aborted", "failed"] as const) {
      const row = spendRow(call({ outcome, usage: null, stream: false, outputChars: 0, ms: 100_000, model: "corti-s1", maxTokens: 16_000 }), ctx);
      expect(row.estimated).toBe(true);
      expect(row.charged).toBe(false);
      expect(row.cost_micros).toBeGreaterThan(0);
    }
  });

  it("charges the estimate when the student cut the stream off", () => {
    const row = spendRow(call({ outcome: "cancelled", usage: null }), ctx);
    expect(row).toMatchObject({ estimated: true, charged: true, completion_tokens: 1000 });
  });

  it("writes a refused call as nothing spent", () => {
    expect(spendRow(call({ outcome: "http_error", usage: null, status: 429 }), ctx)).toMatchObject({ cost_micros: 0, charged: false, estimated: false });
  });

  it("charges nobody for a shared build", () => {
    expect(spendRow(call(), { ...ctx, charge: false }).charged).toBe(false);
  });
});

describe("the meter", () => {
  it("writes a row per call, keeps it alive, and tallies what it charged", async () => {
    const { client, inserts } = fakeClient();
    const kept: Promise<unknown>[] = [];
    const meter = createMeter({ client, userId: "u1", fn: "qbank-generate", keepAlive: (p) => kept.push(p) });
    meter.record(call({ tag: "qbank.writer" }));
    meter.child({ charge: false }).record(call({ tag: "qbank.blueprint" }));
    await meter.drain();
    expect(inserts).toHaveLength(2);
    expect(kept).toHaveLength(2);
    const rows = inserts.flat() as { feature: string; charged: boolean; request_id: string }[];
    expect(rows.map((r) => [r.feature, r.charged])).toEqual([["qbank.writer", true], ["qbank.blueprint", false]]);
    expect(rows[0].request_id).toBe(rows[1].request_id);
    expect(meter.totals()).toEqual({ calls: 2, chargedMicros: 2882 * 2 + 1580 * 8, uncharged: 1, estimated: 0 });
  });

  it("fails open: a ledger write that fails is logged, never thrown", async () => {
    const { client, failInserts } = fakeClient();
    failInserts("relation does not exist");
    const log = vi.fn();
    const meter = createMeter({ client, userId: "u1", fn: "medical-notes", log });
    meter.record(call());
    await meter.drain();
    expect(log).toHaveBeenCalledWith("spend_insert_failed", { feature: "sheet.writer", message: "relation does not exist" });
  });

  it("never waits on a stalled write past its bound", async () => {
    const client: MeterClient = { from: () => ({ insert: () => new Promise(() => {}) }), rpc: () => Promise.resolve({ data: null, error: null }) };
    const meter = createMeter({ client, userId: "u1", fn: "medical-notes" });
    meter.record(call());
    const t0 = Date.now();
    await meter.drain(50);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("the hold", () => {
  const reply = (within: boolean, enforce: boolean) => ({
    reserve_credits: { data: { allowed: within || !enforce, within_budget: within, hold: "h1", used: 3_100_000, held: 120_000 }, error: null },
  });

  it("off: takes nothing and calls nothing", async () => {
    const { client, rpcs } = fakeClient();
    const hold = await reserveCredits({ client, userId: "u1", amount: 120_000, mode: "off" });
    expect(hold.allowed).toBe(true);
    expect(rpcs).toHaveLength(0);
  });

  it("record: never refuses, but logs what enforcing would have refused", async () => {
    const { client, rpcs } = fakeClient(reply(false, false));
    const log = vi.fn();
    const hold = await reserveCredits({ client, userId: "u1", amount: 120_000, mode: "record", log });
    expect(hold).toMatchObject({ allowed: true, withinBudget: false, used: 3_100_000, held: 120_000 });
    expect(rpcs[0]).toEqual({
      name: "reserve_credits",
      args: { p_user: "u1", p_amount: 120_000, p_cap: DAILY_CREDIT_BUDGET_MICROS, p_enforce: false, p_ttl_seconds: 300 },
    });
    expect(log).toHaveBeenCalledWith("credits_would_refuse", expect.objectContaining({ amount: 120_000 }));
    await hold.release();
    await hold.release();
    expect(rpcs.filter((r) => r.name === "release_credit_hold")).toEqual([{ name: "release_credit_hold", args: { p_hold: "h1" } }]);
  });

  it("enforce: refuses what does not fit", async () => {
    const { client } = fakeClient(reply(false, true));
    const hold = await reserveCredits({ client, userId: "u1", amount: 170_000, mode: "enforce" });
    expect(hold).toMatchObject({ allowed: false, withinBudget: false, failed: false });
  });

  it("an unreadable count: refuses when enforcing, goes ahead when recording", async () => {
    const broken = { reserve_credits: { data: null, error: { message: "function does not exist" } } };
    const enforced = await reserveCredits({ client: fakeClient(broken).client, userId: "u1", amount: 1, mode: "enforce" });
    expect(enforced).toMatchObject({ allowed: false, failed: true });
    const recorded = await reserveCredits({ client: fakeClient(broken).client, userId: "u1", amount: 1, mode: "record" });
    expect(recorded).toMatchObject({ allowed: true, failed: false });
  });
});

describe("a request's credits", () => {
  it("reads the mode, refuses with a body the page can word, and finishes once", async () => {
    withEnv({ CREDITS_MODE: "enforce" });
    const { client, rpcs } = fakeClient({
      reserve_credits: { data: { allowed: false, within_budget: false, hold: null, used: 3_200_000, held: 0 }, error: null },
    });
    const log = vi.fn();
    const credits = await startCredits({ client, userId: "u1", fn: "medical-notes", kind: "sheet", amount: CREDIT_HOLDS.sheet, log });
    expect(credits.mode).toBe("enforce");
    expect(credits.refusal).toEqual({ status: 429, body: expect.objectContaining({ code: "credits_exhausted", used: 3_200_000, budget: DAILY_CREDIT_BUDGET_MICROS }) });
    await credits.finish();
    await credits.finish();
    expect(log.mock.calls.filter(([e]) => e === "spend")).toHaveLength(1);
    expect(rpcs.filter((r) => r.name === "release_credit_hold")).toHaveLength(0);
  });

  it("is record mode when unset, and has no meter when off", async () => {
    withEnv({});
    expect((await startCredits({ client: fakeClient().client, userId: "u1", fn: "f", kind: "k", amount: 1 })).mode).toBe("record");
    withEnv({ CREDITS_MODE: "off" });
    const off = await startCredits({ client: fakeClient().client, userId: "u1", fn: "f", kind: "k", amount: 1 });
    expect(off.meter).toBeNull();
    expect(off.refusal).toBeNull();
  });
});

describe("modes and the reset", () => {
  it("reads only the modes it knows, defaulting to record", () => {
    expect(asCreditsMode("enforce")).toBe("enforce");
    expect(asCreditsMode("off")).toBe("off");
    expect(asCreditsMode("ENFORCE")).toBe("record");
    expect(asCreditsMode(undefined)).toBe("record");
  });

  it("resets at the next midnight UTC", () => {
    expect(creditsResetAt(new Date("2026-11-07T23:59:00Z"))).toBe("2026-11-08T00:00:00.000Z");
    expect(creditsExhaustedBody(1, 2, new Date("2026-12-31T10:00:00Z")).resetsAt).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("request limits", () => {
  it("passes what the app sends", () => {
    expect(oversizedNotesField({ notes: "Heart failure", examMode: "USMLE Step 2", difficulty: "Intermediate", sectionItems: [] })).toBeNull();
    expect(oversizedNotesField({ notes: "x".repeat(NOTES_FIELD_LIMITS.notes) })).toBeNull();
  });

  it("names the first field over its ceiling", () => {
    expect(oversizedNotesField({ notes: "x".repeat(NOTES_FIELD_LIMITS.notes + 1) })).toBe("notes");
    expect(oversizedNotesField({ notes: "ok", itemText: "y".repeat(2001) })).toBe("itemText");
    expect(oversizedNotesField({ notes: "ok", sectionItems: Array(61).fill("a") })).toBe("sectionItems");
    expect(oversizedNotesField({ notes: "ok", sectionItems: ["z".repeat(1001)] })).toBe("sectionItems");
  });
});

describe("staff", () => {
  it("is nobody until STAFF_USER_IDS names someone", () => {
    withEnv({});
    expect(isStaff("b5653621-e65c-4641-a091-3f86215ae686")).toBe(false);
    withEnv({ STAFF_USER_IDS: " B5653621-E65C-4641-A091-3F86215AE686 , other " });
    expect(isStaff("b5653621-e65c-4641-a091-3f86215ae686")).toBe(true);
    expect(isStaff(null)).toBe(false);
    expect(isStaff("someone-else")).toBe(false);
  });
});
