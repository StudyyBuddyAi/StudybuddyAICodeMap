import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  ArrowRight,
  Brain,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  HeartPulse,
  History,
  Loader2,
  Search,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useFlashcardDeck, type GroundingMeta } from "@/hooks/use-flashcard-deck";
import { useUsageLimit, MAX_DAILY_CARDS } from "@/hooks/use-usage-limit";
import { useCitationUsage } from "@/hooks/use-citation-usage";
import { usePremiumHook } from "@/hooks/use-premium-hook";
import { useModelPreference } from "@/hooks/use-model-preference";
import { useAuth } from "@/hooks/use-auth";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parseFlashcardsFromOutput } from "@/lib/parse-flashcards";
import { fetchBestCitation, type CitationResult } from "@/lib/citation";
import { saveCitationsForTopic, getCitationsForTopic } from "@/lib/citation-store";
import CitationCTABanner from "@/components/CitationCTABanner";
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
  /** Called with the freshly saved cards once generation completes. */
  onGenerated?: (cards: GeneratedCard[], topic: string) => void;
}

const RECENT_FLASHCARD_TOPICS_KEY = "sb_recent_flashcard_topics_v1";

// Line-icon chips rather than emoji, matching QUICKSTART_TOPICS on the sheet
// configurator — the two panes sit in the same app and were reading as two
// different products.
const POPULAR_TOPICS = [
  { label: "Myocardial Infarction", icon: HeartPulse, category: "Cardiology" },
  { label: "Pneumonia", icon: Activity, category: "Pulmonology" },
  { label: "Diabetic Ketoacidosis", icon: Brain, category: "Endocrinology" },
  { label: "Ischemic Stroke", icon: BrainCircuit, category: "Neurology" },
  { label: "Nephrotic Syndrome", icon: Activity, category: "Nephrology" },
  { label: "Sepsis", icon: Stethoscope, category: "Critical Care" },
] as const;

const CARD_COUNT_OPTIONS = [
  { value: "5", label: "5 cards", description: "Quick review" },
  { value: "10", label: "10 cards", description: "Standard session" },
  { value: "20", label: "20 cards", description: "Deep dive" },
  { value: "30", label: "30 cards", description: "Comprehensive" },
];

const GROUNDING_OPTIONS = [
  { value: true, label: "On", description: "Uses retrieved medical guidelines" },
  { value: false, label: "Off", description: "General knowledge only" },
];

const EXAM_MODES = [
  { value: "General", label: "General", description: "Broad medical knowledge" },
  { value: "USMLE Step 1", label: "Step 1", description: "Basic sciences" },
  { value: "USMLE Step 2", label: "Step 2", description: "Clinical knowledge" },
];

