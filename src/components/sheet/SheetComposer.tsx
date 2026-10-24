import type { ReactNode } from "react";
import PageHeader from "@/components/layout/PageHeader";
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
import { POPULAR_TOPICS } from "@/lib/popular-topics";

/**
 * The page before there is a sheet: one box to name a topic, its settings as
 * chips inside it, and the ways back into earlier work.
 *
 * This used to be spread over three places — a page header with its own topic
 * chips, a settings column, and an empty state with a third topic grid — and
 * the three pickers each did something different on a tap. There is one list
 * now, and a tap always does the same thing: put the topic in the box (a
 * second tap takes it out). Generating is always the Generate button, so the
 * settings can be changed first.
 */

/** Starting points: the shared popular topics, each with an icon for its system. */
const SYSTEM_ICONS: Record<string, typeof HeartPulse> = {
  Cardiovascular: HeartPulse,
  Respiratory: Activity,
  Endocrinology: Brain,
  Neurology: BrainCircuit,
  "Renal & Urinary": FlaskConical,
  "Infectious Disease": Pill,
};
const SUGGESTED_TOPICS = POPULAR_TOPICS.slice(0, 6).map((t) => ({
  label: t.label,
  topic: t.topic,
  icon: SYSTEM_ICONS[t.system] ?? Activity,
}));

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
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-200 disabled:cursor-default disabled:opacity-50";
const CHIP_OFF = "border-border bg-card text-foreground hover:border-primary/60 hover:text-primary";
const CHIP_ON = "border-primary bg-primary text-primary-foreground";

interface SheetComposerProps {
  notes: string;
  onNotesChange: (value: string) => void;
  /** Generate from the box. */
  onGenerate: () => void;
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
  // Every topic generated lately, suggestions included — a sheet started from
  // "Heart Failure" used to be filtered out of Recent for being a suggestion.
  const recent = recentTopics.slice(0, 4);
  // Someone who has never generated or saved a sheet gets the three-step
  // explainer; anyone else already knows the flow.
  const firstVisit = !historyLoading && history.length === 0 && recentTopics.length === 0;
  const canGenerate = !loading && notes.trim().length > 0;
  const picked = notes.trim().toLowerCase();
  // Select, or deselect when it is already the topic. No scroll, no generate.
  const toggleTopic = (label: string) => onNotesChange(picked === label.toLowerCase() ? "" : label);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <PageHeader label="Study sheets" title="New study sheet" description="Name a topic or paste your notes." />

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
                aria-pressed={picked === topic.toLowerCase()}
                onClick={() => toggleTopic(topic)}
                className={`${CHIP_CLASS} ${picked === topic.toLowerCase() ? CHIP_ON : CHIP_OFF}`}
              >
                <span className="truncate">{topic}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Try a topic
          </span>
          {SUGGESTED_TOPICS.map(({ label, topic, icon: Icon }) => (
            <button
              key={label}
              type="button"
              disabled={loading}
              aria-pressed={picked === topic.toLowerCase()}
              onClick={() => toggleTopic(topic)}
              className={`${CHIP_CLASS} ${picked === topic.toLowerCase() ? CHIP_ON : CHIP_OFF}`}
            >
              <Icon
                className={`h-3.5 w-3.5 ${picked === topic.toLowerCase() ? "" : "text-[color:var(--color-accent)]"}`}
                strokeWidth={2.2}
              />
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

      {/* Three steps on one compact row — a reminder, not a section. */}
      {firstVisit && (
        <ol aria-label="How it works" className="animate-fade-in flex flex-col gap-2 sm:flex-row sm:gap-3">
          {HOW_IT_WORKS.map(({ title, description, icon: Icon }, index) => (
            <li
              key={title}
              title={description}
              className="flex flex-1 items-center gap-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-foreground)] text-[color:var(--color-accent)]">
                <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
              <span className="text-xs font-semibold text-foreground">
                {index + 1}. {title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default SheetComposer;
