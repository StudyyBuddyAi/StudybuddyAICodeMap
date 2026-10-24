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
  CalendarClock,
  Play,
  Target,
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
import { timeAgo } from "@/lib/utils";
import { useLibraryTopics } from "@/hooks/use-library-topics";
import { buildTodayPlan, lastSevenDays, type PlanItem } from "@/lib/today-plan";
import { displayName } from "@/lib/display-name";
import { MAX_DAILY_CARDS, MAX_DAILY_SHEETS, useUsageLimit } from "@/hooks/use-usage-limit";

/** One saved sheet a day — the goal the Sheets ring is drawn against. */
const WEEKLY_SHEET_GOAL = 7;

type Detail = "sheets" | "flashcards" | "qbank" | null;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

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

/** One of the week's numbers: a line, a thin bar, and the dialog behind it. */
function WeekRow({
  icon,
  label,
  value,
  progress,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  progress: number;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 py-3 text-start" aria-label={`${label}: ${value}. Show details`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm text-foreground">{label}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{value}</span>
        </span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </span>
        {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

const PLAN_ICON: Record<PlanItem["kind"], ReactNode> = {
  review: <CalendarClock className="h-5 w-5" />,
  resume: <Play className="h-5 w-5" />,
  weak: <Target className="h-5 w-5" />,
  next: <Sparkles className="h-5 w-5" />,
  start: <FileText className="h-5 w-5" />,
};

const PLAN_TONE: Record<PlanItem["kind"], string> = {
  review: "bg-warning-soft text-warning",
  resume: "bg-info-soft text-info",
  weak: "bg-danger-soft text-danger",
  next: "bg-primary/10 text-primary",
  start: "bg-primary/10 text-primary",
};

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
  history.forEach((h) => activeDays.add(dayKey(h.timestamp)));
  const streak = computeStreak(activeDays, now);

  const qbank = stats?.qbank;
  const accuracy = qbank ? pct(qbank.correct, qbank.answered) : 0;
  const lastSet = stats?.unfinished[0];
  const lastSetTotal = lastSet ? Math.max(lastSet.expected_total, lastSet.question_count) : 0;

  // Topics as the Library gathers them, and today's plan built from them.
  const { topics } = useLibraryTopics();
  const plan = useMemo(
    () =>
      buildTodayPlan({
        topics,
        dueTotal: dueNow,
        unfinished: lastSet
          ? {
              id: lastSet.id,
              topic: lastSet.topic ?? lastSet.system,
              answered: lastSet.answered_count,
              total: lastSetTotal,
            }
          : null,
        signedIn: !isGuest,
      }),
    [topics, dueNow, lastSet, lastSetTotal, isGuest]
  );
  const runPlan = (item: PlanItem) =>
    item.target.kind === "sign-in"
      ? setAuthOpen(true)
      : navigate(item.target.to, item.target.state ? { state: item.target.state } : undefined);
  const recentTopics = useMemo(
    () => [...topics].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 4),
    [topics]
  );
  const week = lastSevenDays(activeDays, dayKey, now);
  const studiedToday = activeDays.has(dayKey(now));

  // What is left of today's free allowance, on each tool's card.
  const { sheetCount, cardsCount, isProUser } = useUsageLimit();
  const left = (used: number, cap: number, noun: string) =>
    isProUser ? "Unlimited with Pro" : `${Math.max(0, cap - used)} of ${cap} ${noun} left today`;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 sm:space-y-8">
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Today's plan: the week's numbers turned into what to do, most
              urgent first — the same advice the Library gives per topic. */}
          <section aria-labelledby="plan-title" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="plan-title" className="text-base font-semibold text-foreground">
                Today's plan
              </h2>
              <span className="text-xs text-muted-foreground">
                {plan.length} {plan.length === 1 ? "thing" : "things"} to do
              </span>
            </div>
            <ol className="mt-4 space-y-2.5">
              {plan.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => runPlan(item)}
                    className={`group flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-start transition-colors hover:border-primary ${
                      i === 0 ? "border-primary/50 bg-primary/5" : "border-border"
                    }`}
                  >
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-10 sm:w-10 ${PLAN_TONE[item.kind]}`}
                      aria-hidden
                    >
                      {PLAN_ICON[item.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground sm:truncate">{item.title}</span>
                      <span className="block text-xs text-muted-foreground">{item.why}</span>
                    </span>
                    <span
                      className={`hidden shrink-0 items-center gap-1 rounded-full px-3.5 py-2 text-xs font-semibold sm:inline-flex ${
                        i === 0
                          ? "bg-primary text-primary-foreground"
                          : "border border-border text-foreground group-hover:border-primary"
                      }`}
                    >
                      {item.cta}
                      <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden rtl:rotate-180" aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          </section>

          {/* This week: the streak and the seven days behind it, then the
              week's numbers — each one opens what it counts. */}
          <section aria-labelledby="week-title" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <h2 id="week-title" className="text-base font-semibold text-foreground">
              This week
            </h2>
            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-warning-soft text-warning" aria-hidden>
                <Flame className="h-6 w-6" />
              </span>
              <div>
                <p className="text-2xl font-semibold leading-none tabular-nums text-foreground">
                  {streak} {streak === 1 ? "day" : "days"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {streak === 0
                    ? "Study anything today to start a streak."
                    : studiedToday
                    ? "In a row — today counts."
                    : "In a row — study today to keep it."}
                </p>
              </div>
            </div>
            <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="Days studied this week">
              {week.map((d) => (
                <li key={d.key} className="flex flex-col items-center gap-1">
                  <span
                    className={`grid h-8 w-full place-items-center rounded-lg text-[10px] font-semibold ${
                      d.active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                    } ${d.today ? "ring-2 ring-primary/40 ring-offset-1 ring-offset-card" : ""}`}
                    aria-label={`${d.date.toLocaleDateString(undefined, { weekday: "long" })}: ${d.active ? "studied" : "no study"}`}
                  >
                    {d.active ? "✓" : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {d.date.toLocaleDateString(undefined, { weekday: "narrow" })}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 divide-y divide-border border-t border-border">
              <WeekRow
                icon={<FileText className="h-4 w-4" />}
                label="Sheets saved"
                value={`${sheetsThisWeek.length} / ${WEEKLY_SHEET_GOAL}`}
                progress={pct(sheetsThisWeek.length, WEEKLY_SHEET_GOAL)}
                onClick={() => setDetail("sheets")}
              />
              <WeekRow
                icon={<Layers className="h-4 w-4" />}
                label={isGuest ? "Cards in your decks" : "Cards reviewed"}
                value={isGuest ? String(deck.total) : isLoading ? "…" : String(cardsDone)}
                progress={pct(reviewedToday, reviewedToday + dueNow)}
                hint={dueNow > 0 ? `${dueNow} due today` : "Nothing due today"}
                onClick={() => setDetail("flashcards")}
              />
              <WeekRow
                icon={<FlaskConical className="h-4 w-4" />}
                label="QBank"
                value={isGuest ? "Sign in" : isLoading ? "…" : qbank && qbank.answered > 0 ? `${accuracy}%` : "—"}
                progress={isGuest ? 0 : accuracy}
                hint={
                  isGuest
                    ? "Sign in to practise questions"
                    : qbank && qbank.answered > 0
                    ? `${qbank.correct} of ${qbank.answered} correct`
                    : "No questions this week"
                }
                onClick={isGuest ? () => setAuthOpen(true) : () => setDetail("qbank")}
              />
            </div>
          </section>
        </div>

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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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

        {/* The topics behind the numbers: the latest few, as the Library shows
            them — which tools each has been studied with, and what's next. */}
        {recentTopics.length > 0 && (
          <section aria-labelledby="recent-title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="recent-title" className="text-sm font-semibold text-foreground">
                Recent topics
              </h2>
              <Link to="/library" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                All {topics.length} in your Library
              </Link>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recentTopics.map((t) => (
                <li key={t.key}>
                  <Link
                    to="/library"
                    className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary"
                  >
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{t.title}</span>
                      <span className="mt-1 flex shrink-0 gap-1" aria-label={`${t.coverage} of 3 tools used`}>
                        {[t.sheets.length > 0, !!t.deck, !!t.qbank].map((on, i) => (
                          <span key={i} className={`h-1.5 w-1.5 rounded-full ${on ? "bg-primary" : "bg-border"}`} />
                        ))}
                      </span>
                    </span>
                    <span className="mt-1 text-xs text-muted-foreground">Studied {timeAgo(t.lastActivity)}</span>
                    <span className={`mt-3 text-xs font-medium ${t.weak ? "text-danger" : "text-primary"}`}>
                      Next: {t.next.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
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
