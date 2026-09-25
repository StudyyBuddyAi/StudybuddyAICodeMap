import { describe, it, expect, beforeAll, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import OutputSection from "./OutputSection";
import type { GeneratedSheet } from "@/types/generated-sheet";
import {
  addAddition,
  addHighlight,
  addNote,
  emptyLayer,
  setEdit,
  toggleHidden,
  toggleKnown,
  type SheetLayer,
} from "@/lib/sheet-layer";
import type { PersonalProps } from "@/components/sheet/personal/personal-context";
import { ServerOutdatedError, runPersonalize } from "@/lib/personalize";

vi.mock("@/lib/personalize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/personalize")>()),
  runPersonalize: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  // jsdom lays nothing out; the selection bubble only needs a rect to exist.
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10, toJSON: () => ({}) }) as DOMRect;
});

const SHEET: GeneratedSheet = {
  topic: "DKA",
  plan: [
    { key: "overview", title: "Overview", kind: "prose" },
    { key: "keyPoints", title: "Key Points", kind: "list" },
  ],
  overview: "Mechanism: **Insulin deficiency** drives ketogenesis.\nPathophysiology: ketones cause acidosis and ketones spill.",
  keyPoints: ["Give potassium before insulin.", "Close the gap before stopping insulin.", "Check glucose hourly."],
  memoryHooks: [],
  clinicalApproach: "",
  examTraps: [],
  flashcards: [],
  referenceNote: "Standard references.",
};

async function renderWith(ui: React.ReactElement): Promise<RenderResult> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AuthProvider>{ui}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });
  return result;
}

/** The document with a layer the test can watch change. */
function Harness({
  initial,
  entitled = true,
  onLocked = () => {},
  onLayer,
  onAddCard,
}: {
  initial: SheetLayer;
  entitled?: boolean;
  onLocked?: () => void;
  onLayer?: (l: SheetLayer) => void;
  onAddCard?: PersonalProps["onAddCard"];
}) {
  const [layer, setLayer] = useState(initial);
  const personal: PersonalProps = {
    layer,
    entitled,
    ready: true,
    update: (fn) =>
      setLayer((prev) => {
        const next = fn(prev);
        onLayer?.(next);
        return next;
      }),
    onLocked,
    context: { topic: "DKA", grant: "0b8f6c2e-5a1d-4c3e-9f7a-2d4b6e8a1c3f" },
    onAddCard,
  };
  return <OutputSection output={JSON.stringify(SHEET)} showHeader={false} personal={personal} />;
}

const section = (key: string) => document.querySelector(`[data-section-key="${key}"]`) as HTMLElement;

/** Selects `text` inside the line with this anchor, as a student dragging over it would. */
function selectIn(anchor: string, text: string) {
  const line = document.querySelector(`[data-enh-anchor="${anchor}"] [data-layer-text]`)!;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const at = node.textContent!.indexOf(text);
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(line);
    return;
  }
  throw new Error(`"${text}" not in ${anchor}`);
}

const reply = (text: string) =>
  vi.mocked(runPersonalize).mockImplementationOnce(async (_params, opts) => {
    opts?.onText?.(text);
    return { text, model: null };
  });

