import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";

/**
 * What the app's backdrop is showing, and who asks for it.
 *
 * The backdrop is mounted once, at the root, so it keeps flowing across page
 * changes instead of starting over on every one — and outside the pages' own
 * enter transitions, whose transform would otherwise pin a fixed layer to the
 * page. Pages say what they need with `useBackdropScene`; the app layout asks
 * for the calm default, and a page's more specific scene outranks it.
 */
export type BackdropMode =
  /** Starting a sheet: the molecule has the right margin to itself. */
  | "compose"
  /** A sheet being written: the molecule assembles as its sections land. */
  | "generating"
  /** Reading a sheet: the molecule waits in the lower-right margin. */
  | "reading"
  /** Everywhere else in the app: the field, and a small molecule in a corner. */
  | "ambient"
  /** Answering a question or a card: the field all but still, no molecule. */
  | "focus";

export interface BackdropScene {
  mode: BackdropMode;
  /** Generating only: how much of the sheet has landed, 0 to 1. */
  progress?: number;
  /** Picks the molecule's fold, so a topic keeps its own. */
  seed?: string;
}

/**
 * Each part of the app has its own structure, colour and field grain, so the
 * backdrop says where the student is: a sheet's knot, the dashboard's cell,
 * the question bank's crystal, the library's seed head, flashcards' neuron,
 * the roadmap's climbing path.
 */
export type BackdropVariant = "sheets" | "dashboard" | "qbank" | "library" | "flashcards" | "roadmap";

const APP_PATH = /^\/(dashboard|sheets|flashcards|qbank|library|roadmap)(\/|$)/;

/** The app's own pages, where the backdrop lives — not the landing or auth pages. */
export const isAppPath = (path: string) => APP_PATH.test(path);

export function variantForPath(path: string): BackdropVariant {
  const section = APP_PATH.exec(path)?.[1];
  return section === "sheets" || section === "qbank" || section === "library" || section === "flashcards" || section === "roadmap"
    ? section
    : "dashboard";
}

interface Entry {
  scene: BackdropScene;
  priority: number;
  order: number;
}

interface Registry {
  set: (id: string, entry: Omit<Entry, "order">) => void;
  remove: (id: string) => void;
}

const RegistryContext = createContext<Registry | null>(null);
const SceneContext = createContext<BackdropScene | null>(null);

let order = 0;

export function BackdropProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});

  const registry = useMemo<Registry>(
    () => ({
      set: (id, entry) =>
        setEntries((prev) => {
          const old = prev[id];
          if (old && old.priority === entry.priority && sameScene(old.scene, entry.scene)) return prev;
          return { ...prev, [id]: { ...entry, order: old?.order ?? ++order } };
        }),
      remove: (id) =>
        setEntries((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }),
    }),
    []
  );

  // The highest priority wins; among equals, the one that arrived last.
  const active = useMemo(() => {
    let best: Entry | null = null;
    for (const e of Object.values(entries)) {
      if (!best || e.priority > best.priority || (e.priority === best.priority && e.order > best.order)) best = e;
    }
    return best?.scene ?? null;
  }, [entries]);

  return (
    <RegistryContext.Provider value={registry}>
      <SceneContext.Provider value={active}>{children}</SceneContext.Provider>
    </RegistryContext.Provider>
  );
}

const sameScene = (a: BackdropScene, b: BackdropScene) =>
  a.mode === b.mode && (a.progress ?? 0) === (b.progress ?? 0) && (a.seed ?? "") === (b.seed ?? "");

/**
 * Asks the backdrop for a scene while the calling component is mounted. The
 * layout calls it at priority 0; a page's own scene uses the default, 1. Null
 * withdraws the request without unmounting.
 */
export function useBackdropScene(scene: BackdropScene | null, priority = 1) {
  const registry = useContext(RegistryContext);
  const id = useId();
  const mode = scene?.mode;
  const progress = scene?.progress;
  const seed = scene?.seed;

  useEffect(() => {
    if (!registry) return;
    if (!mode) registry.remove(id);
    else registry.set(id, { scene: { mode, progress, seed }, priority });
  }, [registry, id, mode, progress, seed, priority]);

  useEffect(() => () => registry?.remove(id), [registry, id]);
}

/** The scene the backdrop should show now, or null when no page wants one. */
export const useActiveBackdropScene = () => useContext(SceneContext);
