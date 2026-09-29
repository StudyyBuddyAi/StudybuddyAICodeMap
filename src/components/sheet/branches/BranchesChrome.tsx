import { useSyncExternalStore, type ReactNode } from "react";
import { Stethoscope } from "lucide-react";
import { EcgTrace } from "./kind";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NO_BRANCHES, useBranchesSelector, type BranchesState, type BranchesStore } from "@/hooks/use-sheet-branches";

/**
 * The parts of the page around the sheet that show the branches: the topic
 * bar's button, its phone-menu twin, and the layout that makes room for the
 * panel. Each subscribes to the few things it shows, so the page itself never
 * re-renders for a branch — and neither does the sheet inside it.
 */

interface ButtonView {
  count: number;
  busy: boolean;
  showingAll: boolean;
}

const buttonView = (st: BranchesState): ButtonView => ({
  count: st.layer.branches.length,
  busy: st.suggesting || Object.values(st.growing).some((g) => g.status === "growing"),
  showingAll: st.panel === "all",
});
const sameButton = (a: ButtonView, b: ButtonView) => a.count === b.count && a.busy === b.busy && a.showingAll === b.showingAll;

/** The topic bar's Deep dives button: how many there are, and whether one is being written. */
export function BranchesButton({ store, disabled, className }: { store: BranchesStore; disabled?: boolean; className: string }) {
  const { count, busy, showingAll } = useBranchesSelector(store, "button", buttonView, sameButton);
  return (
    <button
      type="button"
      onClick={() => (showingAll ? store.actions.close() : store.actions.openAll())}
      disabled={disabled}
      aria-pressed={showingAll}
      aria-label={`Deep dives${count ? ` (${count})` : ""}`}
      className={`${className}${showingAll ? " bg-secondary text-foreground" : ""}`}
    >
      {busy ? <EcgTrace className="h-3.5 w-5 text-primary" /> : <Stethoscope className="h-3.5 w-3.5 text-primary" />}
      <span>Deep dives</span>
      {count > 0 && (
        <span className="rounded-[4px] bg-secondary px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground/80">{count}</span>
      )}
    </button>
  );
}

/** The same, in the topic bar's menu, where it lives on a phone. */
export function BranchesMenuItem({ store, disabled }: { store: BranchesStore; disabled?: boolean }) {
  const count = useBranchesSelector(store, "count", (st) => st.layer.branches.length, Object.is);
  return (
    <>
      <DropdownMenuItem className="sm:hidden" disabled={disabled} onSelect={store.actions.openAll}>
        <Stethoscope className="mr-2 h-4 w-4" />
        Deep dives{count ? ` · ${count}` : ""}
      </DropdownMenuItem>
      <DropdownMenuSeparator className="sm:hidden" />
    </>
  );
}

const WIDE = "(min-width: 1440px)";

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(WIDE);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false
  );
}

/**
 * The reading layout, making room for the panel. On a wide screen the panel
 * lays over the contents rail's column and the sheet does not move at all;
 * narrower, the sheet moves over to sit beside it — the line a branch grew
 * from stays in view — and the rail gives up its column. The sheet is passed
 * in as children: this re-renders when the panel opens, the sheet does not.
 */
export function PanelAwareLayout({ store, rail, children }: { store: BranchesStore | null; rail: ReactNode; children: ReactNode }) {
  // A sheet without branches (a legacy text one) still gets the layout, with no panel to make room for.
  const open = useBranchesSelector(store ?? NO_BRANCHES, "panel-open", (st) => !!store && st.panel !== null, Object.is);
  const wide = useWide();
  const shift = open && !wide;
  return (
    <div className={`transition-[padding] duration-300 ${shift ? "lg:pr-[400px] xl:pr-[440px]" : ""}`}>
      <div
        className={`mx-auto grid w-full max-w-[760px] grid-cols-1 ${
          shift ? "" : "xl:max-w-[1064px] xl:grid-cols-[minmax(0,760px)_240px] xl:gap-16"
        }`}
      >
        {children}
        {!shift && (
          <aside className={`hidden xl:block${open ? " invisible" : ""}`} aria-label="Sheet contents" aria-hidden={open || undefined}>
            {rail}
          </aside>
        )}
      </div>
    </div>
  );
}
