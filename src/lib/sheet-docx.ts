import type {
  Document as DocumentT,
  IParagraphOptions,
  ISectionOptions,
  Paragraph as ParagraphT,
  Table as TableT,
  TextRun as TextRunT,
} from "docx";
import type { LayerBranch } from "@/lib/sheet-layer";
import { BRANCH_TYPE_LABEL, markdownBlocks } from "@/lib/sheet-branches";
import { AI_NOTICE, type PrintModel, type PrintNote, type PrintOptions, type PrintSection, type PrintSpan } from "@/lib/sheet-print";

/**
 * The exported sheet as a Word document, from the same PrintModel the PDF is
 * rendered from — so the dialog's choices mean the same thing in both. Real
 * Word structure throughout: Heading styles (the navigation pane works),
 * repeating table headers, page numbers in the footer, two newspaper columns
 * for the cram layout. The `docx` library is loaded only when this runs.
 *
 * Fonts are ones every copy of Word, Pages and Google Docs has, since the
 * file leaves the app: Georgia for reading, Arial for labels.
 */

const SERIF = "Georgia";
const SANS = "Arial";
const INK = "14181F";
const SOFT = "4A5260";
const FAINT = "7A828E";
const RULE = "D9DDE3";
const MARK_FILL = { key: "C8ECE7", confusing: "FBE3C2", memorize: "E6DCFA" } as const;
const MARK_LINE = { key: "single", confusing: "wave", memorize: "double" } as const;

