import { useState, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { markdownBlocks } from "@/lib/sheet-branches";

/**
 * A branch's markdown, rendered: paragraphs, "#### " headings, numbered steps,
 * bullets, tables, callouts — and a case's answer, hidden until the student
 * has committed to their own. Text is only ever rendered as text; the one
 * inline markup is **bold**.
 */

export function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      )}
    </>
  );
}

function Answer({ lines, revealed = false }: { lines: string[]; revealed?: boolean }) {
  const [shown, setShown] = useState(revealed);
  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Eye aria-hidden className="h-3.5 w-3.5" />
        Commit to your answer, then reveal
      </button>
    );
  }
  return <Callout lines={lines} tone="answer" />;
}

function Callout({ lines, tone }: { lines: string[]; tone: "note" | "answer" }) {
  const paras = lines.join("\n").split(/\n\s*\n/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
  return (
    <div
      className={`space-y-2 rounded-lg border-l-2 px-3 py-2.5 text-sm leading-relaxed ${
        tone === "answer" ? "border-primary bg-primary/[0.06] text-foreground/90" : "border-primary/40 bg-secondary/60 text-foreground/90"
      }`}
    >
      {paras.map((p, i) => (
        <p key={i}>
          <Bold text={p} />
        </p>
      ))}
    </div>
  );
}

export function BranchMarkdown({ text, caret, revealAnswers }: { text: string; caret?: ReactNode; revealAnswers?: boolean }) {
  const blocks = markdownBlocks(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1 ? caret : null;
        switch (b.kind) {
          case "heading":
            return (
              <p key={i} className="pt-1 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {b.text.replace(/\*\*/g, "")}
              </p>
            );
          case "ordered":
            return (
              <ol key={i} className="space-y-2">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 font-mono text-[10px] font-medium text-primary">
                      {j + 1}
                    </span>
                    <span className="flex-1">
                      <Bold text={item} />
                      {j === b.items.length - 1 && last}
                    </span>
                  </li>
                ))}
              </ol>
            );
          case "bullets":
            return (
              <ul key={i} className="space-y-1.5">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                    <span className="flex-1">
                      <Bold text={item} />
                      {j === b.items.length - 1 && last}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              // The panel is narrow and a table has at most four columns: it fits
              // the width, its cells wrapping, rather than running off the edge.
              <div key={i} className="-mx-1 overflow-x-auto">
                <table
                  className={`w-full border-collapse leading-snug [overflow-wrap:anywhere] ${
                    (b.header.length || b.rows[0]?.length || 0) > 3 ? "text-[12px]" : "text-[13px]"
                  }`}
                >
                  {b.header.some(Boolean) && (
                    <thead>
                      <tr>
                        {b.header.map((h, j) => (
                          <th
                            key={j}
                            scope="col"
                            className="border-b border-border px-1.5 py-1.5 text-left align-bottom font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground"
                          >
                            {h.replace(/\*\*/g, "")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border/60 align-top last:border-0">
                        {row.map((c, j) => (
                          <td key={j} className={`px-1.5 py-2 ${j === 0 ? "font-medium text-foreground" : ""}`}>
                            <Bold text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {last}
              </div>
            );
          case "callout":
            return <Callout key={i} lines={b.lines} tone="note" />;
          case "answer":
            return <Answer key={i} lines={b.lines} revealed={revealAnswers} />;
          default:
            return (
              <p key={i}>
                <Bold text={b.text} />
                {last}
              </p>
            );
        }
      })}
      {!blocks.length && caret}
    </div>
  );
}
