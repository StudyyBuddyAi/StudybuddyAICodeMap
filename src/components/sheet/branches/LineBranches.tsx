import { m } from "motion/react";
import { NO_BRANCHES, useBranchesSelector, type BranchesState, type GrowingBranch } from "@/hooks/use-sheet-branches";
import { BRANCH_TYPE_LABEL } from "@/lib/sheet-branches";
import type { LayerBranch, LayerPill } from "@/lib/sheet-layer";
import { ENTER } from "@/lib/motion";
import { useBranchStore } from "./branch-context";
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
 *
 * Each line subscribes to its own chips only: a branch growing elsewhere, or
 * the panel opening, leaves it alone.
 */

/** One chip's place on a line, and what is in it now. */
export type BranchSlot =
  | { key: string; state: "placeholder" }
  | { key: string; state: "suggested"; pill: LayerPill }
  | { key: string; state: "growing" | "error"; growing: GrowingBranch }
  | { key: string; state: "grown"; branch: LayerBranch };

/** What slotsAt reads: the store's state, or the panel's view of it. */
type SlotSource = {
  branches: LayerBranch[];
  growing: Record<string, GrowingBranch>;
  pills: LayerPill[];
  pendingPill: { id: string; anchor: string } | null;
  readOnly: boolean;
};

const sourceOf = (st: BranchesState): SlotSource => ({
  branches: st.layer.branches,
  growing: st.growing,
  pills: st.streamed?.pills ?? st.layer.pills,
  pendingPill: st.streamed?.pending ?? null,
  readOnly: st.readOnly,
});

/** What hangs from a line, in a fixed order: the sheet's suggestions as it gave them, then the student's own. */
export function slotsAt(src: SlotSource, anchor: string): BranchSlot[] {
  const top = src.branches.filter((b) => b.anchor === anchor && !b.parentId);
  const kept = new Set(src.branches.map((b) => b.id));
  // Being checked is still being grown, to the sheet; a declined question never reaches it.
  const inFlight = Object.values(src.growing).filter((g) => g.anchor === anchor && !g.parentId && g.status !== "declined");
  const chipState = (g: GrowingBranch): "growing" | "error" => (g.status === "error" ? "error" : "growing");
  const used = new Set<string>();
  const slots: BranchSlot[] = [];

  const fill = (key: string, pillId?: string, pill?: LayerPill) => {
    const g = pillId ? inFlight.find((x) => x.pillId === pillId) : undefined;
    const b = pillId ? top.find((x) => x.pillId === pillId) : undefined;
    // A branch being grown again stays grown in its chip, and so does one kept and
    // now being checked; the panel shows what is happening to it.
    if (g && !(b && (g.replaces || g.status === "reviewing"))) {
      used.add(g.id);
      if (b) used.add(b.id);
      return slots.push({ key, state: chipState(g), growing: g });
    }
    if (b) {
      used.add(b.id);
      return slots.push({ key, state: "grown", branch: b });
    }
    // A read-only view shows what was grown, and offers nothing to grow.
    if (pill && !src.readOnly) slots.push({ key, state: "suggested", pill });
  };

  for (const p of src.pills) if (p.anchor === anchor) fill(p.id, p.id, p);
  if (!src.readOnly && src.pendingPill?.anchor === anchor) slots.push({ key: src.pendingPill.id, state: "placeholder" });
  // The student's own, and any whose suggestion is gone: keyed by the branch, which a growing one shares.
  for (const b of top) {
    if (used.has(b.id)) continue;
    slots.push({ key: b.pillId ?? b.id, state: "grown", branch: b });
    used.add(b.id);
  }
  for (const g of inFlight) {
    if (used.has(g.id) || kept.has(g.id)) continue;
    slots.push({ key: g.pillId ?? g.id, state: chipState(g), growing: g });
  }
  return slots;
}

/** A line's chips as it shows them: the slots, and what else each chip says. */
interface LineView {
  slots: BranchSlot[];
  /** Branches grown below each grown one. */
  children: Record<string, number>;
  /** The branch open in the panel, if it is on this line. */
  selected: string | null;
  /** Whether the growing ones are being checked rather than written. */
  checking: Record<string, boolean>;
  enabled: boolean;
}

