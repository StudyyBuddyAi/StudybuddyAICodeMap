import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1", email: "sam@example.com" }, isAnonymous: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));

import AppNav, { NAV_ITEMS } from "./AppNav";

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppNav onOpenAuth={vi.fn()} onOpenAccount={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("AppNav", () => {
  it("gives every page its own button, with no menu to open", () => {
    renderAt("/dashboard");
    // The bar's row (lg up) and the second row (below lg) both carry all six.
    const navs = screen.getAllByRole("navigation", { name: "Main" });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(NAV_ITEMS.map((i) => i.label));
    }
    expect(screen.queryByRole("button", { name: /Tools|menu/i })).toBeNull();
  });

  it("marks the page you are on, deep routes included", () => {
    renderAt("/qbank/progress");
    for (const nav of screen.getAllByRole("navigation", { name: "Main" })) {
      expect(within(nav).getByRole("link", { name: "QBank" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Flashcards" })).not.toHaveAttribute("aria-current");
    }
  });
});
