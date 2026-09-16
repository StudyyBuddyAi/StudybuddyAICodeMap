import type { ReactNode } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { SheetVisualPlan } from "@/lib/plan-sheet-visual";

/** One planner call serves both sections; whichever button is pressed first makes it. */
export type VisualPlanner = (sheet: import("@/types/generated-sheet").GeneratedSheet, fallbackTopic: string) => Promise<SheetVisualPlan>;

export type PlanStatus = "idle" | "planning" | "none" | "failed";

const BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 16px",
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  background: "var(--fg)",
  color: "var(--bg)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

export const NOTE_STYLE: React.CSSProperties = {
  flex: "1 1 240px",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--fg-muted)",
  lineHeight: 1.55,
};

export function PlanningNote({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2" style={NOTE_STYLE}>
      <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--accent)" }} />
      {children}
    </div>
  );
}

/** The idle / none / failed state every visual section shares: a line of text and one button. */
export function PlanPrompt({
  status,
  idleText,
  noneText,
  buttonLabel,
  disabled,
  onClick,
}: {
  status: Exclude<PlanStatus, "planning">;
  idleText: string;
  noneText: string;
  buttonLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const message = status === "none" ? noneText : status === "failed" ? "Couldn't build this just now. The rest of the sheet is unaffected." : idleText;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p style={{ ...NOTE_STYLE, color: status === "idle" ? "var(--fg-muted)" : "var(--fg)" }}>{message}</p>
      {status !== "none" && (
        <button type="button" style={{ ...BUTTON_STYLE, opacity: disabled ? 0.5 : 1 }} onClick={onClick} disabled={disabled}>
          {status === "idle" ? <Sparkles style={{ width: 14, height: 14 }} /> : <RotateCcw style={{ width: 14, height: 14 }} />}
          {status === "idle" ? buttonLabel : "Try again"}
        </button>
      )}
    </div>
  );
}
