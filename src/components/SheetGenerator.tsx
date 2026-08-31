import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsTabletBand } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ChevronDown, ChevronRight, FileDown, Loader2, Play, Settings2, Share2, Sparkles, Stethoscope, X, Zap } from "lucide-react";
import { Slider } from "@/components/ui/slider";
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
import { parsePartialSheet, parseSheetOutput } from "@/lib/parse-partial-sheet";
import {
  type GeneratedSheet,
  type SheetSource,
  parseStoredSheet,
  isJsonSheet,
} from "@/types/generated-sheet";
import GroundingNotice from "@/components/GroundingNotice";
import SheetSources from "@/components/SheetSources";
import { reconcileGroundingLevel, resolveGroundingLevel } from "@/lib/grounding";
import { fetchBestCitation, type CitationResult } from "@/lib/citation";
import { getCitationsForTopic } from "@/lib/citation-store";
import CitationCTABanner from "@/components/CitationCTABanner";
import AuthModal from "@/components/AuthModal";
import GoProModal from "@/components/GoProModal";
import { startTopProgress, finishTopProgress } from "@/components/TopProgressBar";
import { useStudyHistory, type StudyHistoryItem } from "@/hooks/use-study-history";
import { usePersona, type Persona } from "@/hooks/use-persona";
import { useMemoryPreference } from "@/hooks/use-memory-preference";
import { timeAgo } from "@/lib/utils";
import { sheetToPlainText } from "@/lib/sheet-to-text";

export interface SheetGeneratorPrefill {
  input: string;
  output: string;
  modeInfo?: StudyHistoryItem["modeInfo"];
}

interface SheetGeneratorProps {
  prefill?: SheetGeneratorPrefill | null;
}

const RECENT_TOPICS_KEY = "sb_recent_topics_v1";

/**
 * How long the stream may go silent before it is treated as dead. Generous, so
 * a slow model or a long sheet is never cut short — this exists to end a hung
 * connection, not to cap generation time.
 */
const STREAM_IDLE_TIMEOUT_MS = 45_000;

/**
 * Stand-in for the moments before the first section lands, so the document
 * renders its full structure from the first frame instead of swapping a
 * placeholder block out for the real one.
 */
const EMPTY_SHEET: GeneratedSheet = {
  overview: "",
  memoryHooks: [],
  clinicalApproach: "",
  keyPoints: [],
  examTraps: [],
  flashcards: [],
  referenceNote: "",
};
const EMPTY_SHEET_JSON = JSON.stringify(EMPTY_SHEET);

interface PillGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Inline pill toggle group.
 *
 * Denser than before (h-8, 13px) because these now live inside a disclosure
 * rather than being the page's main content — they are settings, not choices
 * the student is asked to make up front.
 */
const PillGroup = ({ label, options, value, onChange }: PillGroupProps) => (
  <div>
    <p className="ds-label mb-2">{label}</p>
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`h-8 rounded-[var(--r-sm)] border px-3 text-[13px] transition-colors ${
              active
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:border-input hover:text-foreground"
            }`}
          >
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
  const v = (sheet as unknown as Record<string, unknown>)[key];
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return false;
}

/**
 * Sticky right-rail navigator. Lists the sheet's non-empty sections, smooth-
 * scrolls to a section on click, and highlights the section the reader is on
 * via an IntersectionObserver watching each `[data-section-key]` card.
 *
 * While streaming (`readyKeys` given) it lists every section up front, greying
 * the ones still to come — the rail has to hold its width from the first frame
 * or it squeezes the document out from under the reader when it appears.
 */
