import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  FileText,
  FlaskConical,
  Layers,
  Library as LibraryIcon,
  MoreHorizontal,
  Search,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StudyMode from "@/components/StudyMode";
import OutputSection from "@/components/OutputSection";
import AuthModal from "@/components/AuthModal";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLibraryTopics } from "@/hooks/use-library-topics";
import { useSavedSheetLayer } from "@/hooks/use-sheet-layer";
import type { StudyHistoryItem } from "@/hooks/use-study-history";
import type { Card as DeckCard } from "@/hooks/use-flashcard-deck";
import { useToast } from "@/hooks/use-toast";
import { timeAgo } from "@/lib/utils";
import {
  filterAndSortTopics,
  type LibraryFilter,
  type LibrarySort,
  type LibraryTopic,
  type NextStepKind,
} from "@/lib/library-topics";

const PAGE = 12;

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "recent", label: "Recently studied" },
  { value: "due", label: "Most cards due" },
  { value: "weakest", label: "Weakest first" },
  { value: "az", label: "A–Z" },
];

type Pending = { kind: "deck" | "sheets"; topic: LibraryTopic } | null;

/** One of the four numbers at the top; each is also the filter it counts. */
function SummaryTile({
  icon,
  value,
  label,
  active,
  onClick,
  tone = "text-primary",
}: {
  icon: ReactNode;
  value: number;
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 flex-col items-start gap-2 rounded-2xl border bg-card p-3 text-start transition-colors sm:flex-row sm:items-center sm:gap-3 sm:p-4 ${
        active ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/60"
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-secondary sm:h-10 sm:w-10 ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-none tabular-nums text-foreground">{value}</span>
        <span className="mt-1 block text-xs leading-snug text-muted-foreground">{label}</span>
      </span>
    </button>
  );
}

/** One tool's line inside a topic card: what exists, and the action for it. */
function ToolRow({
  icon,
  label,
  status,
  detail,
  action,
  muted,
}: {
  icon: ReactNode;
  label: string;
  status: ReactNode;
  detail?: ReactNode;
  action?: { label: string; onClick: () => void };
  muted: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
          muted ? "border border-dashed border-border text-muted-foreground" : "bg-primary/10 text-primary"
        }`}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`truncate text-sm ${muted ? "text-muted-foreground" : "text-foreground"}`}>{status}</p>
        {detail}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

const NEXT_ICON: Record<NextStepKind, ReactNode> = {
  review: <CalendarClock className="h-4 w-4" aria-hidden />,
  "practice-weak": <Target className="h-4 w-4" aria-hidden />,
  "make-deck": <Layers className="h-4 w-4" aria-hidden />,
  practice: <FlaskConical className="h-4 w-4" aria-hidden />,
  "write-sheet": <FileText className="h-4 w-4" aria-hidden />,
  study: <Layers className="h-4 w-4" aria-hidden />,
};

const Library = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { topics, history, deleteSheet, deck, signedIn, setsLoading } = useLibraryTopics();
  const { allCards, reviewCard, deleteCard, settings } = deck;

  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [studyCards, setStudyCards] = useState<DeckCard[] | null>(null);
  const [activeSheet, setActiveSheet] = useState<StudyHistoryItem | null>(null);
  // The open sheet's personal layer: its highlights, edits and notes show here.
  const activeLayer = useSavedSheetLayer(activeSheet?.id ?? null);

  const counts = useMemo(
    () => ({
      all: topics.length,
      due: topics.reduce((n, t) => n + (t.deck?.due ?? 0), 0),
      weak: topics.filter((t) => t.weak).length,
      gaps: topics.filter((t) => t.coverage < 3).length,
    }),
    [topics]
  );

  const shown = useMemo(() => filterAndSortTopics(topics, { filter, sort, query }), [topics, filter, sort, query]);

  const pickFilter = (next: LibraryFilter) => {
    setFilter((cur) => (cur === next ? "all" : next));
    setVisible(PAGE);
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const deckCardsOf = (t: LibraryTopic) => allCards.filter((c) => t.deck?.names.includes(c.topic || "Untitled"));

  /** Due and new cards first; a deck with nothing waiting is studied in full. */
  const studyDeck = (t: LibraryTopic) => {
    const cards = deckCardsOf(t);
    const now = Date.now();
    const waiting = cards.filter((c) => c.dueAt <= now);
    setStudyCards(waiting.length > 0 ? waiting : cards);
  };
  const writeSheet = (t: LibraryTopic) => navigate("/sheets", { state: { topic: t.title } });
  const makeDeck = (t: LibraryTopic) => navigate("/flashcards", { state: { prefill: t.title } });
  const practise = (t: LibraryTopic) =>
    signedIn ? navigate("/qbank", { state: { topic: t.title } }) : setAuthOpen(true);
  const openSheet = (id: string) => setActiveSheet(history.find((h) => h.id === id) ?? null);

  const runNext = (t: LibraryTopic) => {
    switch (t.next.kind) {
      case "review":
      case "study":
        return studyDeck(t);
      case "make-deck":
        return makeDeck(t);
      case "write-sheet":
        return writeSheet(t);
      default:
        return practise(t);
    }
  };

  const confirmDelete = async () => {
    if (!pending) return;
    const { kind, topic } = pending;
    setPending(null);
    try {
      if (kind === "deck") {
        await Promise.all(deckCardsOf(topic).map((c) => deleteCard(c.id)));
        toast({ title: `Deleted the ${topic.title} deck`, description: "Reviews you've done still count in your stats." });
      } else {
        await Promise.all(topic.sheets.map((s) => deleteSheet(s.id)));
        toast({ title: `Deleted ${topic.sheets.length === 1 ? "the sheet" : `${topic.sheets.length} sheets`} on ${topic.title}` });
      }
    } catch {
      toast({ title: "Couldn't delete everything. Please try again.", variant: "destructive" });
    }
  };

  return (
    <DashboardLayout wide>
      {studyCards && (
        <StudyMode
          dueCards={studyCards}
          liveCards={allCards}
          onReview={reviewCard}
          settings={settings}
          onClose={() => setStudyCards(null)}
        />
      )}

      <div className="min-w-0 space-y-6 sm:space-y-8">
        <PageHeader
          label="Library"
          title="Your topics"
          description="Every topic you've studied, with its sheet, deck and QBank results together — and what to do next."
        />

        {topics.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center sm:p-10">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <LibraryIcon className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-4 text-base font-semibold text-foreground">Your library is empty</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Every sheet you save and every deck you make lands here, gathered by topic.
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2.5 sm:flex-row">
              <Link to="/sheets" className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
                Write a study sheet
              </Link>
              <Link to="/flashcards" className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-semibold text-foreground">
                Make a deck
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* What needs attention, in four numbers. Each one filters the list. */}
            <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryTile
                icon={<LibraryIcon className="h-5 w-5" />}
                value={counts.all}
                label="Topics"
                active={filter === "all"}
                onClick={() => pickFilter("all")}
              />
              <SummaryTile
                icon={<CalendarClock className="h-5 w-5" />}
                value={counts.due}
                label={counts.due === 1 ? "Card due now" : "Cards due now"}
                active={filter === "due"}
                onClick={() => pickFilter("due")}
                tone="text-warning"
              />
              <SummaryTile
                icon={<AlertTriangle className="h-5 w-5" />}
                value={counts.weak}
                label={signedIn ? "Weak spots in the QBank" : "Weak spots (sign in)"}
                active={filter === "weak"}
                onClick={() => pickFilter("weak")}
                tone="text-danger"
              />
              <SummaryTile
                icon={<Sparkles className="h-5 w-5" />}
                value={counts.gaps}
                label="Topics missing a tool"
                active={filter === "gaps"}
                onClick={() => pickFilter("gaps")}
                tone="text-info"
              />
            </section>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setVisible(PAGE);
                  }}
                  placeholder="Search your topics…"
                  aria-label="Search your topics"
                  className="h-11 rounded-xl ps-9"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="shrink-0">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as LibrarySort)}
                  className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-auto"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {query
                  ? `No topic matches “${query}”.`
                  : filter === "due"
                  ? "Nothing is due — every deck is up to date."
                  : filter === "weak"
                  ? signedIn
                    ? "No weak spots: every topic you've practised is at 60% or better."
                    : "Sign in to practise in the QBank and see your weak spots."
                  : "Every topic has a sheet, a deck and a QBank set."}
                {filter !== "all" && (
                  <button type="button" onClick={() => pickFilter("all")} className="ms-2 font-semibold text-primary hover:underline">
                    Show all topics
                  </button>
                )}
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shown.slice(0, visible).map((t) => (
                  <li key={t.key}>
                    <TopicCard
                      topic={t}
                      signedIn={signedIn}
                      setsLoading={setsLoading}
                      onNext={() => runNext(t)}
                      onOpenSheet={() => t.sheets[0] && openSheet(t.sheets[0].id)}
                      onWriteSheet={() => writeSheet(t)}
                      onStudyDeck={() => studyDeck(t)}
                      onMakeDeck={() => makeDeck(t)}
                      onPractise={() => practise(t)}
                      onOpenSet={(id) => navigate(`/qbank/summary?session=${id}`)}
                      onDeleteDeck={() => setPending({ kind: "deck", topic: t })}
                      onDeleteSheets={() => setPending({ kind: "sheets", topic: t })}
                    />
                  </li>
                ))}
              </ul>
            )}

            {shown.length > visible && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisible((n) => n + PAGE)}
                  className="h-11 rounded-full border border-border px-6 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  Show more ({shown.length - visible} left)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "deck"
                ? `Delete the ${pending.topic.title} deck?`
                : `Delete the sheet on ${pending?.topic.title ?? ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "deck"
                ? `Its ${pending.topic.deck?.total ?? 0} cards are removed. Reviews you've already done stay in your stats and streak.`
                : "The sheet, with your highlights and notes on it, is removed. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!activeSheet} onOpenChange={(o) => !o && setActiveSheet(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader className="flex-row items-center gap-3 space-y-0 pe-8">
            <DialogTitle className="min-w-0 flex-1 truncate">{activeSheet?.topic}</DialogTitle>
            {activeSheet && (
              <button
                type="button"
                onClick={() =>
                  navigate("/sheets", {
                    state: {
                      saved: {
                        input: activeSheet.input,
                        output: activeSheet.output,
                        modeInfo: activeSheet.modeInfo,
                        id: activeSheet.id,
                      },
                    },
                  })
                }
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Open in Sheets
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </DialogHeader>
          {activeSheet && (
            <ScrollArea className="max-h-[70vh] pe-2">
              <OutputSection
                output={activeSheet.output}
                inputText={activeSheet.input}
                modeInfo={activeSheet.modeInfo}
                savedId={activeSheet.id}
                personal={
                  activeLayer
                    ? {
                        // Shown, not changed: the sheet opens on the Sheets page for that.
                        layer: activeLayer,
                        entitled: false,
                        ready: true,
                        readOnly: true,
                        update: () => {},
                        onLocked: () => {},
                        context: { topic: activeSheet.topic },
                      }
                    : undefined
                }
              />
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} reason="Sign in to practise this topic in the QBank." />
    </DashboardLayout>
  );
};

function TopicCard({
  topic: t,
  signedIn,
  setsLoading,
  onNext,
  onOpenSheet,
  onWriteSheet,
  onStudyDeck,
  onMakeDeck,
  onPractise,
  onOpenSet,
  onDeleteDeck,
  onDeleteSheets,
}: {
  topic: LibraryTopic;
  signedIn: boolean;
  setsLoading: boolean;
  onNext: () => void;
  onOpenSheet: () => void;
  onWriteSheet: () => void;
  onStudyDeck: () => void;
  onMakeDeck: () => void;
  onPractise: () => void;
  onOpenSet: (id: string) => void;
  onDeleteDeck: () => void;
  onDeleteSheets: () => void;
}) {
  const mastery = t.deck && t.deck.total > 0 ? Math.round((t.deck.mastered / t.deck.total) * 100) : 0;
  const latestSet = t.qbank?.sets[0];

  return (
    <article className="flex h-full min-w-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground" title={t.title}>
            {t.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.lastActivity > 0 ? `Studied ${timeAgo(t.lastActivity)}` : "Not studied yet"}
            {t.weak && <span className="ms-1 font-semibold text-danger">· Weak spot</span>}
          </p>
        </div>
        {/* Coverage: which of the three tools this topic has been studied with. */}
        <span
          className="mt-1.5 flex shrink-0 items-center gap-1"
          title={`${t.coverage} of 3 tools used`}
          aria-label={`${t.coverage} of 3 tools used`}
        >
          {[t.sheets.length > 0, !!t.deck, !!t.qbank].map((on, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${on ? "bg-primary" : "bg-border"}`} />
          ))}
        </span>
        {(t.deck || t.sheets.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="-me-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label={`More for ${t.title}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {t.deck && (
                <DropdownMenuItem onSelect={onDeleteDeck} className="text-danger focus:text-danger">
                  <Trash2 className="me-2 h-4 w-4" /> Delete deck
                </DropdownMenuItem>
              )}
              {t.sheets.length > 0 && (
                <DropdownMenuItem onSelect={onDeleteSheets} className="text-danger focus:text-danger">
                  <Trash2 className="me-2 h-4 w-4" /> Delete {t.sheets.length === 1 ? "sheet" : "sheets"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="mt-3 divide-y divide-border">
        <ToolRow
          icon={<FileText className="h-4 w-4" />}
          label="Sheet"
          muted={t.sheets.length === 0}
          status={
            t.sheets.length === 0
              ? "No sheet yet"
              : `Saved ${timeAgo(t.sheets[0].timestamp)}${t.sheets.length > 1 ? ` · ${t.sheets.length} versions` : ""}`
          }
          action={t.sheets.length === 0 ? { label: "Write", onClick: onWriteSheet } : { label: "Read", onClick: onOpenSheet }}
        />
        <ToolRow
          icon={<Layers className="h-4 w-4" />}
          label="Deck"
          muted={!t.deck}
          status={
            t.deck
              ? `${t.deck.total} cards · ${
                  t.deck.due > 0 ? `${t.deck.due} due` : t.deck.fresh > 0 ? `${t.deck.fresh} new` : "up to date"
                }`
              : "No deck yet"
          }
          detail={
            t.deck ? (
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
                  role="progressbar"
                  aria-valuenow={mastery}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Mastered"
                >
                  <div className="h-full rounded-full bg-success" style={{ width: `${mastery}%` }} />
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">{mastery}% mastered</span>
              </div>
            ) : undefined
          }
          action={t.deck ? { label: "Study", onClick: onStudyDeck } : { label: "Make", onClick: onMakeDeck }}
        />
        <ToolRow
          icon={<FlaskConical className="h-4 w-4" />}
          label="QBank"
          muted={!t.qbank}
          status={
            !signedIn
              ? "Sign in to practise"
              : setsLoading
              ? "…"
              : t.qbank
              ? `${t.qbank.accuracy ?? 0}% correct · ${t.qbank.answered} ${t.qbank.answered === 1 ? "question" : "questions"}`
              : "Not practised yet"
          }
          detail={
            latestSet ? (
              <button
                type="button"
                onClick={() => onOpenSet(latestSet.id)}
                className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
              >
                Last set: {latestSet.score}/{latestSet.total} · review it
              </button>
            ) : undefined
          }
          action={{ label: signedIn ? "Practise" : "Sign in", onClick: onPractise }}
        />
      </div>

      {/* The one thing worth doing next for this topic, and why. */}
      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={onNext}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {NEXT_ICON[t.next.kind]}
          <span className="truncate">{t.next.label}</span>
          <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
        </button>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{t.next.why}</p>
      </div>
    </article>
  );
}

export default Library;
