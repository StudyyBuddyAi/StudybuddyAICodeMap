import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  CornerDownRight,
  Loader2,
  PenLine,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { useBranchDraft, useBranchesApi, type BranchesApi, type BranchesStore, type GrowingBranch } from "@/hooks/use-sheet-branches";
import {
  ASK_FORMATS,
  ASK_FORMAT_LABEL,
  BRANCH_TYPE_LABEL,
  plainText,
  type AskFormat,
  type BranchQuestion,
} from "@/lib/sheet-branches";
import { anchorSection, type LayerBranch, type LayerPill } from "@/lib/sheet-layer";
import { ENTER, EXIT } from "@/lib/motion";
import { Bold, BranchMarkdown } from "./BranchMarkdown";
import { BranchChip } from "./BranchChip";
import { EcgTrace, KindBadge, kindStyle } from "./kind";
import { branchesAt } from "./LineBranches";

/**
 * Where a deep dive is read, written and changed: beside the sheet on a wide
 * screen, so the line it grew from stays in view; a sheet from the bottom on a
 * phone. One deep dive reads as a consult note — what it is regarding, the
 * question, the answer, and a sign-off saying what it rests on and whether it
 * was checked. The panel also shows one line (to ask about it, or about words
 * selected on it) and every deep dive, with a box to ask anything at all.
 *
 * It subscribes to the whole of the branches' store — it shows most of it —
 * and is the only part of the page that does.
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

/** Scrolls the sheet to a line and flashes it, so the student sees where a deep dive grew from. */
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

const Caret = () => <span aria-hidden className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-foreground/60" />;

/** Whether a deep dive in flight is still being written or checked — not failed, not declined. */
const inProgress = (g?: GrowingBranch) => g?.status === "growing" || g?.status === "reviewing";

/** How many deep dives hang below one, at any depth. */
function descendants(branches: LayerBranch[], id: string): number {
  let n = 0;
  const stack = [id];
  while (stack.length) {
    const parent = stack.pop()!;
    for (const b of branches) {
      if (b.parentId !== parent) continue;
      n++;
      stack.push(b.id);
    }
  }
  return n;
}

/** A note's date, the way a chart dates an entry: "29 Sep". */
const noteDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** The small caps of a chart: a field's name, a band's heading. */
const EYEBROW = "font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground";

// ── The panel ─────────────────────────────────────────────────────────────────

export function BranchPanel({ store }: { store: BranchesStore }) {
  const api = useBranchesApi(store)!;
  const desktop = useDesktop();
  const open = api.panel !== null;

  // Focus goes into the panel when it opens and back to what opened it when
  // it closes — a keyboard student otherwise lands at the top of the page.
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      // After the panel has mounted and animated in.
      window.setTimeout(() => heading.current?.focus({ preventScroll: true }), 60);
    }
    if (!open && wasOpen.current) {
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  if (!desktop) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && api.close()} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerTitle className="sr-only">Deep dives</DrawerTitle>
          <DrawerDescription className="sr-only">Read, ask for and change this sheet's deep dives.</DrawerDescription>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
            <PanelBody
              api={api}
              headingRef={heading}
              onJump={(a) => {
                api.close();
                // After the sheet has closed, or the scroll fights its animation.
                window.setTimeout(() => jumpToAnchor(a), 320);
              }}
            />
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
          aria-label="Deep dives"
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
            <PanelBody api={api} headingRef={heading} onJump={jumpToAnchor} />
          </div>
        </m.aside>
      )}
    </AnimatePresence>
  );
}

