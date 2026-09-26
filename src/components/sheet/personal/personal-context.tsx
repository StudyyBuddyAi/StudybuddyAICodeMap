import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  addCard,
  addNote,
  practiceFocus,
  setEdit,
  type SheetLayer,
} from "@/lib/sheet-layer";
import {
  ProRequiredError,
  ServerOutdatedError,
  oneLine,
  parseCardText,
  runPersonalize,
  type PersonalizeAction,
  type RewriteStyle,
} from "@/lib/personalize";

/**
 * What the sheet page hands the document so the student can make it theirs.
 * Absent, the document renders exactly as it always has.
 */
export interface PersonalProps {
  layer: SheetLayer;
  /** Pro, or a sheet generated as premium. Everything below is gated on it. */
  entitled: boolean;
  /** The saved layer has loaded; edits before that are refused. */
  ready: boolean;
  /** A view that shows the layer but offers no way to change it (Library). */
  readOnly?: boolean;
  unsaved?: boolean;
  saveFailed?: boolean;
  update: (fn: (layer: SheetLayer) => SheetLayer) => void;
  /** Explains Pro, when an unentitled student reaches for a Pro action. */
  onLocked: () => void;
  /** What the AI actions need to know about the sheet. */
  context: { topic: string; examMode?: string; difficulty?: string; grant?: string };
  /** Adds a card made from the sheet to the student's deck. Resolves false on failure. */
  onAddCard?: (card: { question: string; answer: string }) => Promise<boolean>;
  /** Starts a QBank set on this sheet, focused on what the student marked. */
  onPractice?: (focus: string) => void;
}

export type SuggestionAction = PersonalizeAction;

export interface Suggestion {
  anchor: string;
  action: SuggestionAction;
  /** What the student asked for, as the card shows it: "Simplify", "Your cards". */
  label: string;
  /** The line as it read when the action ran; accepting replaces exactly this. */
  original: string;
  style?: RewriteStyle;
  instruction?: string;
  focus?: string;
  sectionTitle?: string;
  text: string;
  status: "loading" | "done" | "error";
  error?: string;
}

export interface PersonalApi extends PersonalProps {
  /** Entitled, loaded, and not a read-only view: the layer can change. */
  editable: boolean;
  showOriginal: boolean;
  setShowOriginal: (on: boolean) => void;
  hideKnown: boolean;
  setHideKnown: (on: boolean) => void;

  /** The line or item open in the inline editor. */
  editing: string | null;
  setEditing: (anchor: string | null) => void;
  /** The line or section a note is being written for. */
  noting: string | null;
  setNoting: (anchor: string | null) => void;
  /** The line the student is telling the AI how to rewrite. */
  asking: string | null;
  setAsking: (anchor: string | null) => void;

  suggestion: Suggestion | null;
  runSuggestion: (s: Omit<Suggestion, "text" | "status" | "error">) => void;
  retrySuggestion: () => void;
  dismissSuggestion: () => void;
  /** Rewrite → the line becomes the suggestion; explain → it becomes a note. */
  acceptSuggestion: () => void;
  /** Card → the (possibly edited) card goes into the deck and the layer. */
  acceptCard: (card: { question: string; answer: string }) => Promise<boolean>;

  /** Runs `fn` if the student may, or explains why not. */
  guard: (fn: () => void) => void;
  /** The practice focus the layer currently implies (for QBank). */
  focus: string;
}

const PersonalContext = createContext<PersonalApi | null>(null);

export const usePersonal = () => useContext(PersonalContext);

