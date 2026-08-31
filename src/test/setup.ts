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

// jsdom ships no IntersectionObserver, and several components construct one on
// mount (the landing page's scroll reveal, the sheet section navigator). Without
// this they throw during the mount effect and take the whole render with them.
// Inert by design: nothing here fires callbacks, so tests never see a reveal.
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: IntersectionObserverStub,
});
Object.defineProperty(globalThis, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: IntersectionObserverStub,
});
