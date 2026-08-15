import "@testing-library/jest-dom";
import { vi } from "vitest";

// Unit tests must never build a real client: without VITE_SUPABASE_* the client
// module exports null and every `supabase.auth` call throws, and with them it
// makes live network calls against the real project. A test that needs different
// behaviour declares its own vi.mock of this path, which wins over this one.
vi.mock("@/integrations/supabase/client", async () => {
  const { createSupabaseStub } = await import("./supabase-stub");
  return { supabase: createSupabaseStub() };
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
