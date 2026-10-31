import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Play } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import PageHeader from "@/components/layout/PageHeader";
import { useQBankProgress } from "@/hooks/use-qbank-progress";
import {
  accuracy,
  MIN_TOPIC_ANSWERS,
  WEAK_TOPIC_BELOW,
  weakestTopics,
  type SystemProgress,
  type TopicProgress,
} from "@/lib/qbank-progress";
import { formatRelative } from "@/lib/qbank-format";

const MONO_EYEBROW = "font-mono text-[11px] font-medium tracking-widest uppercase";
const CARD = "rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-[0_18px_40px_rgba(15,23,42,0.04)]";

/** The colour of a score: under half is a gap, the exam's 65–70% is where to be. */
const tone = (pct: number | null) =>
  pct === null ? "bg-border" : pct < 50 ? "bg-danger" : pct < 65 ? "bg-warning" : "bg-success";

/**
 * QBank progress: what the student has covered and how well.
 *
 * Asked for in early-access feedback — "how many questions there are, how
 * many per topic, and how much of it I've done". Sets are written on demand,
 * so there is no fixed total to count down; the page measures progress
 * against the curriculum instead, which is the thing a student is actually
 * trying to cover, and makes the weakest part of it one tap from a set.
 */
const QBankProgress = () => {
  const navigate = useNavigate();
  const { progress, signedIn, isLoading, isError } = useQBankProgress();
  // The QBank page takes a handed-over topic into its composer, as a sheet's does.
  const practise = (topic: string) => navigate("/qbank", { state: { topic } });

  const weakest = progress ? weakestTopics(progress) : [];
  const overall = progress ? accuracy(progress) : null;

  return (
    <DashboardLayout wide>
      <div className="mx-auto w-full max-w-5xl space-y-6 animate-fade-in">
        <Link
          to="/qbank"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> QBank
        </Link>
        <PageHeader
          label="QBank · Progress"
          title="Your progress"
          description="Every set is written for you, so there is no fixed bank to count down. Progress is measured against the USMLE curriculum: each system, its topics, and how you score on them."
        />

        {!signedIn ? (
          <p className={`${CARD} p-6 text-sm text-muted-foreground`}>
            Sign in on the <Link to="/qbank" className="underline hover:text-foreground">QBank</Link> page to practise and
            track your progress.
          </p>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your answers…
          </div>
        ) : isError || !progress ? (
          <p className={`${CARD} p-6 text-sm text-muted-foreground`}>
            Your progress couldn't be loaded. Check your connection and refresh the page.
          </p>
        ) : progress.answered === 0 ? (
          <div className={`${CARD} space-y-3 p-6`}>
            <p className="text-base font-semibold text-foreground">Nothing answered yet</p>
            <p className="text-sm text-muted-foreground">
              Finish a set and this page fills in: questions by system, the curriculum topics you have covered, and the
              ones to work on next.
            </p>
            <Link
              to="/qbank"
              className="inline-flex h-10 items-center rounded-[14px] bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Start a set
            </Link>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat label="Questions answered" value={String(progress.answered)} />
              <Stat label="Correct first time" value={overall === null ? "—" : `${overall}%`} />
              <Stat label="This week" value={String(progress.lastWeek)} />
              <Stat
                label="Curriculum topics covered"
                value={`${progress.curriculumPractised}`}
                suffix={progress.curriculumTotal ? ` / ${progress.curriculumTotal}` : undefined}
              />
            </dl>

            {weakest.length > 0 && (
              <section aria-labelledby="qbp-weak" className={`${CARD} p-5`}>
                <h2 id="qbp-weak" className={`${MONO_EYEBROW} text-muted-foreground`}>
                  Work on next
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Topics under {Math.round(WEAK_TOPIC_BELOW * 100)}% with at least {MIN_TOPIC_ANSWERS} questions, lowest
                  first.
                </p>
                <ul className="mt-3 divide-y divide-[color:var(--color-border)]">
                  {weakest.map((t) => (
                    <TopicRow key={t.title} topic={t} onPractise={practise} />
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="qbp-systems" className={`${CARD} p-5`}>
              <h2 id="qbp-systems" className={`${MONO_EYEBROW} text-muted-foreground`}>
                By system
              </h2>
              <ul className="mt-3 divide-y divide-[color:var(--color-border)]">
                {progress.systems.map((s) => (
                  <SystemRow key={s.key} system={s} onPractise={practise} />
                ))}
              </ul>
            </section>

            {progress.topics.length > 0 && (
              <section aria-labelledby="qbp-topics" className={`${CARD} p-5`}>
                <h2 id="qbp-topics" className={`${MONO_EYEBROW} text-muted-foreground`}>
                  Your topics ({progress.topics.length})
                </h2>
                <ul className="mt-3 divide-y divide-[color:var(--color-border)]">
                  {progress.topics.map((t) => (
                    <TopicRow key={t.title} topic={t} onPractise={practise} showWhen />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

const Stat = ({ label, value, suffix }: { label: string; value: string; suffix?: string }) => (
  <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
      {value}
      {suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
    </dd>
  </div>
);

/** A score as a bar and a number; "—" until there is something to score. */
const Meter = ({ answered, correct }: { answered: number; correct: number }) => {
  const pct = accuracy({ answered, correct });
  return (
    <div className="flex w-36 shrink-0 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border" aria-hidden>
        <div className={`h-full rounded-full ${tone(pct)}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="w-9 text-end text-xs tabular-nums text-muted-foreground">{pct === null ? "—" : `${pct}%`}</span>
    </div>
  );
};

const PractiseButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
  >
    <Play className="h-3 w-3" /> Practise
  </button>
);

const SystemRow = ({ system: s, onPractise }: { system: SystemProgress; onPractise: (topic: string) => void }) => (
  <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
      <p className="text-xs text-muted-foreground">
        {s.answered === 0 ? "Not started" : `${s.answered} question${s.answered === 1 ? "" : "s"}`}
        {s.topicsTotal > 0 && ` · ${s.topicsPractised} of ${s.topicsTotal} topic${s.topicsTotal === 1 ? "" : "s"}`}
      </p>
    </div>
    <Meter answered={s.answered} correct={s.correct} />
    <PractiseButton label={`Practise ${s.name}`} onClick={() => onPractise(s.name)} />
  </li>
);

const TopicRow = ({
  topic: t,
  onPractise,
  showWhen,
}: {
  topic: TopicProgress;
  onPractise: (topic: string) => void;
  showWhen?: boolean;
}) => (
  <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
    <div className="min-w-0 flex-1">
      {/* A topic typed in Arabic reads right to left but lines up with the rest. */}
      <p className="truncate text-left text-sm font-medium text-foreground" dir="auto">
        {t.title}
      </p>
      <p className="text-xs text-muted-foreground">
        {t.answered} question{t.answered === 1 ? "" : "s"}
        {showWhen && t.lastAt > 0 && ` · ${formatRelative(new Date(t.lastAt).toISOString())}`}
      </p>
    </div>
    <Meter answered={t.answered} correct={t.correct} />
    <PractiseButton label={`Practise ${t.title}`} onClick={() => onPractise(t.title)} />
  </li>
);

export default QBankProgress;
