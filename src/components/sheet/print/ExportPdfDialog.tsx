import { useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpenCheck, FileDown, FileText, Layers, Loader2, Printer, ScrollText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { GeneratedSheet } from "@/types/generated-sheet";
import type { SheetLayer } from "@/lib/sheet-layer";
import { isEmptyLayer } from "@/lib/sheet-layer";
import { resolvePlan, sectionHasBody } from "@/lib/sheet-plan";
import {
  DEFAULT_PRINT_OPTIONS,
  buildPrintModel,
  cssString,
  exportFileName,
  type PrintContext,
  type PrintOptions,
} from "@/lib/sheet-print";
import { SheetPrintDocument } from "./SheetPrintDocument";
import { buildSheetDocx, downloadBlob } from "@/lib/sheet-docx";

/**
 * Export: choose what goes on the page, see it, then take it as a PDF or a
 * Word document. Both are built from one PrintModel, so every choice means the
 * same in either.
 *
 * The PDF goes through the browser's own Save-as-PDF: printing rather than
 * drawing a PDF in script keeps the text real (selectable, searchable, any
 * script), the fonts the app's own, and the bundle free of a PDF engine. The
 * Word file is written in the browser (sheet-docx.ts), its library loaded only
 * when asked for.
 */

export type ExportFormat = "pdf" | "docx";
const FORMAT_KEY = "sb_sheet_export_format_v1";

const STORAGE_KEY = "sb_sheet_export_v1";
/** Everything but the section picks, which belong to one sheet. */
type Remembered = Omit<PrintOptions, "excluded">;

function readRemembered(): Partial<Remembered> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function remember(o: PrintOptions) {
  try {
    const rest: Partial<PrintOptions> = { ...o };
    delete rest.excluded;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // Private mode or full storage: the choices just aren't remembered.
  }
}

const PRESETS: { id: string; label: string; hint: string; icon: typeof ScrollText; set: Partial<PrintOptions> }[] = [
  {
    id: "handout",
    label: "Handout",
    hint: "Full sheet, cards and references",
    icon: ScrollText,
    set: { layout: "study", textSize: "medium", cards: "inline", sources: "list", notesMargin: false, coverPage: false },
  },
  {
    id: "cram",
    label: "Cram sheet",
    hint: "Two dense columns, essentials only",
    icon: Layers,
    set: { layout: "revision", textSize: "small", cards: "omit", sources: "omit", notesMargin: false, coverPage: false, branches: false },
  },
  {
    id: "selftest",
    label: "Self-test",
    hint: "Cue margin, quiz with an answer key",
    icon: BookOpenCheck,
    set: { layout: "study", textSize: "medium", cards: "quiz", sources: "list", notesMargin: true },
  },
];

/** Page box, running header and footer. Margin boxes print in Chromium; elsewhere they are ignored. */
function pageCss(title: string, date: string, o: PrintOptions): string {
  const box = (content: string) =>
    `{ content: ${content}; font: 500 7.5pt "Inter Tight", "DM Sans", Arial, sans-serif; color: #7a828e; }`;
  const blank = "{ content: none; }";
  return `
@page {
  size: ${o.paper === "Letter" ? "letter" : "A4"};
  margin: 20mm 16mm 18mm;
  @top-left ${box(cssString(title))}
  @top-right ${box('"StudyBuddy AI"')}
  @bottom-left ${box(cssString(`Exported ${date}`))}
  @bottom-right ${box('"Page " counter(page) " of " counter(pages)')}
}
${o.coverPage ? `@page :first { @top-left ${blank} @top-right ${blank} @bottom-left ${blank} @bottom-right ${blank} }` : ""}`;
}

// ── Small controls ───────────────────────────────────────────────────────────

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <p id={id} className="text-xs font-medium text-foreground">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-background p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`h-7 flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
              o.value === value ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`flex items-start justify-between gap-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <p id={id} className="text-xs font-medium text-foreground">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-labelledby={id} className="mt-0.5 shrink-0" />
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
    <legend className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{title}</legend>
    {children}
  </fieldset>
);

// ── Dialog ───────────────────────────────────────────────────────────────────

export interface ExportPdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheet: GeneratedSheet;
  layer: SheetLayer | null;
  context: PrintContext;
}

