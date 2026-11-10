import { useMemo, useSyncExternalStore } from "react";
import { MEMORIAL, type MemorialCardId, type MemorialContent } from "@/content/memorial";

/**
 * The memorial is a prototype: the page, its entry points and the lab panel
 * that switches between versions exist only in `npm run dev`. A production
 * build drops the route and renders no entry point, so nothing ships until a
 * version is chosen.
 */
export const MEMORIAL_PROTOTYPE = import.meta.env.DEV;

export type MemorialVersion = "dedication" | "prints" | "cards" | "album";

export const MEMORIAL_VERSIONS: { id: MemorialVersion; name: string; note: string }[] = [
  { id: "dedication", name: "A · Dedication", note: "A book's dedication page; the cards are a small stack of sheets." },
  { id: "prints", name: "B · Prints", note: "A pile of photo prints. The top one slides aside and goes to the back." },
  { id: "cards", name: "C · Index cards", note: "The app's own index cards, side by side, with the photo clipped on." },
  { id: "album", name: "D · Album", note: "A family album that turns its pages, and opens on a different one each day." },
];

export type MemorialEntry = "plaque" | "ribbon" | "closing";

export const MEMORIAL_ENTRIES: { id: MemorialEntry; name: string; where: string }[] = [
  { id: "plaque", name: "Footer line", where: "Every page's footer, and the landing page's" },
  { id: "ribbon", name: "Ribbon by the logo", where: "The top bar, in the app and on the landing page" },
  { id: "closing", name: "Closing dedication", where: "The landing page, just before its footer" },
];

interface CardDraft {
  names?: string;
  line?: string;
  /** As typed: a blank line starts a new paragraph. */
  text?: string;
  /** As typed: one name per line. */
  roll?: string;
  /** A downscaled data URL, kept only in this browser. */
  photo?: string | null;
}

export interface MemorialLabState {
  version: MemorialVersion;
  entries: Record<MemorialEntry, boolean>;
  /** Show every photo in black and white. */
  mono: boolean;
  dedication?: string;
  signature?: string;
  cards: Partial<Record<MemorialCardId, CardDraft>>;
}

const KEY = "memorial-lab";
const DEFAULTS: MemorialLabState = {
  version: "dedication",
  entries: { plaque: true, ribbon: false, closing: false },
  mono: false,
  cards: {},
};

const VERSION_IDS = MEMORIAL_VERSIONS.map((v) => v.id);
export const isMemorialVersion = (v: unknown): v is MemorialVersion =>
  typeof v === "string" && (VERSION_IDS as string[]).includes(v);

function load(): MemorialLabState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<MemorialLabState>;
    return {
      ...DEFAULTS,
      ...saved,
      version: isMemorialVersion(saved.version) ? saved.version : DEFAULTS.version,
      entries: { ...DEFAULTS.entries, ...saved.entries },
      cards: saved.cards ?? {},
    };
  } catch {
    return DEFAULTS;
  }
}

let state: MemorialLabState = MEMORIAL_PROTOTYPE ? load() : DEFAULTS;
/** True when the last save did not fit in this browser's storage (big photos). */
let unsaved = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getMemorialLab = () => state;
export const memorialLabUnsaved = () => unsaved;

export function setMemorialLab(patch: Partial<MemorialLabState>) {
  state = { ...state, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    unsaved = false;
  } catch {
    // Out of room: the change still holds until the page reloads.
    unsaved = true;
  }
  listeners.forEach((l) => l());
}

export function setMemorialCard(id: MemorialCardId, draft: CardDraft) {
  setMemorialLab({ cards: { ...state.cards, [id]: { ...state.cards[id], ...draft } } });
}

export function resetMemorialLab() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was kept anyway.
  }
  state = DEFAULTS;
  unsaved = false;
  listeners.forEach((l) => l());
}

export const useMemorialLab = () => useSyncExternalStore(subscribe, getMemorialLab, getMemorialLab);

/** Is this entry point switched on? Always false outside the prototype. */
export const useMemorialEntry = (entry: MemorialEntry) => {
  const lab = useMemorialLab();
  return MEMORIAL_PROTOTYPE && lab.entries[entry];
};

/** The memorial's content, with whatever the lab panel has typed or added over it. */
export function useMemorialContent(): MemorialContent {
  const lab = useMemorialLab();
  return useMemo(() => {
    if (!MEMORIAL_PROTOTYPE) return MEMORIAL;
    return {
      dedication: lab.dedication?.trim() || MEMORIAL.dedication,
      signature: lab.signature?.trim() || MEMORIAL.signature,
      cards: MEMORIAL.cards.map((card) => {
        const d = lab.cards[card.id];
        if (!d) return card;
        const text = d.text
          ?.split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean);
        const roll = d.roll
          ?.split("\n")
          .map((name) => name.trim())
          .filter(Boolean);
        return {
          ...card,
          names: d.names?.trim() || card.names,
          line: d.line?.trim() || card.line,
          text: text?.length ? text : card.text,
          roll: card.roll ? (roll?.length ? roll : card.roll) : undefined,
          photo: d.photo === undefined ? card.photo : d.photo,
        };
      }),
    };
  }, [lab]);
}
