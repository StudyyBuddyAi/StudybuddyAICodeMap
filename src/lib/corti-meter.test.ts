import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cortiChatCompletion,
  meterStream,
  type CortiCallRecord,
  type CortiConfig,
} from "../../supabase/functions/_shared/corti.ts";

// A distinct client id per test, so the module's token cache never carries one
// test's token exchange into the next.
let n = 0;
const configFor = (meter: CortiConfig["meter"] = null): CortiConfig => ({
  clientId: `test-${++n}`,
  clientSecret: "s",
  tenant: "base",
  region: "eu",
  model: "corti-s1-instant",
  routerModel: "corti-s1-instant",
  verifierModel: "corti-s1-instant",
  blueprintModel: "corti-s1-instant",
  meter,
});

const sse = (...events: unknown[]) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });
const usageFrame = { choices: [], usage: { prompt_tokens: 120, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 0 } } };

/** A body that arrives in the given pieces, however they split the events. */
const chunked = (...pieces: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(new TextEncoder().encode(p));
      c.close();
    },
  });

/** Answers the token exchange, then hands the completion request to `reply`. */
function mockCorti(reply: (body: Record<string, unknown>, init: RequestInit) => Response | Promise<Response>) {
  const sent: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url);
    if (href.includes("/protocol/openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 300 }), { status: 200 });
    }
    const body = JSON.parse(String(init.body));
    sent.push(body);
    return reply(body, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, fetchMock };
}

const recorder = () => {
  const calls: CortiCallRecord[] = [];
  return { calls, meter: { record: (c: CortiCallRecord) => calls.push(c) } };
};

const readAll = async (res: Response) => new TextDecoder().decode(new Uint8Array(await new Response(res.body).arrayBuffer()));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cortiChatCompletion without a meter", () => {
  it("sends and returns exactly what it always did", async () => {
    const body = sse(delta("Hi"), usageFrame, "[DONE]");
    const { sent } = mockCorti(() => new Response(body, { status: 200 }));
    const res = await cortiChatCompletion(configFor(), { messages: [{ role: "user", content: "x" }], stream: true });
    expect(sent[0].stream_options).toBeUndefined();
    expect(await readAll(res)).toBe(body);
  });
});

describe("a metered stream", () => {
  it("asks for usage, strips the usage-only frame, and records what Corti reported", async () => {
    const { sent } = mockCorti(() =>
      new Response(chunked(sse(delta("Hel")), sse(delta("lo")).slice(0, 12), sse(delta("lo")).slice(12) + sse(usageFrame, "[DONE]")), { status: 200 })
    );
    const { calls, meter } = recorder();
    const res = await cortiChatCompletion(configFor(meter), {
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "topic" }],
      stream: true,
      maxTokens: 500,
      tag: "sheet.writer",
    });
    expect(sent[0].stream_options).toEqual({ include_usage: true });
    const text = await readAll(res);
    expect(text).toBe(sse(delta("Hel"), delta("lo"), "[DONE]"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tag: "sheet.writer",
      model: "corti-s1-instant",
      stream: true,
      maxTokens: 500,
      inputChars: 8,
      outputChars: 5,
      status: 200,
      outcome: "ok",
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    });
  });

  it("keeps the usage frame when the caller asked for it", async () => {
    const body = sse(delta("a"), usageFrame, "[DONE]");
    mockCorti(() => new Response(body, { status: 200 }));
    const { calls, meter } = recorder();
    const res = await cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "x" }], stream: true, streamUsage: true });
    expect(await readAll(res)).toBe(body);
    expect(calls[0].usage?.completion_tokens).toBe(40);
  });

  it("reads CRLF-separated events and counts reasoning toward what was received", async () => {
    const body = 'data: {"choices":[{"delta":{"reasoning":"think"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\n';
    mockCorti(() => new Response(body, { status: 200 }));
    const { calls, meter } = recorder();
    const res = await cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "x" }], stream: true });
    expect(await readAll(res)).toBe(body);
    expect(calls[0]).toMatchObject({ outcome: "ok", outputChars: 7, usage: null });
  });

  it("records a stream the reader cancelled, with what it had received", async () => {
    let push: ((s: string) => void) | null = null;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(new TextEncoder().encode(s));
      },
    });
    mockCorti(() => new Response(upstream, { status: 200 }));
    const { calls, meter } = recorder();
    const res = await cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "x" }], stream: true });
    const reader = res.body!.getReader();
    push!(sse(delta("partial")));
    await reader.read();
    await reader.cancel();
    expect(calls).toEqual([expect.objectContaining({ outcome: "cancelled", outputChars: 7, usage: null })]);
  });

  it("records a stream that broke, and lets the reader see the break", async () => {
    let fail: ((e: Error) => void) | null = null;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse(delta("ab"))));
        fail = (e) => c.error(e);
      },
    });
    mockCorti(() => new Response(upstream, { status: 200 }));
    const { calls, meter } = recorder();
    const res = await cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "x" }], stream: true });
    const reader = res.body!.getReader();
    await reader.read();
    fail!(new Error("terminated"));
    await expect(reader.read()).rejects.toThrow("terminated");
    expect(calls).toEqual([expect.objectContaining({ outcome: "failed", outputChars: 2 })]);
  });
});

