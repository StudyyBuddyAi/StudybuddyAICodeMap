import type { ReactNode } from "react";

export type Rating = "again" | "good" | "easy";

/**
 * The three spaced-repetition ratings, in one place.
 *
 * These used to be written twice with contradictory meanings. StudyMode had
 * "Still learning" / "Got it" (emerald) / "Easy"; Flashcards had
 * "Don't Know" / "Almost" (amber) / "Got It". Same underlying rating, opposite
 * label and opposite colour for the middle option — and Flashcards then counted
 * `good` as *Known* while the button the user pressed said *Almost*.
 *
 * A student moving between /library and /flashcards was being taught two
 * different scales for the same action. Colours come from the semantic tokens,
 * so both themes stay in step.
 */
const OPTIONS: Array<{
  rating: Rating;
  label: string;
  glyph: string;
  /** What the rating means, for the tooltip and the accessible name. */
  hint: string;
  className: string;
}> = [
  {
    rating: "again",
    label: "Don't know",
    glyph: "✗",
    hint: "Show this card again soon",
    className:
      "border-danger/30 bg-danger-soft text-danger hover:border-danger/60",
  },
  {
    rating: "good",
    label: "Almost",
    glyph: "~",
    hint: "Nearly had it — show it again before long",
    className:
      "border-warning/30 bg-warning-soft text-warning hover:border-warning/60",
  },
  {
    rating: "easy",
    label: "Got it",
    glyph: "✓",
    hint: "Confident — wait longer before showing it again",
    className:
      "border-success/30 bg-success-soft text-success hover:border-success/60",
  },
];

interface RatingButtonsProps {
  onRate: (rating: Rating) => void;
  disabled?: boolean;
  /** Rendered above the buttons, e.g. an "Explain this card" link. */
  children?: ReactNode;
}

const RatingButtons = ({ onRate, disabled, children }: RatingButtonsProps) => (
  <div className="space-y-3">
    {children}
    <div className="grid grid-cols-3 gap-2">
      {OPTIONS.map(({ rating, label, glyph, hint, className }) => (
        <button
          key={rating}
          type="button"
          onClick={() => onRate(rating)}
          disabled={disabled}
          title={hint}
          aria-label={`${label} — ${hint}`}
          className={`h-12 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 ${className}`}
        >
          <span aria-hidden="true">{glyph} </span>
          {label}
        </button>
      ))}
    </div>
  </div>
);

export default RatingButtons;
export { OPTIONS as RATING_OPTIONS };
