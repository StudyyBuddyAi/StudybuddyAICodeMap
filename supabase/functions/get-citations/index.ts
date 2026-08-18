import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Structured, machine-parseable logs (visible in Supabase edge-fn logs).
// Metadata only — never log topic content, tokens, or keys.
const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ fn: "get-citations", event, ...fields }));
};

// ─── Specialty detection ──────────────────────────────────────────────────

interface SpecialtyProfile {
  name: string;
  journalFilters: string[];
  societyLabel: string;
}

const SPECIALTY_MAP: { keywords: string[]; profile: SpecialtyProfile }[] = [
  {
    keywords: [
      "heart", "cardiac", "cardiology", "hypertension", "myocardial",
      "coronary", "arrhythmia", "atrial fibrillation", "heart failure",
      "angina", "aorta", "ecg", "stemi", "nstemi", "pericarditis",
      "endocarditis", "cardiomyopathy", "valvular",
    ],
    profile: {
      name: "cardiology",
      journalFilters: ["Circulation[jour]", "J Am Coll Cardiol[jour]"],
      societyLabel: "AHA/ACC",
    },
  },
  {
    keywords: [
      "obstetric", "gynecolog", "pregnancy", "prenatal", "postpartum",
      "preeclampsia", "eclampsia", "cervical", "uterine", "ovarian",
      "endometriosis", "pcos", "menstrual", "contraception", "labor",
      "delivery", "miscarriage", "ectopic", "gestational diabetes",
    ],
    profile: {
      name: "obgyn",
      journalFilters: ["Obstet Gynecol[jour]"],
      societyLabel: "ACOG",
    },
  },
  {
    keywords: [
      "kidney", "renal", "nephrology", "nephritis", "nephrotic",
      "glomerulo", "dialysis", "creatinine", "egfr", "ckd", "aki",
      "proteinuria", "hematuria", "transplant kidney", "kdigo",
    ],
    profile: {
      name: "nephrology",
      journalFilters: ["Kidney Int[jour]", "Kidney Int Suppl[jour]"],
      societyLabel: "KDIGO",
    },
  },
  {
    keywords: [
      "diabetes", "insulin", "hyperglycemia", "hba1c", "type 1 diabetes",
      "type 2 diabetes", "diabetic", "metformin", "hypoglycemia",
      "thyroid", "hypothyroid", "hyperthyroid", "adrenal", "pituitary",
      "cushing", "addison", "endocrine",
    ],
    profile: {
      name: "endocrinology",
      journalFilters: ["Diabetes Care[jour]", "J Clin Endocrinol Metab[jour]"],
      societyLabel: "ADA/Endocrine Society",
    },
  },
  {
    keywords: [
      "infection", "sepsis", "antibiotic", "pneumonia", "meningitis",
      "hiv", "tuberculosis", "fungal", "viral", "bacterial", "antimicrobial",
      "endocarditis infective", "urinary tract infection", "uti",
      "cellulitis", "osteomyelitis", "infectious disease",
    ],
    profile: {
      name: "infectious_disease",
      journalFilters: ["Clin Infect Dis[jour]", "J Infect Dis[jour]"],
      societyLabel: "IDSA",
    },
  },
  {
    keywords: [
      "copd", "asthma", "pulmonary", "lung", "respiratory", "bronchitis",
      "emphysema", "pleural", "pneumothorax", "interstitial lung",
      "pulmonary fibrosis", "pulmonary hypertension", "spirometry",
    ],
    profile: {
      name: "pulmonology",
      journalFilters: ["Eur Respir J[jour]", "Am J Respir Crit Care Med[jour]"],
      societyLabel: "GOLD/ERS",
    },
  },
  {
    keywords: [
      "pediatric", "neonatal", "infant", "child", "newborn", "congenital",
      "vaccination child", "growth development", "puberty", "pediatrics",
    ],
    profile: {
      name: "pediatrics",
      journalFilters: ["Pediatrics[jour]", "Arch Dis Child[jour]"],
      societyLabel: "AAP",
    },
  },
];

