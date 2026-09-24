import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  FileDown,
  Layers,
  MoreHorizontal,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Share2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import OutputSection, { type CitationState } from "@/components/OutputSection";
import type { GenerationStatus } from "@/components/SheetProgress";
import SaveButton from "@/components/SaveButton";
import SectionSkeleton from "@/components/SectionSkeleton";
import SheetComposer from "@/components/sheet/SheetComposer";
import SheetSettings from "@/components/sheet/SheetSettings";
import SheetTopicBar from "@/components/sheet/SheetTopicBar";
import SheetFinish, { type SheetDeck } from "@/components/sheet/SheetFinish";
import { SectionsMenu, SheetSectionRail } from "@/components/sheet/SheetSections";
import {
  TOPIC_BAR_BUTTON,
  jumpToSection,
  listSections,
  useActiveSection,
} from "@/components/sheet/sheet-nav";
import { useUsageLimit, MAX_DAILY_SHEETS } from "@/hooks/use-usage-limit";
import { useCitationUsage } from "@/hooks/use-citation-usage";
import { usePremiumHook } from "@/hooks/use-premium-hook";
import { useModelPreference } from "@/hooks/use-model-preference";
import { useAuth } from "@/hooks/use-auth";
import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { parseModelUsed, type ModelUsed } from "@/lib/model-used";
import { useFlashcardDeck } from "@/hooks/use-flashcard-deck";
import { parseFlashcardsFromOutput } from "@/lib/parse-flashcards";
import {
  parsePartialSheet,
  parseSheetOutput,
  type PartialSheetResult,
} from "@/lib/parse-partial-sheet";
import {
  type Flashcard,
  type GeneratedSheet,
  type SheetSource,
  parseStoredSheet,
  isJsonSheet,
} from "@/types/generated-sheet";
import GroundingNotice from "@/components/GroundingNotice";
import { reconcileGroundingLevel, resolveGroundingLevel } from "@/lib/grounding";
import { parsePlan, renderOrder, resolvePlan } from "@/lib/sheet-plan";
import type { SheetSectionSpec } from "@/types/generated-sheet";
import { applySourceLabels } from "@/lib/source-labels";
import { fetchBestCitation, type CitationResult } from "@/lib/citation";
import { getCitationsForTopic } from "@/lib/citation-store";
import AuthModal from "@/components/AuthModal";
import GoProModal from "@/components/GoProModal";
import type { StudyHistoryItem } from "@/hooks/use-study-history";
import { useMemoryPreference } from "@/hooks/use-memory-preference";
import { sheetToPlainText } from "@/lib/sheet-to-text";
import { RISE } from "@/lib/motion";

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

/** The settings a sheet was made with — what its topic bar and Save describe. */
interface SheetSettingsSnapshot {
  notes: string;
  examMode: string;
  difficulty: string;
  length: string;
  useGrounding: boolean;
  topK: number;
  threshold: number;
}

const EXAM_LABELS: Record<string, string> = {
  "USMLE Step 1": "Step 1",
  "USMLE Step 2": "Step 2",
};

const settingsSummary = (s: SheetSettingsSnapshot) =>
  [EXAM_LABELS[s.examMode] ?? s.examMode, s.difficulty, s.length].join(" · ");

/** A title for a sheet whose topic hasn't arrived: the first line asked for. */
const firstLine = (text: string) => text.trim().split("\n")[0].trim().slice(0, 80);

/**
 * A view swap starts at the top of the page. It mounts only after the outgoing
 * view has faded out (AnimatePresence "wait"), so the jump is never seen.
 */
function ScrollToTopOnMount() {
  useLayoutEffect(() => {
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  }, []);
  return null;
}

