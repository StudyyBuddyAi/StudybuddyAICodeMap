import { describe, it, expect, beforeAll } from "vitest";
import { act, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import OutputSection from "@/components/OutputSection";
import type { GeneratedSheet } from "@/types/generated-sheet";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

/**
 * `SaveButton` holds `saved` in local state, and `OutputSection` is never
 * unmounted between generations — SheetGenerator's render condition stays true
 * because `loading` is set in the same batch that clears `sheet`.
 *
 * So saving sheet A used to leave the button reading "Saved" and disabled for
 * sheet B: the second sheet could not be saved at all, with no error to explain
 * why. This pins that a new sheet gets a fresh button.
 */

const sheetFor = (topic: string): GeneratedSheet => ({
  topic,
  topicEmoji: "*",
  overview: `Overview of ${topic}`,
  memoryHooks: ["hook"],
  clinicalApproach: "Diagnosis: test",
  keyPoints: ["point"],
  examTraps: ["trap"],
  flashcards: [{ tag: "Next Step", question: "q", answer: "a" }],
  referenceNote: "refs",
});

async function renderSheet(sheet: GeneratedSheet): Promise<RenderResult> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <OutputSection output={JSON.stringify(sheet)} inputText={sheet.topic} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });
  return result;
}

const saveButton = () =>
  screen.getByRole("button", { name: /^save(d)?$/i }) as HTMLButtonElement;

describe("SaveButton across consecutive sheets", () => {
  it("starts enabled and reads 'Save'", async () => {
    await renderSheet(sheetFor("Heart Failure"));
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveTextContent(/save/i);
  });

  it("shows 'Saved' and disables after saving", async () => {
    await renderSheet(sheetFor("Heart Failure"));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent(/saved/i);
  });

  it("offers a fresh Save when a different sheet replaces the saved one", async () => {
    const { rerender } = await renderSheet(sheetFor("Heart Failure"));

    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveButton()).toBeDisabled();

    // Same mounted OutputSection, new sheet content — exactly what a second
    // generation does.
    const next = sheetFor("Pneumonia");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <OutputSection output={JSON.stringify(next)} inputText={next.topic} />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });

    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveTextContent(/^save$/i);
  });
});
