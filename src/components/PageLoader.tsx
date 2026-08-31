import { Stethoscope, type LucideIcon } from "lucide-react";

type LoaderContext = "session" | "cards" | "qbank" | "sheets" | "generic";

/**
 * What is actually being waited on, per context.
 *
 * This component used to rotate invented progress steps — "Syncing medical
 * telemetry…", "Generating diagnostic cases…", "Compiling answer rationales…" —
 * on a 2.5s timer, none of which corresponded to any real work. In a product
 * that asks students to trust clinical content, a UI that performs activity it
 * is not doing is the same failure as an uncited claim.
 *
 * One honest line each. No timer, no fabricated sequence.
 */
const LOADER_LABEL: Record<LoaderContext, string> = {
  session: "Restoring your session…",
  cards: "Loading your cards…",
  qbank: "Loading questions…",
  sheets: "Loading your sheets…",
  generic: "Loading…",
};

interface PageLoaderProps {
  context?: LoaderContext;
  fullPage?: boolean;
  /** Override when the caller knows something more specific. */
  label?: string;
  icon?: LucideIcon;
}

const PageLoader = ({
  context = "generic",
  fullPage = true,
  label,
  icon: Icon = Stethoscope,
}: PageLoaderProps) => {
  const text = label ?? LOADER_LABEL[context];

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullPage ? "min-h-[60vh]" : "py-12"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="loader-pulse flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-sm">
        <Icon className="h-8 w-8 text-primary" aria-hidden="true" />
      </div>

      <p className="text-xs font-medium tracking-wide text-muted-foreground">
        {text}
      </p>
    </div>
  );
};

export default PageLoader;
