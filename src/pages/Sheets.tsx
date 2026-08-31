import { useLocation } from "react-router-dom";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SheetGenerator from "@/components/SheetGenerator";

const Sheets = () => {
  // The Roadmap navigates here with a topic to seed the notes field.
  const location = useLocation();
  const state = location.state as { topic?: string } | null;
  const prefill = state?.topic ? { input: state.topic, output: "" } : undefined;

  return (
    <DashboardLayout width="app">
      <div className="ds-stack">
        <header>
          <p className="ds-label ds-label-accent">Study sheet</p>
          <h1 className="ds-display mt-2">
            Generate your{" "}
            <span className="italic text-primary">study sheet.</span>
          </h1>
          <p className="ds-subtitle mt-2.5 max-w-[54ch]">
            Enter any medical topic — your structured clinical sheet builds
            section by section.
          </p>
        </header>
        <SheetGenerator prefill={prefill} />
      </div>
    </DashboardLayout>
  );
};

export default Sheets;
