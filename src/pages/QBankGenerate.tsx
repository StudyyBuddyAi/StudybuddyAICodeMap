import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  Check,
  Compass,
  PenLine,
  PlayCircle,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { useQBankContext } from "@/contexts/QBankContext";
import { useToast } from "@/hooks/use-toast";
import { MIN_SET_SIZE, MAX_SET_SIZE, SET_SIZE_STEP } from "@/lib/qbank-wave-runner";

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

const SET_SIZES = Array.from(
  { length: Math.floor((MAX_SET_SIZE - MIN_SET_SIZE) / SET_SIZE_STEP) + 1 },
  (_, i) => MIN_SET_SIZE + i * SET_SIZE_STEP
);

type StepState = "pending" | "active" | "done";

/**
 * On-demand question generation.
 *
 * A student names a topic and a size, and the set is written for it. This page's
 * job is now only to get them into the session — it waits for the FIRST question
 * and then hands over to the player, where the rest of the set arrives while they
 * work. That is about twenty seconds rather than the ninety a whole set takes,
 * and for a set of twenty it is the difference between a usable feature and a
 * six-minute stare.
 *
 * The generation itself does not live here. It runs in QBankProvider, which wraps
 * every /qbank route, so navigating to the session does not cancel it — this page
 * unmounting used to abort the request, and a page that hands over mid-generation
 * cannot do that. See src/lib/qbank-wave-runner.ts for the loop.
 *
 * What it deliberately does not report is the questions themselves. Showing a
 * vignette, its options and the key before the student sits the set would hand
 * them the answers. So this surfaces only its own progress: which system the
 * topic routed to, and how far along the first question is.
 */
const QBankGenerate = () => {
  const navigate = useNavigate();
  const { user, isAnonymous } = useAuth();
  const { startGeneratedSession, generation, session } = useQBankContext();
  const { toast } = useToast();

  const [topic, setTopic] = useState("");
  const [setSize, setSetSize] = useState(MIN_SET_SIZE);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Elapsed counter, so the wait never looks stalled.
  useEffect(() => {
    if (!isStarting) return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000
    );
    return () => window.clearInterval(id);
  }, [isStarting]);

  // A set that is still being written while the student is back on this page —
  // they navigated away rather than finishing. Offer the way back rather than
  // silently starting a second set on top of the first.
  const runInProgress = !!session && generation?.status === "running";

  const generate = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed || isStarting) return;

    setIsStarting(true);
    setError(null);

    try {
      // Resolves the moment the first question exists and the session is live.
      // The remaining waves keep running against the provider.
      await startGeneratedSession(trimmed, setSize);
      navigate("/qbank/session");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
      toast({
        title: "Could not generate questions",
        description: message,
        variant: "destructive",
      });
      setIsStarting(false);
    }
  }, [topic, setSize, isStarting, startGeneratedSession, navigate, toast]);

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

  const routed = !!generation?.systemName;

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
        <p
          className="mt-2.5 max-w-xl text-base leading-relaxed"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          Name a topic and a set is written for it, to the same NBME item-writing rules
          the curated bank follows. You start on the first question as soon as it is
          ready — the rest is written while you work.
        </p>

        {runInProgress && (
          <button
            type="button"
            onClick={() => navigate("/qbank/session")}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)" }}
          >
            <PlayCircle size={15} />
            A set is still being written — go back to it
          </button>
        )}

        {/* ── Topic ───────────────────────────────────────────────────── */}
        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") generate();
            }}
            disabled={isStarting}
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
            disabled={isStarting || !topic.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-foreground)" }}
          >
            {isStarting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {isStarting ? "Writing…" : "Generate"}
          </button>
        </div>

        {/* ── How many ────────────────────────────────────────────────── */}
        <div className="mt-5">
          <p style={MONO_EYEBROW}>Questions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SET_SIZES.map((size) => {
              const active = size === setSize;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSetSize(size)}
                  disabled={isStarting}
                  aria-pressed={active}
                  className="rounded-lg border px-3.5 py-1.5 text-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    fontFamily: "var(--font-mono)",
                    borderColor: active ? "var(--color-accent)" : "var(--color-border)",
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--color-accent)" : "var(--fg-muted)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {size}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--fg-muted)" }}>
            A question takes about twenty seconds to write, so a set of {setSize} finishes
            in roughly {Math.max(1, Math.round((setSize * 18) / 60))} minute
            {Math.max(1, Math.round((setSize * 18) / 60)) === 1 ? "" : "s"} — but you will be
            answering it long before then.
          </p>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3.5 py-3 text-sm text-danger">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Console ─────────────────────────────────────────────────── */}
        {/* Rendered whenever a run is under way, error or not. It used to be
            hidden the moment anything went wrong, which took the progress and
            the way forward down with it. */}
        {isStarting && (
          <div className="mt-6" style={{ ...PANEL_STYLE, padding: 20 }}>
            <div className="flex items-center justify-between gap-3">
              <p style={MONO_EYEBROW}>Writing</p>
              <span className="tabular-nums" style={{ ...MONO_EYEBROW, letterSpacing: "0.08em" }}>
                {elapsed}s
              </span>
            </div>

            <ol className="mt-4 flex flex-col gap-2.5">
              <Step
                state={routed ? "done" : "active"}
                icon={Compass}
                label="Topic routed"
                detail={generation?.systemName ?? "choosing a system"}
              />
              <Step
                state={routed ? "active" : "pending"}
                icon={PenLine}
                label="First question"
                detail={routed ? "writing" : "waiting on the blueprint"}
              />
            </ol>

            <p className="mt-4 text-xs" style={{ color: "var(--fg-muted)" }}>
              The session opens as soon as the first question is ready. The other{" "}
              {setSize - 1} are written while you answer it, and appear as they land.
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

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
