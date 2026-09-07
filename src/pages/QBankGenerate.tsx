import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  FlaskConical,
  Check,
  ShieldCheck,
  Compass,
  ListChecks,
  PenLine,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { useQBankContext } from "@/contexts/QBankContext";
import { useToast } from "@/hooks/use-toast";
import { callQbankGenerate } from "@/lib/callQbankGenerate";
import { parsePartialQuestions } from "@/lib/parse-partial-questions";
import { checkBatch, type QaResult } from "@/lib/qbank-qa";
import type { GeneratedQuestionDraft } from "@/lib/qbank-types";

const MONO_EYEBROW: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
};

/** Matches QBankSummary's panel, so the two QBank surfaces read as one system. */
const PANEL_STYLE: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-elevated)",
};

const QUESTION_COUNT = 5;

interface PlanEntry {
  index: number;
  reasoningOrder: string;
}

interface BatchMeta {
  systemName?: string;
  model?: string;
  plan?: PlanEntry[];
}

/**
 * Human labels for the QA gate's rule slugs.
 *
 * The findings' own `detail` strings quote the offending text — an option that
 * ran long, a word shared between stem and key. That is the right thing for a
 * reviewer and the wrong thing here, where the whole point is that the student
 * has not sat the questions yet. These say what went wrong without saying what
 * it went wrong *with*.
 */
const RULE_LABELS: Record<string, string> = {
  "key-longest": "Correct answer stood out by length",
  "banned-option-language": "Vague qualifier in an option",
  "all-or-none-option": "All/none-of-the-above option",
  "duplicate-option": "Two options said the same thing",
  "open-lead-in": "Open-ended lead-in",
  "explanation-meta-language": "Explanation exposed the reasoning scaffold",
  "stem-key-cueing": "Stem wording hinted at the answer",
  "question-in-vignette": "Vignette repeated the question",
  "lead-in-not-question": "Lead-in was not a question",
  "duplicate-question": "Overlaps another question in the set",
  "over-bolding": "Too much emphasis in the explanation",
  "no-bolding": "No key phrase emphasised",
  "bolded-distractor": "Emphasis in a distractor explanation",
  "missing-distractor-explanation": "A distractor went unexplained",
  "distractor-explains-key": "The key was labelled as wrong",
  "self-check-failed": "The writer flagged its own item",
  "answer-position-drift": "Answer landed on a different letter",
};

const ruleLabel = (rule: string) => RULE_LABELS[rule] ?? "Quality check failed";

type StepState = "pending" | "active" | "done";

/**
 * On-demand question generation.
 *
 * A student names a topic and a set is written for it. That takes about ninety
 * seconds, so the stream is parsed at question grain and the console below
 * reports each item the moment it is whole.
 *
 * What it deliberately does not report is the items themselves. Showing a
 * vignette, its options, the key and the explanation before the student sits
 * the set would hand them the answers — the questions are the thing they came
 * for, and reading them first destroys it. So generation surfaces only its own
 * progress and the blueprint being filled: which system, how many written, the
 * difficulty and reasoning-order mix, and what the quality gate rejected. The
 * questions appear in the player, and the answers after they are graded.
 */