export function PersonalProvider({ value, children }: { value: PersonalProps; children: React.ReactNode }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [hideKnown, setHideKnown] = useState(false);
  const [editing, setEditingState] = useState<string | null>(null);
  const [noting, setNotingState] = useState<string | null>(null);
  const [asking, setAskingState] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const editable = value.entitled && value.ready && !value.readOnly;
  const { update, onLocked, context } = value;

  // One inline surface open at a time under a line: the editor, the note, the
  // question to the AI. Opening one closes the others.
  const setEditing = useCallback((a: string | null) => {
    setEditingState(a);
    if (a) {
      setNotingState(null);
      setAskingState(null);
    }
  }, []);
  const setNoting = useCallback((a: string | null) => {
    setNotingState(a);
    if (a) {
      setEditingState(null);
      setAskingState(null);
    }
  }, []);
  const setAsking = useCallback((a: string | null) => {
    setAskingState(a);
    if (a) {
      setEditingState(null);
      setNotingState(null);
    }
  }, []);

  const guard = useCallback(
    (fn: () => void) => {
      if (!value.entitled) onLocked();
      else if (editable) fn();
    },
    [value.entitled, editable, onLocked]
  );

  const start = useCallback(
    (s: Omit<Suggestion, "text" | "status" | "error">) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setAskingState(null);
      setSuggestion({ ...s, text: "", status: "loading" });
      runPersonalize(
        {
          action: s.action,
          style: s.style,
          instruction: s.instruction,
          text: s.original,
          focus: s.focus,
          sectionTitle: s.sectionTitle,
          topic: context.topic,
          grant: context.grant,
          examMode: context.examMode,
          difficulty: context.difficulty,
        },
        {
          signal: controller.signal,
          onText: (text) =>
            setSuggestion((cur) => (cur && abortRef.current === controller ? { ...cur, text } : cur)),
        }
      )
        .then(({ text }) =>
          setSuggestion((cur) =>
            cur && abortRef.current === controller
              ? { ...cur, text: s.action === "rewrite" ? oneLine(text) : text.trim(), status: "done" }
              : cur
          )
        )
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return;
          if (e instanceof ProRequiredError) {
            setSuggestion(null);
            onLocked();
            return;
          }
          const error =
            e instanceof ServerOutdatedError
              ? "This isn't available yet — StudyBuddy is being updated. Try again later."
              : "That didn't work. Try again in a moment.";
          setSuggestion((cur) => (cur && abortRef.current === controller ? { ...cur, status: "error", error } : cur));
        });
    },
    [context, onLocked]
  );

  const runSuggestion = useCallback((s: Omit<Suggestion, "text" | "status" | "error">) => guard(() => start(s)), [guard, start]);

  const retrySuggestion = useCallback(() => {
    if (suggestion) start(suggestion);
  }, [suggestion, start]);

  const dismissSuggestion = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSuggestion(null);
  }, []);

  const acceptSuggestion = useCallback(() => {
    const s = suggestion;
    if (!s || s.status !== "done" || !s.text.trim()) return;
    if (s.action === "rewrite") {
      update((l) => setEdit(l, { anchor: s.anchor, text: s.text, source: "ai", original: s.original }));
    } else if (s.action === "explain") {
      update((l) => addNote(l, s.anchor, s.text, "ai"));
    }
    setSuggestion(null);
  }, [suggestion, update]);

  const acceptCard = useCallback(
    async (card: { question: string; answer: string }) => {
      const s = suggestion;
      if (!s || !value.onAddCard) return false;
      const ok = await value.onAddCard(card);
      if (ok) {
        update((l) => addCard(l, { ...card, anchor: s.anchor }));
        setSuggestion(null);
      }
      return ok;
    },
    [suggestion, value, update]
  );

  const focus = useMemo(() => practiceFocus(value.layer), [value.layer]);

  const api: PersonalApi = {
    ...value,
    editable,
    showOriginal,
    setShowOriginal,
    hideKnown,
    setHideKnown,
    editing,
    setEditing,
    noting,
    setNoting,
    asking,
    setAsking,
    suggestion,
    runSuggestion,
    retrySuggestion,
    dismissSuggestion,
    acceptSuggestion,
    acceptCard,
    guard,
    focus,
  };

  return <PersonalContext.Provider value={api}>{children}</PersonalContext.Provider>;
}

/** A card reply parsed for the draft, or null while it isn't one yet. */
export const cardFromSuggestion = (s: Suggestion | null) => (s && s.action === "card" ? parseCardText(s.text) : null);
