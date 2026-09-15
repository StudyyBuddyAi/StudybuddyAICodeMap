import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, BookOpen, Layers, ArrowLeft, RotateCcw, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import RatingButtons from "@/components/flashcards/RatingButtons";
import { useRatingKeys, useStudySession } from "@/hooks/use-study-session";
import { formatInterval, type ReviewOutcome, type ReviewRating, type SrsSettings } from "@/lib/spaced-repetition";
import { getTagColors } from "@/lib/tag-colors";
import { type Card, useDeckGrounding } from "@/hooks/use-flashcard-deck";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsageLimit } from "@/hooks/use-usage-limit";
import GoProModal from "@/components/GoProModal";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/hooks/use-auth";
import { getCitationsForTopic } from "@/lib/citation-store";
import CitationBadgeList from "@/components/CitationBadgeList";
import SheetSources from "@/components/SheetSources";
import { startTopProgress, finishTopProgress } from "@/components/TopProgressBar";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";
import { ModelCredit } from "@/components/PoweredByCorti";
import { useMemoryPreference } from "@/hooks/use-memory-preference";

interface StudyModeProps {
  /** The cards this session starts with, snapshotted on mount. */
  dueCards: Card[];
  /** The live deck, so cards shown again use their updated schedule. */
  liveCards: Card[];
  onReview: (id: string, rating: ReviewRating, opts?: { durationMs?: number }) => Promise<ReviewOutcome | null>;
  settings: Pick<SrsSettings, "desiredRetention" | "weights">;
  onClose: () => void;
}

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

