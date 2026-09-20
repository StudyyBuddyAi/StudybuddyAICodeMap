import { describe, it, expect, beforeAll, vi } from "vitest";
import { act, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import OutputSection from "./OutputSection";
import type { GeneratedSheet } from "@/types/generated-sheet";

/**
 * The reading rail: the contents list that replaced the sticky hint strip when
 * the sheet was narrowed to a readable measure. It has to agree with the cards
 * about what has landed, or it stops being trustworthy mid-generation.
 */

const scrollIntoView = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

async function renderSheet(ui: React.ReactElement): Promise<RenderResult> {
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

const SHEET: GeneratedSheet = {
  topicEmoji: "*",
  topic: "Heart Failure",
  overview: "Mechanism: reduced output",
  memoryHooks: ["FACES"],
  clinicalApproach: "Diagnosis: echo",
  keyPoints: ["If S3 then volume overload"],
  examTraps: ["HFpEF is not HFrEF"],
  flashcards: [{ tag: "Next Step", question: "What next?", answer: "Start an ACEi." }],
  referenceNote: "Standard references.",
};

const rail = () => screen.getByRole("navigation", { name: "Sheet sections" });
const railRow = (key: string) => document.querySelector(`[data-rail-section="${key}"]`);

describe("sheet reading rail", () => {
  it("lists every section of the sheet, in document order", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);

    const labels = [...rail().querySelectorAll("[data-rail-section]")].map(
      (row) => row.getAttribute("data-rail-section")
    );
    expect(labels).toEqual([
      "overview",
      "memoryHooks",
      "clinicalApproach",
      "keyPoints",
      "examTraps",
      "diagram",
      "illustration",
      "flashcards",
      "referenceNote",
    ]);
  });

  it("drops the emoji from section names — the rail carries its own icons", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);

    expect(railRow("memoryHooks")?.textContent).toBe("Memory Hooks");
  });

  it("agrees with the cards about what has landed mid-stream", async () => {
    await renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["overview", "memoryHooks"]}
      />
    );

    expect(railRow("overview")).toHaveAttribute("data-state", "ready");
    expect(railRow("memoryHooks")).toHaveAttribute("data-state", "ready");
    // Next in order, so it is the one in flight — the same section the card
    // marks with its pulsing dot.
    expect(railRow("clinicalApproach")).toHaveAttribute("data-state", "writing");
    expect(railRow("examTraps")).toHaveAttribute("data-state", "pending");
  });

  it("scrolls to a section when its rail entry is clicked", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Exam Traps" }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(
      document.querySelector('[data-section-key="examTraps"]')
    );
  });

  it("lets the reader switch the ambient field off, and remembers it", async () => {
    localStorage.removeItem("sb_ambient_field");
    await renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);

    const toggle = screen.getByRole("button", { name: /ambient field/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector("canvas")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
    expect(localStorage.getItem("sb_ambient_field")).toBe("off");
  });
});
