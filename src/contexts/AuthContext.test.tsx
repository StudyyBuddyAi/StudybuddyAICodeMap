import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "./AuthContext";

/** Exposes the context to the test. */
let current: ReturnType<typeof useAuth> | null = null;
const Probe = () => {
  current = useAuth();
  return null;
};

const renderProvider = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("AuthProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    current = null;
  });

  it("never starts a guest session: a visitor with no session stays signed out", async () => {
    const anon = vi.spyOn(supabase.auth, "signInAnonymously");
    renderProvider();
    await waitFor(() => expect(current?.loading).toBe(false));
    expect(current?.user).toBeNull();
    expect(current?.isAnonymous).toBe(false);
    expect(anon).not.toHaveBeenCalled();
  });

  it("signs out without starting a guest session in its place", async () => {
    const anon = vi.spyOn(supabase.auth, "signInAnonymously");
    const signOut = vi.spyOn(supabase.auth, "signOut");
    renderProvider();
    await waitFor(() => expect(current?.loading).toBe(false));
    await act(async () => {
      await current?.signOut();
    });
    expect(signOut).toHaveBeenCalled();
    expect(anon).not.toHaveBeenCalled();
  });
});
