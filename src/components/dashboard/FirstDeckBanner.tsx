import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Layers, X } from "lucide-react";

interface FirstDeckBannerProps {
  onGoToFlashcards: () => void;
}

const FirstDeckBanner = ({ onGoToFlashcards }: FirstDeckBannerProps) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const sheetDone = localStorage.getItem("sb_first_sheet_seen");
    const deckDone = localStorage.getItem("sb_first_deck_seen");
    if (sheetDone && !deckDone) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Layers className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            You've got your first sheet 🎉
          </p>
          <p className="text-xs text-muted-foreground">
            Now lock it in — create a flashcard deck and start drilling.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          className="h-9 rounded-xl btn-gradient font-semibold text-xs px-4"
          onClick={() => {
            setShow(false);
            onGoToFlashcards();
          }}
        >
          Generate flashcards
        </Button>
        <button
          type="button"
          onClick={() => {
            setShow(false);
            localStorage.setItem("sb_first_deck_seen", "dismissed");
          }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default FirstDeckBanner;
