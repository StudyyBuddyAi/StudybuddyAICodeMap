import { useEffect, useRef, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Layers,
  Lightbulb,
  Loader2,
  Lock,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Stethoscope,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addAddition,
  addNote,
  anchorOf,
  anchorSection,
  removeAddition,
  removeEdit,
  removeNote,
  setEdit,
  toggleHidden,
  toggleKnown,
  updateAddition,
  updateNote,
  type LayerAddition,
  type LayerNote,
} from "@/lib/sheet-layer";
import { REWRITE_STYLES } from "@/lib/personalize";
import { cardFromSuggestion, usePersonal, type PersonalApi } from "./personal-context";
import { useBranchActions, useBranchesEnabled } from "@/components/sheet/branches/branch-context";

/** `**bold**` in a line the student or the AI wrote, rendered as the sheet renders it. */
export function BoldText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── The ⋯ menu on a line, item or row ───────────────────────────────────────

interface ItemMenuProps {
  anchor: string;
  /** What the student currently sees there. */
  effective: string;
  sectionTitle: string;
  /** Prose lines and list items can be edited; table rows can't. */
  canEdit: boolean;
}

const MENU_BUTTON =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-opacity duration-150 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100";

export function ItemMenu({ anchor, effective, sectionTitle, canEdit }: ItemMenuProps) {
  const p = usePersonal();
  // Subscribed to whether branches can grow, and nothing else: this menu is on every line.
  const branchesEnabled = useBranchesEnabled();
  const branches = useBranchActions();
  if (!p || p.readOnly) return null;
  // Branching is for every student, not only Pro. A mnemonic has nothing to branch into.
  const canBranch = branchesEnabled && !!branches && anchorSection(anchor) !== "memoryHooks";
  const { layer } = p;
  const edited = !!layer.edits[anchor];
  const known = layer.known.includes(anchor);
  const hidden = layer.hidden.includes(anchor);
  const locked = !p.entitled;
  const act = (fn: () => void) => () => p.guard(fn);
  const ai = (action: "rewrite" | "card" | "explain", label: string, style?: (typeof REWRITE_STYLES)[number]["style"]) =>
    act(() => p.runSuggestion({ anchor, action, label, style, original: effective, sectionTitle }));
  const lockIcon = locked ? <Lock className="ml-auto h-3 w-3 opacity-60" /> : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Your options for this line" className={MENU_BUTTON}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canBranch && (
          <>
            <DropdownMenuItem onSelect={() => branches!.openLine(anchor)}>
              <Stethoscope className="mr-2 h-4 w-4" /> Ask about this line
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {locked && (
          <>
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Pro · make this sheet yours
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {canEdit && (
          <DropdownMenuItem onSelect={act(() => p.setEditing(anchor))}>
            <Pencil className="mr-2 h-4 w-4" /> Edit {lockIcon}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Wand2 className="mr-2 h-4 w-4" /> Rewrite with AI
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {REWRITE_STYLES.map((s) => (
                <DropdownMenuItem key={s.style} onSelect={ai("rewrite", s.label, s.style)}>
                  <span className="flex flex-col">
                    <span>{s.label}</span>
                    <span className="text-[11px] text-muted-foreground">{s.hint}</span>
                  </span>
                  {lockIcon}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={act(() => p.setAsking(anchor))}>
                Ask for something else… {lockIcon}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem onSelect={ai("explain", "Explained")}>
          <Lightbulb className="mr-2 h-4 w-4" /> Explain it simply {lockIcon}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={ai("card", "New flashcard")}>
          <Layers className="mr-2 h-4 w-4" /> Make a flashcard {lockIcon}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={act(() => p.update((l) => toggleKnown(l, anchor)))}>
          <Check className="mr-2 h-4 w-4" /> {known ? "Mark as not known yet" : "I know this"} {lockIcon}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={act(() => p.setNoting(anchor))}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> Add a note {lockIcon}
        </DropdownMenuItem>
        {edited && (
          <DropdownMenuItem onSelect={act(() => p.update((l) => removeEdit(l, anchor)))}>
            <RotateCcw className="mr-2 h-4 w-4" /> Restore the original
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={act(() => p.update((l) => toggleHidden(l, anchor)))}>
          {hidden ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
          {hidden ? "Put it back on my sheet" : "Remove from my sheet"} {lockIcon}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Small markers ───────────────────────────────────────────────────────────

/** Says a line is the student's or an accepted AI rewrite, not what was generated. */
export function EditedMark({ source }: { source: "user" | "ai" }) {
  return (
    <span
      data-no-print
      title={source === "ai" ? "Rewritten with AI — not source-verified" : "Your edit"}
      className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full border border-border px-1.5 align-middle font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
    >
      {source === "ai" ? "AI edit" : "edited"}
    </span>
  );
}

// ── Inline editors ──────────────────────────────────────────────────────────

function useAutoFocus<T extends HTMLTextAreaElement | HTMLInputElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange?.(end, end);
  }, []);
  return ref;
}

interface TextEditorProps {
  initial: string;
  placeholder?: string;
  saveLabel?: string;
  hint?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

/** A textarea that saves on ⌘/Ctrl+Enter and cancels on Escape. */
export function TextEditor({ initial, placeholder, saveLabel = "Save", hint, onSave, onCancel }: TextEditorProps) {
  const [text, setText] = useState(initial);
  const ref = useAutoFocus<HTMLTextAreaElement>();
  const save = () => (text.trim() ? onSave(text.trim()) : onCancel());
  return (
    <div data-no-print className="mt-2 space-y-2" onMouseUp={(e) => e.stopPropagation()}>
      <Textarea
        ref={ref}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        className="min-h-[64px] resize-y text-sm leading-relaxed"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="h-7 text-xs" onClick={save}>
          {saveLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        {hint && <span className="ml-auto text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

// ── What sits under a line: editor, AI suggestion, notes ─────────────────────

interface ExtrasProps {
  anchor: string;
  /** What was generated for this line. */
  original: string;
  /** What the student currently sees there. */
  effective: string;
  sectionTitle: string;
}

export function PersonalExtras({ anchor, original, effective, sectionTitle }: ExtrasProps) {
  const p = usePersonal();
  if (!p) return null;
  const notes = p.layer.notes.filter((n) => n.anchor === anchor);
  const suggestion = p.suggestion?.anchor === anchor ? p.suggestion : null;
  if (!notes.length && !suggestion && p.editing !== anchor && p.noting !== anchor && p.asking !== anchor) return null;

  return (
    <div className="mt-1.5 space-y-2">
      {p.editing === anchor && (
        <TextEditor
          initial={effective}
          hint="**word** for bold · ⌘/Ctrl+Enter to save"
          onSave={(text) => {
            p.update((l) => setEdit(l, { anchor, text, source: "user", original }));
            p.setEditing(null);
          }}
          onCancel={() => p.setEditing(null)}
        />
      )}
      {p.asking === anchor && (
        <AskInput
          onAsk={(instruction) =>
            p.runSuggestion({ anchor, action: "rewrite", label: "Your rewrite", style: "custom", instruction, original: effective, sectionTitle })
          }
          onCancel={() => p.setAsking(null)}
        />
      )}
      {suggestion && <SuggestionCard api={p} />}
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} />
      ))}
      {p.noting === anchor && (
        <TextEditor
          initial=""
          placeholder="Your note on this line…"
          saveLabel="Add note"
          onSave={(text) => {
            p.update((l) => addNote(l, anchor, text));
            p.setNoting(null);
          }}
          onCancel={() => p.setNoting(null)}
        />
      )}
    </div>
  );
}

function AskInput({ onAsk, onCancel }: { onAsk: (instruction: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const ref = useAutoFocus<HTMLInputElement>();
  const ask = () => text.trim() && onAsk(text.trim().slice(0, 200));
  return (
    <div data-no-print className="mt-2 flex items-center gap-2" onMouseUp={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ask();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="How should the AI rewrite this line?"
        className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="button" size="sm" className="h-8 text-xs" onClick={ask} disabled={!text.trim()}>
        <Wand2 className="mr-1 h-3.5 w-3.5" /> Rewrite
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={onCancel} aria-label="Cancel">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

const SUGGESTION_FRAME =
  "rounded-md border border-primary/25 bg-primary/[0.04] px-3.5 py-3 text-sm leading-relaxed";

function SuggestionCard({ api }: { api: PersonalApi }) {
  const s = api.suggestion!;
  const loading = s.status === "loading";
  const card = cardFromSuggestion(s);

  return (
    <div data-no-print className={SUGGESTION_FRAME} onMouseUp={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-widest text-primary">
          <Sparkles className="h-3 w-3" /> {s.label}
        </span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Writing" />}
        <button
          type="button"
          onClick={api.dismissSuggestion}
          aria-label="Discard"
          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {s.status === "error" ? (
        <p className="text-muted-foreground">{s.error}</p>
      ) : s.action === "card" && s.status === "done" ? (
        card ? (
          <CardDraft initial={card} onAdd={api.acceptCard} onDiscard={api.dismissSuggestion} canAdd={!!api.onAddCard} />
        ) : (
          <p className="text-muted-foreground">That didn't come back as a card. Try again.</p>
        )
      ) : (
        <p className="whitespace-pre-line text-foreground/90">
          {s.text ? <BoldText text={s.text} /> : <span className="text-muted-foreground">Writing…</span>}
        </p>
      )}

      {s.action !== "card" || s.status !== "done" || !card ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {s.status === "done" && s.action !== "card" && (
            <Button type="button" size="sm" className="h-7 text-xs" onClick={api.acceptSuggestion}>
              {s.action === "rewrite" ? "Use this" : "Keep as a note"}
            </Button>
          )}
          {!loading && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={api.retrySuggestion}>
              Try again
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={api.dismissSuggestion}>
            {loading ? "Cancel" : "Discard"}
          </Button>
          {s.action === "rewrite" && s.status === "done" && (
            <span className="text-[11px] text-muted-foreground">Replaces the line · undo with “Restore the original”</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CardDraft({
  initial,
  onAdd,
  onDiscard,
  canAdd,
}: {
  initial: { question: string; answer: string };
  onAdd: (card: { question: string; answer: string }) => Promise<boolean>;
  onDiscard: () => void;
  canAdd: boolean;
}) {
  const [question, setQuestion] = useState(initial.question);
  const [answer, setAnswer] = useState(initial.answer);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Question</span>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} className={`${field} mt-1 resize-y`} />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Answer</span>
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} className={`${field} mt-1 resize-y`} />
      </label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={busy || !canAdd || !question.trim() || !answer.trim()}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            const ok = await onAdd({ question: question.trim(), answer: answer.trim() });
            setBusy(false);
            if (!ok) setFailed(true);
          }}
        >
          <Layers className="mr-1 h-3.5 w-3.5" /> {busy ? "Adding…" : "Add to my deck"}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onDiscard}>
          Discard
        </Button>
        {failed && <span className="text-[11px] text-destructive">Couldn't add it. Try again.</span>}
      </div>
    </div>
  );
}

function NoteCard({ note }: { note: LayerNote }) {
  const p = usePersonal()!;
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <TextEditor
        initial={note.text}
        saveLabel="Save note"
        onSave={(text) => {
          p.update((l) => updateNote(l, note.id, text));
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="group/note flex gap-2 rounded-md border-l-2 border-l-primary/50 bg-secondary/50 px-3 py-2 text-[13px] leading-relaxed text-foreground/85">
      <span className="flex-1 whitespace-pre-line">
        {note.source === "ai" && (
          <span className="mr-1.5 inline-flex items-center gap-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-primary">
            <Sparkles className="h-2.5 w-2.5" /> AI
          </span>
        )}
        <BoldText text={note.text} />
      </span>
      {p.editable && (
        <span data-no-print className="flex shrink-0 items-start gap-0.5 opacity-60 transition-opacity group-hover/note:opacity-100">
          <button type="button" aria-label="Edit note" onClick={() => setEditing(true)} className="rounded p-1 hover:bg-secondary">
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Delete note"
            onClick={() => p.update((l) => removeNote(l, note.id))}
            className="rounded p-1 hover:bg-secondary"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  );
}

// ── Points the student added ────────────────────────────────────────────────

export function AdditionRow({ addition, index }: { addition: LayerAddition; index?: number }) {
  const p = usePersonal()!;
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <TextEditor
        initial={addition.text}
        onSave={(text) => {
          p.update((l) => updateAddition(l, addition.id, text));
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <span className="group/item flex gap-2.5">
      {index !== undefined && (
        <span
          aria-hidden
          className="w-5 shrink-0 text-right font-mono text-xs font-medium tabular-nums text-primary/70"
        >
          {index}.
        </span>
      )}
      <span className="flex-1">
        <BoldText text={addition.text} />
        <span
          data-no-print
          title="You added this"
          className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full bg-primary/10 px-1.5 align-middle font-mono text-[9px] font-medium uppercase tracking-wider text-primary"
        >
          yours
        </span>
      </span>
      {p.editable && (
        <span data-no-print className="flex shrink-0 items-start gap-0.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100">
          <button type="button" aria-label="Edit your point" onClick={() => setEditing(true)} className="rounded p-1 hover:bg-secondary">
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Delete your point"
            onClick={() => p.update((l) => removeAddition(l, addition.id))}
            className="rounded p-1 hover:bg-secondary"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      )}
    </span>
  );
}

// ── The foot of a section ───────────────────────────────────────────────────

interface FooterProps {
  sectionKey: string;
  /** Lists and prose take added points; tables don't. */
  canAdd: boolean;
  /** Items hidden from view here by "hide what I know". */
  knownHidden: number;
}

const FOOTER_BUTTON =
  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

export function SectionFooter({ sectionKey, canAdd, knownHidden }: FooterProps) {
  const p = usePersonal();
  const [adding, setAdding] = useState(false);
  if (!p) return null;
  const end = anchorOf(sectionKey, "end");
  const notes = p.layer.notes.filter((n) => n.anchor === end);
  const showButtons = !p.readOnly;

  return (
    <div className="mt-2 space-y-2">
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} />
      ))}
      {p.noting === end && (
        <TextEditor
          initial=""
          placeholder="Your note on this section…"
          saveLabel="Add note"
          onSave={(text) => {
            p.update((l) => addNote(l, end, text));
            p.setNoting(null);
          }}
          onCancel={() => p.setNoting(null)}
        />
      )}
      {adding && (
        <TextEditor
          initial=""
          placeholder="Your own point for this section…"
          saveLabel="Add point"
          onSave={(text) => {
            p.update((l) => addAddition(l, sectionKey, text));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {(showButtons || knownHidden > 0) && !adding && p.noting !== end && (
        <div
          data-no-print
          className="flex flex-wrap items-center gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/section:opacity-100 [@media(hover:hover)]:group-focus-within/section:opacity-100"
        >
          {showButtons && canAdd && (
            <button type="button" className={FOOTER_BUTTON} onClick={() => p.guard(() => setAdding(true))}>
              <Plus className="h-3.5 w-3.5" /> Add a point {!p.entitled && <Lock className="h-3 w-3 opacity-60" />}
            </button>
          )}
          {showButtons && (
            <button type="button" className={FOOTER_BUTTON} onClick={() => p.guard(() => p.setNoting(end))}>
              <MessageSquarePlus className="h-3.5 w-3.5" /> Note {!p.entitled && <Lock className="h-3 w-3 opacity-60" />}
            </button>
          )}
          {knownHidden > 0 && (
            <button type="button" className={FOOTER_BUTTON} onClick={() => p.setHideKnown(false)}>
              <Eye className="h-3.5 w-3.5" /> {knownHidden} known hidden
            </button>
          )}
        </div>
      )}
    </div>
  );
}