const StudyMode = ({ dueCards, liveCards, onReview, settings, onClose }: StudyModeProps) => {
  const s = useStudySession({ liveCards, reviewCard: onReview, settings });
  const [started, setStarted] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainScope, setExplainScope] = useState<"card" | "topic">("card");
  const [slidePhase, setSlidePhase] = useState<"idle" | "exit">("idle");

  const rootRef = useRef<HTMLDivElement>(null);

  // Snapshot session cards on mount. Focus moves into the overlay so Space
  // flips the card instead of re-pressing the deck button underneath.
  useEffect(() => {
    s.start(dueCards, "Study");
    setStarted(true);
    rootRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sessionCards = s.sessionCards;
  const current = s.current;
  const flipped = s.flipped;
  const done = started && (!s.active || s.status === "done");
  const waiting = s.active && s.status === "wait";
  const progress = s.total === 0 ? 0 : (s.reviewed / s.total) * 100;

  // Scoped to whichever card is on screen, not the whole session — a due-cards
  // or all-cards review can span multiple decks/topics, so there's no single
  // session-wide source list that would always be correct. react-query caches
  // by topic, so flipping between cards of the same deck doesn't refetch.
  const { data: currentCardGrounding } = useDeckGrounding(current?.topic ?? null);

  // Cards written before grounding existed default to grounded=false, so this
  // count is honest about them too: nothing in this session was checked
  // against a guideline unless the generator said so.
  const ungroundedCount = sessionCards.filter((c) => !c.grounded).length;
  const allUngrounded = ungroundedCount > 0 && ungroundedCount === sessionCards.length;

  const handleFlip = useCallback(() => {
    vibrate("flip");
    s.flip();
  }, [s]);

  const handleRate = useCallback(
    (rating: ReviewRating) => {
      if (!current || slidePhase !== "idle") return;
      vibrate(rating);
      // Slide current card out left (150ms), then bring the next in from the right
      setSlidePhase("exit");
      window.setTimeout(() => {
        s.rate(rating);
        setSlidePhase("idle");
      }, 150);
    },
    [current, slidePhase, s]
  );

  useRatingKeys({
    enabled: !!current && !explainOpen,
    flipped,
    onFlip: handleFlip,
    onRate: handleRate,
  });

  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-50 bg-background flex flex-col outline-none">
      {/* Progress bar */}
      <div className="h-[2px] w-full bg-border">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Close button */}
      <div className="flex justify-end p-3">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close study mode">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-4 md:pb-10 overflow-y-auto">
        {waiting ? (
          <div className="text-center space-y-4 animate-fade-in max-w-md">
            <Clock className="mx-auto h-10 w-10 text-primary" />
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Almost there.</h2>
            <p className="text-muted-foreground">
              {s.remaining} {s.remaining === 1 ? "card is" : "cards are"} still in learning, next due in{" "}
              {formatInterval(Math.max(0, (s.waitUntil ?? Date.now()) - Date.now()))}.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={s.studyAhead} className="h-10 px-6 rounded-lg font-medium">
                Study them now
              </Button>
              <Button variant="outline" onClick={onClose} className="h-10 px-6 rounded-lg font-medium">
                Finish for now
              </Button>
            </div>
          </div>
        ) : done ? (
          <div className="text-center space-y-4 animate-fade-in">
            {s.reviewed === 0 ? (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">You're all caught up.</h2>
                <p className="text-muted-foreground">
                  New cards will appear here after your next study session.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">Session complete</h2>
                <p className="text-muted-foreground tabular-nums">
                  {s.reviewed} {s.reviewed === 1 ? "review" : "reviews"} · {s.tally.again} again · {s.tally.hard} hard ·{" "}
                  {s.tally.good} good · {s.tally.easy} easy. See you next time.
                </p>
              </>
            )}
            <Button onClick={onClose} className="h-10 px-8 rounded-lg mt-4 font-medium">
              Done
            </Button>
          </div>
        ) : current ? (
          <div className="w-full max-w-xl space-y-4 md:space-y-6">
            {sessionCards.length > 0 && (
              ungroundedCount > 0 ? (
                <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-warning/40 bg-warning/10 text-warning text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {allUngrounded
                      ? "These cards were generated from general medical knowledge — verify before exam use."
                      : `${ungroundedCount} of ${sessionCards.length} cards use general knowledge, not a verified guideline.`}
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-success/40 bg-success/10 text-success text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    All {sessionCards.length} {sessionCards.length === 1 ? "card is" : "cards are"} grounded in the guideline library.
                  </span>
                </div>
              )
            )}
            {/* Card with flip — tap to flip; keyed wrapper drives slide transitions */}
            {current.isLeech && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-danger/40 bg-danger/10 text-danger text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Leech: you've forgotten this card {current.lapses} times. Try "Explain this card", or rewrite or
                  delete it from its deck.
                </span>
              </div>
            )}
            <div
              key={`${current.id}-${s.reviewed}`}
              className={slidePhase === "exit" ? "card-slide-exit-left" : "card-slide-enter-right"}
            >
              <div
                className="perspective cursor-pointer select-none"
                style={{ perspective: "1000px" }}
                onClick={handleFlip}
                role="button"
                aria-label={flipped ? "Tap to show question" : "Tap to show answer"}
              >
                <div
                  className={`flip-card-y-inner relative h-[260px] sm:h-[300px] ${flipped ? "flipped" : ""}`}
                >
                  {/* Front */}
                  <div className="flip-face absolute inset-0 w-full">
                    <CardFace card={current} text={current.question} />
                  </div>
                  {/* Back */}
                  <div className="flip-face flip-face-back absolute inset-0 w-full">
                    <CardFace card={current} text={current.answer} showCitation />
                  </div>
                </div>
              </div>
            </div>

            {!flipped ? (
              <div className="space-y-3">
                <Button
                  onClick={handleFlip}
                  className="w-full h-11 rounded-lg font-medium"
                >
                  Show Answer
                </Button>
                <div className="flex items-center justify-center">
                  <button
                    onClick={() => { setExplainScope("topic"); setExplainOpen(true); }}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Explain this question
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-5">
                  <button
                    onClick={(e) => { e.stopPropagation(); s.setFlipped(false); }}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Show question
                  </button>
                  <button
                    onClick={() => { setExplainScope("card"); setExplainOpen(true); }}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Explain this card
                  </button>
                </div>
                <RatingButtons
                  previews={s.previews}
                  onRate={handleRate}
                  disabled={slidePhase !== "idle"}
                  compact
                />
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              {s.reviewed} reviewed · {s.remaining} left
            </p>

            {/* Guideline sources behind the current card's deck — same
                component SheetGenerator renders below the document; self-hides
                when the current card's deck has no retrieval metadata. The
                deck's topic is what was retrieved on, so it is also what the
                excerpts highlight against. */}
            {currentCardGrounding && currentCardGrounding.sources.length > 0 && (
              <SheetSources sources={currentCardGrounding.sources} query={current.topic} />
            )}
          </div>
        ) : null}
      </div>

      {current && (
        <ExplainPanel
          open={explainOpen}
          scope={explainScope}
          card={current}
          onClose={() => setExplainOpen(false)}
        />
      )}
    </div>
  );
};

