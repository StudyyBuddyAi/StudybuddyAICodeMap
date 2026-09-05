import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, Loader2, Layers, PenLine, Search, X, Check, Sparkles, ChevronRight, ArrowRight, Brain, Heart, Activity, Stethoscope } from "lucide-react";
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
import GroundingNotice from "@/components/GroundingNotice";
import SheetSources from "@/components/SheetSources";
import type { GeneratedSheet, SheetSource } from "@/types/generated-sheet";

type CitationState = "idle" | "loading" | "found" | "locked" | "hidden";

export type GeneratedCard = ReturnType<typeof parseFlashcardsFromOutput>[number];

interface FlashcardsGeneratorProps {
  /** Notifies the page when generation starts/stops so the right pane can show skeletons. */
  onGeneratingChange?: (generating: boolean, topic: string) => void;
  /** Called with the freshly saved cards once generation completes. */
  onGenerated?: (cards: GeneratedCard[], topic: string) => void;
}

const RECENT_FLASHCARD_TOPICS_KEY = "sb_recent_flashcard_topics_v1";

const POPULAR_TOPICS = [
  { label: "Myocardial Infarction", icon: "💔", category: "Cardiology" },
  { label: "Pneumonia", icon: "🫁", category: "Pulmonology" },
  { label: "Diabetic Ketoacidosis", icon: "🍬", category: "Endocrinology" },
  { label: "Ischemic Stroke", icon: "🧠", category: "Neurology" },
  { label: "Nephrotic Syndrome", icon: "🫀", category: "Nephrology" },
  { label: "Sepsis", icon: "🚑", category: "Critical Care" },
];

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
              groundingResultRef.current = {
                retrievedChunks:
                  typeof parsed.__meta.retrievedChunks === "number"
                    ? parsed.__meta.retrievedChunks
                    : 0,
                sources: Array.isArray(parsed.__meta.sources) ? parsed.__meta.sources : [],
              };
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
    <Card className="glass-card animate-fade-in rounded-2xl border border-border bg-card shadow-sm">
      <CardContent className="p-6 space-y-6">
        {!isLoggedIn && (
          <CitationCTABanner onSignInClick={() => setAuthModalOpen(true)} />
        )}

        {/* Step 1: Topic Selection */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</div>
            <h2 className="text-sm font-serif font-semibold text-foreground">Medical Topic</h2>
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
                {POPULAR_TOPICS.slice(0, 6).map(({ label, icon, category }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { setTopic(label); setShowTextarea(false); }}
                    className="group flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:border-primary hover:shadow-sm transition-all duration-200"
                  >
                    <span className="text-xl">{icon}</span>
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

        {/* Step 2: Configure */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-info text-primary-foreground text-xs font-bold">2</div>
            <h2 className="text-sm font-serif font-semibold text-foreground">Configure</h2>
          </div>
          
          <div className="space-y-4">
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
                      className={`inline-flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all duration-200 ${
                        active
                          ? "bg-info-soft border-info text-info"
                          : "bg-card border-border text-muted-foreground hover:border-info hover:text-info"
                      }`}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                      {active && <Check className="w-3 h-3 text-info" />}
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
        </div>

        {/* Generate Button */}
        <Button
          className="w-full h-12 text-sm font-semibold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-all duration-200"
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
                sheet={{ sources: pendingGrounding.sources } as GeneratedSheet}
                query={topic}
              />
            )}
          </div>
        )}
      </CardContent>
      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </Card>
  );
};

export default FlashcardsGenerator;