function lineView(st: BranchesState, anchor: string): LineView {
  const slots = slotsAt(sourceOf(st), anchor);
  const children: Record<string, number> = {};
  const checking: Record<string, boolean> = {};
  let selected: string | null = null;
  const openId = st.panel === "branch" ? st.openId : null;
  for (const s of slots) {
    if (s.state === "grown") {
      children[s.branch.id] = st.layer.branches.filter((b) => b.parentId === s.branch.id).length;
      if (openId === s.branch.id) selected = openId;
    } else if (s.state === "growing" || s.state === "error") {
      checking[s.growing.id] = s.growing.status === "reviewing";
      if (openId === s.growing.id) selected = openId;
    }
  }
  return { slots, children, selected, checking, enabled: st.enabled };
}

/** Whether two views would draw the same chips. */
function sameView(a: LineView, b: LineView): boolean {
  if (a.selected !== b.selected || a.enabled !== b.enabled || a.slots.length !== b.slots.length) return false;
  for (let i = 0; i < a.slots.length; i++) {
    const x = a.slots[i];
    const y = b.slots[i];
    if (x.key !== y.key || x.state !== y.state) return false;
    if (x.state === "suggested" && y.state === "suggested" && x.pill !== y.pill) return false;
    if (x.state === "grown" && y.state === "grown" && (x.branch !== y.branch || a.children[x.branch.id] !== b.children[y.branch.id])) return false;
    if ((x.state === "growing" || x.state === "error") && (y.state === "growing" || y.state === "error")) {
      if (x.growing.question !== y.growing.question || a.checking[x.growing.id] !== b.checking[y.growing.id]) return false;
    }
  }
  return true;
}

const EMPTY: LineView = { slots: [], children: {}, selected: null, checking: {}, enabled: false };

export function LineBranches({ anchor }: { anchor: string }) {
  const store = useBranchStore();
  if (!store) return null;
  return <LineChips anchor={anchor} store={store} />;
}

/** Whether a line has chips — for a table, which adds a row under a line only when something goes in it. */
export function useLineHasChips(anchor: string, on: boolean): boolean {
  const store = useBranchStore();
  return useBranchesSelector(store ?? NO_BRANCHES, anchor, (st) => on && slotsAt(sourceOf(st), anchor).length > 0, Object.is);
}

function LineChips({ anchor, store }: { anchor: string; store: NonNullable<ReturnType<typeof useBranchStore>> }) {
  const view = useBranchesSelector(store, anchor, (st) => lineView(st, anchor), sameView) ?? EMPTY;
  const { slots, children, selected, checking, enabled } = view;
  if (!slots.length) return null;
  const actions = store.actions;
  // A row that appears while branches are arriving slides open; one already there on load just is.
  const st = store.getState();
  const arriving = st.suggesting || Object.keys(st.growing).length > 0;

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
          className="pointer-events-none absolute left-2.5 top-[2px] h-[19px] w-4 rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px] border-foreground/20"
        />
        <span aria-hidden className="pointer-events-none absolute left-[7px] top-0 h-[7px] w-[7px] rounded-full border-[1.5px] border-foreground/30 bg-card" />
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 pt-[3px] [@media(pointer:coarse)]:gap-2">
          {slots.map((s, i) => {
            switch (s.state) {
              case "placeholder":
                return <BranchChip key={s.key} index={i} type="ask" label="" state="placeholder" onClick={() => {}} disabled ariaLabel="Finding a deep dive for this line" />;
              case "suggested":
                return (
                  <BranchChip
                    key={s.key}
                    index={i}
                    type={s.pill.type}
                    label={s.pill.label}
                    state="suggested"
                    disabled={!enabled}
                    onClick={() => actions.growPill(s.pill)}
                    title={s.pill.ask}
                    ariaLabel={`Write a ${BRANCH_TYPE_LABEL[s.pill.type].toLowerCase()} deep dive: ${s.pill.label}`}
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
                    onClick={() => (failed ? actions.retry(g.id) : actions.open(g.id))}
                    title={failed ? "Couldn't write this deep dive — try again" :checking[g.id] ? "Checking it for clinical errors…" : g.question.ask}
                    selected={selected === g.id}
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
                    onClick={() => actions.open(s.branch.id)}
                    title={s.branch.ask || s.branch.label}
                    ariaLabel={`${BRANCH_TYPE_LABEL[s.branch.type]}: ${s.branch.label} — open`}
                    children={children[s.branch.id] ?? 0}
                    selected={selected === s.branch.id}
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
export function branchesAt(src: SlotSource, anchor: string) {
  const slots = slotsAt(src, anchor);
  return {
    grown: slots.flatMap((s) => (s.state === "grown" ? [s.branch] : [])),
    growing: slots.flatMap((s) => (s.state === "growing" || s.state === "error" ? [s.growing] : [])),
    pills: slots.flatMap((s) => (s.state === "suggested" ? [s.pill] : [])),
  };
}