describe("the student's layer on the sheet", () => {
  it("shows edits, highlights, notes, added points, known and removed lines", async () => {
    let layer = setEdit(emptyLayer(), {
      anchor: "keyPoints:0",
      text: "K+ first, **then** insulin.",
      source: "ai",
      original: "Give potassium before insulin.",
    });
    layer = addHighlight(layer, { anchor: "overview:0", quote: "Insulin deficiency", intent: "confusing" });
    layer = toggleKnown(layer, "keyPoints:1");
    layer = toggleHidden(layer, "keyPoints:2");
    layer = addNote(layer, "overview:1", "Ask about beta-hydroxybutyrate.");
    layer = addAddition(layer, "keyPoints", "Recheck K+ every 2 hours.");
    await renderWith(<Harness initial={layer} />);

    const points = section("keyPoints").textContent ?? "";
    expect(points).toContain("K+ first, then insulin.");
    expect(points).toContain("AI edit");
    expect(points).not.toContain("Give potassium before insulin.");
    expect(points).not.toContain("Check glucose hourly."); // removed
    expect(points).toContain("Recheck K+ every 2 hours.");
    expect(points).toContain("yours");
    // Numbered as shown: the added point follows the two visible items.
    expect(points).toMatch(/3\.Recheck K\+/);

    const mark = section("overview").querySelector("mark.sb-hl-confusing");
    expect(mark?.textContent).toBe("Insulin deficiency");
    expect(section("overview").textContent).toContain("Ask about beta-hydroxybutyrate.");
    expect(screen.getByText(/1 highlight · 1 edit · 1 point · 1 note/)).toBeTruthy();

    // "Original" shows the sheet as generated, removed lines struck through.
    fireEvent.click(screen.getByRole("button", { name: /Original/ }));
    const original = section("keyPoints").textContent ?? "";
    expect(original).toContain("Give potassium before insulin.");
    expect(original).toContain("Check glucose hourly.");
    expect(original).not.toContain("Recheck K+");

    // "Hide known" folds away what the student already knows.
    fireEvent.click(screen.getByRole("button", { name: /Original/ }));
    expect(section("keyPoints").textContent).toContain("Close the gap");
    fireEvent.click(screen.getByRole("button", { name: /Hide 1 known/ }));
    expect(section("keyPoints").textContent).not.toContain("Close the gap");
    expect(section("keyPoints").textContent).toContain("1 known hidden");
  });

  it("offers Pro instead of changing anything for a student who isn't entitled", async () => {
    const onLocked = vi.fn();
    const onLayer = vi.fn();
    await renderWith(<Harness initial={emptyLayer()} entitled={false} onLocked={onLocked} onLayer={onLayer} />);

    expect(screen.getByText("Make this sheet yours")).toBeTruthy();
    fireEvent.click(section("keyPoints").querySelector("button[class*='h-7']") as HTMLElement); // "Add a point"
    expect(onLocked).toHaveBeenCalled();
    expect(onLayer).not.toHaveBeenCalled();
  });

  it("adds the student's own point from the section's foot", async () => {
    const onLayer = vi.fn();
    await renderWith(<Harness initial={emptyLayer()} onLayer={onLayer} />);

    fireEvent.click(screen.getAllByRole("button", { name: /Add a point/ })[1]);
    fireEvent.change(screen.getByPlaceholderText(/Your own point/), { target: { value: "My mnemonic: K before I." } });
    fireEvent.click(screen.getByRole("button", { name: "Add point" }));

    expect(onLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ additions: [expect.objectContaining({ section: "keyPoints", text: "My mnemonic: K before I." })] })
    );
    expect(section("keyPoints").textContent).toContain("My mnemonic: K before I.");
  });

  it("highlights a selection on the line it starts in, remembering which occurrence it was", async () => {
    const onLayer = vi.fn();
    await renderWith(<Harness initial={emptyLayer()} onLayer={onLayer} />);

    // Select the second "ketones" in "…ketones cause acidosis and ketones spill."
    const textEl = section("overview").querySelector('[data-enh-anchor="overview:1"] [data-layer-text]')!;
    const node = [...textEl.querySelectorAll("span")].map((s) => s.firstChild).find((n) => n?.textContent?.includes("ketones spill"))!;
    const at = node.textContent!.lastIndexOf("ketones");
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + "ketones".length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(section("overview"));

    fireEvent.click(screen.getByRole("button", { name: "Highlight as memorize" }));
    const layer: SheetLayer = onLayer.mock.lastCall![0];
    expect(layer.highlights).toEqual([
      expect.objectContaining({ anchor: "overview:1", quote: "ketones", occurrence: 1, intent: "memorize" }),
    ]);
    const marks = section("overview").querySelectorAll("mark.sb-hl-memorize");
    expect(marks).toHaveLength(1);
    // The mark is on the second "ketones", after "and ".
    expect(marks[0].previousSibling?.textContent?.endsWith("and ")).toBe(true);
  });
});

describe("AI on the student's own sheet", () => {
  it("rewrites a whole line around a selection, and a used rewrite becomes an AI edit", async () => {
    const onLayer = vi.fn();
    reply("Give **K+** before insulin — it drives K+ into cells.");
    await renderWith(<Harness initial={emptyLayer()} onLayer={onLayer} />);

    selectIn("keyPoints:0", "potassium");
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Simplify" }));
    });

    expect(vi.mocked(runPersonalize)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "rewrite",
        style: "simplify",
        text: "Give potassium before insulin.",
        focus: "potassium",
        sectionTitle: "Key Points",
        topic: "DKA",
        grant: "0b8f6c2e-5a1d-4c3e-9f7a-2d4b6e8a1c3f",
      }),
      expect.anything()
    );
    // Nothing changes until the student takes it.
    expect(onLayer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));

    const layer: SheetLayer = onLayer.mock.lastCall![0];
    expect(layer.edits["keyPoints:0"]).toEqual(
      expect.objectContaining({ source: "ai", original: "Give potassium before insulin.", text: "Give **K+** before insulin — it drives K+ into cells." })
    );
    const points = section("keyPoints").textContent ?? "";
    expect(points).toContain("Give K+ before insulin — it drives K+ into cells.");
    expect(points).toContain("AI edit");
  });

  it("turns a selection into a card the student can edit, then adds it to their deck", async () => {
    const onLayer = vi.fn();
    const onAddCard = vi.fn(async () => true);
    reply("Q: What must be given before insulin in DKA?\nA: Potassium, when it is low.");
    await renderWith(<Harness initial={emptyLayer()} onLayer={onLayer} onAddCard={onAddCard} />);

    selectIn("keyPoints:0", "potassium before insulin");
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Card/ }));
    });

    const question = screen.getByDisplayValue("What must be given before insulin in DKA?");
    fireEvent.change(question, { target: { value: "What goes in before insulin?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add to my deck/ }));
    });

    expect(onAddCard).toHaveBeenCalledWith({ question: "What goes in before insulin?", answer: "Potassium, when it is low." });
    const layer: SheetLayer = onLayer.mock.lastCall![0];
    expect(layer.cards).toEqual([expect.objectContaining({ anchor: "keyPoints:0", question: "What goes in before insulin?" })]);
  });

  it("says so, instead of showing a sheet, when the server predates these actions", async () => {
    vi.mocked(runPersonalize).mockRejectedValueOnce(new ServerOutdatedError());
    await renderWith(<Harness initial={emptyLayer()} />);

    selectIn("keyPoints:1", "Close the gap");
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    });
    expect(screen.getByText(/StudyBuddy is being updated/)).toBeTruthy();
  });
});
