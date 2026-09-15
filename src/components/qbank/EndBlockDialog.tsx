import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { EndBlockStats } from "@/lib/qbank-session-state";
import type { PlayMode } from "@/lib/qbank-types";

interface EndBlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: EndBlockStats | null;
  mode: PlayMode;
  ending: boolean;
  onConfirm: () => void;
}

const Stat = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
  <div
    className="flex-1 rounded-md px-3 py-2 text-center"
    style={{ border: "1px solid var(--border)", background: "var(--bg)" }}
  >
    <p className="text-lg font-semibold tabular-nums" style={{ color: tone ?? "var(--fg)" }}>
      {value}
    </p>
    <p className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
      {label}
    </p>
  </div>
);

/**
 * The deliberate way out of a block, available at any point. Says what is being
 * left undone before it is left undone — never blocks it.
 */
const EndBlockDialog = ({ open, onOpenChange, stats, mode, ending, onConfirm }: EndBlockDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>End this block?</AlertDialogTitle>
        <AlertDialogDescription>
          {mode === "timed"
            ? "Your answers will be graded and the explanations unlocked. You can’t change answers after this."
            : "You’ll go to your results. Unanswered questions are counted as omitted."}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {stats && (
        <div className="flex gap-2">
          <Stat label="Answered" value={stats.answered} />
          <Stat label="Unanswered" value={stats.unanswered} tone={stats.unanswered > 0 ? "#d97706" : undefined} />
          <Stat label="Flagged" value={stats.flagged} />
        </div>
      )}

      {stats && stats.notWritten > 0 && (
        <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
          {stats.notWritten} more question{stats.notWritten === 1 ? " is" : "s are"} still being written. Ending now
          stops the set where it is — use Save &amp; Exit instead to keep it going.
        </p>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={ending}>Keep going</AlertDialogCancel>
        <AlertDialogAction
          disabled={ending}
          onClick={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          {ending ? "Ending…" : "End block"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default EndBlockDialog;
