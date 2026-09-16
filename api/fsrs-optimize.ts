import { createClient } from "@supabase/supabase-js";
import {
  FSRSBinding,
  FSRSBindingItem,
  FSRSBindingReview,
  computeParameters,
} from "@open-spaced-repetition/binding";
import { default_w } from "ts-fsrs";
// ".js" is required: package.json is "type": "module", so the compiled function
// runs as native ESM, which does not resolve extensionless relative imports.
import { MIN_REVIEWS_TO_OPTIMIZE, buildTrainingItems, type LogRow } from "../src/lib/fsrs-items.js";

/**
 * POST /api/fsrs-optimize — Anki's "Optimize FSRS parameters", for one user.
 *
 * Trains FSRS weights on the caller's own review history with fsrs-rs (the
 * optimizer Anki ships), then keeps them only if they predict that history
 * better than the weights in use now. Runs here rather than in the browser
 * because the optimizer's WASM build needs cross-origin isolation headers the
 * rest of the site can't serve, and Supabase edge functions (Deno) can't load
 * the native build.
 *
 * Acts strictly as the caller: the Supabase client carries their access token,
 * so RLS limits reads to their own reviews and set_srs_weights writes only
 * their own profile. No service-role key is involved.
 *
 * Body: { timeZone: string }  (IANA zone, for placing reviews on study days)
 */

const MAX_REVIEWS = 200_000;
const PAGE = 1000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return json(500, { ok: false, reason: "server_not_configured" });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { ok: false, reason: "not_authenticated" });

  let timeZone = "UTC";
  try {
    const body = (await request.json()) as { timeZone?: unknown };
    if (isValidTimeZone(body?.timeZone)) timeZone = body.timeZone;
  } catch {
    // An empty or malformed body just means UTC.
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || user.is_anonymous) {
    return json(401, { ok: false, reason: "not_authenticated" });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("srs_weights, srs_weights_updated_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return json(500, { ok: false, reason: "profile_read_failed" });

  // Optimizing is CPU-heavy and the answer barely moves within a day.
  const lastRun = profile?.srs_weights_updated_at ? Date.parse(profile.srs_weights_updated_at) : 0;
  if (Date.now() - lastRun < 12 * 60 * 60 * 1000) {
    return json(429, { ok: false, reason: "too_soon" });
  }

  const rows: LogRow[] = [];
  for (let from = 0; from < MAX_REVIEWS; from += PAGE) {
    const { data, error } = await supabase
      .from("review_sessions")
      .select("card_id, rating, reviewed_at")
      .eq("user_id", user.id)
      .order("reviewed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return json(500, { ok: false, reason: "reviews_read_failed" });
    rows.push(...((data ?? []) as LogRow[]));
    if (!data || data.length < PAGE) break;
  }

  if (rows.length < MIN_REVIEWS_TO_OPTIMIZE) {
    return json(200, { ok: false, reason: "not_enough_reviews", reviewCount: rows.length, required: MIN_REVIEWS_TO_OPTIMIZE });
  }

  const toItem = (reviews: { rating: number; deltaT: number }[]) =>
    new FSRSBindingItem(reviews.map((r) => new FSRSBindingReview(r.rating, r.deltaT)));
  const training = buildTrainingItems(rows, timeZone).map(toItem);
  // fsrs-rs only scores predictions for reviews that land on a later day.
  const evaluation = training.filter((item) => (item.current?.deltaT ?? 0) > 0);
  if (!evaluation.length) {
    return json(200, { ok: false, reason: "not_enough_reviews", reviewCount: rows.length, required: MIN_REVIEWS_TO_OPTIMIZE });
  }

  const currentWeights =
    Array.isArray(profile?.srs_weights) && profile.srs_weights.length === 21
      ? (profile.srs_weights as number[])
      : Array.from(default_w);

  let optimized: number[];
  let currentLoss: number;
  let optimizedLoss: number;
  try {
    optimized = await computeParameters(training, { enableShortTerm: true, numRelearningSteps: 1 });
    currentLoss = new FSRSBinding(currentWeights).evaluate(evaluation).logLoss;
    optimizedLoss = new FSRSBinding(optimized).evaluate(evaluation).logLoss;
  } catch (e) {
    console.error("fsrs optimize failed", e);
    return json(200, { ok: false, reason: "optimizer_failed", reviewCount: rows.length });
  }

  const adopted = optimized.length === 21 && optimized.every(Number.isFinite) && optimizedLoss < currentLoss;

  if (adopted) {
    const { error } = await supabase.rpc("set_srs_weights", {
      p_weights: optimized,
      p_review_count: rows.length,
      p_log_loss: optimizedLoss,
    });
    if (error) {
      console.error("set_srs_weights failed", error);
      return json(500, { ok: false, reason: "save_failed" });
    }
  }

  return json(200, {
    ok: true,
    adopted,
    reviewCount: rows.length,
    logLoss: { current: currentLoss, optimized: optimizedLoss },
    weights: adopted ? optimized : currentWeights,
  });
}
