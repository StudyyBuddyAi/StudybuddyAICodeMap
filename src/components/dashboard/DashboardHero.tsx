import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Play, BookOpen, Repeat } from "lucide-react";

interface DashboardHeroProps {
  dueCount: number;
  onStartReview: () => void;
  onReviewAny: () => void;
}

const formatToday = () =>
  new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

const DashboardHero = ({
  dueCount,
  onStartReview,
  onReviewAny,
}: DashboardHeroProps) => {
  if (dueCount === 0) {
    return (
      <Card className="glass-card animate-fade-in">
        <CardContent className="p-7 space-y-5">
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold tracking-[0.15em] text-primary uppercase">
              Today
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">
              All caught up
            </h2>
            <p className="text-sm text-muted-foreground">
              Generate new material below or review any deck to keep practicing.
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80 font-medium mt-1">
              <span>⚡</span>
              <span>Pro generations are cited from PubMed</span>
            </div>
          </div>
          <Button
            onClick={onReviewAny}
            variant="outline"
            className="h-11 rounded-xl px-5 font-semibold border-primary/30 hover:bg-primary/10"
          >
            <BookOpen className="h-4 w-4 mr-2" />
            Review any deck
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card animate-fade-in border-primary/20">
      <CardContent className="p-7 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold tracking-[0.15em] text-primary uppercase">
            Today, review
          </p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Repeat className="h-3 w-3" />
                  Spaced repetition
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                Cards are scheduled to reappear just before you forget them — an evidence-based technique that maximizes long-term retention.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-end gap-3">
          <span className="text-7xl font-extrabold leading-none text-primary tracking-tight md:text-8xl">
            {dueCount}
          </span>
          <span className="text-lg font-semibold text-muted-foreground pb-2">
            {dueCount === 1 ? "card" : "cards"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onStartReview}
            className="btn-gradient h-12 rounded-xl px-6 font-semibold text-sm"
          >
            <Play className="h-4 w-4 mr-2" />
            Start Reviewing
          </Button>
          <button
            onClick={onReviewAny}
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Or review any deck
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">{formatToday()}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80 font-medium">
          <span>⚡</span>
          <span>Pro generations are cited from PubMed</span>
        </div>
      </CardContent>
    </Card>
  );
};
export default DashboardHero;