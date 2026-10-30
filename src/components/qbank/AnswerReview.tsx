import { forwardRef } from "react";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { renderMarkdown } from "@/lib/render-markdown";
import { choiceLabel as choice, formatClock } from "@/lib/qbank-answer";
import { TIMED_SECONDS_PER_QUESTION, type OptionKey, type Question, type QuestionMedia } from "@/lib/qbank-types";
import { MediaBlock } from "./QuestionMedia";
import ReportQuestion from "./ReportQuestion";

/**
 * What a graded question opens onto: the result, with the difficulty columns
 * beside it, the right answer named in words, then the explanation and its key
 * teaching point. Lives in the side column on a wide screen and under the
 * answers on a phone.
 */
const AnswerReview = forwardRef<
  HTMLHeadingElement,
  {
    question: Question;
    correct: OptionKey;
    /** Null for a question the set left unanswered. */
    selected: OptionKey | null;
    timeTakenMs?: number | null;
    onOpenMedia: (items: QuestionMedia[], index: number) => void;
    /** Under the answers, on its own card, rather than in the side column. */
    inline?: boolean;
    /** The set this question was served in, recorded with a report. */
    sessionId?: string | null;
  }
>(({ question: q, correct, selected, timeTakenMs, onOpenMedia, inline, sessionId }, headingRef) => {
  const result = selected === null ? "omitted" : selected === correct ? "correct" : "wrong";
  const Icon = result === "correct" ? CheckCircle2 : result === "wrong" ? XCircle : MinusCircle;
  const title = result === "correct" ? "Correct" : result === "wrong" ? "Incorrect" : "Omitted";

  return (
    <section className={`qb-review${inline ? " qb-review--inline" : ""}`} aria-labelledby="qb-verdict-title">
      <div className="qb-review-head">
        <h2 id="qb-verdict-title" ref={headingRef} tabIndex={-1} className="qb-verdict" data-result={result}>
          <Icon aria-hidden />
          {title}
        </h2>
      </div>

      {result === "correct" ? (
        <p className="qb-verdict-line">
          <strong>{choice(q, correct)}</strong>
        </p>
      ) : (
        <p className="qb-verdict-line">
          The correct answer is <strong>{choice(q, correct)}</strong>.
          {selected && <> You chose {choice(q, selected)}.</>}
        </p>
      )}

      {typeof timeTakenMs === "number" && timeTakenMs > 0 && (
        <dl className="qb-facts">
          <div>
            <dt>Time spent</dt>
            <dd>{formatClock(timeTakenMs)}</dd>
          </div>
          <div>
            <dt>Exam pace</dt>
            <dd>{formatClock(TIMED_SECONDS_PER_QUESTION * 1000)}</dd>
          </div>
        </dl>
      )}

      <hr className="qb-rule" />

      <MediaBlock media={q.media} context="explanation" onOpen={onOpenMedia} />

      <div style={{ display: "grid", gap: 8 }}>
        <h3 className="qb-label qb-label--accent">Explanation</h3>
        <div className="qb-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.explanation ?? "") }} />
      </div>

      {q.teaching_point && (
        <aside className="qb-keypoint" aria-labelledby="qb-keypoint-title">
          <h3 id="qb-keypoint-title" className="qb-label qb-label--accent">
            Key teaching point
          </h3>
          <p dangerouslySetInnerHTML={{ __html: renderMarkdown(q.teaching_point) }} />
        </aside>
      )}

      {(q.domain || q.subject) && (
        <div className="qb-domain">
          <span className="qb-label">Domain</span>
          {q.domain && <span className="qb-chip">{q.domain}</span>}
          {q.subject && <span className="qb-chip">{q.subject}</span>}
        </div>
      )}

      <ReportQuestion questionId={q.id} sessionId={sessionId} />
    </section>
  );
});
AnswerReview.displayName = "AnswerReview";

export default AnswerReview;
