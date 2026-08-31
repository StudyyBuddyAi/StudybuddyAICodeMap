import { useState } from "react";
import { useLocation } from "react-router-dom";
import { PenLine, Sparkles, BookOpenCheck, Clock3, Target } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SheetGenerator from "@/components/SheetGenerator";
import "@/index.css";
// Steps shown above the generator so a first-time visitor immediately
// understands the flow: type a topic -> AI builds the sheet -> study it.
const HOW_IT_WORKS = [
  {
    label: "Step 1",
    title: "Enter a topic",
    description: "Type any medical topic, or paste your own notes / a PDF.",
    icon: PenLine,
  },
  {
    label: "Step 2",
    title: "AI builds the sheet",
    description: "Structured sections generate live — pathophys to management.",
    icon: Sparkles,
  },
  {
    label: "Step 3",
    title: "Study & review",
    description: "Read, enhance, or send straight into a QBank session.",
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
  const prefill = activeTopic ? { input: activeTopic, output: "" } : undefined;
 
  return (
    <DashboardLayout wide>
      <div className="space-y-8">
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
        <div
          className="grid grid-cols-1 gap-3 rounded-2xl border p-4 sm:grid-cols-3"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-panel)",
          }}
        >
          {HOW_IT_WORKS.map(({ label, title, description, icon: Icon }) => (
            <div key={title} className="flex items-start gap-3 rounded-xl p-2">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "var(--color-foreground)",
                  color: "var(--color-accent)",
                }}
              >
                <Icon size={18} strokeWidth={2} />
              </div>
              <div>
                <p
                  className="[font-family:var(--app-font-mono)] text-[10px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: "var(--color-accent)" }}
                >
                  {label}
                </p>
                <h3
                  className="mt-0.5 text-sm font-bold"
                  style={{ color: "var(--color-foreground)" }}
                >
                  {title}
                </h3>
                <p
                  className="mt-1 text-xs leading-relaxed"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
 
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
 
        <SheetGenerator key={activeTopic || "blank"} prefill={prefill} />
      </div>
    </DashboardLayout>
  );
};
 
export default Sheets;