import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDailyCredits } from "@/hooks/use-daily-credits";
import { whatsLeftCovers, type CreditDay, type UsageLevel } from "@/lib/daily-credits";
import { cn } from "@/lib/utils";

const FILL: Record<UsageLevel, string> = {
  calm: "bg-primary",
  low: "bg-warning",
  out: "bg-destructive",
};

/** Words for the states the bar's colour marks, so colour never says it alone. */
const LEVEL_WORDS: Record<UsageLevel, string | null> = {
  calm: null,
  low: "Running low",
  out: "Used up for today",
};

function UsageMeter({ percent, level, className }: { percent: number; level: UsageLevel; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Today's usage limit used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-2.5 overflow-hidden rounded-full bg-border", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none", FILL[level])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** The day's usage limit on the dashboard, with the way into the detail. */
export function DashboardUsageStrip() {
  const { credits, resetsIn, isLoading, isError } = useDailyCredits();
  // Nothing to say without a session, and a failed read is no reason to alarm anyone.
  if (isError || (!credits && !isLoading)) return null;
  const percent = credits?.percent ?? 0;
  const level = credits?.level ?? "calm";
  const words = LEVEL_WORDS[level];

  return (
    <section
      aria-labelledby="usage-title"
      className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 sm:flex sm:px-5"
    >
      <h2 id="usage-title" className="shrink-0 text-sm font-semibold text-foreground">
        Today's usage limit
      </h2>
      <Link
        to="?settings=usage"
        className="inline-flex min-h-8 items-center gap-0.5 text-xs font-semibold text-primary underline-offset-4 hover:underline sm:order-last"
      >
        See usage
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      </Link>
      <UsageMeter percent={percent} level={level} className="col-span-2 min-w-0 sm:flex-1" />
      <p className="col-span-2 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground sm:shrink-0">
        {words && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />}
        {credits ? (
          <span>
            {words && <span className="font-semibold text-foreground">{words} · </span>}
            {percent}% used · resets in {resetsIn}
          </span>
        ) : (
          <span>Checking…</span>
        )}
      </p>
    </section>
  );
}

const dayOf = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });

/** One column per day, scaled so a full column is a full day's usage limit. */
function WeekChart({ days }: { days: CreditDay[] }) {
  return (
    <div>
      <ol aria-label="Usage limit used on each of the last 7 days" className="flex h-20 items-end gap-0.5 border-b border-border">
        {days.map((d) => (
          <li key={d.date} className="h-full min-w-0 flex-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  aria-label={`${dayOf(d.date, { weekday: "long" })}: ${d.percent}% used`}
                  className="flex h-full items-end justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div
                    className={cn("w-full max-w-8 rounded-t", d.isToday ? "bg-primary" : "bg-primary/50")}
                    style={{ height: `${d.percent > 0 ? Math.max(d.percent, 4) : 0}%` }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {dayOf(d.date, { weekday: "short", month: "short", day: "numeric" })} · {d.percent}% used
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ol>
      <div aria-hidden className="mt-1 flex gap-0.5">
        {days.map((d) => (
          <span
            key={d.date}
            className={cn("flex-1 text-center text-[11px]", d.isToday ? "font-semibold text-foreground" : "text-muted-foreground")}
          >
            {dayOf(d.date, { weekday: "narrow" })}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The Usage tab of Settings. */
export function UsagePanel({ enabled, labelClassName }: { enabled: boolean; labelClassName: string }) {
  const { credits, resetsIn, isLoading, isError, refetch } = useDailyCredits(enabled);

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 pt-3 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your usage…
      </p>
    );
  }
  if (isError) {
    return (
      <div className="space-y-3 pt-3">
        <p className="text-sm text-foreground">Your usage couldn't be loaded. Check your connection and try again.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!credits) return <p className="pt-3 text-sm text-muted-foreground">Sign in to see your usage.</p>;

  const words = LEVEL_WORDS[credits.level];
  const covers = whatsLeftCovers(credits.remaining);
  const anyHistory = credits.days.some((d) => d.percent > 0);

  return (
    <div className="space-y-5 pt-3">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">{credits.percent}% used</p>
          <p className="text-xs tabular-nums text-muted-foreground">Resets in {resetsIn}</p>
        </div>
        <UsageMeter percent={credits.percent} level={credits.level} />
        {words && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {words}
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Every account has the same daily usage limit. It covers about 5 comprehensive sheets with their deep dives, a
          50-card deck and 40 QBank questions. Spend it on whatever you like.
        </p>
      </div>

      <div className="space-y-2 border-t border-border/50 pt-4">
        <p className={labelClassName}>What's left today</p>
        {credits.remaining > 0 ? (
          <>
            <ul className="divide-y divide-border/50">
              {covers.map((c) => (
                <li key={c.label} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                  <span className="text-foreground">{c.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{c.count}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Each number is on its own, and they're typical amounts.</p>
          </>
        ) : (
          <p className="text-sm text-foreground">Nothing for now. It comes back in {resetsIn}.</p>
        )}
      </div>

      <div className="space-y-2 border-t border-border/50 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className={labelClassName}>Last 7 days</p>
          {anyHistory && <p className="text-xs text-muted-foreground">A full column is a full day</p>}
        </div>
        {anyHistory ? <WeekChart days={credits.days} /> : <p className="text-sm text-muted-foreground">Nothing used yet.</p>}
      </div>
    </div>
  );
}
