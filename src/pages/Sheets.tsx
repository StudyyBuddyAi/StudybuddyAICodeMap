import { useLocation } from "react-router-dom";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SheetGenerator, { type SheetGeneratorPrefill } from "@/components/SheetGenerator";
import "@/index.css";

/**
 * The Sheets page is the generator: it has its own compose and reading views,
 * each with its own header, so the page adds nothing around it.
 *
 * On the full-width shell: the reading view centres a readable column with a
 * contents rail beside it, and the 1280px cap used to squeeze that down to a
 * third of the screen.
 */
const Sheets = () => {
  // The Roadmap navigates here with a topic to seed the box; the Library, with a
  // saved sheet to open for more work — its layer and branches load with it.
  const location = useLocation();
  const state = location.state as { topic?: string; saved?: SheetGeneratorPrefill } | null;
  const topic = state?.topic;
  const saved = state?.saved?.id ? state.saved : null;

  return (
    <DashboardLayout>
      <SheetGenerator
        key={saved?.id ?? topic ?? "blank"}
        prefill={saved ?? (topic ? { input: topic, output: "" } : undefined)}
      />
    </DashboardLayout>
  );
};

export default Sheets;
