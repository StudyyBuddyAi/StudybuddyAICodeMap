import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

type AuthChangeCallback = (event: string, session: unknown) => void;
let authChangeCallback: AuthChangeCallback = () => {};
let sessionResult: { session: { user: { id: string; is_anonymous: boolean } } | null } = {
  session: null,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthChangeCallback) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: async () => ({ data: sessionResult, error: null }),
    },
    from: () => ({
      select: function (this: unknown) {
        return this;
      },
      eq: function (this: unknown) {
        return this;
      },
      in: function (this: unknown) {
        return this;
      },
      upsert: async () => ({ data: null, error: null }),
      insert: async () => ({ data: null, error: null }),
    }),
  },
}));

import AuthCallback from "@/pages/AuthCallback";
import { stashPendingUpgrade } from "@/lib/auth-upgrade";

async function renderCallback() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AuthCallback />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });
}

beforeEach(() => {
  navigateMock.mockClear();
  sessionResult = { session: null };
  authChangeCallback = () => {};
  sessionStorage.clear();
});

describe("AuthCallback", () => {
  it("navigates to the stashed returnTo once a non-anonymous session appears", async () => {
    await stashPendingUpgrade(null, "/sheets?start=1");
    await renderCallback();

    await act(async () => {
      authChangeCallback("SIGNED_IN", { user: { id: "real-1", is_anonymous: false } });
    });

    expect(navigateMock).toHaveBeenCalledWith("/sheets?start=1", { replace: true });
  });

  it("falls back to /dashboard when nothing was stashed", async () => {
    await renderCallback();

    await act(async () => {
      authChangeCallback("SIGNED_IN", { user: { id: "real-1", is_anonymous: false } });
    });

    expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("ignores an anonymous SIGNED_IN event", async () => {
    await renderCallback();

    await act(async () => {
      authChangeCallback("SIGNED_IN", { user: { id: "anon-1", is_anonymous: true } });
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
