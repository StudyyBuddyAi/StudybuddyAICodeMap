/**
 * Corti Models client.
 *
 * Corti is an independent provider from OpenRouter and is reached directly:
 * its key comes from the Corti Console and is held server-side as the
 * CORTI_API_KEY edge-function secret. Nothing here touches OPENROUTER_API_KEY,
 * and nothing in the OpenRouter path (medical-notes, get-citations, the
 * embedding path in rag.ts) touches this. The two coexist deliberately.
 *
 * The API is OpenAI-compatible — same /v1/chat/completions shape, same SSE
 * framing terminating in `data: [DONE]` — so the streaming relay in
 * qbank-generate is the same code medical-notes already runs against
 * OpenRouter. Two differences that matter:
 *
 *   1. `response_format` supports {type: "json_object"} but NOT json_schema.
 *      The JSON contract therefore lives in the prompt and the output has to
 *      survive being imperfect (see src/lib/repair-llm-json.ts).
 *   2. Reasoning models return a separate `reasoning` field on the message and
 *      on each streaming delta. It bills as output but is NOT part of the JSON
 *      payload, so a consumer that concatenates `content` never sees it.
 *
 * Going direct also means there is no provider-routing/fallback layer: a
 * non-2xx from Corti is surfaced to the caller rather than failed over.
 */

/** Region the request is routed to. Data residency — pick deliberately. */
export type CortiRegion = "eu" | "us" | "fr";

/**
 * Writer model. `corti-s1` (GLM 5.2) emits a chain-of-thought trace before the
 * answer; the `-instant` variants skip it and return reasoning: null. The QBank
 * item-writing prompt is rule-dense enough that the deliberation is worth
 * paying for — but the model id is a parameter precisely so dropping to
 * `corti-s1-instant` for latency is a config change, not a code change.
 */
export type CortiModel =
  | "corti-s1"
  | "corti-s1-instant"
  | "corti-s1-mini"
  | "corti-s1-mini-instant";

const DEFAULT_REGION: CortiRegion = "eu";
const DEFAULT_MODEL: CortiModel = "corti-s1";

export interface CortiConfig {
  apiKey: string;
  region: CortiRegion;
  model: CortiModel;
}

/**
 * Reads the Corti configuration out of the edge-function environment.
 *
 * Throws on a missing key rather than returning a partial config: a request
 * that reaches the model with no credential fails deep inside the stream with
 * a 401 the client can't interpret, so it's better to fail at the top of the
 * handler with a name the logs can carry.
 */
export function cortiConfigFromEnv(): CortiConfig {
  const apiKey = Deno.env.get("CORTI_API_KEY");
  if (!apiKey) {
    throw new Error("CORTI_API_KEY is not configured");
  }

  const rawRegion = Deno.env.get("CORTI_REGION");
  const region: CortiRegion =
    rawRegion === "us" || rawRegion === "fr" || rawRegion === "eu"
      ? rawRegion
      : DEFAULT_REGION;

  const rawModel = Deno.env.get("CORTI_MODEL");
  const model: CortiModel =
    rawModel === "corti-s1" ||
    rawModel === "corti-s1-instant" ||
    rawModel === "corti-s1-mini" ||
    rawModel === "corti-s1-mini-instant"
      ? rawModel
      : DEFAULT_MODEL;

  return { apiKey, region, model };
}

/** Base URL for a region, without a trailing slash. */
export function cortiBaseUrl(region: CortiRegion): string {
  return `https://ai.${region}.corti.app/v1`;
}

export interface CortiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CortiCompletionOptions {
  messages: CortiMessage[];
  /** Overrides the configured model — used for the cheap verifier pass. */
  model?: CortiModel;
  stream?: boolean;
  /** 0–1. Item writing wants determinism; the verifier wants 0. */
  temperature?: number;
  maxTokens?: number;
  /** Sets response_format to {type:"json_object"}. No json_schema upstream. */
  json?: boolean;
  signal?: AbortSignal;
}

/**
 * POSTs to /v1/chat/completions and returns the raw Response.
 *
 * Returned unread so a streaming caller can relay `response.body` straight
 * through a TransformStream without buffering the whole generation, exactly as
 * medical-notes does. Non-2xx responses are returned as-is too — the caller
 * decides how to map an upstream failure onto its own status code, since only
 * it knows what needs refunding or cleaning up.
 */
export async function cortiChatCompletion(
  config: CortiConfig,
  options: CortiCompletionOptions
): Promise<Response> {
  const {
    messages,
    model = config.model,
    stream = false,
    temperature = 0.7,
    maxTokens = 16384,
    json = false,
    signal,
  } = options;

  return fetch(`${cortiBaseUrl(config.region)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
}

/**
 * Non-streaming convenience wrapper returning just the message content.
 *
 * Used for the short side-calls — resolving a free-text topic to a system, and
 * the independent key verification — where there is nothing to stream and the
 * caller only wants the text. `reasoning` is deliberately dropped: it is the
 * model's scratch work, it bills as output, and no caller should branch on it.
 */
export async function cortiComplete(
  config: CortiConfig,
  options: CortiCompletionOptions
): Promise<string> {
  const response = await cortiChatCompletion(config, { ...options, stream: false });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`corti_${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
