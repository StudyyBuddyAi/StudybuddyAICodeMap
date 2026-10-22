import type { ReactNode } from "react";
import {
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Flag,
  FlaskConical,
  Loader2,
  Pause,
  Settings,
  SlidersHorizontal,
  StickyNote,
} from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface ExamTools {
  labsOpen: boolean;
  notesOpen: boolean;
  calcOpen: boolean;
  hasNote: boolean;
  onLabs: () => void;
  onNotes: () => void;
  onCalc: () => void;
}

interface NavProps {
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** The current question is done with: Next becomes the way on. */
  nextReady: boolean;
}

// A click must not leave focus on a bar button. Focused, it takes the next
// Enter, the key that submits an answer, and clicks itself again: Mark, then
// Enter to submit, silently unmarked. Tab still reaches every button.
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const NotesLabel = ({ hasNote }: { hasNote: boolean }) => (
  <>
    <StickyNote />
    <span className="qb-collapse-label">Notes</span>
    {hasNote && (
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", marginLeft: -2, alignSelf: "flex-start", marginTop: 8 }}
      />
    )}
  </>
);

/**
 * The top bar: where you are and whether it's marked, the way back and on,
 * and the tools. The exam's arrangement.
 */
export const TopBar = ({
  itemNumber,
  total,
  marked,
  onMark,
  tools,
  settings,
  onOpenItems,
  onOpenTools,
  trailing,
  ...nav
}: NavProps & {
  itemNumber: number;
  total: number;
  marked: boolean;
  /** Absent in review, where marks are read-only. */
  onMark?: () => void;
  tools: ExamTools;
  settings: ReactNode;
  onOpenItems: () => void;
  onOpenTools: () => void;
  /** Phone only: End block, or Results in review. */
  trailing: ReactNode;
}) => (
  <header className="qb-bar qb-top">
    <div className="qb-zone">
      <span className="hidden md:inline-flex" style={{ marginRight: 4 }}>
        <BrandMark size={26} />
      </span>
      <span className="qb-item-label hidden md:inline">
        Item {itemNumber} of {total}
      </span>
      <button
        type="button"
        className="qb-btn md:hidden"
        onClick={onOpenItems}
        aria-label={`Question ${itemNumber} of ${total}. Show all questions`}
      >
        <span className="qb-item-label" style={{ padding: 0 }}>
          {itemNumber} / {total}
        </span>
        <ChevronDown />
      </button>
      {onMark ? (
        <button
          type="button"
          className="qb-btn qb-mark-btn"
          aria-pressed={marked}
          onClick={onMark}
          onMouseDown={keepFocus}
          title="Mark for review (F)"
        >
          <Flag />
          <span className="hidden sm:inline">Mark</span>
          <span className="qb-sr sm:hidden">Mark for review</span>
        </button>
      ) : (
        marked && (
          <span className="qb-btn qb-mark-btn" aria-pressed="true" role="img" aria-label="Marked">
            <Flag />
            <span className="hidden sm:inline">Marked</span>
          </span>
        )
      )}
    </div>

    <div className="qb-zone qb-top-center">
      <button type="button" className="qb-btn" onClick={nav.onPrev} onMouseDown={keepFocus} disabled={!nav.canPrev} title="Previous (←)">
        <ChevronLeft /> Previous
      </button>
      <button
        type="button"
        className={`qb-btn ${nav.nextReady ? "qb-btn--primary" : ""}`}
        onClick={nav.onNext}
        onMouseDown={keepFocus}
        disabled={!nav.canNext}
        title="Next (→)"
      >
        Next <ChevronRight />
      </button>
    </div>

    <div className="qb-zone">
      <div className="hidden items-center gap-1 md:flex">
        <button
          type="button"
          className="qb-btn qb-tool"
          aria-pressed={tools.labsOpen}
          onClick={tools.onLabs}
          onMouseDown={keepFocus}
          aria-label="Lab values"
          title="Lab values (L)"
        >
          <FlaskConical />
          <span className="qb-collapse-label">Lab values</span>
        </button>
        <button
          type="button"
          className="qb-btn qb-tool"
          aria-pressed={tools.notesOpen}
          onClick={tools.onNotes}
          onMouseDown={keepFocus}
          aria-label="Notes"
          aria-description={tools.hasNote ? "This question has a note" : undefined}
          title={tools.hasNote ? "Notes (N), has a note" : "Notes (N)"}
        >
          <NotesLabel hasNote={tools.hasNote} />
        </button>
        <button
          type="button"
          className="qb-btn qb-tool"
          aria-pressed={tools.calcOpen}
          onClick={tools.onCalc}
          onMouseDown={keepFocus}
          aria-label="Calculator"
          title="Calculator (K)"
        >
          <Calculator />
          <span className="qb-collapse-label">Calculator</span>
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="qb-btn qb-tool" aria-label="Settings" title="Settings">
              <Settings />
              <span className="qb-collapse-label">Settings</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="qb-exam-portal w-[300px] p-4">
            {settings}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center gap-1 md:hidden">
        <button type="button" className="qb-btn qb-btn--icon" onClick={onOpenTools} aria-label="Tools and settings">
          <SlidersHorizontal />
        </button>
        {trailing}
      </div>
    </div>
  </header>
);

