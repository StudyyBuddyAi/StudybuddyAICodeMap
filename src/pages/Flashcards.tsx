import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Layers, Play, Repeat, Settings2, Shuffle, Sparkles, Check, ChevronRight, ArrowLeft, RotateCcw, AlertTriangle, CheckCircle2 } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import FlashcardsGenerator, { type GeneratedCard } from "@/components/FlashcardsGenerator";
import DeckList from "@/components/DeckList";
import { CardFace, ExplainPanel } from "@/components/StudyMode";
import SheetSources from "@/components/SheetSources";
import { useFlashcardDeck, makeCardId, useDeckGrounding, type Card as DeckCard } from "@/hooks/use-flashcard-deck";
import { useToast } from "@/hooks/use-toast";
import type { GeneratedSheet } from "@/types/generated-sheet";
import AIDisclaimer from "@/components/AIDisclaimer";
import RatingButtons, { type Rating } from "@/components/RatingButtons";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsTabletBand } from "@/hooks/use-mobile";

const RECENT_DECK_LIMIT = 5;

type RightPhase = "idle" | "generating" | "reviewing";

const DueCardsReminderStrip = ({
  dueCount,
  onStartReview,
}: {
  dueCount: number;
  onStartReview: () => void;
}) => (
  <div className="flex items-center justify-between gap-2 rounded-xl border-l-4 border-l-primary border border-border bg-primary/5 p-3.5 animate-fade-in">
    <div className="flex items-center gap-2 min-w-0">
      <Repeat className="w-4 h-4 text-primary flex-shrink-0" />
      <span className="text-sm text-foreground">
        <span key={dueCount} className="flip-number font-semibold text-primary">
          {dueCount}
        </span>{" "}
        {dueCount === 1 ? "card" : "cards"} due today
      </span>
    </div>
    <button
      type="button"
      onClick={onStartReview}
      className="h-8 px-3.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5 flex-shrink-0 touch-target"
    >
      <Play className="w-3 h-3" />
      Review
    </button>
  </div>
);

