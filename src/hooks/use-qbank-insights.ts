import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Performance signal from completed QBank sessions.
 *
 * The dashboard could already tell a student how much they had done. It could
 * not tell them how they were doing, or what to fix — despite `qbank_sessions`
 * carrying score, total and system for every block they had ever finished.
 */

export interface SessionPoint {
  id: string;
  /** 0–100, rounded. */
  accuracy: number;
  endedAt: string;
  system: string;
  total: number;
}

export interface WeakestSystem {
  system: string;
  accuracy: number;
  answered: number;
}

/**
 * A system needs this many answered questions before the dashboard will call it
 * a weakness. One unlucky five-question block is not evidence, and telling a
 * student their weakest subject is a claim that should be earned.
 */
const MIN_ANSWERED_FOR_WEAKNESS = 10;

/** Sessions shown in the trend. Enough to read a direction, few enough to scan. */
const TREND_LENGTH = 10;

export function useQBankInsights() {
  const { user, isAnonymous } = useAuth();
  const enabled = !!user && !isAnonymous;

  const query = useQuery({
    queryKey: ["qbank-insights", user?.id],
    enabled,
    queryFn: async (): Promise<SessionPoint[]> => {
      const { data, error } = await supabase
        .from("qbank_sessions")
        .select("id, score, total, system, ended_at")
        .eq("user_id", user!.id)
        .order("ended_at", { ascending: false })
        .limit(40);
      if (error) throw error;

      return (data ?? [])
        .filter((r) => r.total > 0)
        .map((r) => ({
          id: r.id as string,
          accuracy: Math.round((r.score / r.total) * 100),
          endedAt: r.ended_at as string,
          system: (r.system as string) ?? "QBank",
          total: r.total as number,
        }))
        // Oldest first: a trend reads left to right.
        .reverse();
    },
  });

  const sessions = query.data ?? [];
  const trend = sessions.slice(-TREND_LENGTH);

  const overall =
    sessions.length > 0
      ? Math.round(
          sessions.reduce((sum, s) => sum + s.accuracy * s.total, 0) /
            sessions.reduce((sum, s) => sum + s.total, 0)
        )
      : null;

  // Weighted by questions answered, so a long block counts for more than a
  // short one.
  const bySystem = new Map<string, { correct: number; answered: number }>();
  for (const s of sessions) {
    const cur = bySystem.get(s.system) ?? { correct: 0, answered: 0 };
    cur.correct += (s.accuracy / 100) * s.total;
    cur.answered += s.total;
    bySystem.set(s.system, cur);
  }

  let weakest: WeakestSystem | null = null;
  for (const [system, { correct, answered }] of bySystem) {
    if (answered < MIN_ANSWERED_FOR_WEAKNESS) continue;
    const accuracy = Math.round((correct / answered) * 100);
    if (!weakest || accuracy < weakest.accuracy) {
      weakest = { system, accuracy, answered };
    }
  }

  return {
    trend,
    overall,
    weakest,
    sessionCount: sessions.length,
    isLoading: enabled && query.isLoading,
    isAvailable: enabled,
  };
}
