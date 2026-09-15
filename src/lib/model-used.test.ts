import { describe, it, expect } from "vitest";
import { parseModelUsed, modelLabel } from "./model-used";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("parseModelUsed", () => {
  it("reads a Corti premium response", () => {
    expect(parseModelUsed(headers({ "X-Model-Used": "corti/corti-s1-instant" }))).toEqual({
      kind: "corti",
      fallback: false,
      raw: "corti/corti-s1-instant",
    });
  });

  it("reads the free tier through OpenRouter, with or without the provider prefix", () => {
    expect(parseModelUsed(headers({ "X-Model-Used": "openrouter/openai/gpt-oss-20b" })).kind).toBe("gpt-oss");
    expect(parseModelUsed(headers({ "X-Model-Used": "openai/gpt-oss-20b" })).kind).toBe("gpt-oss");
  });

  it("marks a Haiku answer to a premium request as a fallback", () => {
    const used = parseModelUsed(
      headers({ "X-Model-Used": "openrouter/anthropic/claude-haiku-4.5", "X-Model-Fallback": "corti_unavailable" })
    );
    expect(used.kind).toBe("claude");
    expect(used.fallback).toBe(true);
  });

  it("reads a legacy Haiku response without a fallback flag", () => {
    const used = parseModelUsed(headers({ "X-Model-Used": "anthropic/claude-haiku-4.5" }));
    expect(used).toMatchObject({ kind: "claude", fallback: false });
  });

  it("returns unknown when the header is missing", () => {
    expect(parseModelUsed(headers({}))).toEqual({ kind: "unknown", fallback: false, raw: "" });
  });
});

describe("modelLabel", () => {
  it("names each model", () => {
    expect(modelLabel("corti")).toBe("Corti S1");
    expect(modelLabel("gpt-oss")).toBe("GPT-OSS 20B");
    expect(modelLabel("claude")).toBe("Claude Haiku 4.5");
    expect(modelLabel("unknown")).toBe("AI");
  });
});