function vibrate(rating: Rating | "flip") {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      const ms = rating === "easy" ? 5 : rating === "good" ? 10 : rating === "again" ? 15 : 8;
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
  const { allCards, dueCards, reviewCard, deleteCard, stats } = useFlashcardDeck();

  // ── Split-pane state ──────────────────────────────────────────────────
  const [rightPhase, setRightPhase] = useState<RightPhase>("idle");
  const [genTopic, setGenTopic] = useState("");
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  // See SheetGenerator: the Sheet portals to <body> and cannot inherit the
  // trigger's responsive display, so the band is resolved in JS.
  const inTabletBand = useIsTabletBand();

  // ── "Explain this" panel state ────────────────────────────────────────
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainScope, setExplainScope] = useState<"card" | "topic">("card");

  // ── Review session state (lifted so the left pane can mirror it) ─────
  const [session, setSession] = useState<{ cards: DeckCard[]; topic: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // One counter per rating. These used to be two — `again` was "unsure" and
  // both `good` and `easy` were lumped into "known", so a card the user marked
  // "Almost" was reported back to them as Known.
  const [ratingCounts, setRatingCounts] = useState<Record<Rating, number>>({
    again: 0,
    good: 0,
    easy: 0,
  });
  const known = ratingCounts.easy;
  const almost = ratingCounts.good;
  const unsure = ratingCounts.again;
  const [done, setDone] = useState(false);
  const [slidePhase, setSlidePhase] = useState<"idle" | "exit">("idle");

  // Deck-level retrieval metadata (sources) for the active session's topic —
  // the per-card grounded/ungrounded counts below come straight from
  // session.cards and don't need this fetch, only the guideline source list does.
  const { data: sessionGroundingMeta } = useDeckGrounding(session?.topic ?? null);
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
      answer: "The right coronary artery — this is an inferior STEMI.",
      topic: "Cardiology",
    };
  }, [allCards]);

  // ── Session lifecycle ─────────────────────────────────────────────────
  const startSession = (cards: DeckCard[], topic: string) => {
    if (!cards.length) {
      toast({ title: "No cards to review", variant: "destructive" });
      return;
    }
    setSession({ cards: cards.slice(), topic });
    setIndex(0);
    setFlipped(false);
    setRatingCounts({ again: 0, good: 0, easy: 0 });
    setDone(false);
    setSlidePhase("idle");
    setRightPhase("reviewing");
    setConfigDrawerOpen(false);
  };

  const endSession = () => {
    setSession(null);
    setRightPhase("idle");
    setIndex(0);
    setFlipped(false);
    setRatingCounts({ again: 0, good: 0, easy: 0 });
    setDone(false);
    setConfigDrawerOpen(false);
  };

  const handleStartDue = () => startSession(dueCards, "Today's review");
  const handleReviewAny = () => startSession(allCards, "All cards");
  const handleStudyDeck = (topic: string) =>
    startSession(allCards.filter((c) => c.topic === topic), topic);

  const prevCard = () => {
    if (index > 0) {
      setIndex(index - 1);
      setFlipped(false);
      setSlidePhase("idle");
    }
  };

  const nextCard = () => {
    if (session && index < session.cards.length - 1) {
      setIndex(index + 1);
      setFlipped(false);
      setSlidePhase("idle");
    }
  };

  const handleDeleteDeck = (topic: string) => {
    const toDelete = allCards.filter((c) => c.topic === topic);
    toDelete.forEach((c) => deleteCard(c.id));
    toast({ title: `Deleted ${toDelete.length} cards from "${topic}"` });
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

  const handleGenerated = (cards: GeneratedCard[], topic: string) => {
    const now = Date.now();
    const sessionCards: DeckCard[] = cards.map((c) => ({
      id: makeCardId(c.question, c.answer),
      question: c.question,
      answer: c.answer,
      tag: c.tag,
      grounded: c.grounded,
      topic: c.topic || topic,
      topicEmoji: c.topicEmoji,
      createdAt: now,
      interval: 0,
      dueAt: now,
      lastReviewed: null,
      reviewCount: 0,
    }));
    if (!sessionCards.length) {
      setRightPhase("idle");
      return;
    }
    startSession(sessionCards, topic);
  };

  // ── Review interactions (spaced repetition logic unchanged) ──────────
  const current = session?.cards[index];
  const total = session?.cards.length ?? 0;
  const reviewed = known + almost + unsure;
  const progressPct = total === 0 ? 0 : (reviewed / total) * 100;

  const handleFlip = () => {
    vibrate("flip");
    setFlipped((f) => !f);
  };

  const handleRate = (rating: Rating) => {
    if (!session || !current || slidePhase !== "idle") return;
    vibrate(rating);
    reviewCard(current.id, rating); // existing spaced-repetition logic
    setRatingCounts((prev) => ({ ...prev, [rating]: prev[rating] + 1 }));
    if (index + 1 >= session.cards.length) {
      setDone(true);
      return;
    }
    // Slide current card out left (150ms), then bring the next in from the right
    setSlidePhase("exit");
    window.setTimeout(() => {
      setFlipped(false);
      setIndex((i) => i + 1);
      setSlidePhase("idle");
    }, 150);
  };

  const shuffleRemaining = () => {
    if (!session) return;
    setSession((prev) => {
      if (!prev) return prev;
      const head = prev.cards.slice(0, index + 1);
      const tail = prev.cards.slice(index + 1);
      for (let i = tail.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tail[i], tail[j]] = [tail[j], tail[i]];
      }
      return { ...prev, cards: [...head, ...tail] };
    });
    toast({ title: "Remaining cards shuffled" });
  };

  /**
   * Re-run the whole session from the top, reshuffled.
   *
   * The completion screen's "Practice Again" used to call `shuffleRemaining`,
   * which shuffles `cards.slice(index + 1)` — always empty at session end. It
   * fired a "Remaining cards shuffled" toast and changed nothing, because
   * `done` stayed true and `index` stayed at the last card.
   */
  const restartSession = () => {
    setSession((prev) => {
      if (!prev) return prev;
      const cards = prev.cards.slice();
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      return { ...prev, cards };
    });
    setIndex(0);
    setFlipped(false);
    setRatingCounts({ again: 0, good: 0, easy: 0 });
    setDone(false);
    setSlidePhase("idle");
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
        // Omit cardCount: the generator's own default is the only value
        // guaranteed to match one of its offered options.
        detail: { topic },
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
            Card {Math.min(index + 1, total)} of {total}
          </p>
          <div className="h-1.5 w-full rounded-full overflow-hidden bg-border">
            <div
              style={{ width: `${progressPct}%` }}
              className="h-full rounded-full bg-primary transition-all duration-300"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-success">
            ✓ Got it: <span className="tabular-nums">{known}</span>
          </p>
          <p className="text-xs font-medium text-warning">
            ~ Almost: <span className="tabular-nums">{almost}</span>
          </p>
          <p className="text-xs font-medium text-danger">
            ✗ Don't know: <span className="tabular-nums">{unsure}</span>
          </p>
        </div>

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
        <DueCardsReminderStrip dueCount={stats.due} onStartReview={handleStartDue} />
      )}
      <FlashcardsGenerator
        onGeneratingChange={handleGeneratingChange}
        onGenerated={handleGenerated}
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
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-teal-500 animate-spin" />
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
            {Math.min(index + 1, total)} / {total}
          </span>
        </div>

        {done ? (
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
            <p className="text-sm text-muted-foreground mb-6">
              {reviewed} {reviewed === 1 ? "card" : "cards"} reviewed
              {" · "}✓ {known} got it{" · "}~ {almost} almost{" · "}✗ {unsure} don't know
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
                onClick={restartSession}
                className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-xl border border-border bg-card text-muted-foreground text-sm font-medium hover:border-input hover:bg-secondary transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
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
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={prevCard}
                disabled={index === 0}
                className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:border-input hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous card"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              {/* The Star and Heart buttons that used to sit here had no
                  handlers and no column on `cards` to persist to. Removed
                  rather than left as decoration — card starring needs a
                  migration first. */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={shuffleRemaining}
                  className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  aria-label="Shuffle remaining"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={nextCard}
                disabled={index === total - 1}
                className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:border-input hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next card"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Card with flip — tap to flip; keyed wrapper drives slide transitions */}
            <div
              key={current.id}
              className={slidePhase === "exit" ? "card-slide-exit-left" : "card-slide-enter-right"}
            >
              <div
                className="perspective cursor-pointer select-none"
                onClick={handleFlip}
                role="button"
                aria-label={flipped ? "Show question" : "Show answer"}
                onKeyDown={(e) => {
                  // role="button" with no tabIndex and no key handler announced a
                  // control that could not be reached or activated: the product's
                  // core loop was mouse-only. Space and Enter are what a real
                  // <button> responds to.
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleFlip();
                  }
                }}
                tabIndex={0}
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
              <RatingButtons onRate={handleRate}>
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
              </RatingButtons>
            )}

            <p className="text-center text-[11px] text-muted-foreground">
              Tap the card to flip
            </p>
            <AIDisclaimer variant="short" className="justify-center" />

            {/* Guideline sources behind this deck — same component and
                placement SheetGenerator uses below its document. Self-hides
                when the deck has no retrieval metadata (ungrounded decks,
                grounding turned off, or an anonymous user's local-only deck). */}
            {sessionGroundingMeta && sessionGroundingMeta.sources.length > 0 && (
              <SheetSources sheet={{ sources: sessionGroundingMeta.sources } as GeneratedSheet} />
            )}
          </>
        ) : null}
      </div>
    ) : (
      <div key="idle" className="pane-crossfade space-y-6">
        {/* Preview of the card you last added — or a worked example when there
            is nothing to show yet. This used to be a block of grey bars that
            read as a loading skeleton and never resolved for anyone. */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm animate-fade-in">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Layers className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-serif font-semibold text-foreground">
                {previewCard.isSample ? "What a flashcard looks like" : "Your latest card"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {previewCard.isSample
                  ? "An example while your first deck is empty"
                  : `From ${previewCard.topic}`}
              </p>
            </div>
            {previewCard.isSample && (
              <span className="ml-auto rounded-full border border-border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Example
              </span>
            )}
          </div>

          <div className="rounded-xl border border-border bg-background p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-xs font-medium text-muted-foreground">Question</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground mb-4">
              {previewCard.question}
            </p>

            <div className="border-t border-border pt-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-info" />
                <span className="text-xs font-medium text-muted-foreground">Answer</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {previewCard.answer}
              </p>
            </div>
          </div>

          {/* Illustrative only — the live controls are in the review pane. */}
          <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">
            <div className="h-10 rounded-lg border border-danger/30 bg-danger-soft flex items-center justify-center text-xs font-medium text-danger pointer-events-none select-none">
              ✗ Don't Know
            </div>
            <div className="h-10 rounded-lg border border-warning/30 bg-warning-soft flex items-center justify-center text-xs font-medium text-warning pointer-events-none select-none">
              ~ Almost
            </div>
            <div className="h-10 rounded-lg border border-success/30 bg-success-soft flex items-center justify-center text-xs font-medium text-success pointer-events-none select-none">
              ✓ Got It
            </div>
          </div>

          <p className="text-center text-[11px] text-muted-foreground mt-4">
            Select a topic on the left to generate your flashcards
          </p>
        </div>

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
    <DashboardLayout width="app">
      <div className="space-y-6">
        <header>
          <p className="ds-label ds-label-accent">Flashcards</p>
          <h1 className="ds-display mt-2">
            Study any topic,{" "}
            <span className="italic text-primary">lock it in.</span>
          </h1>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-0 lg:items-start">
          {/* ── Left pane: configurator / session status (drawer on tablet) ── */}
          <div className="min-w-0 md:max-lg:hidden lg:sticky lg:top-6 lg:self-start lg:w-[320px] lg:min-w-[320px] lg:max-w-[400px] lg:shrink-0 lg:pr-5">
            {leftPaneContent}
          </div>

          {/* ── 1px divider between panes ── */}
          <div aria-hidden className="hidden lg:block lg:w-px lg:shrink-0 lg:self-stretch bg-border" />

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

      {/* ── Tablet-only: slide-out left-pane drawer ──
          Radix Sheet for the same reasons as the sheet generator's: the old
          hand-rolled panel stayed mounted, `aria-hidden`, with focusable
          controls inside it. ── */}
      <Sheet
        open={configDrawerOpen && inTabletBand}
        onOpenChange={setConfigDrawerOpen}
      >
        <SheetContent side="left" className="w-[320px] overflow-y-auto p-4">
          <SheetHeader className="text-left">
            <SheetTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {session ? "Session" : "Configure"}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {session
                ? "Progress and controls for the review session."
                : "Choose a topic and generation settings."}
            </SheetDescription>
          </SheetHeader>
          {leftPaneContent}
        </SheetContent>
      </Sheet>

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