describe("a metered reply", () => {
  it("reads the usage and still hands the caller the whole body", async () => {
    const reply = { choices: [{ message: { content: "condition", reasoning: "hmm" } }], usage: { prompt_tokens: 507, completion_tokens: 3 } };
    mockCorti(() => new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } }));
    const { calls, meter } = recorder();
    const res = await cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "x" }], maxTokens: 16, tag: "sheet.archetype" });
    expect(await res.json()).toEqual(reply);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(calls[0]).toMatchObject({ tag: "sheet.archetype", stream: false, outcome: "ok", outputChars: 12, usage: { prompt_tokens: 507, completion_tokens: 3 } });
  });

  it("records a non-2xx and returns it unread for the caller to map", async () => {
    mockCorti(() => new Response("busy", { status: 429 }));
    const { calls, meter } = recorder();
    const res = await cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "x" }] });
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("busy");
    expect(calls[0]).toMatchObject({ outcome: "http_error", status: 429, usage: null });
  });

  it("records our own timeout as aborted, and still throws it", async () => {
    const controller = new AbortController();
    mockCorti((_body, init) => {
      controller.abort();
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      expect(init.signal?.aborted).toBe(true);
      throw err;
    });
    const { calls, meter } = recorder();
    await expect(
      cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "abcd" }], signal: controller.signal, maxTokens: 16000 })
    ).rejects.toThrow("aborted");
    expect(calls[0]).toMatchObject({ outcome: "aborted", status: 0, inputChars: 4, maxTokens: 16000, usage: null });
  });

  it("records a network failure as failed", async () => {
    mockCorti(() => {
      throw new TypeError("fetch failed");
    });
    const { calls, meter } = recorder();
    await expect(cortiChatCompletion(configFor(meter), { messages: [{ role: "user", content: "x" }] })).rejects.toThrow("fetch failed");
    expect(calls[0].outcome).toBe("failed");
  });
});

describe("meterStream", () => {
  it("ends once, and passes through what it cannot parse", async () => {
    const onEnd = vi.fn();
    const body = "data: not json\n\n" + sse("[DONE]");
    const out = meterStream(chunked(body), { keepUsageFrame: false, onEnd });
    expect(await readAll(new Response(out))).toBe(body);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("ok", null, 0, undefined);
  });

  it("keeps usage that rides on a frame with content", async () => {
    const onEnd = vi.fn();
    const frame = { choices: [{ delta: { content: "z" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    const out = meterStream(chunked(sse(frame)), { keepUsageFrame: false, onEnd });
    expect(await readAll(new Response(out))).toBe(sse(frame));
    expect(onEnd).toHaveBeenCalledWith("ok", frame.usage, 1, undefined);
  });
});
