import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  isAnonymous: false,
  loading: false,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    ...auth,
    session: null,
    signIn: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ error: null, needsVerification: false })),
    signInWithGoogle: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updatePassword: vi.fn(async () => ({ error: null })),
    verifyOtp: vi.fn(async () => ({ error: null })),
    resendSignUpOtp: vi.fn(async () => ({ error: null })),
  }),
}));

import RequireAccount from "./RequireAccount";

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<RequireAccount />}>
          <Route path="/dashboard" element={<p>The dashboard</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

const selectedTab = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

describe("RequireAccount", () => {
  beforeEach(() => {
    auth.user = null;
    auth.isAnonymous = false;
    auth.loading = false;
  });

  // The dialog opens over the screen and, as a modal, hides it from the
  // accessibility tree, so the screen's own heading is queried with hidden: true.
  it("shows a signed-out visitor the account screen instead of the page, opened on Sign Up", () => {
    renderAt("/dashboard?start=sheet");
    expect(screen.queryByText("The dashboard")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Create your free account", hidden: true })).toBeInTheDocument();
    expect(selectedTab()).toBe("Sign Up");
  });

  it("opens on Sign In for a visitor who came from a sign-in link", () => {
    renderAt("/dashboard?signin=1");
    expect(selectedTab()).toBe("Sign In");
  });

  it("reopens the dialog on either tab from the screen's buttons", () => {
    renderAt("/dashboard");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(selectedTab()).toBe("Sign In");
  });

  it("asks a guest from before accounts were required to sign up, keeping their work", () => {
    auth.user = { id: "guest" };
    auth.isAnonymous = true;
    renderAt("/dashboard");
    expect(screen.queryByText("The dashboard")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Keep going with a free account", hidden: true })).toBeInTheDocument();
    expect(screen.getByText(/everything you have made so far moves into it/)).toBeInTheDocument();
  });

  it("renders the page for a signed-in student", () => {
    auth.user = { id: "student" };
    renderAt("/dashboard");
    expect(screen.getByText("The dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("shows neither while the session is still loading", () => {
    auth.loading = true;
    renderAt("/dashboard");
    expect(screen.queryByText("The dashboard")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Create your free account" })).toBeNull();
  });
});
