import { useEffect, useRef } from "react";
import { Check, Circle, Flag, Minus, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { itemAccessibleName, type ItemCell, type ItemStatus } from "@/lib/qbank-item-status";

/** The status mark beside an item number. Shape carries the meaning; colour repeats it. */
export const StatusIcon = ({ status }: { status: ItemStatus }) => {
  const props = { className: "qb-status", "data-status": status, "aria-hidden": true, strokeWidth: 2.5 } as const;
  switch (status) {
    case "correct":
      return <Check {...props} />;
    case "incorrect":
      return <X {...props} />;
    case "answered":
      return <Circle {...props} fill="currentColor" style={{ width: 9, height: 9 }} />;
    case "omitted":
      return <Minus {...props} />;
    default:
      return <span className="qb-status" aria-hidden />;
  }
};

const LEGEND: Record<"tutor" | "timed" | "review", ItemStatus[]> = {
  tutor: ["correct", "incorrect"],
  timed: ["answered"],
  review: ["correct", "incorrect", "omitted"],
};

const LEGEND_LABEL: Partial<Record<ItemStatus, string>> = {
  correct: "Correct",
  incorrect: "Incorrect",
  answered: "Answered",
  omitted: "Omitted",
};

const Legend = ({ kind, className }: { kind: keyof typeof LEGEND; className?: string }) => (
  <ul className={className} aria-label="Key">
    {LEGEND[kind].map((s) => (
      <li key={s}>
        <StatusIcon status={s} />
        {LEGEND_LABEL[s]}
      </li>
    ))}
    <li>
      <Flag className="qb-flag" aria-hidden />
      Marked
    </li>
  </ul>
);

interface NavigatorProps {
  cells: ItemCell[];
  onSelect: (index: number) => void;
  legend: keyof typeof LEGEND;
}

/** The numbered item list down the left of the screen, as on the exam. */
export const ItemRail = ({ cells, onSelect, legend }: NavigatorProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const current = cells.find((c) => c.current)?.index;

  // Keep the current item in view as the student moves through a long block.
  // Scrolled by hand: scrollIntoView also moves Chrome's sequential-focus
  // starting point, so the first Tab on a new question skipped the top bar.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top - 8;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + el.offsetHeight - list.clientHeight + 8;
  }, [current]);

  return (
    <nav className="qb-rail" aria-label="Questions in this block">
      <div className="qb-rail-list" ref={listRef}>
        {cells.map((cell) => (
          <button
            key={cell.index}
            type="button"
            className="qb-item"
            disabled={cell.status === "unwritten"}
            aria-current={cell.current ? "step" : undefined}
            aria-label={itemAccessibleName(cell)}
            title={itemAccessibleName(cell)}
            onClick={() => onSelect(cell.index)}
          >
            <span>{cell.index + 1}</span>
            <StatusIcon status={cell.status} />
            {cell.marked ? <Flag className="qb-flag" aria-hidden /> : <span aria-hidden />}
          </button>
        ))}
      </div>
      <Legend kind={legend} className="qb-legend" />
    </nav>
  );
};

/** The same list on a phone: a sheet of number cells, opened from the top bar. */
export const ItemSheet = ({
  cells,
  onSelect,
  legend,
  open,
  onOpenChange,
}: NavigatorProps & { open: boolean; onOpenChange: (open: boolean) => void }) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="bottom" className="qb-exam-portal max-h-[80vh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-5">
      <SheetHeader className="mb-4 text-left">
        <SheetTitle>Questions</SheetTitle>
        <SheetDescription>Go to any question in this block.</SheetDescription>
      </SheetHeader>
      <nav aria-label="Questions in this block" className="qb-grid">
        {cells.map((cell) => (
          <button
            key={cell.index}
            type="button"
            className="qb-cell"
            disabled={cell.status === "unwritten"}
            aria-current={cell.current ? "step" : undefined}
            aria-label={itemAccessibleName(cell)}
            onClick={() => {
              onSelect(cell.index);
              onOpenChange(false);
            }}
          >
            {cell.index + 1}
            <StatusIcon status={cell.status} />
            {cell.marked && <Flag className="qb-flag" aria-hidden />}
          </button>
        ))}
      </nav>
      <Legend
        kind={legend}
        className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground [&_li]:flex [&_li]:items-center [&_li]:gap-2 [&_svg]:h-3.5 [&_svg]:w-3.5"
      />
    </SheetContent>
  </Sheet>
);
