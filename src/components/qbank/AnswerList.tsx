import { useRef } from "react";
import { Check, Undo2, X } from "lucide-react";
import { OPTION_KEYS, isGradedState, type AnswerState } from "@/lib/qbank-answer";
import { renderMarkdown } from "@/lib/render-markdown";
import type { OptionKey, Question } from "@/lib/qbank-types";

interface AnswerListProps {
  question: Question;
  answerState: AnswerState;
  struck: OptionKey[];
  /** Strike-out is available: a live, ungraded question. */
  canMark: boolean;
  /** A choice can be made: a live, ungraded question. */
  canSelect: boolean;
  /** Per-option rationales are shown: tutor after grading, and review. */
  showRationales: boolean;
  labelledBy: string;
  onSelect: (key: OptionKey) => void;
  onToggleStrike: (key: OptionKey) => void;
  /** Enter on the chosen answer submits it (tutor). */
  onSubmit?: () => void;
}

/**
 * The answer choices: lettered cards, one tab stop for the group, with the
 * keyboard of a radio list. Up and Down move between choices without choosing,
 * Space or Enter chooses, and Enter on the chosen one submits it. Left and
 * Right stay with the player, where they change question.
 */
const AnswerList = ({
  question,
  answerState,
  struck,
  canMark,
  canSelect,
  showRationales,
  labelledBy,
  onSelect,
  onToggleStrike,
  onSubmit,
}: AnswerListProps) => {
  const refs = useRef<Partial<Record<OptionKey, HTMLDivElement | null>>>({});
  const graded = isGradedState(answerState);
  const chosen: OptionKey | null =
    answerState.status === "selected"
      ? answerState.pending
      : answerState.status === "answered"
        ? answerState.selected
        : null;
  const correct = graded ? answerState.correct : null;
  const tabStop = chosen ?? "a";

  const move = (from: OptionKey, step: number) => {
    const i = OPTION_KEYS.indexOf(from);
    const next = OPTION_KEYS[(i + step + OPTION_KEYS.length) % OPTION_KEYS.length];
    refs.current[next]?.focus();
  };

  return (
    <div className="qb-options" role="radiogroup" aria-labelledby={labelledBy} aria-readonly={!canSelect || undefined}>
      {OPTION_KEYS.map((key) => {
        const text = question[`option_${key}` as const];
        const letter = key.toUpperCase();
        const isChosen = chosen === key;
        const isKey = correct === key;
        const isStruck = struck.includes(key);
        const gradedAs = !graded ? undefined : isKey ? "correct" : isChosen ? "wrong" : "other";
        const tag = !graded ? null : isChosen ? "Your answer" : isKey ? "Correct answer" : null;
        const rationale = showRationales && graded && !isKey ? question.distractor_explanations?.[key] : undefined;

        const srState = [
          isKey ? "correct answer" : null,
          graded && isChosen ? (isKey ? "your answer" : "your answer, incorrect") : null,
          isStruck ? "struck out" : null,
        ]
          .filter(Boolean)
          .join(", ");

        return (
          <div key={key} className="qb-option-wrap">
            <div
              ref={(el) => (refs.current[key] = el)}
              role="radio"
              aria-checked={isChosen}
              aria-disabled={!canSelect || undefined}
              tabIndex={key === tabStop ? 0 : -1}
              className="qb-option"
              data-graded={gradedAs}
              data-struck={isStruck || undefined}
              onClick={() => canSelect && onSelect(key)}
              onContextMenu={(e) => {
                if (!canMark) return;
                e.preventDefault();
                onToggleStrike(key);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(key, e.key === "ArrowDown" ? 1 : -1);
                } else if (e.key === " " || e.key === "Enter") {
                  // Handled here, so the player's own Enter never sees it.
                  e.preventDefault();
                  if (e.key === "Enter" && isChosen && onSubmit) onSubmit();
                  else if (canSelect) onSelect(key);
                }
              }}
            >
              <span className="qb-key" aria-hidden>
                {letter}
              </span>
              <span className="qb-option-text">
                <span className="qb-sr">{letter}. </span>
                {text}
                {srState && <span className="qb-sr">, {srState}</span>}
              </span>
              {tag && (
                <span className="qb-tag" aria-hidden>
                  {gradedAs === "correct" ? <Check strokeWidth={3} /> : <X strokeWidth={3} />}
                  {tag}
                </span>
              )}
            </div>

            {canMark && (
              <button
                type="button"
                tabIndex={-1}
                className="qb-strike"
                data-struck={isStruck || undefined}
                onClick={() => onToggleStrike(key)}
                onMouseDown={(e) => e.preventDefault()}
                aria-label={isStruck ? `Restore answer ${letter}` : `Strike out answer ${letter}`}
                title={`${isStruck ? "Restore" : "Strike out"} (Shift+${letter} or right-click)`}
              >
                {isStruck ? <Undo2 /> : <X />}
              </button>
            )}

            {rationale && (
              <p
                className="qb-rationale"
                data-pick={isChosen || undefined}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(rationale) }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AnswerList;
