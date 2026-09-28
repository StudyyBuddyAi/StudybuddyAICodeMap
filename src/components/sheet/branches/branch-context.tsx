import { createContext, useContext } from "react";
import {
  ArrowLeftRight,
  Atom,
  ListChecks,
  MessageCircleQuestion,
  PenLine,
  Search,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { BranchesApi } from "@/hooks/use-sheet-branches";
import type { BranchType } from "@/lib/sheet-branches";

/**
 * The page's branches, for the parts of the sheet that show them: the chips
 * under each line, the line menu, the panel. Absent (Library's saved-sheet
 * view), a sheet renders without branches.
 */
const BranchesContext = createContext<BranchesApi | null>(null);

export const BranchesProvider = BranchesContext.Provider;

export const useBranches = () => useContext(BranchesContext);

/** Each kind of branch's mark, so a chip says what it will open before it is opened. */
export const BRANCH_ICON: Record<BranchType, LucideIcon> = {
  management: ListChecks,
  compare: ArrowLeftRight,
  differential: Search,
  mechanism: Atom,
  case: UserRound,
  ask: MessageCircleQuestion,
  note: PenLine,
};
