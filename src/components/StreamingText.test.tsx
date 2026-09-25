import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StreamingWords } from "./StreamingText";
import { closeOpenBold } from "@/lib/close-open-bold";

describe("closeOpenBold", () => {
  it("closes a bold keyword the model has not finished", () => {
    expect(closeOpenBold("Inhibits **vitamin K")).toBe("Inhibits **vitamin K**");
  });

  it("leaves balanced text alone", () => {
    expect(closeOpenBold("Inhibits **VKOR** in the liver")).toBe(
      "Inhibits **VKOR** in the liver"
    );
  });
});

describe("StreamingWords", () => {
  it("renders a half-written keyword bold, without its asterisks", () => {
    const { container } = render(<StreamingWords text="Inhibits **vitamin K" />);
    expect(container.textContent).toBe("Inhibits vitamin K");
    expect(container.querySelector("strong")?.textContent).toBe("vitamin K");
  });

  it("keeps the spans it has as more words arrive, so only new words animate", () => {
    const { container, rerender } = render(<StreamingWords text="Loop diuretics" />);
    const first = container.querySelector(".sb-word-in");
    rerender(<StreamingWords text="Loop diuretics relieve congestion" />);
    expect(container.querySelector(".sb-word-in")).toBe(first);
    expect(container.querySelectorAll(".sb-word-in")).toHaveLength(4);
  });
});
