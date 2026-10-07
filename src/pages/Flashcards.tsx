import { useCallback, useEffect, useMemo, useState } from "react";
import { useBackdropScene } from "@/components/backdrop/backdrop-scene";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Clock, PanelLeftClose, PanelLeftOpen, Play, Repeat, Settings2, Shuffle, SkipForward, X, Sparkles, Check, ChevronRight, RotateCcw, AlertTriangle, CheckCircle2, SlidersHorizontal } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import FlashcardsGenerator, { type GeneratedCard } from "@/components/FlashcardsGenerator";
import DeckList from "@/components/DeckList";
import { CardFace, ExplainPanel } from "@/components/StudyMode";
import SheetSources from "@/components/SheetSources";
import { ModelCredit } from "@/components/PoweredByCorti";
import type { ModelUsed } from "@/lib/model-used";
import RatingButtons from "@/components/flashcards/RatingButtons";
import SrsSettingsDialog from "@/components/flashcards/SrsSettings";
import { useFlashcardDeck, makeCardId, useDeckGrounding, type Card as DeckCard } from "@/hooks/use-flashcard-deck";
import { useRatingKeys, useStudySession } from "@/hooks/use-study-session";
import { useToast } from "@/hooks/use-toast";
import { shouldSuggestOptimize } from "@/lib/fsrs-items";
import { formatInterval, newSrsFields, type ReviewRating } from "@/lib/spaced-repetition";

const RECENT_DECK_LIMIT = 5;

// The flow, as a rail rather than three explainer cards: it says the same
// thing in one line, and because it tracks where the reader actually is it
// stays useful after the first visit instead of becoming furniture.
const STEPS = ["Pick a topic", "Shape the deck", "Review on schedule"] as const;

