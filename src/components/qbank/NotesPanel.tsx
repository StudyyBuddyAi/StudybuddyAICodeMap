import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNoteDraft } from "@/hooks/use-note-draft";
import { NOTE_MAX_LENGTH } from "@/lib/qbank-types";

/**
 * The Notes panel where there is no room for the Clipboard column: a sheet
 * with the note for the question on screen.
 *
 * Non-modal, like Lab values, so the stem stays readable while the student
 * writes. Saved with the set's annotations, so a note survives Save & Exit and
 * comes back in review.
 */
const NotesPanel = ({
  open,
  onOpenChange,
  questionId,
  itemNumber,
  value,
  onChange,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionId: string;
  itemNumber: number;
  value: string;
  onChange: (questionId: string, text: string) => void;
  readOnly: boolean;
}) => {
  const isMobile = useIsMobile();
  const { draft, update, flush } = useNoteDraft(questionId, value, onChange);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) flush();
        onOpenChange(o);
      }}
      modal={false}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={`qb-exam-portal flex flex-col gap-3 ${isMobile ? "h-[60vh] p-4" : "w-full p-5 sm:max-w-sm"}`}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          if (readOnly || isMobile) e.preventDefault();
        }}
      >
        <SheetHeader className="text-left">
          <SheetTitle>Notes · Question {itemNumber}</SheetTitle>
          <SheetDescription>
            {readOnly ? "What you wrote during the block." : "For this question only. Kept with the block, and shown again in review."}
          </SheetDescription>
        </SheetHeader>
        {readOnly ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: draft ? "var(--fg)" : "var(--fg-muted)" }}>
            {draft || "No notes on this question."}
          </p>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => update(e.target.value)}
              onBlur={flush}
              maxLength={NOTE_MAX_LENGTH}
              aria-label={`Notes for question ${itemNumber}`}
              placeholder="Differentials, a calculation, what to look up…"
              className="qb-notes-input min-h-0 flex-1"
            />
            <p className="text-right text-xs tabular-nums" style={{ color: "var(--fg-muted)" }}>
              {draft.length} / {NOTE_MAX_LENGTH}
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default NotesPanel;
