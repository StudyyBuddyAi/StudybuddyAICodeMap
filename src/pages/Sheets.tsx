import { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  Clock3,
  PenLine,
  Sparkles,
  Target,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SheetGenerator from "@/components/SheetGenerator";
import "@/index.css";
import SEO from "@/components/SEO";
// Steps shown above the generator so a first-time visitor immediately
// understands the flow: type a topic -> AI builds the sheet -> study it.
const HOW_IT_WORKS = [
  {
    label: "Step 1",
    title: "Enter a topic",
    description: "Type any medical topic, paste notes, or drop a PDF and let the system map it instantly.",
    icon: PenLine,
  },
  {
    label: "Step 2",
    title: "AI builds the sheet",
    description: "Your clinical summary is generated live with structure, mechanisms, diagnosis, and management.",
    icon: BrainCircuit,
  },
  {
    label: "Step 3",
    title: "Study & review",
    description: "Read, refine, and move directly into a focused QBank session without losing momentum.",
    icon: BookOpenCheck,
  },
] as const;
 
// A handful of high-yield topics so the page never feels like a blank slate.
const SUGGESTED_TOPICS = [
  "Acute Coronary Syndrome",
  "Diabetic Ketoacidosis",
  "Community-Acquired Pneumonia",
  "Nephrotic Syndrome",
  "Stroke Management",
];
 
const Sheets = () => {
  // The Roadmap navigates here with a topic to seed the notes field.
  const location = useLocation();
  const state = location.state as { topic?: string } | null;
 
  const [activeTopic, setActiveTopic] = useState(state?.topic ?? "");
  const prefill = { input: activeTopic, output: "" };
 
  return (
    <>
      <SEO
        title="Study Sheets · AI-Powered Medical Notes"
        description="Generate structured clinical study sheets on any medical topic. Covers pathophysiology, diagnosis, and management with PubMed citations."
        keywords="medical study sheets, clinical notes, AI medical education, pathophysiology, medical students"
      />
      <DashboardLayout wide>
        <div className="space-y-8 mx-auto sm:max-w-[86%]">
          {/* Header */}
          <div>
            <p
              className="mb-2 [font-family:var(--app-font-mono)] text-[11px] font-medium uppercase tracking-[0.14em]"
              style={{ color: "var(--color-accent)" }}
            >
              Study Sheet · AI-Powered
            </p>
            <h1
              className="[font-family:var(--app-font-serif)] text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] tracking-[-0.012em]"
              style={{ color: "var(--color-foreground)" }}
            >
              Generate your{" "}
              <span className="italic" style={{ color: "var(--color-accent)" }}>
                study sheet.
              </span>
            </h1>
            <p
              className="mt-2.5 max-w-xl text-base leading-relaxed"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              Enter any medical topic — your structured clinical sheet builds section
              by section.
            </p>
          </div>
          {/* How it works — makes the page self-explanatory at a glance */}
          {/* steps */}
          <div className="relative">
            <div className="absolute inset-x-10 top-7 hidden h-px bg-gradient-to-r from-transparent via-[color:var(--color-accent)]/60 to-transparent sm:block" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {HOW_IT_WORKS.map(({ label, title, description, icon: Icon }, index) => (
                <div key={title} className="relative z-10">
                  <div className="group flex items-center gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent)]/70 sm:flex-col sm:items-center sm:text-center sm:p-4">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--color-card)] bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] shadow-sm">
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-[9px] font-bold text-[color:var(--color-background)] shadow-sm">
                        {index + 1}
                      </span>
                      <Icon size={16} strokeWidth={2.2} />
                    </div>

                    <div className="min-w-0 flex-1 sm:flex-none">
                      <div className="mb-2 inline-flex items-center gap-1.5">
                        <span className="[font-family:var(--app-font-mono)] text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-accent)]">
                          {label}
                        </span>
                        <ArrowRight size={12} className="text-[color:var(--color-muted-foreground)] transition-transform duration-200 group-hover:translate-x-0.5" />
                      </div>

                      <h3 className="[font-family:var(--app-font-serif)] text-base font-medium leading-snug text-[color:var(--color-foreground)]">
                        {title}
                      </h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--color-muted-foreground)]">
                        {description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* steps */}
          {/* Quick start — removes blank-page hesitation */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <Target size={13} style={{ color: "var(--color-accent)" }} />
              Try a topic:
            </span>
            {SUGGESTED_TOPICS.map((topic) => {
              const isActive = activeTopic === topic;
              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => setActiveTopic(isActive ? "" : topic)}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium transition-transform hover:-translate-y-0.5"
                  style={
                    isActive
                      ? {
                          borderColor: "var(--color-foreground)",
                          background: "var(--color-foreground)",
                          color: "var(--color-background)",
                        }
                      : {
                          borderColor: "var(--color-border)",
                          background: "var(--color-card)",
                          color: "var(--color-foreground)",
                        }
                  }
                >
                  {topic}
                </button>
              );
            })}
            <span
              className="inline-flex items-center gap-1 text-[11px]"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <Clock3 size={12} />
              ~10s to generate
            </span>
          </div>

          <SheetGenerator prefill={prefill} />
        </div>
      </DashboardLayout>
    </>
  );
};
 
export default Sheets;