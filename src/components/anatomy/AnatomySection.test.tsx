import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AnatomySection from "./AnatomySection";
import type { AnatomyImage } from "@/lib/callAnatomy";

const image = (over: Partial<AnatomyImage> = {}): AnatomyImage => ({
  id: "heart_1",
  title: "Heart, anterior view",
  labels: ["Left ventricle"],
  url: "https://example.test/heart.svg",
  aspectRatio: 0.8,
  attribution: null,
  sourceUrl: null,
  ...over,
});

const explain = () => vi.fn().mockResolvedValue({ text: "Pumps blood." });
const matching = (images: AnatomyImage[]) => vi.fn().mockResolvedValue({ images });

describe("AnatomySection", () => {
  it("shows a placeholder while matching, reserving the space", () => {
    const { container } = render(
      <AnatomySection topic="Heart failure" match={() => new Promise(() => {})} explain={explain()} />
    );
    expect(container.querySelector(".anatomy-skeleton")).not.toBeNull();
  });

  it("renders nothing at all when no image matches", async () => {
    // The expected outcome for most topics — not an error state.
    const { container } = render(
      <AnatomySection topic="Informed consent" match={matching([])} explain={explain()} />
    );
    await waitFor(() => expect(container.querySelector(".anatomy-skeleton")).toBeNull());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when matching fails, rather than surfacing an error", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("network"));
    const { container } = render(
      <AnatomySection topic="Heart failure" match={failing} explain={explain()} />
    );
    await waitFor(() => expect(container.querySelector(".anatomy-skeleton")).toBeNull());
    expect(container.innerHTML).toBe("");
  });

  it("renders the panel for a single match, with no tab strip", async () => {
    render(<AnatomySection topic="Heart failure" match={matching([image()])} explain={explain()} />);
    await waitFor(() => expect(screen.getByAltText("Heart, anterior view")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Heart, anterior view" })).not.toBeInTheDocument();
  });

  it("offers a tab per image when several match", async () => {
    const images = [image(), image({ id: "heart_2", title: "Heart, cross-section" })];
    render(<AnatomySection topic="Heart failure" match={matching(images)} explain={explain()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Heart, cross-section" })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Heart, anterior view" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("switches the displayed image when a tab is clicked", async () => {
    const images = [image(), image({ id: "heart_2", title: "Heart, cross-section" })];
    render(<AnatomySection topic="Heart failure" match={matching(images)} explain={explain()} />);
    await waitFor(() => screen.getByRole("button", { name: "Heart, cross-section" }));

    fireEvent.click(screen.getByRole("button", { name: "Heart, cross-section" }));
    await waitFor(() => expect(screen.getByAltText("Heart, cross-section")).toBeInTheDocument());
    expect(screen.queryByAltText("Heart, anterior view")).not.toBeInTheDocument();
  });

  it("passes the matched image's own ratio through to the panel", async () => {
    const { container } = render(
      <AnatomySection
        topic="Nephron"
        match={matching([image({ aspectRatio: 0.44 })])}
        explain={explain()}
      />
    );
    await waitFor(() => screen.getByAltText("Heart, anterior view"));
    const media = container.querySelector(".anatomy-media") as HTMLElement;
    expect(media.style.aspectRatio).toBe("0.44");
  });

  it("re-matches when the topic changes", async () => {
    const match = matching([image()]);
    const { rerender } = render(
      <AnatomySection topic="Heart failure" match={match} explain={explain()} />
    );
    await waitFor(() => expect(match).toHaveBeenCalledTimes(1));

    rerender(<AnatomySection topic="Nephrotic syndrome" match={match} explain={explain()} />);
    await waitFor(() => expect(match).toHaveBeenCalledTimes(2));
    expect(match.mock.calls[1][0]).toBe("Nephrotic syndrome");
  });

  it("marks the section so print and nav treat it like a sheet section", async () => {
    const { container } = render(
      <AnatomySection topic="Heart failure" match={matching([image()])} explain={explain()} />
    );
    await waitFor(() => screen.getByAltText("Heart, anterior view"));
    expect(container.querySelector('[data-section-key="anatomy"]')).not.toBeNull();
  });
});
