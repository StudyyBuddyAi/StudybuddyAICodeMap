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
  GitBranch,
  Layers,
  Loader2,
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
import SheetPreparation from "@/components/sheet/SheetPreparation";
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
import { modelUsedFrom, parseModelUsed, type ModelUsed } from "@/lib/model-used";
import { groupSources } from "@/lib/source-display";
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
import { parsePlan, renderOrder, resolvePlan, sectionBody } from "@/lib/sheet-plan";
import type { SheetSectionSpec } from "@/types/generated-sheet";
import { applySourceLabels } from "@/lib/source-labels";
import { fetchBestCitation, type CitationResult } from "@/lib/citation";
import { getCitationsForTopic } from "@/lib/citation-store";
import AuthModal from "@/components/AuthModal";
import GoProModal from "@/components/GoProModal";
import type { StudyHistoryItem } from "@/hooks/use-study-history";
import { useMemoryPreference } from "@/hooks/use-memory-preference";
import { sheetToPlainText } from "@/lib/sheet-to-text";
import { ENTER, FOLD, RISE } from "@/lib/motion";
import { useStudyHistory } from "@/hooks/use-study-history";
import { useSheetLayer } from "@/hooks/use-sheet-layer";
import {
  anchoredTo,
  applyLayer,
  isEmptyLayer,
  layerBranchesText,
  layerNotesText,
  removeLayerSection,
  rewriteSection,
  withLayerSections,
  type SheetLayer,
} from "@/lib/sheet-layer";
import {
  DEPTH_LABEL,
  REGEN_CHOICES,
  SectionOutdatedError,
  SectionQuotaError,
  depthOf,
  hasBody,
  runSectionRequest,
  type Depth,
  type RegenStyle,
  type SectionRequestParams,
} from "@/lib/sheet-depth";
import type { SectionJob } from "@/components/sheet/SectionDepth";
import type { RewriteControls } from "@/components/OutputSection";
import { useSheetBranches } from "@/hooks/use-sheet-branches";
import { BranchPanel } from "@/components/sheet/branches/BranchPanel";
import type { SectionBody } from "@/types/generated-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PersonalProps } from "@/components/sheet/personal/personal-context";
import { useBackdropScene } from "@/components/backdrop/backdrop-scene";

export interface SheetGeneratorPrefill {
  input: string;
  output: string;
  modeInfo?: StudyHistoryItem["modeInfo"];
  /** Set when the prefill is a saved sheet, so its personal layer loads with it. */
  id?: string;
}

/** A QBank set's topic line: the sheet's topic, and what the student marked. */
const qbankTopic = (topic: string, focus = "") =>
  (focus ? `${topic} — focus on: ${focus}` : topic).slice(0, 300);

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
  depth: Depth;
  useGrounding: boolean;
  topK: number;
  threshold: number;
}

const EXAM_LABELS: Record<string, string> = {
  "USMLE Step 1": "Step 1",
  "USMLE Step 2": "Step 2",
};

