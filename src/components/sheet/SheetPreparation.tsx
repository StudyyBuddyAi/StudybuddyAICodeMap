import { AnimatePresence, m } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import { AutoHeight } from "@/components/StreamingText";
import type { GenerationStatus } from "@/components/SheetProgress";
import { modelLabel, type ModelUsed } from "@/lib/model-used";
import { ENTER, EXIT, SPRING_POP, SWAP } from "@/lib/motion";
import { ARCHETYPE_PHRASES, primingQuestion, topicName } from "@/lib/priming-questions";
import type { SheetSectionSpec } from "@/types/generated-sheet";

/**
 * The first card of a sheet while it is being prepared.
 *
 * Between Generate and the first words the server reads the topic, searches
 * the guideline library and hands the sheet to its writer, which may think for
 * a while before it writes. This card says what is actually happening to this
 * sheet — what the topic was read as, which books the passages came from, who
 * is writing — as each piece arrives, and asks one real question about the
 * topic while the reader waits.
 *
 * It is built like the sheet's own section cards and sits where they do, in
 * the document's flow, rather than floating over them: it is the sheet's first
 * card until the sheet has one of its own, and then it folds away.
 */

type StepStatus = "done" | "active" | "pending" | "skipped";

interface Step {
  key: string;
  status: StepStatus;
  label: string;
  detail?: React.ReactNode;
}

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  overflow: "hidden",
};

const ICON_BOX_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  flexShrink: 0,
};

// The marks share one spot and cross-fade — no travel, so they stay aligned —
// and a step never shows no mark.
const MARK_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: ENTER },
  exit: { opacity: 0, transition: EXIT },
};

const StepMark = ({ status }: { status: StepStatus }) => (
  <span className="relative h-5 w-5 shrink-0">
    <AnimatePresence initial={false}>
      {status === "done" ? (
        <m.span
          key="done"
          className="absolute inset-0 flex items-center justify-center rounded-full"
          style={{ background: "var(--accent)" }}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={SPRING_POP}
        >
          <Check className="h-3 w-3" style={{ color: "var(--bg-elevated)" }} strokeWidth={3} />
        </m.span>
      ) : status === "active" ? (
        <m.span key="active" className="absolute inset-0 flex items-center justify-center" {...MARK_FADE}>
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-30"
            style={{ background: "var(--accent)" }}
          />
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
        </m.span>
      ) : (
        <m.span key="idle" className="absolute inset-0 flex items-center justify-center" {...MARK_FADE}>
          <span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: "var(--border-strong)" }} />
        </m.span>
      )}
    </AnimatePresence>
  </span>
);

const BookChip = ({ title }: { title: string }) => (
  <m.span
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={SPRING_POP}
    className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-foreground"
  >
    <span className="truncate">{title}</span>
  </m.span>
);

interface SheetPreparationProps {
  /** What was asked for — the topic, a question, or pasted notes. */
  input: string;
  status: GenerationStatus;
  /** The planned sections, once the plan has arrived. */
  plan: readonly SheetSectionSpec[] | null;
  model?: ModelUsed;
}

function steps({ input, status, plan, model }: SheetPreparationProps): Step[] {
  const name = topicName(input, status.archetype);
  const phrase = status.archetype ? ARCHETYPE_PHRASES[status.archetype]?.a : undefined;
  // The planned sections by name: the sheet's contents, before it has any.
  const sectionTitles = (plan ?? []).map((s) => s.title);

  const topic: Step = status.planned
    ? {
        key: "topic",
        status: "done",
        label: phrase ? `Read ${name} as ${phrase}` : "Read the topic",
        detail: sectionTitles.length ? `Sections: ${sectionTitles.join(" · ")}` : undefined,
      }
    : { key: "topic", status: "active", label: "Working out what kind of topic this is" };

  const books = status.books ?? [];
  const library: Step =
    status.sources === "off"
      ? { key: "library", status: "skipped", label: "Guideline library off for this sheet" }
      : status.sources === "pending"
      ? { key: "library", status: "active", label: "Searching the guideline library" }
      : status.sources > 0
      ? {
          key: "library",
          status: "done",
          label: `Found ${status.sources} guideline passage${status.sources === 1 ? "" : "s"}`,
          detail: books.length ? (
            <span className="flex flex-wrap gap-1.5">
              {books.slice(0, 2).map((b) => (
                <BookChip key={b} title={b} />
              ))}
              {books.length > 2 && <BookChip title={`+${books.length - 2} more`} />}
            </span>
          ) : undefined,
        }
      : {
          key: "library",
          status: "done",
          label: "Nothing close in the library",
          detail: "This sheet is written from general medical knowledge — check it against a primary source.",
        };

  const ready = status.planned && status.sources !== "pending";
  const writer: Step = status.thinking
    ? {
        key: "writer",
        status: "active",
        label: "Thinking it through before writing",
        detail: model && model.kind !== "unknown" ? `${modelLabel(model.kind)} is writing this sheet.` : undefined,
      }
    : status.writing
    ? {
        key: "writer",
        status: "active",
        label: "Starting to write",
        detail: model && model.kind !== "unknown" ? `${modelLabel(model.kind)} is writing this sheet.` : undefined,
      }
    : { key: "writer", status: ready ? "active" : "pending", label: "Writing the sheet" };

  return [topic, library, writer];
}

const SheetPreparation = (props: SheetPreparationProps) => {
  const list = steps(props);
  const question = primingQuestion(props.input, props.plan, props.status.archetype);

  return (
    <section aria-label="Preparing your sheet" style={CARD_STYLE}>
      <div className="flex items-center gap-2.5 px-6 pb-2 pt-5">
        <div style={ICON_BOX_STYLE}>
          <Sparkles className="h-3.5 w-3.5 animate-pulse" style={{ color: "var(--accent)" }} />
        </div>
        <h2 className="m-0 text-sm font-semibold tracking-[-0.004em] text-foreground">Preparing your sheet</h2>
      </div>

      <AutoHeight>
        <div className="px-6 pb-5 pt-2">
          {/* What is happening, step by step, with what each step found. */}
          <ol className="relative space-y-3" aria-live="polite">
            {list.map((step, i) => (
              <li key={step.key} className="relative flex gap-3">
                {i < list.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[9.5px] top-6 h-[calc(100%-6px)] w-px"
                    style={{ background: "var(--border)" }}
                  />
                )}
                <StepMark status={step.status} />
                <div className="min-w-0 flex-1 pt-px">
                  <AnimatePresence mode="wait" initial={false}>
                    <m.p
                      key={step.label}
                      {...SWAP}
                      className={`text-sm leading-5 ${
                        step.status === "active"
                          ? "text-shimmer"
                          : step.status === "done"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </m.p>
                  </AnimatePresence>
                  {step.detail && (
                    <m.div {...SWAP} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {step.detail}
                    </m.div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {/* One real question about this topic, while there is nothing yet to read. */}
          <div className="mt-5 border-t border-dashed border-border pt-4">
            <p
              className="font-mono text-[11px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--accent)" }}
            >
              Before you read
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <m.p key={question} {...SWAP} className="mt-1.5 text-[15px] leading-relaxed text-foreground">
                {question}
              </m.p>
            </AnimatePresence>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Answer it in your head first — a guess, even a wrong one, makes the answer stick when you
              read it. <span className="whitespace-nowrap">(Pretesting effect · Richland, Kornell &amp; Kao, 2009)</span>
            </p>
          </div>
        </div>
      </AutoHeight>
    </section>
  );
};

export default SheetPreparation;
