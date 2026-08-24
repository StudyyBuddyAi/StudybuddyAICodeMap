import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Layers, Play, Repeat, Settings2, Shuffle, X } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import FlashcardsGenerator, { type GeneratedCard } from "@/components/FlashcardsGenerator";
import GroundingNotice from "@/components/GroundingNotice";
import DeckList from "@/components/DeckList";
import { CardFace, ExplainPanel } from "@/components/StudyMode";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFlashcardDeck, makeCardId, type Card as DeckCard } from "@/hooks/use-flashcard-deck";
import { useToast } from "@/hooks/use-toast";

const RECENT_DECK_LIMIT = 5;

type RightPhase = "idle" | "generating" | "reviewing";
type Rating = "again" | "good" | "easy";

const DueCardsReminderStrip = ({
  dueCount,
  onStartReview,
}: {
  dueCount: number;
  onStartReview: () => void;
}) => (
  <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
    borderLeft: "3px solid var(--accent)",
    background: "var(--bg-elevated)",
    padding: "10px 14px",
  }} className="animate-fade-in">
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <Repeat style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--fg)" }}>
        <span key={dueCount} className="flip-number" style={{ fontWeight: 600, color: "var(--accent)" }}>
          {dueCount}
        </span>{" "}
        {dueCount === 1 ? "card" : "cards"} due today
      </span>
    </div>
    <button
      type="button"
      onClick={onStartReview}
      style={{
        height: 28,
        padding: "0 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid transparent",
        background: "var(--fg)",
        color: "var(--bg)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
      <Play style={{ width: 11, height: 11 }} />
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
  const { allCards, dueCards, reviewCard, deleteCard, stats } = useFlashcardDeck();

  // ── Split-pane state ──────────────────────────────────────────────────
  const [rightPhase, setRightPhase] = useState<RightPhase>("idle");
  const [genTopic, setGenTopic] = useState("");
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);

  // ── "Explain this" panel state ────────────────────────────────────────
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainScope, setExplainScope] = useState<"card" | "topic">("card");

  // ── Review session state (lifted so the left pane can mirror it) ─────
  // retrievedChunks is only set for a session that came straight out of a
  // fresh generation (handleGenerated) — deck/due-card reviews leave it
  // undefined, which correctly renders no grounding notice.
  const [session, setSession] = useState<{ cards: DeckCard[]; topic: string; retrievedChunks?: number } | null>(
    null
  );
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [unsure, setUnsure] = useState(0);
  const [done, setDone] = useState(false);
  const [slidePhase, setSlidePhase] = useState<"idle" | "exit">("idle");

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
  const startSession = (cards: DeckCard[], topic: string, retrievedChunks?: number) => {
    if (!cards.length) {
      toast({ title: "No cards to review", variant: "destructive" });
      return;
    }
    setSession({ cards: cards.slice(), topic, retrievedChunks });
    setIndex(0);
    setFlipped(false);
    setKnown(0);
    setUnsure(0);
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
    setKnown(0);
    setUnsure(0);
    setDone(false);
    setConfigDrawerOpen(false);
  };

  const handleStartDue = () => startSession(dueCards, "Today's review");
  const handleReviewAny = () => startSession(allCards, "All cards");
  const handleStudyDeck = (topic: string) =>
    startSession(allCards.filter((c) => c.topic === topic), topic);

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

  const handleGenerated = (cards: GeneratedCard[], topic: string, retrievedChunks: number) => {
    const now = Date.now();
    const sessionCards: DeckCard[] = cards.map((c) => ({
      id: makeCardId(c.question, c.answer),
      question: c.question,
      answer: c.answer,
      tag: c.tag,
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
    startSession(sessionCards, topic, retrievedChunks);
  };

  // ── Review interactions (spaced repetition logic unchanged) ──────────
  const current = session?.cards[index];
  const total = session?.cards.length ?? 0;
  const reviewed = known + unsure;
  const progressPct = total === 0 ? 0 : (reviewed / total) * 100;

  const handleFlip = () => {
    vibrate("flip");
    setFlipped((f) => !f);
  };

  const handleRate = (rating: Rating) => {
    if (!session || !current || slidePhase !== "idle") return;
    vibrate(rating);
    reviewCard(current.id, rating); // existing spaced-repetition logic
    if (rating === "again") setUnsure((u) => u + 1);
    else setKnown((k) => k + 1);
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

  const quickStart = (topic: string) => {
    window.dispatchEvent(
      new CustomEvent("studybuddy:generate-flashcards", {
        detail: { topic, cardCount: 12 },
      })
    );
  };

  // ── Left pane ─────────────────────────────────────────────────────────
  const leftPaneContent = session ? (
    <div
      key="session"
      className="pane-crossfade"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-elevated)",
        padding: "20px 16px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700, color: "var(--fg)", lineHeight: 1.4, margin: 0 }}>
          {session.topic}
        </p>

        <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
          <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: 0 }}>
            Card {Math.min(index + 1, total)} of {total}
          </p>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
            <div
              style={{ width: `${progressPct}%`, background: "var(--accent)" }}
              className="h-full rounded-full transition-all duration-300"
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
          <p style={{ fontSize: 13, color: "#059669", fontWeight: 500, margin: 0 }}>
            ✓ Known: <span style={{ fontVariantNumeric: "tabular-nums" }}>{known}</span>
          </p>
          <p style={{ fontSize: 13, color: "#dc2626", fontWeight: 500, margin: 0 }}>
            ✗ Unsure: <span style={{ fontVariantNumeric: "tabular-nums" }}>{unsure}</span>
          </p>
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }} aria-hidden />

        <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
          <button
            type="button"
            onClick={endSession}
            style={{
              width: "100%",
              height: 36,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--fg)",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            End Session
          </button>
          <button
            type="button"
            onClick={shuffleRemaining}
            style={{
              width: "100%",
              height: 36,
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "transparent",
              color: "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Shuffle style={{ width: 14, height: 14 }} />
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
        <div className="flex items-center justify-center gap-3 pt-2">
          <div className="relative h-8 w-8 shrink-0">
            <div className="absolute inset-0 rounded-full border-2 border-border" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Generating your {genTopic || "new"} flashcards…
          </p>
        </div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="section-reveal"
            style={{
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              height: 200,
              padding: 20,
              animationDelay: `${i * 150}ms`,
            }}
          >
            <div className="skeleton-shimmer" style={{ height: 20, width: 96, borderRadius: "var(--radius-sm)", background: "var(--border)", marginBottom: 12 }} />
            <div className="skeleton-shimmer" style={{ height: 14, width: "91.666%", borderRadius: "var(--radius-sm)", background: "var(--border)", marginBottom: 8 }} />
            <div className="skeleton-shimmer" style={{ height: 14, width: "75%", borderRadius: "var(--radius-sm)", background: "var(--border)", marginBottom: 8 }} />
            <div className="skeleton-shimmer" style={{ height: 14, width: "66.666%", borderRadius: "var(--radius-sm)", background: "var(--border)" }} />
          </div>
        ))}
      </div>
    ) : rightPhase === "reviewing" && session ? (
      <div key="reviewing" className="pane-crossfade mx-auto w-full max-w-[560px] space-y-4">
        {session.retrievedChunks === 0 && (
          <GroundingNotice level="none" reason="no-match" />
        )}
        {/* Thin progress bar above the card */}
        <div className="h-1 w-full rounded-full bg-border overflow-hidden">
          <div
            style={{ "--sb-progress": `${progressPct}%` } as React.CSSProperties}
            className="h-full rounded-full bg-primary transition-all duration-300 w-[var(--sb-progress)]"
          />
        </div>

        {done ? (
          <div style={{ textAlign: "center" as const, padding: "64px 24px" }} className="animate-fade-in">
            <p style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--accent)",
              marginBottom: 12,
            }}>
              Session complete
            </p>
            <h2 style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 500,
              color: "var(--fg)",
              marginBottom: 8,
              lineHeight: 1.15,
            }}>
              All cards reviewed.
            </h2>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 24 }}>
              {reviewed} {reviewed === 1 ? "card" : "cards"} reviewed
              {" · "}✓ {known} known{" · "}✗ {unsure} unsure
            </p>
            <button
              type="button"
              onClick={endSession}
              style={{
                height: 40,
                padding: "0 32px",
                borderRadius: "var(--radius-md)",
                border: "1px solid transparent",
                background: "var(--fg)",
                color: "var(--bg)",
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        ) : current ? (
          <>
            {/* Card with flip — tap to flip; keyed wrapper drives slide transitions */}
            <div
              key={current.id}
              className={slidePhase === "exit" ? "card-slide-exit-left" : "card-slide-enter-right"}
            >
              <div
                className="perspective cursor-pointer select-none"
                onClick={handleFlip}
                role="button"
                aria-label={flipped ? "Tap to show question" : "Tap to show answer"}
              >
                <div
                  className={`flip-card-y-inner relative h-[260px] sm:h-[300px] ${flipped ? "flipped" : ""}`}
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
                style={{
                  width: "100%",
                  height: 44,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid transparent",
                  background: "var(--fg)",
                  color: "var(--bg)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Show Answer
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => { setExplainScope("card"); setExplainOpen(true); }}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Explain this card
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleRate("again")}
                    style={{
                      height: 44,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid rgba(220,38,38,0.3)",
                      background: "rgba(220,38,38,0.06)",
                      color: "#dc2626",
                      fontFamily: "var(--font-sans)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    ✗ Don't Know
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate("good")}
                    style={{
                      height: 44,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid rgba(217,119,6,0.3)",
                      background: "rgba(217,119,6,0.06)",
                      color: "#d97706",
                      fontFamily: "var(--font-sans)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    ~ Almost
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate("easy")}
                    style={{
                      height: 44,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid rgba(5,150,105,0.3)",
                      background: "rgba(5,150,105,0.06)",
                      color: "#059669",
                      fontFamily: "var(--font-sans)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    ✓ Got It
                  </button>
                </div>
              </div>
            )}

            <p className="text-center text-[11px] text-muted-foreground/60">
              Tap the card to flip · AI-generated content · Not a substitute for clinical judgment
            </p>
          </>
        ) : null}
      </div>
    ) : (
      <div key="idle" className="pane-crossfade space-y-8">
        <div style={{
          display: "flex",
          flexDirection: "column" as const,
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          borderRadius: "var(--radius-lg)",
          border: "1px dashed var(--border-strong)",
          padding: "80px 24px",
          textAlign: "center" as const,
        }} className="animate-fade-in">
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 48,
            height: 48,
            borderRadius: "var(--radius-lg)",
            background: "var(--accent-soft)",
          }}>
            <Layers style={{ width: 24, height: 24, color: "var(--accent)" }} />
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--fg)", marginBottom: 4 }}>
              Pick a topic to generate flashcards
            </p>
            <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>
              Your cards will appear here for review
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap" as const, justifyContent: "center", gap: 8 }}>
            {["Myocardial Infarction", "Pneumonia", "Diabetic Ketoacidosis"].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => quickStart(label)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--fg-muted)",
                  cursor: "pointer",
                  transition: "border-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out)",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
                  (e.currentTarget as HTMLElement).style.color = "var(--accent)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                  (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)";
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {totalDecks > 0 && (
          <div className="space-y-3">
            <h3 style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              paddingLeft: 4,
              marginBottom: 0,
            }}>
              My decks
            </h3>
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
        <div style={{ marginBottom: 24 }}>
          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 8,
          }}>
            Flashcards · Spaced repetition
          </p>
          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(26px, 3.5vw, 36px)",
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.012em",
            color: "var(--fg)",
            margin: 0,
          }}>
            Study any topic,{" "}
            <span style={{ fontStyle: "italic", color: "var(--accent)" }}>lock it in.</span>
          </h1>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-0 lg:items-start">
          {/* ── Left pane: configurator / session status (drawer on tablet) ── */}
          <div className="min-w-0 md:max-lg:hidden lg:sticky lg:top-6 lg:self-start lg:w-[280px] lg:min-w-[280px] lg:max-w-[280px] lg:shrink-0 lg:pr-5">
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
        className="hidden md:max-lg:inline-flex"
        style={{
          position: "fixed",
          bottom: 16,
          left: 16,
          zIndex: 40,
          height: 36,
          padding: "0 16px",
          borderRadius: "var(--radius-pill)",
          border: "1px solid transparent",
          background: "var(--fg)",
          color: "var(--bg)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 600,
          alignItems: "center",
          gap: 6,
          boxShadow: "var(--shadow-2)",
          cursor: "pointer",
        }}
      >
        <Settings2 style={{ width: 14, height: 14 }} />
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
          className={`absolute inset-y-0 left-0 w-[320px] overflow-y-auto bg-background border-r border-border p-4 motion-safe:transition-transform motion-safe:duration-[250ms] motion-safe:ease-out ${
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
