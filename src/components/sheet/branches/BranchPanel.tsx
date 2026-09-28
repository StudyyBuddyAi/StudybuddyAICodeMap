import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  GitBranch,
  Loader2,
  PenLine,
  RefreshCw,
  RotateCcw,
  Send,
  Sprout,
  Trash2,
  X,
} from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { useBranchDraft, type BranchesApi } from "@/hooks/use-sheet-branches";
import { BRANCH_TYPE_LABEL, plainText, type BranchQuestion } from "@/lib/sheet-branches";
import { anchorSection, type LayerBranch, type LayerPill } from "@/lib/sheet-layer";
import { ENTER, EXIT } from "@/lib/motion";
import { BRANCH_ICON } from "./branch-context";
import { Bold, BranchMarkdown } from "./BranchMarkdown";
import { BranchChip } from "./BranchChip";
import { branchesAt } from "./LineBranches";

/**
 * Where a branch is read, grown and changed: beside the sheet on a wide
 * screen, so the line it grew from stays in view; a sheet from the bottom on
 * a phone. It shows one branch, one line (to branch from any line of the
 * sheet), or every branch as a tree.
 */

const DESKTOP = "(min-width: 1024px)";

function useDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(DESKTOP);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true
  );
}

/** Scrolls the sheet to a line and flashes it, so the student sees where a branch grew from. */
export function jumpToAnchor(anchor: string) {
  const el =
    (!anchor.endsWith(":end") && document.querySelector<HTMLElement>(`[data-enh-anchor="${CSS.escape(anchor)}"]`)) ||
    document.querySelector<HTMLElement>(`[data-section-key="${CSS.escape(anchorSection(anchor))}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.animate?.([{ backgroundColor: "hsl(var(--primary) / 0.16)" }, { backgroundColor: "transparent" }], {
    duration: 1600,
    easing: "ease-out",
  });
}

const Caret = () => <span aria-hidden className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-primary/70" />;

// ── The panel ─────────────────────────────────────────────────────────────────

export function BranchPanel({ api }: { api: BranchesApi }) {
  const desktop = useDesktop();
  const open = api.panel !== null;

  if (!desktop) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && api.close()} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerTitle className="sr-only">Branches</DrawerTitle>
          <DrawerDescription className="sr-only">Grow, read and change this sheet's branches.</DrawerDescription>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
            <PanelBody api={api} onJump={(a) => {
              api.close();
              // After the sheet has closed, or the scroll fights its animation.
              window.setTimeout(() => jumpToAnchor(a), 320);
            }} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <m.aside
          key="branch-panel"
          aria-label="Branches"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: ENTER }}
          exit={{ opacity: 0, x: 24, transition: EXIT }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) api.close();
          }}
          className="fixed bottom-0 right-0 z-30 flex w-[400px] flex-col border-l border-border bg-card shadow-[var(--shadow-2)] xl:w-[440px] print:hidden"
          style={{ top: "var(--nav-h, 64px)" }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
            <PanelBody api={api} onJump={jumpToAnchor} />
          </div>
        </m.aside>
      )}
    </AnimatePresence>
  );
}

function PanelBody({ api, onJump }: { api: BranchesApi; onJump: (anchor: string) => void }) {
  const count = api.branches.length;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {api.panel === "all" ? (
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            <GitBranch aria-hidden className="h-3.5 w-3.5" />
            Your branches{count ? ` · ${count}` : ""}
          </p>
        ) : (
          <button
            type="button"
            onClick={api.openAll}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            All branches{count ? ` · ${count}` : ""}
          </button>
        )}
        <button
          type="button"
          onClick={api.close}
          aria-label="Close branches"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {api.panel === "branch" && api.openId ? (
        <BranchView key={api.openId} api={api} id={api.openId} onJump={onJump} />
      ) : api.panel === "line" && api.lineAnchor ? (
        <LineView key={api.lineAnchor} api={api} anchor={api.lineAnchor} onJump={onJump} />
      ) : (
        <AllView api={api} onJump={onJump} />
      )}
    </div>
  );
}

// ── Where it grew from ────────────────────────────────────────────────────────

function Trail({
  api,
  anchor,
  path,
  onJump,
}: {
  api: BranchesApi;
  anchor: string;
  path: LayerBranch[];
  onJump: (anchor: string) => void;
}) {
  const line = api.lineOf(anchor);
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {api.sectionTitleOf(anchor)}
      </p>
      {line && !anchor.endsWith(":end") && (
        <button
          type="button"
          onClick={() => onJump(anchor)}
          title="Show this line in the sheet"
          className="block w-full rounded-md border-l-2 border-border py-0.5 pl-2.5 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
        >
          <span className="line-clamp-3">
            <Bold text={line} />
          </span>
        </button>
      )}
      {path.length > 0 && (
        <nav aria-label="Branches above this one" className="flex flex-wrap items-center gap-1 pt-0.5 text-xs">
          {path.map((p) => {
            const Icon = BRANCH_ICON[p.type];
            return (
              <span key={p.id} className="inline-flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => api.open(p.id)}
                  className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Icon aria-hidden className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.label}</span>
                </button>
                <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              </span>
            );
          })}
        </nav>
      )}
    </div>
  );
}

// ── One branch ────────────────────────────────────────────────────────────────

function BranchView({ api, id, onJump }: { api: BranchesApi; id: string; onJump: (anchor: string) => void }) {
  const branch = api.branches.find((b) => b.id === id);
  const growing = api.growing[id];
  const draft = useBranchDraft(api.drafts, growing?.status === "growing" ? id : null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!branch && !growing) {
    return <p className="text-sm text-muted-foreground">This branch is gone.</p>;
  }

  const q: BranchQuestion = branch ?? growing!.question;
  const anchor = branch?.anchor ?? growing!.anchor;
  const parentId = branch?.parentId ?? growing?.parentId;
  const path = branch ? api.pathOf(id) : parentId ? [...api.pathOf(parentId), ...api.branches.filter((b) => b.id === parentId)] : [];
  const Icon = BRANCH_ICON[q.type];
  const isGrowing = growing?.status === "growing";
  const failed = growing?.status === "error";
  const children = api.branches.filter((b) => b.parentId === id);
  const childGrowing = Object.values(api.growing).filter((g) => g.parentId === id && !api.branches.some((b) => b.id === g.id));
  const canBranch = !!branch && api.canBranch(id) && !isGrowing;

  const copy = async () => {
    if (!branch) return;
    try {
      await navigator.clipboard.writeText(`${branch.label}\n\n${plainText(branch.text)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <article className="space-y-4">
      <Trail api={api} anchor={anchor} path={path} onJump={onJump} />

      <header className="space-y-1.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-info text-info-foreground shadow-[0_3px_10px_-4px_hsl(var(--info)/0.55)]">
            <Icon aria-hidden className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-snug text-foreground">{q.label}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              <span>
                {BRANCH_TYPE_LABEL[q.type]}
                {q.versus ? ` · vs ${q.versus}` : ""}
              </span>
              {/* Where it says it is being written, so the text below never moves when it is done. */}
              {isGrowing && (
                <span className="inline-flex items-center gap-1 text-info" aria-live="polite">
                  <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
                  {growing?.replaces ? "Growing again" : "Growing"}
                </span>
              )}
            </p>
          </div>
        </div>
        {q.ask && q.ask !== q.label && q.type !== "note" && (
          <p className="text-xs leading-relaxed text-muted-foreground">{q.ask}</p>
        )}
      </header>

      {isGrowing ? (
        <div aria-busy="true">
          {draft ? (
            <BranchMarkdown text={draft} caret={<Caret />} />
          ) : (
            <div className="space-y-2">
              {[92, 78, 85].map((w) => (
                <div key={w} className="h-3 animate-pulse rounded bg-secondary" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
        </div>
      ) : editing && branch ? (
        <BranchEditor
          initial={branch.text}
          onSave={(text) => {
            api.edit(id, text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {failed && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 px-3 py-2 text-xs text-warning">
              <span className="flex-1">{branch ? "Couldn't grow it again — here is what it said." : "Couldn't grow this branch."}</span>
              <button type="button" onClick={() => api.retry(id)} className="inline-flex items-center gap-1 font-medium hover:underline">
                <RotateCcw aria-hidden className="h-3 w-3" /> Try again
              </button>
              <button type="button" onClick={() => api.dismiss(id)} className="text-muted-foreground hover:text-foreground">
                Dismiss
              </button>
            </div>
          )}
          {branch && <BranchMarkdown text={branch.text} />}
        </>
      )}

      {branch && !isGrowing && !editing && (
        <>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {branch.source === "user"
              ? "Your note."
              : branch.covered
              ? "Backed by the passages this sheet was built on."
              : "Written from general medical knowledge — check it before clinical use."}
            {branch.edited ? " Edited by you." : ""}
          </p>

          {!api.readOnly && (
            <div className="flex flex-wrap items-center gap-1 border-y border-border py-1.5">
              <PanelAction icon={PenLine} label="Edit" onClick={() => setEditing(true)} />
              {branch.source === "ai" && <PanelAction icon={RefreshCw} label="Grow again" onClick={() => api.regrow(id)} />}
              <PanelAction icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy"} onClick={copy} />
              <span className="ml-auto">
                {confirmDelete ? (
                  <span className="inline-flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {children.length ? `Delete it and the ${children.length} grown from it?` : "Delete it?"}
                    </span>
                    <button type="button" onClick={() => api.remove(id)} className="font-medium text-danger hover:underline">
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:text-foreground">
                      Keep
                    </button>
                  </span>
                ) : (
                  <PanelAction icon={Trash2} label="Delete" onClick={() => setConfirmDelete(true)} />
                )}
              </span>
            </div>
          )}
        </>
      )}

      {branch && !editing && (children.length > 0 || childGrowing.length > 0 || (canBranch && !api.readOnly)) && (
        <section className="space-y-2.5">
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            <Sprout aria-hidden className="h-3.5 w-3.5" /> Go further
          </p>
          <div className="flex flex-wrap gap-1.5">
            {children.map((c) => (
              <GrownPill key={c.id} branch={c} onClick={() => api.open(c.id)} />
            ))}
            {childGrowing.map((g) => (
              <BranchChip
                key={g.id}
                size="md"
                type={g.question.type}
                label={g.question.label}
                state={g.status === "error" ? "error" : "growing"}
                onClick={() => api.open(g.id)}
              />
            ))}
            {canBranch &&
              !api.readOnly &&
              branch.next
                .filter((n) => !children.some((c) => c.label === n.label) && !childGrowing.some((g) => g.question.label === n.label))
                .map((n) => (
                  <SuggestedPill key={n.label} q={n} disabled={!api.enabled} onClick={() => api.growNext(id, n)} />
                ))}
          </div>
          {canBranch && !api.readOnly && api.enabled && (
            <Composer
              askPlaceholder="Ask something about this branch…"
              onAsk={(text) => api.ask({ anchor: branch.anchor, parentId: id }, text)}
              onWrite={(label, text) => api.write({ anchor: branch.anchor, parentId: id }, label, text)}
            />
          )}
        </section>
      )}
    </article>
  );
}

function PanelAction({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function GrownPill({ branch, onClick }: { branch: LayerBranch; onClick: () => void }) {
  return (
    <BranchChip size="md" type={branch.type} label={branch.label} state="grown" onClick={onClick} title={branch.ask || branch.label} />
  );
}

function SuggestedPill({ q, disabled, onClick }: { q: BranchQuestion | LayerPill; disabled?: boolean; onClick: () => void }) {
  return <BranchChip size="md" type={q.type} label={q.label} state="suggested" onClick={onClick} disabled={disabled} title={q.ask} />;
}

// ── Writing ───────────────────────────────────────────────────────────────────

function BranchEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="min-h-[240px] font-mono text-[13px] leading-relaxed"
        aria-label="This branch, to edit"
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        **bold** · 1. steps · - points · | table | rows · &gt; a callout. Emptying it deletes the branch.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(text)}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** Ask the AI a question of your own, or write a branch yourself. */
function Composer({
  askPlaceholder,
  onAsk,
  onWrite,
}: {
  askPlaceholder: string;
  onAsk: (text: string) => void;
  onWrite: (label: string, text: string) => void;
}) {
  const [mode, setMode] = useState<"ask" | "write">("ask");
  const [question, setQuestion] = useState("");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");

  if (mode === "write") {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-2.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder="Title (optional)"
          aria-label="Your branch's title"
          className="w-full bg-transparent px-1 text-sm font-medium outline-none placeholder:text-muted-foreground"
        />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write it in your own words…"
          aria-label="Your branch"
          className="min-h-[110px] text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => setMode("ask")} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => {
              onWrite(label, text);
              setLabel("");
              setText("");
              setMode("ask");
            }}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Add branch
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <form
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:border-info/50"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim()) return;
          onAsk(question);
          setQuestion("");
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          placeholder={askPlaceholder}
          aria-label={askPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!question.trim()}
          aria-label="Grow the answer"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-info transition-colors hover:bg-info/10 disabled:text-muted-foreground disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
      <button type="button" onClick={() => setMode("write")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
        or write your own branch
      </button>
    </div>
  );
}

// ── One line ─────────────────────────────────────────────────────────────────

function LineView({ api, anchor, onJump }: { api: BranchesApi; anchor: string; onJump: (anchor: string) => void }) {
  const { grown, growing, pills } = branchesAt(api, anchor);
  return (
    <div className="space-y-4">
      <Trail api={api} anchor={anchor} path={[]} onJump={onJump} />
      <h2 className="text-[15px] font-semibold text-foreground">Branch from this line</h2>
      {(grown.length > 0 || growing.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {grown.map((b) => (
            <GrownPill key={b.id} branch={b} onClick={() => api.open(b.id)} />
          ))}
          {growing.map((g) => (
            <BranchChip
              key={g.id}
              size="md"
              type={g.question.type}
              label={g.question.label}
              state={g.status === "error" ? "error" : "growing"}
              onClick={() => api.open(g.id)}
            />
          ))}
        </div>
      )}
      {pills.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Suggested</p>
          <div className="flex flex-wrap gap-1.5">
            {pills.map((p) => (
              <SuggestedPill key={p.id} q={p} disabled={!api.enabled} onClick={() => api.growPill(p)} />
            ))}
          </div>
        </div>
      )}
      {api.enabled ? (
        <Composer
          askPlaceholder="Ask something about this line…"
          onAsk={(text) => api.ask({ anchor }, text)}
          onWrite={(label, text) => api.write({ anchor }, label, text)}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Branches can be grown once the sheet has finished.</p>
      )}
    </div>
  );
}

// ── Every branch ─────────────────────────────────────────────────────────────

function AllView({ api, onJump }: { api: BranchesApi; onJump: (anchor: string) => void }) {
  const kept = new Set(api.branches.map((b) => b.id));
  const growingTop = Object.values(api.growing).filter((g) => !g.parentId && !kept.has(g.id));
  const taken = new Set([...api.branches.map((b) => b.pillId), ...Object.values(api.growing).map((g) => g.pillId)]);
  const sections = api.sectionOrder
    .map((key) => ({
      key,
      title: api.sectionTitleOf(`${key}:0`),
      roots: api.branches.filter((b) => !b.parentId && anchorSection(b.anchor) === key),
      growing: growingTop.filter((g) => anchorSection(g.anchor) === key),
      pills: api.readOnly ? [] : api.pills.filter((p) => anchorSection(p.anchor) === key && !taken.has(p.id)),
    }))
    .filter((s) => s.roots.length || s.growing.length || s.pills.length);

  const status: ReactNode = api.suggesting ? (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-info" /> Finding the branches worth growing…
    </p>
  ) : api.suggestFailed ? (
    <p className="flex items-center gap-2 text-xs text-warning">
      Couldn't find branches for this sheet.
      <button type="button" onClick={api.suggest} className="font-medium hover:underline">
        Try again
      </button>
    </p>
  ) : null;

  return (
    <div className="space-y-5">
      {status}
      {api.picksPending && api.enabled && (
        <button
          type="button"
          onClick={api.growPicks}
          className="flex w-full items-center gap-3 rounded-xl border border-info/25 bg-info-soft px-3.5 py-3 text-left transition-colors hover:border-info/60"
        >
          <Sprout aria-hidden className="h-4 w-4 shrink-0 text-info" />
          <span className="flex-1">
            <span className="block text-sm font-medium text-foreground">Make it comprehensive</span>
            <span className="block text-xs text-muted-foreground">Grows the two most useful branches in each section.</span>
          </span>
        </button>
      )}
      {!sections.length && !api.suggesting && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          No branches yet. Under the lines of the sheet are the questions worth asking next — pick one to grow it here, or
          choose <span className="font-medium text-foreground">Branch from this line</span> in any line's menu to ask your own.
        </p>
      )}
      {sections.map((s) => (
        <section key={s.key} className="space-y-2">
          <button
            type="button"
            onClick={() => onJump(`${s.key}:end`)}
            className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            {s.title}
          </button>
          <ul className="space-y-0.5">
            {s.roots.map((b) => (
              <TreeRow key={b.id} api={api} branch={b} depth={0} />
            ))}
            {s.growing.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => api.open(g.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary"
                >
                  {g.status === "error" ? (
                    <RotateCcw aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-info" />
                  )}
                  <span className="truncate">{g.question.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {s.pills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pl-2">
              {s.pills.map((p) => (
                <SuggestedPill key={p.id} q={p} disabled={!api.enabled} onClick={() => api.growPill(p)} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function TreeRow({ api, branch, depth }: { api: BranchesApi; branch: LayerBranch; depth: number }) {
  const Icon = BRANCH_ICON[branch.type];
  const children = api.branches.filter((b) => b.parentId === branch.id);
  const growing = !!api.growing[branch.id];
  return (
    <li>
      <button
        type="button"
        onClick={() => api.open(branch.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-secondary"
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        {growing ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-info" />
        ) : (
          <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-info" />
        )}
        <span className="truncate">{branch.label}</span>
        {branch.edited && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">edited</span>}
      </button>
      {children.length > 0 && (
        <ul className="space-y-0.5">
          {children.map((c) => (
            <TreeRow key={c.id} api={api} branch={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