function detectSpecialty(topic: string): SpecialtyProfile | null {
  const lower = topic.toLowerCase();
  for (const { keywords, profile } of SPECIALTY_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return profile;
    }
  }
  return null;
}

// ─── Query building ───────────────────────────────────────────────────────

function buildSearchQuery(topic: string): string {
  // Clean the topic but keep it largely intact — PubMed handles natural language well
  return topic
    .replace(/according to .+/i, "")
    .replace(/management of /i, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// ─── Relevance check ──────────────────────────────────────────────────────

function isTitleRelevant(title: string, topic: string): boolean {
  const IGNORE = new Set([
    "a", "an", "the", "of", "in", "for", "and", "or", "to", "with",
    "on", "at", "from", "by", "is", "are", "was", "were", "be",
    "its", "it", "this", "that", "as", "vs", "per",
  ]);

  const topicWords = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !IGNORE.has(w));

  const titleLower = title.toLowerCase();

  return topicWords.some((w) => titleLower.includes(w));
}

// ─── PubMed ───────────────────────────────────────────────────────────────

async function findRelevantPubMedResult(
  idList: string[],
  topic: string,
  ncbiKey: string,
  specialty: SpecialtyProfile | null
): Promise<{ label: string; title: string; url: string; tier: number } | null> {
  for (const pmid of idList) {
    const summaryUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
      `?db=pubmed&id=${pmid}&retmode=json&api_key=${ncbiKey}`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) continue;
    const summaryData = await summaryRes.json();
    const articleData = summaryData?.result?.[pmid];
    const title = articleData?.title as string | undefined;
    if (!title) continue;
    if (!isTitleRelevant(title, topic)) continue;

    const label = specialty ? specialty.societyLabel : "PubMed";
    return {
      label,
      title: title.replace(/\.$/, "").slice(0, 80),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      tier: 1,
    };
  }
  return null;
}

