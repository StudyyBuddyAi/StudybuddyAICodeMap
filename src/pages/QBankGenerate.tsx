import { useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, AlertTriangle, Loader2, ArrowLeft, Play } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { useQBankContext } from "@/contexts/QBankContext";
import { useToast } from "@/hooks/use-toast";
import { callQbankGenerate } from "@/lib/callQbankGenerate";
import { parsePartialQuestions } from "@/lib/parse-partial-questions";
import { checkBatch, type QaResult } from "@/lib/qbank-qa";
import { renderMarkdown } from "@/lib/render-markdown";
import type { GeneratedQuestionDraft, OptionKey } from "@/lib/qbank-types";

const MONO_EYEBROW: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
};

const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d", "e"];
const QUESTION_COUNT = 5;

interface BatchMeta {
  systemName?: string;
  model?: string;
}

/**
 * On-demand question generation.
 *
 * A student names a topic and gets a set written for it. Generation takes
 * around ninety seconds, which is far too long to spend behind a spinner, so
 * the stream is parsed at question grain and each item appears the moment it is
 * whole — the first lands in roughly fifteen seconds and the rest arrive while
 * they read.
 *
 * This is a preview, not the player. The point of showing the items before the
 * session starts is that generated questions are not curated ones: the QA gate
 * runs here, in view, and anything it blocks is excluded from the session
 * rather than quietly dropped. The student sees what was written and why an
 * item was held back before they commit to sitting it.
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
  const abortRef = useRef<AbortController | null>(null);

  const qa = useMemo<QaResult[]>(
    () => (drafts.length ? checkBatch(drafts) : []),
    [drafts]
  );

  /**
   * Ids for the items that passed the gate, positionally matched to the drafts.
   *
   * The edge function inserts in the model's own question order and returns the
   * ids in that order, so index alignment is what connects a rendered draft to
   * its row. A blocked item keeps its id — the row exists — but is never sent
   * to start_qbank_session, so it simply goes unused.
   */
  const playableIds = useMemo(
    () => questionIds.filter((_, i) => !qa[i]?.blocked),
    [questionIds, qa]
  );

  const blockedCount = qa.filter((r) => r.blocked).length;

  const generate = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed || isGenerating) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsGenerating(true);
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

          // Out-of-band frames the model never sends: the resolved system up
          // front, the persisted ids at the end.
          const frameMeta = parsed.__meta as Record<string, unknown> | undefined;
          if (frameMeta) {
            if (typeof frameMeta.systemName === "string") {
              setMeta({
                systemName: frameMeta.systemName as string,
                model: frameMeta.model as string | undefined,
              });
            }
            if (Array.isArray(frameMeta.questionIds)) {
              setQuestionIds(frameMeta.questionIds as string[]);
            }
            if (typeof frameMeta.persistError === "string" && frameMeta.persistError) {
              setError("The questions were written but could not be saved.");
            }
            continue;
          }

          const delta = (parsed as { choices?: { delta?: { content?: unknown } }[] })
            .choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            content += delta;
            // Cheap enough to run per chunk: one linear scan, and a question
            // that has appeared keeps appearing with identical content.
            setDrafts(parsePartialQuestions(content));
          }
        }
      }
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
        // Explicit ids only: the domain filter and the system are what the
        // sampling branch uses, and this batch bypasses sampling entirely.
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

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl px-5 py-8">
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

        {/* ── Topic input ─────────────────────────────────────────────── */}
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
            {isGenerating ? "Writing…" : "Generate"}
          </button>
        </div>

        {/* ── Progress ────────────────────────────────────────────────── */}
        {(isGenerating || drafts.length > 0) && (
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
            {meta.systemName && <span>{meta.systemName}</span>}
            <span>
              {drafts.length} of {QUESTION_COUNT} written
            </span>
            {isGenerating && <span>this takes about a minute</span>}
            {meta.model && <span className="opacity-60">{meta.model}</span>}
          </div>
        )}

        {error && (
          <div
            className="mt-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3.5 py-3 text-sm text-danger"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Preview ─────────────────────────────────────────────────── */}
        <div className="mt-6 flex flex-col gap-4">
          {drafts.map((draft, i) => (
            <QuestionPreview key={`${draft.index}-${i}`} draft={draft} qa={qa[i]} />
          ))}
        </div>

        {/* ── Start ───────────────────────────────────────────────────── */}
        {questionIds.length > 0 && !isGenerating && (
          <div
            className="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3.5 backdrop-blur"
            style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
          >
            <div className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              {playableIds.length} question{playableIds.length === 1 ? "" : "s"} ready
              {blockedCount > 0 && (
                <>
                  {" · "}
                  <span className="text-warning">
                    {blockedCount} held back by the quality gate
                  </span>
                </>
              )}
            </div>
            <button
              onClick={start}
              disabled={playableIds.length === 0 || isStarting}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-foreground)" }}
            >
              {isStarting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              Start session
            </button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

/**
 * One generated item.
 *
 * Shows the stem, the options with the key marked, and the explanation — the
 * same content the player shows after an answer. It deliberately does NOT hide
 * the answer: this is a review surface, not a practice one, and the student
 * reads it to decide whether the set is worth sitting.
 */
const QuestionPreview = ({
  draft,
  qa,
}: {
  draft: GeneratedQuestionDraft;
  qa?: QaResult;
}) => {
  const blocked = qa?.blocked ?? false;
  const warnings = qa?.findings.filter((f) => f.severity === "warn") ?? [];
  const blocks = qa?.findings.filter((f) => f.severity === "block") ?? [];

  return (
    <article
      className={`rounded-xl border p-4 ${blocked ? "border-danger/50 opacity-75" : ""}`}
      style={{
        borderColor: blocked ? undefined : "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ ...MONO_EYEBROW, fontSize: 10 }}>
        <span>Q{draft.index}</span>
        <span>·</span>
        <span>{draft.domain}</span>
        <span>·</span>
        <span>{draft.difficulty}</span>
        <span>·</span>
        <span>{draft.reasoningOrder} order</span>
      </div>

      <p className="mt-2 text-sm font-medium" style={{ color: "var(--color-foreground)" }}>
        {draft.subtopic}
      </p>

      <p className="mt-2.5 text-sm leading-relaxed" style={{ color: "var(--color-muted-foreground)" }}>
        {draft.vignette}
      </p>
      <p className="mt-2 text-sm font-medium" style={{ color: "var(--color-foreground)" }}>
        {draft.leadIn}
      </p>

      <ul className="mt-3 flex flex-col gap-1">
        {OPTION_KEYS.map((letter) => {
          const isKey = letter === draft.correctOption;
          return (
            <li
              key={letter}
              className={`flex gap-2 rounded-md px-2 py-1.5 text-sm ${isKey ? "bg-success/10 font-medium" : ""}`}
              style={{
                color: isKey ? "var(--color-foreground)" : "var(--color-muted-foreground)",
              }}
            >
              <span className="shrink-0 uppercase opacity-60">{letter}.</span>
              <span>{draft.options[letter]}</span>
            </li>
          );
        })}
      </ul>

      {draft.explanation && (
        <p
          className="mt-3 whitespace-pre-line text-xs leading-relaxed [&_strong]:font-bold [&_strong]:text-[var(--color-foreground)]"
          style={{ color: "var(--color-muted-foreground)" }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.explanation) }}
        />
      )}

      {draft.reviewerFlag && draft.reviewerFlag !== "None." && (
        <p className="mt-2.5 text-xs text-warning">
          Model flagged: {draft.reviewerFlag}
        </p>
      )}

      {(blocks.length > 0 || warnings.length > 0) && (
        <ul className="mt-2.5 flex flex-col gap-1 text-xs">
          {blocks.map((f, i) => (
            <li key={`b${i}`} className="text-danger">
              Held back — {f.detail}
            </li>
          ))}
          {warnings.map((f, i) => (
            <li key={`w${i}`} style={{ color: "var(--color-muted-foreground)" }}>
              {f.detail}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};

export default QBankGenerate;
