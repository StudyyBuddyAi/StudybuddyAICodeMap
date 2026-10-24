import { forwardRef } from "react";
import { X } from "lucide-react";
import { useNoteDraft } from "@/hooks/use-note-draft";
import { findingsOf } from "@/lib/qbank-highlights";
import { NOTE_MAX_LENGTH, type HighlightRange } from "@/lib/qbank-types";

/**
 * The student's clipboard, in the side column while they work a case.
 *
 * Whatever they highlight in the stem collects here as a findings list, in the
 * order it appears, the way a problem list builds up on a ward round. Under it,
 * the question's note. Both are the student's own marks, saved with the block.
 */
const Clipboard = forwardRef<
  HTMLTextAreaElement,
  {
    questionId: string;
    stem: string;
    highlights: HighlightRange[];
    note: string;
    onNoteChange: (questionId: string, text: string) => void;
    /** Absent in review, where the clipboard is read-only. */
    onRemoveFinding?: (offset: number) => void;
    readOnly: boolean;
  }
>(({ questionId, stem, highlights, note, onNoteChange, onRemoveFinding, readOnly }, notesRef) => {
  const findings = findingsOf(stem, highlights);
  const { draft, update, flush } = useNoteDraft(questionId, note, onNoteChange);

  return (
    <div className="qb-clip">
      <section className="qb-clip-section" aria-labelledby="qb-findings-title">
        <h3 id="qb-findings-title" className="qb-label">
          Findings{findings.length > 0 ? ` · ${findings.length}` : ""}
        </h3>
        {findings.length > 0 ? (
          <ul className="qb-findings">
            {findings.map((f) => (
              <li key={f.start} className="qb-finding">
                <span>{f.text}</span>
                {onRemoveFinding ? (
                  <button type="button" onClick={() => onRemoveFinding(f.start)} aria-label={`Remove the highlight on “${f.text}”`}>
                    <X />
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="qb-empty">
            {readOnly
              ? "Nothing was highlighted in this case."
              : "Highlight what matters in the case and it collects here, in the order you read it."}
          </p>
        )}
      </section>

      <section className="qb-clip-section" aria-labelledby="qb-notes-title">
        <h3 id="qb-notes-title" className="qb-label">
          Notes
        </h3>
        {readOnly ? (
          <p className="qb-empty" style={{ whiteSpace: "pre-wrap", color: draft ? "var(--fg)" : undefined }}>
            {draft || "No notes on this question."}
          </p>
        ) : (
          <textarea
            ref={notesRef}
            className="qb-notes-input"
            value={draft}
            onChange={(e) => update(e.target.value)}
            onBlur={flush}
            maxLength={NOTE_MAX_LENGTH}
            aria-labelledby="qb-notes-title"
            placeholder="Differentials, a calculation, what to look up…"
          />
        )}
      </section>
    </div>
  );
});
Clipboard.displayName = "Clipboard";

export default Clipboard;