function PanelBody({
  api,
  onJump,
  headingRef,
}: {
  api: BranchesApi;
  onJump: (anchor: string) => void;
  headingRef: React.RefObject<HTMLDivElement>;
}) {
  const count = api.branches.length;
  return (
    <div className="space-y-5">
      <div ref={headingRef} tabIndex={-1} className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        {api.panel === "all" ? (
          <p className={`flex items-center gap-1.5 ${EYEBROW}`}>
            <Stethoscope aria-hidden className="h-3.5 w-3.5" />
            Your deep dives{count ? ` · ${count}` : ""}
          </p>
        ) : (
          <button
            type="button"
            onClick={api.openAll}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            All deep dives{count ? ` · ${count}` : ""}
          </button>
        )}
        <button
          type="button"
          onClick={api.close}
          aria-label="Close deep dives"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {api.panel === "branch" && api.openId ? (
        <BranchView key={api.openId} api={api} id={api.openId} onJump={onJump} />
      ) : api.panel === "line" && api.lineAnchor ? (
        <LineView key={`${api.lineAnchor}|${api.lineFocus ?? ""}`} api={api} anchor={api.lineAnchor} onJump={onJump} />
      ) : (
        <AllView api={api} onJump={onJump} />
      )}
    </div>
  );
}

// ── A note's fields ──────────────────────────────────────────────────────────

/** A chart field: its name in small caps, what it says beside it. */
function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className={`${EYEBROW} pt-[3px]`}>{name}</dt>
      <dd className="min-w-0 text-xs leading-relaxed text-muted-foreground">{children}</dd>
    </>
  );
}

/** What a note is regarding: the line of the sheet (click to see it there), or its section as a whole. */
function ReField({ api, anchor, onJump }: { api: BranchesApi; anchor: string; onJump: (anchor: string) => void }) {
  const line = api.lineOf(anchor);
  if (anchor.endsWith(":end") || !line) return <Field name="Re">{api.sectionTitleOf(anchor)} — the section as a whole</Field>;
  return (
    <Field name="Re">
      <button
        type="button"
        onClick={() => onJump(anchor)}
        title="Show this line in the sheet"
        className="block w-full text-left transition-colors hover:text-foreground"
      >
        <span className="line-clamp-3">
          <Bold text={line} />
        </span>
      </button>
    </Field>
  );
}

/** Where a follow-up came from: the notes above it, each one click away. */
function FromField({ api, path }: { api: BranchesApi; path: LayerBranch[] }) {
  if (!path.length) return null;
  return (
    <Field name="From">
      <nav aria-label="Deep dives above this one" className="flex flex-wrap items-center gap-1">
        {path.map((p) => (
          <span key={p.id} className="inline-flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={() => api.open(p.id)}
              className="inline-flex min-w-0 items-center gap-1 rounded px-0.5 transition-colors hover:text-foreground"
            >
              <KindBadge type={p.type} />
              <span className="truncate">{p.label}</span>
            </button>
            <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          </span>
        ))}
      </nav>
    </Field>
  );
}

// ── The sign-off ─────────────────────────────────────────────────────────────

/**
 * How a note ends: what it rests on, what the clinical check made of it, and
 * its date — the way a chart entry is signed. A correction or a flag is spelt
 * out above it.
 */