export const CardFace = ({
  card,
  text,
  showCitation = false,
}: {
  card: Card;
  text: string;
  showCitation?: boolean;
}) => {
  const tagColors = getTagColors(card.tag);
  const citations = showCitation ? getCitationsForTopic(card.topic) : [];
  function cardFontSize(text: string): string {
    if (text.length < 120) return "text-lg md:text-xl";
    if (text.length < 220) return "text-base md:text-lg";
    if (text.length < 350) return "text-sm";
    return "text-xs";
  }
  return (
    <div className="glass-card rounded-xl p-5 md:p-8 h-[260px] sm:h-[300px] flex flex-col gap-2.5">
      <div className="shrink-0 flex items-center gap-2.5 flex-wrap">
        {card.topicEmoji && (
          <span className="text-xl leading-none" aria-hidden>
            {card.topicEmoji}
          </span>
        )}
        <span
          className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border ${tagColors.bg} ${tagColors.text} ${tagColors.border}`}
        >
          {card.tag || "Card"}
        </span>
        {/* Every card states its grounding status explicitly — same color
            convention as DeckGroundingBadge in DeckList.tsx. */}
        {card.grounded ? (
          <span
            title="Generated from and verified against a specific clinical guideline"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border border-success/40 bg-success/10 text-success"
          >
            <CheckCircle2 className="w-2.5 h-2.5" />
            Grounded
          </span>
        ) : (
          <span
            title="Generated from general medical knowledge — not verified against a specific guideline"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border border-warning/40 bg-warning/10 text-warning"
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            Unverified
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overflow-hidden pr-1">
        <p className={`${cardFontSize(text)} font-medium leading-relaxed text-foreground`}>
          {text}
        </p>
      </div>
      {showCitation && citations.length > 0 && (
        <div className="shrink-0 mt-1">
          <CitationBadgeList state="found" citations={citations} />
        </div>
      )}
    </div>
  );
};

export default StudyMode;

const ExplainContent = ({ output }: { output: string }) => {
  const explanationMatch = output.match(/EXPLANATION\s*\n([\s\S]*?)(?=\n\s*(?:WHY\s+THIS\s+ANSWER|EXAM\s+TIP|KEY\s+INSIGHT)|$)/i);
  const whyMatch = output.match(/WHY\s+THIS\s+ANSWER\s*\n([\s\S]*?)(?=\n\s*(?:EXAM\s+TIP|KEY\s+INSIGHT)|$)/i);
  const tipMatch = output.match(/EXAM\s+TIP\s*\n([\s\S]*?)(?=\n\s*KEY\s+INSIGHT|$)/i);
  const insightMatch = output.match(/KEY\s+INSIGHT\s*\n([\s\S]*)$/i);

  const explanation = explanationMatch?.[1]?.trim() || output.trim();
  const why = whyMatch?.[1]?.trim() || "";
  const tip = tipMatch?.[1]?.trim() || "";
  const insight = insightMatch?.[1]?.trim() || "";

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Explanation
        </h3>
        <p className="text-base leading-relaxed text-foreground whitespace-pre-wrap">
          {explanation}
        </p>
      </div>
      {why && (
        <div className="space-y-2.5 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-xs uppercase tracking-wider text-primary font-semibold">
            Why This Answer
          </h3>
          <p className="text-sm leading-relaxed text-foreground">{why}</p>
        </div>
      )}
      {tip && (
        <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="text-xs uppercase tracking-wider text-amber-400 font-semibold">
            Exam Tip
          </h3>
          <p className="text-sm leading-relaxed text-foreground">{tip}</p>
        </div>
      )}
      {insight && (
        <div className="space-y-2.5 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-xs uppercase tracking-wider text-primary font-semibold">
            Key Insight
          </h3>
          <p className="text-sm leading-relaxed text-foreground">{insight}</p>
        </div>
      )}
    </div>
  );
};

interface ExplainPanelProps {
  open: boolean;
  scope: "card" | "topic";
  card: Card;
  onClose: () => void;
}

export const ExplainPanel = ({ open, scope, card, onClose }: ExplainPanelProps) => {
  const { toast } = useToast();
  const { isSheetLimited } = useUsageLimit();
  const { isAnonymous } = useAuth();
  // Same shared 10-turn window as sheets and cards — see use-memory-preference.
  const { useMemory } = useMemoryPreference();
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [goProOpen, setGoProOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [modelUsed, setModelUsed] = useState<ModelUsed | null>(null);

  useEffect(() => {
    setStarted(false);
    setOutput("");
    setModelUsed(null);
  }, [card.id, scope]);

  useEffect(() => {
    if (loading) {
      startTopProgress();
      return () => finishTopProgress();
    }
  }, [loading]);

  useEffect(() => {
    if (!open || started) return;
    if (isSheetLimited) {
      onClose();
      if (isAnonymous) {
        setAuthModalOpen(true);
      } else {
        setGoProOpen(true);
      }
      return;
    }
    setStarted(true);
    setLoading(true);
    setOutput("");

    const run = async () => {
      try {
        const isCard = scope === "card";
        const body = isCard
          ? {
              notes: `CARD QUESTION: ${card.question}\n\nCARD ANSWER: ${card.answer}\n\nTOPIC CONTEXT: ${card.topic}`,
              examMode: "General",
              explainMode: true,
              useMemory,
            }
          : {
              notes: `Topic: ${card.topic}\n\nQuestion being studied: ${card.question}`,
              examMode: "General",
              explainMode: true,
              useMemory,
            };
        const response = await callMedicalNotes(body);
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Error: ${response.status}`);
        }
        setModelUsed(parseModelUsed(response.headers));
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        let textBuffer = "";
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });
          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                setOutput(fullText);
              }
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }
      } catch (e: unknown) {
        toast({
          title: "Error",
          description: e instanceof Error && e.message ? e.message : "Failed to load explanation",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset when panel closes
  useEffect(() => {
    if (!open) {
      setStarted(false);
      setOutput("");
      setLoading(false);
    }
  }, [open]);

  return (
    <>
    <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
    <div
      className="fixed inset-x-0 bottom-0 top-[15vh] z-50 bg-background border-t border-border rounded-t-xl shadow-2xl flex flex-col"
      style={{
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-sm">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to review
        </Button>
        <div className="flex items-center gap-2">
          <ModelCredit used={modelUsed} compact />
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl">
          {loading && !output && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          )}
          {output && (
            <div className="space-y-5 animate-fade-in">
              <ExplainContent output={output} />
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
};