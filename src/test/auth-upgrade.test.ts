import { describe, it, expect, vi, beforeEach } from "vitest";

// Local mock so this file controls exactly what `.from(...)` returns and can
// record the rows it's asked to upsert — the global stub in setup.ts always
// resolves empty, which would hide the Math.max merge logic under test.
type Row = Record<string, unknown>;
const upserts: { table: string; rows: Row[]; options: unknown }[] = [];
let usageRowsByUser: Record<string, { kind: string; count: number }[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  const supabase = {
    from: (table: string) => {
      const state: { userId?: string; kind?: string } = {};
      const builder = {
        select: () => builder,
        eq: (col: string, value: string) => {
          if (col === "user_id") state.userId = value;
          if (col === "kind") state.kind = value;
          return builder;
        },
        maybeSingle: async () => {
          const rows = usageRowsByUser[state.userId ?? ""] ?? [];
          const match = rows.find((r) => r.kind === state.kind);
          return { data: match ? { count: match.count } : null, error: null };
        },
        upsert: (rows: Row | Row[], options: unknown) => {
          upserts.push({ table, rows: Array.isArray(rows) ? rows : [rows], options });
          return { then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }) };
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return builder;
    },
  };
  return { supabase };
});

import {
  applyAnonUsage,
  clearPendingUpgrade,
  readPendingUpgrade,
  stashPendingUpgrade,
} from "@/lib/auth-upgrade";

beforeEach(() => {
  upserts.length = 0;
  usageRowsByUser = {};
  sessionStorage.clear();
});

describe("pending upgrade stash", () => {
  it("round-trips through stash -> read -> clear", async () => {
    await stashPendingUpgrade("anon-1", "/sheets?start=1");
    const pending = readPendingUpgrade();
    expect(pending).not.toBeNull();
    expect(pending?.anonUserId).toBe("anon-1");
    expect(pending?.returnTo).toBe("/sheets?start=1");
  });

  it("clears on read so a second read returns null", async () => {
    await stashPendingUpgrade("anon-1", "/sheets");
    readPendingUpgrade();
    expect(readPendingUpgrade()).toBeNull();
  });

  it("clearPendingUpgrade removes a stash without consuming it via read", async () => {
    await stashPendingUpgrade("anon-1", "/sheets");
    clearPendingUpgrade();
    expect(readPendingUpgrade()).toBeNull();
  });

  it("returns null when nothing was stashed", () => {
    expect(readPendingUpgrade()).toBeNull();
  });

  it.each([["//evil.com"], ["https://evil.com"], ["/\\evil.com"]])(
    "rejects an unsafe returnTo (%s) and falls back to /dashboard",
    async (unsafe) => {
      await stashPendingUpgrade("anon-1", unsafe);
      expect(readPendingUpgrade()?.returnTo).toBe("/dashboard");
    }
  );

  it("accepts a same-origin path with a query string", async () => {
    await stashPendingUpgrade("anon-1", "/sheets?start=1");
    expect(readPendingUpgrade()?.returnTo).toBe("/sheets?start=1");
  });

  it("ignores a stash whose returnTo was tampered to be unsafe after storage", () => {
    sessionStorage.setItem(
      "studybuddy_pending_oauth_upgrade",
      JSON.stringify({
        anonUserId: "anon-1",
        usageDate: "2026-01-01",
        records: [],
        returnTo: "//evil.com",
      })
    );
    expect(readPendingUpgrade()?.returnTo).toBe("/dashboard");
  });
});

describe("applyAnonUsage", () => {
  const today = "2026-09-07";

  it("no-ops when there are no records", async () => {
    await applyAnonUsage("real-1", "anon-1", [], today);
    expect(upserts).toHaveLength(0);
  });

  it("no-ops when the anon id matches the real id (nothing to merge)", async () => {
    await applyAnonUsage("same-id", "same-id", [{ kind: "sheet", count: 3 }], today);
    expect(upserts).toHaveLength(0);
  });

  it("no-ops when there is no anon id to merge from", async () => {
    await applyAnonUsage("real-1", null, [{ kind: "sheet", count: 3 }], today);
    expect(upserts).toHaveLength(0);
  });

  it("takes Math.max(existing, anon) per kind", async () => {
    usageRowsByUser["real-1"] = [{ kind: "sheet", count: 5 }];
    await applyAnonUsage(
      "real-1",
      "anon-1",
      [
        { kind: "sheet", count: 2 },
        { kind: "flashcard", count: 8 },
      ],
      today
    );

    expect(upserts).toHaveLength(2);
    const sheetUpsert = upserts.find((u) => u.rows[0].kind === "sheet");
    const flashcardUpsert = upserts.find((u) => u.rows[0].kind === "flashcard");
    // existing (5) beats anon (2)
    expect(sheetUpsert?.rows[0]).toMatchObject({ user_id: "real-1", count: 5, usage_date: today });
    // anon (8) beats existing (0, no row)
    expect(flashcardUpsert?.rows[0]).toMatchObject({ user_id: "real-1", count: 8, usage_date: today });
  });
});
