import { Fragment } from "react";
import type { GroundingLevel } from "@/types/generated-sheet";
import type { LayerBranch } from "@/lib/sheet-layer";
import { BRANCH_TYPE_LABEL } from "@/lib/sheet-branches";
import { AI_NOTICE, type PrintLine, type PrintModel, type PrintNote, type PrintOptions, type PrintSection, type PrintSpan } from "@/lib/sheet-print";
import { BranchMarkdown } from "@/components/sheet/branches/BranchMarkdown";
import "./sheet-print.css";

/**
 * The exported sheet. Plain semantic HTML on its own stylesheet
 * (sheet-print.css): it is rendered into the export dialog as a preview and,
 * unchanged, into a body-level root that is all the printer sees.
 */

const GROUNDING_TEXT: Record<GroundingLevel, string> = {
  full: "Grounded in the guideline library",
  partial: "Partly grounded — some sections from general knowledge",
  none: "Written from general medical knowledge",
};

const Spans = ({ spans }: { spans: PrintSpan[] }) => (
  <>
    {spans.map((s, i) => {
      const inner = s.bold ? <strong>{s.text}</strong> : s.text;
      return s.mark ? (
        <mark key={i} data-intent={s.mark}>
          {inner}
        </mark>
      ) : (
        <Fragment key={i}>{inner}</Fragment>
      );
    })}
  </>
);

const Notes = ({ notes }: { notes: PrintNote[] }) => (
  <>
    {notes.map((n, i) => (
      <p key={i} className="sbp-note">
        <b>{n.ai ? "AI explanation" : "Note"}</b>
        {n.text}
      </p>
    ))}
  </>
);

const LineBody = ({ line }: { line: PrintLine }) => (
  <>
    <span>
      <Spans spans={line.spans} />
    </span>
    <Notes notes={line.notes} />
  </>
);

function Dives({ roots, all }: { roots: LayerBranch[]; all: LayerBranch[] }) {
  if (!roots.length) return null;
  const render = (b: LayerBranch, depth: number) => (
    <div key={b.id} className="sbp-dive" style={{ marginInlineStart: depth * 12 }}>
      <p className="sbp-dive-title">
        {b.label}
        <span className="sbp-dive-type">{BRANCH_TYPE_LABEL[b.type]}</span>
      </p>
      <BranchMarkdown text={b.text} revealAnswers />
      {all.filter((c) => c.parentId === b.id).map((c) => render(c, depth + 1))}
    </div>
  );
  return (
    <div className="sbp-dives">
      <span className="sbp-eyebrow">Deep dives</span>
      {roots.map((b) => render(b, 0))}
    </div>
  );
}

