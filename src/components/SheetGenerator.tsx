import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Brain,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDown,
  HeartPulse,
  History,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Stethoscope,
  X,
  Zap,
} from "lucide-react";
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

/** Inline pill toggle group — all options visible, tap to select. */
const PillGroup = ({ label, options, value, onChange }: PillGroupProps) => (
  <div className="mb-4">
    <label className="block font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-2">
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
                ? "bg-primary border-primary text-primary-foreground shadow-md"
                : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
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
  { label: "Heart Failure", icon: HeartPulse, category: "Cardiology" },
  { label: "Pneumonia", icon: Activity, category: "Pulmonology" },
  { label: "Diabetic Ketoacidosis", icon: Brain, category: "Endocrinology" },
  { label: "Ischemic Stroke", icon: BrainCircuit, category: "Neurology" },
  { label: "Nephrotic Syndrome", icon: Activity, category: "Nephrology" },
  { label: "Myocardial Infarction", icon: HeartPulse, category: "Cardiology" },
] as const;

const QuickstartChips = ({ onStartTopic }: { onStartTopic: (label: string) => void }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    {QUICKSTART_TOPICS.map(({ label, icon: Icon, category }) => (
      <button
        key={label}
        type="button"
        onClick={() => onStartTopic(label)}
        className="group flex items-center gap-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent)] hover:shadow-[0_14px_28px_rgba(17,85,90,0.08)]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] shadow-sm">
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[color:var(--color-foreground)] group-hover:text-[color:var(--color-accent)]">
            {label}
          </span>
          <span className="block text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
            {category}
          </span>
        </span>
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
      <div className="animate-fade-in rounded-[28px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col items-center justify-center gap-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-[color:var(--color-foreground)] text-[color:var(--color-accent)] shadow-[0_18px_36px_rgba(15,23,42,0.08)]">
            <Stethoscope className="h-9 w-9" strokeWidth={2.2} />
          </div>

          <div className="space-y-3">
            <p className="[font-family:var(--app-font-mono)] text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--color-accent)]">
              Start your study journey
            </p>
            <h3 className="[font-family:var(--app-font-serif)] text-2xl font-medium tracking-[-0.02em] text-[color:var(--color-foreground)]">
              Turn any topic into a medical study sheet
            </h3>
            <p className="mx-auto max-w-lg text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
              Choose a medical topic or type your own to generate a structured, high-yield review sheet with reasoning, exam clues, and quick recall anchors.
            </p>
          </div>

          <div className="w-full max-w-2xl pt-2">
            <QuickstartChips onStartTopic={onStartTopic} />
          </div>
        </div>
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
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  // Desktop (lg+) side panes. Both start open; the reader collapses them once
  // a sheet is on screen and the document takes the reclaimed width.
  const [configOpen, setConfigOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);
  // Step 2 is a disclosure like "Adjust" beneath it: closed by default, since
  // the defaults suit most sheets and the topic box is what a first visit needs.
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [recentTopics, setRecentTopics] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_TOPICS_KEY) ?? "[]");
      return Array.isArray(stored) ? stored.slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const outputRef = useRef<HTMLDivElement>(null);

  // ── Grounding ──────────────────────────────────────────────────────────
  // Ranges mirror the edge function's clamps (topK 1–10, threshold 0.40–0.90),
  // which re-clamps server-side regardless of what the client sends.
  const [useGrounding, setUseGrounding] = useState(true);
  const [groundingTopK, setGroundingTopK] = useState(8);
  const [groundingThreshold, setGroundingThreshold] = useState(0.6);
  const [groundingSettingsOpen, setGroundingSettingsOpen] = useState(false);
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
    isLoggedIn,
    refreshCitation,
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
      // Sections rendered so far. The sheet arrives as one JSON object, so we
      // repair the truncated tail each chunk and reveal a section only once its
      // field has closed — see parsePartialSheet.
      let revealedCount = 0;

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
      toast({
        title: "Error",
        description: e instanceof Error && e.message ? e.message : "Failed to generate study material",
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

  // Persona buttons are the generation trigger — there is no separate submit.
  const generateWithPersona = (p: Persona) => {
    setPersona(p);
    setDeckSaved(false);
    setConfigDrawerOpen(false);
    generate(undefined, p);
  };

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

  const configurator = (
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
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[80px] pl-10 pr-10 text-sm leading-relaxed rounded-xl border-border focus:border-primary focus:ring-2 focus:ring-primary"
                />
                {notes && (
                  <button
                    type="button"
                    onClick={() => setNotes("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Clear"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              
              <div className="pt-2">
                <p className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-3">Popular Topics</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {QUICKSTART_TOPICS.slice(0, 6).map(({ label, icon: Icon, category }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setNotes(label)}
                      className="group flex flex-col items-center gap-1.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 transition-all duration-200 hover:border-[color:var(--color-accent)] hover:shadow-sm"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--color-foreground)] text-[color:var(--color-accent)]">
                        <Icon className="h-4 w-4" strokeWidth={2.2} />
                      </span>
                      <div className="text-center">
                        <p className="text-xs font-medium leading-tight text-[color:var(--color-foreground)] group-hover:text-[color:var(--color-accent)]">{label}</p>
                        <p className="text-[10px] text-[color:var(--color-muted-foreground)]">{category}</p>
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
              aria-controls="sheet-customize"
              className="flex w-full items-center gap-2.5 text-left"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-panel)] text-[10px] font-bold text-[color:var(--color-muted-foreground)]">2</div>
              <h2 className="[font-family:var(--app-font-serif)] text-lg font-medium tracking-[-0.02em] text-[color:var(--color-foreground)]">Customize</h2>
              <span className="ml-auto flex min-w-0 items-center gap-2">
                {/* Current picks, so a closed panel still says what it will do. */}
                {!customizeOpen && (
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                    {examMode} · {difficulty} · {length}
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
            <div id="sheet-customize" className="animate-fade-in space-y-4">
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
              {/* ── Guideline grounding ──
                  Off skips retrieval entirely: no sources, no grounding badge,
                  and the sheet reads exactly as it did before this feature.
                  The tuning sliders live behind a disclosure because the
                  defaults are right for almost everyone. */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground">
                    Guideline Grounding
                  </label>
                  <button
                    type="button"
                    onClick={() => setGroundingSettingsOpen((v) => !v)}
                    aria-expanded={groundingSettingsOpen}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
                  >
                    {groundingSettingsOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                    Adjust
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ].map((opt) => {
                    const active = (useGrounding ? "on" : "off") === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setUseGrounding(opt.value === "on")}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-all duration-200 border ${
                          active
                            ? "bg-primary border-primary text-primary-foreground shadow-md"
                            : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary"
                        }`}
                      >
                        {active && <Check className="w-4 h-4" />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {groundingSettingsOpen && (
                  <div
                    className={`animate-fade-in mt-3 rounded-lg border border-border bg-card p-4 space-y-5 transition-opacity duration-200 ${
                      useGrounding ? "" : "opacity-50 pointer-events-none"
                    }`}
                    aria-hidden={!useGrounding}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Sources to use</span>
                        <span className="font-mono text-xs font-semibold text-primary">
                          {groundingTopK}
                        </span>
                      </div>
                      <Slider
                        value={[groundingTopK]}
                        onValueChange={([v]) => setGroundingTopK(v)}
                        min={1}
                        max={10}
                        step={1}
                        disabled={!useGrounding}
                        aria-label="Number of guideline sources to retrieve"
                      />
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        How many guideline passages to pull in. More context, but weaker matches.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Match strictness</span>
                        <span className="font-mono text-xs font-semibold text-primary">
                          {Math.round(groundingThreshold * 100)}%
                        </span>
                      </div>
                      <Slider
                        value={[groundingThreshold]}
                        onValueChange={([v]) => setGroundingThreshold(v)}
                        min={0.4}
                        max={0.9}
                        step={0.05}
                        disabled={!useGrounding}
                        aria-label="Minimum similarity for a guideline passage to count"
                      />
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        How close a passage must be to count. Higher means fewer, better matches —
                        and more sheets landing ungrounded.
                      </p>
                    </div>

                    {/* Memory is independent of grounding — it stays fully
                        interactive even while the sliders above are dimmed
                        for useGrounding=false. */}
                    <div className="opacity-100 pointer-events-auto border-t border-border pt-4">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useMemory}
                          onChange={(e) => setUseMemory(e.target.checked)}
                          className="h-3.5 w-3.5 accent-primary cursor-pointer"
                        />
                        <span className="text-sm text-muted-foreground">
                          Remember my recent questions
                        </span>
                      </label>
                      <p className="mt-1 ml-[22px] text-[11px] leading-relaxed text-muted-foreground">
                        Lets follow-ups refer back to what you just asked. Resets automatically
                        every 10 questions.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        </div>

        {/* ── Step 3: AI Perspective ── */}
        <div className="rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--color-foreground)] text-[10px] font-bold text-[color:var(--color-background)]">3</div>
              <h2 className="[font-family:var(--app-font-serif)] text-lg font-medium tracking-[-0.02em] text-[color:var(--color-foreground)]">AI Perspective</h2>
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
                        ? "border-2 shadow-md " + (color === "blue" ? "border-success bg-success-soft" : color === "teal" ? "border-primary bg-primary/10" : "border-info bg-info-soft")
                        : "border border-border bg-card hover:border-input hover:shadow-sm"
                    } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    {active && (
                      <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center ${
                        color === "blue" ? "bg-success" : color === "teal" ? "bg-primary" : "bg-info"
                      }`}>
                        <Check className="w-4 h-4 text-primary-foreground" />
                      </div>
                    )}
                    <span className={`flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 transition-colors ${
                      active
                        ? (color === "blue" ? "bg-success" : color === "teal" ? "bg-primary" : "bg-info")
                        : "bg-secondary"
                    }`}>
                      {loading && active ? (
                        <Loader2 className="w-5 h-5 text-primary-foreground animate-spin" />
                      ) : (
                        <Icon className={`w-5 h-5 ${
                          active ? "text-primary-foreground" : "text-muted-foreground"
                        }`} />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold leading-tight mb-1 ${
                        active
                          ? (color === "blue" ? "text-success" : color === "teal" ? "text-primary" : "text-info")
                          : "text-foreground"
                      }`}>
                        {loading && active ? "Generating…" : label}
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
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
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[color:var(--color-foreground)] text-base font-semibold text-[color:var(--color-background)] shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.16)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          Generate Study Sheet
          <ArrowRight className="h-4 w-4" />
        </Button>

        {pro && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <p className="text-sm font-medium text-primary">
              Unlimited access active
            </p>
          </div>
        )}

        {!pro && (
          <div className="text-center text-xs text-muted-foreground space-y-1">
            {isSheetLimited ? (
              <span className="text-warning font-medium block">
                Daily limit reached ·{" "}
                <button
                  type="button"
                  className="underline hover:text-warning transition-colors"
                  onClick={() => setGoProOpen(true)}
                >
                  Go Pro for Claude + unlimited
                </button>
              </span>
            ) : (
              <span>{sheetCount} / {MAX_DAILY_SHEETS} uses today · Resets at midnight</span>
            )}
            {isPremiumHookActive ? (
              <span className="text-info font-medium block">
                ✦ {premiumRemaining} Claude generation{premiumRemaining !== 1 ? "s" : ""} left ·{" "}
                <button
                  type="button"
                  className="underline hover:text-info transition-colors"
                  onClick={() => setGoProOpen(true)}
                >
                  Go Pro for unlimited Claude
                </button>
              </span>
            ) : !isSheetLimited ? (
              <span className="text-muted-foreground block">
                Powered by GPT-OSS 20B
              </span>
            ) : null}
          </div>
        )}
        {pro && (
          <div className="rounded-xl border border-border bg-secondary px-4 py-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground text-center">
              AI Model
            </p>
            <div className="flex items-center justify-center">
              <div className="inline-flex items-center rounded-lg bg-card p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setPreferredModel("gpt-oss")}
                  disabled={modelSaving || modelLoading}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    !modelLoading && preferredModel === "gpt-oss"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    GPT-OSS 20B
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferredModel("claude")}
                    disabled={modelSaving || modelLoading}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      !modelLoading && preferredModel === "claude"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Claude Haiku 4.5
                  </button>
                </div>
              </div>
              {modelSaving && (
                <p className="text-[11px] text-muted-foreground text-center">Saving preference…</p>
              )}
            </div>
          )}

        {recentTopics.length > 0 && (
          <div className="pt-4 border-t border-border mt-4">
            <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-widest uppercase text-muted-foreground mb-2 pt-2">
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
                  className="truncate max-w-full px-2.5 py-1 rounded-lg border border-border bg-secondary text-muted-foreground text-xs font-medium hover:border-primary hover:text-primary transition-all duration-200 disabled:opacity-50 disabled:cursor-default"
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
      {/* ── Left pane: configurator (35% on desktop, drawer on tablet).
          On desktop it collapses to zero width so the document, which is
          `lg:flex-1`, grows into the space — width animates, nothing is merely
          display:none'd while the column keeps its size. Below lg the pane
          always stacks above the document and the toggle is hidden. ── */}
      <div
        id="sheet-configurator"
        className={`min-w-0 md:max-lg:hidden lg:sticky lg:top-6 lg:self-start lg:shrink-0 lg:overflow-hidden motion-safe:lg:transition-[width,opacity] motion-safe:lg:duration-300 motion-safe:lg:ease-out ${
          configOpen
            ? "lg:w-[35%] lg:min-w-[320px] lg:max-w-[480px] lg:pr-5 lg:opacity-100"
            : "lg:invisible lg:w-0 lg:min-w-0 lg:max-w-0 lg:pr-0 lg:opacity-0"
        }`}
      >
        {configurator}
      </div>

      {/* ── Toggle rail between config and document. Carries the 1px divider
          the old spacer drew, plus the collapse control. ── */}
      <div className="hidden lg:flex lg:w-9 lg:shrink-0 lg:flex-col lg:items-center lg:self-stretch lg:border-l lg:border-border">
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          aria-expanded={configOpen}
          aria-controls="sheet-configurator"
          aria-label={configOpen ? "Hide configuration" : "Show configuration"}
          title={configOpen ? "Hide configuration" : "Show configuration"}
          className="sticky top-6 mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {configOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </button>
      </div>

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

      {/* The library passages this sheet was built on. Self-hides when the
          sheet has no sources, so ungrounded sheets are unaffected. `notes` is
          passed so each excerpt can highlight the terms it matched on. */}
      {!loading && sheet && <SheetSources sheet={sheet} query={notes} />}

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
          {/* Toggle rail sits between the document and the navigator, so the
              navigator is the outermost column and slides off the right edge. */}
          <div className="hidden 2xl:flex 2xl:w-9 2xl:shrink-0 2xl:flex-col 2xl:items-center 2xl:self-stretch 2xl:border-l 2xl:border-border">
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-expanded={navOpen}
              aria-controls="sheet-section-nav"
              aria-label={navOpen ? "Hide section list" : "Show section list"}
              title={navOpen ? "Hide section list" : "Show section list"}
              className="sticky top-6 mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {navOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Width goes to zero and the box nudges rightward as it fades, so
              it reads as leaving through the right edge. The inner wrapper
              keeps a fixed width so the list doesn't reflow mid-animation. */}
          <div
            id="sheet-section-nav"
            className={`hidden 2xl:block 2xl:shrink-0 2xl:sticky 2xl:top-6 2xl:self-start 2xl:overflow-hidden motion-safe:2xl:transition-[width,opacity,transform] motion-safe:2xl:duration-300 motion-safe:2xl:ease-out ${
              navOpen
                ? "2xl:w-[240px] 2xl:translate-x-0 2xl:opacity-100"
                : "2xl:invisible 2xl:w-0 2xl:translate-x-6 2xl:opacity-0"
            }`}
          >
            <div className="w-[240px] pl-6">
              {/* A stable object, not a fresh literal — the observer effect keys
                  off `sheet`, so a new identity each render would rebind it. */}
              <SheetSectionNav
                key={generationId}
                sheet={sheet ?? EMPTY_SHEET}
                readyKeys={loading ? streamedKeys : undefined}
              />
            </div>
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
        className={`absolute inset-y-0 left-0 w-[320px] overflow-y-auto bg-card border-r border-border p-4 motion-safe:transition-transform motion-safe:duration-[250ms] motion-safe:ease-out ${
          configDrawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between pb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Configure
          </span>
          <button
            type="button"
            onClick={() => setConfigDrawerOpen(false)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
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
