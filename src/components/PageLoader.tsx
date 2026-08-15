import { useEffect, useState } from "react";
import { 
  Stethoscope, 
  Brain, 
  FileText, 
  Activity, 
  Pill, 
  BookOpen,
  type LucideIcon 
} from "lucide-react";

type LoaderContext = "session" | "cards" | "qbank" | "sheets" | "generic";

interface LoaderStep {
  text: string;
  icon: LucideIcon;
}

const LOADER_STEPS: Record<LoaderContext, LoaderStep[]> = {
  session: [
    { text: "Initializing clinical session...", icon: Stethoscope },
    { text: "Syncing medical telemetry...", icon: Activity },
  ],
  cards: [
    { text: "Fetching active flashcards...", icon: Brain },
    { text: "Structuring spaced repetition...", icon: BookOpen },
    { text: "Loading clinical vignettes...", icon: Stethoscope },
  ],
  qbank: [
    { text: "Preparing QBank engine...", icon: FileText },
    { text: "Generating diagnostic cases...", icon: Activity },
    { text: "Compiling answer rationales...", icon: Pill },
  ],
  sheets: [
    { text: "Retrieving study sheets...", icon: BookOpen },
    { text: "Organizing lecture modules...", icon: FileText },
  ],
  generic: [
    { text: "Loading StudyBuddy medical suite...", icon: Stethoscope },
    { text: "Accessing knowledge base...", icon: Brain },
    { text: "Configuring learning environment...", icon: Activity },
    { text: "Preparing study materials...", icon: FileText },
  ],
};

interface PageLoaderProps {
  context?: LoaderContext;
  fullPage?: boolean;
}

/**
 * Enhanced medical-themed loader component with dynamic rotating icons and messages.
 */
const PageLoader = ({ context = "generic", fullPage = true }: PageLoaderProps) => {
  const steps = LOADER_STEPS[context];
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (steps.length < 2) return;
    const id = window.setInterval(
      () => setStepIndex((i) => (i + 1) % steps.length),
      2500
    );
    return () => window.clearInterval(id);
  }, [steps.length]);

  const CurrentIcon = steps[stepIndex].icon;

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullPage ? "min-h-[60vh]" : "py-12"
      }`}
    >
      <div className="loader-pulse flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25 shadow-sm transition-all duration-500">
        <CurrentIcon className="h-8 w-8 text-primary animate-pulse" />
      </div>

      <div className="text-center">
        <p
          key={stepIndex}
          className="animate-fade-in text-xs font-medium text-muted-foreground tracking-wide"
        >
          {steps[stepIndex].text}
        </p>
        <span className="text-[10px] text-muted-foreground mt-1 block tracking-wider uppercase font-semibold">
          StudyBuddy Medical
        </span>
      </div>
    </div>
  );
};

export default PageLoader;