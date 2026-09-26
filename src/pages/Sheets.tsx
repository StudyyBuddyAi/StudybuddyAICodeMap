import { useLocation } from "react-router-dom";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SheetGenerator from "@/components/SheetGenerator";
import SEO from "@/components/SEO";
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
  // The Roadmap navigates here with a topic to seed the box.
  const location = useLocation();
  const topic = (location.state as { topic?: string } | null)?.topic;

  return (
    <>
      <SEO
        title="Study Sheets · AI-Powered Medical Notes"
        description="Generate structured clinical study sheets on any medical topic. Covers pathophysiology, diagnosis, and management with PubMed citations."
        keywords="medical study sheets, clinical notes, AI medical education, pathophysiology, medical students"
      />
      <DashboardLayout>
        <SheetGenerator key={topic ?? "blank"} prefill={topic ? { input: topic, output: "" } : undefined} />
      </DashboardLayout>
    </>
  );
};

export default Sheets;
