import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Privacy from "./Privacy";
import AppFooter from "@/components/layout/AppFooter";
import { PRIVACY_CONTACT_EMAIL, PRIVACY_SECTIONS } from "@/content/privacy";

const renderPrivacy = () =>
  render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>
  );

describe("Privacy", () => {
  it("renders every section, each linked from the contents", () => {
    renderPrivacy();
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    // One query each, not one per section: role queries on a page this long are slow.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    for (const s of PRIVACY_SECTIONS) {
      expect(headings.some((h) => h?.endsWith(s.heading))).toBe(true);
    }
    const contents = screen.getByRole("navigation", { name: "Contents" });
    const hrefs = Array.from(contents.querySelectorAll("a"), (a) => a.getAttribute("href"));
    expect(hrefs).toEqual(PRIVACY_SECTIONS.map((s) => `#${s.id}`));
  });

  it("has no unfilled placeholders and a real contact address", () => {
    const { container } = renderPrivacy();
    expect(container.textContent).not.toMatch(/\[[^\]]*\]/);
    expect(PRIVACY_CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
    const mailto = screen.getAllByRole("link", { name: PRIVACY_CONTACT_EMAIL });
    expect(mailto[0]).toHaveAttribute("href", `mailto:${PRIVACY_CONTACT_EMAIL}`);
  });

  it("has a linkable deletion section that puts in-app deletion first", () => {
    const { container } = renderPrivacy();
    const section = container.querySelector("section#delete-account");
    expect(section).not.toBeNull();
    const paragraphs = Array.from(section!.querySelectorAll("p"), (p) => p.textContent ?? "");
    expect(paragraphs[0]).toMatch(/^In the app: open Settings, choose Delete account/);
    expect(paragraphs.some((p) => /email .* "Delete my account"/.test(p))).toBe(true);
  });

  it("states what the product does not do and who processes data", () => {
    renderPrivacy();
    expect(screen.getByText(/We do not sell, rent or trade personal information/)).toBeInTheDocument();
    expect(screen.getByText(/Vercel Web Analytics, which sets no cookies/)).toBeInTheDocument();
    const cells = Array.from(document.querySelectorAll("td"), (td) => td.textContent);
    for (const provider of ["Supabase", "Vercel", "Corti, OpenRouter", "WhatsApp (Meta)"]) {
      expect(cells).toContain(provider);
    }
  });
});

describe("AppFooter", () => {
  it("links to the privacy policy", () => {
    render(
      <MemoryRouter>
        <AppFooter />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });
});