const SheetSectionNav = ({
  sheet,
  readyKeys,
}: {
  sheet: GeneratedSheet;
  readyKeys?: string[];
}) => {
  const streaming = readyKeys !== undefined;
  const items = streaming
    ? SECTION_NAV_ITEMS
    : SECTION_NAV_ITEMS.filter((it) => sectionHasContent(sheet, it.key));
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
          const pending = streaming && !readyKeys!.includes(it.key);
          const active = !pending && activeKey === it.key;
          return (
            <button
              key={it.key}
              type="button"
              disabled={pending}
              onClick={() => scrollToSection(it.key)}
              aria-current={active ? "true" : undefined}
              className={`border-none border-l-2 bg-transparent py-1.5 pl-3 text-left text-sm transition-all duration-200 ${
                active
                  ? "border-l-primary text-primary font-medium"
                  : pending
                  ? // Not streamed in yet: dimmer than a live entry, and inert.
                    "border-l-border text-muted-foreground/50 cursor-default"
                  : "border-l-border text-muted-foreground hover:text-foreground"
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
        className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:border-primary hover:shadow-md transition-all duration-200"
      >
        <span className="text-2xl">{icon}</span>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground group-hover:text-primary">{label}</p>
          <p className="text-[11px] text-muted-foreground">{category}</p>
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
      <div className="animate-fade-in flex flex-col items-center justify-center gap-6 rounded-2xl border border-border bg-card px-8 py-16 text-center shadow-sm">
        <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-primary/15 shadow-lg">
          <Stethoscope className="w-10 h-10 text-primary" />
        </div>
        <div className="space-y-3">
          <h3 className="text-xl font-serif font-semibold text-foreground">
            Start Your Study Journey
          </h3>
          <p className="text-base text-muted-foreground max-w-md">
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
          <h3 className="text-sm font-serif font-semibold text-foreground">Continue Studying</h3>
          <span className="text-xs text-muted-foreground">{recent.length} recent sheets</span>
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
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left hover:border-primary hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground group-hover:text-primary leading-tight">
                    {item.topic}
                  </p>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                </div>
                {chips && (
                  <p className="truncate text-xs text-muted-foreground">
                    {chips}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-auto pt-1">
                  {timeAgo(item.timestamp)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-border" />
        <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
          or start fresh
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <QuickstartChips onStartTopic={onStartTopic} />
    </div>
  );
};

/**
 * The quota line under the generate button.
 *
 * Was three separate conditional blocks stacked below the CTA — a limit
 * warning, a Claude-credits line and a "Powered by GPT-OSS 20B" caption — which
 * between them could put three lines of small print under the primary action.
 * One line, stating the single most useful fact for the current state.
 */
const UsageLine = ({
  pro,
  isSheetLimited,
  sheetCount,
  isPremiumHookActive,
  premiumRemaining,
  onGoPro,
}: {
  pro: boolean;
  isSheetLimited: boolean;
  sheetCount: number;
  isPremiumHookActive: boolean;
  premiumRemaining: number;
  onGoPro: () => void;
}) => {
  if (pro) {
    return (
      <p className="ds-meta mt-2.5 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Unlimited
      </p>
    );
  }

  if (isSheetLimited) {
    return (
      <p className="ds-meta mt-2.5 text-warning">
        Daily limit reached ·{" "}
        <button type="button" onClick={onGoPro} className="underline">
          Go Pro for unlimited
        </button>
      </p>
    );
  }

  return (
    <p className="ds-meta mt-2.5">
      <span className="ds-num">
        {sheetCount}/{MAX_DAILY_SHEETS}
      </span>{" "}
      today
      {isPremiumHookActive && (
        <>
          {" · "}
          <span className="text-info">
            {premiumRemaining} Claude generation
            {premiumRemaining !== 1 ? "s" : ""} left
          </span>
        </>
      )}
    </p>
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
  // Sections whose JSON has fully arrived, so the renderer knows how much of a
  // still-streaming sheet is safe to show.
  const [streamedKeys, setStreamedKeys] = useState<string[]>([]);
  // The response was damaged and only part of it could be salvaged — the reader
  // is told rather than being handed a silently short sheet.
  const [sheetIncomplete, setSheetIncomplete] = useState(false);
  // Identifies the sheet on screen, so the section navigator resets its active
  // item per sheet rather than when `topic` happens to arrive mid-stream.
  const [generationId, setGenerationId] = useState(0);
  // A prefilled topic (e.g. a Roadmap chip) must land in a visible textarea —
  // otherwise the picker renders and silently overwrites it on the next click.
  const [citationState, setCitationState] = useState<CitationState>("idle");
  const [citations, setCitations] = useState<CitationResult[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [goProOpen, setGoProOpen] = useState(false);
  // Tablet (768–1023px) slide-out configurator drawer
  // Opens on mount when a topic was handed in (Roadmap chip → /sheets). On
  // tablet the configurator is `md:max-lg:hidden`, so the seeded topic landed in
  // a closed drawer and the tap looked like it did nothing. Desktop and phone
  // show the pane inline, so this only matters in the 768–1023px band — but
  // opening the drawer there is harmless at any width because it is display:none
  // outside it.
  const [configDrawerOpen, setConfigDrawerOpen] = useState(
    () => !!prefill?.input?.trim()
  );
  const [recentTopics, setRecentTopics] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_TOPICS_KEY) ?? "[]");
      return Array.isArray(stored) ? stored.slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const outputRef = useRef<HTMLDivElement>(null);
  // The Sheet portals to <body>, so it cannot inherit the trigger's responsive
  // `display`. Gate it here instead, and it closes itself if the viewport grows
  // past the band while open (where the configurator is shown inline anyway).
  const inTabletBand = useIsTabletBand();
  // Aborts an in-flight generation. The stream had no timeout and no abort: a
  // connection that dropped mid-response left `loading` true forever, with the
  // progress bar running and no error and no way to retry.
  const abortRef = useRef<AbortController | null>(null);

  // ── Grounding ──────────────────────────────────────────────────────────
  // Ranges mirror the edge function's clamps (topK 1–10, threshold 0.40–0.90),
  // which re-clamps server-side regardless of what the client sends.
  const [useGrounding, setUseGrounding] = useState(true);
  const [groundingTopK, setGroundingTopK] = useState(8);
  const [groundingThreshold, setGroundingThreshold] = useState(0.6);
  // localStorage-backed and deliberately shared: all four medical-notes modes
  // write to one 10-turn window per user, so the preference has to be the same
  // wherever they're called from.
  const { useMemory, setUseMemory } = useMemoryPreference();
  // Null until the server's __meta event arrives. Staying null means grounding
  // was never attempted, so the sheet keeps its pre-grounding appearance —
  // distinct from an attempt that retrieved nothing ({ retrievedChunks: 0 }).
  const groundingResultRef = useRef<{ retrievedChunks: number; sources: SheetSource[] } | null>(
    null
  );

  const { toast } = useToast();
  const navigate = useNavigate();

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
  const {
    preferredModel,
    setPreferredModel,
    saving: modelSaving,
    isLoading: modelLoading,
  } = useModelPreference();
  const { user, isAnonymous } = useAuth();
  const {
    canUseCitation,
    citationsRemaining,
    isLoggedIn,
    refreshCitation,
  } = useCitationUsage();
  const { saveCards } = useFlashcardDeck();
  const { persona, setPersona } = usePersona();

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
    setStreamedKeys([]);
    setSheetIncomplete(false);
    groundingResultRef.current = null;
    // Captured per-generation rather than read at render time: the sheet must
    // keep describing the settings it was actually built with, even if the
    // toggle is flipped afterwards.
    const groundingRequested = useGrounding;
    setGenerationId((id) => id + 1);
    setCitationState("idle");
    setCitations([]);

    setTimeout(() => {
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset on every chunk: this bounds silence, not total duration, so a long
    // but healthy generation is never cut off.
    let watchdog = window.setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
    const pokeWatchdog = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
    };

    try {
      const response = await callMedicalNotes({
        notes: activeNotes,
        difficulty,
        focus,
        length,
        examMode,
        persona: activePersona,
        useGrounding,
        topK: groundingTopK,
        threshold: groundingThreshold,
        useMemory,
        userId: user?.id ?? null,
        isAnonymous: isAnonymous ?? false,
        isPro: pro,
        preferredModel: pro ? preferredModel : undefined,
      }, { signal: controller.signal });

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
      // Sections rendered so far. The sheet arrives as one JSON object, so we
      // repair the truncated tail each chunk and reveal a section only once its
      // field has closed — see parsePartialSheet.
      let revealedCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pokeWatchdog();
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
            // Grounding metadata arrives as a single __meta event ahead of any
            // model bytes. It must be intercepted before the delta read below
            // so it never reaches fullText / parsePartialSheet.
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
            if (content) {
              fullText += content;
              // Re-render only when another section finishes — at most once per
              // section for the whole stream, so no mid-word reflow.
              const partial = parsePartialSheet(fullText);
              if (partial && partial.completeKeys.length > revealedCount) {
                revealedCount = partial.completeKeys.length;
                setSheet(partial.sheet);
                setStreamedKeys(partial.completeKeys);
              }
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Authoritative parse, degrading in steps rather than all at once: a
      // single unescaped quote from the model used to discard the whole sheet
      // and dump raw JSON at the reader.
      const rawText = fullText || "";
      const result = parseSheetOutput(rawText);
      if (result) {
        // Reconcile the model's self-reported coverage against retrieval truth.
        // Retrieval can only ever weaken the claim, never strengthen it.
        const grounding = groundingResultRef.current;
        const groundedSheet: GeneratedSheet = grounding
          ? {
              ...result.sheet,
              retrievedChunks: grounding.retrievedChunks,
              sources: grounding.sources,
              groundingLevel: reconcileGroundingLevel(
                grounding.retrievedChunks,
                result.sheet.sourceCoverage ?? null
              ),
            }
          : groundingRequested === false
          ? // Deliberately turned off. Mark it "none" but leave retrievedChunks
            // unset — that absence is what tells the notice to say "turned off"
            // rather than "we don't have this topic".
            { ...result.sheet, groundingLevel: "none" as const }
          : // Grounding was on but no __meta arrived (an edge function that
            // predates this feature). Leave the sheet unmarked so it renders
            // exactly as it did before, rather than claiming a false verdict.
            result.sheet;
        setSheet(groundedSheet);
        setLegacyOutput("");
        setSheetIncomplete(result.status === "partial");
      } else if (revealedCount === 0) {
        // Not a JSON sheet at all — hand it to the legacy text renderer.
        setSheet(null);
        setLegacyOutput(rawText);
      } else {
        // Unparseable tail, but sections did stream. Keep them.
        setSheetIncomplete(true);
      }
      setLoading(false);

      // Citation lookup — runs after stream completes. Serves from the local
      // topic cache when available (no quota consumed); otherwise the edge
      // function consumes one unit server-side and returns whether it was
      // accepted, so the server is the source of truth for the daily limit.
      try {
        const cached = getCitationsForTopic(activeNotes);
        if (cached.length > 0) {
          setCitations(cached);
          setCitationState("found");
        } else if (canUseCitation) {
          setCitationState("loading");
          const result = await fetchBestCitation(activeNotes);
          setCitations(result.citations);
          if (result.quotaExceeded) {
            setCitationState("locked");
          } else {
            setCitationState(result.citations.length > 0 ? "found" : "hidden");
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
      setLoading(false);
      const aborted = e instanceof Error && e.name === "AbortError";
      toast({
        title: aborted ? "Generation timed out" : "Error",
        description: aborted
          ? "The connection went quiet. Check your network and try again."
          : e instanceof Error && e.message
          ? e.message
          : "Failed to generate study material",
        variant: "destructive",
      });
    } finally {
      window.clearTimeout(watchdog);
    }
  };

  useEffect(() => {
    if (loading) {
      startTopProgress();
      return () => finishTopProgress();
    }
  }, [loading]);

  // Leaving the page mid-generation should cancel it, not leave a stream and a
  // watchdog running against an unmounted component.
  useEffect(() => () => abortRef.current?.abort(), []);

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


  const startTopic = (label: string) => {
    setNotes(label);
    setDeckSaved(false);
    setConfigDrawerOpen(false);
    generate(label);
  };

  /**
   * Share the sheet's text. There is no per-sheet route to link to, so this
   * shares the content itself: the native share sheet where available (mobile),
   * clipboard everywhere else.
   */
  const handleShare = async () => {
    const text = sheetToPlainText(sheet, legacyOutput, notes);
    if (!text.trim()) {
      toast({ title: "Nothing to share yet", variant: "destructive" });
      return;
    }

    const title = sheet?.topic?.trim() || notes.trim().slice(0, 60) || "Study sheet";

    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (e: unknown) {
        // The user dismissing the native sheet is not an error worth surfacing.
        if (e instanceof Error && e.name === "AbortError") return;
        // Anything else (unsupported payload, permission) falls through to copy.
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Study sheet copied to clipboard" });
    } catch {
      toast({ title: "Couldn't copy the sheet", variant: "destructive" });
    }
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
    setConfigDrawerOpen(false);
    setDeckSaved(false);
    setSheetIncomplete(false);
    setGenerationId((id) => id + 1);
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

  /**
   * The generator's controls.
   *
   * This was three numbered cards asking nine questions — exam mode,
   * difficulty, focus, length, grounding on/off, top-K, threshold, memory,
   * persona — before a student could get one sheet. Worse, the three persona
   * buttons WERE the submit action while a separate "Generate Study Sheet"
   * button also existed: two competing primary actions with no hierarchy.
   *
   * Now: one input, one button, and everything else folded into a single
   * disclosure whose summary states the current settings, so the defaults stay
   * visible without occupying the screen.
   */
  const configurator = (
      <div className="animate-fade-in ds-stack">
        {!isLoggedIn && (
          <CitationCTABanner
            onSignInClick={() => setAuthModalOpen(true)}
            remaining={citationsRemaining}
          />
        )}

        {/* ── The ask ── */}
        <div>
          <label htmlFor="sheet-topic" className="ds-label ds-label-accent">
            What are you studying?
          </label>
          <div className="relative mt-2.5">
            <Textarea
              id="sheet-topic"
              placeholder="Heart failure, DKA, cranial nerves…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits; Shift+Enter is a newline. The textarea exists
                // so longer notes can be pasted, but the common case is a
                // two-word topic and should not need a mouse.
                if (e.key === "Enter" && !e.shiftKey && notes.trim() && !loading) {
                  e.preventDefault();
                  generate();
                }
              }}
              className="min-h-[76px] resize-none rounded-[var(--r-md)] border-border pe-10 text-[15px] leading-relaxed focus:border-primary focus:ring-1 focus:ring-primary"
            />
            {notes && (
              <button
                type="button"
                onClick={() => setNotes("")}
                className="absolute end-2.5 top-2.5 rounded-[var(--r-sm)] p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Clear topic"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Button
            onClick={() => generate()}
            disabled={loading || !notes.trim()}
            className="mt-3 h-11 w-full rounded-[var(--r-md)] text-[15px] font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate sheet
              </>
            )}
          </Button>

          <UsageLine
            pro={pro}
            isSheetLimited={isSheetLimited}
            sheetCount={sheetCount}
            isPremiumHookActive={isPremiumHookActive}
            premiumRemaining={premiumRemaining}
            onGoPro={() => setGoProOpen(true)}
          />
        </div>

        {/* ── Starting points ── */}
        {(recentTopics.length > 0 || !notes) && (
          <div>
            <p className="ds-label mb-2.5">
              {recentTopics.length > 0 ? "Recent" : "Popular"}
            </p>
            <div className="flex flex-wrap gap-2">
              {(recentTopics.length > 0
                ? recentTopics
                : QUICKSTART_TOPICS.map((q) => q.label)
              ).map((topic) => (
                <button
                  key={topic}
                  type="button"
                  disabled={loading}
                  onClick={() => setNotes(topic)}
                  className="max-w-full truncate rounded-[var(--r-pill)] border border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {topic}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Everything else ──
            One disclosure. Its summary reports the current settings, so the
            defaults are legible without being nine controls on screen. */}
        <details className="group border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-start">
            <span className="min-w-0">
              <span className="ds-small block font-medium text-foreground">
                Options
              </span>
              <span className="ds-meta mt-0.5 block truncate">
                {[examMode, difficulty, length, useGrounding ? "grounded" : "ungrounded"].join(" · ")}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>

          <div className="ds-stack-sm mt-5">
            <PillGroup
              label="Exam"
              value={examMode}
              onChange={setExamMode}
              options={[
                { value: "General", label: "General" },
                { value: "USMLE Step 1", label: "Step 1" },
                { value: "USMLE Step 2", label: "Step 2" },
              ]}
            />
            <PillGroup
              label="Depth"
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: "Basic", label: "Basic" },
                { value: "Medium", label: "Intermediate" },
                { value: "Advanced", label: "Advanced" },
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
            <PillGroup
              label="Angle"
              value={focus}
              onChange={setFocus}
              options={[
                { value: "Quick Revision", label: "Revision" },
                { value: "Deep Understanding", label: "Understanding" },
                { value: "Clinical Reasoning", label: "Reasoning" },
              ]}
            />
            <PillGroup
              label="Written for"
              value={persona}
              onChange={(v) => setPersona(v as Persona)}
              options={[
                { value: "student", label: "Student" },
                { value: "clinician", label: "Clinician" },
                { value: "expert", label: "Expert" },
              ]}
            />

            {/* Grounding: the toggle is the control most people need; the two
                numbers behind it are for the few who tune retrieval. */}
            <div>
              <PillGroup
                label="Guideline grounding"
                value={useGrounding ? "on" : "off"}
                onChange={(v) => setUseGrounding(v === "on")}
                options={[
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
              />
              {useGrounding && (
                <details className="mt-1">
                  <summary className="ds-meta cursor-pointer list-none hover:text-foreground">
                    Tune retrieval ▾
                  </summary>
                  <div className="mt-3 space-y-4 rounded-[var(--r-md)] border border-border p-3.5">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="ds-small">Sources</span>
                        <span className="ds-num ds-meta font-medium text-primary">
                          {groundingTopK}
                        </span>
                      </div>
                      <Slider
                        value={[groundingTopK]}
                        onValueChange={([v]) => setGroundingTopK(v)}
                        min={1}
                        max={10}
                        step={1}
                        aria-label="Number of guideline sources to retrieve"
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="ds-small">Match strictness</span>
                        <span className="ds-num ds-meta font-medium text-primary">
                          {Math.round(groundingThreshold * 100)}%
                        </span>
                      </div>
                      <Slider
                        value={[groundingThreshold]}
                        onValueChange={([v]) => setGroundingThreshold(v)}
                        min={0.4}
                        max={0.9}
                        step={0.05}
                        aria-label="Minimum similarity for a guideline passage to count"
                      />
                    </div>
                  </div>
                </details>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 border-t border-border pt-4">
              <input
                type="checkbox"
                checked={useMemory}
                onChange={(e) => setUseMemory(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-primary"
              />
              <span>
                <span className="ds-small block text-foreground">
                  Remember my recent questions
                </span>
                <span className="ds-meta mt-0.5 block">
                  Lets follow-ups refer back. Resets every 10 questions.
                </span>
              </span>
            </label>

            {pro && (
              <div className="border-t border-border pt-4">
                <p className="ds-label mb-2">Model</p>
                <div className="flex gap-2">
                  {(["gpt-oss", "claude"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPreferredModel(m)}
                      disabled={modelSaving || modelLoading}
                      aria-pressed={!modelLoading && preferredModel === m}
                      className={`rounded-[var(--r-sm)] border px-3 py-1.5 text-[13px] transition-colors ${
                        !modelLoading && preferredModel === m
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "claude" ? "Claude Haiku 4.5" : "GPT-OSS 20B"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
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
        className="hidden lg:block lg:w-px lg:shrink-0 lg:self-stretch bg-border"
      />

      {/* ── Middle pane: living document (fluid, fills its lane) ── */}
      <div ref={outputRef} className="min-w-0 lg:flex-1 lg:px-8">
      <div className="w-full space-y-6">
      {!loading && !sheet && !legacyOutput && (
        <SheetsEmptyState onStartTopic={startTopic} onSelectHistory={loadHistoryItem} />
      )}

      {/* Grounding verdict sits above the sheet — it qualifies everything
          below it, so it must be read first. Self-hides for "full" and for
          sheets with no grounding metadata at all (legacy, or grounding off). */}
      {!loading && sheet && (
        <GroundingNotice
          level={resolveGroundingLevel(sheet)}
          coverage={sheet.sourceCoverage}
          reason={
            sheet.groundingLevel !== "none"
              ? undefined
              : sheet.retrievedChunks === undefined
              ? "disabled"
              : sheet.retrievedChunks === 0
              ? "no-match"
              : "not-relevant"
          }
        />
      )}

      {/* Rendered from the first frame of a generation, so the sheet's seven
          sections are laid out once and filled in — never added or removed. */}
      {(loading || sheet || legacyOutput) && (
        <OutputSection
          output={sheet ? JSON.stringify(sheet) : legacyOutput || EMPTY_SHEET_JSON}
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
          isStreaming={loading}
          streamedKeys={streamedKeys}
        />
      )}

      {/* Retrieved guideline chunks behind this sheet. Self-hides when the
          sheet has no sources, so ungrounded sheets are unaffected. */}
      {!loading && sheet && <SheetSources sheet={sheet} />}

      {/* The response was damaged mid-flight. Say so rather than let a short
          sheet pass for a complete one — this is medical content. */}
      {!loading && sheetIncomplete && (
        <div className="animate-fade-in flex items-center gap-3 rounded-xl border border-border border-l-[3px] border-l-warning bg-card px-4 py-3">
          <AlertTriangle className="h-[15px] w-[15px] shrink-0 text-warning" />
          <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
            This sheet was cut short — some sections may be missing.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 text-xs"
            onClick={() => generate()}
          >
            Regenerate
          </Button>
        </div>
      )}

      {/* Flashcards stream in last, so this stays hidden until the sheet is whole. */}
      {!loading && (sheet || legacyOutput) && (
        <div className="flex flex-wrap justify-center gap-3 pt-4">

          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-border hover:border-primary hover:text-primary hover:bg-primary/10 flex items-center gap-2"
            disabled={deckSaved}
            onClick={() => {
              try {
                if (sheet?.flashcards?.length) {
                  // A sheet's cards inherit the sheet's grounding, narrowed by
                  // the model's own coverage report: "full" means the library
                  // carried the whole sheet, "partial" only counts when the
                  // flashcards section wasn't one of the parts it missed.
                  const level = resolveGroundingLevel(sheet);
                  const flashcardsUncovered =
                    sheet.sourceCoverage?.uncovered?.includes("flashcards") ?? false;
                  const cardsGrounded =
                    level === "full" || (level === "partial" && !flashcardsUncovered);
                  const parsed = sheet.flashcards.map((c) => ({
                    question: c.question,
                    answer: c.answer,
                    tag: c.tag,
                    grounded: cardsGrounded,
                    topic: notes.trim().slice(0, 60),
                    topicEmoji: sheet.topicEmoji,
                  }));
                  saveCards(
                    parsed,
                    level
                      ? {
                          retrievedChunks: sheet.retrievedChunks ?? 0,
                          groundingLevel: level,
                          sources: sheet.sources ?? [],
                        }
                      : undefined
                  );
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
            className="h-10 rounded-xl font-medium text-sm px-4 border-border hover:border-info hover:text-info hover:bg-info-soft flex items-center gap-2"
            onClick={() => navigate("/qbank")}
          >
            <Play className="w-4 h-4" />
            Practice QBank
          </Button>

          {/* No "Save" here: OutputSection already renders a working SaveButton
              at the top of the document. A second one would keep its own
              `saved` state and drift out of sync with the first. */}

          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-border hover:border-input hover:text-foreground hover:bg-secondary flex items-center gap-2"
            onClick={() => window.print()}
          >
            <FileDown className="w-4 h-4" />
            Export PDF
          </Button>

          <Button
            variant="outline"
            className="h-10 rounded-xl font-medium text-sm px-4 border-border hover:border-input hover:text-foreground hover:bg-secondary flex items-center gap-2"
            onClick={handleShare}
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
      {/* Present for the whole generation. Appearing at the end would take 240px
          back from the document just as the reader settles into it. */}
      {(loading || sheet) && (
        <>
          <div
            aria-hidden
            className="hidden 2xl:block 2xl:w-px 2xl:shrink-0 2xl:self-stretch bg-border"
          />
          <div className="hidden 2xl:block 2xl:w-[240px] 2xl:shrink-0 2xl:sticky 2xl:top-6 2xl:self-start 2xl:pl-6">
            {/* A stable object, not a fresh literal — the observer effect keys
                off `sheet`, so a new identity each render would rebind it. */}
            <SheetSectionNav
              key={generationId}
              sheet={sheet ?? EMPTY_SHEET}
              readyKeys={loading ? streamedKeys : undefined}
            />
          </div>
        </>
      )}
    </div>

    {/* ── Tablet-only (768–1023px): floating configure button ── */}
    <button
      type="button"
      onClick={() => setConfigDrawerOpen(true)}
      className="hidden md:max-lg:inline-flex fixed bottom-4 left-4 z-40 h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
    >
      <Settings2 className="h-3.5 w-3.5" />
      Configure
    </button>

    {/* ── Tablet-only: slide-out configurator drawer ──
        Radix Sheet, not a hand-rolled panel. The old version stayed mounted and
        merely translated off-screen, marked `aria-hidden` while every control
        inside it was still focusable — a keyboard user could tab into a subtree
        the screen reader was told did not exist. Radix unmounts on close, traps
        focus while open, restores it after, and handles Escape. ── */}
    <Sheet
      open={configDrawerOpen && inTabletBand}
      onOpenChange={setConfigDrawerOpen}
    >
      <SheetContent side="left" className="w-[320px] overflow-y-auto p-4">
        <SheetHeader className="text-left">
          <SheetTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Configure
          </SheetTitle>
          <SheetDescription className="sr-only">
            Choose a topic and generation settings.
          </SheetDescription>
        </SheetHeader>
        {configurator}
      </SheetContent>
    </Sheet>

    <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
    <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </>
  );
};

export default SheetGenerator;
