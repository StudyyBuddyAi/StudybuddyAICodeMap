import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  BranchIncompleteError,
  BranchOutdatedError,
  BranchQuotaError,
  MAX_BRANCH_DEPTH,
  branchMarkdown,
  bestAnchor,
  comprehensivePicks,
  isTransient,
  plainText,
  readBranch,
  readSuggestions,
  runBranchRequest,
  type AnchoredQuestion,
  type BranchQuestion,
  type AskFormat,
  type BranchReply,
  type BranchReviewResult,
  type BranchSheet,
} from "@/lib/sheet-branches";
import {
  addBranch,
  anchorSection,
  branchPath,
  editBranch,
  emptyLayer,
  markPicksGrown,
  newLayerId,
  originalLine,
  removeBranch,
  replaceSectionPills,
  setPills,
  type BranchReviewMark,
  type LayerBranch,
  type LayerPill,
  type SheetLayer,
} from "@/lib/sheet-layer";
import { resolvePlan } from "@/lib/sheet-plan";
import { requestSignature, requestTopic } from "@/lib/sheet-signature";
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
 *
 * A branch is written, then checked: the server reviews it for clinical
 * errors before the stream closes, and a correction replaces what streamed.
 * A branch is kept only whole — a reply cut short is tried once more by
 * itself, then offered again, and never saved as it stood.
 *
 * All of it lives in a store the page holds but never reads (BranchesStore):
 * the chips of one line, the panel, the topic bar's button each subscribe to
 * their own slice. Opening the panel, or a branch finishing, used to
 * re-render the page — and with it every line of the sheet — which on a
 * mid-range phone took a second or two a time.
 */

/** At most this many branches are written at once. */
const CONCURRENCY = 4;

export type BranchPanelView = "branch" | "all" | "line";

