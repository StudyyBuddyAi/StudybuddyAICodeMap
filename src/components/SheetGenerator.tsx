import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Brain, History, Loader2, PenLine, Settings2, Stethoscope, X, Activity, Heart, FileText, Sparkles, ChevronRight, Check, Search, FileDown, Share2, Bookmark, Play, ArrowRight, Zap } from "lucide-react";
import SectionSkeleton from "@/components/SectionSkeleton";
import { useToast } from "@/hooks/use-toast";
import OutputSection, { type CitationState } from "@/components/OutputSection";
import { useUsageLimit, MAX_DAILY_SHEETS } from "@/hooks/use-usage-limit";
import { useCitationUsage } from "@/hooks/use-citation-usage";
import { usePremiumHook } from "@/hooks/use-premium-hook";
import { useModelPreference } from "@/hooks/use-model-preference";
import { useAuth } from "@/hooks/use-auth";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { parseFlashcardsFromOutput } from "@/lib/parse-flashcards";
import { sanitizeJsonOutput } from "@/lib/sanitize-json";
import {
  type GeneratedSheet,
  parseStoredSheet,
  isJsonSheet,
} from "@/types/generated-sheet";
import { fetchBestCitation, type CitationResult } from "@/lib/citation";
import CitationCTABanner from "@/components/CitationCTABanner";
import AuthModal from "@/components/AuthModal";
import GoProModal from "@/components/GoProModal";
import { startTopProgress, finishTopProgress } from "@/components/TopProgressBar";
import { useStudyHistory, type StudyHistoryItem } from "@/hooks/use-study-history";
import { usePersona, type Persona } from "@/hooks/use-persona";
import { timeAgo } from "@/lib/utils";

export interface SheetGeneratorPrefill {
  input: string;
  output: string;
  modeInfo?: StudyHistoryItem["modeInfo"];
}

interface SheetGeneratorProps {
  prefill?: SheetGeneratorPrefill | null;
}

const RECENT_TOPICS_KEY = "sb_recent_topics_v1";

interface PillGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

