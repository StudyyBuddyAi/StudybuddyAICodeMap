import { useState, useEffect, useId, useRef } from "react";
import { AlertCircle, ArrowRight, Check, ChevronRight, History, Loader2, Search, Sparkles, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useFlashcardDeck, type GroundingMeta } from "@/hooks/use-flashcard-deck";
import { useUsageLimit, MAX_DAILY_CARDS } from "@/hooks/use-usage-limit";
import { useCitationUsage } from "@/hooks/use-citation-usage";
import { usePremiumHook } from "@/hooks/use-premium-hook";
import { useModelPreference } from "@/hooks/use-model-preference";
import { useAuth } from "@/hooks/use-auth";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parseDecline, topicRejectionMessage, validateTopic, TOPIC_MAX_LENGTH } from "@/lib/validate-topic";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";
import { ModelCredit } from "@/components/PoweredByCorti";
import { parseFlashcardsFromOutput } from "@/lib/parse-flashcards";
import { fetchBestCitation, type CitationResult } from "@/lib/citation";
import { saveCitationsForTopic, getCitationsForTopic } from "@/lib/citation-store";
import CitationBadgeList from "@/components/CitationBadgeList";
import GoProModal from "@/components/GoProModal";
import AuthModal from "@/components/AuthModal";
import { startTopProgress, finishTopProgress } from "@/components/TopProgressBar";
import { useMemoryPreference } from "@/hooks/use-memory-preference";
import { groundingLevelFromCards } from "@/lib/grounding";
import { applySourceLabels } from "@/lib/source-labels";
import GroundingNotice from "@/components/GroundingNotice";
import SheetSources from "@/components/SheetSources";
import type { SheetSource } from "@/types/generated-sheet";

type CitationState = "idle" | "loading" | "found" | "locked" | "hidden";

export type GeneratedCard = ReturnType<typeof parseFlashcardsFromOutput>[number];

interface FlashcardsGeneratorProps {
  /** Notifies the page when generation starts/stops so the right pane can show skeletons. */
  onGeneratingChange?: (generating: boolean, topic: string) => void;
  /** Called with the freshly saved cards once generation completes, and the model that wrote them. */
  onGenerated?: (cards: GeneratedCard[], topic: string, model: ModelUsed | null) => void;
  /** The topic as typed, so the page's step rail can move on from "Pick a topic". */
  onTopicChange?: (topic: string) => void;
}

const RECENT_FLASHCARD_TOPICS_KEY = "sb_recent_flashcard_topics_v1";

// A monogram rather than an icon: the abbreviation is what a student actually
// calls the topic on the wards, and six near-identical line glyphs (two of them
// the same Activity icon) said nothing about which was which.
const POPULAR_TOPICS = [
  { label: "Myocardial Infarction", short: "MI", category: "Cardiology" },
  { label: "Pneumonia", short: "PN", category: "Pulmonology" },
  { label: "Diabetic Ketoacidosis", short: "DKA", category: "Endocrinology" },
  { label: "Ischemic Stroke", short: "CVA", category: "Neurology" },
  { label: "Nephrotic Syndrome", short: "NS", category: "Nephrology" },
  { label: "Sepsis", short: "SEP", category: "Critical Care" },
] as const;

// The edge function clamps a deck to 3-20 cards (medical-notes-prompts.ts), so
// the old 30-card option silently produced 20.
const CARD_COUNTS = [
  { value: "8", label: "8" },
  { value: "12", label: "12" },
  { value: "20", label: "20" },
];

// Labels a student recognises, mapped onto the three levels the prompt's
// "Difficulty:" line already understands.
const DIFFICULTIES = [
  { value: "Basic", label: "Foundational" },
  { value: "Intermediate", label: "Clinical" },
  { value: "Advanced", label: "Board-style" },
];

// Sent as `cardFocus`; the server reads only these keys (CARD_FOCUS).
const FOCUSES = [
  { value: "general", label: "General" },
  { value: "mechanism", label: "Mechanism" },
  { value: "management", label: "Management" },
  { value: "pharm", label: "Pharm" },
];

