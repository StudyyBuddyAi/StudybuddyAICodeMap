import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  Brain,
  BrainCircuit,
  ChevronRight,
  FlaskConical,
  HeartPulse,
  History,
  PenLine,
  Pill,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CitationCTABanner from "@/components/CitationCTABanner";
import { useStudyHistory, type StudyHistoryItem } from "@/hooks/use-study-history";
import { timeAgo } from "@/lib/utils";

/**
 * The page before there is a sheet: one box to name a topic, its settings as
 * chips inside it, and the ways back into earlier work.
 *
 * This used to be spread over three places — a page header with its own topic
 * chips, a settings column, and an empty state with a third topic grid — and
 * the three pickers each did something different on a tap. There is one list
 * now, and a tap always does the same thing: write the topic in and generate.
 */

/**
 * Starting points, chosen to show what the sheet can be rather than six
 * diseases: a drug and a pathway come out with comparison tables, the
 * conditions with a clinical approach.
 */
const SUGGESTED_TOPICS = [
  { label: "Heart Failure", icon: HeartPulse },
  { label: "Diabetic Ketoacidosis", icon: Brain },
  { label: "Warfarin", icon: Pill },
  { label: "Urea Cycle", icon: FlaskConical },
  { label: "Community-Acquired Pneumonia", icon: Activity },
  { label: "Ischemic Stroke", icon: BrainCircuit },
] as const;

const HOW_IT_WORKS = [
  {
    title: "Name a topic",
    description: "A disease, a drug, a pathway — or paste your own notes.",
    icon: PenLine,
  },
  {
    title: "Watch it write",
    description: "Sections fill in live, built on the guideline library where it covers the topic.",
    icon: Sparkles,
  },
  {
    title: "Study it",
    description: "Recall checks under each section, a deck to keep, and QBank when you're ready.",
    icon: BookOpenCheck,
  },
] as const;

const CHIP_CLASS =
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors duration-200 hover:border-primary/60 hover:text-primary disabled:cursor-default disabled:opacity-50";

interface SheetComposerProps {
  notes: string;
  onNotesChange: (value: string) => void;
  /** Generate from the box, or from a topic picked below it. */
  onGenerate: (topic?: string) => void;
  loading: boolean;
  /** The settings row; the generator owns their state. */
  settings: ReactNode;
  /** Usage and plan, under the box. */
  usage: ReactNode;
  showSignIn: boolean;
  onSignIn: () => void;
  recentTopics: string[];
  onOpenSaved: (item: StudyHistoryItem) => void;
}

const SheetComposer = ({
  notes,
  onNotesChange,
  onGenerate,
  loading,
  settings,
  usage,
  showSignIn,
  onSignIn,
  recentTopics,
  onOpenSaved,
}: SheetComposerProps) => {
  const { history, isLoading: historyLoading } = useStudyHistory();
  const saved = history.slice(0, 4);
  const suggestionLabels = new Set(SUGGESTED_TOPICS.map((t) => t.label.toLowerCase()));
  const recent = recentTopics.filter((t) => !suggestionLabels.has(t.toLowerCase())).slice(0, 4);
  // Someone who has never generated or saved a sheet gets the three-step
  // explainer; anyone else already knows the flow.
  const firstVisit = !historyLoading && history.length === 0 && recentTopics.length === 0;
  const canGenerate = !loading && notes.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <header>
        <p
          className="mb-2 [font-family:var(--app-font-mono)] text-[11px] font-medium uppercase tracking-[0.14em]"
          style={{ color: "var(--color-accent)" }}
        >
          Study Sheet · AI-Powered
        </p>
        <h1
          className="[font-family:var(--app-font-serif)] text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] tracking-[-0.012em]"
          style={{ color: "var(--color-foreground)" }}
        >
          Generate your{" "}
          <span className="italic" style={{ color: "var(--color-accent)" }}>
            study sheet.
          </span>
        </h1>
        <p className="mt-2.5 max-w-xl text-base leading-relaxed text-muted-foreground">
          Name a topic or paste your notes. The sheet writes itself section by section.
        </p>
      </header>

      {/* ── The box, with usage under it ── */}
      <div className="space-y-2">
      <form
        className="rounded-[22px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 shadow-[0_18px_40px_rgba(15,23,42,0.05)] transition-colors duration-200 focus-within:border-primary/60 sm:p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canGenerate) onGenerate();
        }}
      >
        <label htmlFor="sheet-topic" className="sr-only">
          Topic or notes
        </label>
        <div className="relative">
          <Textarea
            id="sheet-topic"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter alone makes a new line — pasted notes need it. With the
              // platform modifier it generates, as in most composers.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGenerate) {
                e.preventDefault();
                onGenerate();
              }
            }}
            placeholder="A topic, a question, or your notes — e.g. Heart failure, or “why does hyperkalemia change the ECG?”"
            className="min-h-[96px] resize-none border-0 bg-transparent px-2 pr-9 text-base leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {notes && (
            <button
              type="button"
              onClick={() => onNotesChange("")}
              className="absolute right-1 top-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          {settings}
          <Button
            type="submit"
            disabled={!canGenerate}
            className="h-10 shrink-0 gap-2 rounded-[14px] bg-[color:var(--color-foreground)] px-5 text-sm font-semibold text-[color:var(--color-background)] shadow-[0_12px_24px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[color:var(--color-foreground)] disabled:translate-y-0 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            Generate
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>
      <div className="px-1">{usage}</div>
      </div>

      {showSignIn && <CitationCTABanner onSignInClick={onSignIn} />}

      {/* ── Starting points: one list, one behaviour ── */}
      <section aria-label="Start from a topic" className="space-y-2.5">
        {recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              <History className="h-3 w-3" />
              Recent
            </span>
            {recent.map((topic) => (
              <button
                key={topic}
                type="button"
                disabled={loading}
                onClick={() => onGenerate(topic)}
                className={CHIP_CLASS}
              >
                <span className="truncate">{topic}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Try
          </span>
          {SUGGESTED_TOPICS.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              disabled={loading}
              onClick={() => onGenerate(label)}
              className={CHIP_CLASS}
            >
              <Icon className="h-3.5 w-3.5 text-[color:var(--color-accent)]" strokeWidth={2.2} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ── Saved sheets: straight back into reading, no regeneration ── */}
      {saved.length > 0 && (
        <section aria-label="Continue studying" className="animate-fade-in space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-sm font-semibold text-foreground">Continue studying</h2>
            <span className="text-xs text-muted-foreground">
              {history.length} saved {history.length === 1 ? "sheet" : "sheets"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {saved.map((item) => {
              const chips = [item.modeInfo?.examMode, item.modeInfo?.difficulty].filter(Boolean).join(" · ");
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenSaved(item)}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {item.topic}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[chips, timeAgo(item.timestamp)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {firstVisit && (
        <section aria-label="How it works" className="animate-fade-in grid grid-cols-1 gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map(({ title, description, icon: Icon }, index) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4"
            >
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-foreground)] text-[color:var(--color-accent)]">
                <Icon className="h-4 w-4" strokeWidth={2.2} />
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-[9px] font-bold text-[color:var(--color-background)]">
                  {index + 1}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {description}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
};

export default SheetComposer;
