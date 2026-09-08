import { describe, it, expect, vi } from "vitest";
import {
  runQbankGeneration,
  WAVE_SIZE,
  type QuestionReadyEvent,
} from "./qbank-wave-runner";
import type { QbankGenerateParams, CallQbankGenerateOptions } from "./callQbankGenerate";

/**
 * The wave loop's job is to end up with the number of questions it was asked
 * for, out of a pipeline where every stage can quietly produce fewer. These
 * tests are all variations on that: a wave that comes up short, a wave that
 * dies, a wave that is refused, a student who leaves — and in each case what
 * the loop does next, and what it finally reports.
 *
 * The edge function is faked at the SSE frame level rather than the fetch level
 * so the frames under test are the same shape the real function emits.
 */

const encoder = new TextEncoder();

/** A Response whose body streams the given frames, then [DONE]. */
function sseResponse(frames: unknown[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

/** A Response that never streams — the edge function refusing the request. */
function errorResponse(status: number, error: string): Response {
  return {
    ok: false,
    status,
    body: null,
    json: async () => ({ error }),
  } as unknown as Response;
}

/**
 * A body that dies part-way through, after emitting some frames.
 *
 * Emitted from `pull` rather than `start`, because erroring a stream discards
 * anything still queued — enqueueing everything and then calling error() would
 * model a connection that delivered nothing, which is the opposite of the case
 * under test. Pulling one frame per read means the reader has genuinely received
 * and processed each frame before the failure, which is what a dropped
 * connection actually looks like.
 */
function brokenResponse(frames: unknown[]): Response {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`));
        return;
      }
      controller.error(new Error("terminated"));
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

interface WaveSpec {
  /** How many questions this wave successfully commits. */
  delivers: number;
  /** Of those, how many the gate blocks. */
  blocked?: number;
  /** Of those, how many the blind second read disagrees with. */
  disputed?: number;
  systemName?: string;
  system?: string;
  subtopics?: string[];
  /** Emit the frames and then break the connection. */
  broken?: boolean;
}

function waveFrames(spec: WaveSpec, startIndex: number): unknown[] {
  const frames: unknown[] = [
    {
      __meta: {
        system: spec.system ?? "renal",
        systemName: spec.systemName ?? "Renal",
        model: "corti-s1-instant",
        plan: [],
        startIndex,
      },
    },
  ];

  for (let i = 0; i < spec.delivers; i++) {
    frames.push({
      __meta: {
        questionReady: {
          id: `q-${startIndex + i}`,
          index: startIndex + i,
          blocked: i < (spec.blocked ?? 0),
          difficulty: "Medium",
          reasoningOrder: "2nd",
          agreed: i >= (spec.blocked ?? 0) + (spec.disputed ?? 0),
        },
      },
    });
  }

  if (!spec.broken) {
    frames.push({
      __meta: {
        waveComplete: {
          requested: spec.delivers,
          persisted: spec.delivers,
          system: spec.system ?? "renal",
          systemName: spec.systemName ?? "Renal",
          subtopics: spec.subtopics ?? [],
          streamError: null,
        },
      },
    });
  }

  return frames;
}

/** A fake edge function that plays the given waves in order, recording calls. */
function fakeCall(waves: (WaveSpec | Response)[]) {
  const calls: QbankGenerateParams[] = [];
  let n = 0;
  const call = async (
    params: QbankGenerateParams,
    _options: CallQbankGenerateOptions = {}
  ): Promise<Response> => {
    calls.push(params);
    const spec = waves[Math.min(n, waves.length - 1)];
    n++;
    if (spec instanceof Object && "ok" in spec) return spec as Response;
    const s = spec as WaveSpec;
    const frames = waveFrames(s, params.startIndex ?? 1);
    return s.broken ? brokenResponse(frames) : sseResponse(frames);
  };
  return { call, calls };
}

const baseOpts = () => ({
  topic: "nephrotic syndrome",
  generationId: "gen-1",
  signal: new AbortController().signal,
  onQuestionReady: vi.fn(),
  // Tests must not sit through the real backoff.
  retryBackoffMs: [0, 0],
});

describe("runQbankGeneration", () => {
  it("splits a set into waves and reports every committed question", async () => {
    const { call, calls } = fakeCall([{ delivers: 5 }, { delivers: 5 }]);
    const ready: QuestionReadyEvent[] = [];

    const outcome = await runQbankGeneration({
      ...baseOpts(),
      target: 10,
      call,
      onQuestionReady: (e) => {
        ready.push(e);
      },
    });

    expect(outcome.status).toBe("complete");
    expect(outcome.delivered).toBe(10);
    expect(calls).toHaveLength(2);
    expect(ready).toHaveLength(10);
  });

  it("asks each wave only for what the set is still short of", async () => {
    const { call, calls } = fakeCall([{ delivers: 5 }, { delivers: 5 }, { delivers: 5 }]);

    await runQbankGeneration({ ...baseOpts(), target: 12, call });

    expect(calls.map((c) => c.count)).toEqual([WAVE_SIZE, WAVE_SIZE, 2]);
  });

  it("makes up a shortfall rather than counting the wave as done", async () => {
    // Five asked for, three delivered: the loop still owes two.
    const { call, calls } = fakeCall([{ delivers: 3 }, { delivers: 2 }]);

    const outcome = await runQbankGeneration({ ...baseOpts(), target: 5, call });

    expect(outcome.status).toBe("complete");
    expect(outcome.delivered).toBe(5);
    expect(calls.map((c) => c.count)).toEqual([5, 2]);
  });

  it("does not count questions the gate blocked or the second read disputed", async () => {
    // Four commit, but one is blocked and one disputed, so only two are playable.
    const { call, calls } = fakeCall([
      { delivers: 4, blocked: 1, disputed: 1 },
      { delivers: 2 },
    ]);

    const outcome = await runQbankGeneration({ ...baseOpts(), target: 4, call });

    expect(outcome.delivered).toBe(4);
    expect(outcome.heldBack).toBe(2);
    // Still owed two after a wave that committed four.
    expect(calls.map((c) => c.count)).toEqual([4, 2]);
  });

  it("carries the system, the index and the covered subtopics into later waves", async () => {
    const { call, calls } = fakeCall([
      { delivers: 5, system: "renal", systemName: "Renal", subtopics: ["RPGN", "ATN"] },
      { delivers: 5, subtopics: ["Amyloid"] },
    ]);

    await runQbankGeneration({ ...baseOpts(), target: 10, call });

    expect(calls[0].startIndex).toBe(1);
    expect(calls[0].system).toBeUndefined();
    expect(calls[0].avoidSubtopics).toEqual([]);

    // The second wave reuses the routed system rather than re-routing, starts
    // numbering after the first, and knows what has already been covered.
    expect(calls[1].system).toBe("renal");
    expect(calls[1].startIndex).toBe(6);
    expect(calls[1].avoidSubtopics).toEqual(["RPGN", "ATN"]);
  });

  it("numbers the next wave from what was asked for, not from what arrived", async () => {
    // Wave one asks for five and lands three. Wave two must still start at six:
    // numbering from what arrived would put it at four, over the top of indices
    // wave one had already used, and the set would come back out of order.
    const { call, calls } = fakeCall([{ delivers: 3 }, { delivers: 2 }]);

    await runQbankGeneration({ ...baseOpts(), target: 5, call });

    expect(calls.map((c) => c.startIndex)).toEqual([1, 6]);
  });

  it("re-attempts an empty wave at the same index it just used", async () => {
    // The retry replaces the wave rather than following it. Nothing playable was
    // written at those indices, so they are still free — advancing would leave a
    // permanent gap in the numbering of every set that ever hit a bad wave.
    const { call, calls } = fakeCall([{ delivers: 0 }, { delivers: 5 }]);

    const outcome = await runQbankGeneration({ ...baseOpts(), target: 5, call });

    expect(outcome.status).toBe("complete");
    expect(calls.map((c) => c.startIndex)).toEqual([1, 1]);
  });

  it("keeps the questions a dying stream had already committed", async () => {
    // Three arrived, then the connection dropped before the closing summary.
    const { call } = fakeCall([{ delivers: 3, broken: true }, { delivers: 2 }]);

    const outcome = await runQbankGeneration({ ...baseOpts(), target: 5, call });

    expect(outcome.status).toBe("complete");
    expect(outcome.delivered).toBe(5);
  });

  it("falls back to its own parse for subtopics when the summary never arrives", async () => {
    const { call, calls } = fakeCall([
      { delivers: 2, broken: true, subtopics: ["ignored"] },
      { delivers: 3 },
    ]);

    await runQbankGeneration({ ...baseOpts(), target: 5, call });

    // No waveComplete frame was sent, so there is nothing to carry — but the
    // run must still continue rather than stall on the missing summary.
    expect(calls).toHaveLength(2);
    expect(calls[1].startIndex).toBe(6);
  });

  it("stops immediately on a refusal that retrying cannot fix", async () => {
    const { call, calls } = fakeCall([errorResponse(401, "invalid_token")]);

    const outcome = await runQbankGeneration({ ...baseOpts(), target: 10, call });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("invalid_token");
    expect(calls).toHaveLength(1);
  });

  it("retries a wave that produced nothing, then gives up on a run of them", async () => {
    const { call, calls } = fakeCall([{ delivers: 0 }]);

    const outcome = await runQbankGeneration({ ...baseOpts(), target: 10, call });

    expect(outcome.status).toBe("failed");
    expect(outcome.delivered).toBe(0);
    // Bounded: it does not spin. Three empty waves, each re-attempted twice.
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(9);
  });

  it("reports a set that ended short as short, not as a failure", async () => {
    // One good wave, then nothing more ever comes.
    const { call } = fakeCall([{ delivers: 5 }, { delivers: 0 }]);

    const outcome = await runQbankGeneration({ ...baseOpts(), target: 20, call });

    expect(outcome.status).toBe("short");
    expect(outcome.delivered).toBe(5);
    expect(outcome.target).toBe(20);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const { call } = fakeCall([{ delivers: 5 }, { delivers: 5 }]);

    const outcome = await runQbankGeneration({
      ...baseOpts(),
      signal: controller.signal,
      target: 20,
      call,
      onQuestionReady: () => {
        // The student left, or finished the session, part-way through wave one.
        controller.abort();
      },
    });

    expect(outcome.status).toBe("aborted");
  });

  it("stops when the caller says the session is over", async () => {
    const { call, calls } = fakeCall([{ delivers: 5 }]);
    let waves = 0;

    const outcome = await runQbankGeneration({
      ...baseOpts(),
      target: 20,
      call,
      shouldContinue: () => waves++ < 1,
    });

    expect(outcome.status).toBe("short");
    expect(calls).toHaveLength(1);
  });

  it("awaits each question before handling the next", async () => {
    // The first question starts the session; the second must not race it into
    // starting a second one.
    const { call } = fakeCall([{ delivers: 3 }]);
    const order: string[] = [];

    await runQbankGeneration({
      ...baseOpts(),
      target: 3,
      call,
      onQuestionReady: async (e) => {
        order.push(`start:${e.index}`);
        await new Promise((r) => setTimeout(r, 1));
        order.push(`end:${e.index}`);
      },
    });

    expect(order).toEqual([
      "start:1", "end:1",
      "start:2", "end:2",
      "start:3", "end:3",
    ]);
  });

  it("resumes an interrupted set without renumbering or re-covering it", async () => {
    const { call, calls } = fakeCall([{ delivers: 5 }]);

    await runQbankGeneration({
      ...baseOpts(),
      target: 5,
      call,
      startIndex: 11,
      alreadyCovered: ["RPGN", "ATN"],
      system: "renal",
    });

    expect(calls[0].startIndex).toBe(11);
    expect(calls[0].system).toBe("renal");
    expect(calls[0].avoidSubtopics).toEqual(["RPGN", "ATN"]);
  });
});
