/**
 * Local stand-ins for the medical-notes and generate-sheet-image edge functions,
 * served by the Vite dev server — for checking the sheet-visuals pipeline end
 * to end without Docker or a deploy.
 *
 * Enabled only by `VITE_LOCAL_FUNCTIONS=1` (in .env.local) under `vite serve`;
 * absent from builds entirely (`apply: "serve"`).
 *
 * What is REAL here, loaded straight from supabase/functions/_shared:
 *   - the sheet/cards/explain/enhance prompts, including the `visual` schema
 *   - the image prompt, the OpenRouter image call and response parsing
 *   - the image cache key
 * Writer routing mirrors medical-notes-handler.ts: Pro → Corti (unless they
 * chose "fastest"); free/anon → Corti for their first premium generations, then
 * GPT-OSS; enhance on the free tier → GPT-OSS; Corti unavailable → Haiku with
 * X-Model-Fallback. The profile is read with the caller's own session token,
 * the same read the client makes. consume_premium_hook is service-role only, so
 * premium generations are counted in memory for this server's lifetime instead
 * of in the database.
 *
 * What is SKIPPED: JWT verification, retrieval/grounding, memory, daily quotas,
 * and Supabase Storage (images are written to .local/, which *.local in
 * .gitignore already covers).
 *
 * Env (read server-side only — never exposed to the browser):
 *   OPENROUTER_API_KEY   needed for gpt-oss / haiku sheets and for every image
 *   CORTI_*              already in .env
 *   LOCAL_NOTES_WRITER   gpt-oss | haiku | corti — forces one writer for every
 *                        request; unset = production routing
 *
 * Per request, an `x-local-writer` header does the same for one call — used by
 * scripts/notes-eval/visual-stability.ts to compare writers without a restart.
 *
 * POST /__local-fns/sheet-visual runs the real planner (_shared/sheet-visual-plan.ts).
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";

const PREFIX = "/__local-fns";
const SHARED = "/supabase/functions/_shared";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

type Writer = "gpt-oss" | "haiku" | "corti";
type Env = Record<string, string>;

const WRITER_MODEL: Record<Writer, string> = {
  "gpt-oss": "openai/gpt-oss-20b",
  haiku: "anthropic/claude-haiku-4.5",
  corti: "corti-s1-instant",
};

// Same limits as medical-notes-handler.ts / use-premium-hook.ts.
const ANON_PREMIUM_LIMIT = 1;
const FREE_PREMIUM_LIMIT = 3;

/** Premium generations granted by this dev server, per user — stands in for consume_premium_hook. */
const localPremiumUsed = new Map<string, number>();

const hasCorti = (env: Env) => !!env.CORTI_CLIENT_ID && !!env.CORTI_CLIENT_SECRET;
const hasOpenRouter = (env: Env) => !!env.OPENROUTER_API_KEY;

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

interface RoutingProfile {
  is_pro?: boolean;
  pro_expires_at?: string | null;
  preferred_model?: string | null;
  premium_used?: number;
}

interface Route {
  writer: Writer;
  isPremium: boolean;
  reason: string;
}

/**
 * The production tier decision. The profile read goes through RLS with the
 * caller's token, so a token that isn't really theirs simply finds no row and
 * is routed as free.
 */