/** A branch being written, being checked, one that failed, or a question the writer declined. */
export interface GrowingBranch {
  id: string;
  anchor: string;
  parentId?: string;
  question: BranchQuestion;
  pillId?: string;
  status: "growing" | "reviewing" | "error" | "declined";
  /** declined: what the writer said instead. */
  message?: string;
  /** Writing again a branch the layer already has. */
  replaces?: boolean;
  /** One of a comprehensive sheet's picks, grown for the student rather than by them. */
  auto?: boolean;
  /** Already tried once more by itself. */
  retried?: boolean;
  /** The words the student selected on the line, which their question is about. */
  focus?: string;
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

// ── The store ────────────────────────────────────────────────────────────────

/** Everything the branches show: what is running, what is open, and the page's inputs. */
export interface BranchesState {
  growing: Record<string, GrowingBranch>;
  streamed: { pills: LayerPill[]; pending: { id: string; anchor: string } | null } | null;
  suggesting: boolean;
  suggestFailed: boolean;
  openId: string | null;
  panel: BranchPanelView | null;
  lineAnchor: string | null;
  /** The words selected on that line, when the student asked from a selection. */
  lineFocus: string | null;
  /** Sections just rewritten, waiting for the sheet to show their new lines before they are suggested for. */
  scoped: string[] | null;
  // The page's, as of its last render.
  layer: SheetLayer;
  enabled: boolean;
  readOnly: boolean;
  sectionOrder: string[];
}

/** What the page's branches do. Stable: a component holding these never re-renders for them. */
export type BranchActions = Pick<
  BranchesApi,
  | "open"
  | "openAll"
  | "openLine"
  | "close"
  | "growPill"
  | "growNext"
  | "ask"
  | "anchorFor"
  | "write"
  | "regrow"
  | "edit"
  | "remove"
  | "retry"
  | "dismiss"
  | "suggest"
  | "suggestFor"
  | "growPicks"
  | "canBranch"
  | "lineOf"
  | "sectionTitleOf"
  | "pathOf"
>;

export interface BranchesStore {
  getState(): BranchesState;
  subscribe(listener: () => void): () => void;
  set(patch: Partial<BranchesState>): void;
  drafts: DraftStore;
  actions: BranchActions;
}

function createBranchesStore(initial: BranchesState): BranchesStore {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(patch) {
      let changed = false;
      for (const k of Object.keys(patch) as (keyof BranchesState)[]) {
        if (!Object.is(state[k], patch[k])) changed = true;
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    drafts: createDraftStore(),
    actions: null as unknown as BranchActions, // set by the hook on its first render
  };
}

const STUDY_AIDS = ["keyPoints", "memoryHooks", "examTraps"];

/** A store with nothing in it and nothing to do, for a view without branches — hooks can't be skipped. */
export const NO_BRANCHES: BranchesStore = createBranchesStore({
  growing: {},
  streamed: null,
  suggesting: false,
  suggestFailed: false,
  openId: null,
  panel: null,
  lineAnchor: null,
  lineFocus: null,
  scoped: null,
  layer: emptyLayer(),
  enabled: false,
  readOnly: true,
  sectionOrder: [],
});

/** The whole picture, for the panel: the store's state with what is derived from it, and the actions. */
export function branchesApi(store: BranchesStore, st: BranchesState): BranchesApi {
  const contentKeys = st.sectionOrder.filter((k) => !STUDY_AIDS.includes(k));
  const grown = new Set([...st.layer.branches.map((b) => b.pillId), ...Object.values(st.growing).map((g) => g.pillId)]);
  return {
    enabled: st.enabled,
    readOnly: st.readOnly,
    pills: st.streamed?.pills ?? st.layer.pills,
    pendingPill: st.streamed?.pending ?? null,
    branches: st.layer.branches,
    growing: st.growing,
    drafts: store.drafts,
    suggesting: st.suggesting,
    suggestFailed: st.suggestFailed,
    openId: st.openId,
    lineAnchor: st.lineAnchor,
    lineFocus: st.lineFocus,
    panel: st.panel,
    picksPending: comprehensivePicks(st.layer.pills, contentKeys).some((p) => !grown.has(p.id)),
    sectionOrder: st.sectionOrder,
    ...store.actions,
  };
}

const noSubscribe = () => () => {};

/** Every change: for the panel, which shows most of it. */
export function useBranchesApi(store: BranchesStore | null): BranchesApi | null {
  const st = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    () => store?.getState() ?? null,
    () => store?.getState() ?? null
  );
  return useMemo(() => (store && st ? branchesApi(store, st) : null), [store, st]);
}

/**
 * One slice of the store, re-rendering only when `isEqual` says the slice
 * changed. `key` names what the selector depends on besides the state — a
 * line's anchor — so a new one is read afresh.
 */
export function useBranchesSelector<T>(
  store: BranchesStore,
  key: string,
  selector: (st: BranchesState) => T,
  isEqual: (a: T, b: T) => boolean
): T {
  const last = useRef<{ key: string; st: BranchesState; value: T } | null>(null);
  const read = () => {
    const st = store.getState();
    const prev = last.current;
    if (prev && prev.key === key && prev.st === st) return prev.value;
    const value = selector(st);
    if (prev && prev.key === key && isEqual(prev.value, value)) {
      last.current = { key, st, value: prev.value };
      return prev.value;
    }
    last.current = { key, st, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, read, read);
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
  /** The words selected on that line, when the student asked from a selection. */
  lineFocus: string | null;
  /** What the panel shows: one branch, every branch, or one line's branches and how to grow more. */
  panel: BranchPanelView | null;
  open: (id: string) => void;
  openAll: () => void;
  /** The line view, to ask about a line — or about the words selected on it (`focus`). */
  openLine: (anchor: string, focus?: string) => void;
  close: () => void;
  /** Grows a suggestion, and opens it. */
  growPill: (pill: LayerPill) => void;
  /** Grows one of a branch's own suggestions. */
  growNext: (parentId: string, q: BranchQuestion) => void;
  /** Grows the answer to the student's own question, about a line or a branch. */
  ask: (target: { anchor: string; parentId?: string; focus?: string }, question: string, format?: AskFormat) => void;
  /** Where a question asked of the whole sheet belongs: the line that shares most of its words, else the first section. */
  anchorFor: (question: string) => string;
  /** The student's own branch, written by hand. */
  write: (target: { anchor: string; parentId?: string }, label: string, text: string) => void;
  regrow: (id: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  /** A branch that failed: try again, or give up on it. */
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  suggest: () => void;
  /** New suggestions for these sections only — ones just rewritten. */
  suggestFor: (keys: string[]) => void;
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

/** What a review leaves on the branch it checked. */
const reviewMark = (r: BranchReviewResult | null): BranchReviewMark | undefined =>
  !r ? undefined : r.verdict === "corrected" || r.verdict === "flagged" ? { verdict: r.verdict, fixes: r.fixes } : { verdict: r.verdict };

/**
 * The page's branches, as a store: the page creates it and hands it down, and
 * never re-renders for what happens in it. See BranchesStore.
 */
export function useSheetBranches(o: UseSheetBranchesOptions): BranchesStore {
  const { sheet, ready, layer } = o;
  const readOnly = !!o.readOnly;
  const enabled = ready && !readOnly && !!sheet;

  // ── The sheet, as a request carries it ────────────────────────────────────
  const plan = useMemo(() => (sheet ? resolvePlan(sheet) : []), [sheet]);
  const sectionOrder = useMemo(() => plan.map((s) => s.key), [plan]);
  const titles = useMemo(() => new Map(plan.map((s) => [s.key, s.title])), [plan]);

  const [store] = useStateOnce(() =>
    createBranchesStore({
      growing: {},
      streamed: null,
      suggesting: false,
      suggestFailed: false,
      openId: null,
      panel: null,
      lineAnchor: null,
      lineFocus: null,
      scoped: null,
      layer,
      enabled,
      readOnly,
      sectionOrder,
    })
  );
  const drafts = store.drafts;
  // Setters over the store, in React's shape: a value, or a function of the current one.
  const { setGrowing, setStreamed, setSuggesting, setSuggestFailed, setOpenId, setPanel, setLineAnchor, setScoped } = useMemo(() => {
    const setter =
      <K extends keyof BranchesState>(k: K) =>
      (v: BranchesState[K] | ((prev: BranchesState[K]) => BranchesState[K])) =>
        store.set({
          [k]: typeof v === "function" ? (v as (prev: BranchesState[K]) => BranchesState[K])(store.getState()[k]) : v,
        } as Partial<BranchesState>);
    return {
      setGrowing: setter("growing"),
      setStreamed: setter("streamed"),
      setSuggesting: setter("suggesting"),
      setSuggestFailed: setter("suggestFailed"),
      setOpenId: setter("openId"),
      setPanel: setter("panel"),
      setLineAnchor: setter("lineAnchor"),
      setScoped: setter("scoped"),
    };
  }, [store]);

  // What async work reads: the latest of everything, not what it closed over.
  const live = useRef({ o, layer });
  live.current = { o, layer };
  const aborts = useRef(new Map<string, AbortController>());
  const queue = useRef<(() => Promise<void>)[]>([]);
  const running = useRef(0);
  const suggestAbort = useRef<AbortController | null>(null);

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
      // The topic the sheet was signed under, so the server can check it.
      topic: requestTopic(s, c.topic),
      sourceIds: c.sourceIds,
      signature: requestSignature(s, live.current.layer),
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
    [drafts, setGrowing]
  );

  /** Grows one branch: queued, streamed into the draft store, checked, kept in the layer when whole. */
  const start = useCallback(
    (g: GrowingBranch) => {
      aborts.current.get(g.id)?.abort();
      const controller = new AbortController();
      aborts.current.set(g.id, controller);
      drafts.set(g.id, "");
      setGrowing((all) => ({ ...all, [g.id]: { ...g, message: undefined } }));

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
        let review: BranchReviewResult | null = null;
        let lastText = "";
        // Kept in the layer the moment it was written, before its check: the
        // check takes up to a minute or two, and nobody should wait on it.
        let kept = false;
        let freeSlot!: () => void;
        const written = new Promise<void>((resolve) => (freeSlot = resolve));

        /** The branch into the layer — as written, or as the check corrected it. */
        const keep = (reply: BranchReply, markdown: string, mark: BranchReviewMark | undefined) => {
          const prior = live.current.layer.branches.find((b) => b.id === g.id);
          // A comprehensive sheet's own picks save the sheet when the first is kept —
          // the student asked for a comprehensive sheet, and nine requests' worth
          // shouldn't vanish with the tab. The student's own grows saved it when they began.
          const save = g.auto ? live.current.o.touch : live.current.o.update;
          save((layerNow) =>
            addBranch(layerNow, {
              id: g.id,
              anchor: prior?.anchor ?? g.anchor,
              ...(g.parentId ? { parentId: g.parentId } : {}),
              ...g.question,
              ...(reply.label ? { label: reply.label } : {}),
              text: markdown,
              next: reply.next,
              source: "ai",
              ...(reply.covered !== null ? { covered: reply.covered } : {}),
              ...(g.pillId ? { pillId: g.pillId } : {}),
              ...(mark ? { review: mark } : {}),
            })
          );
        };

        const work = (async () => {
          try {
            const text = await runBranchRequest(
              s,
              {
                action: "grow",
                anchor: g.anchor,
                quote: lineOf(g.anchor),
                ...(g.focus ? { focus: g.focus } : {}),
                question: g.question,
                path: ancestors.map((b) => ({ label: b.label, text: plainText(b.text).slice(0, 2000) })),
                others,
              },
              {
                signal: controller.signal,
                onText: (t) => {
                  lastText = t;
                  drafts.set(g.id, readBranch(t, g.question.type, ctx).markdown);
                },
                onReviewing: () => {
                  // Written, whole: kept now, marked unchecked until the check says
                  // otherwise, and the slot freed for the next branch.
                  const reply = readBranch(lastText, g.question.type, ctx);
                  if (reply.closed && !reply.offTopic && reply.markdown.trim()) {
                    keep(reply, reply.markdown, { verdict: "unchecked" });
                    kept = true;
                    drafts.delete(g.id);
                  }
                  setGrowing((all) => (all[g.id]?.status === "growing" ? { ...all, [g.id]: { ...all[g.id], status: "reviewing" } } : all));
                  freeSlot();
                },
                onReview: (r) => (review = r),
              }
            );
            const reply = readBranch(text, g.question.type, ctx);
            if (reply.offTopic) {
              // Not a branch: what the writer said instead stays in the panel until dismissed.
              drafts.delete(g.id);
              aborts.current.delete(g.id);
              setGrowing((all) => ({ ...all, [g.id]: { ...g, status: "declined", message: reply.offTopic } }));
              return;
            }
            if (!reply.closed) throw new BranchIncompleteError();
            const corrected = review?.verdict === "corrected" ? branchMarkdown(g.question.type, review.branch, ctx) : "";
            const mark = reviewMark(review);
            if (kept) {
              const now = live.current.layer.branches.find((b) => b.id === g.id);
              // Deleted while it was being checked: nothing to mark.
              if (now && mark) {
                // What the student changed while it was checked stands: the check's
                // findings are shown beside their words, never written over them.
                const text = corrected.trim() && !now.edited ? corrected : now.text;
                live.current.o.update((layerNow) => {
                  const b = layerNow.branches.find((x) => x.id === g.id);
                  return b ? addBranch(layerNow, { ...b, text, review: mark }) : layerNow;
                });
              }
            } else {
              // A server that doesn't check (or a reply that never said it was written): kept as it ends.
              const markdown = corrected.trim() ? corrected : reply.markdown;
              if (!markdown.trim()) throw new Error("empty branch");
              keep(reply, markdown, mark);
            }
            finish(g.id);
          } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") return finish(g.id);
            // The check failed, or the connection dropped while it ran: the branch
            // is kept, and stays marked unchecked. Never grown again for it.
            if (kept) return finish(g.id);
            if (e instanceof BranchQuotaError) {
              finish(g.id);
              // The panel was showing this branch; it isn't coming.
              if (store.getState().openId === g.id && store.getState().panel === "branch") setPanel(null);
              live.current.o.onQuota();
              return;
            }
            if (e instanceof BranchOutdatedError) live.current.o.onOutdated?.();
            // A dropped connection or a server error: once more, by itself, before asking the student.
            if (isTransient(e) && !g.retried && !controller.signal.aborted) {
              start({ ...g, status: "growing", retried: true });
              return;
            }
            drafts.delete(g.id);
            setGrowing((all) => (all[g.id] ? { ...all, [g.id]: { ...all[g.id], status: "error" } } : all));
          } finally {
            freeSlot();
          }
        })();
        // The slot is held while the branch is written, not while it is checked.
        await written;
        void work;
      });
      pump();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start re-queues itself for the one retry
    [drafts, finish, lineOf, pump, requestSheet]
  );

  // ── The suggestions ───────────────────────────────────────────────────────
  /**
   * Grows a comprehensive sheet's picks among `pills` — ranked over all of
   * them — except those grown, being grown, or in `skip`.
   */
  const growPickList = useCallback(
    (pills: LayerPill[], skip: ReadonlySet<string> = new Set()) => {
      const s = live.current.o.sheet;
      if (!s) return;
      const { layer: l } = live.current;
      const grown = new Set([...l.branches.map((b) => b.pillId), ...Object.values(store.getState().growing).map((g) => g.pillId)]);
      for (const p of comprehensivePicks(pills, contentKeysOf(s))) {
        if (grown.has(p.id) || skip.has(p.id)) continue;
        start({ id: newLayerId(), anchor: p.anchor, question: questionOf(p), pillId: p.id, status: "growing", auto: true });
      }
    },
    [start, store]
  );

  /**
   * Asks for suggestions: for the whole sheet, or (`only`) for sections just
   * rewritten, merged in beside the rest. Pills stream onto the sheet as they
   * settle; a comprehensive sheet grows its picks as they do.
   */
  const runSuggest = useCallback(
    (only?: string[]) => {
      const s = requestSheet();
      if (!s || !live.current.o.ready || live.current.o.readOnly) return;
      suggestAbort.current?.abort();
      const controller = new AbortController();
      suggestAbort.current = controller;
      setSuggesting(true);
      setSuggestFailed(false);
      const key = live.current.o.sheetKey;
      const sheetNow = live.current.o.sheet!;
      const exists = (anchor: string) => originalLine(sheetNow, anchor) !== null && (!only || only.includes(anchorSection(anchor)));
      // Ids given as pills settle, so a pick grown mid-stream stays tied to its pill.
      const ids: string[] = [];
      const withIds = (pills: AnchoredQuestion[]): LayerPill[] =>
        pills.map((p, i) => ({ ...p, id: (ids[i] ??= newLayerId()) }));
      const growNow = !only && live.current.o.comprehensive && !live.current.layer.picksGrown;
      // A scoped ask keeps the rest of the sheet's pills in view while its own stream in.
      const base = only ? live.current.layer.pills.filter((p) => !only.includes(anchorSection(p.anchor))) : [];
      const others = only
        ? [...base, ...live.current.layer.branches].map((x) => ({ label: x.label, ask: x.ask })).slice(0, 40)
        : undefined;
      const started = new Set<string>();
      // The page redraws when a pill settles or a new one takes its line, not on every word.
      let shown = "";
      let shownCount = 0;
      let shownPending: { id: string; anchor: string } | null = null;

      runBranchRequest(s, { action: "suggest", ...(only ? { only, others } : {}) }, {
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
          setStreamed({ pills: [...base, ...pills], pending });
          if (growNow) {
            // Grow each pick as it settles, rather than after the last pill.
            for (const p of comprehensivePicks(pills, contentKeysOf(sheetNow))) {
              if (started.has(p.id)) continue;
              started.add(p.id);
              start({ id: newLayerId(), anchor: p.anchor, question: questionOf(p), pillId: p.id, status: "growing", auto: true });
            }
          }
        },
      })
        .then((text) => {
          // Another sheet by now, or a whole-sheet answer the layer already has
          // (it loaded after this was asked): leave what is there.
          if (live.current.o.sheetKey !== key) return;
          if (!only && live.current.layer.suggestedAt) return;
          const pills = withIds(readSuggestions(text, exists).pills);
          const pickNow = growNow && !live.current.layer.picksGrown;
          live.current.o.update((l) => {
            if (only) return replaceSectionPills(l, only, pills);
            const next = setPills(l, pills);
            return pickNow ? markPicksGrown(next) : next;
          });
          if (pickNow) growPickList(pills, started);
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
    },
    [growPickList, requestSheet, start, setStreamed, setSuggestFailed, setSuggesting]
  );
  const suggest = useCallback(() => runSuggest(), [runSuggest]);
  const suggestFor = useCallback((keys: string[]) => setScoped(keys), [setScoped]);

  // A rewrite's suggestions wait for the rewritten section to be on the sheet
  // they read: the rewrite lands in the layer, the page re-renders with it,
  // and this runs.
  useEffect(() => {
    const keys = store.getState().scoped;
    if (!keys || !enabled) return;
    setScoped(null);
    runSuggest(keys);
  }, [enabled, sheet, runSuggest, store, setScoped]);

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
      setScoped(null);
      setOpenId(null);
      setLineAnchor(null);
      setPanel(null);
    };
  }, [o.sheetKey, drafts, setGrowing, setLineAnchor, setOpenId, setPanel, setScoped, setStreamed, setSuggestFailed, setSuggesting]);

  // Ask the sheet what to grow, once, when it is finished — and its layer,
  // with whatever was suggested before, has loaded.
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
  }, [setOpenId, setPanel]);
  const openAll = useCallback(() => setPanel("all"), [setPanel]);
  const openLine = useCallback(
    (anchor: string, focus?: string) => {
      store.set({ lineFocus: focus?.replace(/\s+/g, " ").trim().slice(0, 300) || null });
      setLineAnchor(anchor);
      setPanel("line");
    },
    [setLineAnchor, setPanel, store]
  );
  const close = useCallback(() => setPanel(null), [setPanel]);

  const growPill = useCallback(
    (pill: LayerPill) => {
      if (!live.current.o.ready) return;
      const existing = live.current.layer.branches.find((b) => b.pillId === pill.id);
      if (existing) return open(existing.id);
      const inFlight = Object.values(store.getState().growing).find((g) => g.pillId === pill.id);
      if (inFlight) return open(inFlight.id);
      const id = newLayerId();
      live.current.o.touch((l) => l); // the student's first touch saves the sheet
      start({ id, anchor: pill.anchor, question: questionOf(pill), pillId: pill.id, status: "growing" });
      open(id);
    },
    [open, start, store]
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
    (target: { anchor: string; parentId?: string; focus?: string }, question: string, format?: AskFormat) => {
      const q = question.replace(/\s+/g, " ").trim().slice(0, 300);
      if (!q) return;
      const id = newLayerId();
      live.current.o.touch((l) => l);
      // Until the answer names itself (its "label"), the question stands in, short.
      const label = q.length > 48 ? `${q.slice(0, 45).trimEnd()}…` : q;
      start({
        id,
        anchor: target.anchor,
        parentId: target.parentId,
        question: { type: "ask", label, ask: q, ...(format && format !== "auto" ? { format } : {}) },
        ...(target.focus ? { focus: target.focus } : {}),
        status: "growing",
      });
      open(id);
    },
    [open, start]
  );

  const anchorFor = useCallback((question: string) => {
    const s = requestSheet();
    if (!s) return "";
    const content = s.plan.filter((k) => !STUDY_AIDS.includes(k));
    return bestAnchor(s.sections, s.plan, question) ?? `${content[0] ?? s.plan[0]}:end`;
  }, [requestSheet]);

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
        question: {
          type: b.type,
          label: b.label,
          ask: b.ask || b.label,
          ...(b.versus ? { versus: b.versus } : {}),
          ...(b.format ? { format: b.format } : {}),
        },
        pillId: b.pillId,
        status: "growing",
        replaces: true,
      });
    },
    [start]
  );

  const edit = useCallback((id: string, text: string) => live.current.o.touch((l) => editBranch(l, id, text)), []);

  const remove = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    live.current.o.touch((l) => removeBranch(l, id));
    // Its parent, if it had one, is where the student was.
    if (store.getState().openId === id) {
      const parent = live.current.layer.branches.find((b) => b.id === id)?.parentId;
      setOpenId(parent ?? null);
      if (!parent) setPanel((p) => (p === "branch" ? null : p));
    }
  }, [setOpenId, setPanel, store]);

  const retry = useCallback(
    (id: string) => {
      const g = store.getState().growing[id];
      if (g) start({ ...g, status: "growing", retried: false });
    },
    [start, store]
  );
  const dismiss = useCallback(
    (id: string) => {
      const g = store.getState().growing[id];
      finish(id);
      // A declined question has nothing left to show.
      if (g?.status === "declined" && store.getState().openId === id) setPanel((p) => (p === "branch" ? null : p));
    },
    [finish, setPanel, store]
  );

  const growPicks = useCallback(() => {
    if (!live.current.o.ready) return;
    const { layer: l } = live.current;
    if (!l.suggestedAt) return; // the suggestions will grow them when they arrive
    live.current.o.touch(markPicksGrown);
    growPickList(l.pills);
  }, [growPickList]);

  const canBranch = useCallback(
    (id: string) => branchPath(live.current.layer, id).length + 1 < MAX_BRANCH_DEPTH,
    []
  );
  const pathOf = useCallback((id: string) => branchPath(live.current.layer, id), []);

  // The actions, stable across renders — a chip or a menu holding them never
  // re-renders because the page did.
  const actions = useMemo<BranchActions>(
    () => ({
      open,
      openAll,
      openLine,
      close,
      growPill,
      growNext,
      ask,
      anchorFor,
      write,
      regrow,
      edit,
      remove,
      retry,
      dismiss,
      suggest,
      suggestFor,
      growPicks,
      canBranch,
      lineOf,
      sectionTitleOf,
      pathOf,
    }),
    [open, openAll, openLine, close, growPill, growNext, ask, anchorFor, write, regrow, edit, remove, retry, dismiss, suggest, suggestFor, growPicks, canBranch, lineOf, sectionTitleOf, pathOf]
  );
  store.actions = actions;

  // The page's inputs, into the store before the screen paints, so what
  // subscribes to them sees this render's.
  useLayoutEffect(() => {
    store.set({ layer, enabled, readOnly, sectionOrder });
  }, [store, layer, enabled, readOnly, sectionOrder]);

  return store;
}

/** A value made once, on the first render. */
function useStateOnce<T>(make: () => T): [T] {
  const ref = useRef<{ v: T } | null>(null);
  if (!ref.current) ref.current = { v: make() };
  return [ref.current.v];
}

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
