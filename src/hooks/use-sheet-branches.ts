import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BranchOutdatedError,
  BranchQuotaError,
  MAX_BRANCH_DEPTH,
  comprehensivePicks,
  plainText,
  readBranch,
  readSuggestions,
  runBranchRequest,
  type AnchoredQuestion,
  type BranchQuestion,
  type BranchSheet,
} from "@/lib/sheet-branches";
import {
  addBranch,
  anchorSection,
  branchPath,
  editBranch,
  markPicksGrown,
  newLayerId,
  originalLine,
  removeBranch,
  setPills,
  type LayerBranch,
  type LayerPill,
  type SheetLayer,
} from "@/lib/sheet-layer";
import { resolvePlan } from "@/lib/sheet-plan";
import type { GeneratedSheet, SectionBody } from "@/types/generated-sheet";

/**
 * A sheet's branches, as the page runs them: asking the sheet what to grow,
 * growing what the student picks (or, for a comprehensive sheet, its first
 * picks), and the panel that shows one branch or all of them.
 *
 * What a branch says lives in the student's layer (sheet-layer.ts). A branch
 * still being written lives here, and its words in a small store outside
 * React state: a comprehensive sheet grows several at once, and re-rendering
 * the whole sheet on every word of each would make it crawl. Only the panel
 * reads the words as they arrive.
 */

/** At most this many branches are written at once. */
const CONCURRENCY = 4;

export type BranchPanelView = "branch" | "all" | "line";

/** A branch being written, or one that failed to be. */
export interface GrowingBranch {
  id: string;
  anchor: string;
  parentId?: string;
  question: BranchQuestion;
  pillId?: string;
  status: "growing" | "error";
  /** Writing again a branch the layer already has. */
  replaces?: boolean;
}

// ── The words of the branches being written ──────────────────────────────────

type Listener = () => void;