async function routeWriter(env: Env, req: IncomingMessage, body: Record<string, unknown>): Promise<Route | null> {
  const header = req.headers["x-local-writer"];
  const forced = ((typeof header === "string" ? header : "") || env.LOCAL_NOTES_WRITER) as Writer | undefined;
  if (forced === "corti" || forced === "gpt-oss" || forced === "haiku") {
    const available = forced === "corti" ? hasCorti(env) : hasOpenRouter(env);
    return available ? { writer: forced, isPremium: forced === "corti", reason: header ? "x-local-writer" : "LOCAL_NOTES_WRITER" } : null;
  }

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const claims = decodeJwtPayload(token);
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const isAnonymous = claims.is_anonymous === true;

  let profile: RoutingProfile | null = null;
  if (userId && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    try {
      const r = await fetch(
        `${env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=is_pro,pro_expires_at,preferred_model,premium_used`,
        { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }
      );
      if (r.ok) profile = ((await r.json()) as RoutingProfile[])[0] ?? null;
      else say(`profile read failed (${r.status}) — routing as free`);
    } catch (err) {
      say(`profile read failed — ${errorText(err)} — routing as free`);
    }
  }

  const isPro =
    profile?.is_pro === true &&
    (profile.pro_expires_at == null || new Date(profile.pro_expires_at) > new Date());

  let route: Route;
  if (isPro) {
    route =
      profile?.preferred_model === "gpt-oss"
        ? { writer: "gpt-oss", isPremium: false, reason: "Pro, chose fastest" }
        : { writer: "corti", isPremium: true, reason: "Pro" };
  } else if (body.enhanceMode) {
    route = { writer: "gpt-oss", isPremium: false, reason: "free tier, enhance" };
  } else {
    const limit = isAnonymous ? ANON_PREMIUM_LIMIT : FREE_PREMIUM_LIMIT;
    const used = (profile?.premium_used ?? 0) + (userId ? localPremiumUsed.get(userId) ?? 0 : 0);
    if (userId && used < limit) {
      localPremiumUsed.set(userId, (localPremiumUsed.get(userId) ?? 0) + 1);
      route = { writer: "corti", isPremium: true, reason: `${isAnonymous ? "anon" : "free"} premium ${used + 1}/${limit}` };
    } else {
      route = { writer: "gpt-oss", isPremium: false, reason: `${isAnonymous ? "anon" : "free"}, premium used ${used}/${limit}` };
    }
  }

  // A missing credential degrades like production would, rather than failing the request.
  if (route.writer === "corti" && !hasCorti(env)) return hasOpenRouter(env) ? { ...route, writer: "haiku", reason: `${route.reason}; no Corti creds` } : null;
  if (route.writer !== "corti" && !hasOpenRouter(env)) {
    return hasCorti(env) ? { writer: "corti", isPremium: true, reason: `${route.reason}; no OpenRouter key` } : null;
  }
  return route;
}

const tag = "\x1b[36m[local-fns]\x1b[0m";
const say = (msg: string) => console.log(`${tag} ${msg}`);

/** Node's fetch reports every network failure as "fetch failed"; the real reason is in `cause`. */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
  return cause ? `${err.message} (${cause.code ?? cause.message ?? "unknown cause"})` : err.message;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function handleMedicalNotes(server: ViteDevServer, env: Env, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const route = await routeWriter(env, req, body);
  if (!route) {
    say("medical-notes: no writer available — add OPENROUTER_API_KEY to .env.local, or Corti creds to .env.");
    return sendJson(res, 500, { error: "Local functions: no writer configured (OPENROUTER_API_KEY / CORTI_*)" });
  }

  const promptsTuned = await server.ssrLoadModule(`${SHARED}/medical-notes-prompts-corti.ts`);
  const promptsOriginal = await server.ssrLoadModule(`${SHARED}/medical-notes-prompts.ts`);
  const input = { ...body, groundingAttempted: false, ragChunks: [], hasMemory: false };
  // Same selection as medical-notes-handler.ts: tuned prompts for the primary
  // writers, the originals for the Haiku fallback.
  const messagesFor = (writer: Writer) => {
    const { systemPrompt, userContent } =
      writer === "haiku"
        ? promptsOriginal.buildNotesPrompts({ ...input, family: "haiku" })
        : promptsTuned.buildCortiNotesPrompts({ ...input, family: writer === "corti" ? "haiku" : "gptOss" });
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];
  };

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const startedAt = Date.now();
  const mode = body.cardsOnly ? "cards" : body.explainMode ? "explain" : body.enhanceMode ? `enhance:${body.enhanceMode}` : "sheet";
  say(`medical-notes ${mode} · ${route.writer} (${route.reason}) · "${String(body.notes ?? "").slice(0, 60)}"`);

  // Mirrors openRouterStream in medical-notes-handler.ts.
  const openRouter = (writer: "gpt-oss" | "haiku") => {
    const model = WRITER_MODEL[writer];
    return fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://studybuddy.app",
        "X-Title": "StudyBuddy (local)",
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.7,
        max_tokens: 8192,
        messages: messagesFor(writer),
        provider: model.startsWith("openai/gpt-oss")
          ? { order: ["Cerebras", "Groq"], allow_fallbacks: true }
          : { order: ["Anthropic"], allow_fallbacks: true },
      }),
    });
  };

  let upstream: Response | null = null;
  let modelUsed = "";
  let fallback = false;
  try {
    if (route.writer === "corti") {
      let failure: string | null = null;
      try {
        const corti = await server.ssrLoadModule(`${SHARED}/corti.ts`);
        // corti.ts reads credentials through Deno.env; shim it just for this synchronous read.
        const g = globalThis as { Deno?: unknown };
        const hadDeno = "Deno" in g;
        if (!hadDeno) g.Deno = { env: { get: (k: string) => env[k] } };
        let config;
        try {
          config = corti.cortiConfigFromEnv();
        } finally {
          if (!hadDeno) delete g.Deno;
        }
        const r: Response = await corti.cortiChatCompletion(config, {
          model: WRITER_MODEL.corti,
          messages: messagesFor("corti"),
          stream: true,
          temperature: 0.3,
          maxTokens: 8192,
          signal: controller.signal,
        });
        if (r.ok && r.body) {
          upstream = r;
          modelUsed = `corti/${WRITER_MODEL.corti}`;
        } else {
          failure = `corti_${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`;
        }
      } catch (err) {
        if (controller.signal.aborted) throw err;
        failure = errorText(err);
      }
      if (failure !== null) {
        if (!hasOpenRouter(env)) throw new Error(`Corti unavailable and no OpenRouter key — ${failure}`);
        say(`corti unavailable (${failure}) → falling back to Haiku, as production does`);
        fallback = true;
        modelUsed = `openrouter/${WRITER_MODEL.haiku}`;
        upstream = await openRouter("haiku");
      }
    } else {
      modelUsed = `openrouter/${WRITER_MODEL[route.writer]}`;
      upstream = await openRouter(route.writer);
    }
  } catch (err) {
    say(`medical-notes: upstream request failed — ${errorText(err)}`);
    return sendJson(res, 500, { error: "AI service error (local)" });
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    const text = upstream ? await upstream.text().catch(() => "") : "";
    say(`medical-notes: upstream ${upstream?.status} — ${text.slice(0, 300)}`);
    return sendJson(res, upstream?.status === 429 ? 429 : 500, { error: `AI service error (local, ${upstream?.status})` });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Model-Used", modelUsed);
  res.setHeader("X-Is-Premium", route.isPremium ? "true" : "false");
  res.setHeader("X-Retrieved-Chunks", "0");
  if (fallback) res.setHeader("X-Model-Fallback", "corti_unavailable");
  res.flushHeaders?.();

  // Re-framed exactly as the edge function does: only delta.content reaches the client.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const dataLine = event.trim().split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload || payload.includes("[DONE]")) continue;
        try {
          const text = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (typeof text !== "string" || !text) continue;
          assistantText += text;
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
        } catch {
          // unparseable chunk — skipped, as in production
        }
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) say(`medical-notes: stream error — ${errorText(err)}`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
  say(`medical-notes ${mode} done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${assistantText.length} chars`);
}