/** Body size in half-points. */
const SIZE = { small: 19, medium: 21, large: 24 } as const;
const PAGE = {
  A4: { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
} as const;
const MARGIN = { top: 1134, bottom: 1020, side: 907 }; // 20mm, 18mm, 16mm

const pad2 = (n: number) => String(n).padStart(2, "0");

export async function buildSheetDocx(model: PrintModel, options: PrintOptions): Promise<Blob> {
  const { Packer } = await import("docx");
  return Packer.toBlob(await buildSheetDocument(model, options));
}

export async function buildSheetDocument(model: PrintModel, options: PrintOptions): Promise<DocumentT> {
  const d = await import("docx");
  const {
    BorderStyle,
    Document,
    ExternalHyperlink,
    Footer,
    Header,
    HeadingLevel,
    PageNumber,
    Paragraph,
    SectionType,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TabStopType,
    TextRun,
    WidthType,
  } = d;

  const accent = options.inkSaver ? INK : "0B6E69";
  const panel = options.inkSaver ? undefined : "F6F4EF";
  const body = SIZE[options.textSize];
  const page = PAGE[options.paper];
  const contentWidth = page.width - MARGIN.side * 2;
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

  // ── Runs ──
  const runs = (spans: PrintSpan[], extra: Partial<ConstructorParameters<typeof TextRun>[0] & object> = {}): TextRunT[] =>
    spans.map(
      (s) =>
        new TextRun({
          text: s.text,
          bold: s.bold || undefined,
          ...(s.mark
            ? options.inkSaver
              ? { underline: { type: MARK_LINE[s.mark] } }
              : { shading: { type: ShadingType.CLEAR, color: "auto", fill: MARK_FILL[s.mark] } }
            : {}),
          ...extra,
        })
    );
  /** **bold** inside model text that never went through the print model (branches). */
  const md = (text: string, extra = {}): TextRunT[] =>
    runs(
      text
        .split(/(\*\*[^*]+\*\*)/g)
        .filter(Boolean)
        .map((p) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { text: p.slice(2, -2), bold: true } : { text: p })),
      extra
    );
  const eyebrow = (text: string, opts: IParagraphOptions = {}) =>
    new Paragraph({
      ...opts,
      children: [new TextRun({ text: text.toUpperCase(), font: SANS, size: 14, bold: true, color: accent, characterSpacing: 30 })],
    });
  const p = (children: (TextRunT | InstanceType<typeof ExternalHyperlink>)[], opts: IParagraphOptions = {}) =>
    new Paragraph({ spacing: { after: 80 }, ...opts, children });

  const mineBorder = { left: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 6 } };
  const notes = (list: PrintNote[], indent = 0): ParagraphT[] =>
    list.map((n) =>
      p(
        [
          new TextRun({ text: `${n.ai ? "AI explanation" : "Note"}  `, font: SANS, size: 14, bold: true, color: FAINT }),
          new TextRun({ text: n.text, italics: true, color: SOFT, size: body - 2 }),
        ],
        {
          indent: { left: indent + 200 },
          border: { left: { style: BorderStyle.SINGLE, size: 8, color: FAINT, space: 6 } },
          ...(panel ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: panel } } : {}),
        }
      )
    );

  const cell = (children: (ParagraphT | TableT)[], opts: { fill?: string; width?: number; header?: boolean } = {}) =>
    new TableCell({
      children,
      ...(opts.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
      ...(opts.fill ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } } : {}),
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      borders: {
        top: none,
        left: none,
        right: none,
        bottom: { style: BorderStyle.SINGLE, size: opts.header ? 8 : 4, color: opts.header ? INK : RULE },
      },
    });

  const table = (header: string[] | undefined, rows: PrintSpan[][][], firstBold = true) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [
        ...(header?.length
          ? [
              new TableRow({
                tableHeader: true,
                cantSplit: true,
                children: header.map((h) =>
                  cell([p([new TextRun({ text: h.toUpperCase(), font: SANS, size: 14, bold: true, color: SOFT })], { spacing: { after: 0 } })], {
                    header: true,
                  })
                ),
              }),
            ]
          : []),
        ...rows.map(
          (row, i) =>
            new TableRow({
              cantSplit: true,
              children: row.map((c, j) =>
                cell([p(runs(c, j === 0 && firstBold ? { bold: true } : {}), { spacing: { after: 0 } })], {
                  fill: i % 2 === 1 ? panel : undefined,
                })
              ),
            })
        ),
      ],
    });

  // ── Deep dives ──
  const dives = (roots: LayerBranch[]): (ParagraphT | TableT)[] => {
    if (!roots.length) return [];
    const out: (ParagraphT | TableT)[] = [eyebrow("Deep dives", { spacing: { before: 120, after: 60 } })];
    const write = (b: LayerBranch, depth: number) => {
      const indent = depth * 360;
      out.push(
        p(
          [
            new TextRun({ text: b.label, font: SANS, bold: true, size: body - 2 }),
            new TextRun({ text: `   ${BRANCH_TYPE_LABEL[b.type].toUpperCase()}`, font: SANS, size: 13, color: FAINT }),
          ],
          { indent: { left: indent }, keepNext: true, spacing: { before: 80, after: 40 } }
        )
      );
      for (const block of markdownBlocks(b.text)) {
        if (block.kind === "heading") out.push(p(md(block.text, { bold: true }), { indent: { left: indent }, keepNext: true }));
        else if (block.kind === "paragraph") out.push(p(md(block.text, { size: body - 1 }), { indent: { left: indent } }));
        else if (block.kind === "ordered" || block.kind === "bullets")
          block.items.forEach((item, i) =>
            out.push(
              p([new TextRun({ text: block.kind === "ordered" ? `${i + 1}.\t` : "•\t", color: accent }), ...md(item, { size: body - 1 })], {
                indent: { left: indent + 360, hanging: 360 },
                spacing: { after: 40 },
              })
            )
          );
        else if (block.kind === "table") out.push(table(block.header, block.rows.map((r) => r.map((c) => [{ text: c.replace(/\*\*/g, "") }])), false));
        else
          block.lines.forEach((l) =>
            out.push(
              p(md(l, { size: body - 1 }), {
                indent: { left: indent + 200 },
                border: { left: { style: BorderStyle.SINGLE, size: 8, color: accent, space: 6 } },
                spacing: { after: 40 },
              })
            )
          );
      }
      model.allBranches.filter((c) => c.parentId === b.id).forEach((c) => write(c, depth + 1));
    };
    roots.forEach((b) => write(b, 0));
    return out;
  };

  // ── Sections ──
  const LABEL_TAB = 1500;
  const section = (s: PrintSection): (ParagraphT | TableT)[] => {
    const out: (ParagraphT | TableT)[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        keepNext: true,
        spacing: { before: 240, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 3 } },
        children: [
          new TextRun({ text: `${pad2(s.number)}   `, font: SANS, size: 16, color: accent, bold: true }),
          new TextRun({ text: s.title, font: SERIF, size: Math.round(body * 1.3), bold: true, color: INK }),
        ],
      }),
    ];
    if (s.kind === "table") out.push(table(s.columns, s.rows));
    s.lines.forEach((line, i) => {
      const mine = line.mine ? { border: mineBorder } : {};
      if (s.kind === "list") {
        out.push(
          p([new TextRun({ text: `${pad2(i + 1)}\t`, font: SANS, size: 15, color: accent }), ...runs(line.spans)], {
            indent: { left: 480, hanging: 480 },
            ...mine,
          })
        );
      } else if (line.label) {
        out.push(
          p([new TextRun({ text: `${line.label}\t`, font: SANS, size: 15, bold: true, color: accent }), ...runs(line.spans)], {
            indent: { left: LABEL_TAB, hanging: LABEL_TAB },
            tabStops: [{ type: TabStopType.LEFT, position: LABEL_TAB }],
            ...mine,
          })
        );
      } else {
        out.push(p(runs(line.spans), mine));
      }
      out.push(...notes(line.notes, s.kind === "list" ? 480 : line.label ? LABEL_TAB : 0));
    });
    out.push(...notes(s.notes), ...dives(s.branches));
    return out;
  };

  // ── Front matter ──
  const meta: [string, string][] = [
    ["Exam", model.meta.examMode],
    ["Level", model.meta.difficulty],
    ["Depth", model.meta.depth],
    ["Exported", model.meta.date],
  ];
  const grounding = {
    full: "Grounded in the guideline library",
    partial: "Partly grounded — some sections from general knowledge",
    none: "Written from general medical knowledge",
  };
  const front: (ParagraphT | TableT)[] = [
    eyebrow("StudyBuddy AI · Study sheet", { spacing: { before: options.coverPage ? 2400 : 0, after: 80 } }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 160 },
      children: [new TextRun({ text: `${model.emoji ? `${model.emoji} ` : ""}${model.title}`, font: SERIF, size: options.coverPage ? 64 : 48, color: INK })],
    }),
    p(
      meta.flatMap(([k, v], i) => [
        new TextRun({ text: `${i ? "     " : ""}${k.toUpperCase()} `, font: SANS, size: 13, color: FAINT, bold: true }),
        new TextRun({ text: v, font: SANS, size: 16, color: SOFT }),
      ]),
      { spacing: { after: 60 } }
    ),
    ...(model.meta.grounding
      ? [p([new TextRun({ text: grounding[model.meta.grounding], font: SANS, size: 15, color: accent, bold: true })])]
      : []),
    ...(model.hasMine
      ? [
          p(
            [
              ...runs([{ text: "Key point", mark: "key" }], { font: SANS, size: 14 }),
              new TextRun({ text: "   ", size: 14 }),
              ...runs([{ text: "Confusing", mark: "confusing" }], { font: SANS, size: 14 }),
              new TextRun({ text: "   ", size: 14 }),
              ...runs([{ text: "To memorise", mark: "memorize" }], { font: SANS, size: 14 }),
              new TextRun({ text: "   ▍ Your edits and additions", font: SANS, size: 14, color: accent }),
            ],
            { spacing: { after: 60 } }
          ),
        ]
      : []),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 4 } }, spacing: { after: 200 }, children: [] }),
  ];
  if (options.coverPage) {
    front.push(eyebrow("Contents", { spacing: { after: 100 } }));
    const entries = [
      ...model.sections.map((s) => [pad2(s.number), s.title]),
      ...(model.cards.length ? [["—", options.cards === "quiz" ? "Self-test and answer key" : "Flashcards"]] : []),
      ...(model.references.length || model.referenceNote ? [["—", "References"]] : []),
    ];
    entries.forEach(([n, t]) =>
      front.push(
        p([new TextRun({ text: `${n}\t`, font: SANS, size: 15, color: accent }), new TextRun({ text: t, size: body + 2 })], {
          indent: { left: 600, hanging: 600 },
          border: { bottom: { style: BorderStyle.DOTTED, size: 4, color: RULE, space: 3 } },
        })
      )
    );
    front.push(p([new TextRun({ text: AI_NOTICE, font: SANS, size: 14, color: FAINT })], { spacing: { before: 600 } }));
  }

  // ── Back matter ──
  const back: (ParagraphT | TableT)[] = [];
  const partTitle = (text: string, first: boolean) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: !first,
      spacing: { after: 80 },
      children: [new TextRun({ text, font: SERIF, size: 36, color: INK })],
    });
  const lede = (text: string) => p([new TextRun({ text, color: SOFT, size: body - 1 })], { spacing: { after: 160 } });

  if (model.cards.length && options.cards === "inline") {
    back.push(partTitle("Flashcards", true), lede(`${model.cards.length} cards. Cover the right-hand column and answer each one aloud.`));
    back.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders,
        rows: model.cards.map(
          (c, i) =>
            new TableRow({
              cantSplit: true,
              children: [
                cell([p([new TextRun({ text: pad2(i + 1), font: SANS, size: 15, color: accent })], { spacing: { after: 0 } })], { width: 6 }),
                cell(
                  [
                    p([new TextRun({ text: `${c.tag.toUpperCase()}  `, font: SANS, size: 12, bold: true, color: FAINT }), new TextRun({ text: c.question })], {
                      spacing: { after: 0 },
                    }),
                  ],
                  { width: 54 }
                ),
                cell([p([new TextRun({ text: c.answer, color: SOFT })], { spacing: { after: 0 } })], { width: 40 }),
              ],
            })
        ),
      })
    );
  }
  if (model.cards.length && options.cards === "quiz") {
    back.push(partTitle("Self-test", true), lede(`${model.cards.length} questions. Write your answer, then check it against the key that follows.`));
    model.cards.forEach((c, i) => {
      back.push(
        p([new TextRun({ text: `${pad2(i + 1)}\t`, font: SANS, size: 15, color: accent }), new TextRun({ text: `${c.tag.toUpperCase()}  `, font: SANS, size: 12, bold: true, color: FAINT }), new TextRun({ text: c.question })], {
          indent: { left: 480, hanging: 480 },
          keepNext: true,
          spacing: { before: 120, after: 0 },
        })
      );
      for (let k = 0; k < 2; k++)
        back.push(
          new Paragraph({
            indent: { left: 480 },
            spacing: { before: 200, after: 0 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 } },
            children: [],
          })
        );
    });
    back.push(partTitle("Answer key", false));
    model.cards.forEach((c, i) =>
      back.push(
        p([new TextRun({ text: `${pad2(i + 1)}\t`, font: SANS, size: 15, color: accent }), new TextRun({ text: c.answer, size: body - 1 })], {
          indent: { left: 480, hanging: 480 },
        })
      )
    );
  }
  if (model.references.length || model.referenceNote) {
    back.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        keepNext: true,
        spacing: { before: 360, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 3 } },
        children: [new TextRun({ text: "References", font: SERIF, size: Math.round(body * 1.3), bold: true, color: INK })],
      })
    );
    if (model.referenceNote) back.push(p([new TextRun({ text: model.referenceNote, color: SOFT, size: body - 1 })]));
    for (const r of model.references) {
      back.push(
        p([new TextRun({ text: `[${r.number}]\t`, font: SANS, size: 15, color: accent }), new TextRun({ text: r.title, bold: true })], {
          indent: { left: 600, hanging: 600 },
          keepNext: true,
          spacing: { before: 100, after: 20 },
        })
      );
      for (const ch of r.chapters) {
        const line = [ch.heading, ch.pages.join(", ")].filter(Boolean).join(" · ");
        if (line) back.push(p([new TextRun({ text: line, color: SOFT, size: body - 2 })], { indent: { left: 600 }, spacing: { after: 20 } }));
        ch.excerpts.forEach((x) =>
          back.push(
            p([new TextRun({ text: x, italics: true, color: SOFT, size: body - 3 })], {
              indent: { left: 800 },
              border: { left: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
            })
          )
        );
      }
      if (r.url)
        back.push(
          p([new ExternalHyperlink({ link: r.url, children: [new TextRun({ text: r.url, style: "Hyperlink", size: 14 })] })], {
            indent: { left: 600 },
          })
        );
    }
  }
  if (!options.coverPage)
    back.push(
      p([new TextRun({ text: AI_NOTICE, font: SANS, size: 14, color: FAINT })], {
        spacing: { before: 360 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
      })
    );

  // ── Header, footer, page ──
  const tabRight = [{ type: TabStopType.RIGHT, position: contentWidth }];
  const chrome = (children: (TextRunT | string)[]) =>
    new Paragraph({ tabStops: tabRight, children: children as TextRunT[] });
  const small = { font: SANS, size: 14, color: FAINT };
  const header = new Header({ children: [chrome([new TextRun({ text: model.title, ...small }), new TextRun({ text: "\tStudyBuddy AI", ...small })])] });
  const footer = new Footer({
    children: [
      chrome([
        new TextRun({ text: `Exported ${model.meta.date}`, ...small }),
        new TextRun({ ...small, children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] }),
      ]),
    ],
  });
  const empty = { header: new Header({ children: [] }), footer: new Footer({ children: [] }) };
  const pageProps = {
    page: {
      size: page,
      margin: { top: MARGIN.top, bottom: MARGIN.bottom, left: MARGIN.side, right: MARGIN.side, header: 567, footer: 567 },
    },
  };
  const two = options.layout === "revision";
  const sectionBodies = model.sections.flatMap(section);

  const sections: ISectionOptions[] = [];
  const withChrome = (o: Omit<ISectionOptions, "headers" | "footers">, first = false): ISectionOptions => ({
    ...o,
    headers: { default: header, ...(first ? { first: empty.header } : {}) },
    footers: { default: footer, ...(first ? { first: empty.footer } : {}) },
  });

  if (options.coverPage) {
    sections.push(withChrome({ properties: { ...pageProps, titlePage: true }, children: front }, true));
    sections.push(withChrome({ properties: { ...pageProps, type: SectionType.NEXT_PAGE, column: two ? { count: 2, space: 510, separate: true } : undefined }, children: sectionBodies }));
  } else if (two) {
    sections.push(withChrome({ properties: pageProps, children: front }));
    sections.push(withChrome({ properties: { ...pageProps, type: SectionType.CONTINUOUS, column: { count: 2, space: 510, separate: true } }, children: sectionBodies }));
  } else {
    sections.push(withChrome({ properties: pageProps, children: [...front, ...sectionBodies] }));
  }
  if (back.length) {
    const cardsFirst = model.cards.length > 0;
    sections.push(
      withChrome({
        properties: { ...pageProps, type: cardsFirst ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS },
        children: back,
      })
    );
  }

  const doc = new Document({
    creator: "StudyBuddy AI",
    title: model.title,
    description: "Study sheet exported from StudyBuddy AI",
    styles: {
      default: {
        document: { run: { font: SERIF, size: body, color: INK }, paragraph: { spacing: { line: 288 } } },
      },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", run: { font: SERIF, color: INK } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: SERIF, color: INK } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: SERIF, color: INK } },
      ],
    },
    sections,
  });
  return doc;
}

/** Hands a Blob to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
