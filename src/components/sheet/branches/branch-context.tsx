import { createContext, useContext } from "react";
import {
  NO_BRANCHES,
  useBranchesApi,
  useBranchesSelector,
  type BranchActions,
  type BranchesApi,
  type BranchesStore,
} from "@/hooks/use-sheet-branches";

/**
 * The page's deep dives, for the parts of the sheet that show them: the tags
 * under each line, the line menu, the selection toolbar, the panel. What is
 * handed down is the store, which never changes: each part subscribes to what
 * it shows. Absent (Library's saved-sheet view), a sheet renders without them.
 */
const BranchesContext = createContext<BranchesStore | null>(null);

export const BranchesProvider = BranchesContext.Provider;

/** The store itself, for a part that picks its own slice (useBranchesSelector). */
export const useBranchStore = () => useContext(BranchesContext);

/** Everything, re-rendering on any change — for the panel. */
export const useBranches = (): BranchesApi | null => useBranchesApi(useContext(BranchesContext));

/** Whether deep dives can be asked for now — the one thing a line's menu needs to know, subscribed to alone. */
export function useBranchesEnabled(): boolean {
  const store = useContext(BranchesContext);
  return useBranchesSelector(store ?? NO_BRANCHES, "enabled", (st) => st.enabled, Object.is);
}

/** What the deep dives do, and nothing that changes: a menu holding these never re-renders for them. */
export const useBranchActions = (): BranchActions | null => useContext(BranchesContext)?.actions ?? null;
