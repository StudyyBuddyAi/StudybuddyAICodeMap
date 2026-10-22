import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Flag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ITEM_STATUS_LABEL, type ItemCell } from "@/lib/qbank-item-status";
import type { PlayMode } from "@/lib/qbank-types";
import { StatusIcon } from "./ItemNavigator";

type Filter = "all" | "unanswered" | "marked";

/**
 * The review screen before a block ends, as on the exam: what is unanswered,
 * what is marked, and a way straight to any of it. Says what ending leaves
 * undone; never blocks it.
 */
const BlockReviewDialog = ({
  open,
  onOpenChange,
  cells,
  mode,
  notWritten,
  ending,
  onGo,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cells: ItemCell[];
  mode: PlayMode;
  /** Questions planned for the set that have not been written yet. */
  notWritten: number;
  ending: boolean;
  onGo: (index: number) => void;
  onConfirm: () => void;
}) => {
  const written = useMemo(() => cells.filter((c) => c.status !== "unwritten"), [cells]);
  const unanswered = written.filter((c) => c.status === "unanswered");
  const marked = written.filter((c) => c.marked);
  const [filter, setFilter] = useState<Filter>("all");

  // Open on what most needs a look.
  useEffect(() => {
    if (open) setFilter(unanswered.length > 0 ? "unanswered" : marked.length > 0 ? "marked" : "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rows = filter === "unanswered" ? unanswered : filter === "marked" ? marked : written;
  const answered = written.length - unanswered.length;

  const consequence =
    mode === "timed"
      ? "Ending grades the block and unlocks the explanations. Answers can't be changed after this."
      : "You'll go to your results.";
  const omittedNote =
    unanswered.length > 0
      ? ` ${unanswered.length} unanswered question${unanswered.length === 1 ? "" : "s"} will count as incorrect.`
      : "";

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "unanswered", label: "Unanswered", count: unanswered.length },
    { id: "marked", label: "Marked", count: marked.length },
    { id: "all", label: "All", count: written.length },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !ending && onOpenChange(o)}>
      <DialogContent className="qb-exam-portal max-w-lg gap-5">
        <DialogHeader className="text-left">
          <DialogTitle>End this block?</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed">
            {answered} of {written.length} answered. {consequence}
            {omittedNote}
          </DialogDescription>
        </DialogHeader>

        <div className="qb-filter" role="group" aria-label="Show questions">
          {filters.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="qb-count">{f.count}</span>
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="text-[14px]" style={{ color: "var(--fg-muted)" }}>
            {filter === "unanswered" ? "Every question has an answer." : "No questions are marked."}
          </p>
        ) : (
          <ul className="qb-review-list" aria-label="Questions">
            {rows.map((cell) => (
              <li key={cell.index}>
                <button
                  type="button"
                  className="qb-review-row"
                  onClick={() => {
                    onGo(cell.index);
                    onOpenChange(false);
                  }}
                >
                  <span className="qb-num">Q{cell.index + 1}</span>
                  <StatusIcon status={cell.status} />
                  <span className="qb-what">
                    {ITEM_STATUS_LABEL[cell.status]}
                    {cell.marked && (
                      <>
                        {" · "}
                        <Flag className="qb-flag inline align-[-2px]" aria-hidden /> Marked
                      </>
                    )}
                  </span>
                  <ChevronRight aria-hidden style={{ width: 16, height: 16, color: "var(--fg-muted)" }} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {notWritten > 0 && (
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {notWritten} more question{notWritten === 1 ? " is" : "s are"} still being written. Ending now stops the set
            where it is. Save &amp; exit keeps it going.
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className="qb-btn qb-btn--outline qb-btn--lg" onClick={() => onOpenChange(false)} disabled={ending}>
            Return to block
          </button>
          <button type="button" className="qb-btn qb-btn--primary qb-btn--lg" onClick={onConfirm} disabled={ending}>
            {ending ? "Ending…" : "End block"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BlockReviewDialog;
