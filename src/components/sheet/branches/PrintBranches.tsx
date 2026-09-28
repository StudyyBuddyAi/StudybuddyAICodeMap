import type { LayerBranch } from "@/lib/sheet-layer";
import { anchorSection } from "@/lib/sheet-layer";
import { BRANCH_TYPE_LABEL } from "@/lib/sheet-branches";
import { useBranches } from "./branch-context";
import { BranchMarkdown } from "./BranchMarkdown";

/**
 * A section's branches, for the printed sheet only. On screen they live in
 * the panel; on paper there is no panel, so an exported sheet carries its
 * branches under the section they grew from, each under the one above it.
 */
export function PrintBranches({ sectionKey }: { sectionKey: string }) {
  const api = useBranches();
  if (!api) return null;
  const roots = api.branches.filter((b) => !b.parentId && anchorSection(b.anchor) === sectionKey);
  if (!roots.length) return null;
  const childrenOf = (id: string) => api.branches.filter((b) => b.parentId === id);

  const render = (b: LayerBranch, depth: number) => (
    <div key={b.id} className="mt-3 break-inside-avoid" style={{ marginLeft: depth * 16 }}>
      <p className="text-[13px] font-semibold text-foreground">
        {b.label}
        <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{BRANCH_TYPE_LABEL[b.type]}</span>
      </p>
      <BranchMarkdown text={b.text} revealAnswers />
      {childrenOf(b.id).map((c) => render(c, depth + 1))}
    </div>
  );

  return (
    <div className="hidden border-t border-dashed border-border pt-2 print:block">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Branches</p>
      {roots.map((b) => render(b, 0))}
    </div>
  );
}
