import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Check, ListChecks, Loader2, Play, RefreshCw, Shuffle, SlidersHorizontal, Sparkles } from "lucide-react";
import ExamSwitch from "@/components/qbank/ExamSwitch";
import TopicComposer from "@/components/qbank/TopicComposer";
import SystemBrowser from "@/components/qbank/SystemBrowser";
import SetSizeStepper from "@/components/qbank/SetSizeStepper";
import { Switch } from "@/components/ui/switch";
import DealingTable, { type DealtCard } from "@/components/flashcards/DealingTable";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useFlashcardDeck, type GroundingMeta } from "@/hooks/use-flashcard-deck";
import { useDailyLimit } from "@/hooks/use-usage-limit";
import { UsageLimitLine } from "@/components/usage/UsageLimitLine";
import { limitReachedText } from "@/lib/daily-credits";
import { useMemoryPreference } from "@/hooks/use-memory-preference";
import { useQBankTarget } from "@/hooks/use-qbank-target";
import { useCurriculumTopics } from "@/hooks/use-curriculum-topics";
import { useLibraryTopics } from "@/hooks/use-library-topics";
import { supabase } from "@/integrations/supabase/client";
import { EXAM_THEME } from "@/lib/qbank-exam-theme";
import { buildDeckSuggestions, type DeckSuggestion, type DeckSuggestionKind } from "@/lib/deck-suggestions";
import { challengesFor } from "@/lib/qbank-challenges";
import { groundingLevelFromCards } from "@/lib/grounding";
import {
  DeckQuotaError,
  DeckTopicError,
  MAX_CARDS_PER_REQUEST,
  deckBatches,
  mergeDecks,
  mergeGrounding,
  requestDeck,
  splitDeck,
  type DeckResult,
  type ParsedCard,
} from "@/lib/deck-request";
import { topicRejectionMessage, validateTopic } from "@/lib/validate-topic";
import type { ModelUsed } from "@/lib/model-used";
import type { TopicOption } from "@/lib/topic-suggest";

export type GeneratedCard = ParsedCard;

const MONO_EYEBROW = "font-mono text-[11px] font-medium tracking-widest uppercase";
const PILL_BASE =
  "inline-flex items-center gap-2 h-8 px-4 rounded-lg text-sm font-medium transition-all duration-200 border disabled:cursor-not-allowed disabled:opacity-50";
const PILL_ON = "bg-primary border-primary text-primary-foreground shadow-md";
const PILL_OFF = "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary";

/** Topics one deck can mix, as the QBank's sets. Each gets a deck of its own. */
const MAX_TOPICS = 5;
/** The server writes at least this many cards a request. */
const MIN_PER_TOPIC = 3;
/** The largest deck: above MAX_CARDS_PER_REQUEST it is written in batches. */
const MAX_DECK_CARDS = 50;
const DEFAULT_SIZE = 12;
const SIZE_PRESETS = [12, 20, 30, 50];
/** The deck of QBank misses, one standing deck that grows as the student misses more. */
const MISSES_DECK = "QBank misses";

const STYLES = [
  { value: "Basic", label: "Recall" },
  { value: "Intermediate", label: "Clinical" },
  { value: "Advanced", label: "Board-style" },
] as const;
const FOCUSES = [
  { value: "general", label: "Balanced" },
  { value: "mechanism", label: "Mechanism" },
  { value: "management", label: "Management" },
  { value: "pharm", label: "Pharm" },
] as const;

/** The notes function's exam modes (medical-notes-prompts.ts MODE RULES). */
const EXAM_MODE = { step1: "USMLE Step 1", step2ck: "USMLE Step 2", mixed: "General" } as const;

const TONE: Record<DeckSuggestionKind, string> = {
  sheet: "bg-info",
  weak: "bg-danger",
  pair: "bg-warning",
  showdown: "bg-primary",
  untouched: "bg-muted-foreground",
};

