import { AnimatePresence, m } from "motion/react";
import { ArrowRight, Check, FileDown, Layers, Loader2, Play, Plus, Share2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RISE, SWAP } from "@/lib/motion";

/**
 * Where the sheet ends: what to do with it now.
 *
 * It replaces two things that pulled against each other — a "Your first sheet
 * is ready" nudge whose "Generate flashcards" opened the Flashcards page to
 * make a new deck, and a row of buttons under the sources whose "Generate
 * Flashcards" saved the deck this sheet already has. The one deck action here
 * is the second: the cards written beside this sheet, kept.
 */

export interface SheetDeck {
  /** Cards written beside the sheet; 0 when unknown (a legacy text sheet). */
  count: number;
  saved: boolean;
  onSave: () => void;
  onReview: () => void;
}

/**
 * A full deck written from the sheet itself — every section, up to twenty
 * cards — beside the few the sheet came with (early-access feedback: cards
 * should come from what the student studied).
 */
export interface SheetFullDeck {
  status: "idle" | "writing" | "done";
  /** Cards the last run added. */
  count: number;
  onWrite: () => void;
  onReview: () => void;
}

interface SheetFinishProps {
  topic: string;
  deck: SheetDeck | null;
  fullDeck?: SheetFullDeck | null;
  onPractice: () => void;
  onExport: () => void;
  onShare: () => void;
  onNewSheet: () => void;
}

const LINK_CLASS =
  "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground";

const SheetFinish = ({ topic, deck, fullDeck, onPractice, onExport, onShare, onNewSheet }: SheetFinishProps) => (
  <m.section
    {...RISE}
    aria-label="Next steps"
    className="rounded-[22px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 sm:p-6"
  >
    <p
      className="font-mono text-[11px] font-medium uppercase tracking-widest"
      style={{ color: "var(--color-accent)" }}
    >
      End of sheet
    </p>
    <h2 className="mt-1.5 [font-family:var(--app-font-serif)] text-xl font-medium leading-snug tracking-[-0.01em] text-foreground">
      Now make {topic} stick.
    </h2>

    <div className="mt-4 flex flex-wrap gap-2">
      {deck && (
        // The deck button turns into its own follow-up once used, in place.
        <AnimatePresence mode="wait" initial={false}>
          {deck.saved ? (
            <m.div key="saved" {...SWAP}>
              <Button variant="outline" onClick={deck.onReview} className="h-10 gap-2 rounded-xl text-sm">
                <Check className="h-4 w-4 text-primary" />
                In your deck · Review in Library
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </m.div>
          ) : (
            <m.div key="save" {...SWAP}>
              <Button onClick={deck.onSave} className="h-10 gap-2 rounded-xl text-sm">
                <Layers className="h-4 w-4" />
                {deck.count ? `Add ${deck.count} cards to my deck` : "Add the cards to my deck"}
              </Button>
            </m.div>
          )}
        </AnimatePresence>
      )}
      {fullDeck && (
        <AnimatePresence mode="wait" initial={false}>
          {fullDeck.status === "done" ? (
            <m.div key="full-done" {...SWAP}>
              <Button variant="outline" onClick={fullDeck.onReview} className="h-10 gap-2 rounded-xl text-sm">
                <Check className="h-4 w-4 text-primary" />
                {fullDeck.count} cards from your sheet · Review
              </Button>
            </m.div>
          ) : (
            <m.div key="full-write" {...SWAP}>
              <Button
                variant="outline"
                onClick={fullDeck.onWrite}
                disabled={fullDeck.status === "writing"}
                className="h-10 gap-2 rounded-xl text-sm"
              >
                {fullDeck.status === "writing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {fullDeck.status === "writing" ? "Writing cards from your sheet…" : "Write a full deck from this sheet"}
              </Button>
            </m.div>
          )}
        </AnimatePresence>
      )}
      <Button variant="outline" onClick={onPractice} className="h-10 gap-2 rounded-xl text-sm">
        <Play className="h-4 w-4" />
        Practice QBank
      </Button>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4">
      <button type="button" onClick={onExport} className={LINK_CLASS}>
        <FileDown className="h-3.5 w-3.5" />
        Export PDF or Word
      </button>
      <button type="button" onClick={onShare} className={LINK_CLASS}>
        <Share2 className="h-3.5 w-3.5" />
        Share
      </button>
      <button type="button" onClick={onNewSheet} className={LINK_CLASS}>
        <Plus className="h-3.5 w-3.5" />
        New sheet
      </button>
    </div>
  </m.section>
);

export default SheetFinish;