const QBankGenerate = () => {
  const navigate = useNavigate();
  const { user, isAnonymous } = useAuth();
  const { startSession } = useQBankContext();
  const { toast } = useToast();

  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [drafts, setDrafts] = useState<GeneratedQuestionDraft[]>([]);
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [meta, setMeta] = useState<BatchMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Elapsed counter, so a long generation never looks stalled.
  useEffect(() => {
    if (!isGenerating) return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [isGenerating]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const qa = useMemo<QaResult[]>(
    () => (finished && drafts.length ? checkBatch(drafts) : []),
    [finished, drafts]
  );

  /**
   * Ids for the items that passed the gate, positionally matched to the drafts.
   *
   * The edge function inserts in the model's own question order and returns the
   * ids in that order, so index alignment is what connects a draft to its row.
   * A blocked item keeps its row; it is simply never requested.
   */
  const playableIds = useMemo(
    () => questionIds.filter((_, i) => !qa[i]?.blocked),
    [questionIds, qa]
  );

  const blocked = qa.filter((r) => r.blocked);
  const written = drafts.length;
  const expected = meta.plan?.length ?? QUESTION_COUNT;

  const generate = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed || isGenerating) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsGenerating(true);
    setFinished(false);
    setDrafts([]);
    setQuestionIds([]);
    setMeta({});
    setError(null);

    try {
      const response = await callQbankGenerate(
        { topic: trimmed, count: QUESTION_COUNT },
        { signal: controller.signal }
      );

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Generation failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          // Out-of-band frames the model never sends: the resolved system and
          // batch plan up front, the persisted ids at the end.
          const frame = parsed.__meta as Record<string, unknown> | undefined;
          if (frame) {
            if (typeof frame.systemName === "string") {
              setMeta({
                systemName: frame.systemName as string,
                model: frame.model as string | undefined,
                // The plan also carries each question's assigned answer letter.
                // Only the reasoning order is lifted out — rendering the letters
                // would print the answer key straight onto the page.
                plan: Array.isArray(frame.plan)
                  ? (frame.plan as Record<string, unknown>[]).map((p) => ({
                      index: Number(p.index),
                      reasoningOrder: String(p.reasoningOrder ?? ""),
                    }))
                  : undefined,
              });
            }
            if (Array.isArray(frame.questionIds)) {
              setQuestionIds(frame.questionIds as string[]);
            }
            if (typeof frame.persistError === "string" && frame.persistError) {
              setError("The questions were written but could not be saved.");
            }
            continue;
          }

          const delta = (parsed as { choices?: { delta?: { content?: unknown } }[] })
            .choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            content += delta;
            // One linear scan per chunk, and a question that has appeared keeps
            // appearing with identical content, so this is safe to call often.
            setDrafts(parsePartialQuestions(content));
          }
        }
      }
      setFinished(true);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
      toast({ title: "Could not generate questions", description: message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [topic, isGenerating, toast]);

  const start = useCallback(async () => {
    if (playableIds.length === 0 || isStarting) return;
    setIsStarting(true);
    try {
      await startSession({
        // Explicit ids only: domains and system drive the sampling branch, and
        // this batch bypasses sampling entirely.
        domains: [],
        questionIds: playableIds,
        limit: playableIds.length,
        system: meta.systemName,
      });
      navigate("/qbank/session");
    } catch (err) {
      toast({
        title: "Could not start the session",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setIsStarting(false);
    }
  }, [playableIds, isStarting, startSession, meta.systemName, navigate, toast]);

  if (!user || isAnonymous) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl px-5 py-12">
          <p style={MONO_EYEBROW}>QBank · Generate</p>
          <h1 className="[font-family:var(--app-font-serif)] mt-2 text-[clamp(24px,3vw,32px)] font-medium leading-[1.15]">
            Sign in to generate questions.
          </h1>
          <p className="mt-2.5 text-base" style={{ color: "var(--color-muted-foreground)" }}>
            Generated sets are saved to your account so you can sit them and review them later.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const showConsole = isGenerating || finished || !!error;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl px-5 py-8">
        <button
          onClick={() => navigate("/qbank")}
          className="mb-6 inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <ArrowLeft size={14} /> QBank
        </button>

        <p style={MONO_EYEBROW}>QBank · Generate</p>
        <h1 className="[font-family:var(--app-font-serif)] mt-2 text-[clamp(28px,4vw,38px)] font-medium leading-[1.1] tracking-[-0.012em]">
          Questions on{" "}
          <span className="italic" style={{ color: "var(--color-accent)" }}>
            anything you like.
          </span>
        </h1>
        <p className="mt-2.5 max-w-xl text-base leading-relaxed" style={{ color: "var(--color-muted-foreground)" }}>
          Name a topic and a {QUESTION_COUNT}-question set is written for it, to the same
          NBME item-writing rules the curated bank follows.
        </p>

        {/* ── Topic ───────────────────────────────────────────────────── */}
        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") generate();
            }}
            disabled={isGenerating}
            placeholder="aortic dissection, nephrotic syndrome, the brachial plexus…"
            className="flex-1 rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-60"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-background)",
              color: "var(--color-foreground)",
            }}
          />
          <button
            onClick={generate}
            disabled={isGenerating || !topic.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-foreground)" }}
          >
            {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {isGenerating ? "Writing…" : finished ? "Write another set" : "Generate"}
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3.5 py-3 text-sm text-danger">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Console ─────────────────────────────────────────────────── */}
        {showConsole && !error && (
          <div className="mt-6" style={{ ...PANEL_STYLE, padding: 20 }}>
            <div className="flex items-center justify-between gap-3">
              <p style={MONO_EYEBROW}>{finished ? "Set ready" : "Writing"}</p>
              <span
                className="tabular-nums"
                style={{ ...MONO_EYEBROW, letterSpacing: "0.08em" }}
              >
                {elapsed}s
              </span>
            </div>

            <div
              className="mt-3 h-1 w-full overflow-hidden rounded-full"
              style={{ background: "var(--border)" }}
              aria-hidden
            >
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${Math.round((written / Math.max(1, expected)) * 100)}%`,
                  background: "var(--accent)",
                }}
              />
            </div>

            <ol className="mt-4 flex flex-col gap-2.5">
              <Step
                state="done"
                icon={Compass}
                label="Topic routed"
                detail={meta.systemName ?? "…"}
              />
              <Step
                state={meta.plan ? "done" : "active"}
                icon={ListChecks}
                label="Blueprint set"
                detail={
                  meta.plan
                    ? `${meta.plan.length} questions · ${orderMix(meta.plan)}`
                    : "planning the batch"
                }
              />
              <Step
                state={finished ? "done" : written > 0 ? "active" : "pending"}
                icon={PenLine}
                label="Questions written"
                detail={`${written} of ${expected}`}
              />
              <Step
                state={finished ? "done" : "pending"}
                icon={ShieldCheck}
                label="Quality gate"
                detail={
                  finished
                    ? blocked.length === 0
                      ? "all items passed"
                      : `${blocked.length} held back`
                    : "waiting for the full set"
                }
              />
            </ol>

            {/* Per-question ticks. Metadata only — no stem, no options, no key. */}
            {written > 0 && (
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {Array.from({ length: expected }, (_, i) => {
                  const draft = drafts[i];
                  const isBlocked = qa[i]?.blocked ?? false;
                  return (
                    <li
                      key={i}
                      title={
                        draft
                          ? `${draft.domain} · ${draft.difficulty} · ${draft.reasoningOrder} order`
                          : "not written yet"
                      }
                      className={`rounded-md border px-2 py-1 text-[11px] ${
                        isBlocked ? "border-danger/40 text-danger" : ""
                      }`}
                      style={{
                        fontFamily: "var(--font-mono)",
                        borderColor: isBlocked ? undefined : "var(--border)",
                        color: isBlocked ? undefined : draft ? "var(--fg-muted)" : "var(--fg-subtle)",
                        background: draft && !isBlocked ? "var(--accent-soft)" : "transparent",
                      }}
                    >
                      Q{i + 1}
                      {draft && (
                        <span className="ml-1.5 opacity-70">
                          {draft.difficulty} · {draft.reasoningOrder}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {!finished && (
              <p className="mt-4 text-xs" style={{ color: "var(--fg-muted)" }}>
                Questions stay hidden until the set is finished — reading them now would
                give away the answers.
              </p>
            )}

            {/* ── Held back ─────────────────────────────────────────────── */}
            {finished && blocked.length > 0 && (
              <div className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3">
                <p className="text-xs font-medium text-danger">
                  {blocked.length} question{blocked.length === 1 ? "" : "s"} held back
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {blocked.map((r) => (
                    <li key={r.index} className="text-xs" style={{ color: "var(--fg-muted)" }}>
                      Q{r.index} — {ruleLabel(r.findings.find((f) => f.severity === "block")!.rule)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Start ─────────────────────────────────────────────────── */}
            {finished && questionIds.length > 0 && (
              <button
                type="button"
                onClick={start}
                disabled={playableIds.length === 0 || isStarting}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--color-foreground)] text-sm font-semibold text-[color:var(--color-background)] shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.16)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                {isStarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FlaskConical className="h-4 w-4" />
                )}
                Start Session · {playableIds.length} Question
                {playableIds.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

/** "1 first-order, 3 second, 1 third" — the mix, without the answer letters. */
function orderMix(plan: PlanEntry[]): string {
  const counts = plan.reduce<Record<string, number>>((acc, p) => {
    acc[p.reasoningOrder] = (acc[p.reasoningOrder] ?? 0) + 1;
    return acc;
  }, {});
  return (["1st", "2nd", "3rd"] as const)
    .filter((o) => counts[o])
    .map((o) => `${counts[o]}× ${o}`)
    .join(", ");
}

const Step = ({
  state,
  icon: Icon,
  label,
  detail,
}: {
  state: StepState;
  icon: typeof Compass;
  label: string;
  detail: string;
}) => (
  <li className="flex items-center gap-2.5">
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
      style={{
        background: state === "done" ? "var(--accent)" : "transparent",
        border: state === "done" ? "none" : "1px solid var(--border)",
        color: state === "done" ? "var(--accent-on-inverse, var(--bg))" : "var(--fg-muted)",
      }}
    >
      {state === "done" ? (
        <Check size={12} strokeWidth={3} />
      ) : state === "active" ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <Icon size={11} />
      )}
    </span>
    <span
      className="text-sm"
      style={{ color: state === "pending" ? "var(--fg-subtle)" : "var(--fg)" }}
    >
      {label}
    </span>
    <span className="ml-auto text-xs" style={{ color: "var(--fg-muted)" }}>
      {detail}
    </span>
  </li>
);

export default QBankGenerate;
