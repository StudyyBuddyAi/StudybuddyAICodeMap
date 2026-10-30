import { Loader2, Play, RefreshCw } from "lucide-react";
import type { Suggestion, SuggestionKind } from "@/lib/qbank-suggestions";
import { CHALLENGE_LABELS } from "@/lib/qbank-types";

const MONO_EYEBROW = "font-mono text-[11px] font-medium tracking-widest uppercase";

/** A colour per kind, drawn from the app's own tones. */
const TONE: Record<SuggestionKind, string> = {
  library: "bg-info",
  weak: "bg-danger",
  mixit: "bg-primary",
  daily: "bg-warning",
  showdown: "bg-primary",
  scenario: "bg-info",
  untouched: "bg-muted-foreground",
};

/**
 * "For you": at most six one-tap sets. Each card says what it is, why it is
 * here, and its size and level before the student commits.
 */
const SuggestionCards = ({
  suggestions,
  onStart,
  onShuffle,
  startingId,
  disabled,
  sizeFor,
}: {
  suggestions: Suggestion[];
  onStart: (s: Suggestion) => void;
  onShuffle: () => void;
  startingId: string | null;
  disabled?: boolean;
  /** The size a card will actually run at — inside a free allowance. */
  sizeFor: (s: Suggestion) => number;
}) => {
  if (suggestions.length === 0) return null;
  return (
    <section aria-labelledby="qb-for-you" className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="qb-for-you" className={`${MONO_EYEBROW} text-muted-foreground`}>
          For you
        </h2>
        <button
          type="button"
          onClick={onShuffle}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Show others
        </button>
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.map((s) => {
          const size = sizeFor(s);
          const starting = startingId === s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onStart(s)}
                disabled={disabled || size === 0}
                className="group flex h-full w-full flex-col gap-1.5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${TONE[s.kind]}`} aria-hidden />
                  <span className={`${MONO_EYEBROW} text-[10px] text-muted-foreground`}>{s.eyebrow}</span>
                </span>
                <span className="text-[15px] font-semibold leading-snug text-foreground">{s.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{s.hook}</span>
                <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
                  <span>
                    {size} question{size === 1 ? "" : "s"}
                    {s.topics.length > 1 ? ` · ${s.topics.length} topics mixed` : ""} · {CHALLENGE_LABELS[s.level]}
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground opacity-80 group-hover:opacity-100">
                    {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    Start
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default SuggestionCards;