const SheetGenerator = ({ prefill }: SheetGeneratorProps) => {
  const [notes, setNotes] = useState(prefill?.input ?? "");
  const [difficulty, setDifficulty] = useState(prefill?.modeInfo?.difficulty ?? "Basic");
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
  const [modelUsed, setModelUsed] = useState<ModelUsed | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [deckSaved, setDeckSaved] = useState(false);
  // Sections whose JSON has fully arrived, so the renderer knows how much of a
  // still-streaming sheet is safe to show.
  const [streamedKeys, setStreamedKeys] = useState<string[]>([]);
  // The key the model is writing right now, so its section can show the draft.
  const [liveKey, setLiveKey] = useState<string | undefined>(undefined);
  // What the stream has reported so far, for the progress line.
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>({
    planned: false,
    sources: "off",
  });
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
  // The topic bar's Edit panel. It edits the same state as the composer, and
  // closing it without regenerating puts that state back.
  const [editOpen, setEditOpen] = useState(false);
  const [recentTopics, setRecentTopics] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_TOPICS_KEY) ?? "[]");
      return Array.isArray(stored) ? stored.slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  // The document column, for the topic bar's reading-progress bar.
  const docRef = useRef<HTMLDivElement>(null);

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
  // The settings the sheet on screen was made with. The composer and the Edit
  // panel edit a draft (the state above); this changes only when a sheet is
  // generated or loaded, so the topic bar and Save never describe a setting
  // the reader has picked but not yet used.
  const [activeSettings, setActiveSettings] = useState<SheetSettingsSnapshot>(() => ({
    notes: prefill?.input ?? "",
    examMode: prefill?.modeInfo?.examMode ?? "General",
    difficulty: prefill?.modeInfo?.difficulty ?? "Basic",
    length: prefill?.modeInfo?.length ?? "Concise",
    useGrounding: true,
    topK: 8,
    threshold: 0.6,
  }));
  // Null until the server's __meta event arrives. Staying null means grounding
  // was never attempted, so the sheet keeps its pre-grounding appearance —
  // distinct from an attempt that retrieved nothing ({ retrievedChunks: 0 }).
  const groundingResultRef = useRef<{ retrievedChunks: number; sources: SheetSource[] } | null>(
    null
  );
  // The section plan, delivered in a __meta frame before the model's first
  // byte so the document's shape is settled before any content arrives. Null
  // when the frame never came (an edge function predating the plan), which
  // leaves the renderer on the legacy six sections.
  const planRef = useRef<SheetSectionSpec[] | null>(null);
  // The deck, delivered in its own __meta frame at the end of the stream
  // because it is generated alongside the sheet rather than inside it.
  const flashcardsRef = useRef<Flashcard[] | null>(null);

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
  const { premiumRemaining, isPremiumHookActive, refetch: refetchPremium } = usePremiumHook();
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

  const generate = async (overrideNotes?: string) => {
    const activeNotes = overrideNotes ?? notes;
    if (!activeNotes.trim()) {
      toast({ title: "Please enter medical notes", variant: "destructive" });
      return;
    }
    if (isSheetLimited) {
      setGoProOpen(true);
      return;
    }
    recordRecentTopic(activeNotes);
    // Regenerating from the topic bar starts the new sheet at its top. From
    // the composer, the view swap does that on its own.
    if (sheet || legacyOutput) window.scrollTo({ top: 0, behavior: "smooth" });
    setActiveSettings({
      notes: activeNotes,
      examMode,
      difficulty,
      length,
      useGrounding,
      topK: groundingTopK,
      threshold: groundingThreshold,
    });
    setEditOpen(false);
    setLoading(true);
    setSheet(null);
    setLegacyOutput("");
    setDeckSaved(false);
    setStreamedKeys([]);
    setLiveKey(undefined);
    setGenerationStatus({ planned: false, sources: useGrounding ? "pending" : "off" });
    setSheetIncomplete(false);
    groundingResultRef.current = null;
    planRef.current = null;
    flashcardsRef.current = null;
    // Captured per-generation rather than read at render time: the sheet must
    // keep describing the settings it was actually built with, even if the
    // toggle is flipped afterwards.
    const groundingRequested = useGrounding;
    setGenerationId((id) => id + 1);
    setCitationState("idle");
    setCitations([]);

    // The plan is carried on the sheet itself so it is saved with it — a
    // reloaded sheet must lay out the way it did when it was generated, not
    // the way this build's default plan would.
    // The plan and the deck both ride on the sheet so they are saved with it:
    // a reloaded sheet must lay out the way it did when it was generated, and
    // keep the cards that were written for it.
    const withPlan = (s: GeneratedSheet): GeneratedSheet => ({
      ...s,
      ...(planRef.current ? { plan: planRef.current } : {}),
      ...(flashcardsRef.current ? { flashcards: flashcardsRef.current } : {}),
    });

    // Draft updates are coalesced to one render per animation frame: chunks
    // can arrive far faster than the screen repaints, and each render
    // re-lays-out the whole document. Declared out here so the error path can
    // cancel a frame that would otherwise land after it.
    let pendingPartial: PartialSheetResult | null = null;
    let frame = 0;
    const flushPartial = () => {
      frame = 0;
      const p = pendingPartial;
      pendingPartial = null;
      if (!p) return;
      setSheet(withPlan(p.sheet));
      setStreamedKeys(p.completeKeys);
      setLiveKey(p.inFlightKey);
    };

    // Sections rendered so far. The sheet arrives as one JSON object, so we
    // repair the truncated tail each chunk and reveal a section only once its
    // field has closed — see parsePartialSheet. Outside the try, so a failure
    // can tell whether anything arrived.
    let revealedCount = 0;

    try {
      const response = await callMedicalNotes({
        notes: activeNotes,
        difficulty,
        length,
        examMode,
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

      setModelUsed(parseModelUsed(response.headers));

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
            // Grounding metadata arrives as a single __meta event ahead of any
            // model bytes. It must be intercepted before the delta read below
            // so it never reaches fullText / parsePartialSheet.
            if (parsed.__meta) {
              // Three frame kinds share this envelope: the section plan and
              // the retrieval result, both ahead of any model bytes, and the
              // book/chapter labels that arrive at the end of the stream.
              // Each field is read on its own — an earlier version branched on
              // "not sourceLabels", so any second leading frame wiped the
              // retrieval result it had just recorded.
              const meta = parsed.__meta;

              if (meta.plan !== undefined) {
                planRef.current = parsePlan(meta.plan);
                setGenerationStatus((s) => ({ ...s, planned: true }));
                // Lay the document out from the plan now, before any content,
                // rather than from the legacy placeholder it would otherwise
                // show until the first section closes — and then re-lay-out.
                const plan = planRef.current;
                if (plan) setSheet((prev) => prev ?? { ...EMPTY_SHEET, plan });
              }

              // The deck, written beside the sheet rather than as its last
              // section. It arrives as the raw card text the cards mode has
              // always produced, so the same parser reads it.
              if (typeof meta.flashcards === "string") {
                flashcardsRef.current = parseFlashcardsFromOutput(
                  meta.flashcards,
                  activeNotes
                ).map((c) => ({ tag: c.tag, question: c.question, answer: c.answer }));
              }

              if (Array.isArray(meta.sourceLabels)) {
                // Only ever refines the sources the retrieval frame delivered,
                // so it merges rather than replaces — and every label is
                // validated against its own chunk before it can reach the UI
                // or a saved sheet.
                const current = groundingResultRef.current;
                if (current) {
                  groundingResultRef.current = {
                    ...current,
                    sources: applySourceLabels(current.sources, meta.sourceLabels),
                  };
                }
              } else if (meta.retrievedChunks !== undefined || meta.sources !== undefined) {
                groundingResultRef.current = {
                  retrievedChunks:
                    typeof meta.retrievedChunks === "number" ? meta.retrievedChunks : 0,
                  sources: Array.isArray(meta.sources) ? meta.sources : [],
                };
                const found = groundingResultRef.current.sources.length;
                setGenerationStatus((s) => ({ ...s, sources: found }));
              }
              continue;
            }
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              // Finished sections render in full; the one in flight renders as
              // a draft that grows word by word, at most once per frame.
              const partial = parsePartialSheet(fullText);
              if (partial && (partial.completeKeys.length > 0 || partial.inFlightKey)) {
                revealedCount = Math.max(revealedCount, partial.completeKeys.length);
                pendingPartial = partial;
                if (!frame) frame = requestAnimationFrame(flushPartial);
              }
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // A draft frame still queued would land on top of the final sheet below.
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setLiveKey(undefined);

      // Authoritative parse, degrading in steps rather than all at once: a
      // single unescaped quote from the model used to discard the whole sheet
      // and dump raw JSON at the reader.
      const rawText = fullText || "";
      const result = parseSheetOutput(rawText);
      if (result) {
        // Reconcile the model's self-reported coverage against retrieval truth.
        // Retrieval can only ever weaken the claim, never strengthen it.
        const grounding = groundingResultRef.current;
        const planned = withPlan(result.sheet);
        const groundedSheet: GeneratedSheet = grounding
          ? {
              ...planned,
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
            { ...planned, groundingLevel: "none" as const }
          : // Grounding was on but no __meta arrived (an edge function that
            // predates this feature). Leave the sheet unmarked so it renders
            // exactly as it did before, rather than claiming a false verdict.
            planned;
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
      if (frame) cancelAnimationFrame(frame);
      setLiveKey(undefined);
      // Nothing was written: back to the composer rather than an empty sheet
      // laid out from a plan that never got its content.
      if (revealedCount === 0) setSheet(null);
      setLoading(false);
      toast({
        title: "Error",
        description: e instanceof Error && e.message ? e.message : "Failed to generate study material",
        variant: "destructive",
      });
    }
  };

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
    generate(label);
  };

  /**
   * Share the sheet's text. There is no per-sheet route to link to, so this
   * shares the content itself: the native share sheet where available (mobile),
   * clipboard everywhere else.
   */
  const handleShare = async () => {
    const text = sheetToPlainText(sheet, legacyOutput, activeSettings.notes);
    if (!text.trim()) {
      toast({ title: "Nothing to share yet", variant: "destructive" });
      return;
    }

    const title = sheet?.topic?.trim() || activeSettings.notes.trim().slice(0, 60) || "Study sheet";

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
    const loaded = {
      examMode: item.modeInfo?.examMode || "General",
      difficulty: item.modeInfo?.difficulty || "Basic",
      length: item.modeInfo?.length || "Concise",
    };
    setExamMode(loaded.examMode);
    setDifficulty(loaded.difficulty);
    setLength(loaded.length);
    setNotes(item.input);
    setActiveSettings((prev) => ({ ...prev, ...loaded, notes: item.input }));
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
  };

  // ── Deck ───────────────────────────────────────────────────────────────
  // The cards written beside this sheet. A legacy text sheet carries its own.
  const deckCount = sheet?.flashcards?.length ?? 0;
  const hasDeck = deckCount > 0 || !!legacyOutput;

  /**
   * Adds this sheet's own deck to the library — the cards written beside it,
   * not a new deck.
   */
  const saveDeck = () => {
    const topic = activeSettings.notes.trim().slice(0, 60);
    try {
      if (sheet?.flashcards?.length) {
        // A sheet's cards inherit the sheet's grounding, narrowed by the
        // model's own coverage report: "full" means the library carried the
        // whole sheet, "partial" only counts when the flashcards section
        // wasn't one of the parts it missed.
        const level = resolveGroundingLevel(sheet);
        const flashcardsUncovered = sheet.sourceCoverage?.uncovered?.includes("flashcards") ?? false;
        const cardsGrounded = level === "full" || (level === "partial" && !flashcardsUncovered);
        const parsed = sheet.flashcards.map((c) => ({
          question: c.question,
          answer: c.answer,
          tag: c.tag,
          grounded: cardsGrounded,
          topic,
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
        const parsed = parseFlashcardsFromOutput(legacyOutput, activeSettings.notes);
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
  };

  const deck: SheetDeck | null = hasDeck
    ? {
        count: deckCount,
        saved: deckSaved,
        onSave: () => saveDeck(),
        onReview: () => navigate("/library"),
      }
    : null;

  /** Back to the composer, keeping the settings for the next sheet. */
  const newSheet = () => {
    if (loading) return;
    setSheet(null);
    setLegacyOutput("");
    setNotes("");
    setDeckSaved(false);
    setSheetIncomplete(false);
    setModelUsed(undefined);
    setCitationState("idle");
    setCitations([]);
    setEditOpen(false);
  };

  // Edit is a form with its own commit. Closing it any other way than
  // Regenerate puts the draft back to what the sheet on screen was made with,
  // so an abandoned edit can't leak into the next generation unseen.
  const handleEditOpenChange = (open: boolean) => {
    if (!open) {
      setNotes(activeSettings.notes);
      setExamMode(activeSettings.examMode);
      setDifficulty(activeSettings.difficulty);
      setLength(activeSettings.length);
      setUseGrounding(activeSettings.useGrounding);
      setGroundingTopK(activeSettings.topK);
      setGroundingThreshold(activeSettings.threshold);
    }
    setEditOpen(open);
  };

  // ── Settings, shared by the composer and the Edit panel ────────────────
  const settingsRow = (
    <SheetSettings
      examMode={examMode}
      onExamMode={setExamMode}
      difficulty={difficulty}
      onDifficulty={setDifficulty}
      length={length}
      onLength={setLength}
      grounding={{ on: useGrounding, topK: groundingTopK, threshold: groundingThreshold }}
      onGrounding={(next) => {
        if (next.on !== undefined) setUseGrounding(next.on);
        if (next.topK !== undefined) setGroundingTopK(next.topK);
        if (next.threshold !== undefined) setGroundingThreshold(next.threshold);
      }}
      useMemory={useMemory}
      onUseMemory={setUseMemory}
      model={
        pro
          ? {
              value: preferredModel,
              onChange: setPreferredModel,
              busy: modelSaving || modelLoading,
            }
          : undefined
      }
      disabled={loading}
    />
  );

  const goPro = () => setGoProOpen(true);
  const usageLine = pro ? (
    <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      Unlimited access active
    </p>
  ) : (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {isSheetLimited ? (
        <span className="font-medium text-warning">
          Daily limit reached ·{" "}
          <button type="button" className="underline" onClick={goPro}>
            Go Pro for Corti + unlimited
          </button>
        </span>
      ) : (
        <span>
          {sheetCount} / {MAX_DAILY_SHEETS} used today · resets at midnight
        </span>
      )}
      {isPremiumHookActive ? (
        <span className="text-info">
          {" "}
          · ✦ {premiumRemaining} Corti generation{premiumRemaining !== 1 ? "s" : ""} left ·{" "}
          <button type="button" className="underline" onClick={goPro}>
            Go Pro for unlimited Corti
          </button>
        </span>
      ) : !isSheetLimited ? (
        <span>
          {" "}
          · Free tier: GPT-OSS 20B ·{" "}
          <button type="button" className="underline hover:text-foreground" onClick={goPro}>
            Go Pro for Corti
          </button>
        </span>
      ) : null}
    </p>
  );

  // ── Reading ────────────────────────────────────────────────────────────
  const reading = loading || !!sheet || !!legacyOutput;
  const readingSheet = sheet ?? EMPTY_SHEET;
  // Until the plan (or, from an older edge function, the first section)
  // arrives there is nothing true to list or count: the placeholder sheet's
  // six legacy titles would name sections a drug or a pathway never gets.
  const planned = !!sheet;
  const sectionEntries = planned ? listSections(readingSheet, loading, streamedKeys, liveKey) : [];
  const activeSection = useActiveSection(
    sectionEntries.map((s) => s.key),
    generationId
  );
  // What the progress line counts. The deck arrives in its own frame at the
  // end, not as a section the parser reports, so it is left out.
  const progressSections = planned
    ? renderOrder(readingSheet).filter((s) => s.key !== "flashcards")
    : [];
  const activeModeInfo = {
    examMode: activeSettings.examMode,
    difficulty: activeSettings.difficulty,
    length: activeSettings.length,
  };
  const sourceCount = loading ? 0 : sheet?.sources?.length ?? 0;

  const topicActions = (
    <>
      <div className="xl:hidden">
        <SectionsMenu items={sectionEntries} activeKey={activeSection} onJump={jumpToSection} />
      </div>

      <Popover open={editOpen} onOpenChange={handleEditOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={loading}
            aria-label="Edit topic and settings"
            className={TOPIC_BAR_BUTTON}
          >
            <PenLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,460px)] p-3">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && notes.trim()) generate();
            }}
          >
            <div>
              <label
                htmlFor="sheet-edit-topic"
                className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground"
              >
                Topic or notes
              </label>
              <Textarea
                id="sheet-edit-topic"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1.5 min-h-[72px] resize-none text-sm"
              />
            </div>
            {settingsRow}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {pro
                  ? "Rewrites the sheet with these settings."
                  : "Rewrites the sheet — uses one of today's generations."}
              </p>
              <Button
                type="submit"
                size="sm"
                disabled={loading || !notes.trim()}
                className="shrink-0 gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      {/* Keyed per sheet, so a new sheet starts unsaved. */}
      <SaveButton
        key={generationId}
        input={activeSettings.notes}
        output={sheet ? JSON.stringify(sheet) : legacyOutput}
        modeInfo={activeModeInfo}
        disabled={loading}
        className={TOPIC_BAR_BUTTON}
        labelClassName="hidden sm:inline"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More actions" className={TOPIC_BAR_BUTTON}>
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={newSheet} disabled={loading}>
            <Plus className="mr-2 h-4 w-4" />
            New sheet
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={saveDeck} disabled={loading || deckSaved || !hasDeck}>
            <Layers className="mr-2 h-4 w-4" />
            {deckSaved
              ? "Deck saved to your library"
              : deckCount
              ? `Add ${deckCount} cards to my deck`
              : "Add the cards to my deck"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/qbank")}>
            <Play className="mr-2 h-4 w-4" />
            Practice QBank
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => window.print()} disabled={loading}>
            <FileDown className="mr-2 h-4 w-4" />
            Export PDF
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleShare} disabled={loading}>
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const readView = (
    <div className="mx-auto grid w-full max-w-[760px] grid-cols-1 xl:max-w-[1064px] xl:grid-cols-[minmax(0,760px)_240px] xl:gap-16">
      <div ref={docRef} className="min-w-0">
        <SheetTopicBar
          emoji={sheet?.topicEmoji}
          title={sheet?.topic?.trim() || firstLine(activeSettings.notes) || "Study sheet"}
          summary={settingsSummary(activeSettings)}
          details={sourceCount ? [`${sourceCount} source${sourceCount === 1 ? "" : "s"}`] : []}
          streaming={loading}
          progress={{
            sections: progressSections,
            readyKeys: streamedKeys,
            liveKey,
            status: generationStatus,
          }}
          readingTarget={docRef}
          actions={topicActions}
        />

        <div className="space-y-4 pt-6">
          {/* What qualifies the whole sheet is read before any of it: the
              grounding verdict, and a response that was cut short. Both
              self-hide when there is nothing to say. */}
          {!loading && sheet && (
            <GroundingNotice
              level={resolveGroundingLevel(sheet)}
              coverage={sheet.sourceCoverage}
              plan={resolvePlan(sheet)}
              onShowSources={sheet.sources?.length ? () => jumpToSection("referenceNote") : undefined}
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
          {!loading && sheetIncomplete && (
            <div className="animate-fade-in flex items-center gap-3 rounded-xl border border-border border-l-[3px] border-l-warning bg-card px-4 py-3">
              <AlertTriangle className="h-[15px] w-[15px] shrink-0 text-warning" />
              <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
                This sheet was cut short — some sections may be missing.
              </p>
              <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={() => generate()}>
                Regenerate
              </Button>
            </div>
          )}

          {/* Before the plan: neutral cards, since what the sheet will hold
              isn't known yet. Then the planned sections, laid out once and
              filled in — never added or removed. The two swap with the shared
              rise, so the titles arrive rather than replace other titles. */}
          <AnimatePresence mode="wait" initial={false}>
            {!planned && !legacyOutput ? (
              <m.div
                key="planning"
                {...RISE}
                className="space-y-4"
                aria-busy="true"
                aria-label="Planning the sheet"
              >
                {[0, 1, 2].map((i) => (
                  <SectionSkeleton key={i} variant="sheet-section" />
                ))}
              </m.div>
            ) : (
              <m.div key="sheet" {...RISE}>
                <OutputSection
                  output={sheet ? JSON.stringify(sheet) : legacyOutput || EMPTY_SHEET_JSON}
                  inputText={activeSettings.notes}
                  modeInfo={activeModeInfo}
                  citations={citations}
                  citationState={citationState}
                  modelUsed={modelUsed}
                  isPro={pro}
                  userId={user?.id ?? null}
                  isAnonymous={isAnonymous ?? false}
                  sheetId={activeSettings.notes}
                  onCitationLockedClick={() => (isLoggedIn ? setGoProOpen(true) : setAuthModalOpen(true))}
                  citationIsLoggedIn={isLoggedIn}
                  isStreaming={loading}
                  streamedKeys={streamedKeys}
                  liveKey={loading ? liveKey : undefined}
                  showHeader={false}
                  deck={deck ?? undefined}
                />
              </m.div>
            )}
          </AnimatePresence>

          {/* Where the sheet ends: what to do with it now. Rises in when the
              stream finishes, below everything, so nothing already read moves. */}
          <AnimatePresence initial={false}>
            {!loading && (sheet || legacyOutput) && (
              <SheetFinish
                key="finish"
                topic={sheet?.topic?.trim() || firstLine(activeSettings.notes) || "this sheet"}
                deck={deck}
                onPractice={() => navigate("/qbank")}
                onExport={() => window.print()}
                onShare={handleShare}
                onNewSheet={newSheet}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <aside className="hidden xl:block" aria-label="Sheet contents">
        <div className="sticky" style={{ top: "calc(var(--nav-h, 64px) + 24px)" }}>
          <SheetSectionRail items={sectionEntries} activeKey={activeSection} onJump={jumpToSection} />
        </div>
      </aside>
    </div>
  );

  const composeView = (
    <SheetComposer
      notes={notes}
      onNotesChange={setNotes}
      onGenerate={(topic) => (topic ? startTopic(topic) : generate())}
      loading={loading}
      settings={settingsRow}
      usage={usageLine}
      showSignIn={!isLoggedIn}
      onSignIn={() => setAuthModalOpen(true)}
      recentTopics={recentTopics}
      onOpenSaved={loadHistoryItem}
    />
  );

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        {/* One page, two modes. Composing and reading swap with the shared
            rise; "wait" lets the outgoing view leave before the next arrives,
            so the two never overlap and the scroll reset is never seen. */}
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={reading ? "read" : "compose"} {...RISE}>
            <ScrollToTopOnMount />
            {reading ? readView : composeView}
          </m.div>
        </AnimatePresence>

        <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
        <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
      </MotionConfig>
    </LazyMotion>
  );
};

export default SheetGenerator;