function SectionContent({ section, all }: { section: PrintSection; all: LayerBranch[] }) {
  return (
    <div>
      {section.kind === "prose" && (
        <div className="sbp-prose">
          {section.lines.map((line, i) => (
            <div
              key={i}
              className="sbp-line"
              data-label={line.label ? "" : undefined}
              data-mine={line.mine}
            >
              {line.label && <span className="sbp-label">{line.label}</span>}
              <div>
                <LineBody line={line} />
              </div>
            </div>
          ))}
        </div>
      )}
      {section.kind === "list" && (
        <ol className="sbp-list">
          {section.lines.map((line, i) => (
            <li key={i} data-mine={line.mine}>
              <LineBody line={line} />
            </li>
          ))}
        </ol>
      )}
      {section.kind === "table" && (
        <table className="sbp-table">
          {section.columns?.length ? (
            <thead>
              <tr>
                {section.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {section.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Spans spans={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Notes notes={section.notes} />
      <Dives roots={section.branches} all={all} />
    </div>
  );
}

const Meta = ({ model }: { model: PrintModel }) => (
  <dl className="sbp-meta">
    {(
      [
        ["Exam", model.meta.examMode],
        ["Level", model.meta.difficulty],
        ["Depth", model.meta.depth],
        ["Exported", model.meta.date],
      ] as const
    ).map(([k, v]) => (
      <div key={k}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
    {model.meta.grounding && (
      <div>
        <dt>Sources</dt>
        <dd>
          <span className="sbp-badge" data-level={model.meta.grounding}>
            {GROUNDING_TEXT[model.meta.grounding]}
          </span>
        </dd>
      </div>
    )}
  </dl>
);

const Legend = () => (
  <p className="sbp-legend">
    <span>
      <mark data-intent="key">Key point</mark>
    </span>
    <span>
      <mark data-intent="confusing">Confusing</mark>
    </span>
    <span>
      <mark data-intent="memorize">To memorise</mark>
    </span>
    <span data-mine="">Your edits and additions</span>
  </p>
);

function Contents({ model, options }: { model: PrintModel; options: PrintOptions }) {
  const extra = [
    model.cards.length ? (options.cards === "quiz" ? "Self-test and answer key" : "Flashcards") : null,
    model.references.length || model.referenceNote ? "References" : null,
  ].filter(Boolean) as string[];
  return (
    <nav className="sbp-toc" aria-label="Contents">
      <span className="sbp-eyebrow">Contents</span>
      <ol>
        {model.sections.map((s) => (
          <li key={s.key}>
            <span className="sbp-toc-n">{String(s.number).padStart(2, "0")}</span>
            {s.title}
          </li>
        ))}
        {extra.map((t) => (
          <li key={t}>
            <span className="sbp-toc-n">—</span>
            {t}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SheetPrintDocument({ model, options }: { model: PrintModel; options: PrintOptions }) {
  const title = (
    <h1 className="sbp-title">
      {model.emoji && (
        <span className="sbp-title-emoji" aria-hidden>
          {model.emoji}
        </span>
      )}
      {model.title}
    </h1>
  );

  return (
    <article
      className="sbp"
      lang="en"
      data-size={options.textSize}
      data-ink={options.inkSaver ? "saver" : "color"}
      data-paper={options.paper}
    >
      {options.coverPage ? (
        <section className="sbp-cover">
          <div className="sbp-head">
            <span className="sbp-eyebrow">StudyBuddy AI · Study sheet</span>
            {title}
            <Meta model={model} />
          </div>
          <Contents model={model} options={options} />
          <div className="sbp-cover-foot">
            {model.hasMine && <Legend />}
            <p className="sbp-end">{AI_NOTICE}</p>
          </div>
        </section>
      ) : (
        <header className="sbp-head">
          <span className="sbp-eyebrow">StudyBuddy AI · Study sheet</span>
          {title}
          <Meta model={model} />
          {model.hasMine && <Legend />}
        </header>
      )}

      <div className="sbp-body" data-layout={options.layout}>
        {model.sections.map((s) => (
          <section
            key={s.key}
            className="sbp-section"
            data-kind={s.kind}
            data-margin={options.notesMargin && options.layout === "study" ? "on" : undefined}
          >
            <h2 className="sbp-h2">
              <span className="sbp-h2-n">{String(s.number).padStart(2, "0")}</span>
              {s.title}
            </h2>
            <SectionContent section={s} all={model.allBranches} />
            {options.notesMargin && options.layout === "study" && (
              <aside className="sbp-cues" aria-label="Space for your cues">
                <span className="sbp-cues-label">Cues</span>
              </aside>
            )}
          </section>
        ))}
      </div>

      {model.cards.length > 0 && options.cards === "inline" && (
        <section className="sbp-part">
          <h2 className="sbp-part-title">Flashcards</h2>
          <p className="sbp-part-lede">
            {model.cards.length} cards. Cover the right-hand column and answer each one aloud.
          </p>
          <table className="sbp-cards">
            <tbody>
              {model.cards.map((c, i) => (
                <tr key={i}>
                  <td>{String(i + 1).padStart(2, "0")}</td>
                  <td>
                    <span className="sbp-tag">{c.tag}</span>
                    <Spans spans={[{ text: c.question }]} />
                  </td>
                  <td>{c.answer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {model.cards.length > 0 && options.cards === "quiz" && (
        <>
          <section className="sbp-part">
            <h2 className="sbp-part-title">Self-test</h2>
            <p className="sbp-part-lede">
              {model.cards.length} questions. Write your answer, then check it against the key on the next page.
            </p>
            <ol className="sbp-quiz">
              {model.cards.map((c, i) => (
                <li key={i}>
                  <span className="sbp-quiz-n">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <span className="sbp-tag">{c.tag}</span>
                    {c.question}
                    <div className="sbp-write" aria-hidden />
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className="sbp-part">
            <h2 className="sbp-part-title">Answer key</h2>
            <ol className="sbp-key">
              {model.cards.map((c, i) => (
                <li key={i}>
                  <span className="sbp-quiz-n">{String(i + 1).padStart(2, "0")} </span>
                  {c.answer}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {(model.references.length > 0 || model.referenceNote) && (
        <section className="sbp-section sbp-refs-part">
          <h2 className="sbp-h2">References</h2>
          {model.referenceNote && <p className="sbp-refnote">{model.referenceNote}</p>}
          <ol className="sbp-refs">
            {model.references.map((r) => (
              <li key={r.number}>
                <span className="sbp-ref-n">[{r.number}]</span>
                <div>
                  <p className="sbp-ref-title">{r.title}</p>
                  {r.chapters.map((ch, i) => (
                    <div key={i}>
                      <p className="sbp-ref-ch">
                        {[ch.heading, ch.pages.join(", ")].filter(Boolean).join(" · ")}
                      </p>
                      {ch.excerpts.map((x, j) => (
                        <p key={j} className="sbp-excerpt">
                          {x}
                        </p>
                      ))}
                    </div>
                  ))}
                  {r.url && <p className="sbp-ref-url">{r.url}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!options.coverPage && <p className="sbp-end">{AI_NOTICE}</p>}
    </article>
  );
}