const settingsSummary = (s: SheetSettingsSnapshot) =>
  [EXAM_LABELS[s.examMode] ?? s.examMode, s.difficulty, DEPTH_LABEL[s.depth]].join(" · ");

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
  // Saved sheets from before depth carry a length; only Detailed reads as comprehensive.
  const [depth, setDepth] = useState<Depth>(depthOf(prefill?.modeInfo?.length));
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
    depth: depthOf(prefill?.modeInfo?.length),
    useGrounding: true,
    topK: 8,
    threshold: 0.6,
  }));

  // What is running on each section — a rewrite — and the drafts arriving.
  const [sectionJobs, setSectionJobs] = useState<Record<string, SectionJob>>({});
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, SectionBody>>({});
  const sectionAborts = useRef(new Map<string, AbortController>());
  // A rewrite that would take the student's highlights and notes with it, waiting on a yes.
  const [pendingRewrite, setPendingRewrite] = useState<{
    key: string;
    style: RegenStyle;
    instruction?: string;
    anchored: number;
  } | null>(null);
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
  // Whether the premium writer wrote this sheet (X-Is-Premium), and the grant
  // the server recorded for it when the student has no Pro. Both ride on the
  // sheet: a premium sheet is personalizable like a Pro one.
  const premiumRef = useRef<{ premium: boolean; grant?: string }>({ premium: false });

  // The saved row the sheet on screen is, once it is one: opened from
  // history, saved with Save, or saved on the student's first personal touch.
  // Its personal layer is keyed by it.
  const [savedSheetId, setSavedSheetId] = useState<string | null>(prefill?.id ?? null);

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
  const { saveItem } = useStudyHistory();
  const layerState = useSheetLayer(generationId, savedSheetId);

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
      depth,
      useGrounding,
      topK: groundingTopK,
      threshold: groundingThreshold,
    });
    setEditOpen(false);
    setLoading(true);
    resetSectionState();
    setSheet(null);
    setLegacyOutput("");
    setDeckSaved(false);
    setStreamedKeys([]);
    setLiveKey(undefined);
    setGenerationStatus({ planned: false, sources: useGrounding ? "pending" : "off" });
    setSheetIncomplete(false);
    setSavedSheetId(null);
    groundingResultRef.current = null;
    planRef.current = null;
    flashcardsRef.current = null;
    premiumRef.current = { premium: false };
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
    // keep the cards that were written for it. A comprehensive sheet is written
    // like a high-yield one; its branches are grown once it has streamed.
    const requestedDepth = depth;

    const withPlan = (s: GeneratedSheet): GeneratedSheet => ({
      ...s,
      ...(planRef.current ? { plan: planRef.current } : {}),
      ...(flashcardsRef.current ? { flashcards: flashcardsRef.current } : {}),
      ...(premiumRef.current.premium ? { premium: true } : {}),
      ...(premiumRef.current.grant ? { premiumGrant: premiumRef.current.grant } : {}),
      depth: requestedDepth,
    });

    // Draft updates are coalesced to one render per animation frame: chunks
    // can arrive far faster than the screen repaints, and each render
    // re-lays-out the whole document. Declared out here so the error path can
    // cancel a frame that would otherwise land after it.
    let pendingPartial: PartialSheetResult | null = null;
    let lastCore: PartialSheetResult | null = null;
    let frame = 0;
    const flushPartial = () => {
      frame = 0;
      const p = pendingPartial ?? lastCore;
      pendingPartial = null;
      if (!p) return;
      lastCore = p;
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
        depth,
        // For an edge function from before depth, which reads only a length.
        length: depth === "comprehensive" ? "Detailed" : "Concise",
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
      premiumRef.current.premium = response.headers.get("x-is-premium") === "true";

      // Usage was incremented server-side; refresh the displayed counts.
      refreshUsage();
      refetchPremium();

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let textBuffer = "";
      let fullText = "";

      // A failure the server reports after the stream has opened — it can no
      // longer say so with a status code. Ends the generation like any error.
      let streamError: string | null = null;

      while (!streamError) {
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

              if (typeof meta.error === "string") {
                streamError = meta.error;
                break;
              }

              // Which model is writing: a frame rather than a header, since a
              // sheet's stream opens before the writer is chosen.
              if (meta.model && typeof meta.model.used === "string") {
                setModelUsed(modelUsedFrom(meta.model.used, meta.model.fallback === true));
                setGenerationStatus((s) => ({ ...s, writing: true }));
              }
              if (meta.stage === "thinking") {
                setGenerationStatus((s) => ({ ...s, thinking: true }));
              }
              // Proof, for the AI actions later, that this premium sheet may
              // be personalized without Pro.
              if (typeof meta.premiumGrant === "string") {
                premiumRef.current.grant = meta.premiumGrant;
              }

              if (meta.plan !== undefined) {
                planRef.current = parsePlan(meta.plan);
                setGenerationStatus((s) => ({
                  ...s,
                  planned: true,
                  archetype: typeof meta.archetype === "string" ? meta.archetype : s.archetype,
                }));
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
                const books = groupSources(groundingResultRef.current.sources).map((b) => b.title);
                setGenerationStatus((s) => ({ ...s, sources: found, books }));
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

      if (streamError) {
        reader.cancel().catch(() => {});
        throw new Error(streamError);
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
        const planned: GeneratedSheet = withPlan(result.sheet);
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
    // The sheet as the student has made it: their edits and points in place,
    // what they removed gone, their notes and branches at the end.
    const layer = layerState.layer;
    const mine = sheet && !isEmptyLayer(layer);
    const text = sheetToPlainText(
      mine ? applyLayer(sheet, layer) : sheet,
      legacyOutput,
      activeSettings.notes,
      mine ? [layerNotesText(sheet, layer), layerBranchesText(sheet, layer)] : []
    );
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
    const stored = isJsonSheet(item.output) ? parseStoredSheet(item.output) : null;
    const loaded = {
      examMode: item.modeInfo?.examMode || "General",
      difficulty: item.modeInfo?.difficulty || "Basic",
      depth: stored?.depth ?? depthOf(item.modeInfo?.length),
    };
    setExamMode(loaded.examMode);
    setDifficulty(loaded.difficulty);
    setDepth(loaded.depth);
    resetSectionState();
    setNotes(item.input);
    setActiveSettings((prev) => ({ ...prev, ...loaded, notes: item.input }));
    setDeckSaved(false);
    setSheetIncomplete(false);
    setSavedSheetId(item.id);
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

  // ── The student's own layer ────────────────────────────────────────────
  // Pro, or a sheet the premium writer wrote: the free premium generation is
  // the Pro experience, whatever the student's plan.
  const entitled = pro || sheet?.premium === true;
  const sheetTopic = sheet?.topic?.trim() || firstLine(activeSettings.notes) || "this topic";

  // The sheet saves itself on the first personal touch — a layer needs a row
  // to belong to — and only once, however fast the touches come.
  const savingRef = useRef<Promise<string> | null>(null);
  const ensureSaved = () => {
    if (savedSheetId || !sheet) return;
    savingRef.current ??= saveItem(activeSettings.notes, JSON.stringify(sheet), {
      examMode: activeSettings.examMode,
      difficulty: activeSettings.difficulty,
      // study_history.length is free text: it now holds the depth.
      length: activeSettings.depth,
    })
      .then((id) => {
        setSavedSheetId(id);
        return id;
      })
      .catch((e) => {
        toast({
          title: "Couldn't save this sheet",
          description: "Your changes will stay until you leave the page.",
          variant: "destructive",
        });
        throw e;
      })
      .finally(() => {
        savingRef.current = null;
      });
    savingRef.current.catch(() => {});
  };

  const updateLayer = (fn: (layer: SheetLayer) => SheetLayer) => {
    layerState.update(fn);
    ensureSaved();
  };

  /** A card made from the sheet, straight into this sheet's deck. */
  const addPersonalCard = async (card: { question: string; answer: string }) => {
    try {
      await saveCards([
        {
          question: card.question,
          answer: card.answer,
          tag: "Mine",
          grounded: false,
          topic: activeSettings.notes.trim().slice(0, 60),
          topicEmoji: sheet?.topicEmoji,
        },
      ]);
      toast({ title: "Card added to your deck" });
      return true;
    } catch {
      return false;
    }
  };

  /** A QBank set on this sheet, focused on what the student marked. */
  const practiceInQBank = (focus = "") => navigate("/qbank", { state: { topic: qbankTopic(sheetTopic, focus) } });

  // ── Rewrites, one section at a time ───────────────────────────────────
  /** Every rewrite stops. */
  function resetSectionState() {
    for (const c of sectionAborts.current.values()) c.abort();
    sectionAborts.current.clear();
    setSectionJobs({});
    setSectionDrafts({});
  }

  /** The sheet as the student has it: their rewrites in place. */
  const studentSheet = sheet ? withLayerSections(sheet, layerState.layer) : null;
  const sheetKeys = sheet ? resolvePlan(sheet).map((s) => s.key) : [];
  // Rewrites and branches need the finished sheet and its loaded layer, which they write to.
  const sectionsReady = !!sheet && !legacyOutput && !loading && layerState.status === "ready";

  const sectionParams = (
    p: Pick<SectionRequestParams, "action" | "key" | "style" | "instruction">
  ): SectionRequestParams => ({
    ...p,
    plan: sheetKeys,
    sections: (studentSheet?.sections ?? {}) as Record<string, SectionBody>,
    topic: sheetTopic.slice(0, 120),
    sourceIds: (sheet?.sources ?? []).map((s) => s.id),
    grant: sheet?.premiumGrant,
    examMode: activeSettings.examMode,
    difficulty: activeSettings.difficulty,
  });

  /**
   * Runs one rewrite under `key`, its draft landing as it arrives, and hands
   * the finished bodies to `done`. Tells the student when today's requests
   * are used up; the section stays as it was otherwise.
   */
  const runSection = async (
    key: string,
    job: SectionJob,
    params: SectionRequestParams,
    done: (sections: Record<string, SectionBody>) => void
  ) => {
    const controller = new AbortController();
    sectionAborts.current.get(key)?.abort();
    sectionAborts.current.set(key, controller);
    const setJob = (next: SectionJob | null) =>
      setSectionJobs((all) => {
        const out = { ...all };
        if (next) out[key] = next;
        else delete out[key];
        return out;
      });
    setJob(job);
    try {
      const result = await runSectionRequest(params, {
        signal: controller.signal,
        onDraft: (d) => setSectionDrafts((all) => ({ ...all, ...d.sections })),
      });
      done(result.sections);
      setJob(null);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setJob(null);
      if (e instanceof SectionQuotaError) {
        setGoProOpen(true);
        toast({ title: "You've used today's section rewrites", description: "They reset at midnight UTC. Pro is unlimited." });
      } else if (e instanceof SectionOutdatedError) {
        toast({ title: "This needs the latest StudyBuddy", description: "Section rewrites aren't live on the server yet.", variant: "destructive" });
      } else {
        toast({ title: "Couldn't rewrite this section", description: "It's as it was. Try again from its menu.", variant: "destructive" });
      }
    } finally {
      setSectionDrafts((all) => {
        const out = { ...all };
        delete out[key];
        return out;
      });
      if (sectionAborts.current.get(key) === controller) sectionAborts.current.delete(key);
    }
  };

  /** A section rewritten in a direction. */
  const doRewrite = (key: string, style: RegenStyle, instruction?: string) => {
    const label = style === "custom" ? "your way" : REGEN_CHOICES.find((c) => c.style === style)?.label.toLowerCase();
    void runSection(
      key,
      { action: "regenerate", status: "running", label },
      sectionParams({ action: "regenerate", key, style, instruction }),
      (sections) => {
        if (hasBody(sections[key])) updateLayer((l) => rewriteSection(l, { [key]: sections[key] }, style));
      }
    );
  };

  /** Asks first when the rewrite would take the student's own marks with it. */
  const rewriteSectionRequest = (key: string, style: RegenStyle, instruction?: string) => {
    if (!sectionsReady) return;
    const anchored = anchoredTo(layerState.layer, [key]);
    if (anchored > 0) setPendingRewrite({ key, style, instruction, anchored });
    else doRewrite(key, style, instruction);
  };

  const rewriteControls: RewriteControls | undefined =
    sheet && !legacyOutput
      ? {
          rewrite: rewriteSectionRequest,
          undoRewrite: (key) => updateLayer((l) => removeLayerSection(l, [key].filter((k) => l.sections[k]?.kind === "rewrite"))),
          jobs: sectionJobs,
          drafts: sectionDrafts,
          enabled: sectionsReady,
        }
      : undefined;

  // ── Branches ───────────────────────────────────────────────────────────
  // What the sheet suggests growing, and what the student grows. A
  // comprehensive sheet grows its first picks as soon as they are suggested.
  const branches = useSheetBranches({
    sheet: studentSheet && !legacyOutput ? studentSheet : null,
    sheetKey: generationId,
    ready: sectionsReady,
    comprehensive: activeSettings.depth === "comprehensive",
    layer: layerState.layer,
    update: layerState.update,
    touch: updateLayer,
    context: {
      topic: sheetTopic,
      examMode: activeSettings.examMode,
      difficulty: activeSettings.difficulty,
      sourceIds: (sheet?.sources ?? []).map((s) => s.id),
    },
    onQuota: () => {
      setGoProOpen(true);
      toast({ title: "You've grown today's branches", description: "They reset at midnight UTC. Pro is unlimited." });
    },
    onOutdated: () =>
      toast({ title: "Branches aren't live yet", description: "StudyBuddy is being updated. Try again later.", variant: "destructive" }),
  });
  const branchCount = branches.branches.length;
  const branchesBusy = branches.suggesting || Object.values(branches.growing).some((g) => g.status === "growing");
  const panelOpen = branches.panel !== null;
  const toggleBranches = () => (branches.panel === "all" ? branches.close() : branches.openAll());

  const personal: PersonalProps | undefined =
    sheet && !legacyOutput
      ? {
          layer: layerState.layer,
          entitled,
          ready: layerState.status === "ready" && !loading,
          unsaved: layerState.unsaved,
          saveFailed: layerState.saveFailed,
          update: updateLayer,
          onLocked: () => setGoProOpen(true),
          context: {
            topic: sheetTopic,
            examMode: activeSettings.examMode,
            difficulty: activeSettings.difficulty,
            grant: sheet.premiumGrant,
          },
          onAddCard: addPersonalCard,
          onPractice: practiceInQBank,
        }
      : undefined;

  /** Back to the composer, keeping the settings for the next sheet. */
  const newSheet = () => {
    if (loading) return;
    resetSectionState();
    setSheet(null);
    setLegacyOutput("");
    setNotes("");
    setDeckSaved(false);
    setSheetIncomplete(false);
    setSavedSheetId(null);
    setGenerationId((id) => id + 1);
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
      setDepth(activeSettings.depth);
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
      depth={depth}
      onDepth={setDepth}
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
  // Generating, with nothing written yet: the wait the loading tips fill. The
  // model's first tokens name a key (the emoji, the topic) before any section
  // text, so this ends the moment it starts writing.
  const waitingForContent = loading && !liveKey && streamedKeys.length === 0;
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
    length: activeSettings.depth,
  };
  const sourceCount = loading ? 0 : sheet?.sources?.length ?? 0;

  // The Edit panel changed nothing but the depth, upwards.
  const onlyDeeper =
    !!sheet &&
    !legacyOutput &&
    depth === "comprehensive" &&
    activeSettings.depth === "highYield" &&
    notes === activeSettings.notes &&
    examMode === activeSettings.examMode &&
    difficulty === activeSettings.difficulty;

  const topicActions = (
    <>
      <div className="xl:hidden">
        <SectionsMenu items={sectionEntries} activeKey={activeSection} onJump={jumpToSection} />
      </div>

      {/* The sheet's branches. On a phone the title needs the room: they move into the menu below. */}
      {sheet && !legacyOutput && (
        <button
          type="button"
          onClick={toggleBranches}
          disabled={loading}
          aria-pressed={branches.panel === "all"}
          aria-label={`Branches${branchCount ? ` (${branchCount})` : ""}`}
          className={`${TOPIC_BAR_BUTTON} hidden sm:inline-flex${branches.panel === "all" ? " bg-secondary text-foreground" : ""}`}
        >
          {branchesBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-info" /> : <GitBranch className="h-3.5 w-3.5 text-info" />}
          <span>Branches</span>
          {branchCount > 0 && (
            <span className="rounded-full bg-info-soft px-1.5 py-0.5 font-mono text-[10px] leading-none text-info">{branchCount}</span>
          )}
        </button>
      )}

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
              if (loading || !notes.trim()) return;
              // Only the depth went up: grow this sheet's top branches rather
              // than write a new one, which would spend a sheet and drop the
              // student's layer.
              if (onlyDeeper) {
                setEditOpen(false);
                setActiveSettings((s) => ({ ...s, depth }));
                branches.growPicks();
                branches.openAll();
                return;
              }
              generate();
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
                {onlyDeeper
                  ? "Grows this sheet's top branches — your highlights and notes stay."
                  : pro
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
                {onlyDeeper ? "Grow branches" : "Regenerate"}
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
        savedId={savedSheetId}
        onSaved={setSavedSheetId}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More actions" className={TOPIC_BAR_BUTTON}>
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {sheet && !legacyOutput && (
            <>
              <DropdownMenuItem className="sm:hidden" disabled={loading} onSelect={branches.openAll}>
                <GitBranch className="mr-2 h-4 w-4" />
                Branches{branchCount ? ` · ${branchCount}` : ""}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="sm:hidden" />
            </>
          )}
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
          <DropdownMenuItem onSelect={() => practiceInQBank()}>
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

  // With the branch panel open on a wide screen, the sheet moves over to sit
  // beside it — the line a branch grew from stays in view — and the contents
  // rail gives up its column.
  const readView = (
    <div className={`transition-[padding] duration-300 ${panelOpen ? "lg:pr-[400px] xl:pr-[440px]" : ""}`}>
    <div
      className={`mx-auto grid w-full max-w-[760px] grid-cols-1 ${
        panelOpen ? "" : "xl:max-w-[1064px] xl:grid-cols-[minmax(0,760px)_240px] xl:gap-16"
      }`}
    >
      <div ref={docRef} className="min-w-0">
        <SheetTopicBar
          emoji={sheet?.topicEmoji}
          title={sheet?.topic?.trim() || firstLine(activeSettings.notes) || "Study sheet"}
          summary={settingsSummary(activeSettings)}
          details={sourceCount ? [`${sourceCount} source${sourceCount === 1 ? "" : "s"}`] : []}
          streaming={loading}
          preparing={waitingForContent}
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

          {/* One box for the preparation card and the sections, outside the
              spacing around it. The only gap between them is the first
              section's own top margin, which stays put as the card folds —
              so the sections glide up with it instead of snapping at the end. */}
          <div>
            {/* While the sheet is prepared, its first card says what is happening
                and asks one question about the topic. It sits in the document's
                flow, where the sections will be, and folds away — the sections
                below gliding up — the moment the first words arrive. */}
            <AnimatePresence initial={false}>
              {waitingForContent && !legacyOutput && (
                <m.div
                  key="preparing"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto", transition: { ...FOLD, opacity: ENTER } }}
                  exit={{ opacity: 0, height: 0, transition: FOLD }}
                  style={{ overflow: "hidden" }}
                >
                  <SheetPreparation
                    input={activeSettings.notes}
                    status={generationStatus}
                    plan={planned ? resolvePlan(readingSheet) : null}
                    model={modelUsed}
                  />
                </m.div>
              )}
            </AnimatePresence>

            {/* The planned sections, laid out once and filled in — never added or
                removed. They rise in when the plan arrives. */}
            {(planned || legacyOutput) && (
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
                  personal={personal}
                  rewrites={rewriteControls}
                  branches={sheet && !legacyOutput ? branches : undefined}
                />
              </m.div>
            )}
          </div>

          {/* Where the sheet ends: what to do with it now. Rises in when the
              stream finishes, below everything, so nothing already read moves. */}
          <AnimatePresence initial={false}>
            {!loading && (sheet || legacyOutput) && (
              <SheetFinish
                key="finish"
                topic={sheet?.topic?.trim() || firstLine(activeSettings.notes) || "this sheet"}
                deck={deck}
                onPractice={() => practiceInQBank()}
                onExport={() => window.print()}
                onShare={handleShare}
                onNewSheet={newSheet}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {!panelOpen && (
        <aside className="hidden xl:block" aria-label="Sheet contents">
          <div className="sticky" style={{ top: "calc(var(--nav-h, 64px) + 24px)" }}>
            <SheetSectionRail items={sectionEntries} activeKey={activeSection} onJump={jumpToSection} />
          </div>
        </aside>
      )}
    </div>
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

  // The app backdrop, told what this page is doing: the molecule has the
  // margin while a sheet is started, forms as it is written, and waits beside
  // it while it is read — in this topic's own fold.
  useBackdropScene({
    mode: loading ? "generating" : reading ? "reading" : "compose",
    // A comprehensive sheet's depth keys stream too; the core sets the pace.
    progress: progressSections.length
      ? Math.min(1, progressSections.filter((s) => streamedKeys.includes(s.key)).length / progressSections.length)
      : 0,
    seed: reading ? sheetTopic : "",
  });

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

        {reading && sheet && !legacyOutput && <BranchPanel api={branches} />}

        <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
        <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
        <AlertDialog open={!!pendingRewrite} onOpenChange={(open) => !open && setPendingRewrite(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rewrite this section?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingRewrite?.anchored === 1
                  ? "Your highlight, note or edit on this section points at lines that will be replaced, so it will go."
                  : `Your ${pendingRewrite?.anchored} highlights, notes and edits on this section point at lines that will be replaced, so they will go.`}{" "}
                You can go back to the original section from its menu.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingRewrite) doRewrite(pendingRewrite.key, pendingRewrite.style, pendingRewrite.instruction);
                  setPendingRewrite(null);
                }}
              >
                Rewrite
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </MotionConfig>
    </LazyMotion>
  );
};

export default SheetGenerator;
