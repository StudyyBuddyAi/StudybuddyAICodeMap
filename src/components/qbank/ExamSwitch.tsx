import { Check, FlaskConical, Layers, Stethoscope } from "lucide-react";
import type { ExamTarget } from "@/lib/qbank-suggestions";
import { EXAM_THEME } from "@/lib/qbank-exam-theme";

const ICONS: Record<ExamTarget, typeof FlaskConical> = {
  step1: FlaskConical,
  step2ck: Stethoscope,
  mixed: Layers,
};

const ORDER: ExamTarget[] = ["step1", "step2ck", "mixed"];

/**
 * Which exam the sets are written for, as three tiles that say what each one
 * tests. The choice is remembered (use-qbank-target) and colours the rest of
 * the page, so a student always knows which kind of question is coming.
 */
const ExamSwitch = ({
  value,
  onChange,
  disabled,
}: {
  value: ExamTarget;
  onChange: (t: ExamTarget) => void;
  disabled?: boolean;
}) => (
  <div role="radiogroup" aria-label="Studying for" className="grid gap-2 sm:grid-cols-[1fr_1fr_0.8fr]">
    {ORDER.map((t) => {
      const theme = EXAM_THEME[t];
      const Icon = ICONS[t];
      const on = value === t;
      return (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange(t)}
          className={`relative flex items-start gap-3 rounded-2xl border-2 p-3 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
            on ? theme.tileOn : "border-border bg-[color:var(--color-card)] hover:border-muted-foreground/40"
          }`}
        >
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors ${
              on ? theme.icon : "bg-secondary text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className={`block text-[15px] font-semibold leading-tight ${on ? theme.text : "text-foreground"}`}>
              {theme.label}
            </span>
            <span className="block text-xs leading-snug text-muted-foreground">
              {t === "mixed" ? theme.tagline : theme.blurb}
            </span>
          </span>
          {on && <Check className={`absolute right-2.5 top-2.5 h-4 w-4 ${theme.text}`} strokeWidth={3} aria-hidden />}
        </button>
      );
    })}
  </div>
);

export default ExamSwitch;
