import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurriculumTopics } from "@/hooks/use-curriculum-topics";
import { buildQBankProgress, type ProgressAttempt, type ProgressSession } from "@/lib/qbank-progress";

/** PostgREST hands back at most this many rows a request; longer histories page. */
const PAGE = 1000;
/** Enough history for years of daily sets; past it, the oldest answers drop off. */
const MAX_ATTEMPTS = 20_000;
/** The typed topics live in the session's generation JSON, not a column. */
const SESSION_COLUMNS: string = "id, topic:generation->>topic, topics:generation->topics";

interface AttemptRow {
  question_id: string;
  is_correct: boolean;
  created_at: string;
  session_id: string | null;
  questions: { subject: string | null } | null;
}

interface SessionRow {
  id: string;
  topic: string | null;
  topics: unknown;
}

/**
 * Everything the progress page shows, from the student's own answers and
 * sets (both own-row reads under RLS) and the public curriculum. See
 * src/lib/qbank-progress.ts for how it is counted.
 */
export function useQBankProgress() {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const enabled = !!userId && !isAnonymous;
  const { curriculum, isLoading: curriculumLoading } = useCurriculumTopics();

  const query = useQuery({
    queryKey: ["qbank-progress", userId],
    enabled,
    queryFn: async (): Promise<{ attempts: ProgressAttempt[]; sessions: ProgressSession[] }> => {
      const attempts: ProgressAttempt[] = [];
      for (let from = 0; from < MAX_ATTEMPTS; from += PAGE) {
        const { data, error } = await supabase
          .from("user_attempts")
          .select("question_id, is_correct, created_at, session_id, questions(subject)")
          .eq("user_id", userId!)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as unknown as AttemptRow[];
        for (const r of rows) {
          attempts.push({
            questionId: r.question_id,
            isCorrect: r.is_correct,
            createdAt: r.created_at,
            sessionId: r.session_id,
            subject: r.questions?.subject ?? null,
          });
        }
        if (rows.length < PAGE) break;
      }

      const sessionIds = [...new Set(attempts.map((a) => a.sessionId).filter((id): id is string => !!id))];
      const sessions: ProgressSession[] = [];
      // In slices, so the id list never outgrows a request URL.
      for (let i = 0; i < sessionIds.length; i += 150) {
        const { data, error } = await supabase
          .from("qbank_sessions")
          .select(SESSION_COLUMNS)
          .in("id", sessionIds.slice(i, i + 150));
        if (error) throw error;
        for (const r of (data ?? []) as unknown as SessionRow[]) {
          const list = Array.isArray(r.topics) ? r.topics.filter((t): t is string => typeof t === "string") : [];
          sessions.push({ id: r.id, topics: list.length ? list : r.topic ? [r.topic] : [] });
        }
      }
      return { attempts, sessions };
    },
  });

  const progress = useMemo(
    () =>
      query.data
        ? buildQBankProgress({ attempts: query.data.attempts, sessions: query.data.sessions, curriculum })
        : null,
    [query.data, curriculum]
  );

  return {
    progress,
    signedIn: enabled,
    isLoading: enabled && (query.isLoading || curriculumLoading),
    isError: query.isError,
  };
}
