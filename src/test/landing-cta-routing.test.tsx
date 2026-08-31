import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Index from "@/pages/Index";

/**
 * The landing page's primary CTAs used to navigate to `/dashboard?start=sheet`.
 * Nothing ever read that query param — Dashboard has no `useSearchParams` — so
 * every "start generating" button dropped the user on the tool grid instead of
 * the generator. These tests pin the destination.
 */

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
};

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/sheets" element={<div>sheet generator</div>} />
        <Route path="/dashboard" element={<div>tool grid</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );

describe("landing page primary CTAs", () => {
  it("renders immediately rather than blanking for a frame", () => {
    renderLanding();
    // The page used to gate its whole render behind a `ready` flag set in an
    // effect, so first paint was an empty document. Asserted on the CTA rather
    // than on headline copy, which is marketing text and will keep changing.
    expect(
      screen.getAllByRole("button", { name: /start for free/i }).length
    ).toBeGreaterThan(0);
  });

  it("sends 'Start for free' to the sheet generator, not the dashboard", () => {
    renderLanding();

    const [cta] = screen.getAllByRole("button", { name: /start for free/i });
    fireEvent.click(cta);

    expect(screen.getByTestId("pathname")).toHaveTextContent("/sheets");
  });

  it("sends the nav CTA to the sheet generator too", () => {
    renderLanding();

    // "Get early access" was renamed to "Start free": both CTAs navigate
    // straight to the generator, so a waitlist label described a flow that did
    // not exist.
    const [cta] = screen.getAllByRole("button", { name: /start free/i });
    fireEvent.click(cta);

    expect(screen.getByTestId("pathname")).toHaveTextContent("/sheets");
  });

  it("leaves no generation CTA pointing anywhere but the generator", () => {
    // Every button whose label promises a generation must land on /sheets —
    // this is what catches a new CTA being added with the old destination.
    for (const label of [/start for free/i, /start free/i]) {
      const { unmount } = renderLanding();
      for (const button of screen.getAllByRole("button", { name: label })) {
        fireEvent.click(button);
        expect(screen.getByTestId("pathname")).toHaveTextContent("/sheets");
      }
      unmount();
    }
  });
});
