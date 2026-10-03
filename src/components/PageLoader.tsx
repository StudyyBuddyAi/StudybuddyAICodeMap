import { useEffect, useState } from "react";
import BrandMark from "@/components/brand/BrandMark";

type LoaderContext = "session" | "cards" | "qbank" | "sheets" | "generic";

const LOADER_STEPS: Record<LoaderContext, string[]> = {
  session: [
    "Initializing clinical session...",
    "Syncing medical telemetry...",
  ],
  cards: [
    "Fetching active flashcards...",
    "Structuring spaced repetition...",
    "Loading clinical vignettes...",
  ],
  qbank: [
    "Preparing QBank engine...",
    "Generating diagnostic cases...",
    "Compiling answer rationales...",
  ],
  sheets: [
    "Retrieving study sheets...",
    "Organizing lecture modules...",
  ],
  generic: [
    "Loading StudyBuddy medical suite...",
    "Accessing knowledge base...",
    "Configuring learning environment...",
    "Preparing study materials...",
  ],
};

interface PageLoaderProps {
  context?: LoaderContext;
  fullPage?: boolean;
}

/**
 * The app's loader: the brand mark firing away above a rotating status line.
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

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullPage ? "min-h-[60vh]" : "py-12"
      }`}
    >
      <BrandMark size={64} activity="busy" interactive={false} />

      <div className="text-center">
        <p
          key={stepIndex}
          className="animate-fade-in text-xs font-medium text-muted-foreground tracking-wide"
        >
          {steps[stepIndex]}
        </p>
        <span className="text-[10px] text-muted-foreground mt-1 block tracking-wider uppercase font-semibold">
          StudyBuddy Medical
        </span>
      </div>
    </div>
  );
};

export default PageLoader;
