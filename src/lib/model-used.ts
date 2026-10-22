/**
 * Which model wrote a medical-notes response, read from its headers.
 *
 * `X-Model-Used` is `<provider>/<model>`. Every writer is Corti now —
 * `corti/corti-s1-instant` (premium), `corti/corti-s1-mini-instant` (standard).
 * `X-Model-Fallback: corti_unavailable` marks a request whose usual model was
 * unavailable, answered by Corti's other model instead.
 *
 * Saved sheets and decks keep the value they were written with, so the
 * retired OpenRouter models still parse: `openrouter/openai/gpt-oss-20b`,
 * `openrouter/anthropic/claude-haiku-4.5`, or the bare id from older
 * deployments (`openai/gpt-oss-20b`).
 */
export type ModelKind = "corti" | "gpt-oss" | "claude" | "unknown";

export interface ModelUsed {
  kind: ModelKind;
  /** True when the request's usual model was unavailable and another wrote it. */
  fallback: boolean;
  /** The header value as sent, for tooltips and debugging. */
  raw: string;
}

type HeaderSource = Pick<Headers, "get">;

export function parseModelUsed(headers: HeaderSource): ModelUsed {
  return modelUsedFrom(
    headers.get("X-Model-Used") ?? "",
    (headers.get("X-Model-Fallback") ?? "").trim() !== ""
  );
}

/**
 * The same, from the values themselves. A sheet's stream opens before the
 * writer is chosen, so the model arrives in a frame rather than a header.
 */
export function modelUsedFrom(raw: string, fallback: boolean): ModelUsed {
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
