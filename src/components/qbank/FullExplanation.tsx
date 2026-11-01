import { ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { renderMarkdown } from "@/lib/render-markdown";
import { choiceLabel } from "@/lib/qbank-answer";
import { useFullExplanation, type FullExplanation as Explanation } from "@/hooks/use-full-explanation";
import type { OptionKey, Question } from "@/lib/qbank-types";

const LETTERS: OptionKey[] = ["a", "b", "c", "d", "e"];

/**
 * The full explanation under a graded question: the concept in depth, every
 * option, a comparison table and the algorithm as a figure, where the topic
 * has them (supabase/functions/_shared/qbank-explain.ts).
 *
 * Early-access feedback: the explanation was too short, and USMLE students
 * want tables and figures. It is written the first time anyone opens the
 * question — about fifteen seconds — so it loads beside the short
 * explanation, which the student reads meanwhile, and folds away once read.
 */
const FullExplanation = ({ question, correct }: { question: Question; correct: OptionKey }) => {
  const [open, setOpen] = useState(true);
  const { data, isLoading, isError, refetch, isFetching } = useFullExplanation(question.id);

  // Held while a doubt about the key is reviewed: the short explanation stands.
  if (data?.status === "held") return null;

  return (
    <section className="qb-full" aria-labelledby={`qb-full-${question.id}`}>
      <button
        type="button"
        className="qb-full-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`qb-full-body-${question.id}`}
      >
        <h3 id={`qb-full-${question.id}`} className="qb-label qb-label--accent">
          Full explanation
        </h3>
        <ChevronDown aria-hidden className={open ? "qb-full-chevron qb-full-chevron--open" : "qb-full-chevron"} />
      </button>

      {open && (
        <div id={`qb-full-body-${question.id}`} className="qb-full-body">
          {isLoading ? (
            <p className="qb-full-status" role="status">
              <Loader2 className="animate-spin" aria-hidden /> Writing the full explanation, with a table and the
              algorithm where the topic has one…
            </p>
          ) : isError || !data ? (
            <p className="qb-full-status">
              Couldn't load the full explanation.{" "}
              <button type="button" className="qb-full-retry" onClick={() => void refetch()} disabled={isFetching}>
                <RotateCcw aria-hidden /> Try again
              </button>
            </p>
          ) : (
            <Body explanation={data.explanation} question={question} correct={correct} />
          )}
        </div>
      )}
    </section>
  );
};

const md = (text: string) => ({ __html: renderMarkdown(text) });

const Body = ({ explanation: e, question, correct }: { explanation: Explanation; question: Question; correct: OptionKey }) => (
  <>
    <p className="qb-full-bottom">
      <span className="qb-label">Bottom line</span>
      <span dangerouslySetInnerHTML={md(e.bottomLine)} />
    </p>

    <div className="qb-full-prose">
      {e.explanation.map((p, i) => (
        <p key={i} dangerouslySetInnerHTML={md(p)} />
      ))}
    </div>

    {e.table && (
      <figure className="qb-full-figure">
        {e.table.title && <figcaption className="qb-label">{e.table.title}</figcaption>}
        <div className="qb-full-table-wrap">
          <table className="qb-full-table">
            <thead>
              <tr>
                {e.table.columns.map((c, i) => (
                  <th key={i} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {e.table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) =>
                    c === 0 ? (
                      <th key={c} scope="row" dangerouslySetInnerHTML={md(cell)} />
                    ) : (
                      <td key={c} dangerouslySetInnerHTML={md(cell)} />
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    )}

    {e.algorithm && (
      <figure className="qb-full-figure">
        {e.algorithm.title && <figcaption className="qb-label">{e.algorithm.title}</figcaption>}
        <ol className="qb-flow">
          {e.algorithm.steps.map((s, i) => (
            <li key={i} className={s.yes || s.no ? "qb-flow-step qb-flow-step--decision" : "qb-flow-step"}>
              <span className="qb-flow-box" dangerouslySetInnerHTML={md(s.text)} />
              {(s.yes || s.no) && (
                <span className="qb-flow-branches">
                  {s.yes && (
                    <span className="qb-flow-branch">
                      <b>Yes</b> → <span dangerouslySetInnerHTML={md(s.yes)} />
                    </span>
                  )}
                  {s.no && (
                    <span className="qb-flow-branch">
                      <b>No</b> → <span dangerouslySetInnerHTML={md(s.no)} />
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ol>
      </figure>
    )}

    {Object.keys(e.options).length > 0 && (
      <div className="qb-full-options">
        <span className="qb-label">Every option</span>
        <ul>
          {LETTERS.filter((l) => e.options[l]).map((l) => (
            <li key={l} data-key={l === correct ? "correct" : undefined}>
              <strong>{choiceLabel(question, l)}</strong>
              <span dangerouslySetInnerHTML={md(e.options[l]!)} />
            </li>
          ))}
        </ul>
      </div>
    )}

    {e.highYield.length > 0 && (
      <div className="qb-keypoint">
        <span className="qb-label qb-label--accent">High-yield</span>
        <ul className="qb-full-hy">
          {e.highYield.map((h, i) => (
            <li key={i} dangerouslySetInnerHTML={md(h)} />
          ))}
        </ul>
      </div>
    )}
  </>
);

export default FullExplanation;
