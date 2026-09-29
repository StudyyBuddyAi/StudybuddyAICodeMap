import { RotateCcw } from "lucide-react";
import { useBranchesSelector } from "@/hooks/use-sheet-branches";
import { useBranchStore } from "./branch-context";

/**
 * Said at the top of the sheet when its branch suggestions couldn't be
 * loaded. Without it a failed ask just looks like a sheet with nothing to
 * grow — the panel said so, but only to whoever opened it.
 */
export function BranchesNotice() {
  const store = useBranchStore();
  if (!store) return null;
  return <Notice store={store} />;
}

function Notice({ store }: { store: NonNullable<ReturnType<typeof useBranchStore>> }) {
  const failed = useBranchesSelector(store, "suggest-failed", (st) => st.suggestFailed && st.enabled, Object.is);
  if (!failed) return null;
  return (
    <div
      data-no-print
      role="status"
      className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 text-xs text-warning"
    >
      <span className="flex-1">Couldn't load the deep dives this sheet suggests.</span>
      <button type="button" onClick={store.actions.suggest} className="inline-flex items-center gap-1 font-medium hover:underline">
        <RotateCcw aria-hidden className="h-3 w-3" /> Try again
      </button>
    </div>
  );
}
