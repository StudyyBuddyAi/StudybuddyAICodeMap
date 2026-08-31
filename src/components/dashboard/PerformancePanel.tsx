import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Target } from "lucide-react";
import AccuracyTrend from "@/components/dashboard/AccuracyTrend";
import { useQBankInsights } from "@/hooks/use-qbank-insights";

/**
 * How you are doing, and what to fix.
 *
 * The dashboard could say how much you had done and never how well. Both halves
 * here are computed from finished sessions — nothing is illustrative.
 *
 * The weakness claim is held to a minimum sample (see the hook): telling someone
 * their weakest subject off one unlucky five-question block would be worse than
 * saying nothing.
 */
const PerformancePanel = () => {
  const navigate = useNavigate();
  const { trend, overall, weakest, sessionCount, isLoading, isAvailable } =
    useQBankInsights();

  if (!isAvailable || isLoading || sessionCount === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Trajectory */}
      <section className="ds-card" aria-labelledby="accuracy-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="accuracy-heading" className="ds-label">
              Accuracy
            </h3>
            {/* Sans, not the display serif: a figure is data, and a serif
                numeral here reads as decoration. */}
            <p className="mt-1.5 text-[28px] font-semibold leading-none text-foreground">
              {overall !== null ? `${overall}%` : "—"}
            </p>
          </div>
          <span className="ds-meta shrink-0">
            last {trend.length} block{trend.length === 1 ? "" : "s"}
          </span>
        </div>

        <AccuracyTrend points={trend} overall={overall} />
      </section>

      {/* The one thing to do about it */}
      <section className="ds-card flex flex-col" aria-labelledby="focus-heading">
        <h3 id="focus-heading" className="ds-label">
          Focus next
        </h3>

        {weakest ? (
          <>
            <div className="mt-1.5 flex items-baseline gap-2.5">
              <span className="text-[28px] font-semibold leading-none text-warning">
                {weakest.accuracy}%
              </span>
              <span className="ds-body font-medium text-foreground">
                {weakest.system}
              </span>
            </div>

            {/* Status colour never travels alone. */}
            <p className="ds-meta mt-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
              Lowest of your systems, over {weakest.answered} questions
            </p>

            <button
              type="button"
              onClick={() => navigate("/qbank")}
              className="mt-auto inline-flex h-10 items-center gap-2 self-start rounded-[var(--r-md)] border border-border px-4 pt-0 text-[14px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
              style={{ marginTop: "auto" }}
            >
              <Target className="h-4 w-4" />
              Practise {weakest.system}
              <ArrowRight className="h-4 w-4 opacity-60" />
            </button>
          </>
        ) : (
          <p className="ds-small mt-2">
            Not enough answered questions in any one system yet to call out a
            weak spot. Finish a couple more blocks and it will appear here.
          </p>
        )}
      </section>
    </div>
  );
};

export default PerformancePanel;