async function handleSheetImage(server: ViteDevServer, env: Env, root: string, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const gen = await server.ssrLoadModule(`${SHARED}/sheet-image-generate.ts`);
  const keys = await server.ssrLoadModule(`${SHARED}/sheet-image-key.ts`);

  const topic = gen.cleanField(body.topic, gen.TOPIC_MAX);
  const view = body.view;
  if (!topic || !keys.isImageView(view)) return sendJson(res, 400, { error: "invalid_request" });

  const cacheKey: string = await keys.sheetImageCacheKey(topic, view);
  const dir = path.join(root, ".local", "sheet-visuals");
  const urlFor = (rel: string) => `${PREFIX}/sheet-visuals/${rel}`;

  for (const ext of ["png", "jpg", "webp"]) {
    const rel: string = keys.sheetImageStoragePath(cacheKey, ext);
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) {
      say(`image cache hit · ${view} (${topic})`);
      return sendJson(res, 200, {
        url: urlFor(rel),
        provider: `openrouter/${gen.SHEET_IMAGE_MODEL}`,
        generatedAt: fs.statSync(file).mtime.toISOString(),
        cached: true,
      });
    }
  }

  if (!env.OPENROUTER_API_KEY) {
    say("generate-sheet-image: add OPENROUTER_API_KEY to .env.local to generate images.");
    return sendJson(res, 502, { error: "image_unavailable" });
  }

  const prompt: string = gen.buildImagePrompt(topic, view);
  const startedAt = Date.now();
  say(`image generating · ${view} (${topic}) · ${gen.SHEET_IMAGE_MODEL}`);
  try {
    const { bytes, via } = await gen.generateImage(env.OPENROUTER_API_KEY, prompt, (event: string, fields?: Record<string, unknown>) =>
      say(`image ${event} ${JSON.stringify(fields ?? {})}`)
    );
    if (bytes.length > gen.MAX_IMAGE_BYTES) throw new Error(`image_too_large_${bytes.length}`);
    const format = gen.sniffImageFormat(bytes);
    if (!format) throw new Error("unrecognized_image_format");

    const rel: string = keys.sheetImageStoragePath(cacheKey, format.extension);
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    // Stands in for the sheet_visual_images row.
    fs.writeFileSync(`${file}.json`, JSON.stringify({ cacheKey, topic, view, prompt, model: gen.SHEET_IMAGE_MODEL, via }, null, 2));

    say(`image done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s via ${via} endpoint · ${(bytes.length / 1024).toFixed(0)} KB · ${path.relative(root, file)}`);
    return sendJson(res, 200, {
      url: urlFor(rel),
      provider: `openrouter/${gen.SHEET_IMAGE_MODEL}`,
      generatedAt: new Date().toISOString(),
      cached: false,
    });
  } catch (err) {
    say(`image FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${errorText(err)}`);
    return sendJson(res, 502, { error: "image_unavailable" });
  }
}

