/**
 * The medical-notes handler's database client, faked for the dev server.
 *
 * The real handler runs inside `vite dev` (see vite-plugin.ts), but it talks
 * to Supabase with the service-role key, which this machine does not have. So
 * its `https://esm.sh/@supabase/supabase-js` import resolves here instead, to
 * a client that answers the few things the handler asks:
 *
 *   - auth.getUser(token)  — the token's own claims, NOT verified. Dev only.
 *   - profiles             — read for real, with the caller's token (RLS).
 *   - guideline_chunks     — read for real, with the publishable key (public).
 *   - consume_usage / refund_usage / consume_premium_hook — counted in memory
 *     for this server's lifetime, so a dev session never touches the live
 *     quota tables.
 *   - premium_sheet_grants — issued and checked in memory.
 *   - everything else (memory, rag_logs) — refused, and the handler carries on
 *     without it, as it does in production when those fail.
 *
 * LOCAL_NOTES_WRITER=corti|gpt-oss forces the tier: "corti" grants the
 * premium hook and a Pro user's Corti preference, "gpt-oss" refuses the hook
 * and reads a Pro user as having chosen fastest.
 */

type Result = { data: unknown; error: { message: string } | null };

const env = (key: string): string | undefined =>
  (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key);

const counters = new Map<string, number>();
const premiumUsed = new Map<string, number>();
const grants = new Map<string, string>();

const today = () => new Date().toISOString().slice(0, 10);
const refused = (what: string): Result => ({ data: null, error: { message: `local stand-in: ${what} is not available` } });

function claimsOf(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/** A read through PostgREST, with the caller's token when there is one. */
async function rest(path: string, token?: string): Promise<Result> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  if (!url || !key) return refused("the REST API (no URL or publishable key)");
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${token ?? key}` },
    });
    if (!res.ok) return { data: null, error: { message: `REST ${res.status}: ${(await res.text()).slice(0, 200)}` } };
    return { data: await res.json(), error: null };
  } catch (err) {
    return { data: null, error: { message: String(err) } };
  }
}

interface QueryState {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns: string;
  payload: unknown;
  eq: [string, unknown][];
  in: [string, unknown[]] | null;
  single: boolean;
}

async function run(q: QueryState, token: string | null): Promise<Result> {
  const eq = (col: string) => q.eq.find(([c]) => c === col)?.[1];

  if (q.table === "profiles" && q.op === "select") {
    const id = eq("id");
    const r = await rest(`profiles?id=eq.${id}&select=${encodeURIComponent(q.columns || "*")}`, token ?? undefined);
    if (r.error) return r;
    const row = (r.data as Record<string, unknown>[])[0] ?? null;
    const forced = env("LOCAL_NOTES_WRITER");
    if (row && (forced === "corti" || forced === "gpt-oss")) row.preferred_model = forced === "corti" ? "corti" : "gpt-oss";
    return { data: row, error: null };
  }

  if (q.table === "guideline_chunks" && q.op === "select" && q.in) {
    const ids = q.in[1].map(String).join(",");
    return rest(`guideline_chunks?id=in.(${ids})&select=${encodeURIComponent(q.columns || "*")}`);
  }

  if (q.table === "premium_sheet_grants") {
    if (q.op === "insert") {
      const id = crypto.randomUUID();
      grants.set(id, String((q.payload as { user_id?: string }).user_id ?? ""));
      return { data: q.single ? { id } : [{ id }], error: null };
    }
    const id = String(eq("id") ?? "");
    const ok = grants.get(id) === String(eq("user_id") ?? "");
    return { data: ok ? { id } : null, error: null };
  }

  if (q.table === "rag_logs") return { data: null, error: null };

  return refused(`table ${q.table}`);
}

/** A chainable, awaitable stand-in for supabase-js's query builder. */
function queryBuilder(table: string, token: () => string | null) {
  const q: QueryState = { table, op: "select", columns: "", payload: null, eq: [], in: null, single: false };
  const builder = {
    select(columns = "*") {
      q.columns = columns;
      return builder;
    },
    insert(payload: unknown) {
      q.op = "insert";
      q.payload = payload;
      return builder;
    },
    update(payload: unknown) {
      q.op = "update";
      q.payload = payload;
      return builder;
    },
    delete() {
      q.op = "delete";
      return builder;
    },
    eq(col: string, value: unknown) {
      q.eq.push([col, value]);
      return builder;
    },
    in(col: string, values: unknown[]) {
      q.in = [col, values];
      return builder;
    },
    neq: () => builder,
    filter: () => builder,
    order: () => builder,
    limit: () => builder,
    single() {
      q.single = true;
      return builder;
    },
    maybeSingle() {
      q.single = true;
      return builder;
    },
    then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) {
      return run(q, token()).then(resolve, reject);
    },
  };
  return builder;
}

function rpc(name: string, args: Record<string, unknown>): Promise<Result> {
  const user = String(args.p_user ?? "");
  if (name === "consume_usage") {
    const key = `${user}|${args.p_kind}|${today()}`;
    const count = counters.get(key) ?? 0;
    if (count >= Number(args.p_cap)) return Promise.resolve({ data: { allowed: false, count }, error: null });
    counters.set(key, count + 1);
    return Promise.resolve({ data: { allowed: true, count: count + 1 }, error: null });
  }
  if (name === "refund_usage") {
    const key = `${user}|${args.p_kind}|${today()}`;
    counters.set(key, Math.max((counters.get(key) ?? 0) - 1, 0));
    return Promise.resolve({ data: null, error: null });
  }
  if (name === "consume_premium_hook") {
    const forced = env("LOCAL_NOTES_WRITER");
    if (forced === "corti") return Promise.resolve({ data: { allowed: true }, error: null });
    if (forced === "gpt-oss") return Promise.resolve({ data: { allowed: false }, error: null });
    const used = premiumUsed.get(user) ?? 0;
    if (used >= Number(args.p_limit)) return Promise.resolve({ data: { allowed: false }, error: null });
    premiumUsed.set(user, used + 1);
    return Promise.resolve({ data: { allowed: true }, error: null });
  }
  return Promise.resolve(refused(`rpc ${name}`));
}

export type SupabaseClient = ReturnType<typeof createClient>;

export function createClient(_url: string, _key: string) {
  let token: string | null = null;
  return {
    auth: {
      async getUser(jwt: string) {
        const claims = claimsOf(jwt);
        if (typeof claims.sub !== "string") return { data: { user: null }, error: { message: "invalid token" } };
        token = jwt;
        return { data: { user: { id: claims.sub, is_anonymous: claims.is_anonymous === true } }, error: null };
      },
    },
    from: (table: string) => queryBuilder(table, () => token),
    rpc,
  };
}
