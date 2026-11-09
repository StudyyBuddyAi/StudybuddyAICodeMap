/**
 * The spend meter and the day's credit hold, as the edge functions use them.
 *
 * Every Corti call made with a metered config (corti.ts) lands here as one
 * row of `ai_spend` — what it was for, the tokens Corti reported, and what
 * they cost (credits.ts). A row that is charged also adds its cost to the
 * student's `usage_records` credits row for the day, by trigger, so the ledger
 * and the count the usage bar reads cannot drift apart
 * (20261107000000_credits_meter.sql).
 *
 * Before its first call a request takes a hold on the day's credits, sized to
 * its worst case, and gives it back when it ends. In `enforce` mode a request
 * whose hold does not fit is refused before anything is spent; in `record`
 * mode it goes ahead and the refusal it would have met is logged.
 *
 * The meter fails open: a ledger write that fails is logged and the request
 * carries on, as the quota's own writes do. The hold fails closed when it is
 * enforcing — an unreadable count is not a licence to spend.
 *
 * No URL imports and no Deno API at module scope, so the unit tests import it.
 */
import type { CortiCallRecord, CortiMeter } from "./corti.ts";
import {
  CREDIT_HOLD_TTL_SECONDS,
  DAILY_CREDIT_BUDGET_MICROS,
  asCreditsMode,
  costMicros,
  creditsExhaustedBody,
  estimateTokens,
  type CreditsMode,
} from "./credits.ts";

/** One row of public.ai_spend. */
export interface SpendRow {
  user_id: string | null;
  request_id: string;
  fn: string;
  feature: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cost_micros: number;
  estimated: boolean;
  charged: boolean;
  outcome: CortiCallRecord["outcome"];
  status: number;
  duration_ms: number;
}

type DbError = { message: string } | null;