function createDraftStore() {
  const drafts = new Map<string, string>();
  const listeners = new Set<Listener>();
  return {
    get: (id: string) => drafts.get(id) ?? "",
    set(id: string, text: string) {
      drafts.set(id, text);
      listeners.forEach((l) => l());
    },
    delete(id: string) {
      if (drafts.delete(id)) listeners.forEach((l) => l());
    },
    clear() {
      drafts.clear();
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;

/** The words of a branch being written, as they arrive. */
export function useBranchDraft(store: DraftStore, id: string | null): string {
  return useSyncExternalStore(
    store.subscribe,
    () => (id ? store.get(id) : ""),
    () => ""
  );
}

// ── The page's branches ──────────────────────────────────────────────────────

export interface BranchesApi {
  /** Branches can be grown: the sheet is finished and its layer loaded. */
  enabled: boolean;
  readOnly: boolean;
  /** The sheet's suggestions — those still streaming, or the layer's. */
  pills: LayerPill[];
  /** The suggestion being written: its place held on its line, under the id it will have. */
  pendingPill: { id: string; anchor: string } | null;
  branches: LayerBranch[];
  growing: Record<string, GrowingBranch>;
  drafts: DraftStore;
  suggesting: boolean;
  suggestFailed: boolean;
  /** The branch open in the panel. */
  openId: string | null;
  /** The line the panel is branching from, in its "line" view. */
  lineAnchor: string | null;
  /** What the panel shows: one branch, every branch, or one line's branches and how to grow more. */
  panel: BranchPanelView | null;
  open: (id: string) => void;
  openAll: () => void;
  openLine: (anchor: string) => void;
  close: () => void;
  /** Grows a suggestion, and opens it. */
  growPill: (pill: LayerPill) => void;
  /** Grows one of a branch's own suggestions. */
  growNext: (parentId: string, q: BranchQuestion) => void;
  /** Grows the answer to the student's own question, about a line or a branch. */
  ask: (target: { anchor: string; parentId?: string }, question: string) => void;
  /** The student's own branch, written by hand. */
  write: (target: { anchor: string; parentId?: string }, label: string, text: string) => void;
  regrow: (id: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  /** A branch that failed: try again, or give up on it. */
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  suggest: () => void;
  /** Grows a comprehensive sheet's first picks — the sheet turned comprehensive in place. */
  growPicks: () => void;
  /** There are picks a comprehensive sheet would grow that are not grown. */
  picksPending: boolean;
  /** Whether a branch can grow more branches (depth). */
  canBranch: (id: string) => boolean;
  /** The line an anchor names, as the sheet has it. */
  lineOf: (anchor: string) => string;
  sectionTitleOf: (anchor: string) => string;
  /** The section keys in reading order, for the list of every branch. */
  sectionOrder: string[];
  pathOf: (id: string) => LayerBranch[];
}

export interface UseSheetBranchesOptions {
  /** The sheet as the student has it (their rewrites in place); null before there is one. */
  sheet: GeneratedSheet | null;
  /** Changes whenever a different sheet is on the page. */
  sheetKey: string | number;
  /** The sheet is finished and its layer loaded. */
  ready: boolean;
  readOnly?: boolean;
  /** Grow the first picks as soon as the suggestions arrive. */
  comprehensive: boolean;
  layer: SheetLayer;
  /** A change the student didn't make by hand: the sheet is not saved for it. */
  update: (fn: (layer: SheetLayer) => SheetLayer) => void;
  /** A change the student made: saves the sheet, if it is not yet. */
  touch: (fn: (layer: SheetLayer) => SheetLayer) => void;
  context: { topic: string; examMode?: string; difficulty?: string; sourceIds: string[] };
  /** Today's branches are used up. */
  onQuota: () => void;
  onOutdated?: () => void;
}

export function useSheetBranches(o: UseSheetBranchesOptions): BranchesApi {
  const { sheet, ready, layer, update, touch, context } = o;
  const readOnly = !!o.readOnly;
  const enabled = ready && !readOnly && !!sheet;

  const [growing, setGrowing] = useState<Record<string, GrowingBranch>>({});
  const [streamed, setStreamed] = useState<{ pills: LayerPill[]; pending: { id: string; anchor: string } | null } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestFailed, setSuggestFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<BranchPanelView | null>(null);
  const [lineAnchor, setLineAnchor] = useState<string | null>(null);
  const drafts = useMemo(createDraftStore, []);

  // What async work reads: the latest of everything, not what it closed over.
  const live = useRef({ o, layer });
  live.current = { o, layer };
  const aborts = useRef(new Map<string, AbortController>());
  const queue = useRef<(() => Promise<void>)[]>([]);
  const running = useRef(0);
  const suggestAbort = useRef<AbortController | null>(null);

  // ── The sheet, as a request carries it ────────────────────────────────────
  const plan = useMemo(() => (sheet ? resolvePlan(sheet) : []), [sheet]);
  const sectionOrder = useMemo(() => plan.map((s) => s.key), [plan]);
  const titles = useMemo(() => new Map(plan.map((s) => [s.key, s.title])), [plan]);

  const requestSheet = useCallback((): BranchSheet | null => {
    const s = live.current.o.sheet;
    if (!s) return null;
    const keys = resolvePlan(s).map((p) => p.key);
    const sections: Record<string, SectionBody> = {};
    for (const k of keys) {
      const body = s.sections?.[k] ?? (s as unknown as Record<string, SectionBody | undefined>)[k];
      if (body !== undefined) sections[k] = body;
    }
    const c = live.current.o.context;
    return {
      plan: keys,
      sections,
      topic: c.topic.slice(0, 120),
      sourceIds: c.sourceIds,
      examMode: c.examMode,
      difficulty: c.difficulty,
    };
  }, []);

  const lineOf = useCallback(
    (anchor: string) => {
      const s = live.current.o.sheet;
      if (anchor.endsWith(":end")) return titles.get(anchorSection(anchor)) ?? "";
      return (s && originalLine(s, anchor)) || "";
    },
    [titles]
  );
  const sectionTitleOf = useCallback((anchor: string) => titles.get(anchorSection(anchor)) ?? "", [titles]);

  // ── Running requests, a few at a time ─────────────────────────────────────
  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const job = queue.current.shift()!;
      running.current++;
      void job().finally(() => {
        running.current--;
        pump();
      });
    }
  }, []);

  const finish = useCallback(
    (id: string) => {
      aborts.current.delete(id);
      drafts.delete(id);
      setGrowing((g) => {
        const next = { ...g };
        delete next[id];
        return next;
      });
    },
    [drafts]
  );

  /** Grows one branch: queued, streamed into the draft store, kept in the layer when done. */
  const start = useCallback(
    (g: GrowingBranch) => {
      aborts.current.get(g.id)?.abort();
      const controller = new AbortController();
      aborts.current.set(g.id, controller);
      drafts.set(g.id, "");
      setGrowing((all) => ({ ...all, [g.id]: g }));

      queue.current.push(async () => {
        if (controller.signal.aborted) return;
        const s = requestSheet();
        if (!s) return finish(g.id);
        const { layer: l } = live.current;
        // What it hangs from: a regrown branch's own path; a new one's parent and the parent's path.
        const parent = g.parentId ? l.branches.find((b) => b.id === g.parentId) : undefined;
        const ancestors = g.replaces ? branchPath(l, g.id) : parent ? [...branchPath(l, parent.id), parent] : [];
        const others = [
          ...l.pills.map((p) => ({ label: p.label, ask: p.ask })),
          ...l.branches.filter((b) => b.id !== g.id).map((b) => ({ label: b.label, ask: b.ask })),
        ]
          .filter((x) => x.label !== g.question.label)
          .slice(0, 40);
        const ctx = { topic: s.topic, versus: g.question.versus };
        try {
          const text = await runBranchRequest(
            s,
            {
              action: "grow",
              anchor: g.anchor,
              quote: lineOf(g.anchor),
              question: g.question,
              path: ancestors.map((b) => ({ label: b.label, text: plainText(b.text).slice(0, 2000) })),
              others,
            },
            {
              signal: controller.signal,
              onText: (t) => drafts.set(g.id, readBranch(t, g.question.type, ctx).markdown),
            }
          );
          const reply = readBranch(text, g.question.type, ctx);
          if (!reply.markdown.trim()) throw new Error("empty branch");
          const prior = live.current.layer.branches.find((b) => b.id === g.id);
          live.current.o.update((layerNow) =>
            addBranch(layerNow, {
              id: g.id,
              anchor: prior?.anchor ?? g.anchor,
              ...(g.parentId ? { parentId: g.parentId } : {}),
              ...g.question,
              text: reply.markdown,
              next: reply.next,
              source: "ai",
              ...(reply.covered !== null ? { covered: reply.covered } : {}),
              ...(g.pillId ? { pillId: g.pillId } : {}),
            })
          );
          finish(g.id);
        } catch (e: unknown) {
          if (e instanceof Error && e.name === "AbortError") return finish(g.id);
          if (e instanceof BranchQuotaError) {
            finish(g.id);
            live.current.o.onQuota();
            return;
          }
          if (e instanceof BranchOutdatedError) live.current.o.onOutdated?.();
          drafts.delete(g.id);
          setGrowing((all) => (all[g.id] ? { ...all, [g.id]: { ...all[g.id], status: "error" } } : all));
        }
      });
      pump();
    },
    [drafts, finish, lineOf, pump, requestSheet]
  );

  // ── The suggestions ───────────────────────────────────────────────────────
  const growingRef = useRef(growing);
  growingRef.current = growing;

  /**
   * Grows a comprehensive sheet's picks among `pills` — ranked over all of
   * them — except those grown, being grown, or in `skip`.
   */
  const growPickList = useCallback(
    (pills: LayerPill[], skip: ReadonlySet<string> = new Set()) => {
      const s = live.current.o.sheet;
      if (!s) return;
      const { layer: l } = live.current;
      const grown = new Set([...l.branches.map((b) => b.pillId), ...Object.values(growingRef.current).map((g) => g.pillId)]);
      for (const p of comprehensivePicks(pills, contentKeysOf(s))) {
        if (grown.has(p.id) || skip.has(p.id)) continue;
        start({ id: newLayerId(), anchor: p.anchor, question: questionOf(p), pillId: p.id, status: "growing" });
      }
    },
    [start]
  );

  const suggest = useCallback(() => {
    const s = requestSheet();
    if (!s || !live.current.o.ready || live.current.o.readOnly) return;
    suggestAbort.current?.abort();
    const controller = new AbortController();
    suggestAbort.current = controller;
    setSuggesting(true);
    setSuggestFailed(false);
    const sheetNow = live.current.o.sheet!;
    const exists = (anchor: string) => originalLine(sheetNow, anchor) !== null;
    // Ids given as pills settle, so a pick grown mid-stream stays tied to its pill.
    const ids: string[] = [];
    const withIds = (pills: AnchoredQuestion[]): LayerPill[] =>
      pills.map((p, i) => ({ ...p, id: (ids[i] ??= newLayerId()) }));
    const growNow = live.current.o.comprehensive && !live.current.layer.picksGrown;
    const started = new Set<string>();
    // The page redraws when a pill settles or a new one takes its line, not on every word.
    let shown = "";
    let shownCount = 0;
    let shownPending: { id: string; anchor: string } | null = null;

    runBranchRequest(s, { action: "suggest" }, {
      signal: controller.signal,
      onText: (t) => {
        const read = readSuggestions(t, exists);
        // A chunk can end where the reply doesn't parse yet: it reads as fewer
        // pills, or none. What was shown stays shown, rather than blinking out.
        if (read.pills.length < shownCount) return;
        const pills = withIds(read.pills);
        const pending = read.pending
          ? { id: (ids[pills.length] ??= newLayerId()), anchor: read.pending }
          : pills.length === shownCount
          ? shownPending
          : null;
        const sig = `${pills.map((p) => p.id).join(",")}|${pending?.anchor ?? ""}`;
        if (sig === shown) return;
        shown = sig;
        shownCount = pills.length;
        shownPending = pending;
        setStreamed({ pills, pending });
        if (growNow) {
          // Grow each pick as it settles, rather than after the last pill.
          for (const p of comprehensivePicks(pills, contentKeysOf(sheetNow))) {
            if (started.has(p.id)) continue;
            started.add(p.id);
            start({ id: newLayerId(), anchor: p.anchor, question: questionOf(p), pillId: p.id, status: "growing" });
          }
        }
      },
    })
      .then((text) => {
        const pills = withIds(readSuggestions(text, exists).pills);
        live.current.o.update((l) => {
          const next = setPills(l, pills);
          return growNow ? markPicksGrown(next) : next;
        });
        if (growNow) growPickList(pills, started);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        if (e instanceof BranchQuotaError) live.current.o.onQuota();
        else if (e instanceof BranchOutdatedError) live.current.o.onOutdated?.();
        setSuggestFailed(true);
      })
      .finally(() => {
        if (suggestAbort.current === controller) {
          suggestAbort.current = null;
          setSuggesting(false);
          setStreamed(null);
        }
      });
  }, [growPickList, requestSheet, start]);

  // A new sheet: stop everything for the old one. The map is emptied, never replaced.
  useEffect(() => {
    const inFlight = aborts.current;
    return () => {
      suggestAbort.current?.abort();
      suggestAbort.current = null;
      for (const c of inFlight.values()) c.abort();
      inFlight.clear();
      queue.current = [];
      drafts.clear();
      setGrowing({});
      setStreamed(null);
      setSuggesting(false);
      setSuggestFailed(false);
      setOpenId(null);
      setLineAnchor(null);
      setPanel(null);
    };
  }, [o.sheetKey, drafts]);

  // Ask the sheet what to grow, once, when it is finished.
  const asked = useRef<string | number | null>(null);
  useEffect(() => {
    if (!enabled || layer.suggestedAt || asked.current === o.sheetKey) return;
    asked.current = o.sheetKey;
    suggest();
  }, [enabled, layer.suggestedAt, o.sheetKey, suggest]);

  // ── What the page does ────────────────────────────────────────────────────
  const open = useCallback((id: string) => {
    setOpenId(id);
    setPanel("branch");
  }, []);
  const openAll = useCallback(() => setPanel("all"), []);
  const openLine = useCallback((anchor: string) => {
    setLineAnchor(anchor);
    setPanel("line");
  }, []);
  const close = useCallback(() => setPanel(null), []);

  const growPill = useCallback(
    (pill: LayerPill) => {
      if (!live.current.o.ready) return;
      const existing = live.current.layer.branches.find((b) => b.pillId === pill.id);
      if (existing) return open(existing.id);
      const inFlight = Object.values(growingRef.current).find((g) => g.pillId === pill.id);
      if (inFlight) return open(inFlight.id);
      const id = newLayerId();
      live.current.o.touch((l) => l); // the student's first touch saves the sheet
      start({ id, anchor: pill.anchor, question: questionOf(pill), pillId: pill.id, status: "growing" });
      open(id);
    },
    [open, start]
  );

  const growNext = useCallback(
    (parentId: string, q: BranchQuestion) => {
      const parent = live.current.layer.branches.find((b) => b.id === parentId);
      if (!parent) return;
      const existing = live.current.layer.branches.find((b) => b.parentId === parentId && b.label === q.label);
      if (existing) return open(existing.id);
      const id = newLayerId();
      live.current.o.touch((l) => l);
      start({ id, anchor: parent.anchor, parentId, question: q, status: "growing" });
      open(id);
    },
    [open, start]
  );

  const ask = useCallback(
    (target: { anchor: string; parentId?: string }, question: string) => {
      const q = question.replace(/\s+/g, " ").trim().slice(0, 300);
      if (!q) return;
      const id = newLayerId();
      live.current.o.touch((l) => l);
      const label = q.length > 60 ? `${q.slice(0, 57).trimEnd()}…` : q;
      start({ id, anchor: target.anchor, parentId: target.parentId, question: { type: "ask", label, ask: q }, status: "growing" });
      open(id);
    },
    [open, start]
  );

  const write = useCallback(
    (target: { anchor: string; parentId?: string }, label: string, text: string) => {
      if (!text.trim()) return;
      const id = newLayerId();
      const title = label.trim() || text.trim().split("\n")[0].replace(/\*\*/g, "").slice(0, 60);
      live.current.o.touch((l) =>
        addBranch(l, {
          id,
          anchor: target.anchor,
          ...(target.parentId ? { parentId: target.parentId } : {}),
          type: "note",
          label: title,
          ask: "",
          text,
          next: [],
          source: "user",
        })
      );
      open(id);
    },
    [open]
  );

  const regrow = useCallback(
    (id: string) => {
      const b = live.current.layer.branches.find((x) => x.id === id);
      if (!b || b.type === "note") return;
      live.current.o.touch((l) => l);
      start({
        id,
        anchor: b.anchor,
        parentId: b.parentId,
        question: { type: b.type, label: b.label, ask: b.ask || b.label, ...(b.versus ? { versus: b.versus } : {}) },
        pillId: b.pillId,
        status: "growing",
        replaces: true,
      });
    },
    [start]
  );

  const edit = useCallback((id: string, text: string) => live.current.o.touch((l) => editBranch(l, id, text)), []);

  const openRef = useRef(openId);
  openRef.current = openId;
  const remove = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    live.current.o.touch((l) => removeBranch(l, id));
    // Its parent, if it had one, is where the student was.
    if (openRef.current === id) {
      const parent = live.current.layer.branches.find((b) => b.id === id)?.parentId;
      setOpenId(parent ?? null);
      if (!parent) setPanel((p) => (p === "branch" ? null : p));
    }
  }, []);

  const retry = useCallback(
    (id: string) => {
      const g = growingRef.current[id];
      if (g) start({ ...g, status: "growing" });
    },
    [start]
  );
  const dismiss = useCallback((id: string) => finish(id), [finish]);

  const growPicks = useCallback(() => {
    if (!live.current.o.ready) return;
    const { layer: l } = live.current;
    if (!l.suggestedAt) return; // the suggestions will grow them when they arrive
    live.current.o.touch(markPicksGrown);
    growPickList(l.pills);
  }, [growPickList]);

  const pills = streamed?.pills ?? layer.pills;
  const pendingPill = streamed?.pending ?? null;
  const contentKeys = useMemo(() => sectionOrder.filter((k) => !STUDY_AIDS.includes(k)), [sectionOrder]);
  const picksPending = useMemo(() => {
    const grown = new Set([...layer.branches.map((b) => b.pillId), ...Object.values(growing).map((g) => g.pillId)]);
    return comprehensivePicks(layer.pills, contentKeys).some((p) => !grown.has(p.id));
  }, [contentKeys, growing, layer.branches, layer.pills]);

  const canBranch = useCallback(
    (id: string) => branchPath(live.current.layer, id).length + 1 < MAX_BRANCH_DEPTH,
    []
  );
  const pathOf = useCallback((id: string) => branchPath(live.current.layer, id), []);

  return {
    enabled,
    readOnly,
    pills,
    pendingPill,
    branches: layer.branches,
    growing,
    drafts,
    suggesting,
    suggestFailed,
    openId,
    lineAnchor,
    panel,
    open,
    openAll,
    openLine,
    close,
    growPill,
    growNext,
    ask,
    write,
    regrow,
    edit,
    remove,
    retry,
    dismiss,
    suggest,
    growPicks,
    picksPending,
    canBranch,
    lineOf,
    sectionTitleOf,
    sectionOrder,
    pathOf,
  };
}

const STUDY_AIDS = ["keyPoints", "memoryHooks", "examTraps"];

/** The sheet's content sections — the ones a comprehensive sheet grows branches for. */
const contentKeysOf = (sheet: GeneratedSheet) =>
  resolvePlan(sheet)
    .map((p) => p.key)
    .filter((k) => !STUDY_AIDS.includes(k));

const questionOf = (p: LayerPill | AnchoredQuestion): BranchQuestion => ({
  type: p.type,
  label: p.label,
  ask: p.ask,
  ...(p.versus ? { versus: p.versus } : {}),
});
