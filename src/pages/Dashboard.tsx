import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, FlaskConical, Layers, Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import TodayPanel from "@/components/dashboard/TodayPanel";
import StatsStrip from "@/components/dashboard/StatsStrip";
import PerformancePanel from "@/components/dashboard/PerformancePanel";
import GoProNudgeBanner from "@/components/dashboard/GoProNudgeBanner";
import WelcomeModal from "@/components/WelcomeModal";
import { useAuth } from "@/hooks/use-auth";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { useSheetsStats } from "@/hooks/use-sheets-stats";

/**
 * A tool, as a compact row rather than a large card.
 *
 * The four tools used to be a 2×2 grid of tall cards — the visual centre of the
 * page. That put "here is our feature list" where "here is what to do next"
 * belongs. They are now a dense row beneath TodayPanel: still one tap away,
 * no longer the headline.
 */
interface ToolProps {
  icon: React.ReactNode;
  title: string;
  hint: React.ReactNode;
  onClick?: () => void;
  comingSoon?: boolean;
}

const Tool = ({ icon, title, hint, onClick, comingSoon }: ToolProps) => {
  const body = (
    <>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] border border-border bg-background"
        style={{ color: comingSoon ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="ds-body block font-medium text-foreground">{title}</span>
          {comingSoon && (
            <span className="ds-label rounded-[var(--r-sm)] border border-border px-1.5 py-0.5">
              Soon
            </span>
          )}
        </span>
        <span className="ds-meta mt-0.5 block">{hint}</span>
      </span>
    </>
  );

  if (comingSoon) {
    return (
      <div className="ds-card flex items-center gap-3 opacity-60" aria-disabled="true">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="ds-card ds-card-interactive flex w-full items-center gap-3"
    >
      {body}
    </button>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { isAnonymous } = useAuth();
  const { stats } = useFlashcardDeck();
  const { sheetsThisWeek } = useSheetsStats();

  // Dashboard sits outside QBankProvider, so it runs its own count query. The
  // key matches QBankContext's, so React Query serves both from one cache entry.
  const qbankCount = useQuery({
    queryKey: ["qbank-count"],
    queryFn: async (): Promise<number> => {
      // select("id") not "*": the answer columns are REVOKE'd, so `*` 403s.
      const { count, error } = await supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <DashboardLayout>
      <WelcomeModal />

      <div className="ds-stack">
        <GoProNudgeBanner isRealUser={!isAnonymous} />

        <TodayPanel isAnonymous={isAnonymous} />

        {/* Self-hides until there are finished sessions to report on, so a new
            account is not shown an empty analytics shell. */}
        <PerformancePanel />

        <StatsStrip />

        <section aria-labelledby="tools-heading">
          <h2 id="tools-heading" className="ds-label mb-3">
            Create
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tool
              icon={<FileText className="h-4 w-4" />}
              title="Study sheet"
              hint={
                sheetsThisWeek === null
                  ? "Any medical topic, structured"
                  : `${sheetsThisWeek} this week`
              }
              onClick={() => navigate("/sheets")}
            />
            <Tool
              icon={<Layers className="h-4 w-4" />}
              title="Flashcards"
              hint={
                isAnonymous
                  ? "Spaced repetition on any topic"
                  : `${stats.total} cards · ${stats.mastered} mastered`
              }
              onClick={() => navigate("/flashcards")}
            />
            <Tool
              icon={<FlaskConical className="h-4 w-4" />}
              title="QBank"
              hint={
                qbankCount.isLoading
                  ? "USMLE-style vignettes"
                  : `${qbankCount.data ?? 0} questions ready`
              }
              onClick={() => navigate("/qbank")}
            />
            <Tool
              icon={<Stethoscope className="h-4 w-4" />}
              title="Clinical cases"
              hint="OSCE-style, end to end"
              comingSoon
            />
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
