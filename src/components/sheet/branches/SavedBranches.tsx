import { ChevronRight } from "lucide-react";
import type { LayerBranch } from "@/lib/sheet-layer";
import { anchorSection } from "@/lib/sheet-layer";
import { BRANCH_TYPE_LABEL } from "@/lib/sheet-branches";
import { BranchMarkdown } from "./BranchMarkdown";
import { KindBadge } from "./kind";

/**
 * A saved sheet's deep dives, where there is no panel to open them in — the
 * Library's preview. Under the section they grew from, each one closed until
 * asked for, its follow-ups inside it.
 */
export function SavedBranches({ sectionKey, branches }: { sectionKey: string; branches: LayerBranch[] }) {
  const roots = branches.filter((b) => !b.parentId && anchorSection(b.anchor) === sectionKey);
  if (!roots.length) return null;
  const childrenOf = (id: string) => branches.filter((b) => b.parentId === id);

  const render = (b: LayerBranch) => {
    const kids = childrenOf(b.id);
    return (
      <details key={b.id} className="group rounded-lg border border-border bg-background/60 open:bg-background">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-foreground/90 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <KindBadge type={b.type} />
          <span className="min-w-0 flex-1 truncate font-medium">{b.label}</span>
          <span className="sr-only">{BRANCH_TYPE_LABEL[b.type]}</span>
        </summary>
        <div className="space-y-2 px-3 pb-3">
          <BranchMarkdown text={b.text} />
          {kids.length > 0 && <div className="space-y-1.5 pl-3">{kids.map(render)}</div>}
        </div>
      </details>
    );
  };

  return (
    <div className="mt-3 space-y-1.5 print:hidden">
      <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Deep dives · {roots.length}</p>
      {roots.map(render)}
    </div>
  );
}