/** A labelled row of mutually exclusive pills; the pick inverts to ink. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <p id={id} className="text-xs font-semibold text-foreground">
        {label}
      </p>
      <div
        role="group"
        aria-labelledby={id}
        className="inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-border bg-background p-1"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={`h-8 min-w-9 rounded-lg px-3 text-xs font-medium tabular-nums transition-colors ${
                active
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FlashcardsGenerator = ({ onGeneratingChange, onGenerated, onTopicChange }: FlashcardsGeneratorProps) => {
  const [topic, setTopic] = useState("");
  const [cardCount, setCardCount] = useState("12");
  // Board-style is the page's own promise ("a deck of vignette cards"); the
  // old default sent "Basic" on every request whatever the screen said.
  const [difficulty, setDifficulty] = useState("Advanced");
  const [cardFocus, setCardFocus] = useState("general");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  // Why the last topic was turned away — by the structural check, the server's,
  // or the writer declining it — shown under the topic box. Cleared on edit.
  const [topicError, setTopicError] = useState<string | null>(null);
  const [pendingCards, setPendingCards] = useState<ReturnType<typeof parseFlashcardsFromOutput> | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [citationState, setCitationState] = useState<CitationState>("idle");
  const [citations, setCitations] = useState<CitationResult[]>([]);
  // Grounding controls, mirroring the sheet generator's defaults. topK and
  // threshold are not exposed in the UI — the toggle is the only user-facing
  // control; the numbers stay here so they are tunable in one place.
  const [useGrounding, setUseGrounding] = useState(true);
  const [groundingTopK] = useState(8);
  const [groundingThreshold] = useState(0.6);
  const [pendingGrounding, setPendingGrounding] = useState<GroundingMeta | null>(null);
  // Whether grounding was on for the run that produced `pendingGrounding` —
  // separates "we looked and found nothing" from "you turned it off", which
  // GroundingNotice words very differently.
  const [pendingGroundingRequested, setPendingGroundingRequested] = useState(true);
  // The topic this deck was actually retrieved for, held separately because
  // saving the deck clears the topic input — and the source list renders after
  // that, so reading `topic` there would highlight the excerpts against "".
  const [pendingGroundingQuery, setPendingGroundingQuery] = useState("");
  const [goProOpen, setGoProOpen] = useState(false);
  const [recentTopics, setRecentTopics] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_FLASHCARD_TOPICS_KEY) ?? "[]");
      return Array.isArray(stored) ? stored.slice(0, 5) : [];
    } catch {
      return [];
    }
  });

  const activeTopicRef = useRef("");
  // Null until the server's __meta event arrives. Staying null means the edge
  // function ran ungrounded (or predates grounding) — not that it found nothing.
  const groundingResultRef = useRef<{ retrievedChunks: number; sources: SheetSource[] } | null>(null);
  // The save happens inside a long-lived interval closure that would capture a
  // stale `pendingGrounding`. The ref is what that closure actually reads.
  const pendingGroundingRef = useRef<GroundingMeta | null>(null);
  const { toast } = useToast();
  const { saveCards } = useFlashcardDeck();
  const {
    cardsCount,
    isCardsLimited,
    isProUser: pro,
    refresh: refreshUsage,
  } = useUsageLimit();
  const { premiumRemaining, isPremiumHookActive, refetch: refetchPremium } = usePremiumHook();
  // Which model wrote the most recent deck, for the credit under the usage box.
  const [lastDeckModel, setLastDeckModel] = useState<ModelUsed | null>(null);
  // Mirrored in a ref: the save callback below closes over an older render.
  const lastDeckModelRef = useRef<ModelUsed | null>(null);
  const {
    preferredModel,
    setPreferredModel,
    saving: modelSaving,
    isLoading: modelLoading,
  } = useModelPreference();
  const { user, isAnonymous } = useAuth();
  // Same shared window as the sheet generator — see use-memory-preference.
  const { useMemory } = useMemoryPreference();
  const {
    canUseCitation,
    isLoggedIn,
    refreshCitation,
  } = useCitationUsage();
  const remaining = Math.max(0, MAX_DAILY_CARDS - cardsCount);

  const recordRecentTopic = (t: string) => {
    const trimmed = t.trim().slice(0, 60);
    if (!trimmed) return;
    setRecentTopics((prev) => {
      const next = [
        trimmed,
        ...prev.filter((x) => x.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 5);
      try {
        localStorage.setItem(RECENT_FLASHCARD_TOPICS_KEY, JSON.stringify(next));
      } catch {
        // quota exceeded — recents are a convenience only
      }
      return next;
    });
  };

  const setGenerating = (generating: boolean, t: string) => {
    setLoading(generating);
    onGeneratingChange?.(generating, t);
  };

  const handleGenerate = async (overrideTopic?: string, overrideCardCount?: number) => {
    const activeTopic = overrideTopic ?? topic;
    const activeCardCount = overrideCardCount ?? parseInt(cardCount, 10);
    const rejection = validateTopic(activeTopic);
    if (rejection) {
      setTopicError(topicRejectionMessage(rejection));
      return;
    }
    if (isCardsLimited) {
      setGoProOpen(true);
      return;
    }
    setTopicError(null);
    activeTopicRef.current = activeTopic;
    setGenerating(true, activeTopic);
    setCitationState("idle");
    setCitations([]);
    setPendingGrounding(null);
    pendingGroundingRef.current = null;
    setPendingGroundingRequested(useGrounding);
    groundingResultRef.current = null;
    try {
      const response = await callMedicalNotes({
        notes: activeTopic,
        examMode: "General",
        difficulty,
        cardFocus,
        focus: "Quick Revision",
        length: "Concise",
        cardsOnly: true,
        cardCount: activeCardCount,
        useGrounding,
        topK: groundingTopK,
        threshold: groundingThreshold,
        useMemory,
        userId: user?.id ?? null,
        isAnonymous: isAnonymous ?? false,
        isPro: pro,
        preferredModel: pro ? preferredModel : undefined,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 400 && err.code === "invalid_topic") {
          setGenerating(false, "");
          setTopicError(err.error || topicRejectionMessage("keyboard_mash"));
          return;
        }
        if (response.status === 429) {
          throw new Error("You've reached today's free limit. It resets at midnight UTC.");
        }
        throw new Error(err.error || `Error: ${response.status}`);
      }

      lastDeckModelRef.current = parseModelUsed(response.headers);
      setLastDeckModel(lastDeckModelRef.current);

      // Usage was incremented server-side; refresh the displayed counts.
      refreshUsage();
      refetchPremium();

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let textBuffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            // Grounding metadata arrives as one __meta event ahead of any model
            // bytes. Intercept it before the delta read so it never lands in
            // fullText and get parsed as a flashcard.
            if (parsed.__meta) {
              // The book/chapter labels arrive as a second __meta frame at the
              // end of the stream and only refine the sources the first frame
              // delivered, so merge rather than replace.
              if (Array.isArray(parsed.__meta.sourceLabels)) {
                const current = groundingResultRef.current;
                if (current) {
                  groundingResultRef.current = {
                    ...current,
                    sources: applySourceLabels(current.sources, parsed.__meta.sourceLabels),
                  };
                }
              } else {
                groundingResultRef.current = {
                  retrievedChunks:
                    typeof parsed.__meta.retrievedChunks === "number"
                      ? parsed.__meta.retrievedChunks
                      : 0,
                  sources: Array.isArray(parsed.__meta.sources) ? parsed.__meta.sources : [],
                };
              }
              continue;
            }
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) fullText += content;
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Well-formed, but the writer judged it not a medical topic and wrote no
      // cards. The server has refunded the day's deck; show its reason rather
      // than a deck defining the gibberish, and never learn it as a recent.
      const declined = parseDecline(fullText);
      if (declined) {
        setGenerating(false, "");
        setLoadingMsg("");
        setTopicError(declined);
        refreshUsage();
        return;
      }

      recordRecentTopic(activeTopic);
      const parsed = parseFlashcardsFromOutput(fullText, activeTopic);

      // Retrieval is the ceiling; the per-card [Grounded]/[General] tags decide
      // whether that ceiling was actually reached. No __meta at all means the
      // generation ran ungrounded — record that as "none" so the deck is
      // marked honestly rather than left unlabelled.
      const grounding = groundingResultRef.current;
      const groundingMeta: GroundingMeta = grounding
        ? {
            retrievedChunks: grounding.retrievedChunks,
            groundingLevel: groundingLevelFromCards(grounding.retrievedChunks, parsed),
            sources: grounding.sources,
          }
        : { retrievedChunks: 0, groundingLevel: "none", sources: [] };

      setPendingCards(parsed);
      setPendingGrounding(groundingMeta);
      setPendingGroundingQuery(activeTopic);
      pendingGroundingRef.current = groundingMeta;

      // Citation lookup — runs after cards are saved. Serves from the local
      // topic cache when available (no quota consumed); otherwise the edge
      // function consumes one unit server-side and returns whether it was
      // accepted, so the server is the source of truth for the daily limit.
      try {
        const cached = getCitationsForTopic(activeTopic);
        if (cached.length > 0) {
          setCitations(cached);
          setCitationState("found");
        } else if (canUseCitation) {
          setCitationState("loading");
          const result = await fetchBestCitation(activeTopic);
          setCitations(result.citations);
          if (result.quotaExceeded) {
            setCitationState("locked");
          } else {
            setCitationState(result.citations.length > 0 ? "found" : "hidden");
            if (result.citations.length > 0) {
              saveCitationsForTopic(activeTopic, result.citations);
            }
          }
          await refreshCitation();
        } else if (isLoggedIn) {
          setCitationState("locked");
        } else {
          setCitationState("hidden");
        }
      } catch {
        setCitationState("hidden");
      }
    } catch (e: unknown) {
      setGenerating(false, "");
      setLoadingMsg("");
      setPendingCards(null);
      setPendingGrounding(null);
      pendingGroundingRef.current = null;
      toast({
        title: "Error",
        description: e instanceof Error && e.message ? e.message : "Failed to generate flashcards",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (loading) {
      startTopProgress();
      return () => finishTopProgress();
    }
  }, [loading]);

  useEffect(() => {
    if (!loading) return;

    const steps = [
      "Identifying key concepts…",
      "Building Q&A pairs…",
      "Calibrating difficulty…",
      "Adding clinical vignettes…",
      "Finalizing your deck…",
    ];

    let currentStep = 0;
    let allStepsDone = false;
    setLoadingMsg(steps[0]);

    const interval = setInterval(() => {
      currentStep += 1;

      if (currentStep < steps.length) {
        setLoadingMsg(steps[currentStep]);
      } else {
        allStepsDone = true;
        setLoadingMsg(steps[steps.length - 1]);
      }

      if (allStepsDone) {
        setPendingCards((pending) => {
          if (pending !== null) {
            clearInterval(interval);
            (async () => {
              const added = await saveCards(pending, pendingGroundingRef.current ?? undefined);
              localStorage.setItem("sb_first_deck_seen", "1");
              toast({
                title: added > 0 ? `Added ${added} new cards to your deck` : "No new cards (all duplicates)",
              });
              setTopic("");
              setGenerating(false, "");
              setLoadingMsg("");
              window.dispatchEvent(new CustomEvent("studybuddy:deck-saved"));
              onGenerated?.(pending, activeTopicRef.current, lastDeckModelRef.current);
            })();
            return null;
          }
          return pending;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onTopicChange?.(topic);
  }, [topic]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ topic: string; cardCount?: number }>).detail;
      if (!detail?.topic) return;
      setTopic(detail.topic);
      setCardCount(String(detail.cardCount ?? 5));
      handleGenerate(detail.topic, detail.cardCount ?? 5);
    };
    window.addEventListener("studybuddy:generate-flashcards", handler);
    return () => window.removeEventListener("studybuddy:generate-flashcards", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmedTopic = topic.trim();
  const panel = "rounded-2xl border border-border bg-card p-6 shadow-sm";

  return (
    <div className="animate-fade-in space-y-4">
      {/* ── Medical topic ── */}
      <section aria-labelledby="fc-topic-heading" className={panel}>
        <h2 id="fc-topic-heading" className="font-display text-xl font-medium tracking-[-0.01em] text-foreground">
          Medical topic
        </h2>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="text"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (topicError) setTopicError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading && trimmedTopic) handleGenerate();
            }}
            aria-labelledby="fc-topic-heading"
            aria-invalid={topicError ? true : undefined}
            aria-describedby={topicError ? "fc-topic-error" : undefined}
            maxLength={TOPIC_MAX_LENGTH}
            placeholder="Heart failure, pneumonia, DKA…"
            className={`h-12 w-full rounded-xl border ${topicError ? "border-danger" : "border-border"} bg-secondary/40 pe-10 ps-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:bg-card focus:outline-none focus:ring-2 focus:ring-ring/30`}
          />
          {topic && (
            <button
              type="button"
              onClick={() => {
                setTopic("");
                setTopicError(null);
              }}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear topic"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {topicError && (
          <p id="fc-topic-error" role="alert" className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-danger">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {topicError}
          </p>
        )}

        <p className="mb-2 mt-5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Popular topics
        </p>
        <ul className="-mx-2 space-y-0.5">
          {POPULAR_TOPICS.map(({ label, short, category }, i) => {
            const picked = trimmedTopic.toLowerCase() === label.toLowerCase();
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => {
                    setTopic(label);
                    setTopicError(null);
                  }}
                  aria-pressed={picked}
                  className={`group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start transition-colors ${
                    picked ? "bg-ring/10" : "hover:bg-secondary/60"
                  }`}
                >
                  {/* Alternating tint keeps a column of round chips from reading
                      as one grey stripe. */}
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold tracking-tight transition-colors ${
                      picked
                        ? "bg-[color:var(--color-accent-ink)] text-[color:var(--color-accent-foreground)]"
                        : i % 2 === 0
                        ? "bg-ring/10 text-[color:var(--color-accent-ink)]"
                        : "bg-secondary text-muted-foreground"
                    }`}
                    aria-hidden
                  >
                    {picked ? <Check className="h-4 w-4" /> : short}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{label}</span>
                    <span className="block text-[11px] text-muted-foreground">{category}</span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>

        {recentTopics.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <History className="h-3 w-3" aria-hidden />
              Recent · one tap to regenerate
            </p>
            <div className="flex flex-wrap gap-1.5">
              {recentTopics.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTopic(t);
                    handleGenerate(t);
                  }}
                  className="max-w-full truncate rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-[color:var(--color-accent-ink)] disabled:cursor-default disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Shape the deck ── always open: three short rows are cheaper than
          a disclosure that hides what the button is about to do. */}
      <section aria-labelledby="fc-shape-heading" className={`${panel} space-y-4`}>
        <h2 id="fc-shape-heading" className="font-display text-xl font-medium tracking-[-0.01em] text-foreground">
          Shape the deck
        </h2>
        <Segmented label="Cards" options={CARD_COUNTS} value={cardCount} onChange={setCardCount} />
        <Segmented label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
        <Segmented label="Focus" options={FOCUSES} value={cardFocus} onChange={setCardFocus} />

        <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
          <div className="min-w-0">
            <p id="fc-grounding-label" className="text-xs font-semibold text-foreground">
              Ground in guidelines
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {useGrounding
                ? "Cards are built from the guideline library where it covers the topic."
                : "Off — cards come from general medical knowledge only."}
            </p>
          </div>
          <Switch
            checked={useGrounding}
            onCheckedChange={setUseGrounding}
            aria-labelledby="fc-grounding-label"
            className="mt-0.5 shrink-0"
          />
        </div>
      </section>

      {/* ── Generate ── names what it is about to do, so the panels above
          read as a sentence the button finishes. */}
      <button
        type="button"
        onClick={() => handleGenerate()}
        disabled={loading || !trimmedTopic}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-foreground px-5 font-display text-lg text-background shadow-md transition-all motion-safe:hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none motion-safe:disabled:hover:translate-y-0"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            <span className="truncate">{loadingMsg || "Writing your deck…"}</span>
          </>
        ) : trimmedTopic ? (
          <>
            <Sparkles className="h-4 w-4 shrink-0 text-[color:var(--color-accent)]" aria-hidden />
            <span className="truncate">
              Write {cardCount} cards on {trimmedTopic}
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            Pick a topic to generate
          </>
        )}
      </button>

      {/* ── Plan line ── */}
      <div className="space-y-1 text-center text-xs text-muted-foreground">
        {pro ? (
          <p>
            <span className="font-medium text-[color:var(--color-accent-ink)]">
              ✦ Pro · {preferredModel === "corti" ? "Corti S1, best quality" : "GPT-OSS 20B, fastest"}
            </span>
            {" · "}
            <button
              type="button"
              className="underline underline-offset-2 transition-colors hover:text-foreground"
              onClick={() => setPreferredModel(preferredModel === "corti" ? "gpt-oss" : "corti")}
              disabled={modelSaving || modelLoading}
            >
              Switch to {preferredModel === "corti" ? "GPT-OSS 20B" : "Corti S1"}
            </button>
          </p>
        ) : isCardsLimited ? (
          <p className="font-medium text-warning">
            Daily limit reached ·{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => setGoProOpen(true)}
            >
              Upgrade for unlimited
            </button>
          </p>
        ) : (
          <p>
            Free plan · {remaining} {remaining === 1 ? "card" : "cards"} left today ·{" "}
            {isLoggedIn ? (
              <button
                type="button"
                className="text-[color:var(--color-accent-ink)] underline underline-offset-2 transition-colors hover:text-foreground"
                onClick={() => setGoProOpen(true)}
              >
                Go Pro for Corti
              </button>
            ) : (
              <button
                type="button"
                className="text-[color:var(--color-accent-ink)] underline underline-offset-2 transition-colors hover:text-foreground"
                onClick={() => setAuthModalOpen(true)}
              >
                Sign in for citations
              </button>
            )}
          </p>
        )}
        {!pro && isPremiumHookActive && (
          <p className="font-medium text-info">
            ✦ {premiumRemaining} Corti generation{premiumRemaining !== 1 ? "s" : ""} left
          </p>
        )}
        {lastDeckModel && lastDeckModel.kind !== "unknown" && (
          <div className="flex items-center justify-center gap-2">
            <span>Last deck written by</span>
            <ModelCredit used={lastDeckModel} compact />
          </div>
        )}
      </div>

      {citationState !== "idle" && citationState !== "hidden" && (
        <CitationBadgeList
          state={citationState}
          citations={citations}
          onLockedClick={() => (isLoggedIn ? setGoProOpen(true) : setAuthModalOpen(true))}
          isLoggedIn={isLoggedIn}
        />
      )}

      {/* Grounding result for the deck that was just generated */}
      {!loading && pendingGrounding && (
        <div className="space-y-3">
          <GroundingNotice
            level={pendingGrounding.groundingLevel}
            reason={
              pendingGrounding.groundingLevel !== "none"
                ? undefined
                : !pendingGroundingRequested
                ? "disabled"
                : pendingGrounding.retrievedChunks === 0
                ? "no-match"
                : "not-relevant"
            }
          />
          {pendingGrounding.sources.length > 0 && (
            <SheetSources sources={pendingGrounding.sources} query={pendingGroundingQuery} />
          )}
        </div>
      )}
      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </div>
  );
};

export default FlashcardsGenerator;