async function fetchPubMed(
  topic: string,
  ncbiKey: string,
  specialty: SpecialtyProfile | null
): Promise<{ label: string; title: string; url: string; tier: number } | null> {
  try {
    const keywords = buildSearchQuery(topic);

    let query = keywords;
    if (specialty) {
      const journalQuery = specialty.journalFilters.join(" OR ");
      query = `(${keywords}) AND (${journalQuery})`;
    }

    const searchUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
      `?db=pubmed&term=${encodeURIComponent(query)}` +
      `&retmax=5&retmode=json&sort=relevance&api_key=${ncbiKey}`;

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const primaryIds: string[] = searchData?.esearchresult?.idlist ?? [];

    const primaryHit = await findRelevantPubMedResult(
      primaryIds,
      topic,
      ncbiKey,
      specialty
    );
    if (primaryHit) return primaryHit;

    if (specialty) {
      const fallbackUrl =
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
        `?db=pubmed&term=${encodeURIComponent(keywords)}` +
        `&retmax=5&retmode=json&sort=relevance&api_key=${ncbiKey}`;
      const fallbackRes = await fetch(fallbackUrl);
      if (!fallbackRes.ok) return null;
      const fallbackData = await fallbackRes.json();
      const fallbackIds: string[] = fallbackData?.esearchresult?.idlist ?? [];
      const fallbackHit = await findRelevantPubMedResult(
        fallbackIds,
        topic,
        ncbiKey,
        specialty
      );
      if (fallbackHit) return fallbackHit;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Auth & quota helpers ─────────────────────────────────────────────────

/**
 * Decode a verified JWT's payload (middle segment) to read identity claims.
 * Used for `is_anonymous`, which the DB also reads via `auth.jwt() ->> 'is_anonymous'`.
 * Returns {} on any parse failure — never throws.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const b64url = token.split(".")[1] ?? "";
    const pad = b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

// Best-effort per-instance burst limiter. Deno isolates are ephemeral (a
// module-level Map does not survive cold starts and is not shared across
// instances), so this only flattens bursts — it is NOT a distributed limit.
// The daily citation_usage quota is the authoritative control.
const BURST_LIMIT_PER_MINUTE = 10;
const burstBuckets = new Map<string, number[]>();

function checkBurstLimit(userId: string, nowMs: number): boolean {
  const cutoff = nowMs - 60_000;
  const recent = (burstBuckets.get(userId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= BURST_LIMIT_PER_MINUTE) {
    burstBuckets.set(userId, recent);
    return false;
  }
  recent.push(nowMs);
  burstBuckets.set(userId, recent);
  return true;
}

// ─── Main handler ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (
    body: unknown,
    status = 200,
    extraHeaders: Record<string, string> = {}
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
    });

  let quotaConsumed = false;
  let quotaConsumedUser: string | null = null;

  try {
    const startedAt = Date.now();
    // ── JWT verification ───────────────────────────────────────────────────
    // Identity must be proven before any work is done. The client sends the
    // user's Supabase access token as the Authorization bearer.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json({ error: "invalid_token" }, 401);
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return json({ error: "invalid_token" }, 401);
    }

    // ── SERVER-SIDE IDENTITY & ENTITLEMENT ──────────────────────────────────
    // Citation limits are derived from the verified JWT + the profiles row,
    // never from request body fields. Pro users are uncapped.
    const isAnonymous =
      user.is_anonymous === true || decodeJwtPayload(token).is_anonymous === true;

    const { data: profile } = await authClient
      .from("profiles")
      .select("is_pro, pro_expires_at")
      .eq("id", user.id)
      .maybeSingle();

    const isProUser =
      profile?.is_pro === true &&
      (profile.pro_expires_at === null ||
        new Date(profile.pro_expires_at) > new Date());

    // ── Burst rate limit (best-effort, per-instance) ────────────────────────
    if (!checkBurstLimit(user.id, Date.now())) {
      return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    }

    const { topic } = await req.json();
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return json({ citations: [] });
    }

    // ── SERVER-SIDE DAILY CITATION QUOTA ───────────────────────────────────
    // Consume one unit atomically BEFORE calling NCBI; refund below if the
    // lookup fails or finds nothing, so only delivered citations count.
    const ANON_CITATION_LIMIT = 1;
    const FREE_CITATION_LIMIT = 3;

    if (!isProUser) {
      const citationLimit = isAnonymous ? ANON_CITATION_LIMIT : FREE_CITATION_LIMIT;
      const { data: consumeResult, error: consumeError } = await authClient.rpc(
        "consume_citation",
        { p_user: user.id, p_cap: citationLimit }
      );
      if (consumeError) {
        console.error("consume_citation failed:", consumeError);
        return json({ error: "quota_check_failed" }, 500);
      }
      if (!consumeResult?.allowed) {
        return json({ citations: [], quotaExceeded: true });
      }
      quotaConsumed = true;
      quotaConsumedUser = user.id;
    }

    const NCBI_API_KEY = Deno.env.get("NCBI_API_KEY") ?? "";
    const specialty = detectSpecialty(topic);
    const result = await fetchPubMed(topic, NCBI_API_KEY, specialty);
    const citations = result ? [result] : [];

    log("lookup_complete", {
      userId: user.id,
      isAnonymous,
      isProUser,
      specialty: specialty?.name ?? null,
      citations: citations.length,
      quotaConsumed,
      elapsedMs: Date.now() - startedAt,
    });

    // Refund on failed/empty lookup — no quota burned for undelivered results.
    if (quotaConsumed && citations.length === 0) {
      try {
        await authClient.rpc("refund_citation", { p_user: user.id });
      } catch { /* best effort */ }
    }

    return json({ citations });
  } catch (e) {
    log("error", {
      error: e instanceof Error ? e.message : String(e),
      elapsedMs: Date.now() - startedAt,
    });
    // Refund the consumed unit so a crashed lookup never burns quota.
    if (quotaConsumed) {
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const refundClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        const userId = quotaConsumedUser;
        if (userId) {
          await refundClient.rpc("refund_citation", { p_user: userId });
        }
      } catch { /* best effort */ }
    }
    return json({ citations: [] });
  }
});