const splitLabel = (size: number, n: number) =>
  Array.from({ length: n }, (_, i) => Math.ceil((size - i) / n)).join(" · ");

interface DeckSpec {
  topics: string[];
  size: number;
  /** Which card started it, for its spinner. */
  id?: string;
  /** Written from QBank questions the student missed, into one standing deck. */
  missed?: string[];
}

interface Dealing {
  topics: string[];
  total: number;
  status: "writing" | "done";
}

/**
 * The Flashcards page, laid out as the QBank's: a composer that names the
 * exam, takes one topic or mixes up to five, and folds the deck's shape into
 * one line with a Change link; "For you" decks made from the student's own
 * sheets and QBank misses; three quick starts. A mixed deck writes one deck
 * per topic, so each topic keeps its own schedule and Library entry.
 *
 * What it does instead of the QBank's waiting screen is deal the deck: cards
 * land on the table as the writer finishes them (DealingTable), and the review
 * opens on the full deck.
 */
const DeckComposer = ({
  onGenerated,
  onDealingChange,
}: {
  /** The saved deck, to study now: its cards, a label, the model that wrote it, and its topics. */
  onGenerated: (cards: GeneratedCard[], label: string, model: ModelUsed | null, topics: string[]) => void;
  /** The deal took the page over, or gave it back. */
  onDealingChange?: (dealing: boolean) => void;
}) => {
  const { toast } = useToast();
  const { user, isAnonymous } = useAuth();
  const signedIn = !!user && !isAnonymous;
  const { saveCards } = useFlashcardDeck();
  const { reached: limitReached, resetsIn, refresh: refreshUsage } = useDailyLimit();
  const { useMemory } = useMemoryPreference();

  // The exam is the QBank's own remembered setting: a student prepares for one.
  const [target, setTarget] = useQBankTarget();
  const theme = EXAM_THEME[target];

  const { curriculum, options: curriculumOptions } = useCurriculumTopics();
  const { topics: libraryTopics } = useLibraryTopics();
  const [seed, setSeed] = useState(0);
  const suggestions = useMemo(
    () => buildDeckSuggestions({ topics: libraryTopics, target, curriculum, seed }),
    [libraryTopics, target, curriculum, seed]
  );
  const composerOptions: TopicOption[] = useMemo(
    () => [
      ...libraryTopics.map((t) => ({ title: t.title, systemName: null, systemKey: null, source: "library" as const })),
      ...curriculumOptions,
    ],
    [libraryTopics, curriculumOptions]
  );

  // The questions the student got wrong most recently, for "Missed in QBank".
  const { data: missedIds = [] } = useQuery({
    queryKey: ["fc-qbank-missed", user?.id ?? null],
    enabled: signedIn,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("user_attempts")
        .select("question_id")
        .eq("user_id", user!.id)
        .eq("is_correct", false)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.question_id))].slice(0, MAX_CARDS_PER_REQUEST / 2);
    },
  });

  const [topics, setTopics] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [style, setStyle] = useState<(typeof STYLES)[number]["value"]>("Advanced");
  const [focus, setFocus] = useState<(typeof FOCUSES)[number]["value"]>("general");
  const [grounded, setGrounded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [dealing, setDealing] = useState<Dealing | null>(null);
  const [dealt, setDealt] = useState<DealtCard[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const pendingTopics = useMemo(() => {
    const typed = draft.trim();
    if (!typed || topics.some((t) => t.toLowerCase() === typed.toLowerCase())) return topics;
    return [...topics, typed].slice(0, MAX_TOPICS);
  }, [topics, draft]);
  const mixing = pendingTopics.length >= 2;
  const maxSize = MAX_DECK_CARDS;
  const minSize = Math.max(MIN_PER_TOPIC, MIN_PER_TOPIC * pendingTopics.length);
  // Keep the size inside what the mix allows as topics come and go.
  useEffect(() => {
    if (size < minSize) setSize(minSize);
    if (size > maxSize) setSize(maxSize);
  }, [minSize, maxSize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onDealingChange?.(!!dealing), [dealing, onDealingChange]);

  /** Every way into a deck ends here: the composer, a card, a quick start. */
  const deal = useCallback(
    async (spec: DeckSpec) => {
      if (dealing || spec.topics.length === 0) return;
      for (const t of spec.topics) {
        const rejection = validateTopic(t);
        if (rejection) {
          setError(topicRejectionMessage(rejection));
          return;
        }
      }
      if (limitReached) {
        setError(limitReachedText(resetsIn));
        return;
      }
      setError(null);
      setStartingId(spec.id ?? null);

      const plan = spec.missed
        ? [{ topic: spec.topics[0], count: spec.size }]
        : splitDeck(spec.topics, spec.size);
      const jobs = plan.flatMap((p) => deckBatches(p.count).map((b) => ({ ...b, topic: p.topic })));
      const controller = new AbortController();
      abortRef.current = controller;
      setDealt([]);
      setDealing({ topics: spec.topics, total: plan.reduce((n, p) => n + p.count, 0), status: "writing" });

      // Cards land in the order they are finished, across every batch.
      const seen = jobs.map(() => 0);
      let seq = 0;
      const land = (job: number, topic: string, cards: ParsedCard[]) => {
        const fresh = cards.slice(seen[job]).map((c) => ({ ...c, topic, seq: seq++ }));
        seen[job] = cards.length;
        if (fresh.length) setDealt((prev) => [...prev, ...fresh]);
      };

      const settled = await Promise.allSettled(
        jobs.map((job, i) =>
          requestDeck(
            {
              notes: job.topic,
              examMode: EXAM_MODE[target],
              difficulty: style,
              cardFocus: focus,
              cardSlice: job.slice,
              cardCount: job.count,
              useGrounding: spec.missed ? false : grounded,
              // Each request is a turn in the shared memory window; several
              // would write one deck into it several times.
              useMemory: useMemory && jobs.length === 1 && !spec.missed,
              ...(spec.missed ? { deckSource: { kind: "qbank", questionIds: spec.missed } } : {}),
            },
            { signal: controller.signal, onCards: (cards) => land(i, job.topic, cards) }
          )
        )
      );
      refreshUsage();

      if (controller.signal.aborted) {
        setDealing(null);
        setStartingId(null);
        return;
      }

      const results = settled.map((r) => (r.status === "fulfilled" ? r.value : null));
      const fail = settled.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
      const declined = results.find((r) => r?.declined)?.declined;
      const byTopic = new Map<string, DeckResult[]>();
      results.forEach((r, i) => {
        if (!r) return;
        const list = byTopic.get(jobs[i].topic) ?? [];
        list.push(r);
        byTopic.set(jobs[i].topic, list);
      });

      const written: GeneratedCard[] = [];
      try {
        for (const [topic, decks] of byTopic) {
          const cards = mergeDecks(decks.map((d) => d.cards)).map((c) => ({
            ...c,
            topic,
            ...(spec.missed ? { origin: "qbank" as const } : {}),
          }));
          if (!cards.length) continue;
          const grounding = mergeGrounding(decks.map((d) => d.grounding));
          const meta: GroundingMeta = grounding
            ? { ...grounding, groundingLevel: groundingLevelFromCards(grounding.retrievedChunks, cards) }
            : { retrievedChunks: 0, groundingLevel: "none", sources: [] };
          await saveCards(cards, spec.missed ? undefined : meta);
          written.push(...cards);
        }
      } catch {
        toast({ title: "Couldn't save the deck", description: "Please try again.", variant: "destructive" });
        setDealing(null);
        setStartingId(null);
        return;
      }

      if (!written.length) {
        setDealing(null);
        setStartingId(null);
        setError(
          declined ??
            (fail instanceof DeckTopicError
              ? fail.message || topicRejectionMessage("keyboard_mash")
              : fail instanceof DeckQuotaError
              ? fail.message
              : fail instanceof Error && fail.message
              ? fail.message
              : "No cards could be written. Check the spelling, or try a topic like “heart failure”.")
        );
        return;
      }

      try {
        localStorage.setItem("sb_first_deck_seen", "1");
      } catch {
        // Storage unavailable: the first-deck banner shows once more.
      }
      window.dispatchEvent(new CustomEvent("studybuddy:deck-saved"));
      setDealing((d) => (d ? { ...d, total: written.length, status: "done" } : d));
      setTopics([]);
      setDraft("");
      const label = spec.topics.length === 1 ? spec.topics[0] : spec.topics.join(" · ");
      const model = results.find((r) => r?.model)?.model ?? null;
      // A moment on the full table before the review takes the page.
      window.setTimeout(() => {
        setDealing(null);
        setStartingId(null);
        onGenerated(written, label, model, [...byTopic.keys()]);
      }, 900);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dealing, limitReached, resetsIn, target, style, focus, grounded, useMemory, saveCards, onGenerated]
  );

  const stop = () => abortRef.current?.abort();

  // Other pages hand a topic over: a sheet's "make cards" starts the deck,
  // the Library only puts the topic in the box.
  useEffect(() => {
    const onGenerate = (e: Event) => {
      const detail = (e as CustomEvent<{ topic: string; cardCount?: number }>).detail;
      if (!detail?.topic) return;
      void deal({ topics: [detail.topic], size: Math.min(detail.cardCount ?? DEFAULT_SIZE, maxSize) });
    };
    const onPrefill = (e: Event) => {
      const t = (e as CustomEvent<{ topic?: string }>).detail?.topic;
      if (t) setTopics([t.slice(0, 300)]);
    };
    window.addEventListener("studybuddy:generate-flashcards", onGenerate);
    window.addEventListener("studybuddy:prefill-flashcards", onPrefill);
    return () => {
      window.removeEventListener("studybuddy:generate-flashcards", onGenerate);
      window.removeEventListener("studybuddy:prefill-flashcards", onPrefill);
    };
  }, [deal, maxSize]);

  const start = () => {
    const typed = draft.trim();
    if (typed) {
      const rejection = validateTopic(typed);
      if (rejection) {
        setError(topicRejectionMessage(rejection));
        return;
      }
    }
    void deal({ topics: pendingTopics, size: Math.min(Math.max(size, minSize), maxSize) });
  };

  const fit = (n: number) => Math.min(n, maxSize);
  const startSuggestion = (s: DeckSuggestion) => void deal({ topics: s.topics, size: fit(s.size), id: s.id });

  /** Recently studied topics, one deck each; today's pair for someone new. */
  const startDaily = () => {
    const recent = [...libraryTopics]
      .filter((t) => t.sheets.length > 0 || !!t.deck || !!t.qbank)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 3)
      .map((t) => t.title);
    const pair = suggestions.find((s) => s.kind === "pair");
    const topicsForDaily = recent.length ? recent : pair?.topics ?? [];
    if (topicsForDaily.length) void deal({ topics: topicsForDaily, size: fit(12), id: "daily" });
  };

  const startSurprise = () => {
    const pool = challengesFor(target).filter((c) => c.kind === "showdown");
    const c = pool[Math.floor(Math.random() * pool.length)];
    if (c) void deal({ topics: c.topics.map((t) => t.title), size: fit(Math.max(12, c.topics.length * 4)), id: "surprise" });
  };

  const startMisses = () =>
    void deal({
      topics: [MISSES_DECK],
      size: Math.min(MAX_CARDS_PER_REQUEST, Math.max(MIN_PER_TOPIC, missedIds.length * 2)),
      id: "misses",
      missed: missedIds,
    });

  const styleLabel = STYLES.find((s) => s.value === style)!.label;
  const focusLabel = FOCUSES.find((f) => f.value === focus)!.label;
  const busy = !!dealing;

  if (dealing) {
    return (
      <DealingTable
        cards={dealt}
        total={dealing.total}
        topics={dealing.topics}
        theme={theme}
        status={dealing.status}
        onCancel={stop}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Composer — one topic, or several mixed; the deck's shape folds into
          one line until the student wants to change it. */}
      <div
        className={`space-y-4 rounded-[26px] border-2 ${theme.border} bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] transition-colors`}
      >
        <div>
          <p className={`${MONO_EYEBROW} mb-2 text-muted-foreground`}>Studying for</p>
          <ExamSwitch value={target} onChange={setTarget} disabled={busy} />
        </div>

        <div>
          <p className={`${MONO_EYEBROW} mb-2`}>
            <span className="text-muted-foreground">What do you want to remember?</span>{" "}
            <span className={theme.text}>· {theme.label === "Both" ? "Step 1 + Step 2 CK" : theme.label}</span>
          </p>
          <TopicComposer
            topics={topics}
            onChange={(next) => {
              setTopics(next);
              if (error) setError(null);
            }}
            draft={draft}
            onDraftChange={(d) => {
              setDraft(d);
              if (error) setError(null);
            }}
            options={composerOptions}
            max={MAX_TOPICS}
            disabled={busy}
            onSubmit={start}
            onBrowse={() => setBrowseOpen(true)}
            placeholder={theme.placeholder}
          />
          {mixing && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                Mixed: {size} cards across {pendingTopics.length} topics ({splitLabel(size, pendingTopics.length)})
              </span>{" "}
              — one deck per topic, studied together, so look-alikes sit side by side.
            </p>
          )}
        </div>

        {/* Today's usage limit, the same line as under every tool. */}
        <UsageLimitLine />

        {/* The deck in one line, and the button that writes it. */}
        <div className="flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm text-foreground">
            <span className="font-medium tabular-nums">{size} cards</span>
            <span className="text-muted-foreground">
              {" "}· {styleLabel} · {focusLabel}
              {grounded ? " · from the library where it covers the topic" : ""}
            </span>
            <button
              type="button"
              onClick={() => setShowOptions((o) => !o)}
              aria-expanded={showOptions}
              aria-controls="fc-customize"
              className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> {showOptions ? "Done" : "Change"}
            </button>
          </div>
          <button
            type="button"
            onClick={start}
            disabled={busy || pendingTopics.length === 0 || limitReached}
            className={`flex h-12 shrink-0 items-center justify-center gap-2 rounded-[14px] px-6 text-sm font-semibold shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${theme.solid}`}
          >
            <Sparkles className="h-4 w-4" />
            Write {size} {target === "mixed" ? "" : `${theme.label} `}cards
          </button>
        </div>

        {showOptions && (
          <div id="fc-customize" className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className={`${MONO_EYEBROW} mb-2 text-muted-foreground`}>Cards</p>
              <SetSizeStepper
                value={size}
                min={minSize}
                max={maxSize}
                onChange={setSize}
                presets={SIZE_PRESETS}
                unit="card"
                disabled={busy}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Up to 50 — a deck above 20 is written in three batches, side by side.
              </p>
            </div>
            <div>
              <p className={`${MONO_EYEBROW} mb-2 text-muted-foreground`}>Card style</p>
              <div className="flex flex-wrap gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setStyle(s.value)}
                    aria-pressed={style === s.value}
                    className={`${PILL_BASE} ${style === s.value ? PILL_ON : PILL_OFF}`}
                  >
                    {style === s.value && <Check className="h-4 w-4" />}
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {style === "Basic"
                  ? "Short facts and definitions — the fastest reviews."
                  : style === "Intermediate"
                  ? "Findings, workups and treatments, ward-round style."
                  : "Vignette-style cards, worded as the exam asks."}
              </p>
            </div>
            <div>
              <p className={`${MONO_EYEBROW} mb-2 text-muted-foreground`}>Focus</p>
              <div className="flex flex-wrap gap-2">
                {FOCUSES.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFocus(f.value)}
                    aria-pressed={focus === f.value}
                    className={`${PILL_BASE} ${focus === f.value ? PILL_ON : PILL_OFF}`}
                  >
                    {focus === f.value && <Check className="h-4 w-4" />}
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p id="fc-grounding-label" className={`${MONO_EYEBROW} text-muted-foreground`}>
                  Library grounding
                </p>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  {grounded
                    ? "Cards are built from the reference library where it covers the topic."
                    : "Off — cards come from general medical knowledge only."}
                </p>
              </div>
              <Switch
                checked={grounded}
                onCheckedChange={setGrounded}
                aria-labelledby="fc-grounding-label"
                className="mt-0.5 shrink-0"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3.5 py-3 text-sm text-danger" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* For you — personal first, then look-alikes for this exam. */}
      {suggestions.length > 0 && (
        <section aria-labelledby="fc-for-you" className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="fc-for-you" className={`${MONO_EYEBROW} text-muted-foreground`}>
              For you
            </h2>
            <button
              type="button"
              onClick={() => setSeed((s) => s + 1)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Show others
            </button>
          </div>
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => startSuggestion(s)}
                  disabled={busy || limitReached}
                  className="group flex h-full w-full flex-col gap-1.5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${TONE[s.kind]}`} aria-hidden />
                    <span className={`${MONO_EYEBROW} text-[10px] text-muted-foreground`}>{s.eyebrow}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${theme.badge}`}>
                      {theme.label === "Both" ? "Step 1 + 2 CK" : theme.label}
                    </span>
                  </span>
                  <span className="text-[15px] font-semibold leading-snug text-foreground" dir="auto">
                    {s.title}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{s.hook}</span>
                  <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
                    <span>
                      {fit(s.size)} cards{s.topics.length > 1 ? ` · ${s.topics.length} topics` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-foreground opacity-80 group-hover:opacity-100">
                      {startingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Write
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Quick starts — no topic needed. */}
      <section aria-labelledby="fc-quick" className="space-y-2.5">
        <h2 id="fc-quick" className={`${MONO_EYEBROW} text-muted-foreground`}>
          Quick start
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <QuickStart
            icon={ListChecks}
            title={missedIds.length ? `Missed in QBank · ${missedIds.length}` : "Missed in QBank"}
            detail={
              !signedIn
                ? "Sign in and sit a QBank set — the questions you miss become cards."
                : missedIds.length
                ? "Cards from the explanations of the questions you got wrong"
                : "Nothing missed yet — the questions you get wrong will land here"
            }
            busy={startingId === "misses"}
            disabled={busy || !missedIds.length || limitReached}
            onClick={startMisses}
          />
          <QuickStart
            icon={CalendarDays}
            title="Daily 12"
            detail="A deck across what you studied most recently"
            busy={startingId === "daily"}
            disabled={busy || limitReached}
            onClick={startDaily}
          />
          <QuickStart
            icon={Shuffle}
            title="Surprise pair"
            detail={`Two look-alikes for ${target === "mixed" ? "Step 1 and Step 2 CK" : theme.label}, on one deck`}
            busy={startingId === "surprise"}
            disabled={busy || limitReached}
            onClick={startSurprise}
          />
        </div>
      </section>

      <SystemBrowser
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        curriculum={curriculum}
        slots={Math.max(0, MAX_TOPICS - topics.length)}
        onAdd={(added) => {
          setTopics((prev) => {
            const next = [...prev];
            for (const a of added) if (!next.some((t) => t.toLowerCase() === a.toLowerCase())) next.push(a);
            return next.slice(0, MAX_TOPICS);
          });
          if (error) setError(null);
        }}
      />
    </div>
  );
};

const QuickStart = ({
  icon: Icon,
  title,
  detail,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof Play;
  title: string;
  detail: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex items-start gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
  >
    {busy ? (
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
    ) : (
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
    )}
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-foreground">{title}</span>
      <span className="block text-xs leading-relaxed text-muted-foreground">{detail}</span>
    </span>
  </button>
);

export default DeckComposer;
