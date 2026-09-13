import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// ── A fake server with real network behaviour ───────────────────────────────
//
// Every RPC resolves after its own latency, so requests can land in a different
// order from the one they were sent in — which is exactly what a flaky mobile
// connection or a slow first request does to a student tapping Flag.

type Latency = (name: string, args: Record<string, unknown>) => number;

const server = {
  flags: new Set<string>(),
  progressSeq: 0,
  latency: (() => 5) as Latency,
  calls: [] as string[],
  /** Fails the next N saves, as a dropped connection would. */
  failSaves: 0,
  /** Bumped per test, so a request still in flight from the last test is ignored. */
  epoch: 0,
};

const QUESTIONS = ["q1", "q2", "q3"].map((id) => ({
  id,
  subject: "Cardiovascular",
  domain: "Pathology",
  topic: "t",
  difficulty: "Medium",
  competency: "c",
  question_text: `stem ${id}`,
  option_a: "A",
  option_b: "B",
  option_c: "C",
  option_d: "D",
  option_e: "E",
}));

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handleRpc(name: string, args: Record<string, unknown>) {
  server.calls.push(name);
  const epoch = server.epoch;
  switch (name) {
    case "resume_qbank_session":
      return {
        data: {
          session: {
            id: "s1",
            mode: "tutor",
            started_at: new Date().toISOString(),
            current_index: 0,
            skipped_ids: [],
            elapsed_ms: 0,
            expected_total: 3,
            generation: null,
            annotations: {},
            progress_seq: server.progressSeq,
          },
          questions: QUESTIONS,
          answers: [],
          flagged: [...server.flags],
          generation_max_index: null,
        },
        error: null,
      };
    case "set_question_flag": {
      // Mirrors the SQL: read "does it exist", then write. Not atomic, so two
      // overlapping inserts collide on the unique constraint.
      const q = args.p_question as string;
      const existed = server.flags.has(q);
      await delay(server.latency(name, args));
      if (epoch !== server.epoch) return { data: null, error: null };
      if (args.p_flagged) {
        if (!existed && server.flags.has(q)) {
          return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        }
        server.flags.add(q);
      } else {
        server.flags.delete(q);
      }
      return { data: { ok: true }, error: null };
    }
    case "save_qbank_progress": {
      await delay(server.latency(name, args));
      if (epoch !== server.epoch) return { data: null, error: null };
      if (server.failSaves > 0) {
        server.failSaves--;
        return { data: null, error: { message: "Failed to fetch" } };
      }
      const seq = args.p_seq as number;
      if (seq <= server.progressSeq) return { data: { ok: false, reason: "stale" }, error: null };
      server.progressSeq = seq;
      if (Array.isArray(args.p_flagged_ids)) server.flags = new Set(args.p_flagged_ids as string[]);
      return { data: { ok: true }, error: null };
    }
    default:
      return { data: null, error: null };
  }
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => handleRpc(name, args ?? {}),
    from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "token" } }),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import { QBankProvider, useQBankContext } from "./QBankContext";

let ctx: ReturnType<typeof useQBankContext>;
const Probe = () => {
  ctx = useQBankContext();
  return null;
};

async function mountResumed() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QBankProvider>
          <Probe />
        </QBankProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  await act(async () => {
    await ctx.resumeSession("s1", { explicit: true });
  });
  expect(ctx.session?.sessionId).toBe("s1");
}

/** Flag state the student sees, and what the server will show on the next resume. */
const uiFlags = () => [...ctx.flaggedIds].sort();
const serverFlags = () => [...server.flags].sort();

beforeEach(() => {
  server.epoch++;
  server.flags = new Set();
  server.progressSeq = 0;
  server.latency = () => 5;
  server.calls = [];
  server.failSaves = 0;
  toastMock.mockClear();
});

describe("QBank flagging — the student's view and the server must agree", () => {
  it("flag, then unflag, when the first request is the slow one", async () => {
    await mountResumed();
    // The flag request crawls; the unflag one is quick. Sent in order, they land
    // reversed.
    let n = 0;
    server.latency = () => (n++ === 0 ? 400 : 20);

    await act(async () => {
      void ctx.toggleFlag("q1");
    });
    await act(async () => {
      void ctx.toggleFlag("q1");
    });

    expect(uiFlags()).toEqual([]);
    await waitFor(() => expect(ctx.saveState).toBe("idle"), { timeout: 3000 });
    await act(() => delay(600));
    expect(serverFlags()).toEqual(uiFlags());
  });

  it("flag, unflag, flag in quick succession with jittery latency", async () => {
    await mountResumed();
    const latencies = [300, 30, 150, 10, 200];
    let n = 0;
    server.latency = () => latencies[n++ % latencies.length];

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        void ctx.toggleFlag("q2");
      });
    }

    expect(uiFlags()).toEqual(["q2"]);
    await act(() => delay(1000));
    expect(serverFlags()).toEqual(uiFlags());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("two toggles before React re-renders (double-tap on a slow device)", async () => {
    await mountResumed();
    server.latency = () => 50;

    await act(async () => {
      void ctx.toggleFlag("q3");
      void ctx.toggleFlag("q3");
    });

    // Two taps on Flag is "flag, then unflag".
    expect(uiFlags()).toEqual([]);
    await act(() => delay(500));
    expect(serverFlags()).toEqual(uiFlags());
  });

  it("a flag made just before Save & Exit is there on resume", async () => {
    await mountResumed();
    server.latency = () => 250;

    await act(async () => {
      void ctx.toggleFlag("q1");
    });
    await act(async () => {
      await ctx.saveAndExit();
    });

    // What a resume on another device would see, at the moment exit completed.
    expect(serverFlags()).toEqual(["q1"]);
  });

  it("a flag whose save is dropped by the network still reaches the server", async () => {
    await mountResumed();
    server.failSaves = 1;

    await act(async () => {
      void ctx.toggleFlag("q2");
    });

    // The failure is visible rather than silent...
    await waitFor(() => expect(ctx.saveState).toBe("error"));
    expect(uiFlags()).toEqual(["q2"]);
    expect(serverFlags()).toEqual([]);

    // ...and the retry lands it.
    await waitFor(() => expect(serverFlags()).toEqual(["q2"]), { timeout: 5000 });
    expect(ctx.saveState).toBe("idle");
  }, 10_000);
});