/** What the meter needs of a Supabase client — the service-role one. */
export interface MeterClient {
  from(table: string): { insert(rows: unknown): PromiseLike<{ error: DbError }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
}

type Log = (event: string, data: Record<string, unknown>) => void;

export interface Meter extends CortiMeter {
  readonly requestId: string;
  /**
   * The same ledger under another charge rule. A topic's blueprint is built
   * once and shared by every student, so whoever happened to trigger the
   * build is not charged for it (`charge: false`); it is still recorded.
   */
  child(opts: { charge?: boolean }): Meter;
  /** What this request has recorded so far. */
  totals(): { calls: number; chargedMicros: number; uncharged: number; estimated: number };
  /** Waits for the ledger writes so far, never longer than `timeoutMs`. */
  drain(timeoutMs?: number): Promise<void>;
}

/** The ledger row for one call. Pure, so the charge rules can be tested on their own. */
export function spendRow(
  call: CortiCallRecord,
  ctx: { userId: string | null; requestId: string; fn: string; charge: boolean }
): SpendRow {
  const usage = call.usage;
  const reported = typeof usage?.prompt_tokens === "number" || typeof usage?.completion_tokens === "number";
  // Nothing was written on a refused request: a zero row, kept for monitoring.
  const tokens =
    call.outcome === "http_error"
      ? { promptTokens: 0, completionTokens: 0 }
      : reported
      ? { promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0 }
      : estimateTokens({ inputChars: call.inputChars, outputChars: call.outputChars, ms: call.ms, maxTokens: call.maxTokens, streamed: call.stream });
  const estimated = !reported && call.outcome !== "http_error";
  const cost = costMicros(call.model, tokens.promptTokens, tokens.completionTokens);
  // An estimate is charged only when the student cut the stream off — what
  // they read is theirs, and leaving before the usage frame must not make it
  // free. Our own timeouts and a broken network are ours to absorb.
  const charged = ctx.charge && cost > 0 && (!estimated || call.outcome === "cancelled");
  return {
    user_id: ctx.userId,
    request_id: ctx.requestId,
    fn: ctx.fn,
    feature: call.tag,
    model: call.model,
    prompt_tokens: tokens.promptTokens,
    completion_tokens: tokens.completionTokens,
    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cost_micros: cost,
    estimated,
    charged,
    outcome: call.outcome,
    status: call.status,
    duration_ms: Math.max(0, Math.round(call.ms)),
  };
}

export function createMeter(opts: {
  client: MeterClient;
  userId: string | null;
  /** The edge function, for the ledger. */
  fn: string;
  requestId?: string;
  charge?: boolean;
  /** Keeps a write alive past the response (EdgeRuntime.waitUntil). */
  keepAlive?: (task: Promise<unknown>) => void;
  log?: Log;
}): Meter {
  const requestId = opts.requestId ?? crypto.randomUUID();
  const pending = new Set<Promise<void>>();
  const tally = { calls: 0, chargedMicros: 0, uncharged: 0, estimated: 0 };

  const make = (charge: boolean): Meter => ({
    requestId,
    record(call) {
      const row = spendRow(call, { userId: opts.userId, requestId, fn: opts.fn, charge });
      tally.calls++;
      if (row.charged) tally.chargedMicros += row.cost_micros;
      else tally.uncharged++;
      if (row.estimated) tally.estimated++;
      const write: Promise<void> = Promise.resolve(opts.client.from("ai_spend").insert([row]))
        .then(({ error }) => {
          if (error) opts.log?.("spend_insert_failed", { feature: row.feature, message: error.message });
        })
        .catch((err: unknown) => {
          opts.log?.("spend_insert_failed", { feature: row.feature, message: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          pending.delete(write);
        });
      pending.add(write);
      opts.keepAlive?.(write);
    },
    child: (o) => make(o.charge ?? charge),
    totals: () => ({ ...tally }),
    async drain(timeoutMs = 3000) {
      if (!pending.size) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
    },
  });
  return make(opts.charge ?? true);
}

/**
 * Keeps a promise alive past the response: Supabase's runtime provides
 * EdgeRuntime.waitUntil; anywhere else (the Node dev server, the tests) the
 * promise simply runs on.
 */
export function keepAlive(task: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  runtime?.waitUntil?.(task);
}

/** CREDITS_MODE from the function's environment; `record` when unset. */
export function creditsModeFromEnv(): CreditsMode {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return asCreditsMode(env?.get("CREDITS_MODE"));
}

export interface CreditsHold {
  /** Whether the request may go ahead. False only when enforcing. */
  allowed: boolean;
  /** Whether it fitted in what is left today — what enforcing would decide. */
  withinBudget: boolean;
  /** Enforcing, and the count could not be read: the caller answers 500. */
  failed: boolean;
  /** µ$ charged today before this request, and held by others still running. */
  used: number;
  held: number;
  budget: number;
  /** Gives the hold back. Idempotent; never throws. */
  release(): Promise<void>;
}

const noHold = (budget: number): CreditsHold => ({
  allowed: true,
  withinBudget: true,
  failed: false,
  used: 0,
  held: 0,
  budget,
  release: () => Promise.resolve(),
});

export interface CreditsSession {
  /** Null when CREDITS_MODE is off. Put it on the Corti config (cortiConfigWith / `{ ...config, meter }`). */
  meter: Meter | null;
  hold: CreditsHold;
  mode: CreditsMode;
  /** Set when the request is refused: answer with it, after `finish()`. */
  refusal: { status: 429 | 500; body: Record<string, unknown> } | null;
  /** Gives the hold back, settles the ledger writes and logs the request's spend. Idempotent. */
  finish(): Promise<void>;
}

/**
 * A request's credits, start to finish: the meter, the hold of `amount` µ$,
 * and the one call every exit makes. Called before the request's first Corti
 * call, so a refused request has spent nothing.
 */
export async function startCredits(opts: {
  client: MeterClient;
  userId: string;
  fn: string;
  /** What the request is, for the spend log line. */
  kind: string;
  amount: number;
  keepAlive?: (task: Promise<unknown>) => void;
  log?: Log;
}): Promise<CreditsSession> {
  const mode = creditsModeFromEnv();
  const meter =
    mode === "off" ? null : createMeter({ client: opts.client, userId: opts.userId, fn: opts.fn, keepAlive: opts.keepAlive, log: opts.log });
  const hold = await reserveCredits({ client: opts.client, userId: opts.userId, amount: opts.amount, mode, log: opts.log });
  let finished = false;
  return {
    meter,
    hold,
    mode,
    refusal: hold.allowed
      ? null
      : hold.failed
      ? { status: 500, body: { error: "quota_check_failed" } }
      : { status: 429, body: creditsExhaustedBody(hold.used + hold.held, hold.budget) },
    async finish() {
      if (finished) return;
      finished = true;
      await hold.release();
      if (!meter) return;
      await meter.drain();
      opts.log?.("spend", { kind: opts.kind, mode, ...meter.totals() });
    },
  };
}

/**
 * Takes a hold of `amount` µ$ on the student's day (reserve_credits). In
 * `record` mode nothing is ever refused and a failure is only logged; in
 * `enforce` mode a hold that does not fit is refused, and a failure refuses
 * too. `off` takes nothing.
 */
export async function reserveCredits(opts: {
  client: MeterClient;
  userId: string;
  amount: number;
  mode: CreditsMode;
  budget?: number;
  log?: Log;
}): Promise<CreditsHold> {
  const budget = opts.budget ?? DAILY_CREDIT_BUDGET_MICROS;
  if (opts.mode === "off") return noHold(budget);
  const enforce = opts.mode === "enforce";
  const amount = Math.max(1, Math.round(opts.amount));

  let data: unknown;
  let error: DbError;
  try {
    ({ data, error } = await opts.client.rpc("reserve_credits", {
      p_user: opts.userId,
      p_amount: amount,
      p_cap: budget,
      p_enforce: enforce,
      p_ttl_seconds: CREDIT_HOLD_TTL_SECONDS,
    }));
  } catch (err) {
    error = { message: err instanceof Error ? err.message : String(err) };
  }
  const row = (data ?? null) as { allowed?: boolean; within_budget?: boolean; hold?: string | null; used?: number; held?: number } | null;
  if (error || !row) {
    opts.log?.("credits_reserve_failed", { mode: opts.mode, message: error?.message ?? "no result" });
    return enforce ? { ...noHold(budget), allowed: false, withinBudget: false, failed: true } : noHold(budget);
  }

  const used = Number(row.used) || 0;
  const held = Number(row.held) || 0;
  const withinBudget = row.within_budget !== false;
  const allowed = enforce ? row.allowed === true : true;
  if (!withinBudget) {
    opts.log?.(enforce ? "credits_refused" : "credits_would_refuse", { amount, used, held, budget });
  }

  const hold = typeof row.hold === "string" ? row.hold : null;
  let released = !hold;
  return {
    allowed,
    withinBudget,
    failed: false,
    used,
    held,
    budget,
    async release() {
      if (released) return;
      released = true;
      try {
        const { error: releaseError } = await opts.client.rpc("release_credit_hold", { p_hold: hold });
        if (releaseError) opts.log?.("credits_release_failed", { message: releaseError.message });
      } catch (err) {
        opts.log?.("credits_release_failed", { message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