const StepRail = ({ current }: { current: number }) => (
  <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-1 gap-y-2">
    {STEPS.map((label, i) => {
      const state = i < current ? "done" : i === current ? "active" : "todo";
      return (
        <li
          key={label}
          aria-current={state === "active" ? "step" : undefined}
          className={`inline-flex items-center gap-2 rounded-full py-1 pe-4 ps-1 text-sm font-medium transition-colors duration-300 ${
            state === "active" ? "bg-ring/10 text-[color:var(--color-accent-ink)]" : "text-foreground"
          }`}
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-300 ${
              state === "active"
                ? "bg-[color:var(--color-accent-ink)] text-[color:var(--color-accent-foreground)]"
                : state === "done"
                ? "bg-ring/15 text-[color:var(--color-accent-ink)]"
                : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {state === "done" ? <Check className="h-3.5 w-3.5" aria-label="Done" /> : i + 1}
          </span>
          {label}
        </li>
      );
    })}
  </ol>
);

/** The idle pane's specimen: a real two-sided card the reader can flip. */
const CardPreview = ({
  card,
}: {
  card: { isSample: boolean; question: string; answer: string; answerHead?: string; topic: string };
}) => {
  const [flipped, setFlipped] = useState(false);
  const faceChip =
    "inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]";
  return (
    <section aria-labelledby="fc-preview-heading" className="animate-fade-in">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="fc-preview-heading" className="font-display text-2xl font-medium tracking-[-0.01em] text-foreground">
          {card.isSample ? "What a card looks like" : "Your latest card"}
        </h2>
        {card.isSample ? (
          <span className="shrink-0 rounded-full border border-ring/50 px-3 py-0.5 text-xs font-medium text-[color:var(--color-accent-ink)]">
            Example
          </span>
        ) : (
          <span className="min-w-0 truncate text-xs text-muted-foreground">From {card.topic}</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setFlipped((v) => !v)}
        aria-label={flipped ? "Show the question" : "Show the answer"}
        className="perspective block w-full rounded-2xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className={`flip-card-y-inner relative block h-[260px] sm:h-[280px] ${flipped ? "flipped" : ""}`}>
          {/* Front — the vignette, set like a page rather than a form field. */}
          <span
            aria-hidden={flipped}
            className="flip-face absolute inset-0 flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
          >
            <span className={`${faceChip} bg-secondary text-muted-foreground`}>Question</span>
            <span className="mt-4 line-clamp-5 font-display text-lg leading-snug text-foreground sm:text-xl">
              {card.question}
            </span>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-3 text-[11px] text-muted-foreground">
              <RotateCcw className="h-3 w-3" aria-hidden />
              Tap to turn the card
            </span>
          </span>
          {/* Back — the answer leads, the reason follows. */}
          <span
            aria-hidden={!flipped}
            className="flip-face flip-face-back absolute inset-0 flex flex-col rounded-2xl border border-ring/20 bg-card p-6 shadow-sm sm:p-8"
          >
            <span className="pointer-events-none absolute inset-0 rounded-2xl bg-ring/[0.06]" aria-hidden />
            <span className={`${faceChip} relative bg-ring/10 text-[color:var(--color-accent-ink)]`}>Answer</span>
            {card.answerHead ? (
              <>
                <span className="relative mt-4 font-display text-2xl leading-tight text-foreground sm:text-3xl">
                  {card.answerHead}
                </span>
                <span className="relative mt-3 text-sm leading-relaxed text-muted-foreground">{card.answer}</span>
              </>
            ) : (
              <span className="relative mt-4 line-clamp-6 font-display text-lg leading-snug text-foreground sm:text-xl">
                {card.answer}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Illustrative only — the live controls are in the review pane. They
          wake up once the card is turned, which is when they would matter. */}
      <div
        className={`mt-4 grid grid-cols-4 gap-2 transition-opacity duration-300 ${flipped ? "opacity-100" : "opacity-45"}`}
        aria-hidden="true"
      >
        {[
          ["Again", "<1 min", "bg-danger-soft text-danger"],
          ["Hard", "6 min", "bg-warning-soft text-warning"],
          ["Good", "1 day", "bg-success-soft text-success"],
          ["Easy", "4 days", "bg-info-soft text-info"],
        ].map(([label, ivl, cls]) => (
          <div
            key={label}
            className={`pointer-events-none flex h-14 select-none flex-col items-center justify-center rounded-xl text-sm font-semibold ${cls}`}
          >
            {label}
            <span className="text-[11px] font-normal tabular-nums opacity-80">{ivl}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        After each answer you rate your recall. The rating sets when the card comes back.
      </p>
    </section>
  );
};

type RightPhase = "idle" | "generating" | "reviewing";

const DueCardsReminderStrip = ({
  dueCount,
  counts,
  onStartReview,
}: {
  dueCount: number;
  counts: { learning: number; review: number; new: number };
  onStartReview: () => void;
}) => (
  <div className="flex items-center justify-between gap-2 rounded-xl border-l-4 border-l-primary border border-border bg-primary/5 p-3.5 animate-fade-in">
    <div className="flex items-center gap-2 min-w-0">
      <Repeat className="w-4 h-4 text-primary flex-shrink-0" />
      <div className="min-w-0">
        <span className="text-sm text-foreground">
          <span key={dueCount} className="flip-number font-semibold text-primary">
            {dueCount}
          </span>{" "}
          {dueCount === 1 ? "card" : "cards"} to study today
        </span>
        {/* Anki's three queue counts: new, learning, review. */}
        <p className="text-[11px] text-muted-foreground tabular-nums">
          <span className="text-info">{counts.new} new</span>
          {" · "}
          <span className="text-danger">{counts.learning} learning</span>
          {" · "}
          <span className="text-success">{counts.review} review</span>
        </p>
      </div>
    </div>
    <button
      type="button"
      onClick={onStartReview}
      className="h-7 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5 flex-shrink-0"
    >
      <Play className="w-3 h-3" />
      Review
    </button>
  </div>
);

function vibrate(rating: ReviewRating | "flip") {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      const ms = rating === "easy" ? 5 : rating === "good" ? 10 : rating === "hard" ? 12 : rating === "again" ? 15 : 8;
      navigator.vibrate(ms);
    }
  } catch {
    // ignore
  }
}

const Flashcards = () => {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { allCards, dueCards, reviewCard, deleteCard, stats, settings, today } = useFlashcardDeck();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Split-pane state ──────────────────────────────────────────────────
  const [rightPhase, setRightPhase] = useState<RightPhase>("idle");
  // Reviewing cards is answering: the backdrop all but stops while it happens.
  useBackdropScene(rightPhase === "reviewing" ? { mode: "focus" } : null);
  const [genTopic, setGenTopic] = useState("");
  // The topic as typed in the generator, for the step rail only.
  const [draftTopic, setDraftTopic] = useState("");
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  // Desktop (lg+) left pane. Starts open; the reader collapses it once a deck
  // is on screen and the review pane takes the reclaimed width.
  const [configOpen, setConfigOpen] = useState(true);

  // ── "Explain this" panel state ────────────────────────────────────────
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainScope, setExplainScope] = useState<"card" | "topic">("card");

  // ── Review session (shared with Library's StudyMode) ─────────────────
  const s = useStudySession({ liveCards: allCards, reviewCard, settings });
  const [slidePhase, setSlidePhase] = useState<"idle" | "exit">("idle");
  const session = s.active ? { topic: s.topic ?? "", cards: s.sessionCards } : null;
  // The model behind the deck just generated, credited while that deck is studied.
  const [generatedDeck, setGeneratedDeck] = useState<{ topic: string; model: ModelUsed } | null>(null);
  const current = s.current;

  // Deck-level retrieval metadata (sources) for the card currently on screen,
  // not for the session as a whole: `session.topic` is "Today's review" or
  // "All cards" for the two mixed-deck entry points, which matches no deck row
  // and left those sessions showing no sources at all. Scoping per card is
  // what StudyMode does, and react-query caches by topic so moving between
  // cards of one deck doesn't refetch. The per-card grounded/ungrounded counts
  // below come straight from session.cards and don't need this fetch.
  const { data: sessionGroundingMeta } = useDeckGrounding(current?.topic ?? null);
  const sessionGroundedCount = session ? session.cards.filter((c) => c.grounded).length : 0;
  const sessionUngroundedCount = session ? session.cards.length - sessionGroundedCount : 0;

  const { totalDecks, recentDeckCards } = useMemo(() => {
    const latestByTopic = new Map<string, number>();
    for (const c of allCards) {
      const topic = c.topic || "Untitled";
      const cur = latestByTopic.get(topic) ?? 0;
      if (c.createdAt > cur) latestByTopic.set(topic, c.createdAt);
    }
    const recentTopics = new Set(
      Array.from(latestByTopic.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, RECENT_DECK_LIMIT)
        .map(([topic]) => topic)
    );
    const recent = allCards.filter((c) =>
      recentTopics.has(c.topic || "Untitled")
    );
    return { totalDecks: latestByTopic.size, recentDeckCards: recent };
  }, [allCards]);

  /**
   * The card shown in the idle-state preview. Anonymous users and signed-in
   * users with an empty library both fall back to a worked example rather than
   * a skeleton, so the pane never looks like it is stuck loading.
   */
  const previewCard = useMemo(() => {
    const newest = allCards.reduce<DeckCard | null>(
      (best, c) => (!best || c.createdAt > best.createdAt ? c : best),
      null
    );
    if (newest) {
      return {
        isSample: false,
        question: newest.question,
        answer: newest.answer,
        topic: newest.topic || "Untitled",
      };
    }
    return {
      isSample: true,
      question:
        "A 58-year-old man has crushing chest pain radiating to the left arm. His ECG shows ST elevation in leads II, III and aVF. Which artery is occluded?",
      answerHead: "Right coronary artery",
      answer: "ST elevation in II, III and aVF localises to the inferior wall, which the RCA supplies in most patients.",
      topic: "Cardiology",
    };
  }, [allCards]);

  // ── Session lifecycle ─────────────────────────────────────────────────
  const startSession = (cards: DeckCard[], topic: string) => {
    if (!s.start(cards, topic)) {
      toast({ title: "No cards to review", variant: "destructive" });
      return;
    }
    setSlidePhase("idle");
    setRightPhase("reviewing");
    setConfigDrawerOpen(false);
  };

  const endSession = () => {
    s.end();
    setRightPhase("idle");
    setConfigDrawerOpen(false);
  };

  const handleStartDue = () => startSession(dueCards, "Today's review");
  // Studying cards that aren't due is an early review. FSRS accounts for the
  // short elapsed time, so these ratings still update the schedule honestly.
  const handleReviewAny = () => startSession(allCards, "All cards");
  const handleStudyDeck = (topic: string) =>
    startSession(allCards.filter((c) => c.topic === topic), topic);

  const handleDeleteDeck = (topic: string) => {
    const toDelete = allCards.filter((c) => c.topic === topic);
    Promise.all(toDelete.map((c) => deleteCard(c.id)))
      .then(() => toast({ title: `Deleted ${toDelete.length} cards from "${topic}"` }))
      .catch(() => toast({ title: "Couldn't delete every card", variant: "destructive" }));
  };

  const handleDeleteCurrent = () => {
    if (!current) return;
    const id = current.id;
    s.drop(id);
    deleteCard(id)
      .then(() => toast({ title: "Card deleted" }))
      .catch(() => toast({ title: "Couldn't delete that card", variant: "destructive" }));
  };

  // ── Generation → review hand-off ─────────────────────────────────────
  const handleGeneratingChange = (generating: boolean, topic: string) => {
    if (generating) {
      setGenTopic(topic);
      setRightPhase("generating");
      setConfigDrawerOpen(false);
    } else if (rightPhase === "generating") {
      // Failed or empty generation falls back to idle; success transitions
      // to reviewing via onGenerated just after.
      setRightPhase("idle");
    }
  };

  const handleGenerated = (cards: GeneratedCard[], topic: string, model: ModelUsed | null) => {
    setGeneratedDeck(model ? { topic, model } : null);
    const now = Date.now();
    // Placeholders only: the session looks each card up in the saved deck first,
    // so a regenerated card that already has a schedule keeps it.
    const sessionCards: DeckCard[] = cards.map((c) => ({
      ...newSrsFields(now),
      id: makeCardId(c.question, c.answer),
      question: c.question,
      answer: c.answer,
      tag: c.tag,
      grounded: c.grounded,
      topic: c.topic || topic,
      topicEmoji: c.topicEmoji,
      createdAt: now,
      isLeech: false,
    }));
    if (!sessionCards.length) {
      setRightPhase("idle");
      return;
    }
    startSession(sessionCards, topic);
  };

  // ── Review interactions ──────────────────────────────────────────────
  const { total, reviewed, tally, flipped } = s;
  const progressPct = total === 0 ? 0 : (reviewed / total) * 100;
  const done = s.active && s.status === "done";
  const waiting = s.active && s.status === "wait";

  const handleFlip = useCallback(() => {
    vibrate("flip");
    s.flip();
  }, [s]);

  const handleRate = useCallback(
    (rating: ReviewRating) => {
      if (!current || slidePhase !== "idle") return;
      vibrate(rating);
      // Slide current card out left (150ms), then the next comes in from the right.
      setSlidePhase("exit");
      window.setTimeout(() => {
        s.rate(rating);
        setSlidePhase("idle");
      }, 150);
    },
    [current, slidePhase, s]
  );

  useRatingKeys({
    enabled: s.active && !!current && !explainOpen && !settingsOpen,
    flipped,
    onFlip: handleFlip,
    onRate: handleRate,
  });

  const shuffleRemaining = () => {
    s.shuffle();
    toast({ title: "Remaining cards shuffled" });
  };

  /**
   * The "Generate flashcards" nudge on /sheets navigates here with a topic.
   * FlashcardsGenerator already listens for `studybuddy:generate-flashcards`
   * and is mounted on this page, so hand the topic straight to it. The history
   * entry is then cleared so a refresh doesn't regenerate.
   */
  useEffect(() => {
    const topic = (location.state as { topic?: string } | null)?.topic?.trim();
    if (!topic) return;
    navigate(location.pathname, { replace: true, state: null });
    window.dispatchEvent(
      new CustomEvent("studybuddy:generate-flashcards", {
        detail: { topic, cardCount: 12 },
      })
    );
  }, [location, navigate]);

  // ── Left pane ─────────────────────────────────────────────────────────
  const leftPaneContent = session ? (
    <div
      key="session"
      className="pane-crossfade rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm font-serif font-semibold text-foreground leading-tight">
          {session.topic}
        </p>
        {generatedDeck && generatedDeck.topic === session.topic && (
          <div className="flex">
            <ModelCredit used={generatedDeck.model} compact />
          </div>
        )}

        {/* Persistent grounding summary — this is the one place in Study Mode
            that states the positive count, not just a warning when something's
            ungrounded (see docs/flashcard-grounding.md, "silence = grounded"
            per-card design; this session-level line makes that legible). */}
        {session.cards.length > 0 && (
          sessionUngroundedCount > 0 ? (
            <div className="flex items-start gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>
                {sessionUngroundedCount === session.cards.length
                  ? "Generated from general medical knowledge — verify before exam use."
                  : `${sessionUngroundedCount} of ${session.cards.length} cards use general knowledge, not a verified guideline.`}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-1.5 text-[11px] text-success">
              <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
              <span>All {session.cards.length} cards are grounded in the guideline library.</span>
            </div>
          )
        )}

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {reviewed} reviewed · {s.remaining} left
          </p>
          <div className="h-1.5 w-full rounded-full overflow-hidden bg-border">
            <div
              style={{ width: `${progressPct}%` }}
              className="h-full rounded-full bg-primary transition-all duration-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-medium tabular-nums">
          <p className="text-danger">Again: {tally.again}</p>
          <p className="text-warning">Hard: {tally.hard}</p>
          <p className="text-success">Good: {tally.good}</p>
          <p className="text-info">Easy: {tally.easy}</p>
        </div>
        {tally.again > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Cards you forgot come back later in this session.
          </p>
        )}

        <div className="border-t border-border" aria-hidden />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={endSession}
            className="w-full h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium hover:border-input hover:bg-secondary transition-colors"
          >
            End Session
          </button>
          <button
            type="button"
            onClick={shuffleRemaining}
            className="w-full h-9 rounded-lg border-none bg-transparent text-muted-foreground text-sm font-medium hover:text-foreground transition-colors flex items-center justify-center gap-2"
          >
            <Shuffle className="w-4 h-4" />
            Shuffle remaining
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div key="config" className="pane-crossfade space-y-4">
      {stats.due > 0 && totalDecks > 0 && (
        <DueCardsReminderStrip dueCount={stats.due} counts={stats.counts} onStartReview={handleStartDue} />
      )}
      {totalDecks > 0 && (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Study settings · {Math.round(settings.desiredRetention * 100)}% retention, {settings.newPerDay} new/day
          {shouldSuggestOptimize(today.totalReviews, settings.weightsUpdatedAt, settings.weightsReviewCount) && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              Ready to optimize
            </span>
          )}
        </button>
      )}
      <FlashcardsGenerator
        onGeneratingChange={handleGeneratingChange}
        onGenerated={handleGenerated}
        onTopicChange={setDraftTopic}
      />
    </div>
  );

  // ── Right pane ────────────────────────────────────────────────────────
  const rightPaneContent =
    rightPhase === "generating" ? (
      <div key="generating" className="pane-crossfade mx-auto w-full max-w-[560px] space-y-4">
        {/* AI Generation Progress */}
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-serif font-semibold text-foreground">
                AI is generating your flashcards
              </h3>
              <p className="text-sm text-muted-foreground">
                {genTopic || "new"} flashcards…
              </p>
            </div>
            {/* Progress steps */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 text-primary font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Analyzing
              </span>
              <ChevronRight className="w-3 h-3" />
              <span className="flex items-center gap-1 text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-border" />
                Creating
              </span>
              <ChevronRight className="w-3 h-3" />
              <span className="flex items-center gap-1 text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-border" />
                Finalizing
              </span>
            </div>
          </div>
        </div>
        
        {/* Card skeletons */}
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="section-reveal rounded-xl border border-border bg-card h-48 p-5"
              style={{ animationDelay: `${i * 150}ms` }}
            >
              <div className="skeleton-shimmer h-5 w-24 rounded-lg bg-border mb-3" />
              <div className="skeleton-shimmer h-3.5 w-3/4 rounded bg-border mb-2" />
              <div className="skeleton-shimmer h-3.5 w-2/3 rounded bg-border mb-2" />
              <div className="skeleton-shimmer h-3.5 w-1/2 rounded bg-border" />
            </div>
          ))}
        </div>
      </div>
    ) : rightPhase === "reviewing" && session ? (
      <div key="reviewing" className="pane-crossfade mx-auto w-full max-w-[560px] space-y-4">
        {/* Progress bar with card counter */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div
                style={{ width: `${progressPct}%` }}
                className="h-full rounded-full bg-primary transition-all duration-300"
              />
            </div>
          </div>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {reviewed} / {total}
          </span>
        </div>

        {waiting ? (
          <div className="text-center py-16 px-6 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-serif font-semibold text-foreground mb-2">
              Almost there.
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {s.remaining} {s.remaining === 1 ? "card is" : "cards are"} still in learning, next due in{" "}
              {formatInterval(Math.max(0, (s.waitUntil ?? Date.now()) - Date.now()))}. Waiting lets
              the memory settle — or keep going now.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={s.studyAhead}
                className="h-10 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Study them now
              </button>
              <button
                type="button"
                onClick={endSession}
                className="h-10 px-6 rounded-xl border border-border bg-card text-muted-foreground text-sm font-medium hover:border-input hover:bg-secondary transition-colors"
              >
                Finish for now
              </button>
            </div>
          </div>
        ) : done ? (
          <div className="text-center py-16 px-6 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-primary" />
            </div>
            <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-primary mb-3">
              Session complete
            </p>
            <h2 className="text-2xl font-serif font-semibold text-foreground mb-2">
              All cards reviewed.
            </h2>
            <p className="text-sm text-muted-foreground mb-6 tabular-nums">
              {reviewed} {reviewed === 1 ? "review" : "reviews"}
              {" · "}{tally.again} again{" · "}{tally.hard} hard{" · "}{tally.good} good{" · "}{tally.easy} easy
            </p>
            
            {/* Post-session actions */}
            <div className="flex flex-wrap justify-center gap-3 mb-6">
              <button
                type="button"
                onClick={endSession}
                className="h-10 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
              <button
                type="button"
                onClick={s.restart}
                title="Go through these cards again. Extra reviews today barely move their schedule."
                className="h-10 px-6 rounded-xl border border-border bg-card text-muted-foreground text-sm font-medium hover:border-input hover:bg-secondary transition-colors inline-flex items-center"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Practice Again
              </button>
            </div>
            
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                to="/qbank"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Play className="w-3 h-3" />
                Practice QBank
              </Link>
              <span className="text-muted-foreground">·</span>
              <Link
                to="/library"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <BookOpen className="w-3 h-3" />
                View Library
              </Link>
            </div>
          </div>
        ) : current ? (
          <>
            {/* Card actions bar */}
            {/* Browsing back and forth without rating doesn't fit a spaced
                repetition queue — the order is the schedule. Skip moves the
                card to the back instead. */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {current.isLeech && (
                  <span
                    title="Forgotten repeatedly. Try Explain this card, or rewrite or delete it."
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border border-danger/40 bg-danger/10 text-danger"
                  >
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Leech
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {current.state === 0 ? "New card" : current.state === 2 ? `Review · ${current.lapses} lapses` : "Learning"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={shuffleRemaining}
                  className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  aria-label="Shuffle remaining"
                  title="Shuffle remaining"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={s.skip}
                  disabled={!s.canSkip}
                  className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:border-input hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Skip for now"
                  title="Skip for now"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
                {current.isLeech && (
                  <button
                    type="button"
                    onClick={handleDeleteCurrent}
                    className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:border-danger hover:text-danger transition-colors"
                    aria-label="Delete this card"
                    title="Delete this card"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Card with flip — tap to flip; keyed wrapper drives slide transitions */}
            <div
              key={`${current.id}-${reviewed}`}
              className={slidePhase === "exit" ? "card-slide-exit-left" : "card-slide-enter-right"}
            >
              <div
                className="perspective cursor-pointer select-none"
                onClick={handleFlip}
                role="button"
                aria-label={flipped ? "Tap to show question" : "Tap to show answer"}
              >
                <div
                  className={`flip-card-y-inner relative h-[280px] sm:h-[320px] ${flipped ? "flipped" : ""}`}
                >
                  {/* Front — question */}
                  <div className="flip-face absolute inset-0 w-full">
                    <CardFace card={current} text={current.question} />
                  </div>
                  {/* Back — answer */}
                  <div className="flip-face flip-face-back absolute inset-0 w-full">
                    <CardFace card={current} text={current.answer} showCitation />
                  </div>
                </div>
              </div>
            </div>

            {!flipped ? (
              <button
                type="button"
                onClick={handleFlip}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Show Answer
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => { setExplainScope("card"); setExplainOpen(true); }}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-info transition-colors"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Explain this card
                  </button>
                </div>
                <RatingButtons
                  previews={s.previews}
                  onRate={handleRate}
                  disabled={slidePhase !== "idle"}
                />
              </div>
            )}

            <p className="text-center text-[11px] text-muted-foreground">
              Tap the card to flip · AI-generated content · Not a substitute for clinical judgment
            </p>

            {/* Guideline sources behind this card's deck — same component and
                placement SheetGenerator uses below its document. Self-hides
                when the deck has no retrieval metadata (ungrounded decks,
                grounding turned off, or an anonymous user's local-only deck).
                The deck's topic is what was retrieved on, so it is also what
                the excerpts highlight against. */}
            {sessionGroundingMeta && sessionGroundingMeta.sources.length > 0 && (
              <SheetSources sources={sessionGroundingMeta.sources} query={current.topic} />
            )}
          </>
        ) : null}
      </div>
    ) : (
      <div key="idle" className="pane-crossfade space-y-6">
        {/* The card you last added — or a worked example when there is
            nothing to show yet, so the pane never reads as stuck loading. */}
        <CardPreview card={previewCard} />

        {totalDecks > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-serif font-semibold text-foreground">
                My decks
              </h3>
              <span className="text-xs text-muted-foreground">{totalDecks} decks</span>
            </div>
            <DeckList
              cards={recentDeckCards}
              onStudyDeck={handleStudyDeck}
              onDeleteDeck={handleDeleteDeck}
              onReviewAll={handleReviewAny}
            />
            {totalDecks > RECENT_DECK_LIMIT && (
              <div className="pl-1">
                <Link
                  to="/library"
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
                >
                  View all in Library
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    );

  return (
    <DashboardLayout wide>
      <div className="space-y-6">
        <div className="mb-6">
          <p className="font-mono text-[11px] font-medium tracking-[0.18em] uppercase text-[color:var(--color-accent-ink)] mb-3">
            Flashcards · Spaced repetition
          </p>
          <h1 className="text-[clamp(30px,4.6vw,48px)] font-display font-normal leading-[1.05] tracking-[-0.02em] text-foreground">
            Study any topic,{" "}
            <span className="italic text-[color:var(--color-accent-ink)]">lock it in.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Enter any medical topic — a deck of vignette cards is written for it,
            then scheduled so you see each one just before it slips.
          </p>
        </div>

        <StepRail current={session || rightPhase === "generating" ? 2 : draftTopic.trim() ? 1 : 0} />

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-0 lg:items-start">
          {/* ── Left pane: configurator / session status (drawer on tablet).
              On desktop it collapses to zero width so the right pane, which is
              `lg:flex-1`, grows into the space — the width animates rather than
              the pane being display:none'd inside a column that keeps its size.
              Below lg it always stacks above and the toggle is hidden. ── */}
          <div
            id="flashcards-configurator"
            className={`min-w-0 md:max-lg:hidden lg:sticky lg:top-6 lg:self-start lg:shrink-0 lg:overflow-hidden motion-safe:lg:transition-[width,opacity] motion-safe:lg:duration-300 motion-safe:lg:ease-out ${
              configOpen
                ? "lg:w-[420px] lg:min-w-[420px] lg:max-w-[440px] lg:pr-5 lg:opacity-100"
                : "lg:invisible lg:w-0 lg:min-w-0 lg:max-w-0 lg:pr-0 lg:opacity-0"
            }`}
          >
            {leftPaneContent}
          </div>

          {/* ── Toggle rail between the panes. Carries the 1px divider the old
              spacer drew, plus the collapse control. ── */}
          <div className="hidden lg:flex lg:w-9 lg:shrink-0 lg:flex-col lg:items-center lg:self-stretch lg:border-l lg:border-border">
            <button
              type="button"
              onClick={() => setConfigOpen((v) => !v)}
              aria-expanded={configOpen}
              aria-controls="flashcards-configurator"
              aria-label={configOpen ? "Hide configuration" : "Show configuration"}
              title={configOpen ? "Hide configuration" : "Show configuration"}
              className="sticky top-6 mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {configOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* ── Right pane ── */}
          <div className="min-w-0 lg:flex-1 lg:pl-8">
            {rightPaneContent}
          </div>
        </div>
      </div>

      {/* ── Tablet-only (768–1023px): floating configure button ── */}
      <button
        type="button"
        onClick={() => setConfigDrawerOpen(true)}
        className="hidden md:max-lg:inline-flex fixed bottom-4 left-4 z-40 h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
      >
        <Settings2 className="h-3.5 w-3.5" />
        {session ? "Session" : "Configure"}
      </button>

      {/* ── Tablet-only: slide-out left-pane drawer ── */}
      <div
        className={`hidden md:max-lg:block fixed inset-0 z-50 ${
          configDrawerOpen ? "" : "pointer-events-none"
        }`}
        aria-hidden={!configDrawerOpen}
      >
        <div
          className={`absolute inset-0 bg-black/50 motion-safe:transition-opacity motion-safe:duration-200 ${
            configDrawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setConfigDrawerOpen(false)}
        />
        <div
          className={`absolute inset-y-0 left-0 w-[320px] overflow-y-auto bg-card border-r border-border p-4 motion-safe:transition-transform motion-safe:duration-[250ms] motion-safe:ease-out ${
            configDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {session ? "Session" : "Configure"}
            </span>
            <button
              type="button"
              onClick={() => setConfigDrawerOpen(false)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {leftPaneContent}
        </div>
      </div>

      <SrsSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* ── "Explain this" panel — AI explanation for the active card ── */}
      {current && (
        <ExplainPanel
          open={explainOpen}
          scope={explainScope}
          card={current}
          onClose={() => setExplainOpen(false)}
        />
      )}
    </DashboardLayout>
  );
};

export default Flashcards;
