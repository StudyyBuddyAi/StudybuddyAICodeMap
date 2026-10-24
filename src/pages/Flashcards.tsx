import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { useBackdropScene } from "@/components/backdrop/backdrop-scene";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
import FlashcardsIntro from "@/components/flashcards/FlashcardsIntro";
import { useFlashcardDeck, makeCardId, useDeckGrounding, type Card as DeckCard } from "@/hooks/use-flashcard-deck";
import { useRatingKeys, useStudySession } from "@/hooks/use-study-session";
import { useToast } from "@/hooks/use-toast";
import { shouldSuggestOptimize } from "@/lib/fsrs-items";
import { formatInterval, newSrsFields, type ReviewRating } from "@/lib/spaced-repetition";

const RECENT_DECK_LIMIT = 3;

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
  // One column until a review session starts — generating included. Switching
  // layouts remounts the generator, and a remount mid-request lost the topic
  // and the deck being written: the page sat on "generating" for good.
  const idle = !session;

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


  // ── Session lifecycle ─────────────────────────────────────────────────
  // The open session is written into the URL (?review=due, ?review=all,
  // ?deck=<topic>), so Back from another page — or a reload — returns to the
  // cards rather than the empty generator, and the dashboard can link straight
  // to today's review.
  const [searchParams] = useSearchParams();
  const sessionKey = searchParams.get("deck") ? `deck:${searchParams.get("deck")}` : searchParams.get("review") ? `review:${searchParams.get("review")}` : null;

  const keyToSearch = (key: string) => {
    const [kind, ...rest] = key.split(":");
    const value = rest.join(":");
    return kind === "deck" ? `?deck=${encodeURIComponent(value)}` : `?review=${encodeURIComponent(value)}`;
  };

  const pushedKeyRef = useRef<string | null>(null);
  const startSession = (cards: DeckCard[], topic: string, key?: string) => {
    if (!s.start(cards, topic)) {
      toast({ title: "No cards to review", variant: "destructive" });
      return false;
    }
    setSlidePhase("idle");
    setRightPhase("reviewing");
    setConfigDrawerOpen(false);
    if (key && key !== sessionKey) {
      // Until the router reports the new URL, a render can still see none:
      // remember it so the effect below doesn't take that for "Back".
      pushedKeyRef.current = key;
      navigate({ pathname: "/flashcards", search: keyToSearch(key) });
    }
    return true;
  };

  const endSession = () => {
    s.end();
    setRightPhase("idle");
    setConfigDrawerOpen(false);
    pushedKeyRef.current = null;
    if (sessionKey) navigate("/flashcards", { replace: true });
  };

  const handleStartDue = () => startSession(dueCards, "Today's review", "review:due");
  // Studying cards that aren't due is an early review. FSRS accounts for the
  // short elapsed time, so these ratings still update the schedule honestly.
  const handleReviewAny = () => startSession(allCards, "All cards", "review:all");
  // A deck picks up where the student left it: the cards still due (or new)
  // come first, and only a deck with nothing due is studied in full, as an
  // early review. Reopening a half-done deck no longer starts it over.
  const deckCards = (topic: string) => {
    const deck = allCards.filter((c) => c.topic === topic);
    const now = Date.now();
    const due = deck.filter((c) => c.dueAt <= now);
    return due.length > 0 ? due : deck;
  };
  const handleStudyDeck = (topic: string) => startSession(deckCards(topic), topic, `deck:${topic}`);

  // Open the session the URL names, once the cards it needs have loaded; and
  // close it when the URL loses it (Back out of a session).
  const openedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (sessionKey && pushedKeyRef.current === sessionKey) {
      pushedKeyRef.current = null;
      openedKeyRef.current = sessionKey;
      return;
    }
    if (!sessionKey) {
      if (pushedKeyRef.current) return;
      openedKeyRef.current = null;
      if (s.active) {
        s.end();
        setRightPhase("idle");
      }
      return;
    }
    if (s.active || openedKeyRef.current === sessionKey || allCards.length === 0) return;
    openedKeyRef.current = sessionKey;
    const [kind, ...rest] = sessionKey.split(":");
    const value = rest.join(":");
    const ok =
      kind === "deck"
        ? startSession(deckCards(value), value)
        : value === "all"
        ? startSession(allCards, "All cards")
        : startSession(dueCards, "Today's review");
    if (!ok) navigate("/flashcards", { replace: true });
  }, [sessionKey, allCards, dueCards]); // eslint-disable-line react-hooks/exhaustive-deps

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
    startSession(sessionCards, topic, `deck:${topic}`);
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
  // The Library hands a topic over as `prefill`: it lands in the box, and the
  // student shapes the deck and presses Generate — nothing is spent unasked.
  useEffect(() => {
    const state = location.state as { topic?: string; prefill?: string } | null;
    const topic = state?.topic?.trim();
    const prefill = state?.prefill?.trim();
    if (!topic && !prefill) return;
    navigate(location.pathname + location.search, { replace: true, state: null });
    window.dispatchEvent(
      topic
        ? new CustomEvent("studybuddy:generate-flashcards", { detail: { topic, cardCount: 12 } })
        : new CustomEvent("studybuddy:prefill-flashcards", { detail: { topic: prefill } })
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
        wide={idle}
      />
    </div>
  );

  // ── Right pane ────────────────────────────────────────────────────────
  const rightPaneContent =
    rightPhase === "generating" ? (
      // One slim panel under the button: what is being written, and that it is
      // moving. No stack of placeholder cards pretending to be the deck.
      <div
        key="generating"
        role="status"
        aria-live="polite"
        className="pane-crossfade flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm"
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary motion-safe:animate-spin" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            Writing your {genTopic || "new"} deck
          </p>
          <p className="text-xs text-muted-foreground">
            Usually 20–40 seconds. Your review starts as soon as it's ready.
          </p>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border" aria-hidden>
            <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[fc-progress_1.4s_ease-in-out_infinite]" />
          </div>
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
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-info/40 bg-info-soft px-4 text-sm font-semibold text-info transition-colors hover:border-info"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Explain this card
                  </button>
                </div>
                <RatingButtons
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
        {totalDecks > 0 && (
          <div className="space-y-4">
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
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  See all {totalDecks} decks in your Library
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
        <PageHeader label="Flashcards" title="New flashcard deck" aside={<FlashcardsIntro />} />

        {idle ? (
          // Nothing under way: one column with the full width — the topic and
          // its options first, then popular topics and your decks with room.
          <div className="space-y-8">
            {leftPaneContent}
            {rightPaneContent}
          </div>
        ) : (
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
        )}
      </div>

      {/* ── Tablet-only (768–1023px): floating configure button ── */}
      {!idle && (
      <button
        type="button"
        onClick={() => setConfigDrawerOpen(true)}
        className="hidden md:max-lg:inline-flex fixed bottom-4 left-4 z-40 h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
      >
        <Settings2 className="h-3.5 w-3.5" />
        {session ? "Session" : "Configure"}
      </button>
      )}

      {/* ── Tablet-only: slide-out left-pane drawer. Not in the one-column
          layout, where the form is already on the page — a second copy would
          be a second generator listening for the same requests. ── */}
      {!idle && (
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
      )}

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
