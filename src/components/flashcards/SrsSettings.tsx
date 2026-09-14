import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { useSrsSettings } from "@/hooks/use-srs-settings";
import { useToast } from "@/hooks/use-toast";
import { MIN_REVIEWS_TO_OPTIMIZE } from "@/lib/fsrs-items";
import { DAY_MS, SrsState, relativeWorkload } from "@/lib/spaced-repetition";

type OptimizeSuccess = { ok: true; adopted: boolean; reviewCount: number; logLoss: { current: number; optimized: number }; weights: number[] };
type OptimizeFailure = { ok: false; reason: string; reviewCount?: number; required?: number };
type OptimizeResponse = OptimizeSuccess | OptimizeFailure;

/**
 * Study settings, after Anki's deck options: desired retention, daily limits,
 * and "Optimize FSRS parameters" with an optional reschedule afterwards.
 */
const SrsSettingsDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { toast } = useToast();
  const { settings, today, isServer, saveSettings, resetWeights, refresh, retentionBounds } = useSrsSettings();
  const { allCards, rescheduleAll } = useFlashcardDeck();

  const [retention, setRetention] = useState(settings.desiredRetention);
  const [newPerDay, setNewPerDay] = useState(String(settings.newPerDay));
  const [maxReviews, setMaxReviews] = useState(String(settings.maxReviewsPerDay));
  const [rescheduleOnSave, setRescheduleOnSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setRetention(settings.desiredRetention);
    setNewPerDay(String(settings.newPerDay));
    setMaxReviews(String(settings.maxReviewsPerDay));
    setRescheduleOnSave(false);
    setOptimizeResult(null);
    // Only when the dialog opens — not on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const workload = relativeWorkload(retention, settings.weights);
  const retentionChanged = Math.abs(retention - settings.desiredRetention) > 1e-6;

  // Reviews already scheduled over the next week, scaled to the chosen
  // retention, plus the new cards that would be introduced.
  const weeklyEstimate = useMemo(() => {
    const horizon = Date.now() + 7 * DAY_MS;
    const scheduled = allCards.filter((c) => c.state !== SrsState.New && c.dueAt <= horizon).length;
    const newCards = allCards.filter((c) => c.state === SrsState.New).length;
    const scale = workload / relativeWorkload(settings.desiredRetention, settings.weights);
    const perDayReviews = Math.round((scheduled * scale) / 7);
    const perDayNew = Math.min(Number(newPerDay) || 0, Math.ceil(newCards / 7));
    return { perDayReviews, perDayNew };
  }, [allCards, workload, settings.desiredRetention, settings.weights, newPerDay]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({
        desiredRetention: retention,
        newPerDay: Number(newPerDay),
        maxReviewsPerDay: Number(maxReviews),
      });
      if (isServer && retentionChanged && rescheduleOnSave) {
        const n = await rescheduleAll({ desiredRetention: retention, weights: settings.weights });
        toast({ title: "Settings saved", description: `Rescheduled ${n} cards to ${Math.round(retention * 100)}% retention.` });
      } else {
        toast({ title: "Settings saved" });
      }
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast({ title: "Couldn't save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    setOptimizeResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("not signed in");
      const res = await fetch("/api/fsrs-optimize", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const body = (await res.json().catch(() => ({ ok: false, reason: `http_${res.status}` }))) as OptimizeResponse;
      setOptimizeResult(body);
      if (body.ok && body.adopted) {
        await refresh();
        toast({ title: "Schedule optimized", description: "New parameters fitted to your review history." });
      }
    } catch (e) {
      console.error(e);
      setOptimizeResult({ ok: false, reason: "network" });
    } finally {
      setOptimizing(false);
    }
  };

  const handleRescheduleNow = async (weights: number[]) => {
    setRescheduling(true);
    try {
      const n = await rescheduleAll({ desiredRetention: settings.desiredRetention, weights });
      toast({ title: `Rescheduled ${n} cards` });
    } catch (e) {
      console.error(e);
      toast({ title: "Couldn't reschedule cards", variant: "destructive" });
    } finally {
      setRescheduling(false);
    }
  };

  const handleReset = async () => {
    try {
      await resetWeights();
      setOptimizeResult(null);
      toast({ title: "Parameters reset to FSRS-6 defaults" });
    } catch {
      toast({ title: "Couldn't reset parameters", variant: "destructive" });
    }
  };

  const totalReviews = today.totalReviews;
  const success = optimizeResult?.ok ? (optimizeResult as OptimizeSuccess) : null;
  const failure = optimizeResult && !optimizeResult.ok ? (optimizeResult as OptimizeFailure) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">Study settings</DialogTitle>
          <DialogDescription>
            Cards are scheduled with FSRS-6, the algorithm Anki uses: each one comes back when your chance of
            recalling it falls to the retention you set.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* ── Desired retention ── */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="srs-retention">Desired retention</Label>
              <span className="text-sm font-semibold tabular-nums text-primary">{Math.round(retention * 100)}%</span>
            </div>
            <Slider
              id="srs-retention"
              min={retentionBounds.min}
              max={retentionBounds.max}
              step={0.01}
              value={[retention]}
              onValueChange={([v]) => setRetention(v)}
            />
            <p className="text-xs text-muted-foreground tabular-nums">
              About {workload.toFixed(1)}× the reviews of 90% · roughly {weeklyEstimate.perDayReviews} reviews +{" "}
              {weeklyEstimate.perDayNew} new {weeklyEstimate.perDayNew === 1 ? "card" : "cards"} a day this week.
            </p>
            {retention > 0.9 && (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Above 90% the workload climbs steeply for little extra memory. Worth it in the last weeks before an
                exam; expensive as a default.
              </p>
            )}
            {isServer && retentionChanged && (
              <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Reschedule existing cards now (otherwise the change applies as you review them)</span>
                <Switch checked={rescheduleOnSave} onCheckedChange={setRescheduleOnSave} />
              </label>
            )}
          </div>

          {/* ── Daily limits ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="srs-new">New cards / day</Label>
              <Input
                id="srs-new"
                type="number"
                min={0}
                max={9999}
                value={newPerDay}
                onChange={(e) => setNewPerDay(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground tabular-nums">{today.newCards} introduced today</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="srs-reviews">Max reviews / day</Label>
              <Input
                id="srs-reviews"
                type="number"
                min={0}
                max={9999}
                value={maxReviews}
                onChange={(e) => setMaxReviews(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground tabular-nums">{today.reviews} done today</p>
            </div>
          </div>
          <p className="-mt-3 text-[11px] text-muted-foreground">
            Every new card adds reviews for weeks. A review cap that is too low lets a backlog build.
          </p>

          {/* ── Optimizer ── */}
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">Personalize to your memory</p>
            </div>
            {!isServer ? (
              <p className="text-xs text-muted-foreground">
                Sign in to keep your review history — optimizing fits the scheduler to it.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {settings.weights
                    ? `Using parameters fitted to ${settings.weightsReviewCount ?? "your"} reviews${
                        settings.weightsUpdatedAt ? ` on ${new Date(settings.weightsUpdatedAt).toLocaleDateString()}` : ""
                      }.`
                    : "Using FSRS-6 default parameters, trained on hundreds of millions of Anki reviews."}{" "}
                  Optimizing needs at least {MIN_REVIEWS_TO_OPTIMIZE} reviews
                  {totalReviews !== null ? ` — you have ${totalReviews}` : ""}. Re-run about once a month.
                </p>

                {failure && (
                  <p className="text-xs text-warning">
                    {failure.reason === "not_enough_reviews"
                      ? `Not enough history yet: ${failure.reviewCount ?? 0} of ${failure.required ?? MIN_REVIEWS_TO_OPTIMIZE} reviews.`
                      : failure.reason === "too_soon"
                        ? "Parameters were optimized in the last 12 hours — try again later."
                        : "The optimizer couldn't run just now. Try again later."}
                  </p>
                )}
                {success && (
                  <div className="space-y-2 text-xs">
                    <p className={success.adopted ? "text-success" : "text-muted-foreground"}>
                      {success.adopted
                        ? `New parameters predict your reviews better (log loss ${success.logLoss.optimized.toFixed(3)} vs ${success.logLoss.current.toFixed(3)}) and are now in use.`
                        : `Your current parameters already fit best (log loss ${success.logLoss.current.toFixed(3)}). Nothing changed.`}
                    </p>
                    {success.adopted && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rescheduling}
                        onClick={() => handleRescheduleNow(success.weights)}
                      >
                        {rescheduling && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Reschedule existing cards
                      </Button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={handleOptimize}
                    disabled={optimizing || (totalReviews !== null && totalReviews < MIN_REVIEWS_TO_OPTIMIZE)}
                  >
                    {optimizing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Optimize my schedule
                  </Button>
                  {settings.weights && (
                    <Button size="sm" variant="ghost" onClick={handleReset}>
                      Reset to defaults
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SrsSettingsDialog;
