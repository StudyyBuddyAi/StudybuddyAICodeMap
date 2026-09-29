import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { GeneratedSheet } from "@/types/generated-sheet";
import { emptyLayer, setPills, type SheetLayer } from "@/lib/sheet-layer";

/**
 * The page's layer and branches together, the way the Sheets page runs them.
 * The bug this guards: opening a saved sheet, the layer reported "ready" for
 * one render with nothing loaded, and the branches asked for suggestions (and,
 * on a comprehensive sheet, grew its picks) all over again.
 */

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "anon" }, isAnonymous: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const stored: Record<string, SheetLayer> = {};
vi.mock("@/lib/sheet-layer-store", () => ({
  loadLocalLayers: () => stored,
  saveLocalLayer: (id: string, l: SheetLayer) => (stored[id] = l),
}));
vi.mock("@/lib/callMedicalNotes", () => ({ callMedicalNotes: vi.fn() }));

import { callMedicalNotes } from "@/lib/callMedicalNotes";
import { useSheetLayer } from "./use-sheet-layer";
import { useSheetBranches } from "./use-sheet-branches";

const SHEET = {
  topic: "Diabetic ketoacidosis",
  sections: {
    overview: "Mechanism: insulin deficiency.\nPathophysiology: ketones accumulate.",
    clinicalApproach: "Management: fluids, then insulin.",
  },
} as unknown as GeneratedSheet;

interface Props {
  sheetKey: number;
  id: string | null;
  sheet: GeneratedSheet | null;
}

function usePage({ sheetKey, id, sheet }: Props) {
  const ls = useSheetLayer(sheetKey, id);
  return useSheetBranches({
    sheet,
    sheetKey,
    ready: !!sheet && ls.status === "ready",
    comprehensive: true,
    layer: ls.layer,
    update: ls.update,
    touch: ls.update,
    context: { topic: "Diabetic ketoacidosis", sourceIds: [] },
    onQuota: () => {},
  });
}

const suggestCalls = () =>
  vi.mocked(callMedicalNotes).mock.calls.filter(([body]) => (body as { branch?: { action?: string } }).branch?.action === "suggest");

beforeEach(() => {
  // A reply that never ends: what matters is whether it was asked for.
  vi.mocked(callMedicalNotes).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  vi.mocked(callMedicalNotes).mockReset();
  for (const k of Object.keys(stored)) delete stored[k];
});

describe("opening a saved sheet", () => {
  it("asks for nothing it already has: no suggestions, no picks", async () => {
    stored.saved = {
      ...setPills(emptyLayer(), [{ type: "mechanism", label: "Ketone bodies", ask: "Which ones?", anchor: "overview:0" }]),
      picksGrown: true,
    };
    const { rerender } = renderHook((p: Props) => usePage(p), { initialProps: { sheetKey: 1, id: null, sheet: null } });
    await act(async () => rerender({ sheetKey: 2, id: "saved", sheet: SHEET }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(callMedicalNotes).not.toHaveBeenCalled();
  });

  it("while a new sheet, with nothing yet, is asked for once", async () => {
    const { rerender } = renderHook((p: Props) => usePage(p), { initialProps: { sheetKey: 1, id: null, sheet: null } });
    await act(async () => rerender({ sheetKey: 3, id: null, sheet: SHEET }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(suggestCalls()).toHaveLength(1);
  });
});

/** A reply the test writes frame by frame. */
function controlledReply() {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) }));
  return {
    response,
    send: (frame: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`)),
    end: () => {
      ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
      ctrl.close();
    },
  };
}
const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

describe("a branch and its clinical check", () => {
  async function grown() {
    const reply = controlledReply();
    vi.mocked(callMedicalNotes).mockImplementation((body) =>
      (body as { branch?: { action?: string } }).branch?.action === "grow" ? Promise.resolve(reply.response) : new Promise(() => {})
    );
    const { result, rerender } = renderHook((p: Props) => usePage(p), { initialProps: { sheetKey: 1, id: null, sheet: null } });
    await act(async () => rerender({ sheetKey: 5, id: null, sheet: SHEET }));
    await act(async () => result.current.actions.ask({ anchor: "overview:0" }, "Which ketones rise?"));
    reply.send(delta('{"label": "Ketones that rise", "paragraphs": ["**Beta-hydroxybutyrate** rises."]}'));
    reply.send({ __meta: { stage: "reviewing" } });
    await tick();
    return { store: result.current, reply };
  }

  it("is kept as soon as it is written, before its check — and corrected when the check comes", async () => {
    const { store, reply } = await grown();
    const kept = store.getState().layer.branches[0];
    expect(kept.label).toBe("Ketones that rise");
    expect(kept.review).toEqual({ verdict: "unchecked" });
    expect(store.getState().growing[kept.id].status).toBe("reviewing");

    reply.send({ __meta: { review: { verdict: "corrected", fixes: ["x → y"], branch: { paragraphs: ["**Beta-hydroxybutyrate** rises most."] } } } });
    reply.end();
    await tick();
    const after = store.getState().layer.branches[0];
    expect(after.text).toBe("**Beta-hydroxybutyrate** rises most.");
    expect(after.review).toEqual({ verdict: "corrected", fixes: ["x → y"] });
    expect(store.getState().growing[kept.id]).toBeUndefined();
  });

  it("never writes a correction over what the student changed while it was checked", async () => {
    const { store, reply } = await grown();
    const id = store.getState().layer.branches[0].id;
    await act(async () => store.actions.edit(id, "My own words."));
    reply.send({ __meta: { review: { verdict: "corrected", fixes: ["x → y"], branch: { paragraphs: ["Theirs."] } } } });
    reply.end();
    await tick();
    const after = store.getState().layer.branches[0];
    expect(after.text).toBe("My own words.");
    expect(after.review).toEqual({ verdict: "corrected", fixes: ["x → y"] });
  });

  it("stays kept, marked unchecked, when the connection drops during the check", async () => {
    const { store, reply } = await grown();
    reply.end(); // no verdict came
    await tick();
    const after = store.getState().layer.branches[0];
    expect(after.review).toEqual({ verdict: "unchecked" });
    expect(Object.keys(store.getState().growing)).toHaveLength(0);
  });
});

describe("the layer, the render a different sheet opens", () => {
  it("says loading — never the last sheet's ready", async () => {
    stored.saved = emptyLayer();
    const seen: { key: number; status: string }[] = [];
    const { rerender } = renderHook(
      ({ sheetKey, id }: Props) => {
        const ls = useSheetLayer(sheetKey, id);
        seen.push({ key: sheetKey, status: ls.status });
        return ls;
      },
      { initialProps: { sheetKey: 1, id: null, sheet: null } }
    );
    await act(async () => rerender({ sheetKey: 2, id: "saved", sheet: null }));
    const first = seen.find((s) => s.key === 2);
    expect(first?.status).toBe("loading");
  });
});