export function ExportPdfDialog({ open, onOpenChange, sheet, layer, context }: ExportPdfDialogProps) {
  const [format, setFormatState] = useState<ExportFormat>(() => {
    try {
      return localStorage.getItem(FORMAT_KEY) === "docx" ? "docx" : "pdf";
    } catch {
      return "pdf";
    }
  });
  const setFormat = (f: ExportFormat) => {
    setFormatState(f);
    try {
      localStorage.setItem(FORMAT_KEY, f);
    } catch {
      // not remembered; nothing else depends on it
    }
  };
  const isPdf = format === "pdf";
  const [options, setOptions] = useState<PrintOptions>(() => ({ ...DEFAULT_PRINT_OPTIONS, ...readRemembered(), excluded: [] }));
  const set = (patch: Partial<PrintOptions>) => setOptions((o) => ({ ...o, ...patch }));
  useEffect(() => remember(options), [options]);

  const hasLayer = !!layer && !isEmptyLayer(layer);
  const hasBranches = !!layer?.branches.length;
  const sections = useMemo(() => resolvePlan(sheet).filter((s) => sectionHasBody(sheet, s.key)), [sheet]);
  const model = useMemo(() => buildPrintModel(sheet, layer, options, context), [sheet, layer, options, context]);
  const activePreset = PRESETS.find((p) => Object.entries(p.set).every(([k, v]) => options[k as keyof PrintOptions] === v))?.id;

  // ── Preview: real paper size, scaled to the pane ──
  // Callback refs, held in state: the dialog's content mounts after the
  // dialog opens, so an effect keyed on `open` would find nothing to measure.
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [paper, setPaper] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.6);
  const [paperHeight, setPaperHeight] = useState(0);
  useLayoutEffect(() => {
    if (!pane || !paper) return;
    const measure = () => {
      setScale(Math.min(1, (pane.clientWidth - 48) / paper.offsetWidth));
      setPaperHeight(paper.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    ro.observe(paper);
    return () => ro.disconnect();
  }, [pane, paper, options.paper]);

  // A rough count from the preview's height: 1mm ≈ 3.78 CSS px; the printable
  // height is the page less its margins. The browser's own breaks will differ
  // a little — they keep rows and headings together.
  const pageContentPx = ((options.paper === "Letter" ? 279.4 : 297) - 38) * 3.78;
  const padPx = (options.paper === "Letter" ? 0.7 * 25.4 : 18) * 3.78 * 2;
  const pages = paperHeight ? Math.max(1, Math.ceil((paperHeight - padPx) / pageContentPx)) : null;

  // ── Print ──
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const startExport = () => {
    let root = document.getElementById("sb-print-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "sb-print-root";
      document.body.appendChild(root);
    }
    setTarget(root);
  };

  useEffect(() => {
    if (!target) return;
    let finished = false;
    const html = document.documentElement;
    const previousTitle = document.title;
    const style = document.createElement("style");
    style.id = "sb-print-page";
    style.textContent = pageCss(model.title, model.meta.date, options);
    document.head.appendChild(style);
    html.classList.add("sb-exporting");
    // The browser offers the document title as the PDF's file name.
    document.title = exportFileName(model.title);

    const finish = () => {
      if (finished) return;
      finished = true;
      style.remove();
      html.classList.remove("sb-exporting");
      document.title = previousTitle;
      setTarget(null);
    };
    window.addEventListener("afterprint", finish, { once: true });
    // Fonts first, or the PDF is set in the fallback face.
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    let frame = 0;
    fontsReady.then(() => {
      frame = requestAnimationFrame(() => {
        if (!finished) window.print();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", finish);
      finish();
    };
    // Runs once per export: the options are fixed while the print dialog is up.
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const [writing, setWriting] = useState(false);
  const [docxError, setDocxError] = useState<string | null>(null);
  const downloadDocx = async () => {
    setWriting(true);
    setDocxError(null);
    try {
      const blob = await buildSheetDocx(model, options);
      downloadBlob(blob, `${exportFileName(model.title)}.docx`);
    } catch (e) {
      console.error("docx export failed", e);
      setDocxError("Couldn't write the Word file. Try again, or export a PDF.");
    } finally {
      setWriting(false);
    }
  };

  const toggleSection = (key: string, on: boolean) =>
    set({ excluded: on ? options.excluded.filter((k) => k !== key) : [...options.excluded, key] });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(92dvh,920px)] max-w-[1180px] flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* ── Options ── */}
          <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-e">
            <div className="px-6 pb-4 pt-6">
              <DialogTitle className="font-display text-2xl font-medium tracking-[-0.01em]">Export sheet</DialogTitle>
              <DialogDescription className="mt-1 text-xs text-muted-foreground">
                Choose what goes on the page. The preview updates as you go.
              </DialogDescription>
              <div className="mt-4">
                <Choice
                  label="File type"
                  value={format}
                  onChange={setFormat}
                  options={[
                    { value: "pdf", label: "PDF" },
                    { value: "docx", label: "Word (.docx)" },
                  ]}
                />
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  {isPdf
                    ? "Fixed layout for printing and reading anywhere."
                    : "Editable in Word, Google Docs and Pages — headings show in the navigation pane."}
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
              <Group title="Start from">
                <div className="grid grid-cols-3 gap-2">
                  {PRESETS.map((p) => {
                    const active = activePreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => set(p.set)}
                        title={p.hint}
                        className={`flex flex-col items-start gap-1.5 rounded-xl border p-2.5 text-start transition-colors ${
                          active ? "border-foreground bg-secondary" : "border-border hover:border-foreground/40"
                        }`}
                      >
                        <p.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <span className="text-xs font-semibold leading-tight text-foreground">{p.label}</span>
                        <span className="text-[10px] leading-snug text-muted-foreground">{p.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </Group>

              <Group title="Layout">
                <Choice
                  label="Format"
                  value={options.layout}
                  onChange={(layout) => set({ layout })}
                  options={[
                    { value: "study", label: "Study sheet" },
                    { value: "revision", label: "Two-column cram" },
                  ]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Choice
                    label="Paper"
                    value={options.paper}
                    onChange={(paper) => set({ paper })}
                    options={[
                      { value: "A4", label: "A4" },
                      { value: "Letter", label: "Letter" },
                    ]}
                  />
                  <Choice
                    label="Text"
                    value={options.textSize}
                    onChange={(textSize) => set({ textSize })}
                    options={[
                      { value: "small", label: "S" },
                      { value: "medium", label: "M" },
                      { value: "large", label: "L" },
                    ]}
                  />
                </div>
                <Toggle label="Title page with contents" checked={options.coverPage} onChange={(coverPage) => set({ coverPage })} />
                <Toggle
                  label="Cue margin"
                  hint={
                    isPdf
                      ? "A ruled column beside each section for your own cues and questions."
                      : "PDF only — in Word, use the comments margin instead."
                  }
                  checked={isPdf && options.notesMargin && options.layout === "study"}
                  disabled={!isPdf || options.layout !== "study"}
                  onChange={(notesMargin) => set({ notesMargin })}
                />
                <Toggle
                  label="Ink saver"
                  hint="No tinted fills; highlights print as underlines."
                  checked={options.inkSaver}
                  onChange={(inkSaver) => set({ inkSaver })}
                />
              </Group>

              <Group title="Sections">
                <ul className="space-y-1.5">
                  {sections.map((s) => {
                    const on = !options.excluded.includes(s.key);
                    const id = `sbx-${s.key}`;
                    return (
                      <li key={s.key} className="flex items-center gap-2.5">
                        <Checkbox id={id} checked={on} onCheckedChange={(v) => toggleSection(s.key, v === true)} />
                        <label htmlFor={id} className="cursor-pointer text-xs text-foreground">
                          {s.title}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </Group>

              <Group title="Extras">
                <Choice
                  label="Flashcards"
                  value={options.cards}
                  onChange={(cards) => set({ cards })}
                  options={[
                    { value: "inline", label: "With answers" },
                    { value: "quiz", label: "Quiz + key" },
                    { value: "omit", label: "Leave out" },
                  ]}
                />
                <Choice
                  label="References"
                  value={options.sources}
                  onChange={(sources) => set({ sources })}
                  options={[
                    { value: "list", label: "List" },
                    { value: "excerpts", label: "With excerpts" },
                    { value: "omit", label: "Leave out" },
                  ]}
                />
                <Toggle
                  label="My highlights, edits and notes"
                  hint={hasLayer ? "Printed in place, with a key on the first page." : "Nothing of yours on this sheet yet."}
                  checked={options.mine && hasLayer}
                  disabled={!hasLayer}
                  onChange={(mine) => set({ mine })}
                />
                <Toggle
                  label="Deep dives"
                  hint={hasBranches ? "Under the section each one grew from." : "No deep dives on this sheet yet."}
                  checked={options.branches && options.mine && hasBranches}
                  disabled={!hasBranches || !options.mine}
                  onChange={(branches) => set({ branches })}
                />
              </Group>
            </div>

            <div className="border-t border-border bg-card px-6 py-4">
              {isPdf ? (
                <>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={startExport}
                      disabled={!!target || model.sections.length === 0}
                      className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {target ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
                      Save as PDF
                    </button>
                    <button
                      type="button"
                      onClick={startExport}
                      disabled={!!target || model.sections.length === 0}
                      title="Print"
                      aria-label="Print"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      <Printer className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
                    Opens your browser's print window — pick <span className="font-medium text-foreground">Save as PDF</span> as
                    the destination.
                  </p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={downloadDocx}
                    disabled={writing || model.sections.length === 0}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {writing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
                    {writing ? "Writing…" : "Download .docx"}
                  </button>
                  <p role={docxError ? "alert" : undefined} className={`mt-2.5 text-[11px] leading-snug ${docxError ? "text-danger" : "text-muted-foreground"}`}>
                    {docxError ?? "Downloads straight away. Word sets the text in Georgia and Arial, so line breaks differ a little from the preview."}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* ── Preview ── */}
          <div className="relative hidden min-h-0 flex-col bg-secondary/60 lg:flex">
            <p className="px-6 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground" aria-live="polite">
              Preview · {isPdf ? "PDF" : "Word"} · {options.paper}
              {pages && ` · about ${pages} ${pages === 1 ? "page" : "pages"}`}
            </p>
            <div ref={setPane} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-8">
              <div style={{ height: paperHeight * scale, position: "relative" }}>
                <div
                  ref={setPaper}
                  className="sbp-paper absolute left-1/2 top-0 bg-white"
                  data-paper={options.paper}
                  style={{ transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top center" }}
                  aria-label="Preview of the exported sheet"
                >
                  <SheetPrintDocument model={model} options={options} />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {target && createPortal(<SheetPrintDocument model={model} options={options} />, target)}
    </>
  );
}

export default ExportPdfDialog;
