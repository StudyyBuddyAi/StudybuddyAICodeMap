import { useMemo, useState, type ReactNode } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Flame,
  FlaskConical,
  Layers,
  ListChecks,
  LogIn,
  Sparkles,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import AuthModal from "@/components/AuthModal";
import { QBankHistory } from "@/components/qbank/QBankHistory";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useStudyHistory } from "@/hooks/use-study-history";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import {
  WINDOW_DAYS,
  computeStreak,
  dayKey,
  useDashboardStats,
  type Difficulty,
  type Rating,
} from "@/hooks/use-dashboard-stats";
import { formatRelative } from "@/lib/qbank-format";
import { displayName } from "@/lib/display-name";
import { MAX_DAILY_CARDS, MAX_DAILY_SHEETS, useUsageLimit } from "@/hooks/use-usage-limit";

/** One saved sheet a day — the goal the Sheets ring is drawn against. */
const WEEKLY_SHEET_GOAL = 7;

type Detail = "sheets" | "flashcards" | "qbank" | null;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A progress ring with the number written in the middle. */
function Ring({ value, label, tone }: { value: number; label: string; tone: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-border" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          className={`${tone} transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold tabular-nums text-foreground">{clamped}%</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

/** A labelled horizontal bar: how much is done, how much is left. */
function Bar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value} / {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
    </div>
  );
}

function StatBox({
  icon,
  value,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">{icon}</span>
      <div className="min-w-0 flex-1 text-start">
        <div className="text-2xl font-semibold tabular-nums leading-none text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </div>
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  );
  const cls =
    "flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors";
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={`${cls} hover:border-primary`} aria-label={hint ?? label}>
      {body}
    </button>
  );
}

function ToolCard({
  icon,
  title,
  line,
  progress,
  queue,
  allowance,
  secondary,
  primary,
}: {
  icon: ReactNode;
  title: string;
  line: ReactNode;
  progress?: number;
  queue: ReactNode;
  allowance?: string;
  secondary: { label: string; to: string };
  primary: { label: string; to: string };
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">{icon}</span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-foreground">
        <span className="min-w-0 truncate">{line}</span>
        {progress !== undefined && <span className="shrink-0 tabular-nums text-muted-foreground">{progress}%</span>}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-primary" style={{ width: `${progress ?? 0}%` }} />
      </div>
      <p className="mt-3 flex-1 text-sm text-muted-foreground">{queue}</p>
      {allowance && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> {allowance}
        </p>
      )}
      <div className="mt-5 flex gap-2.5">
        <Link
          to={secondary.to}
          className="flex h-11 flex-1 items-center justify-center rounded-full border border-border text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          {secondary.label}
        </Link>
        <Link
          to={primary.to}
          className="flex h-11 flex-1 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {primary.label}
        </Link>
      </div>
    </article>
  );
}

const RATING_ROWS: { key: Rating; label: string; tone: string }[] = [
  { key: "again", label: "Again — forgot", tone: "bg-danger" },
  { key: "hard", label: "Hard", tone: "bg-warning" },
  { key: "good", label: "Good", tone: "bg-success" },
  { key: "easy", label: "Easy", tone: "bg-info" },
];

const DIFFICULTY_ROWS: { key: Difficulty; tone: string }[] = [
  { key: "Easy", tone: "bg-success" },
  { key: "Medium", tone: "bg-warning" },
  { key: "Hard", tone: "bg-danger" },
];

