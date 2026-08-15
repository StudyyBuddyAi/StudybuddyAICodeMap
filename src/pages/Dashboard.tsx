import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Layers, FlaskConical, Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsStrip from "@/components/dashboard/StatsStrip";
import GoProNudgeBanner from "@/components/dashboard/GoProNudgeBanner";
import WelcomeModal from "@/components/WelcomeModal";
import { useAuth } from "@/hooks/use-auth";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { useSheetsStats } from "@/hooks/use-sheets-stats";

interface ActiveToolCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  stat: React.ReactNode;
  ctaLabel: string;
  onClick: () => void;
}

interface ComingSoonCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const ActiveToolCard = ({
  icon,
  title,
  description,
  stat,
  ctaLabel,
  onClick,
}: ActiveToolCardProps) => (
  <button
    type="button"
    onClick={onClick}
    className="group animate-fade-in text-left"
    style={{
      position: "relative",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border)",
      background: "var(--bg-elevated)",
      padding: 24,
      cursor: "pointer",
      transition: "border-color var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
      (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
      (e.currentTarget as HTMLElement).style.transform = "none";
    }}
  >
    <div style={{ marginBottom: 20 }}>
      {/* Icon */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        background: "var(--bg)",
        marginBottom: 16,
        color: "var(--accent)",
      }}>
        {icon}
      </div>

      {/* Title + description */}
      <h3 style={{
        fontFamily: "var(--font-sans)",
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: "-0.004em",
        color: "var(--fg)",
        marginBottom: 6,
      }}>
        {title}
      </h3>
      <p style={{
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        color: "var(--fg-muted)",
        lineHeight: 1.55,
      }}>
        {description}
      </p>
    </div>

    {/* Stat + CTA */}
    <div style={{
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      marginTop: 8,
    }}>
      <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>{stat}</div>
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 13,
        fontWeight: 500,
        color: "var(--accent)",
        transition: "gap var(--dur-micro) var(--ease-out)",
      }}>
        {ctaLabel}
        <span style={{ display: "inline-block", transition: "transform var(--dur-micro) var(--ease-out)" }}
          className="group-hover:translate-x-0.5">→</span>
      </span>
    </div>
  </button>
);

const ComingSoonCard = ({ icon, title, description }: ComingSoonCardProps) => (
  <div style={{
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    borderRadius: "var(--radius-lg)",
    border: "1px dashed var(--border)",
    background: "transparent",
    padding: 24,
    cursor: "default",
    opacity: 0.65,
  }}>
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 16,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          color: "var(--fg-muted)",
        }}>
          {icon}
        </div>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 8px",
          borderRadius: "var(--radius-pill)",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--fg-muted)",
        }}>
          Coming Soon
        </span>
      </div>

      <h3 style={{
        fontFamily: "var(--font-sans)",
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: "-0.004em",
        color: "var(--fg)",
        marginBottom: 6,
        opacity: 0.7,
      }}>
        {title}
      </h3>
      <p style={{
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        color: "var(--fg-muted)",
        lineHeight: 1.55,
      }}>
        {description}
      </p>
    </div>
    <div style={{ marginTop: 8, height: 32 }} />
  </div>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const { isAnonymous } = useAuth();
  const { stats } = useFlashcardDeck();
  const { sheetsThisWeek, isAnonymous: sheetsAnon } = useSheetsStats();

  const sheetStat = sheetsAnon ? (
    <span style={{ fontSize: 12, color: "var(--fg-subtle)" }}>
      Sign in to track your stats
    </span>
  ) : sheetsThisWeek === null ? (
    <span style={{ fontSize: 12, color: "var(--fg-subtle)" }}>Loading…</span>
  ) : (
    <span>
      <span style={{
        fontSize: 18,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: "var(--fg)",
      }}>
        {sheetsThisWeek}
      </span>
      <span style={{ fontSize: 12, color: "var(--fg-muted)", marginLeft: 6 }}>
        sheet{sheetsThisWeek !== 1 ? "s" : ""} this week
      </span>
    </span>
  );

  // Dashboard sits outside QBankProvider, so it runs its own count query. The
  // key matches QBankContext's, so React Query serves both from one cache entry.
  const qbankCountQuery = useQuery({
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

  const qbankStat = qbankCountQuery.isLoading ? (
    <span style={{ fontSize: 12, color: "var(--fg-subtle)" }}>Loading…</span>
  ) : (
    <span>
      <span style={{
        fontSize: 18,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: "var(--fg)",
      }}>
        {qbankCountQuery.data ?? 0}
      </span>
      <span style={{ fontSize: 12, color: "var(--fg-muted)", marginLeft: 6 }}>
        question{qbankCountQuery.data !== 1 ? "s" : ""} ready
      </span>
    </span>
  );

  const flashcardStat = isAnonymous ? (
    <span style={{ fontSize: 12, color: "var(--fg-subtle)" }}>
      Sign in to track your stats
    </span>
  ) : (
    <span>
      <span style={{
        fontSize: 18,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: "var(--fg)",
      }}>
        {stats.due}
      </span>
      <span style={{ fontSize: 12, color: "var(--fg-muted)", marginLeft: 6 }}>
        card{stats.due !== 1 ? "s" : ""} due today
      </span>
    </span>
  );

  return (
    <DashboardLayout>
      <WelcomeModal />

      <div className="space-y-8">
        <GoProNudgeBanner isRealUser={!isAnonymous} />

        <StatsStrip />

        <div style={{ marginBottom: 4 }}>
          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 4,
          }}>
            Tools · Study smarter
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--fg-muted)" }}>
            Everything you need, in one place
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ActiveToolCard
            icon={<FileText className="h-5 w-5" />}
            title="Study Sheet"
            description="Generate a high-yield, exam-ready study sheet on any medical topic in seconds."
            stat={sheetStat}
            ctaLabel="Open"
            onClick={() => navigate("/sheets")}
          />

          <ActiveToolCard
            icon={<Layers className="h-5 w-5" />}
            title="Flashcards"
            description="Build a spaced-repetition deck on any topic and drill until it sticks."
            stat={flashcardStat}
            ctaLabel="Open"
            onClick={() => navigate("/flashcards")}
          />

          <ActiveToolCard
            icon={<FlaskConical className="h-5 w-5" />}
            title="QBank"
            description="USMLE-style questions for Step 1 and Step 2 — built on NBME blueprints and clinical guidelines. Human-verified."
            stat={qbankStat}
            ctaLabel="Open"
            onClick={() => navigate("/qbank")}
          />

          <ComingSoonCard
            icon={<Stethoscope className="h-5 w-5" />}
            title="Clinical Cases"
            description="Train for OSCE exams with AI-generated clinical cases — history, examination, investigations, and management in one flow."
          />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
