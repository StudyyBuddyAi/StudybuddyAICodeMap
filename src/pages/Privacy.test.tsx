import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Privacy from "./Privacy";
import { PRIVACY_SECTIONS } from "@/content/privacy";

describe("Privacy", () => {
  it("renders every section of the policy as text", () => {
    render(<Privacy />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeInTheDocument();
    for (const s of PRIVACY_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: s.heading })).toBeInTheDocument();
    }
    expect(screen.getByText(/delete my account/i)).toBeInTheDocument();
  });

  it("has a linkable deletion section that puts in-app deletion first", () => {
    const { container } = render(<Privacy />);
    const section = container.querySelector("section#delete-account");
    expect(section).not.toBeNull();
    const paragraphs = Array.from(section!.querySelectorAll("p"), (p) => p.textContent ?? "");
    expect(paragraphs[0]).toMatch(/^In the app: open Settings, choose Delete account/);
    expect(paragraphs.some((p) => /email .* "Delete my account"/.test(p))).toBe(true);
  });

  it("says plainly what the product does not do", () => {
    render(<Privacy />);
    expect(screen.getByText(/No advertising/)).toBeInTheDocument();
    expect(screen.getByText(/Vercel Web Analytics/)).toBeInTheDocument();
  });
});
