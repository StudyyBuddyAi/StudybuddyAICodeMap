import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Clock, History, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatSessionDate, formatSessionTime } from "@/lib/qbank-format";

interface SessionRow {
  id: string;
  score: number;
  total: number;
  total_time_ms: number;
  system: string;
  topic: string | null;
  ended_at: string | null;
}

const getScoreColor = (score: number, total: number) => {
  const pct = total > 0 ? score / total : 0;
  if (pct >= 0.8) return "text-success";
  if (pct >= 0.6) return "text-warning";
  return "text-danger";
};

const getScoreBg = (score: number, total: number) => {
  const pct = total > 0 ? score / total : 0;
  if (pct >= 0.8) return "bg-success/10 border-success/30";
  if (pct >= 0.6) return "bg-warning/10 border-warning/30";
  return "bg-danger/10 border-danger/30";
};

const PAGE_SIZE = 5;

/** The typed topic lives in the session's generation JSON, not a column. */
const HISTORY_COLUMNS: string = "id, score, total, total_time_ms, system, topic:generation->>topic, ended_at";

const MONO_EYEBROW = "font-mono text-[11px] font-medium tracking-widest uppercase";

/**
 * Completed QBank sets, newest first, five to a page. Opens a set's summary;
 * deletes a set (its answers stay in the stats). Lives on the Dashboard — the QBank page is
 * kept to the generator.
 */
export function QBankHistory() {
  const navigate = useNavigate();
  const { user, isAnonymous } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: sessionHistory, isLoading: historyLoading } = useQuery({
    queryKey: ["qbank-sessions", user?.id, page],
    enabled: !!user && !isAnonymous,
    queryFn: async (): Promise<{ rows: SessionRow[]; hasMore: boolean }> => {
      const { data, error: queryError } = await supabase
        .from("qbank_sessions")
        .select(HISTORY_COLUMNS)
        .eq("user_id", user!.id)
        // Unfinished sets have their own list. Left in, they sorted to the top
        // (NULL ended_at sorts first descending) with a score of zero.
        .eq("status", "completed")
        .order("ended_at", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      if (queryError) throw queryError;

      const rows = (data ?? []) as unknown as SessionRow[];
      return {
        rows: rows.slice(0, PAGE_SIZE),
        hasMore: rows.length > PAGE_SIZE,
      };
    },
  });

  const handleDeleteSession = async (sessionId: string) => {
    setIsDeleting(true);
    try {
      // Only the set goes. Its answers stay as study history — the week's
      // accuracy and the streak still count them (on delete set null).
      const { error: sessionError } = await supabase
        .from("qbank_sessions")
        .delete()
        .eq("id", sessionId);

      if (sessionError) throw sessionError;

      setPendingDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["qbank-sessions"] });
    } catch {
      toast({
        title: "Failed to delete session",
        description: "Please try again.",
        variant: "destructive",
      });
      setPendingDeleteId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (

      <>
        <div className="flex items-center gap-2 mb-3">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <p className={`${MONO_EYEBROW} text-muted-foreground`}>Session History</p>
        </div>

        {historyLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg border border-border bg-secondary animate-pulse"
              />
            ))}
          </div>
        ) : !sessionHistory || sessionHistory.rows.length === 0 ? (
          <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 text-center">
            <p className="text-xs text-muted-foreground">
              No sessions yet — generate your first set to see your history here.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {sessionHistory.rows.map((s) => {
                const pct = s.total > 0 ? Math.round((s.score / s.total) * 100) : 0;

                if (pendingDeleteId === s.id) {
                  return (
                    <div
                      key={s.id}
                      className="w-full rounded-lg px-4 py-3 flex items-center justify-between gap-3 border border-danger/30 bg-danger/5"
                    >
                      <p className="text-xs font-medium text-foreground">Delete this session?</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDeleteSession(s.id)}
                          disabled={isDeleting}
                          className="flex items-center gap-1.5 rounded-md bg-danger/10 border border-danger/40 text-danger hover:bg-danger/20 text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? (
                            <span className="h-3 w-3 rounded-full border-2 border-danger/40 border-t-red-500 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/qbank/summary?session=${s.id}`)}
                    className="group flex w-full items-center gap-3.5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent)] hover:shadow-[0_14px_28px_rgba(17,85,90,0.08)]"
                  >
                    <div
                      className={`flex flex-col items-center justify-center rounded-lg border px-3 py-1.5 shrink-0 ${getScoreBg(s.score, s.total)}`}
                    >
                      <span
                        className={`text-base font-semibold tabular-nums leading-none ${getScoreColor(s.score, s.total)}`}
                      >
                        {pct}%
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">
                        {s.score}/{s.total}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {/* The topic the student typed; the system it was filed under is the fallback. */}
                        {s.topic?.trim() || s.system}
                      </p>
                      {s.topic?.trim() && s.topic.trim().toLowerCase() !== s.system.toLowerCase() && (
                        <p className="truncate text-xs text-muted-foreground">{s.system}</p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatSessionTime(s.total_time_ms)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {s.ended_at ? formatSessionDate(s.ended_at) : ""}
                        </span>
                      </div>
                    </div>

                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteId(s.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          e.preventDefault();
                          setPendingDeleteId(s.id);
                        }
                      }}
                      className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                      aria-label="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>

                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <span className="text-[11px] text-muted-foreground">Page {page + 1}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!sessionHistory.hasMore}
                className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </>
        )}
      </>
  );
}
