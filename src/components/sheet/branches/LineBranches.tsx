import { m } from "motion/react";
import type { BranchesApi, GrowingBranch } from "@/hooks/use-sheet-branches";
import { BRANCH_TYPE_LABEL } from "@/lib/sheet-branches";
import type { LayerBranch, LayerPill } from "@/lib/sheet-layer";
import { ENTER } from "@/lib/motion";
import { useBranches } from "./branch-context";
import { BranchChip } from "./BranchChip";

/**
 * The branches of one line of the sheet. They hang from the line rather than
 * run on with it: a stem drops from under the line and curves into them, the
 * way a branch leaves a trunk, so they read as growing out of what the line
 * says and never as more of it.
 *
 * Each branch keeps one place from the moment its line is known: a
 * placeholder while the sheet is still choosing it, then a suggestion, then
 * growing, then grown — the same chip changing, never a new one popping in
 * elsewhere. The row slides open once rather than shoving the page about.
 */

/** One chip's place on a line, and what is in it now. */
export type BranchSlot =
  | { key: string; state: "placeholder" }
  | { key: string; state: "suggested"; pill: LayerPill }
  | { key: string; state: "growing" | "error"; growing: GrowingBranch }
  | { key: string; state: "grown"; branch: LayerBranch };

/** What hangs from a line, in a fixed order: the sheet's suggestions as it gave them, then the student's own. */
export function slotsAt(api: BranchesApi, anchor: string): BranchSlot[] {
  const top = api.branches.filter((b) => b.anchor === anchor && !b.parentId);
  const kept = new Set(api.branches.map((b) => b.id));
  const inFlight = Object.values(api.growing).filter((g) => g.anchor === anchor && !g.parentId);
  const used = new Set<string>();
  const slots: BranchSlot[] = [];

  const fill = (key: string, pillId?: string, pill?: LayerPill) => {
    const g = pillId ? inFlight.find((x) => x.pillId === pillId) : undefined;
    const b = pillId ? top.find((x) => x.pillId === pillId) : undefined;
    // A branch being grown again stays grown in its chip; the panel shows it rewriting, or failing to.
    if (g && !(b && g.replaces)) {
      used.add(g.id);
      if (b) used.add(b.id);
      return slots.push({ key, state: g.status, growing: g });
    }
    if (b) {
      used.add(b.id);
      return slots.push({ key, state: "grown", branch: b });
    }
    // A read-only view shows what was grown, and offers nothing to grow.
    if (pill && !api.readOnly) slots.push({ key, state: "suggested", pill });
  };

  for (const p of api.pills) if (p.anchor === anchor) fill(p.id, p.id, p);
  if (!api.readOnly && api.pendingPill?.anchor === anchor) slots.push({ key: api.pendingPill.id, state: "placeholder" });
  // The student's own, and any whose suggestion is gone: keyed by the branch, which a growing one shares.
  for (const b of top) {
    if (used.has(b.id)) continue;
    slots.push({ key: b.pillId ?? b.id, state: "grown", branch: b });
    used.add(b.id);
  }
  for (const g of inFlight) {
    if (used.has(g.id) || kept.has(g.id)) continue;
    slots.push({ key: g.pillId ?? g.id, state: g.status, growing: g });
  }
  return slots;
}

/** Whether a line has anything to show — checked before rendering, so a line without chips adds no space. */
export function lineHasBranches(api: BranchesApi | null, anchor: string): boolean {
  return !!api && slotsAt(api, anchor).length > 0;
}

export function LineBranches({ anchor }: { anchor: string }) {
  const api = useBranches();
  if (!api) return null;
  const slots = slotsAt(api, anchor);
  if (!slots.length) return null;
  const open = api.panel === "branch" ? api.openId : null;
  const childCount = (id: string) => api.branches.filter((b) => b.parentId === id).length;
  // A row that appears while branches are arriving slides open; one already there on load just is.
  const arriving = api.suggesting || Object.keys(api.growing).length > 0;

  return (
    <m.span
      data-branch-chips
      className="block print:hidden"
      initial={arriving ? { height: 0, opacity: 0, overflow: "hidden" } : false}
      animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
      transition={ENTER}
    >
      <span className="relative flex pb-0.5 pl-7 pt-1">
        {/* The stem: out of the line, down, and round into the first pill. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-[2px] h-[19px] w-4 rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px] border-info/50"
        />
        <span aria-hidden className="pointer-events-none absolute left-[7px] top-0 h-[7px] w-[7px] rounded-full border-[1.5px] border-info/60 bg-card" />
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 pt-[3px]">
          {slots.map((s, i) => {
            switch (s.state) {
              case "placeholder":
                return <BranchChip key={s.key} index={i} type="ask" label="" state="placeholder" onClick={() => {}} disabled ariaLabel="Finding a branch for this line" />;
              case "suggested":
                return (
                  <BranchChip
                    key={s.key}
                    index={i}
                    type={s.pill.type}
                    label={s.pill.label}
                    state="suggested"
                    disabled={!api.enabled}
                    onClick={() => api.growPill(s.pill)}
                    title={s.pill.ask}
                    ariaLabel={`Grow a ${BRANCH_TYPE_LABEL[s.pill.type].toLowerCase()} branch: ${s.pill.label}`}
                  />
                );
              case "growing":
              case "error": {
                const g = s.growing;
                const failed = s.state === "error";
                return (
                  <BranchChip
                    key={s.key}
                    index={i}
                    type={g.question.type}
                    label={g.question.label}
                    state={s.state}
                    onClick={() => (failed ? api.retry(g.id) : api.open(g.id))}
                    title={failed ? "Couldn't grow this branch — try again" : g.question.ask}
                    selected={open === g.id}
                  />
                );
              }
              case "grown":
                return (
                  <BranchChip
                    key={s.key}
                    index={i}
                    type={s.branch.type}
                    label={s.branch.label}
                    state="grown"
                    onClick={() => api.open(s.branch.id)}
                    title={s.branch.ask || s.branch.label}
                    ariaLabel={`${BRANCH_TYPE_LABEL[s.branch.type]}: ${s.branch.label} — open`}
                    children={childCount(s.branch.id)}
                    selected={open === s.branch.id}
                  />
                );
            }
          })}
        </span>
      </span>
    </m.span>
  );
}

/** A line's branches as three lists, for the panel's line view. */
export function branchesAt(api: BranchesApi, anchor: string) {
  const slots = slotsAt(api, anchor);
  return {
    grown: slots.flatMap((s) => (s.state === "grown" ? [s.branch] : [])),
    growing: slots.flatMap((s) => (s.state === "growing" || s.state === "error" ? [s.growing] : [])),
    pills: slots.flatMap((s) => (s.state === "suggested" ? [s.pill] : [])),
  };
}
