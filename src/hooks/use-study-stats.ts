import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ReviewRow {
  rating: string;
  reviewed_at: string;
  /** FSRS state before the review; null for reviews logged before FSRS. */
  state_before: number | null;
}

const REVIEW_STATE = 2;

interface StudyStats {
  streak: number | null;
  retentionRate: number | null;
  cardsThisWeek: number | null;
  isLoading: boolean;
  isAnonymous: boolean;
}

const utcDateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;

const startOfUtcDay = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

function computeStreak(rows: ReviewRow[]): number {
  if (rows.length === 0) return 0;

  const dayKeys = new Set(
    rows.map((r) => utcDateKey(new Date(r.reviewed_at)))
  );

  const today = new Date();
  const todayMs = startOfUtcDay(today);

  // Start from today if there's a review today, otherwise yesterday.
  let cursorMs = dayKeys.has(utcDateKey(new Date(todayMs)))
    ? todayMs
    : todayMs - DAY_MS;

  let count = 0;
  while (dayKeys.has(utcDateKey(new Date(cursorMs)))) {
    count += 1;
    cursorMs -= DAY_MS;
  }
  return count;
}

export function useStudyStats(): StudyStats {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;

  const query = useQuery({
    queryKey: ["study-stats", userId],
    enabled: useServer,
    queryFn: async (): Promise<ReviewRow[]> => {
      const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
      const { data, error } = await supabase
        .from("review_sessions")
        .select("rating, reviewed_at, state_before")
        .eq("user_id", userId!)
        .gte("reviewed_at", since);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });

  if (!useServer) {
    return {
      streak: null,
      retentionRate: null,
      cardsThisWeek: null,
      isLoading: false,
      isAnonymous: true,
    };
  }

  if (query.isLoading || !query.data) {
    return {
      streak: null,
      retentionRate: null,
      cardsThisWeek: null,
      isLoading: query.isLoading,
      isAnonymous: false,
    };
  }

  const rows = query.data;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * DAY_MS;
  const thirtyDaysAgo = now - 30 * DAY_MS;

  const streak = computeStreak(rows);

  // True retention, as Anki reports it: the pass rate on cards that had
  // graduated to review. Learning-step repetitions are practice, not tests of
  // memory, and would drag the number down. Hard is a pass. Reviews logged
  // before FSRS carry no state, so they are counted as they come.
  const last30 = rows.filter(
    (r) =>
      new Date(r.reviewed_at).getTime() >= thirtyDaysAgo &&
      (r.state_before === REVIEW_STATE || r.state_before === null)
  );
  let retentionRate: number | null = null;
  if (last30.length >= 5) {
    const successes = last30.filter((r) => r.rating !== "again").length;
    retentionRate = Math.round((successes / last30.length) * 100);
  }

  const cardsThisWeek = rows.filter(
    (r) => new Date(r.reviewed_at).getTime() >= sevenDaysAgo
  ).length;

  return {
    streak,
    retentionRate,
    cardsThisWeek,
    isLoading: false,
    isAnonymous: false,
  };
}
