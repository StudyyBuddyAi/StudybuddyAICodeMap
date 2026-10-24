import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelCredit, CORTI_URL } from "./PoweredByCorti";
import type { ModelUsed } from "@/lib/model-used";

const used = (kind: ModelUsed["kind"], fallback = false): ModelUsed => ({ kind, fallback, raw: "" });

describe("ModelCredit", () => {
  it("credits Corti with a link to corti.ai that opens in a new tab", () => {
    render(<ModelCredit used={used("corti")} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", CORTI_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveTextContent(/Powered by/);
    expect(link).toHaveTextContent(/Built for healthcare/);
  });

  it("drops the tagline in compact form", () => {
    render(<ModelCredit used={used("corti")} compact />);
    expect(screen.getByRole("link")).not.toHaveTextContent(/Built for healthcare/);
  });

  it("tells the student when a request fell back to Corti's other model", () => {
    render(<ModelCredit used={used("corti", true)} />);
    expect(screen.getByRole("note")).toHaveTextContent("Backup model · usual model unavailable");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("gives a legacy Haiku fallback the same notice", () => {
    render(<ModelCredit used={used("claude", true)} />);
    expect(screen.getByRole("note")).toHaveTextContent("Backup model · usual model unavailable");
  });

  it("never names the free-tier model", () => {
    const { container } = render(<ModelCredit used={used("gpt-oss")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an unknown or missing model", () => {
    const { container: a } = render(<ModelCredit used={used("unknown")} />);
    const { container: b } = render(<ModelCredit used={null} />);
    expect(a).toBeEmptyDOMElement();
    expect(b).toBeEmptyDOMElement();
  });
});
