import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { BookOpen, Layers, ArrowLeft, RotateCcw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { getTagColors } from "@/lib/tag-colors";
import { type Card, useDeckGrounding } from "@/hooks/use-flashcard-deck";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUsageLimit } from "@/hooks/use-usage-limit";
import GoProModal from "@/components/GoProModal";
import { getCitationsForTopic } from "@/lib/citation-store";
import CitationBadgeList from "@/components/CitationBadgeList";
import SheetSources from "@/components/SheetSources";
import { startTopProgress, finishTopProgress } from "@/components/TopProgressBar";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { useMemoryPreference } from "@/hooks/use-memory-preference";
import type { GeneratedSheet } from "@/types/generated-sheet";
import AIDisclaimer from "@/components/AIDisclaimer";
import RatingButtons from "@/components/RatingButtons";

interface StudyModeProps {
  dueCards: Card[];
  onReview: (id: string, rating: "again" | "good" | "easy") => void;
  onClose: () => void;
}

function vibrate(rating: "again" | "good" | "easy" | "flip") {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      const ms = rating === "easy" ? 5 : rating === "good" ? 10 : rating === "again" ? 15 : 8;
      navigator.vibrate(ms);
    }
  } catch {
    // ignore
  }
}

const StudyMode = ({ dueCards, onReview, onClose }: StudyModeProps) => {
  // Snapshot session cards on mount
  const sessionCards = useMemo(() => dueCards.slice(), []);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [done, setDone] = useState(sessionCards.length === 0);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainScope, setExplainScope] = useState<"card" | "topic">("card");
  const [slidePhase, setSlidePhase] = useState<"idle" | "exit">("idle");

  const current = sessionCards[index];
  const progress = sessionCards.length === 0 ? 0 : (reviewedCount / sessionCards.length) * 100;

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

  const handleFlip = () => {
    vibrate("flip");
    setFlipped((f) => !f);
  };

  const handleRate = (rating: "again" | "good" | "easy") => {
    if (!current || slidePhase !== "idle") return;
    vibrate(rating);
    onReview(current.id, rating);
    const nextReviewed = reviewedCount + 1;
    setReviewedCount(nextReviewed);
    if (index + 1 >= sessionCards.length) {
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

  return (
    /*
      Full-screen review surface. Was a bare `fixed inset-0` div: no focus trap,
      so Tab walked straight out into the page behind it, and no focus restore
      on close.

      Radix is safe here precisely because Library renders this conditionally
      (`{studyOpen && <StudyMode/>}`) — closing already unmounts and ends the
      session, so unmount-on-close changes nothing. Escape is handled by Radix
      now; the manual keydown listener that did it is gone.
    */
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="flex h-screen max-h-screen w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-background p-0 sm:rounded-none"
      >
        <DialogTitle className="sr-only">Flashcard review</DialogTitle>
        <DialogDescription className="sr-only">
          Review your due flashcards one at a time.
        </DialogDescription>
      {/* Progress bar */}
      <div className="h-[2px] w-full bg-border">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Close: DialogContent renders its own, so no hand-rolled duplicate. */}
      <div className="h-11 shrink-0" aria-hidden="true" />

      <div className="flex-1 flex items-center justify-center px-4 pb-4 md:pb-10 overflow-y-auto">
        {done ? (
          <div className="text-center space-y-4 animate-fade-in">
            {sessionCards.length === 0 ? (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">You're all caught up.</h2>
                <p className="text-muted-foreground">
                  New cards will appear here after your next study session.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">Session complete</h2>
                <p className="text-muted-foreground">
                  {reviewedCount} {reviewedCount === 1 ? "card" : "cards"} reviewed. See you tomorrow.
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
            <div
              key={current.id}
              className={slidePhase === "exit" ? "card-slide-exit-left" : "card-slide-enter-right"}
            >
              <div
                className="perspective cursor-pointer select-none"
                style={{ perspective: "1000px" }}
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
                    onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
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
                <RatingButtons onRate={handleRate} />
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Card {index + 1} of {sessionCards.length}
            </p>

            <AIDisclaimer variant="short" className="justify-center" />

            {/* Guideline sources behind the current card's deck — same
                component SheetGenerator renders below the document; self-hides
                when the current card's deck has no retrieval metadata. */}
            {currentCardGrounding && currentCardGrounding.sources.length > 0 && (
              <SheetSources sheet={{ sources: currentCardGrounding.sources } as GeneratedSheet} />
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
      </DialogContent>
    </Dialog>
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
        <div className="space-y-2.5 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <h3 className="text-xs uppercase tracking-wider text-warning font-semibold">
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
  // Same shared 10-turn window as sheets and cards — see use-memory-preference.
  const { useMemory } = useMemoryPreference();
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [goProOpen, setGoProOpen] = useState(false);

  useEffect(() => {
    setStarted(false);
    setOutput("");
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
      setGoProOpen(true);
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
    {/*
      Was a hand-rolled `fixed` panel that was always mounted and merely
      translated off-screen when closed: no focus trap, no focus restore, no
      Escape handler, and still present in the accessibility tree while
      invisible. Radix gives all four, and unmounts the content when closed.
    */}
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="bottom"
        className="top-[15vh] h-[85vh] gap-0 rounded-t-xl border-t p-0 flex flex-col"
      >
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border/40 px-4 py-3 text-left">
          <SheetTitle asChild>
            <Button variant="ghost" size="sm" onClick={onClose} className="text-sm font-normal">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to review
            </Button>
          </SheetTitle>
          <SheetDescription className="sr-only">
            AI explanation for the card you are reviewing.
          </SheetDescription>
        </SheetHeader>
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
              <AIDisclaimer />
            </div>
          )}
        </div>
      </div>
      </SheetContent>
    </Sheet>
    </>
  );
};