const FlashcardsGenerator = ({ onGeneratingChange, onGenerated }: FlashcardsGeneratorProps) => {
  const [topic, setTopic] = useState("");
  const [cardCount, setCardCount] = useState("12");
  const [examMode, setExamMode] = useState("General");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [pendingCards, setPendingCards] = useState<ReturnType<typeof parseFlashcardsFromOutput> | null>(null);
  const [showTextarea, setShowTextarea] = useState(false);
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
  // Step 2 is a disclosure, closed by default, exactly as "Customize" is on the
  // sheet configurator: the defaults suit most decks, and what a first visit
  // needs to see is the topic box. The header carries the current picks so a
  // closed panel still says what it is about to do.
  const [customizeOpen, setCustomizeOpen] = useState(false);
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
  const { premiumRemaining, isPremiumHookActive } = usePremiumHook();
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
    if (!activeTopic.trim()) {
      toast({ title: "Please enter a topic", variant: "destructive" });
      return;
    }
    if (isCardsLimited) {
      setGoProOpen(true);
      return;
    }
    recordRecentTopic(activeTopic);
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
        examMode,
        difficulty: "Basic",
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
        if (response.status === 429) {
          throw new Error("You've reached today's free limit. It resets at midnight UTC.");
        }
        throw new Error(err.error || `Error: ${response.status}`);
      }

      // Usage was incremented server-side; refresh the displayed count.
      refreshUsage();

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
              setShowTextarea(false);
              setGenerating(false, "");
              setLoadingMsg("");
              window.dispatchEvent(new CustomEvent("studybuddy:deck-saved"));
              onGenerated?.(pending, activeTopicRef.current);
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
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ topic: string; cardCount?: number }>).detail;
      if (!detail?.topic) return;
      setTopic(detail.topic);
      setShowTextarea(true);
      setCardCount(String(detail.cardCount ?? 5));
      handleGenerate(detail.topic, detail.cardCount ?? 5);
    };
    window.addEventListener("studybuddy:generate-flashcards", handler);
    return () => window.removeEventListener("studybuddy:generate-flashcards", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // Numbered panels on a plain column, not one glass card — the same shape
    // the sheet configurator uses, so the two generators read as one system.
    <div className="animate-fade-in space-y-6">
        {!isLoggedIn && (
          <CitationCTABanner onSignInClick={() => setAuthModalOpen(true)} />
        )}

        {/* ── Step 1: Topic Selection ── */}
        <div className="rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-[10px] font-bold text-[color:var(--color-background)]">1</div>
            <h2 className="[font-family:var(--app-font-serif)] text-lg font-medium tracking-[-0.02em] text-[color:var(--color-foreground)]">Medical Topic</h2>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Textarea
                placeholder="Search or type a medical topic (e.g., Heart Failure, Pneumonia, Diabetes...)"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="min-h-[80px] pl-10 pr-10 text-sm leading-relaxed rounded-xl border-border focus:border-primary focus:ring-2 focus:ring-primary"
              />
              {topic && (
                <button
                  type="button"
                  onClick={() => setTopic("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            
            <div className="pt-2">
              <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-3">Popular Topics</p>
              <div className="grid grid-cols-2 gap-2">
                {POPULAR_TOPICS.slice(0, 6).map(({ label, icon: Icon, category }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { setTopic(label); setShowTextarea(false); }}
                    className="group flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:border-primary hover:shadow-sm transition-all duration-200"
                  >
                    {/* Inverted chip, on the sheet configurator's own token pair
                        rather than Tailwind's `foreground`/`primary`: those are
                        near-black ink and a dark teal, which put the glyph at
                        ~2.2:1 and rendered these tiles as blank dark circles.
                        Dark mode inverts the pair, so the icon takes the ink
                        colour there rather than the accent. */}
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] dark:text-[color:var(--color-accent-foreground)]">
                      <Icon className="h-4 w-4" strokeWidth={2.2} />
                    </span>
                    <div className="text-center">
                      <p className="text-xs font-medium text-foreground group-hover:text-primary leading-tight">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{category}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* ── Step 2: Customize ── */}
        <div className="rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
          <button
            type="button"
            onClick={() => setCustomizeOpen((v) => !v)}
            aria-expanded={customizeOpen}
            aria-controls="flashcards-customize"
            className="flex w-full items-center gap-2.5 text-left"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-panel)] text-[10px] font-bold text-[color:var(--color-muted-foreground)]">2</div>
            <h2 className="[font-family:var(--app-font-serif)] text-lg font-medium tracking-[-0.02em] text-[color:var(--color-foreground)]">Customize</h2>
            <span className="ml-auto flex min-w-0 items-center gap-2">
              {/* Current picks, so a closed panel still says what it will do.
                  Deliberately shorter than the sheet's three-part summary: this
                  pane is 320px, and spelling grounding out every time truncated
                  the whole line. Grounding is named only when it is off, which
                  is the setting worth the space. */}
              {!customizeOpen && (
                <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                  {examMode} · {cardCount} cards{useGrounding ? "" : " · Ungrounded"}
                </span>
              )}
              {customizeOpen ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </span>
          </button>

          {customizeOpen && (
          <div id="flashcards-customize" className="animate-fade-in space-y-4">
            {/* Exam Mode */}
            <div className="space-y-2">
              <label className="block font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
                Exam Mode
              </label>
              <div className="flex flex-wrap gap-2">
                {EXAM_MODES.map((opt) => {
                  const active = examMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setExamMode(opt.value)}
                      aria-pressed={active}
                      // Exam Mode used the violet `info` token while the two
                      // groups below it used `primary`, so one panel carried two
                      // unrelated selection colours. Primary is the app's
                      // selected-state colour, and the sheet's PillGroup uses it.
                      className={`inline-flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all duration-200 ${
                        active
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
                      }`}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                      {active && <Check className="w-3 h-3 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Number of Cards */}
            <div className="space-y-2">
              <label className="block font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
                Number of Cards
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CARD_COUNT_OPTIONS.map((opt) => {
                  const active = cardCount === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCardCount(opt.value)}
                      aria-pressed={active}
                      className={`inline-flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all duration-200 ${
                        active
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
                      }`}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                      {active && <Check className="w-3 h-3 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Guideline Grounding */}
            <div className="space-y-2">
              <label className="block font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
                Guideline Grounding
              </label>
              <div className="flex gap-2">
                {GROUNDING_OPTIONS.map(({ value, label, description }) => {
                  const active = useGrounding === value;
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setUseGrounding(value)}
                      aria-pressed={active}
                      className={`flex-1 inline-flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all duration-200 ${
                        active
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
                      }`}
                    >
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-[10px] text-muted-foreground">{description}</span>
                      {active && <Check className="w-3 h-3 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          )}
          </div>
        </div>

        {/* ── Generate CTA — outside the panels, as on the sheet configurator ── */}
        <Button
          className="w-full h-12 text-sm font-semibold rounded-[18px] bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
          onClick={() => handleGenerate()}
          disabled={loading || !topic.trim()}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Flashcards
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>

        {/* Usage Indicator */}
        {!pro && (
          <div className="rounded-lg bg-secondary border border-border p-3 text-center">
            {isCardsLimited ? (
              <span className="text-warning font-medium text-xs block">
                Daily limit reached ·{" "}
                <button
                  type="button"
                  className="underline hover:text-warning transition-colors"
                  onClick={() => setGoProOpen(true)}
                >
                  Upgrade for unlimited
                </button>
              </span>
            ) : (
              <span className="text-muted-foreground text-xs block">
                {remaining} / {MAX_DAILY_CARDS} cards today · Resets at midnight
              </span>
            )}
            {isPremiumHookActive && (
              <span className="text-info font-medium text-xs block mt-1">
                ✦ {premiumRemaining} Claude generation{premiumRemaining !== 1 ? "s" : ""} left
              </span>
            )}
          </div>
        )}
        {pro && (
          <div className="rounded-lg bg-primary/10 border border-primary/30 p-3 text-center">
            <span className="text-primary font-medium text-xs">
              ✦ Pro: {preferredModel === "claude" ? "Claude Haiku 4.5" : "GPT-OSS 20B"}
            </span>
            <span className="mx-2 opacity-40">·</span>
            <button
              type="button"
              className="underline hover:text-foreground transition-colors"
              onClick={() => setPreferredModel(preferredModel === "claude" ? "gpt-oss" : "claude")}
              disabled={modelSaving || modelLoading}
            >
              Switch to {preferredModel === "claude" ? "GPT-OSS 20B" : "Claude Haiku 4.5"}
            </button>
          </div>
        )}

        {/* Recent Topics */}
        {recentTopics.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-border">
            <p className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
              <History className="h-3 w-3" />
              Recent Topics
            </p>
            <div className="flex flex-wrap gap-2">
              {recentTopics.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTopic(t);
                    setShowTextarea(false);
                    handleGenerate(t);
                  }}
                  className="max-w-full truncate inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-muted-foreground text-xs font-medium hover:border-primary hover:text-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  <ChevronRight className="h-3 w-3" />
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {citationState !== "idle" && citationState !== "hidden" && (
          <div className="pt-1">
            <CitationBadgeList
              state={citationState}
              citations={citations}
              onLockedClick={() =>
                isLoggedIn ? setGoProOpen(true) : setAuthModalOpen(true)
              }
              isLoggedIn={isLoggedIn}
            />
          </div>
        )}

        {/* Grounding result for the deck that was just generated */}
        {!loading && pendingGrounding && (
          <div className="space-y-3 pt-1">
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
              <SheetSources
                sources={pendingGrounding.sources}
                query={pendingGroundingQuery}
              />
            )}
          </div>
        )}
      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </div>
  );
};

export default FlashcardsGenerator;
