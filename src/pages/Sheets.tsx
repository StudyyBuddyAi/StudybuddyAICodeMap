import { lazy, Suspense } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SheetGenerator, { type SheetGeneratorPrefill } from "@/components/SheetGenerator";
import "@/index.css";

// ── Development only: the anatomy harness (plan Part II) ─────────────────────
// /sheets?anatomy=1&topic=… exercises real matching against the ingested
// library; ?anatomy=placeholder is the offline layout fixture, which needs no
// deployed function and no database. Gated on import.meta.env.DEV and loaded
// lazily, so a production build carries neither the route nor its code.
const AnatomyHarness = import.meta.env.DEV ? lazy(() => import("@/components/anatomy/AnatomyHarness")) : null;

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

  const [searchParams] = useSearchParams();
  const anatomy = searchParams.get("anatomy");

  if (AnatomyHarness && anatomy) {
    return (
      <DashboardLayout>
        <Suspense fallback={null}>
          <AnatomyHarness mode={anatomy} topic={searchParams.get("topic") ?? "Digestive system"} />
        </Suspense>
      </DashboardLayout>
    );
  }

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
