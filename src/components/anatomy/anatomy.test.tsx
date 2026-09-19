import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AnatomyPanel from "./AnatomyPanel";
import { ANATOMY_PROVENANCE } from "./AnatomyFrame";
import type { AnatomyImage } from "@/lib/callAnatomy";

const IMAGE: AnatomyImage = {
  id: "heart_anterior_chambers",
  title: "Heart, anterior view",
  labels: ["Left ventricle", "Mitral valve", "Aorta"],
  url: "https://example.test/heart.svg",
  aspectRatio: 0.75,
  attribution: "Wikimedia Commons",
  sourceUrl: "https://example.test/source",
};

const unlabelled: AnatomyImage = { ...IMAGE, labels: [], aspectRatio: null };

const explainOk = (text = "The left ventricle pumps into the aorta.") =>
  vi.fn().mockResolvedValue({ text });

/** A promise resolved by the test, so ordering can be controlled explicitly. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const scaleOf = (container: HTMLElement) => {
  const transform = container.querySelector("img")!.style.transform;
  return Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? "1");
};

describe("AnatomyPanel — labels", () => {
  it("renders one chip per label", () => {
    render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    for (const label of IMAGE.labels) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("chips are real buttons, so keyboard activation works without extra handlers", () => {
    render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    const chip = screen.getByRole("button", { name: "Aorta" });
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("asks for the tapped structure and shows the answer", async () => {
    const explain = explainOk("Thick-walled chamber.");
    render(<AnatomyPanel image={IMAGE} explain={explain} />);

    fireEvent.click(screen.getByRole("button", { name: "Left ventricle" }));

    await waitFor(() => expect(screen.getByText("Thick-walled chamber.")).toBeInTheDocument());
    expect(explain).toHaveBeenCalledTimes(1);
    expect(explain.mock.calls[0][0]).toEqual({
      diagram: "Heart, anterior view",
      part: "Left ventricle",
    });
  });

  it("sends no topic, because explanations are cached on (diagram, part)", async () => {
    const explain = explainOk();
    render(<AnatomyPanel image={IMAGE} explain={explain} />);
    fireEvent.click(screen.getByRole("button", { name: "Aorta" }));
    await waitFor(() => expect(explain).toHaveBeenCalled());
    expect(explain.mock.calls[0][0]).not.toHaveProperty("topic");
  });

  it("marks the active chip pressed", async () => {
    render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mitral valve" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mitral valve" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
  });
});

describe("AnatomyPanel — out-of-order answers", () => {
  it("shows the last tapped structure's answer, not the last to arrive", async () => {
    // Without the request guard a slow first answer lands under the second
    // label — a correctness bug that looks like a UI glitch.
    const first = deferred<{ text: string }>();
    const second = deferred<{ text: string }>();
    const explain = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<AnatomyPanel image={IMAGE} explain={explain} />);
    fireEvent.click(screen.getByRole("button", { name: "Left ventricle" }));
    fireEvent.click(screen.getByRole("button", { name: "Aorta" }));

    second.resolve({ text: "AORTA ANSWER" });
    await waitFor(() => expect(screen.getByText("AORTA ANSWER")).toBeInTheDocument());

    first.resolve({ text: "VENTRICLE ANSWER" });
    await Promise.resolve();
    expect(screen.queryByText("VENTRICLE ANSWER")).not.toBeInTheDocument();
    expect(screen.getByText("AORTA ANSWER")).toBeInTheDocument();
  });

  it("reports a failure instead of leaving the panel blank", async () => {
    const explain = vi.fn().mockRejectedValue(new Error("boom"));
    render(<AnatomyPanel image={IMAGE} explain={explain} />);
    fireEvent.click(screen.getByRole("button", { name: "Aorta" }));
    await waitFor(() => expect(screen.getByText(/Couldn't load/)).toBeInTheDocument());
  });
});

describe("AnatomyPanel — images without extractable labels", () => {
  it("offers a free-text box instead of chips", () => {
    render(<AnatomyPanel image={unlabelled} explain={explainOk()} />);
    expect(screen.getByLabelText("Structure to explain")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aorta" })).not.toBeInTheDocument();
  });

  it("asks for a typed structure", async () => {
    const explain = explainOk("A tuft of capillaries.");
    render(<AnatomyPanel image={unlabelled} explain={explain} />);

    fireEvent.change(screen.getByLabelText("Structure to explain"), {
      target: { value: "Glomerulus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));

    await waitFor(() => expect(explain).toHaveBeenCalled());
    expect(explain.mock.calls[0][0].part).toBe("Glomerulus");
  });

  it("ignores an empty submission", () => {
    const explain = explainOk();
    render(<AnatomyPanel image={unlabelled} explain={explain} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(explain).not.toHaveBeenCalled();
  });
});

describe("AnatomyPanel — zoom", () => {
  it("clamps zoom in at 4x", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (let i = 0; i < 8; i++) fireEvent.click(zoomIn);
    expect(scaleOf(container)).toBe(4);
  });

  it("clamps zoom out at 1x and never goes below it", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 5; i++) fireEvent.click(zoomOut);
    expect(scaleOf(container)).toBe(1);
  });

  it("offers Reset only once zoomed, and it returns to 1x", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const reset = screen.getByRole("button", { name: "Reset zoom" });
    expect(scaleOf(container)).toBeGreaterThan(1);

    fireEvent.click(reset);
    expect(scaleOf(container)).toBe(1);
  });

  it("produces no NaN coordinates without layout, as in jsdom", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(container.querySelector("img")!.style.transform).not.toContain("NaN");
  });
});

describe("AnatomyPanel — presentation and safety", () => {
  it("reserves the image's own ratio, not a fixed one", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    expect((container.querySelector(".anatomy-media") as HTMLElement).style.aspectRatio).toBe(
      "0.75"
    );
  });

  it("falls back to a default ratio when ingest could not read one", () => {
    const { container } = render(<AnatomyPanel image={unlabelled} explain={explainOk()} />);
    const ratio = (container.querySelector(".anatomy-media") as HTMLElement).style.aspectRatio;
    expect(ratio).not.toBe("");
    expect(Number(ratio)).toBeCloseTo(4 / 3);
  });

  it("gives the image a meaningful alt, not 'diagram'", () => {
    render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    expect(screen.getByAltText("Heart, anterior view")).toBeInTheDocument();
  });

  it("carries the provenance caption and credits the illustration", () => {
    render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    expect(screen.getByText(new RegExp(ANATOMY_PROVENANCE.slice(0, 40)))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wikimedia Commons" })).toBeInTheDocument();
  });

  it("does not describe the illustration itself as AI-generated", () => {
    // The picture is published work; only the prose is generated. Conflating
    // them would understate the image and overstate the model at once.
    expect(ANATOMY_PROVENANCE).toMatch(/explanations are ai-generated/i);
    expect(ANATOMY_PROVENANCE).not.toMatch(/ai-generated (diagram|image|illustration)/i);
  });

  it("announces the explanation politely", async () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk("Pumps.")} />);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Aorta" }));
    await waitFor(() =>
      expect(container.querySelector('[aria-live="polite"]')!.textContent).toContain("Pumps.")
    );
  });

  it("never uses dangerouslySetInnerHTML", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "src/components/anatomy");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("dangerouslySetInnerHTML"));
    expect(offenders).toEqual([]);
  });
});

describe("AnatomyPanel — layout", () => {
  it("exposes the ratio to CSS so the height cap can derive a width", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    const media = container.querySelector(".anatomy-media") as HTMLElement;
    expect(media.style.getPropertyValue("--anatomy-ratio")).toBe("0.75");
  });

  it("falls back to the default ratio in the custom property too", () => {
    const { container } = render(<AnatomyPanel image={unlabelled} explain={explainOk()} />);
    const media = container.querySelector(".anatomy-media") as HTMLElement;
    expect(Number(media.style.getPropertyValue("--anatomy-ratio"))).toBeCloseTo(4 / 3);
  });

  it("puts the chips in a class, not an inline flex row", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    expect(container.querySelector(".anatomy-chips")).not.toBeNull();
  });

  it("leaves chip padding to the stylesheet", () => {
    // An inline padding would beat .anatomy-chip and the class would silently
    // do nothing — which is exactly how the first attempt at this failed.
    render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    expect(screen.getByRole("button", { name: "Aorta" }).style.padding).toBe("");
  });

  it("keeps explicit padding on the zoom controls", () => {
    render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    expect(screen.getByRole("button", { name: "Zoom in" }).style.padding).not.toBe("");
  });
});

describe("AnatomyPanel — panning must not crash the tree", () => {
  it("survives a move and release batched in one flush", () => {
    // The move queues a state update; the release clears the drag ref. If the
    // updater reads that ref, React runs it during the render phase after the
    // ref is already null, throws, and unmounts the entire app — the page just
    // vanishes. Batching both in one act() reproduces that ordering.
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    const media = container.querySelector(".anatomy-media") as HTMLElement;
    fireEvent.pointerDown(media, { pointerId: 1, clientX: 100, clientY: 100 });

    act(() => {
      fireEvent.pointerMove(media, { pointerId: 1, clientX: 140, clientY: 130 });
      fireEvent.pointerUp(media, { pointerId: 1, clientX: 140, clientY: 130 });
    });

    expect(container.querySelector(".anatomy-media")).not.toBeNull();
    expect(screen.getByAltText("Heart, anterior view")).toBeInTheDocument();
  });

  it("survives a stray move arriving after the release", () => {
    const { container } = render(<AnatomyPanel image={IMAGE} explain={explainOk()} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    const media = container.querySelector(".anatomy-media") as HTMLElement;
    fireEvent.pointerDown(media, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(media, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(media, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(screen.getByAltText("Heart, anterior view")).toBeInTheDocument();
  });
});

describe("AnatomyBoundary", () => {
  const Boom = () => {
    throw new Error("panel exploded");
  };

  it("hides a crashing panel instead of unmounting the page", async () => {
    const { default: AnatomyBoundary } = await import("./AnatomyBoundary");
    // React logs the caught error; silence it so the run stays readable.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <div>
        <p>sheet content</p>
        <AnatomyBoundary>
          <Boom />
        </AnatomyBoundary>
      </div>
    );

    // The diagram is gone, but everything around it survives — which is the
    // whole point: a broken panel must never blank the sheet.
    expect(screen.getByText("sheet content")).toBeInTheDocument();
    expect(container.textContent).toBe("sheet content");
    spy.mockRestore();
  });
});
