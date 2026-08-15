import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Baby,
  HeartPulse,
  Pill,
  Shield,
  Stethoscope,
  X,
  type LucideIcon,
} from "lucide-react";

interface Topic {
  id?: string;
  title: string;
}

interface Section {
  system?: string;
  topics: Topic[];
}

const getTopicVisual = (title: string): { icon: LucideIcon; accent: string } => {
  const normalized = title.toLowerCase();

  if (normalized.includes("hypertension") || normalized.includes("pressure")) {
    return { icon: Activity, accent: "bg-primary/10 text-primary" };
  }

  if (normalized.includes("heart") || normalized.includes("cardio") || normalized.includes("arrhythmia")) {
    return { icon: HeartPulse, accent: "bg-primary/10 text-primary" };
  }

  if (normalized.includes("failure") || normalized.includes("valve") || normalized.includes("disease")) {
    return { icon: Stethoscope, accent: "bg-primary/10 text-primary" };
  }

  if (normalized.includes("statin") || normalized.includes("pharmac") || normalized.includes("lipid")) {
    return { icon: Pill, accent: "bg-success-soft text-success" };
  }

  if (normalized.includes("pedi") || normalized.includes("child") || normalized.includes("congenital")) {
    return { icon: Baby, accent: "bg-primary/10 text-primary" };
  }

  if (normalized.includes("immune") || normalized.includes("inflammatory") || normalized.includes("infection")) {
    return { icon: Shield, accent: "bg-primary/10 text-primary" };
  }

  return { icon: HeartPulse, accent: "bg-primary/10 text-primary" };
};

const TpiceRodmap = ({
  section,
  onClose,
}: {
  section: Section;
  onClose?: () => void;
}) => {
  const navigate = useNavigate();

  const openSheetFor = (title: string) => {
    navigate("/sheets", { state: { topic: title } });
  };

  const handleBack = () => {
    if (onClose) {
      onClose();
      return;
    }

    navigate("/roadmap");
  };

  return (
    <div className="w-full rounded-[16px] border border-border bg-card p-4 shadow-lg sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-primary sm:text-[2.1rem]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {section.system ?? "Topics"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base" style={{ fontFamily: 'Inter, sans-serif' }}>
            Select a topic to generate a detailed study sheet or flashcards.
          </p>
        </div>

        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-primary transition hover:border-primary hover:bg-secondary"
        >
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to Roadmap
          </span>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {section.topics.map((topic, index) => {
          const { icon: Icon, accent } = getTopicVisual(topic.title);

          return (
            <button
              key={topic.id ?? `${topic.title}-${index}`}
              type="button"
              onClick={() => openSheetFor(topic.title)}
              className="group relative flex w-full items-center gap-3 rounded-[12px] border border-border bg-secondary p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-primary hover:bg-card hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] ${accent}`}>
                <Icon className="h-6 w-6" strokeWidth={2} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary" style={{ fontFamily: 'Inter, sans-serif' }}>
                  <span className="inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-primary" />
                  READY
                </div>

                <div className="text-left text-[1.05rem] font-medium leading-[1.35] tracking-[-0.02em] text-foreground" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  {topic.title}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TpiceRodmap;
