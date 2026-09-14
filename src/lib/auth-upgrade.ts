import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { normalizeStoredCard, type Card } from "@/hooks/use-flashcard-deck";

// ── Anonymous → permanent account upgrade ───────────────────────────────────
//
// Shared by every path that turns the anonymous session every visitor starts
// with into a real account: password sign-in, OTP-verified sign-up, and the
// Google OAuth callback. Extracted so the OAuth redirect flow (which can't
// run any of this inline — the tab's JS state is gone once the browser
// navigates to Google and back) uses the exact same logic as the two
// synchronous flows instead of a third copy.

const STORAGE_KEY = "studybuddy_decks_v1";
const HISTORY_STORAGE_KEY = "studybuddy_history";
const PENDING_KEY = "studybuddy_pending_oauth_upgrade";

type LocalHistoryItem = {
  id: string;
  topic: string;
  input: string;
  output: string;
  timestamp: number;
  modeInfo?: {
    examMode: string;
    difficulty: string;
    focus: string;
    length: string;
  };
};

export async function migrateLocalCardsToServer(userId: string): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let cards: Card[];
  try {
    const parsed = JSON.parse(raw);
    // Normalizing converts cards stored before FSRS (ladder fields only).
    cards = Array.isArray(parsed) ? parsed.map(normalizeStoredCard) : [];
  } catch {
    return;
  }
  if (!cards.length) return;

  // Group by topic
  const topicMap = new Map<string, { topic: string; emoji?: string }>();
  for (const c of cards) {
    if (!topicMap.has(c.topic)) {
      topicMap.set(c.topic, { topic: c.topic, emoji: c.topicEmoji });
    }
  }

  const deckRows = Array.from(topicMap.values()).map((t) => ({
    user_id: userId,
    topic: t.topic,
    topic_emoji: t.emoji ?? null,
  }));

  const { error: deckError } = await supabase
    .from("decks")
    .upsert(deckRows, { onConflict: "user_id,topic" });
  if (deckError) throw deckError;

  const { data: decks, error: fetchError } = await supabase
    .from("decks")
    .select("id, topic")
    .eq("user_id", userId)
    .in("topic", Array.from(topicMap.keys()));
  if (fetchError) throw fetchError;

  const deckIdByTopic = new Map<string, string>();
  for (const d of decks ?? []) deckIdByTopic.set(d.topic, d.id);

  const cardRows = cards
    .map((c) => {
      const deckId = deckIdByTopic.get(c.topic);
      if (!deckId) return null;
      return {
        user_id: userId,
        deck_id: deckId,
        client_id: c.id,
        question: c.question,
        answer: c.answer,
        tag: c.tag,
        topic: c.topic,
        topic_emoji: c.topicEmoji ?? null,
        grounded: c.grounded,
        // The FSRS schedule travels with the card, so signing up doesn't
        // reset what an anonymous student already learned.
        srs_state: c.state,
        stability: c.stability,
        difficulty: c.difficulty,
        scheduled_days: c.scheduledDays,
        learning_steps: c.learningSteps,
        lapses: c.lapses,
        is_leech: c.isLeech,
        interval_days: c.scheduledDays,
        due_at: new Date(c.dueAt ?? Date.now()).toISOString(),
        last_reviewed_at: c.lastReviewed
          ? new Date(c.lastReviewed).toISOString()
          : null,
        review_count: c.reps,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const { error: cardError } = await supabase
    .from("cards")
    .upsert(cardRows, {
      onConflict: "user_id,client_id",
      ignoreDuplicates: true,
    });
  if (cardError) throw cardError;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function migrateLocalStudyHistoryToServer(userId: string): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(HISTORY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let items: LocalHistoryItem[];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    return;
  }
  if (!items.length) return;

  const rows = items.map((item) => ({
    user_id: userId,
    topic: item.topic,
    input: item.input,
    output: item.output,
    exam_mode: item.modeInfo?.examMode ?? null,
    difficulty: item.modeInfo?.difficulty ?? null,
    focus: item.modeInfo?.focus ?? null,
    length: item.modeInfo?.length ?? null,
    created_at: new Date(item.timestamp ?? Date.now()).toISOString(),
  }));

  const { error } = await supabase.from("study_history").insert(rows);
  if (error) throw error;

  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Runs both local→server migrations, toasting (not throwing) on failure. */
export async function runPostUpgradeMigrations(userId: string): Promise<void> {
  try {
    await migrateLocalCardsToServer(userId);
  } catch {
    toast({
      title: "Couldn't sync local cards to your account, please try again later",
      variant: "destructive",
    });
  }
  try {
    await migrateLocalStudyHistoryToServer(userId);
  } catch {
    toast({
      title: "Couldn't sync local study history to your account, please try again later",
      variant: "destructive",
    });
  }
}

export type UsageRecord = { kind: string; count: number };

/** Reads today's usage_records for an anonymous user, before it's replaced. */
export async function snapshotAnonUsage(
  anonUserId: string,
  usageDate: string
): Promise<UsageRecord[]> {
  const { data } = await supabase
    .from("usage_records")
    .select("kind, count")
    .eq("user_id", anonUserId)
    .eq("usage_date", usageDate);
  return data ?? [];
}

/**
 * Re-applies an anonymous user's usage snapshot onto the real account with
 * Math.max, so signing in can't reset today's quota. No-ops when there's
 * nothing to carry over or the ids already match (nothing to merge).
 */
export async function applyAnonUsage(
  realUserId: string,
  anonUserId: string | null,
  records: UsageRecord[],
  usageDate: string
): Promise<void> {
  if (!records.length) return;
  if (!anonUserId || realUserId === anonUserId) return;

  for (const record of records) {
    const { data: existing } = await supabase
      .from("usage_records")
      .select("count")
      .eq("user_id", realUserId)
      .eq("kind", record.kind)
      .eq("usage_date", usageDate)
      .maybeSingle();

    const existingCount = existing?.count ?? 0;
    const mergedCount = Math.max(existingCount, record.count);

    await supabase
      .from("usage_records")
      .upsert(
        { user_id: realUserId, kind: record.kind, usage_date: usageDate, count: mergedCount },
        { onConflict: "user_id,kind,usage_date" }
      );
  }
}

// ── Surviving the OAuth redirect ────────────────────────────────────────────
//
// signInWithOAuth navigates the whole tab away and back. sessionStorage (not
// localStorage) is used to stash what the callback needs to finish the
// upgrade: it survives the same-tab round trip to Google and back, but a
// stash abandoned mid-flow dies with the tab instead of leaking into a later,
// unrelated visit.

export type PendingUpgrade = {
  anonUserId: string | null;
  usageDate: string;
  records: UsageRecord[];
  returnTo: string;
};

/**
 * Only ever a same-origin path. Rejects protocol-relative ("//evil.com"),
 * backslash ("/\evil.com"), and absolute URLs so a tampered sessionStorage
 * value can't turn the callback into an open redirect.
 */
function sanitizeReturnTo(path: string): string {
  if (/^\/(?!\/|\\)/.test(path)) return path;
  return "/dashboard";
}

export async function stashPendingUpgrade(
  anonUserId: string | null,
  returnTo: string
): Promise<void> {
  const usageDate = new Date().toISOString().split("T")[0];
  let records: UsageRecord[] = [];
  if (anonUserId) {
    try {
      records = await snapshotAnonUsage(anonUserId, usageDate);
    } catch {
      records = [];
    }
  }

  const pending: PendingUpgrade = {
    anonUserId,
    usageDate,
    records,
    returnTo: sanitizeReturnTo(returnTo),
  };

  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // ignore — worst case the callback falls back to /dashboard
  }
}

/** Reads and clears the pending upgrade. Returns null if there wasn't one. */
export function readPendingUpgrade(): PendingUpgrade | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingUpgrade;
    return {
      anonUserId: parsed.anonUserId ?? null,
      usageDate: parsed.usageDate,
      records: Array.isArray(parsed.records) ? parsed.records : [],
      returnTo: sanitizeReturnTo(parsed.returnTo ?? "/dashboard"),
    };
  } catch {
    return null;
  }
}

export function clearPendingUpgrade(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}
