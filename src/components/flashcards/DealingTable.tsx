import { Check, Loader2, X } from "lucide-react";
import { getTagColors } from "@/lib/tag-colors";
import type { ParsedCard } from "@/lib/deck-request";
import type { ExamTheme } from "@/lib/qbank-exam-theme";

export interface DealtCard extends ParsedCard {
  /** Arrival order, for a key that survives batches landing out of order. */
  seq: number;
}

/**
 * The deck being written, dealt onto the table card by card.
 *
 * The QBank's wait is a screen of progress about a question the student must
 * not see yet. A deck has nothing to hide — the student is about to study
 * every card — so the wait shows the deck itself: each card lands the moment
 * the writer finishes it, into a slot the whole deck has marked out, so the
 * table says how far along it is without a progress bar. It is the page's one
 * moving moment; with reduced motion the cards simply appear.
 */
const DealingTable = ({
  cards,
  total,
  topics,
  theme,
  status,
  onCancel,
}: {
  cards: DealtCard[];
  total: number;
  topics: string[];
  theme: ExamTheme;
  status: "writing" | "done";
  onCancel: () => void;
}) => {
  const mixed = topics.length > 1;
  const slots = Math.max(total, cards.length);
  const done = status === "done";

  return (
    <section
      aria-labelledby="fc-deal-title"
      className={`rounded-[26px] border-2 ${theme.border} bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="fc-deal-title" className="text-lg font-semibold leading-snug text-foreground" dir="auto">
            {done ? "Dealt — your review starts now" : `Writing ${total} cards on ${mixed ? `${topics.length} topics` : topics[0]}`}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground" role="status" aria-live="polite">
            <span className={`font-semibold tabular-nums ${theme.text}`}>{cards.length}</span>
            <span className="tabular-nums"> of {total}</span>{" "}
            {done ? "cards in your deck." : "written — each lands here the moment it is finished."}
          </p>
        </div>
        {!done && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Stop
          </button>
        )}
      </div>

      <ol className="fc-table mt-5 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4" aria-label="Cards written so far">
        {Array.from({ length: slots }, (_, i) => {
          const card = cards[i];
          if (!card) {
            const next = i === cards.length && !done;
            return (
              <li key={`slot-${i}`} aria-hidden className={`fc-slot${next ? " fc-slot--next" : ""}`}>
                {next && <Loader2 className={`h-4 w-4 animate-spin ${theme.text}`} />}
              </li>
            );
          }
          const tag = getTagColors(card.tag);
          return (
            <li key={`card-${card.seq}`} className="fc-dealt" style={{ ["--fc-tilt" as string]: `${((card.seq * 37) % 7) - 3}deg` }}>
              <span className="flex items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border ${tag.bg} ${tag.text} ${tag.border}`}
                >
                  {card.tag || "Card"}
                </span>
                {mixed && (
                  <span className="truncate text-[11px] text-muted-foreground" dir="auto">
                    {card.topic}
                  </span>
                )}
              </span>
              <span className="fc-dealt-q" dir="auto">
                {card.question}
              </span>
            </li>
          );
        })}
      </ol>

      {done && (
        <p className={`mt-4 inline-flex items-center gap-1.5 text-sm font-medium ${theme.text}`}>
          <Check className="h-4 w-4" aria-hidden /> Saved to your decks
        </p>
      )}
    </section>
  );
};

export default DealingTable;
