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
 * What is SKIPPED: JWT checks, retrieval/grounding, memory, quotas, the Corti →
 * Haiku fallback, and Supabase Storage (images are written to .local/, which
 * *.local in .gitignore already covers).
 *
 * Env (read server-side only — never exposed to the browser):
 *   OPENROUTER_API_KEY   needed for gpt-oss / haiku sheets and for every image
 *   CORTI_*              already in .env; enough for LOCAL_NOTES_WRITER=corti
 *   LOCAL_NOTES_WRITER   gpt-oss | haiku | corti  (default: gpt-oss with an
 *                        OpenRouter key, otherwise corti)
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

function pickWriter(env: Env): Writer | null {
  const requested = env.LOCAL_NOTES_WRITER as Writer | undefined;
  const hasOpenRouter = !!env.OPENROUTER_API_KEY;
  const hasCorti = !!env.CORTI_CLIENT_ID && !!env.CORTI_CLIENT_SECRET;
  if (requested === "corti") return hasCorti ? "corti" : null;
  if (requested === "gpt-oss" || requested === "haiku") return hasOpenRouter ? requested : null;
  return hasOpenRouter ? "gpt-oss" : hasCorti ? "corti" : null;
}

const tag = "\x1b[36m[local-fns]\x1b[0m";
const say = (msg: string) => console.log(`${tag} ${msg}`);

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

/** Pulls the visual out of the finished response, for the terminal summary only. */
function describeVisual(text: string): string {
  try {
    const start = text.indexOf("{");
    const parsed = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
    const v = parsed?.visual;
    if (!v || typeof v !== "object") return "visual: (missing)";
    if (v.kind === "flowchart") return `visual: flowchart, ${v.flowchart?.nodes?.length ?? 0} nodes → ${v.placement}`;
    if (v.kind === "chart") return `visual: ${v.chart?.chartType ?? "?"} chart, ${v.chart?.series?.length ?? 0} series → ${v.placement}`;
    if (v.kind === "image") return `visual: image "${v.imageSubject}" → ${v.placement}`;
    return `visual: ${v.kind}`;
  } catch {
    return "visual: (response was not plain JSON — the app's repair parser may still read it)";
  }
}

async function handleMedicalNotes(server: ViteDevServer, env: Env, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const writer = pickWriter(env);
  if (!writer) {
    say("medical-notes: no writer available — add OPENROUTER_API_KEY to .env.local (or set LOCAL_NOTES_WRITER=corti).");
    return sendJson(res, 500, { error: "Local functions: add OPENROUTER_API_KEY to .env.local, or set LOCAL_NOTES_WRITER=corti" });
  }

  const promptsTuned = await server.ssrLoadModule(`${SHARED}/medical-notes-prompts-corti.ts`);
  const promptsOriginal = await server.ssrLoadModule(`${SHARED}/medical-notes-prompts.ts`);
  const input = { ...body, groundingAttempted: false, ragChunks: [], hasMemory: false };
  // Same selection as medical-notes-handler.ts: tuned prompts for the primary
  // writers, the originals for the Haiku fallback.
  const { systemPrompt, userContent } =
    writer === "haiku"
      ? promptsOriginal.buildNotesPrompts({ ...input, family: "haiku" })
      : promptsTuned.buildCortiNotesPrompts({ ...input, family: writer === "corti" ? "haiku" : "gptOss" });
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const startedAt = Date.now();
  const mode = body.cardsOnly ? "cards" : body.explainMode ? "explain" : body.enhanceMode ? `enhance:${body.enhanceMode}` : "sheet";
  say(`medical-notes ${mode} · ${writer} · "${String(body.notes ?? "").slice(0, 60)}"`);

  let upstream: Response;
  let modelUsed: string;
  try {
    if (writer === "corti") {
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
      modelUsed = `corti/${WRITER_MODEL.corti}`;
      upstream = await corti.cortiChatCompletion(config, {
        model: WRITER_MODEL.corti,
        messages,
        stream: true,
        temperature: 0.3,
        maxTokens: 8192,
        signal: controller.signal,
      });
    } else {
      const model = WRITER_MODEL[writer];
      modelUsed = `openrouter/${model}`;
      // Mirrors openRouterStream in medical-notes-handler.ts.
      upstream = await fetch(OPENROUTER_CHAT_URL, {
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
          messages,
          provider: model.startsWith("openai/gpt-oss")
            ? { order: ["Cerebras", "Groq"], allow_fallbacks: true }
            : { order: ["Anthropic"], allow_fallbacks: true },
        }),
      });
    }
  } catch (err) {
    say(`medical-notes: upstream request failed — ${err instanceof Error ? err.message : String(err)}`);
    return sendJson(res, 500, { error: "AI service error (local)" });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    say(`medical-notes: upstream ${upstream.status} — ${text.slice(0, 300)}`);
    return sendJson(res, upstream.status === 429 ? 429 : 500, { error: `AI service error (local, ${upstream.status})` });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Model-Used", modelUsed);
  res.setHeader("X-Is-Premium", writer === "corti" ? "true" : "false");
  res.setHeader("X-Retrieved-Chunks", "0");
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
    if (!controller.signal.aborted) say(`medical-notes: stream error — ${err instanceof Error ? err.message : String(err)}`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
  say(`medical-notes ${mode} done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s${mode === "sheet" ? ` · ${describeVisual(assistantText)}` : ""}`);
}

async function handleSheetImage(server: ViteDevServer, env: Env, root: string, req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const gen = await server.ssrLoadModule(`${SHARED}/sheet-image-generate.ts`);
  const keys = await server.ssrLoadModule(`${SHARED}/sheet-image-key.ts`);

  const topic = gen.cleanField(body.topic, gen.TOPIC_MAX);
  const subject = gen.cleanField(body.subject, gen.SUBJECT_MAX);
  if (!topic || !subject) return sendJson(res, 400, { error: "invalid_request" });

  const cacheKey: string = await keys.sheetImageCacheKey(topic, subject);
  const dir = path.join(root, ".local", "sheet-visuals");
  const urlFor = (rel: string) => `${PREFIX}/sheet-visuals/${rel}`;

  for (const ext of ["png", "jpg", "webp"]) {
    const rel: string = keys.sheetImageStoragePath(cacheKey, ext);
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) {
      say(`image cache hit · "${subject}" (${topic})`);
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

  const prompt: string = gen.buildImagePrompt(topic, subject);
  const startedAt = Date.now();
  say(`image generating · "${subject}" (${topic}) · ${gen.SHEET_IMAGE_MODEL}`);
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
    fs.writeFileSync(`${file}.json`, JSON.stringify({ cacheKey, topic, subject, prompt, model: gen.SHEET_IMAGE_MODEL, via }, null, 2));

    say(`image done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s via ${via} endpoint · ${(bytes.length / 1024).toFixed(0)} KB · ${path.relative(root, file)}`);
    return sendJson(res, 200, {
      url: urlFor(rel),
      provider: `openrouter/${gen.SHEET_IMAGE_MODEL}`,
      generatedAt: new Date().toISOString(),
      cached: false,
    });
  } catch (err) {
    say(`image FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${err instanceof Error ? err.message : String(err)}`);
    return sendJson(res, 502, { error: "image_unavailable" });
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
      const writer = pickWriter(env);
      say(
        `enabled · sheets: ${writer ?? "NONE (add OPENROUTER_API_KEY or LOCAL_NOTES_WRITER=corti)"} · images: ${
          env.OPENROUTER_API_KEY ? "openrouter" : "DISABLED (no OPENROUTER_API_KEY)"
        }`
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
