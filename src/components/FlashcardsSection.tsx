import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import type { Flashcard } from "@/types/generated-sheet";

interface FlashcardsSectionProps {
  // New: typed cards array from JSON output
  cards?: Flashcard[];
  // Legacy: raw string content from old text-blob sheets
  content?: string;
}

const FlashcardsSection = ({ cards, content }: FlashcardsSectionProps) => {
  const [showAll, setShowAll] = useState(false);

  // If typed cards are provided, use them directly
  // Otherwise fall back to parsing the legacy string content
  const resolvedCards: { q: string; a: string; tag?: string }[] = cards
    ? cards.map((c) => ({ q: c.question, a: c.answer, tag: c.tag }))
    : (content ?? "")
        .split(/\n(?=Q:)/g)
        .map((segment) => {
          const lines = segment.trim().split("\n");
          const q =
            lines.find((l) => l.startsWith("Q:"))?.replace(/^Q:\s*/, "").trim() ?? "";
          const a =
            lines.find((l) => l.startsWith("A:"))?.replace(/^A:\s*/, "").trim() ?? "";
          return { q, a };
        })
        .filter(({ q, a }) => q.length > 0 && a.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-muted-foreground hover:text-foreground h-7"
        >
          {showAll ? (
            <>
              <EyeOff className="h-3.5 w-3.5 mr-1" /> Hide All
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5 mr-1" /> Show All
            </>
          )}
        </Button>
      </div>
      {resolvedCards.map(({ q, a, tag }, i) => (
        <FlipCard key={i} question={q} answer={a} tag={tag} forceShow={showAll} />
      ))}
    </div>
  );
};

function FlipCard({
  question,
  answer,
  tag,
  forceShow,
}: {
  question: string;
  answer: string;
  tag?: string;
  forceShow: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const isOpen = forceShow || revealed;

  return (
    <div
      onClick={() => setRevealed(!revealed)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed(!revealed);
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      className="perspective cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
    >
      <div
        className={`rounded-lg border bg-background p-4 space-y-2 transition-colors hover:border-foreground/20 ${
          isOpen ? "border-primary/30" : "border-border"
        }`}
      >
        <p className="font-medium text-foreground text-sm leading-relaxed">
          <span className="text-primary font-semibold mr-1.5">Q:</span>
          {tag && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mr-1.5 border border-border rounded px-1 py-0.5">
              {tag}
            </span>
          )}
          {question}
        </p>
        <div
          className={`overflow-hidden transition-all duration-300 ease-out ${
            isOpen ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <p className="text-muted-foreground text-sm leading-relaxed pt-1 border-t border-border">
            <span className="font-semibold mr-1.5 text-primary">A:</span>
            {answer}
          </p>
        </div>
        {!isOpen && (
          <p className="text-xs text-muted-foreground">Click to reveal answer</p>
        )}
      </div>
    </div>
  );
}

export default FlashcardsSection;
