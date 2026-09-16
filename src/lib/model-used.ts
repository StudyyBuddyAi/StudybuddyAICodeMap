/**
 * Which model wrote a medical-notes response, read from its headers.
 *
 * `X-Model-Used` is `<provider>/<model>` — `corti/corti-s1-instant`,
 * `openrouter/openai/gpt-oss-20b`, `openrouter/anthropic/claude-haiku-4.5` — or,
 * from older deployments, the bare OpenRouter id (`openai/gpt-oss-20b`).
 * `X-Model-Fallback: corti_unavailable` marks a premium request that Corti
 * could not serve, answered by Claude Haiku 4.5 instead.
 */
export type ModelKind = "corti" | "gpt-oss" | "claude" | "unknown";

export interface ModelUsed {
  kind: ModelKind;
  /** True when a premium request fell back from Corti to another model. */
  fallback: boolean;
  /** The header value as sent, for tooltips and debugging. */
  raw: string;
}

type HeaderSource = Pick<Headers, "get">;

export function parseModelUsed(headers: HeaderSource): ModelUsed {
  const raw = headers.get("X-Model-Used") ?? "";
  const fallback = (headers.get("X-Model-Fallback") ?? "").trim() !== "";
  const kind: ModelKind = raw.startsWith("corti/")
    ? "corti"
    : raw.includes("gpt-oss")
    ? "gpt-oss"
    : raw.includes("claude")
    ? "claude"
    : "unknown";
  return { kind, fallback, raw };
}

/** Human name for a model kind, as shown on badges. */
export function modelLabel(kind: ModelKind): string {
  switch (kind) {
    case "corti":
      return "Corti S1";
    case "gpt-oss":
      return "GPT-OSS 20B";
    case "claude":
      return "Claude Haiku 4.5";
    default:
      return "AI";
  }
}