async function handleSheetVisual(server: ViteDevServer, env: Env, req: IncomingMessage, res: ServerResponse) {
  const plan = await server.ssrLoadModule(`${SHARED}/sheet-visual-plan.ts`);
  const input = plan.cleanPlanInput(await readJson(req));
  if (!input) return sendJson(res, 400, { error: "invalid_request" });
  if (!hasOpenRouter(env)) {
    say("sheet-visual: add OPENROUTER_API_KEY to .env.local to plan visuals.");
    return sendJson(res, 502, { error: "planner_unavailable" });
  }
  const startedAt = Date.now();
  try {
    const result = plan.finalizeVisualPlan(await plan.requestVisualPlan(env.OPENROUTER_API_KEY, input), input);
    const kind = result.visual ? `${result.visual.kind} → ${result.visual.placement}` : "none";
    say(`sheet-visual "${input.topic}" · ${result.teachingPoint} → ${kind} (${result.reason}) · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return sendJson(res, 200, result);
  } catch (err) {
    say(`sheet-visual FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${errorText(err)}`);
    return sendJson(res, 502, { error: "planner_unavailable" });
  }
}

const CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

function serveImage(root: string, urlPath: string, res: ServerResponse) {
  const dir = path.join(root, ".local", "sheet-visuals");
  const file = path.resolve(dir, decodeURIComponent(urlPath));
  const type = CONTENT_TYPES[path.extname(file)];
  if (!file.startsWith(dir + path.sep) || !type || !fs.existsSync(file)) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(res);
}

export function localFunctions(): Plugin {
  let env: Env = {};
  return {
    name: "studybuddy-local-functions",
    apply: "serve",
    config(_config, { mode }) {
      env = loadEnv(mode, process.cwd(), "");
    },
    configureServer(server) {
      if (env.VITE_LOCAL_FUNCTIONS !== "1") return;
      const root = server.config.root;
      const forced = env.LOCAL_NOTES_WRITER;
      say(
        `enabled · sheets: ${forced ? `forced ${forced} (LOCAL_NOTES_WRITER)` : "production routing (Pro/premium → Corti, else GPT-OSS)"} · corti: ${
          hasCorti(env) ? "ok" : "no creds"
        } · openrouter: ${hasOpenRouter(env) ? "ok" : "no key (images disabled)"}`
      );

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(PREFIX)) return next();
        const pathname = url.split("?")[0].slice(PREFIX.length);
        // The dev server listens on every interface (host "::"); these routes
        // spend real API credit, so only this machine may call them.
        const remote = req.socket.remoteAddress ?? "";
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
          return sendJson(res, 403, { error: "local functions are loopback-only" });
        }
        try {
          if (req.method === "POST" && pathname === "/medical-notes") return await handleMedicalNotes(server, env, req, res);
          if (req.method === "POST" && pathname === "/sheet-visual") return await handleSheetVisual(server, env, req, res);
          if (req.method === "POST" && pathname === "/generate-sheet-image") return await handleSheetImage(server, env, root, req, res);
          if (req.method === "GET" && pathname.startsWith("/sheet-visuals/")) {
            return serveImage(root, pathname.slice("/sheet-visuals/".length), res);
          }
          sendJson(res, 404, { error: "not_found" });
        } catch (err) {
          say(`${pathname} crashed — ${err instanceof Error ? err.stack : String(err)}`);
          if (!res.headersSent) sendJson(res, 500, { error: "local function error" });
          else res.end();
        }
      });
    },
  };
}