/**
 * The bottom bar: the block clock, and the ways out. On a phone it carries
 * Previous and Next instead, where a thumb reaches them.
 */
export const BottomBar = ({
  clock,
  compactClock,
  modeLabel,
  saveState,
  actions,
  ...nav
}: NavProps & {
  clock: ReactNode;
  compactClock: ReactNode;
  modeLabel: string;
  saveState?: "idle" | "saving" | "error";
  actions: ReactNode;
}) => (
  <footer className="qb-bar qb-bottom">
    <div className="qb-zone hidden md:flex" style={{ gap: 12 }}>
      {clock}
      <span className="qb-clock-label" style={{ color: "var(--fg-muted)" }}>
        · {modeLabel}
      </span>
      {saveState === "error" && (
        <span
          className="qb-saving"
          role="status"
          title="Your latest changes (marks, highlights, notes, position) haven't reached the server yet. Retrying."
        >
          <CloudOff /> Not saved, retrying
        </span>
      )}
    </div>
    <div className="qb-zone hidden md:flex" style={{ gap: 8 }}>
      {actions}
    </div>

    <div className="flex w-full items-center justify-between gap-2 md:hidden">
      <button type="button" className="qb-btn qb-btn--outline qb-btn--lg" onClick={nav.onPrev} disabled={!nav.canPrev} aria-label="Previous question">
        <ChevronLeft />
      </button>
      <div className="flex min-w-0 items-center gap-2">
        {compactClock}
        {saveState === "error" && (
          <span className="qb-saving" role="status" aria-label="Not saved, retrying">
            <CloudOff />
          </span>
        )}
      </div>
      <button
        type="button"
        className={`qb-btn qb-btn--lg ${nav.nextReady ? "qb-btn--primary" : "qb-btn--outline"}`}
        onClick={nav.onNext}
        disabled={!nav.canNext}
      >
        Next <ChevronRight />
      </button>
    </div>
  </footer>
);

/** Save & exit, for the bars and the phone's Tools sheet. */
export const SaveExitButton = ({ saving, onClick, className = "" }: { saving: boolean; onClick: () => void; className?: string }) => (
  <button type="button" className={`qb-btn qb-btn--outline ${className}`} onClick={onClick} disabled={saving} title="Save your place and leave. Resume any time.">
    {saving ? <Loader2 className="animate-spin" /> : <Pause />}
    Save &amp; exit
  </button>
);

/** Phone: the tools and settings the top bar has no room for. */
export const ToolsSheet = ({
  open,
  onOpenChange,
  tools,
  settings,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tools: ExamTools;
  settings: ReactNode;
  footer?: ReactNode;
}) => {
  const pick = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="qb-exam-portal max-h-[85vh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-5">
        <SheetHeader className="mb-4 text-left">
          <SheetTitle>Tools</SheetTitle>
          <SheetDescription>Reference, scratch space and display.</SheetDescription>
        </SheetHeader>
        <div className="mb-6 grid grid-cols-3 gap-2">
          {[
            { label: "Lab values", icon: <FlaskConical />, on: tools.labsOpen, fn: tools.onLabs },
            { label: "Notes", icon: <StickyNote />, on: tools.notesOpen, fn: tools.onNotes },
            { label: "Calculator", icon: <Calculator />, on: tools.calcOpen, fn: tools.onCalc },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              className="qb-btn qb-btn--outline"
              aria-pressed={t.on}
              onClick={pick(t.fn)}
              style={{ height: 64, flexDirection: "column", gap: 6, fontSize: 13 }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        {settings}
        {footer && <div className="mt-6 flex flex-col gap-2">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
};
