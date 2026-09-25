import { useLayoutEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { Check, ListTree } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SPRING_GLIDE, SPRING_POP } from "@/lib/motion";
import { TOPIC_BAR_BUTTON, type SectionEntry, type SectionState } from "./sheet-nav";

/**
 * The sheet's table of contents, in two forms that read off one list: a rail
 * beside the document on wide screens, a menu in the topic bar on narrower
 * ones. While the sheet is being written both show each section's state —
 * written, being written, still to come — so the contents double as progress.
 */

const StateMark = ({ state }: { state: SectionState }) =>
  state === "live" ? (
    <span aria-hidden className="mr-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
  ) : state === "done" ? (
    <m.span
      aria-hidden
      className="mr-1 inline-flex shrink-0"
      initial={{ scale: 0.3, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SPRING_POP}
    >
      <Check className="h-3 w-3 text-primary/60" />
    </m.span>
  ) : null;

interface SectionListProps {
  items: SectionEntry[];
  activeKey: string;
  onJump: (key: string) => void;
}

// ── Rail (xl and up) ────────────────────────────────────────────────────────

export function SheetSectionRail({ items, activeKey, onJump }: SectionListProps) {
  const activeShown = items.some((it) => it.key === activeKey && it.state !== "waiting");

  // The "you are here" bar is one element gliding between entries rather than
  // a border that blinks from row to row. Measured, because a long title wraps
  // and makes its row taller.
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const row = activeShown
      ? navRef.current?.querySelector<HTMLElement>(`[data-nav-key="${activeKey}"]`)
      : null;
    setIndicator(row ? { top: row.offsetTop, height: row.offsetHeight } : null);
  }, [activeKey, activeShown, items.length]);

  if (!items.length) return null;

  return (
    <div className="animate-fade-in pt-1">
      <p className="mb-3 pl-3 font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        On this sheet
      </p>
      <nav ref={navRef} aria-label="Sections" className="relative flex flex-col border-l-2 border-border">
        {indicator && (
          <m.span
            aria-hidden
            className="absolute -left-[2px] w-[2px] rounded-full bg-primary"
            initial={false}
            animate={{ y: indicator.top, height: indicator.height }}
            transition={SPRING_GLIDE}
            style={{ top: 0 }}
          />
        )}
        {items.map((it) => {
          const waiting = it.state === "waiting";
          const active = activeShown && activeKey === it.key;
          return (
            <button
              key={it.key}
              data-nav-key={it.key}
              type="button"
              disabled={waiting}
              onClick={() => onJump(it.key)}
              aria-current={active ? "true" : undefined}
              className={`flex items-center gap-2 border-none bg-transparent py-1.5 pl-3 text-left text-sm transition-colors duration-200 ${
                active
                  ? "font-medium text-primary"
                  : waiting
                  ? "cursor-default text-muted-foreground/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`min-w-0 flex-1 ${it.state === "live" ? "text-shimmer" : ""}`}>{it.title}</span>
              <StateMark state={it.state} />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ── Menu (below xl) ─────────────────────────────────────────────────────────

export function SectionsMenu({ items, activeKey, onJump }: SectionListProps) {
  // With nothing to list yet (the plan hasn't arrived) the button stays in
  // place, disabled, rather than popping in later and shoving the bar's other
  // buttons along.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!items.length}>
        <button type="button" aria-label="Sections" className={TOPIC_BAR_BUTTON}>
          <ListTree className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sections</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          On this sheet
        </DropdownMenuLabel>
        {items.map((it) => (
          <DropdownMenuItem
            key={it.key}
            disabled={it.state === "waiting"}
            onSelect={() => onJump(it.key)}
            className={`gap-2 ${it.key === activeKey && it.state !== "waiting" ? "font-medium text-primary" : ""}`}
          >
            <span className={`min-w-0 flex-1 truncate ${it.state === "live" ? "text-shimmer" : ""}`}>
              {it.title}
            </span>
            <StateMark state={it.state} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