/** Inline pill toggle group — all options visible, tap to select. */
const PillGroup = ({ label, options, value, onChange }: PillGroupProps) => (
  <div className="mb-4">
    <label className="block font-mono text-[11px] font-medium tracking-widest uppercase text-slate-500 mb-2 dark:text-slate-400">
      {label}
    </label>
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value} 
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
              active
                ? "bg-teal-500 border-teal-500 text-white shadow-md"
                : "bg-white border-slate-200 text-slate-700 hover:border-teal-300 hover:text-teal-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:text-teal-300"
            } border`}
          >
            {active && <Check className="w-4 h-4" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  </div>
);

// ── Right-rail section navigator (lg+ only) ──────────────────────────────────

const SECTION_NAV_ITEMS: { key: string; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "memoryHooks", label: "Memory Hooks" },
  { key: "clinicalApproach", label: "Clinical Approach" },
  { key: "keyPoints", label: "Key Points" },
  { key: "examTraps", label: "Exam Traps" },
  { key: "flashcards", label: "Flashcards" },
  { key: "referenceNote", label: "Reference Note" },
];

/** A section is worth listing only if it actually has content in the sheet. */
function sectionHasContent(sheet: GeneratedSheet, key: string): boolean {
  // const v = (sheet as Record<string, unknown>)[key];
  const v = (sheet as unknown as Record<string, unknown>)[key];
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return false;
}

/**
 * Sticky right-rail navigator. Lists the sheet's non-empty sections, smooth-
 * scrolls to a section on click, and highlights the section the reader is on
 * via an IntersectionObserver watching each `[data-section-key]` card.
 */
const SheetSectionNav = ({ sheet }: { sheet: GeneratedSheet }) => {
  const items = SECTION_NAV_ITEMS.filter((it) => sectionHasContent(sheet, it.key));
  const [activeKey, setActiveKey] = useState<string>(items[0]?.key ?? "");

  useEffect(() => {
    const els = SECTION_NAV_ITEMS.map((it) =>
      document.querySelector<HTMLElement>(`[data-section-key="${it.key}"]`)
    ).filter((el): el is HTMLElement => !!el);
    if (!els.length) return;

    // A thin band near the top of the viewport acts as the "you are here" line;
    // whichever section card crosses it (topmost, if several) becomes active.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        );
        const key = topmost.target.getAttribute("data-section-key");
        if (key) setActiveKey(key);
      },
      { rootMargin: "-12% 0px -78% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sheet]);

  const scrollToSection = (key: string) => {
    document
      .querySelector(`[data-section-key="${key}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!items.length) return null;

  return (
    <div className="pt-1">
      <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-3 pl-3">
        On this sheet
      </p>
      <nav className="flex flex-col">
        {items.map((it) => {
          const active = activeKey === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => scrollToSection(it.key)}
              aria-current={active ? "true" : undefined}
              className={`border-none border-l-2 py-1.5 pl-3 text-left text-sm transition-all duration-200 ${
                active
                  ? "border-l-teal-500 text-teal-700 dark:border-l-teal-400 dark:text-teal-300 font-medium"
                  : "border-l-slate-200 text-slate-600 hover:text-slate-800 dark:border-l-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              {it.label}
            </button>
          );
        })}
      </nav>
      {/* TODO(Phase 1+): "Saved highlights" subsection — list collapsed
          enhancements with their kind icon, click to jump to the gold mark. */}
    </div>
  );
};

// ── Empty state ──────────────────────────────────────────────────────────────

const QUICKSTART_TOPICS = [
  { label: "Heart Failure", icon: "❤️", category: "Cardiology" },
  { label: "Pneumonia", icon: "🫁", category: "Pulmonology" },
  { label: "Diabetic Ketoacidosis", icon: "🍬", category: "Endocrinology" },
  { label: "Ischemic Stroke", icon: "🧠", category: "Neurology" },
  { label: "Nephrotic Syndrome", icon: "🫘", category: "Nephrology" },
  { label: "Myocardial Infarction", icon: "💔", category: "Cardiology" },
];

const QuickstartChips = ({ onStartTopic }: { onStartTopic: (label: string) => void }) => (
  <div className="flex flex-wrap justify-center gap-2">
    {QUICKSTART_TOPICS.map(({ label, icon, category }) => (
      <button
        key={label}
        type="button"
        onClick={() => onStartTopic(label)}
        className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-200 bg-white hover:border-teal-400 hover:shadow-md transition-all duration-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-teal-500"
      >
        <span className="text-2xl">{icon}</span>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-200 dark:group-hover:text-teal-300">{label}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{category}</p>
        </div>
      </button>
    ))}
  </div>
);

interface SheetsEmptyStateProps {
  onStartTopic: (label: string) => void;
  onSelectHistory: (item: StudyHistoryItem) => void;
}

/**
 * First-visit empty state. New users see the topic-picker CTA. Returning users
 * with saved sheets see those sheets up front (continue studying) plus a lighter
 * "start fresh" path, so we surface their library instead of only pushing a new
 * generation.
 */
const SheetsEmptyState = ({ onStartTopic, onSelectHistory }: SheetsEmptyStateProps) => {
  const { history, isLoading } = useStudyHistory();

  // While history loads, show skeleton cards only (no separator/chips) so the
  // layout doesn't jump once we know whether there's any history to show.
  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Continue studying
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[92px] animate-pulse rounded-xl border border-border bg-muted/40"
            />
          ))}
        </div>
      </div>
    );
  }

  // New users (no history): the original topic-picker empty state.
  if (history.length === 0) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center gap-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-8 py-16 text-center shadow-sm dark:from-slate-900 dark:to-slate-800 dark:border-slate-700">
        <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-teal-100 to-teal-200 dark:from-teal-900/30 dark:to-teal-800/30 shadow-lg">
          <Stethoscope className="w-10 h-10 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="space-y-3">
          <h3 className="text-xl font-serif font-semibold text-slate-900 dark:text-slate-100">
            Start Your Study Journey
          </h3>
          <p className="text-base text-slate-600 dark:text-slate-400 max-w-md">
            Choose a medical topic below or type your own to generate a comprehensive study sheet with AI-powered insights.
          </p>
        </div>
        <QuickstartChips onStartTopic={onStartTopic} />
      </div>
    );
  }

  // Returning users: recent sheets first, then a lighter "start fresh" path.
  const recent = history.slice(0, 4);
  return (
    <div className="animate-fade-in space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-serif font-semibold text-slate-900 dark:text-slate-100">Continue Studying</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">{recent.length} recent sheets</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {recent.map((item) => {
            const chips = [item.modeInfo?.examMode, item.modeInfo?.difficulty]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectHistory(item)}
                className="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-teal-400 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-teal-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-200 dark:group-hover:text-teal-300 leading-tight">
                    {item.topic}
                  </p>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-500 flex-shrink-0" />
                </div>
                {chips && (
                  <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                    {chips}
                  </p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-auto pt-1">
                  {timeAgo(item.timestamp)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        <span className="font-mono text-[11px] tracking-widest uppercase text-slate-500 dark:text-slate-500">
          or start fresh
        </span>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <QuickstartChips onStartTopic={onStartTopic} />
    </div>
  );
};

const SheetGenerator = ({ prefill }: SheetGeneratorProps) => {
  const [notes, setNotes] = useState(prefill?.input ?? "");
  const [difficulty, setDifficulty] = useState(prefill?.modeInfo?.difficulty ?? "Basic");
  const [focus, setFocus] = useState(prefill?.modeInfo?.focus ?? "Quick Revision");
  const [length, setLength] = useState(prefill?.modeInfo?.length ?? "Concise");
  const [examMode, setExamMode] = useState(prefill?.modeInfo?.examMode ?? "General");
  const [sheet, setSheet] = useState<GeneratedSheet | null>(
    prefill?.output ? parseStoredSheet(prefill.output) : null
  );
  // Legacy fallback: if the prefill is an old text blob, keep it as a
  // plain string for the OutputSection legacy renderer
  const [legacyOutput, setLegacyOutput] = useState<string>(
    prefill?.output && !isJsonSheet(prefill.output) ? prefill.output : ""
  );
  const [modelUsed, setModelUsed] = useState<"flash" | "gpt-oss" | "claude" | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [deckSaved, setDeckSaved] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [pendingOutput, setPendingOutput] = useState<string | null>(null);
  // A prefilled topic (e.g. a Roadmap chip) must land in a visible textarea —
  // otherwise the picker renders and silently overwrites it on the next click.
  const [showTextarea, setShowTextarea] = useState(!!prefill?.input);
  const [citationState, setCitationState] = useState<CitationState>("idle");
  const [citations, setCitations] = useState<CitationResult[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [goProOpen, setGoProOpen] = useState(false);
  // Tablet (768–1023px) slide-out configurator drawer
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [recentTopics, setRecentTopics] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_TOPICS_KEY) ?? "[]");
      return Array.isArray(stored) ? stored.slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const outputRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const recordRecentTopic = (topic: string) => {
    const trimmed = topic.trim().slice(0, 60);
    if (!trimmed) return;
    setRecentTopics((prev) => {
      const next = [
        trimmed,
        ...prev.filter((t) => t.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 5);
      try {
        localStorage.setItem(RECENT_TOPICS_KEY, JSON.stringify(next));
      } catch {
        // quota exceeded — recents are a convenience only
      }
      return next;
    });
  };

  const { sheetCount, isSheetLimited, isProUser: pro, refresh: refreshUsage } = useUsageLimit();
  const { premiumRemaining, isPremiumHookActive } = usePremiumHook();
  const { preferredModel, setPreferredModel, saving: modelSaving } = useModelPreference();
  const { user, isAnonymous } = useAuth();
  const {
    canUseCitation,
    isLoggedIn,
    incrementCitation,
  } = useCitationUsage();
  const { saveCards } = useFlashcardDeck();
  const { persona, setPersona } = usePersona();

  // `overridePersona` lets a persona button generate with the tier just clicked —
  // `setPersona` state won't have flushed by the time this reads the closure.
  const generate = async (overrideNotes?: string, overridePersona?: Persona) => {
    const activeNotes = overrideNotes ?? notes;
    const activePersona = overridePersona ?? persona;
    if (!activeNotes.trim()) {
      toast({ title: "Please enter medical notes", variant: "destructive" });
      return;
    }
    if (isSheetLimited) {
      setGoProOpen(true);
      return;
    }
    recordRecentTopic(activeNotes);
    setLoading(true);
    setSheet(null);
    setLegacyOutput("");
    setDeckSaved(false);
    setPendingOutput(null);
    setShowTextarea(false);
    setCitationState("idle");
    setCitations([]);

    setTimeout(() => {
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    try {
      const response = await callMedicalNotes({
        notes: activeNotes,
        difficulty,
        focus,
        length,
        examMode,
        persona: activePersona,
        userId: user?.id ?? null,
        isAnonymous: isAnonymous ?? false,
        isPro: pro,
        preferredModel: pro ? preferredModel : undefined,
      });

      const xModel = response.headers.get("X-Model-Used") ?? "";
      const resolvedModel = xModel.includes("gpt-oss")
        ? "gpt-oss"
        : xModel.includes("claude-haiku")
        ? "claude"
        : "flash";
      setModelUsed(resolvedModel);

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
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      const rawText = fullText || "";
      setPendingOutput(rawText);

      // Citation lookup — runs after stream completes
      try {
        if (canUseCitation) {
          setCitationState("loading");
          const results = await fetchBestCitation(activeNotes);
          setCitations(results);
          setCitationState(results.length > 0 ? "found" : "hidden");
          if (results.length > 0) {
            try {
              await incrementCitation();
            } catch {
              // ignore — citation already shown
            }
          }
        } else if (isLoggedIn) {
          setCitationState("locked");
        } else {
          setCitationState("hidden");
        }
      } catch {
        setCitationState("hidden");
      }
    } catch (e: any) {
      setLoading(false);
      setLoadingMsg("");
      setPendingOutput(null);
      toast({
        title: "Error",
        description: e.message || "Failed to generate study material",
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
    function handleEnhancementSaved(e: Event) {
      const { key, result } = (e as CustomEvent).detail ?? {};
      if (!key || !result) return;
      setSheet((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          enhancements: { ...(prev.enhancements ?? {}), [key]: result },
        };
      });
    }
    window.addEventListener("studybuddy:enhancement-saved", handleEnhancementSaved);
    return () =>
      window.removeEventListener("studybuddy:enhancement-saved", handleEnhancementSaved);
  }, []);

  useEffect(() => {
    if (!loading) return;

    const steps = [
      "Reading topic…",
      "Structuring notes…",
      "Finding exam traps…",
      "Adding memory hooks…",
      "Finalizing your sheet…",
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
        setPendingOutput((pending) => {
          if (pending !== null) {
            clearInterval(interval);
            const cleaned = sanitizeJsonOutput(pending);
            try {
              const parsed = JSON.parse(cleaned) as GeneratedSheet;
              setSheet(parsed);
              setLegacyOutput("");
            } catch {
              // JSON parse failed — fall back to legacy text renderer
              setSheet(null);
              setLegacyOutput(pending);
            }
            setLoading(false);
            setLoadingMsg("");
            return null;
          }
          return pending;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persona buttons are the generation trigger — there is no separate submit.
  const generateWithPersona = (p: Persona) => {
    setPersona(p);
    setDeckSaved(false);
    setConfigDrawerOpen(false);
    generate(undefined, p);
  };

  const startTopic = (label: string) => {
    setNotes(label);
    setShowTextarea(false);
    setDeckSaved(false);
    setConfigDrawerOpen(false);
    generate(label);
  };

  // Load a saved sheet straight from history (no regeneration) — mirrors how the
  // `prefill` prop hydrates the generator on mount.
  const loadHistoryItem = (item: StudyHistoryItem) => {
    if (item.modeInfo) {
      setExamMode(item.modeInfo.examMode || "General");
      setDifficulty(item.modeInfo.difficulty || "Basic");
      setFocus(item.modeInfo.focus || "Quick Revision");
      setLength(item.modeInfo.length || "Concise");
    }
    setNotes(item.input);
    setShowTextarea(false);
    setConfigDrawerOpen(false);
    setDeckSaved(false);
    setModelUsed(undefined);
    setCitationState("idle");
    setCitations([]);
    if (isJsonSheet(item.output)) {
      setSheet(parseStoredSheet(item.output));
      setLegacyOutput("");
    } else {
      setSheet(null);
      setLegacyOutput(item.output);
    }
    setTimeout(() => {
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const configurator = (
      <div className="animate-fade-in space-y-6">
        {/* ── Step 1: Topic Selection ── */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-teal-500 text-white text-xs font-bold">1</div>
              <h2 className="text-lg font-serif font-semibold text-slate-900 dark:text-slate-100">Medical Topic</h2>
            </div>
            
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Textarea
                  placeholder="Search or type a medical topic (e.g., Heart Failure, Pneumonia, Diabetes...)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[80px] pl-10 pr-10 text-sm leading-relaxed rounded-xl border-slate-200 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:bg-slate-800 dark:border-slate-700 dark:focus:border-teal-500 dark:focus:ring-teal-900/20"
                />
                {notes && (
                  <button
                    type="button"
                    onClick={() => setNotes("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors dark:text-slate-500 dark:hover:text-slate-300"
                    aria-label="Clear"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              
              <div className="pt-2">
                <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-slate-500 mb-3 dark:text-slate-400">Popular Topics</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {QUICKSTART_TOPICS.slice(0, 6).map(({ label, icon, category }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setNotes(label)}
                      className="group flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-200 bg-white hover:border-teal-400 hover:shadow-sm transition-all duration-200 dark:bg-slate-800 dark:border-slate-700 dark:hover:border-teal-500"
                    >
                      <span className="text-xl">{icon}</span>
                      <div className="text-center">
                        <p className="text-xs font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-200 dark:group-hover:text-teal-300 leading-tight">{label}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{category}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Step 2: Customize ── */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-xs font-bold dark:bg-slate-700 dark:text-slate-300">2</div>
              <h2 className="text-lg font-serif font-semibold text-slate-900 dark:text-slate-100">Customize</h2>
            </div>
            
            <div className="space-y-4">
              <PillGroup
                label="Exam Mode"
                value={examMode}
                onChange={setExamMode}
                options={[
                  { value: "General", label: "General" },
                  { value: "USMLE Step 1", label: "Step 1" },
                  { value: "USMLE Step 2", label: "Step 2" },
                ]}
              />
              <PillGroup
                label="Difficulty"
                value={difficulty}
                onChange={setDifficulty}
                options={[
                  { value: "Basic", label: "Basic" },
                  { value: "Medium", label: "Intermediate" },
                  { value: "Advanced", label: "Advanced" },
                ]}
              />
              <PillGroup
                label="Focus"
                value={focus}
                onChange={setFocus}
                options={[
                  { value: "Quick Revision", label: "Quick Revision" },
                  { value: "Deep Understanding", label: "Deep Understanding" },
                  { value: "Clinical Reasoning", label: "Clinical Reasoning" },
                ]}
              />
              <PillGroup
                label="Length"
                value={length}
                onChange={setLength}
                options={[
                  { value: "Concise", label: "Concise" },
                  { value: "Moderate", label: "Moderate" },
                  { value: "Detailed", label: "Detailed" },
                ]}
              />
            </div>
          </div>
        </div>

        {/* ── Step 3: AI Perspective ── */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-violet-500 text-white text-xs font-bold">3</div>
              <h2 className="text-lg font-serif font-semibold text-slate-900 dark:text-slate-100">AI Perspective</h2>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              {[
                {
                  id: "student" as Persona,
                  label: "Student",
                  sub: "Build intuition and memory hooks for exam prep",
                  Icon: BookOpen,
                  color: "blue",
                },
                {
                  id: "clinician" as Persona,
                  label: "Clinician",
                  sub: "Apply to patient care decisions and clinical practice",
                  Icon: Stethoscope,
                  color: "teal",
                },
                {
                  id: "expert" as Persona,
                  label: "Expert",
                  sub: "Deep mechanisms, nuance, and edge cases",
                  Icon: Brain,
                  color: "violet",
                },
              ].map(({ id, label, sub, Icon, color }) => {
                const active = persona === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => !loading && generateWithPersona(id)}
                    disabled={loading}
                    aria-pressed={active}
                    className={`relative group w-full flex items-start gap-4 p-4 rounded-xl text-left transition-all duration-200 ${
                      active
                        ? "border-2 shadow-md " + (color === "blue" ? "border-blue-500 bg-blue-50" : color === "teal" ? "border-teal-500 bg-teal-50" : "border-violet-500 bg-violet-50")
                        : "border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-600"
                    } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    {active && (
                      <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center ${
                        color === "blue" ? "bg-blue-500" : color === "teal" ? "bg-teal-500" : "bg-violet-500"
                      }`}>
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <span className={`flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 transition-colors ${
                      active
                        ? (color === "blue" ? "bg-blue-500" : color === "teal" ? "bg-teal-500" : "bg-violet-500")
                        : "bg-slate-100 dark:bg-slate-700"
                    }`}>
                      {loading && active ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : (
                        <Icon className={`w-5 h-5 ${
                          active ? "text-white" : "text-slate-500 dark:text-slate-400"
                        }`} />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold leading-tight mb-1 ${
                        active
                          ? (color === "blue" ? "text-blue-700" : color === "teal" ? "text-teal-700" : "text-violet-700")
                          : "text-slate-800 dark:text-slate-200"
                      }`}>
                        {loading && active ? "Generating…" : label}
                      </p>
                      <p className="text-xs text-slate-500 leading-relaxed dark:text-slate-400">
                        {sub}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Generate CTA ── */}
        <Button
          onClick={() => generate()}
          disabled={loading || !notes.trim()}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold text-base shadow-lg hover:shadow-xl hover:from-teal-600 hover:to-teal-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Sparkles className="w-5 h-5" />
          Generate Study Sheet
          <ArrowRight className="w-5 h-5" />
        </Button>

        {pro && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 dark:border-teal-800 dark:bg-teal-950/30">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            <p className="text-sm font-medium text-teal-800 dark:text-teal-300">
              Unlimited access active
            </p>
          </div>
        )}

        {!pro && (
          <div className="text-center text-xs text-slate-500 space-y-1 dark:text-slate-400">
            {isSheetLimited ? (
              <span className="text-amber-600 dark:text-amber-400 font-medium block">
                Daily limit reached ·{" "}
                <button
                  type="button"
                  className="underline hover:text-amber-700 transition-colors dark:hover:text-amber-300"
                  onClick={() => setGoProOpen(true)}
                >
                  Go Pro for Claude + unlimited
                </button>
              </span>
            ) : (
              <span>{sheetCount} / {MAX_DAILY_SHEETS} uses today · Resets at midnight</span>
            )}
            {isPremiumHookActive ? (
              <span className="text-violet-600 dark:text-violet-400 font-medium block">
                ✦ {premiumRemaining} Claude generation{premiumRemaining !== 1 ? "s" : ""} left ·{" "}
                <button
                  type="button"
                  className="underline hover:text-violet-700 transition-colors dark:hover:text-violet-300"
                  onClick={() => setGoProOpen(true)}
                >
                  Go Pro for unlimited Claude
                </button>
              </span>
            ) : !isSheetLimited ? (
              <span className="text-slate-400/60 block dark:text-slate-500/60">
                Powered by GPT-OSS 20B
              </span>
            ) : null}
          </div>
        )}
        {pro && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/50">
            <p className="text-xs font-medium text-slate-600 text-center dark:text-slate-400">
              AI Model
            </p>
            <div className="flex items-center justify-center">
              <div className="inline-flex items-center rounded-lg bg-white p-0.5 shadow-sm dark:bg-slate-700">
                <button
                  type="button"
                  onClick={() => setPreferredModel("gpt-oss")}
                  disabled={modelSaving}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    preferredModel !== "claude"
                      ? "bg-white text-slate-800 shadow-sm dark:bg-slate-600 dark:text-slate-200"
                      : "text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    GPT-OSS 20B
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferredModel("claude")}
                    disabled={modelSaving}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      preferredModel === "claude"
                        ? "bg-white text-slate-800 shadow-sm dark:bg-slate-600 dark:text-slate-200"
                        : "text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    Claude Haiku 4.5
                  </button>
                </div>
              </div>
              {modelSaving && (
                <p className="text-[11px] text-slate-400/50 text-center dark:text-slate-500/50">Saving preference…</p>
              )}
            </div>
          )}

        {recentTopics.length > 0 && (
          <div className="pt-4 border-t border-slate-200 mt-4 dark:border-slate-700">
            <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-widest uppercase text-slate-500 mb-2 pt-2 dark:text-slate-400">
              <History className="w-3 h-3" />
              Recent Topics
            </p>
            <div className="flex flex-wrap gap-2 max-h-16 overflow-y-auto">
              {recentTopics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  disabled={loading}
                  onClick={() => setNotes(topic)}
                  className="truncate max-w-full px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs font-medium hover:border-teal-400 hover:text-teal-700 transition-all duration-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-teal-500 dark:hover:text-teal-300 disabled:opacity-50 disabled:cursor-default"
                >
                  {topic}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
  );

  return (
    <>
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-0 lg:items-start">
      {/* ── Left pane: configurator (35% on desktop, drawer on tablet) ── */}
      <div className="min-w-0 md:max-lg:hidden lg:sticky lg:top-6 lg:self-start lg:w-[35%] lg:min-w-[320px] lg:max-w-[480px] lg:shrink-0 lg:pr-5">
        {configurator}
      </div>

      {/* ── 1px divider between config and document ── */}
      <div
        aria-hidden
        className="hidden lg:block lg:w-px lg:shrink-0 lg:self-stretch bg-slate-200 dark:bg-slate-700"
      />

      {/* ── Middle pane: living document (fluid, fills its lane) ── */}
      <div ref={outputRef} className="min-w-0 lg:flex-1 lg:px-8">
      <div className="w-full space-y-6">
      {loading && !sheet && !legacyOutput && (
        <div className="space-y-6 animate-fade-in">
          {/* AI Generation Progress */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-8 text-center shadow-sm dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-100 to-teal-200 dark:from-teal-900/30 dark:to-teal-800/30 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-teal-500" />
                </div>
                <Loader2 className="absolute -bottom-1 -right-1 w-6 h-6 text-teal-500 animate-spin" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-serif font-semibold text-slate-900 dark:text-slate-100">
                  AI is generating your study sheet
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {loadingMsg}
                </p>
              </div>
              {/* Progress steps */}
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className={`flex items-center gap-1 ${loadingMsg.includes("Understanding") ? "text-teal-600 font-medium" : ""}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${loadingMsg.includes("Understanding") ? "bg-teal-500" : "bg-slate-300"}`} />
                  Understanding
                </span>
                <ChevronRight className="w-3 h-3" />
                <span className={`flex items-center gap-1 ${loadingMsg.includes("Structuring") ? "text-teal-600 font-medium" : ""}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${loadingMsg.includes("Structuring") ? "bg-teal-500" : "bg-slate-300"}`} />
                  Structuring
                </span>
                <ChevronRight className="w-3 h-3" />
                <span className={`flex items-center gap-1 ${loadingMsg.includes("Creating") ? "text-teal-600 font-medium" : ""}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${loadingMsg.includes("Creating") ? "bg-teal-500" : "bg-slate-300"}`} />
                  Creating
                </span>
                <ChevronRight className="w-3 h-3" />
                <span className={`flex items-center gap-1 ${loadingMsg.includes("Finalizing") ? "text-teal-600 font-medium" : ""}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${loadingMsg.includes("Finalizing") ? "bg-teal-500" : "bg-slate-300"}`} />
                  Finalizing
                </span>
              </div>
            </div>
          </div>
          
          {/* Document structure forming — skeletons mirror the incoming sections */}
          <div className="space-y-4">
            <div className="section-reveal" style={{ animationDelay: `0ms` }}>
              <SectionSkeleton variant="sheet-section" />
            </div>
            <div className="section-reveal" style={{ animationDelay: `150ms` }}>
              <SectionSkeleton variant="sheet-section" />
            </div>
            <div className="section-reveal" style={{ animationDelay: `300ms` }}>
              <SectionSkeleton variant="sheet-section" />
            </div>
          </div>
        </div>
      )}

      {!loading && !sheet && !legacyOutput && (
        <SheetsEmptyState onStartTopic={setNotes} onSelectHistory={loadHistoryItem} />
      )}

      {(sheet || legacyOutput) && (
        <OutputSection
          output={sheet ? JSON.stringify(sheet) : legacyOutput}
          inputText={notes}
          modeInfo={{ examMode, difficulty, focus, length }}
          citations={citations}
          citationState={citationState}
          modelUsed={modelUsed}
          isPro={pro}
          userId={user?.id ?? null}
          isAnonymous={isAnonymous ?? false}
          sheetId={notes}
          onCitationLockedClick={() =>
            isLoggedIn ? setGoProOpen(true) : setAuthModalOpen(true)
          }
          citationIsLoggedIn={isLoggedIn}
        />
      )}

      {(sheet || legacyOutput) && (
        <div className="flex flex-wrap justify-center gap-3 pt-4">
          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-slate-200 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50 dark:border-slate-700 dark:hover:border-teal-500 dark:hover:text-teal-300 dark:hover:bg-teal-950/20 flex items-center gap-2"
            disabled={deckSaved}
            onClick={() => {
              try {
                if (sheet?.flashcards?.length) {
                  const parsed = sheet.flashcards.map((c) => ({
                    question: c.question,
                    answer: c.answer,
                    tag: c.tag,
                    topic: notes.trim().slice(0, 60),
                    topicEmoji: sheet.topicEmoji,
                  }));
                  saveCards(parsed);
                  setDeckSaved(true);
                  toast({ title: `${parsed.length} cards saved to your library` });
                } else if (legacyOutput) {
                  const parsed = parseFlashcardsFromOutput(legacyOutput, notes);
                  if (parsed.length) {
                    saveCards(parsed);
                    setDeckSaved(true);
                    toast({ title: `${parsed.length} cards saved to your library` });
                  } else {
                    toast({ title: "No flashcards found in this sheet", variant: "destructive" });
                  }
                } else {
                  toast({ title: "No flashcards found in this sheet", variant: "destructive" });
                }
              } catch {
                toast({ title: "Could not parse flashcards", variant: "destructive" });
              }
            }}
          >
            <Zap className="w-4 h-4" />
            {deckSaved ? "✓ Flashcards Saved" : "Generate Flashcards"}
          </Button>
          
          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-slate-200 hover:border-violet-400 hover:text-violet-700 hover:bg-violet-50 dark:border-slate-700 dark:hover:border-violet-500 dark:hover:text-violet-300 dark:hover:bg-violet-950/20 flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Practice QBank
          </Button>
          
          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-slate-200 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Bookmark className="w-4 h-4" />
            Save
          </Button>
          
          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-slate-200 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <FileDown className="w-4 h-4" />
            Export PDF
          </Button>
          
          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-slate-200 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Share2 className="w-4 h-4" />
            Share
          </Button>
        </div>
      )}
      </div>
      </div>{/* end middle pane */}

      {/* ── Right pane: section navigator. Only at 2xl+ (≥1536px), where the
          content area is wide enough that a third column doesn't squeeze the
          document — below that we stay 2-column (config + fluid document). ── */}
      {sheet && (
        <>
          <div
            aria-hidden
            className="hidden 2xl:block 2xl:w-px 2xl:shrink-0 2xl:self-stretch bg-slate-200 dark:bg-slate-700"
          />
          <div className="hidden 2xl:block 2xl:w-[240px] 2xl:shrink-0 2xl:sticky 2xl:top-6 2xl:self-start 2xl:pl-6">
            <SheetSectionNav key={sheet.topic ?? "sheet"} sheet={sheet} />
          </div>
        </>
      )}
    </div>

    {/* ── Tablet-only (768–1023px): floating configure button ── */}
    <button
      type="button"
      onClick={() => setConfigDrawerOpen(true)}
      className="hidden md:max-lg:inline-flex fixed bottom-4 left-4 z-40 h-9 items-center gap-1.5 rounded-full bg-teal-500 px-4 text-xs font-semibold text-white shadow-lg hover:bg-teal-600 transition-colors"
    >
      <Settings2 className="h-3.5 w-3.5" />
      Configure
    </button>

    {/* ── Tablet-only: slide-out configurator drawer ── */}
    <div
      className={`hidden md:max-lg:block fixed inset-0 z-50 ${
        configDrawerOpen ? "" : "pointer-events-none"
      }`}
      aria-hidden={!configDrawerOpen}
    >
      <div
        className={`absolute inset-0 bg-black/50 motion-safe:transition-opacity motion-safe:duration-200 ${
          configDrawerOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => setConfigDrawerOpen(false)}
      />
      <div
        className={`absolute inset-y-0 left-0 w-[320px] overflow-y-auto bg-white border-r border-slate-200 p-4 motion-safe:transition-transform motion-safe:duration-[250ms] motion-safe:ease-out dark:bg-slate-900 dark:border-slate-700 ${
          configDrawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between pb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Configure
          </span>
          <button
            type="button"
            onClick={() => setConfigDrawerOpen(false)}
            className="p-1 rounded-md text-slate-500 hover:text-slate-800 transition-colors dark:text-slate-400 dark:hover:text-slate-200"
            aria-label="Close configurator"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {configurator}
      </div>
    </div>

    <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
    <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </>
  );
};

export default SheetGenerator;