function Dashboard() {
  const navigate = useNavigate();
  const { isAnonymous, user, loading: authLoading } = useAuth();
  // Not while the session is still being read: a signed-in student would see
  // the guest prompt flash before their progress.
  const isGuest = !authLoading && (!user || isAnonymous);
  const [detail, setDetail] = useState<Detail>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const { history } = useStudyHistory();
  const { stats: deck, today, allCards } = useFlashcardDeck();

  // Decks for the Flashcards dialog, as the QBank dialog lists its sets: one
  // row per topic, most due first, each opening straight into its cards.
  const deckRows = useMemo(() => {
    const byTopic = new Map<string, { topic: string; total: number; due: number; last: number }>();
    const nowMs = Date.now();
    for (const c of allCards) {
      const topic = c.topic || "Untitled";
      const row = byTopic.get(topic) ?? { topic, total: 0, due: 0, last: 0 };
      row.total += 1;
      if (c.dueAt <= nowMs) row.due += 1;
      row.last = Math.max(row.last, c.createdAt ?? 0);
      byTopic.set(topic, row);
    }
    return [...byTopic.values()].sort((a, b) => b.due - a.due || b.last - a.last).slice(0, 5);
  }, [allCards]);
  const { stats, isLoading } = useDashboardStats();

  const now = Date.now();
  const weekStart = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sheetsThisWeek = history.filter((h) => h.timestamp >= weekStart);

  // Today's cards: what has been studied against what is still waiting. The
  // study day turns over at 4 am, as the deck's own queue does.
  const reviewedToday = today.newCards + today.reviews;
  const cardsDone = stats ? stats.reviewsThisWeek : 0;
  const dueNow = deck.due;

  const activeDays = new Set(stats?.activeDays ?? []);
  sheetsThisWeek.forEach((h) => activeDays.add(dayKey(h.timestamp)));
  const streak = computeStreak(activeDays, now);

  const qbank = stats?.qbank;
  const accuracy = qbank ? pct(qbank.correct, qbank.answered) : 0;
  const lastSet = stats?.unfinished[0];
  const lastSetTotal = lastSet ? Math.max(lastSet.expected_total, lastSet.question_count) : 0;

  const loading = <span className="text-muted-foreground">…</span>;

  // What is left of today's free allowance, on each tool's card.
  const { sheetCount, cardsCount, isProUser } = useUsageLimit();
  const left = (used: number, cap: number, noun: string) =>
    isProUser ? "Unlimited with Pro" : `${Math.max(0, cap - used)} of ${cap} ${noun} left today`;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl space-y-8">
        {/* A greeting, on the page itself rather than in a box. Sign-in is
            already in the bar above, so for a guest it is a link in the line. */}
        <PageHeader
          label="Dashboard"
          title={authLoading ? "\u00a0" : isGuest ? "Your dashboard" : `Welcome back, ${displayName(user)}`}
          description={
            <>
              <p>Pick up where you left off, or start a new topic.</p>
              {isGuest && (
                <p className="mt-1 text-sm">
                  You're studying as a guest.{" "}
                  <button
                    type="button"
                    onClick={() => setAuthOpen(true)}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Sign in
                  </button>{" "}
                  to save your progress and access the QBank.
                </p>
              )}
            </>
          }
        />

        {/* This week, in numbers. Each box opens what it counts. */}
        <section aria-labelledby="week-title">
          <h2 id="week-title" className="mb-3 text-sm font-semibold text-foreground">
            Last {WINDOW_DAYS} days
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBox
              icon={<FileText className="h-5 w-5" />}
              value={sheetsThisWeek.length}
              label="Sheets saved"
              hint="Show the sheets saved in the last 7 days"
              onClick={() => setDetail("sheets")}
            />
            <StatBox
              icon={<Layers className="h-5 w-5" />}
              value={isGuest ? deck.total : isLoading ? loading : cardsDone}
              label={isGuest ? "Cards in your deck" : "Cards reviewed"}
              hint="Show flashcard statistics"
              onClick={() => setDetail("flashcards")}
            />
            <StatBox
              icon={<FlaskConical className="h-5 w-5" />}
              value={isGuest ? "—" : isLoading ? loading : (qbank?.answered ?? 0)}
              label={isGuest ? "Sign in for the QBank" : "Questions answered"}
              hint="Show QBank statistics and past sets"
              onClick={isGuest ? () => setAuthOpen(true) : () => setDetail("qbank")}
            />
            <StatBox
              icon={<Flame className="h-5 w-5" />}
              value={streak}
              label={streak === 1 ? "Day in a row" : "Days in a row"}
            />
          </div>
        </section>

        {/* The same numbers as progress: what each ring is measured against is written under it. */}
        <section aria-labelledby="summary-title" className="rounded-2xl border border-border bg-card p-5">
          <h2 id="summary-title" className="mb-5 text-sm font-semibold text-foreground">
            Your progress
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex items-center gap-4">
              <Ring value={pct(sheetsThisWeek.length, WEEKLY_SHEET_GOAL)} label="of goal" tone="stroke-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">Weekly sheets</p>
                <p className="text-xs text-muted-foreground">
                  {sheetsThisWeek.length} of {WEEKLY_SHEET_GOAL} — goal: one a day
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Ring
                value={pct(reviewedToday, reviewedToday + dueNow)}
                label="done"
                tone="stroke-success"
              />
              <div>
                <p className="text-sm font-semibold text-foreground">Today's cards</p>
                <p className="text-xs text-muted-foreground">
                  {dueNow === 0 && reviewedToday === 0
                    ? "No cards due today"
                    : `${dueNow} left to review today`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Ring value={accuracy} label="correct" tone="stroke-info" />
              <div>
                <p className="text-sm font-semibold text-foreground">QBank accuracy</p>
                <p className="text-xs text-muted-foreground">
                  {isGuest
                    ? "Sign in to practise questions"
                    : qbank && qbank.answered > 0
                    ? `${qbank.correct} of ${qbank.answered} correct this week`
                    : "No questions answered this week"}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The three tools, each with what is waiting in it. */}
        <section aria-labelledby="tools-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="tools-title" className="text-sm font-semibold text-foreground">
              Study tools
            </h2>
            <Link
              to="/roadmap"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-dashed border-primary px-4 text-sm font-semibold text-primary transition-colors hover:bg-secondary"
            >
              <ListChecks className="h-4 w-4" /> Topic checklist <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <ToolCard
              icon={<FileText className="h-4 w-4" />}
              title="Study Sheets"
              line={history[0] ? `Last: ${history[0].topic}` : "No sheets saved yet"}
              progress={pct(sheetsThisWeek.length, WEEKLY_SHEET_GOAL)}
              queue={`${sheetsThisWeek.length} of ${WEEKLY_SHEET_GOAL} this week`}
              allowance={left(sheetCount, MAX_DAILY_SHEETS, "sheets")}
              secondary={{ label: "Library", to: "/library" }}
              primary={{ label: "New sheet", to: "/sheets" }}
            />
            <ToolCard
              icon={<Layers className="h-4 w-4" />}
              title="Flashcards"
              line={`${reviewedToday} studied today`}
              progress={pct(reviewedToday, reviewedToday + dueNow)}
              queue={deck.total === 0 ? "No flashcards yet" : `${dueNow} cards waiting today · ${deck.total} in your deck`}
              allowance={left(cardsCount, MAX_DAILY_CARDS, "decks")}
              secondary={{ label: "New deck", to: "/flashcards" }}
              primary={
                dueNow > 0
                  ? { label: `Review ${dueNow} due`, to: "/flashcards?review=due" }
                  : { label: "Your decks", to: "/library" }
              }
            />
            <ToolCard
              icon={<FlaskConical className="h-4 w-4" />}
              title="QBank"
              line={lastSet ? `Set you left off: ${lastSet.topic ?? lastSet.system}` : "No set in progress"}
              progress={lastSet ? pct(lastSet.answered_count, lastSetTotal) : 0}
              queue={
                lastSet
                  ? `${lastSet.answered_count} of ${lastSetTotal} answered · ${formatRelative(lastSet.last_activity_at)}`
                  : isGuest
                  ? "Sign in to practise USMLE-style questions"
                  : "Name a topic to start a set"
              }
              allowance={isGuest ? undefined : "No daily limit"}
              secondary={{ label: "New set", to: "/qbank" }}
              primary={
                lastSet
                  ? { label: "Resume", to: `/qbank/session?session=${lastSet.id}` }
                  : { label: "Start", to: "/qbank" }
              }
            />
          </div>
        </section>
      </div>

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {detail === "sheets" && (
            <>
              <DialogHeader>
                <DialogTitle>Sheets saved in the last {WINDOW_DAYS} days</DialogTitle>
                <DialogDescription>
                  {sheetsThisWeek.length} of your weekly goal of {WEEKLY_SHEET_GOAL}.
                </DialogDescription>
              </DialogHeader>
              {sheetsThisWeek.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sheets saved this week yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {sheetsThisWeek.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate text-foreground">{h.topic}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(h.timestamp).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => navigate("/library")}
                className="mt-2 h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground"
              >
                Open your Library
              </button>
            </>
          )}

          {detail === "flashcards" && (
            <>
              <DialogHeader>
                <DialogTitle>Flashcards</DialogTitle>
                <DialogDescription>
                  {deck.total} cards in your deck · {deck.mastered} mastered · {dueNow} due today
                </DialogDescription>
              </DialogHeader>
              {isGuest ? (
                <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
                  <p className="text-sm text-foreground">
                    Your review history and ratings are saved once you sign in — on every device.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setDetail(null);
                      setAuthOpen(true);
                    }}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  >
                    <LogIn className="h-4 w-4" /> Sign in to save your progress
                  </button>
                </div>
              ) : stats && stats.reviewsThisWeek > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-foreground">
                    {stats.reviewsThisWeek} reviews in the last {WINDOW_DAYS} days
                    {stats.retention !== null && ` · ${stats.retention}% remembered (30 days)`}
                  </p>
                  {RATING_ROWS.map((row) => (
                    <Bar
                      key={row.key}
                      label={row.label}
                      value={stats.reviewsByRating[row.key]}
                      total={stats.reviewsThisWeek}
                      tone={row.tone}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No reviews this week yet.</p>
              )}
              {deckRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your decks</p>
                  <ul className="space-y-2">
                    {deckRows.map((d) => (
                      <li key={d.topic}>
                        <button
                          type="button"
                          onClick={() => navigate(`/flashcards?deck=${encodeURIComponent(d.topic)}`)}
                          className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-start transition-colors hover:border-primary"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{d.topic}</span>
                            <span className="block text-xs text-muted-foreground">
                              {d.total} cards{d.due > 0 ? ` · ${d.due} due` : ""}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                onClick={() => navigate(dueNow > 0 ? "/flashcards?review=due" : "/library")}
                className={`mt-2 h-11 w-full rounded-full text-sm font-semibold ${
                  isGuest ? "border border-border text-foreground" : "bg-primary text-primary-foreground"
                }`}
              >
                {dueNow > 0 ? `Review ${dueNow} due cards` : "Open your decks"}
              </button>
            </>
          )}

          {detail === "qbank" && qbank && (
            <>
              <DialogHeader>
                <DialogTitle>QBank — last {WINDOW_DAYS} days</DialogTitle>
                <DialogDescription>
                  {qbank.answered} questions answered · {qbank.correct} correct ({accuracy}%)
                </DialogDescription>
              </DialogHeader>
              {qbank.answered > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Correct, by difficulty
                  </p>
                  {DIFFICULTY_ROWS.map((row) => (
                    <Bar
                      key={row.key}
                      label={row.key}
                      value={qbank.byDifficulty[row.key].correct}
                      total={qbank.byDifficulty[row.key].answered}
                      tone={row.tone}
                    />
                  ))}
                </div>
              )}
              <div className="mt-2 space-y-3">
                <QBankHistory />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </DashboardLayout>
  );
}

export default Dashboard;
