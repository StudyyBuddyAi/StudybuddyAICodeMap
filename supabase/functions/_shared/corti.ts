/**
 * Corti Models client.
 *
 * Corti is an independent provider from OpenRouter and is reached directly:
 * credentials come from the Corti Console and are held server-side. Nothing
 * here touches OPENROUTER_API_KEY, and nothing in the OpenRouter path
 * (medical-notes, get-citations, the embedding path in rag.ts) touches these.
 * The two coexist deliberately.
 *
 * Auth is OAuth2 client_credentials against Corti's Keycloak, NOT a static
 * bearer key. The console issues client_id + client_secret + tenant, and those
 * are exchanged for an access token that lives 300 seconds. Sending the secret
 * itself as a bearer token gets an empty HTTP 400 from the gateway — the same
 * response a random string gets — so a misconfiguration here looks like a
 * malformed request rather than an auth failure. getAccessToken() is what makes
 * that distinction legible.
 *
 * Once authenticated the API is OpenAI-compatible — same /v1/chat/completions
 * shape, same SSE framing terminating in `data: [DONE]` — so the streaming relay
 * in qbank-generate is the same code medical-notes already runs against
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
export type CortiRegion = "eu" | "us";

/**
 * Writer model. `corti-s1` emits a chain-of-thought trace before the answer;
 * the `-instant` variants skip it. The QBank item-writing prompt is rule-dense
 * enough that the deliberation is worth paying for — but the model id is a
 * parameter precisely so dropping to `corti-s1-instant` for latency is a config
 * change, not a code change.
 *
 * Context is 262,144 input tokens on every s1 variant, so the prompt has room.
 */
export type CortiModel =
  | "corti-s1"
  | "corti-s1-instant"
  | "corti-s1-mini"
  | "corti-s1-mini-instant";

const DEFAULT_REGION: CortiRegion = "eu";
const DEFAULT_MODEL: CortiModel = "corti-s1";
const DEFAULT_TENANT = "base";

export interface CortiConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  region: CortiRegion;
  model: CortiModel;
}

/**
 * Reads the Corti configuration out of the edge-function environment.
 *
 * Throws on missing credentials rather than returning a partial config: a
 * request that reaches the gateway without a valid token fails with an empty
 * 400 that says nothing, so it is far better to fail at the top of the handler
 * with a name the logs can carry.
 */
export function cortiConfigFromEnv(): CortiConfig {
  const clientId = Deno.env.get("CORTI_CLIENT_ID");
  const clientSecret = Deno.env.get("CORTI_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId && "CORTI_CLIENT_ID",
      !clientSecret && "CORTI_CLIENT_SECRET",
    ].filter(Boolean);
    throw new Error(`${missing.join(" and ")} not configured`);
  }

  const rawRegion = Deno.env.get("CORTI_REGION");
  const region: CortiRegion = rawRegion === "us" ? "us" : DEFAULT_REGION;

  const rawModel = Deno.env.get("CORTI_MODEL");
  const model: CortiModel =
    rawModel === "corti-s1" ||
    rawModel === "corti-s1-instant" ||
    rawModel === "corti-s1-mini" ||
    rawModel === "corti-s1-mini-instant"
      ? rawModel
      : DEFAULT_MODEL;

  return {
    clientId,
    clientSecret,
    tenant: Deno.env.get("CORTI_TENANT") || DEFAULT_TENANT,
    region,
    model,
  };
}

/** Base URL for the Models API in a region, without a trailing slash. */
export function cortiBaseUrl(region: CortiRegion): string {
  return `https://ai.${region}.corti.app/v1`;
}

/** Keycloak token endpoint for a tenant's realm. */
export function cortiTokenUrl(region: CortiRegion, tenant: string): string {
  return `https://auth.${region}.corti.app/realms/${tenant}/protocol/openid-connect/token`;
}

interface CachedToken {
  token: string;
  /** Epoch ms after which the token must not be reused. */
  expiresAt: number;
}

/**
 * Token cache, keyed by the credential it was minted for.
 *
 * Module scope, so it survives across invocations while an edge isolate stays
 * warm. Tokens live 300 seconds and a generation call can take a minute, so the
 * margin below is generous: a token is discarded well before it could expire
 * mid-stream, which would fail the request at an unrecoverable point.
 */
const tokenCache = new Map<string, CachedToken>();

/** Refresh this many ms before actual expiry. */
const EXPIRY_MARGIN_MS = 90_000;

/**
 * Exchanges client credentials for an access token, reusing a cached one while
 * it is comfortably fresh.
 */
export async function getAccessToken(config: CortiConfig): Promise<string> {
  const cacheKey = `${config.region}:${config.tenant}:${config.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "openid",
  });

  const response = await fetch(cortiTokenUrl(config.region, config.tenant), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.access_token) {
    // Keycloak names its failures properly, unlike the Models gateway, so pass
    // the name through — "invalid_client" tells you the id/secret/tenant triple
    // is wrong, which is a different fix from a 403 on the model itself.
    const reason = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`corti_auth_failed: ${reason}`);
  }

  const expiresInMs = (Number(payload.expires_in) || 300) * 1000;
  tokenCache.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(0, expiresInMs - EXPIRY_MARGIN_MS),
  });

  return payload.access_token;
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
  /** 0–1. Item writing wants some variety; the verifier wants 0. */
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

  const token = await getAccessToken(config);

  return fetch(`${cortiBaseUrl(config.region)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Tenant-Name": config.tenant,
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
    throw new Error(`corti_${response.status}: ${body.slice(0, 400) || "(empty body)"}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
