import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Layers, RotateCcw, Sparkles } from "lucide-react";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";

interface SavedQBankSession {
  answered: number;
  total: number;
  system: string;
}

/** The resumable QBank session, if one was left unfinished in the last 24h. */
function useResumableSession(enabled: boolean): SavedQBankSession | null {
  const [session, setSession] = useState<SavedQBankSession | null>(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = localStorage.getItem("sb_qbank_session");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const DAY = 24 * 60 * 60 * 1000;
      const fresh = parsed.savedAt && Date.now() - parsed.savedAt < DAY;
      const usable =
        Array.isArray(parsed.questions) &&
        parsed.questions.length > 0 &&
        Array.isArray(parsed.answers);
      if (!fresh || !usable) return;
      if (parsed.answers.length >= parsed.questions.length) return;
      setSession({
        answered: parsed.answers.length,
        total: parsed.questions.length,
        system: parsed.questions[0]?.subject ?? "QBank",
      });
    } catch {
      // A malformed snapshot just means no resume offer.
    }
  }, [enabled]);

  return session;
}

/**
 * The dashboard's opening statement.
 *
 * The dashboard used to be a menu: three stat chips over a 2×2 grid of tools.
 * It showed what the product *has*, never what the student should *do*. This
 * answers that in one glance and gives it a single primary action, with the
 * tools demoted to a secondary row below.
 *
 * Three states, in priority order:
 *   1. cards are due            → review them
 *   2. a session was abandoned  → finish it
 *   3. nothing pending          → make something new
 */
const TodayPanel = ({ isAnonymous }: { isAnonymous: boolean }) => {
  const navigate = useNavigate();
  const { stats } = useFlashcardDeck();
  const resumable = useResumableSession(!isAnonymous);

  const due = isAnonymous ? 0 : stats.due;
  const hasDue = due > 0;

  return (
    <section
      className="ds-card ds-card-lg ds-rail"
      aria-labelledby="today-heading"
    >
      <p className="ds-label ds-label-accent">Today</p>

      {hasDue ? (
        <>
          <h2 id="today-heading" className="mt-3 flex items-baseline gap-3">
            <span
              className="leading-none"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "clamp(40px, 7vw, 56px)",
                fontWeight: 600,
                letterSpacing: "-0.03em",
                color: "hsl(var(--primary))",
              }}
            >
              {due}
            </span>
            <span className="ds-title text-muted-foreground font-normal">
              {due === 1 ? "card due" : "cards due"}
            </span>
          </h2>
          <p className="ds-small mt-2 max-w-[52ch]">
            Spaced repetition surfaces these just before you'd forget them.
            Clearing the queue is the highest-value ten minutes you have today.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <PrimaryAction onClick={() => navigate("/flashcards")}>
              <Layers className="h-4 w-4" />
              Start review
            </PrimaryAction>
            {resumable && (
              <SecondaryAction onClick={() => navigate("/qbank")}>
                <RotateCcw className="h-3.5 w-3.5" />
                Resume {resumable.system} · {resumable.answered}/{resumable.total}
              </SecondaryAction>
            )}
          </div>
        </>
      ) : resumable ? (
        <>
          <h2 id="today-heading" className="ds-display mt-3">
            Pick up where you left off
          </h2>
          <p className="ds-small mt-2 max-w-[52ch]">
            {resumable.system} · {resumable.answered} of {resumable.total}{" "}
            answered.
          </p>
          <div className="mt-5">
            <PrimaryAction onClick={() => navigate("/qbank")}>
              <RotateCcw className="h-4 w-4" />
              Resume session
            </PrimaryAction>
          </div>
        </>
      ) : (
        <>
          <h2 id="today-heading" className="ds-display mt-3">
            {isAnonymous ? "Start studying" : "Nothing due — build something"}
          </h2>
          <p className="ds-small mt-2 max-w-[52ch]">
            {isAnonymous
              ? "Name any medical topic and get a structured clinical sheet in seconds. No account needed to try it."
              : "Your queue is clear. Generate a sheet on this week's topic and turn it into a deck."}
          </p>
          <div className="mt-5">
            <PrimaryAction onClick={() => navigate("/sheets")}>
              <Sparkles className="h-4 w-4" />
              New study sheet
            </PrimaryAction>
          </div>
        </>
      )}
    </section>
  );
};

const PrimaryAction = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-11 items-center gap-2 rounded-[var(--r-md)] bg-primary px-5 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  >
    {children}
    <ArrowRight className="h-4 w-4 opacity-70" />
  </button>
);

const SecondaryAction = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-11 items-center gap-2 rounded-[var(--r-md)] border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    {children}
  </button>
);

export default TodayPanel;
