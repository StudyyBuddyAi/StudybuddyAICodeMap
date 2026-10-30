import { useEffect, useState } from "react";
import { Check, Flag, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type ReportReason = "wrong_key" | "outdated" | "unclear" | "typo" | "other";

const REPORT_REASONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: "wrong_key", label: "The answer is wrong", hint: "A different option is the best answer." },
  { id: "outdated", label: "It's out of date", hint: "Current guidelines or teaching say otherwise." },
  { id: "unclear", label: "It's unclear or has two answers", hint: "The stem is missing data, or two options fit." },
  { id: "typo", label: "Typo or formatting", hint: "Something reads wrong, but the medicine is fine." },
  { id: "other", label: "Something else", hint: "Tell us below." },
];

const NOTE_LIMIT = 500;

/** The server's refusal, in words a student can act on. */
const describeError = (message: string | undefined): string => {
  if (message?.includes("question_not_served")) return "This question isn't in any of your sets.";
  if (message?.includes("not_authenticated")) return "Sign in again to send a report.";
  return "The report didn't send. Check your connection and try again.";
};

/**
 * "Report a problem" on a graded question. The one human signal in the QBank:
 * the gate and the second read are machines, and the shared pool needs a
 * student's word before an item reaches anyone else. One report per question —
 * a second replaces the first.
 */
const ReportQuestion = ({ questionId, sessionId }: { questionId: string; sessionId?: string | null }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // A different question starts clean.
  useEffect(() => {
    setOpen(false);
    setReason(null);
    setNote("");
    setError(null);
    setSent(false);
  }, [questionId]);

  const needsNote = reason === "other";
  const canSend = !!reason && !sending && (!needsNote || note.trim().length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("report_question", {
      p_question: questionId,
      p_reason: reason,
      p_note: note.trim() || null,
      p_session: sessionId ?? null,
    });
    setSending(false);
    if (rpcError) {
      console.error("report_question failed:", rpcError);
      setError(describeError(rpcError.message));
      return;
    }
    setSent(true);
    setOpen(false);
  };

  return (
    <>
      <div className="qb-report">
        {sent ? (
          <span className="qb-report-done" role="status">
            <Check aria-hidden /> Thanks — reported. We review every report.
          </span>
        ) : (
          <button type="button" className="qb-report-link" onClick={() => setOpen(true)}>
            <Flag aria-hidden /> Report a problem with this question
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => !sending && setOpen(o)}>
        {/* data-qbank-capture-keys: letters typed here are not the player's
            answer and flag shortcuts. */}
        <DialogContent className="qb-exam-portal max-w-md gap-4" data-qbank-capture-keys>
          <DialogHeader className="text-left">
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription className="text-[14px] leading-relaxed">
              What's wrong with this question?
            </DialogDescription>
          </DialogHeader>

          <div role="radiogroup" aria-label="What's wrong" className="grid gap-2">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={reason === r.id}
                onClick={() => setReason(r.id)}
                className="qb-report-reason"
                data-on={reason === r.id || undefined}
              >
                <span className="qb-report-reason-label">{r.label}</span>
                <span className="qb-report-reason-hint">{r.hint}</span>
              </button>
            ))}
          </div>

          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium" style={{ color: "var(--fg)" }}>
              {needsNote ? "What's wrong?" : "Anything to add? (optional)"}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_LIMIT))}
              rows={3}
              maxLength={NOTE_LIMIT}
              placeholder={reason === "wrong_key" ? "Which option, and why?" : ""}
              className="qb-report-note"
            />
            <span className="text-[12px] tabular-nums" style={{ color: "var(--fg-muted)" }}>
              {note.length}/{NOTE_LIMIT}
            </span>
          </label>

          {error && (
            <p className="text-[13px]" style={{ color: "var(--qb-wrong)" }} role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" className="qb-btn qb-btn--outline" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </button>
            <button type="button" className="qb-btn qb-btn--primary" onClick={() => void send()} disabled={!canSend}>
              {sending && <Loader2 className="animate-spin" />}
              Send report
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ReportQuestion;