function SignOff({ branch, checking }: { branch: LayerBranch; checking: boolean }) {
  // While it is being checked, the verdict it had (unchecked, as kept) is not the news.
  const review = branch.source === "ai" && !checking ? branch.review : undefined;
  const source =
    branch.source === "user"
      ? "Your note"
      : branch.covered
      ? "From the reference library"
      : "From general medical knowledge — check before clinical use";
  const verdict =
    branch.source !== "ai" ? null : checking ? (
      <span className="inline-flex items-center gap-1 text-[hsl(var(--kind-ask))]" aria-live="polite">
        <EcgTrace className="h-2.5 w-5" /> Checking for clinical errors
      </span>
    ) : review?.verdict === "ok" ? (
      <span className="inline-flex items-center gap-1 text-success">
        <ShieldCheck aria-hidden className="h-3 w-3" /> Checked
      </span>
    ) : review?.verdict === "corrected" ? (
      <span className="inline-flex items-center gap-1 text-success">
        <ShieldCheck aria-hidden className="h-3 w-3" /> Corrected after check
      </span>
    ) : review?.verdict === "flagged" ? (
      <span className="inline-flex items-center gap-1 text-warning">
        <ShieldAlert aria-hidden className="h-3 w-3" /> Flagged by check
      </span>
    ) : review?.verdict === "unchecked" ? (
      <span className="inline-flex items-center gap-1 text-warning">
        <ShieldAlert aria-hidden className="h-3 w-3" /> Not checked — read with care
      </span>
    ) : null;
  const date = noteDate(branch.at);

  return (
    <div className="space-y-2">
      {(review?.verdict === "corrected" || review?.verdict === "flagged") && (
        <div
          className={`rounded-md border px-2.5 py-2 text-[11px] leading-relaxed text-foreground/80 ${
            review.verdict === "corrected" ? "border-success/35 bg-success-soft" : "border-warning/40 bg-warning-soft"
          }`}
        >
          <p className={`font-medium ${review.verdict === "corrected" ? "text-success" : "text-warning"}`}>
            {review.verdict === "corrected" ? "Corrected after a clinical check" : "A clinical check flagged this — the text above is as written"}
          </p>
          <ul className="mt-1 space-y-0.5 pl-4">
            {review.fixes.map((f) => (
              <li key={f} className="list-disc">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-border pt-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
        <span>{source}</span>
        {verdict && <span aria-hidden>·</span>}
        {verdict}
        {date && <span aria-hidden>·</span>}
        {date && <span>{date}</span>}
        {branch.edited && <span aria-hidden>·</span>}
        {branch.edited && <span>Edited by you</span>}
      </p>
    </div>
  );
}

// ── One deep dive ─────────────────────────────────────────────────────────────

function BranchView({ api, id, onJump }: { api: BranchesApi; id: string; onJump: (anchor: string) => void }) {
  const branch = api.branches.find((b) => b.id === id);
  const growing = api.growing[id];
  const draft = useBranchDraft(api.drafts, inProgress(growing) ? id : null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRegrow, setConfirmRegrow] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!branch && !growing) {
    return <p className="text-sm text-muted-foreground">This deep dive is gone.</p>;
  }

  const q: BranchQuestion = branch ?? growing!.question;
  const anchor = branch?.anchor ?? growing!.anchor;
  const parentId = branch?.parentId ?? growing?.parentId;
  const path = branch ? api.pathOf(id) : parentId ? [...api.pathOf(parentId), ...api.branches.filter((b) => b.id === parentId)] : [];
  const writing = growing?.status === "growing";
  const checking = growing?.status === "reviewing";
  // A deep dive kept and being checked reads like any other; only one not kept yet shows its draft.
  const isGrowing = writing || (checking && !branch);
  const failed = growing?.status === "error";
  const declined = growing?.status === "declined";
  const children = api.branches.filter((b) => b.parentId === id);
  const childGrowing = Object.values(api.growing).filter(
    (g) => g.parentId === id && g.status !== "declined" && !api.branches.some((b) => b.id === g.id)
  );
  const canBranch = !!branch && api.canBranch(id) && !isGrowing;
  // At the depth limit a question is still welcome: it goes beside this note rather than below it.
  const askTarget = branch ? { anchor: branch.anchor, parentId: canBranch ? id : branch.parentId } : null;
  const below = branch ? descendants(api.branches, id) : 0;
  const suggestions = canBranch
    ? branch!.next.filter((n) => !children.some((c) => c.label === n.label) && !childGrowing.some((g) => g.question.label === n.label))
    : [];

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

  const regrow = () => {
    setConfirmRegrow(false);
    api.regrow(id);
  };

  return (
    <article className="space-y-4" style={kindStyle(q.type)}>
      <div className="overflow-hidden rounded-[13px] border border-border bg-background/50">
        {/* The band: its kind, where on the sheet it belongs, and what is happening to it — where
            the status sits, so the text below never moves when it is done. */}
        <div className="flex items-center gap-2 border-b border-border bg-secondary/60 px-3.5 py-2">
          <KindBadge type={q.type} size="md" />
          <span className={`min-w-0 flex-1 truncate ${EYEBROW}`}>
            {BRANCH_TYPE_LABEL[q.type]}
            {q.versus ? ` · vs ${q.versus}` : ""}
            {` · ${api.sectionTitleOf(anchor)}`}
          </span>
          {(isGrowing || checking) && (
            <span
              className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--k))]"
              aria-live="polite"
            >
              <EcgTrace className="h-3 w-6" />
              {checking ? "Checking" : growing?.replaces ? "Writing again" : "Writing"}
            </span>
          )}
        </div>

        <div className="space-y-3.5 px-4 py-3.5">
          <dl className="grid grid-cols-[2.6rem_1fr] gap-x-2 gap-y-1.5">
            <ReField api={api} anchor={anchor} onJump={onJump} />
            <FromField api={api} path={path} />
            {growing?.focus && <Field name="On">“{growing.focus}”</Field>}
            {q.ask && q.ask !== q.label && q.type !== "note" && <Field name="Q">{q.ask}</Field>}
          </dl>

          <h2 className="font-display text-[21px] font-medium leading-snug text-foreground [text-wrap:balance]">{q.label}</h2>

          {declined ? (
            <div className="space-y-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground/85">
              <p>{growing?.message}</p>
              <button type="button" onClick={() => api.dismiss(id)} className="text-xs font-medium text-primary hover:underline">
                OK
              </button>
            </div>
          ) : isGrowing ? (
            <div aria-busy="true">
              {draft ? (
                <BranchMarkdown text={draft} caret={checking ? undefined : <Caret />} />
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
                  <span className="flex-1">{branch ? "Couldn't write it again — here is what it said." : "Couldn't write this deep dive."}</span>
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

          {branch && !isGrowing && !editing && !declined && <SignOff branch={branch} checking={checking} />}
        </div>
      </div>

      {branch && !isGrowing && !editing && !declined && !api.readOnly && (
        <div className="flex flex-wrap items-center gap-1">
          {confirmRegrow ? (
            <span className="inline-flex flex-wrap items-center gap-2 px-1 text-xs">
              <span className="text-muted-foreground">Writing it again replaces your edits.</span>
              <button type="button" onClick={regrow} className="font-medium text-primary hover:underline">
                Write again
              </button>
              <button type="button" onClick={() => setConfirmRegrow(false)} className="text-muted-foreground hover:text-foreground">
                Keep mine
              </button>
            </span>
          ) : (
            <>
              <PanelAction icon={PenLine} label="Edit" onClick={() => setEditing(true)} />
              {branch.source === "ai" && (
                <PanelAction icon={RefreshCw} label="Write again" onClick={() => (branch.edited ? setConfirmRegrow(true) : regrow())} />
              )}
              <PanelAction icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy"} onClick={copy} />
              <span className="ml-auto">
                {confirmDelete ? (
                  <span className="inline-flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{below ? `Delete it and the ${below} under it?` : "Delete it?"}</span>
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
            </>
          )}
        </div>
      )}

      {branch && !editing && !api.readOnly && (children.length > 0 || childGrowing.length > 0 || suggestions.length > 0 || (askTarget && api.enabled)) && (
        <section className="space-y-2.5">
          <p className={`flex items-center gap-1.5 ${EYEBROW}`}>
            <CornerDownRight aria-hidden className="h-3.5 w-3.5" /> Follow-ups
          </p>
          {(children.length > 0 || childGrowing.length > 0 || suggestions.length > 0) && (
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
              {suggestions.map((n) => (
                <SuggestedPill key={n.label} q={n} disabled={!api.enabled} onClick={() => api.growNext(id, n)} />
              ))}
            </div>
          )}
          {askTarget && api.enabled && !isGrowing && (
            <Composer
              placeholder="Ask a follow-up…"
              onAsk={(text, format) => api.ask(askTarget, text, format)}
              onWrite={(label, text) => api.write(askTarget, label, text)}
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
        aria-label="This deep dive, to edit"
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        **bold** · 1. steps · - points · | table | rows · &gt; a callout. Emptying it deletes it.
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

/**
 * Ask a question of your own — in the shape you want the answer, or letting
 * the AI choose — or write a note yourself.
 */
function Composer({
  placeholder,
  onAsk,
  onWrite,
  autoFocus,
  footer,
  onQuestionChange,
}: {
  placeholder: string;
  onAsk: (text: string, format: AskFormat) => void;
  onWrite: (label: string, text: string) => void;
  autoFocus?: boolean;
  /** Under the box: where the answer will go, for a question asked of the whole sheet. */
  footer?: ReactNode;
  onQuestionChange?: (text: string) => void;
}) {
  const [mode, setMode] = useState<"ask" | "write">("ask");
  const [question, setQuestion] = useState("");
  const [format, setFormat] = useState<AskFormat>("auto");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  if (mode === "write") {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-2.5" style={kindStyle("note")}>
        <div className="flex items-center gap-2">
          <KindBadge type="note" />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder="Title (optional)"
            aria-label="Your note's title"
            className="min-w-0 flex-1 bg-transparent px-1 text-sm font-medium outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write it in your own words…"
          aria-label="Your note"
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
            Add note
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <form
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:border-primary/50"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim()) return;
          onAsk(question, format);
          setQuestion("");
          onQuestionChange?.("");
        }}
      >
        <input
          ref={input}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            onQuestionChange?.(e.target.value);
          }}
          maxLength={300}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!question.trim()}
          aria-label="Ask"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/10 disabled:text-muted-foreground disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
      <div role="group" aria-label="Answer as" className="flex flex-wrap items-center gap-1">
        {ASK_FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={format === f}
            onClick={() => setFormat(f)}
            className={`h-6 rounded-full border px-2 text-[11px] transition-colors ${
              format === f
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            {ASK_FORMAT_LABEL[f]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMode("write")}
          className="h-6 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          My own note
        </button>
      </div>
      {footer}
    </div>
  );
}

// ── One line ─────────────────────────────────────────────────────────────────

function LineView({ api, anchor, onJump }: { api: BranchesApi; anchor: string; onJump: (anchor: string) => void }) {
  const { grown, growing, pills } = branchesAt(api, anchor);
  const focus = api.lineFocus;
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-[13px] border border-border bg-background/50 px-4 py-3.5">
        <p className={EYEBROW}>{api.sectionTitleOf(anchor)}</p>
        <dl className="grid grid-cols-[2.6rem_1fr] gap-x-2 gap-y-1.5">
          <ReField api={api} anchor={anchor} onJump={onJump} />
          {focus && <Field name="On">“{focus}”</Field>}
        </dl>
        <h2 className="font-display text-[19px] font-medium leading-snug text-foreground">
          {focus ? "Ask about what you selected" : "Ask about this line"}
        </h2>
        {api.enabled ? (
          <Composer
            autoFocus
            placeholder={focus ? "What do you want to know about it?" : "Ask anything about this line…"}
            onAsk={(text, format) => api.ask({ anchor, ...(focus ? { focus } : {}) }, text, format)}
            onWrite={(label, text) => api.write({ anchor }, label, text)}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Deep dives can be asked for once the sheet has finished.</p>
        )}
      </div>
      {(grown.length > 0 || growing.length > 0) && (
        <div className="space-y-1.5">
          <p className={EYEBROW}>On this line</p>
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
        </div>
      )}
      {pills.length > 0 && (
        <div className="space-y-1.5">
          <p className={EYEBROW}>Suggested</p>
          <div className="flex flex-wrap gap-1.5">
            {pills.map((p) => (
              <SuggestedPill key={p.id} q={p} disabled={!api.enabled} onClick={() => api.growPill(p)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Every deep dive ──────────────────────────────────────────────────────────

/**
 * A question of the whole sheet: it goes under the line that shares most of
 * its words — shown as the student types — or a section they pick instead.
 */
function AskAnything({ api }: { api: BranchesApi }) {
  const [question, setQuestion] = useState("");
  const [chosen, setChosen] = useState("");
  const matched = question.trim().length >= 6 ? api.anchorFor(question) : "";
  const target = chosen || matched;
  const where = target ? (target.endsWith(":end") ? `${api.sectionTitleOf(target)} (the section)` : api.lineOf(target)) : "";

  return (
    <div className="space-y-2.5 rounded-[13px] border border-border bg-background/50 px-4 py-3.5">
      <h2 className="font-display text-[19px] font-medium leading-snug text-foreground">Ask anything about this sheet</h2>
      <Composer
        placeholder="A table of…, the steps for…, how does…"
        onQuestionChange={setQuestion}
        onAsk={(text, format) => {
          api.ask({ anchor: chosen || api.anchorFor(text) }, text, format);
          setChosen("");
        }}
        onWrite={(label, text) => api.write({ anchor: chosen || api.anchorFor(`${label} ${text}`) }, label, text)}
        footer={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className={EYEBROW}>Goes under</span>
            <span className="min-w-0 flex-1 truncate" title={where}>
              {where ? <Bold text={where} /> : "the line it fits best"}
            </span>
            <label className="sr-only" htmlFor="ask-anything-where">
              Where it goes
            </label>
            <select
              id="ask-anything-where"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="h-6 max-w-[9.5rem] rounded-md border border-border bg-background px-1 text-[11px] text-foreground"
            >
              <option value="">Best match</option>
              {api.sectionOrder
                .filter((k) => k !== "memoryHooks")
                .map((k) => (
                  <option key={k} value={`${k}:end`}>
                    {api.sectionTitleOf(`${k}:end`)}
                  </option>
                ))}
            </select>
          </div>
        }
      />
    </div>
  );
}

function AllView({ api, onJump }: { api: BranchesApi; onJump: (anchor: string) => void }) {
  const kept = new Set(api.branches.map((b) => b.id));
  const growingTop = Object.values(api.growing).filter((g) => !g.parentId && !kept.has(g.id) && g.status !== "declined");
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
      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Finding the deep dives worth writing…
    </p>
  ) : api.suggestFailed ? (
    <p className="flex items-center gap-2 text-xs text-warning">
      Couldn't find deep dives for this sheet.
      <button type="button" onClick={api.suggest} className="font-medium hover:underline">
        Try again
      </button>
    </p>
  ) : null;

  return (
    <div className="space-y-5">
      {api.enabled && !api.readOnly && <AskAnything api={api} />}
      {status}
      {api.picksPending && api.enabled && (
        <button
          type="button"
          onClick={api.growPicks}
          className="flex w-full items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-3 text-left transition-colors hover:border-primary/60"
        >
          <Sprout aria-hidden className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">
            <span className="block text-sm font-medium text-foreground">Make it comprehensive</span>
            <span className="block text-xs text-muted-foreground">Writes the two most useful deep dives in each section.</span>
          </span>
        </button>
      )}
      {!sections.length && !api.suggesting && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          No deep dives yet. Under the lines of the sheet are the questions worth asking next — pick one, or ask your own above.
        </p>
      )}
      {sections.map((s) => (
        <section key={s.key} className="space-y-2">
          <button type="button" onClick={() => onJump(`${s.key}:end`)} className={`${EYEBROW} transition-colors hover:text-foreground`}>
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
                  style={kindStyle(g.question.type)}
                >
                  {g.status === "error" ? (
                    <RotateCcw aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <EcgTrace className="h-3 w-[34px] shrink-0 text-[hsl(var(--k))]" />
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
  const children = api.branches.filter((b) => b.parentId === branch.id);
  const growing = inProgress(api.growing[branch.id]);
  return (
    <li>
      <button
        type="button"
        onClick={() => api.open(branch.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-secondary"
        style={{ paddingLeft: 8 + depth * 18, ...kindStyle(branch.type) }}
      >
        {growing ? <EcgTrace className="h-3 w-[34px] shrink-0 text-[hsl(var(--k))]" /> : <KindBadge type={branch.type} />}
        <span className="truncate">{branch.label}</span>
        {branch.review?.verdict === "corrected" && (
          <ShieldCheck aria-label="Corrected after a clinical check" className="h-3 w-3 shrink-0 text-success" />
        )}
        {branch.review?.verdict === "flagged" && <ShieldAlert aria-label="Flagged by a clinical check" className="h-3 w-3 shrink-0 text-warning" />}
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
