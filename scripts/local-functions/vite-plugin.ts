/**
 * The medical-notes edge function, run inside the Vite dev server — for
 * checking sheets end to end without Docker or a deploy.
 *
 * Enabled only by `VITE_LOCAL_FUNCTIONS=1` (in .env.local) under `vite serve`;
 * absent from builds entirely (`apply: "serve"`). The client switches to it in
 * src/lib/callMedicalNotes.ts under the same flag.
 *
 * This is the REAL handler (supabase/functions/_shared/medical-notes-handler.ts),
 * loaded through Vite's SSR loader: its prompts, plan, routing, streaming,
 * comprehensive depth phase and section requests are the code production
 * runs. Two of its imports are swapped, because they need what this machine
 * does not have:
 *
 *   - `https://esm.sh/@supabase/supabase-js` → fake-supabase.ts. There is no
 *     service-role key here. Tokens are read, not verified; quotas and the
 *     premium hook are counted in memory; memory and rag_logs are skipped.
 *   - `npm:@langchain/openai` → langchain-stub.ts. Retrieval fails open, so
 *     sheets are written ungrounded.
 *
 * `Deno.env` is shimmed from the loaded env: CORTI_* (.env) for the writers,
 * LOCAL_NOTES_WRITER=premium|standard to force a free user's tier. Writers
 * are called for real and spend real Corti credit.
 *
 * OPENROUTER_API_KEY is withheld from the shim even when .env.local has it, so
 * nothing run here can reach OpenRouter. The handler's one OpenRouter use is
 * the retrieval embedding, which is off here anyway.
 *
 * qbank-generate runs here too, but only under `npm run dev:qbank`
 * (scripts/local-functions/dev-qbank.mjs), and differently: its questions must
 * land in the real `questions` table, because the session finds them there
 * through claim_generated_questions. So it gets the REAL supabase-js and the
 * service-role key that launcher puts in this process's environment (never on
 * disk), and the deno std `serve` is swapped for deno-serve-stub.ts. Its
 * writer, probe and fact check spend real Corti credit; its rows and usage
 * counts are real.
 */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";

const PREFIX = "/__local-fns";
const HANDLER = "/supabase/functions/_shared/medical-notes-handler.ts";
const QBANK_HANDLER = "/supabase/functions/qbank-generate/index.ts";

const tag = "\x1b[36m[local-fns]\x1b[0m";
const say = (msg: string) => console.log(`${tag} ${msg}`);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Node's request as the Web Request the handler takes. */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  return new Request(`http://localhost${req.url ?? "/"}`, { method: req.method, headers, body });
}

/** The handler's Web Response, streamed back — and cancelled if the page leaves. */
async function sendResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return res.end();
  res.flushHeaders?.();
  const reader = response.body.getReader();
  let finished = false;
  res.on("close", () => {
    if (!finished) reader.cancel().catch(() => {});
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    finished = true;
    res.end();
  }
}

export function localFunctions(): Plugin {
  let env: Record<string, string> = {};
  let enabled = false;
  const root = process.cwd();
  // Root-relative, which Vite resolves from the project root on any OS.
  const swaps: [string, string][] = [
    ["https://esm.sh/@supabase/supabase-js@2.39.8", "/scripts/local-functions/fake-supabase.ts"],
    ["npm:@langchain/openai@0.3.0", "/scripts/local-functions/langchain-stub.ts"],
  ];
  const shared = path.join(root, "supabase", "functions", "_shared").replace(/\\/g, "/");
  const qbankEntry = path.join(root, "supabase", "functions", "qbank-generate", "index.ts").replace(/\\/g, "/");
  // The QBank function's own imports: the real client, and a serve() that
  // hands over its handler instead of listening.
  const qbankSwaps: [string, string][] = [
    ["https://esm.sh/@supabase/supabase-js@2.39.8", "@supabase/supabase-js"],
    ["https://deno.land/std@0.168.0/http/server.ts", "/scripts/local-functions/deno-serve-stub.ts"],
  ];
  let qbankEnabled = false;
  let serviceKey = "";

  return {
    name: "studybuddy-local-functions",
    apply: "serve",
    enforce: "pre",
    config(_config, { mode }) {
      env = loadEnv(mode, root, "");
      enabled = env.VITE_LOCAL_FUNCTIONS === "1" || process.env.VITE_LOCAL_FUNCTIONS === "1";
      serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
      qbankEnabled = process.env.VITE_LOCAL_QBANK === "1" && !!serviceKey;
    },
    // Rewritten in the source rather than resolved: Vite's SSR loader hands an
    // https: import straight to Node, which cannot load it, before any
    // resolveId hook is asked.
    transform(code, id) {
      const file = id.replace(/\\/g, "/");
      if (qbankEnabled && file === qbankEntry) {
        let out = code;
        for (const [from, to] of qbankSwaps) out = out.split(`"${from}"`).join(`"${to}"`);
        return out === code ? null : { code: out, map: null };
      }
      if (!enabled || !file.startsWith(shared)) return null;
      let out = code;
      for (const [from, to] of swaps) out = out.split(`"${from}"`).join(`"${to}"`);
      return out === code ? null : { code: out, map: null };
    },
    configureServer(server) {
      if (!enabled) return;

      // The handler and the modules it loads read their settings through Deno.env.
      const { OPENROUTER_API_KEY: _withheld, ...localEnv } = env;
      const denoEnv: Record<string, string | undefined> = {
        ...localEnv,
        SUPABASE_URL: env.VITE_SUPABASE_URL,
        // Real only under dev:qbank, where qbank-generate needs it; the
        // medical-notes handler talks to the fake client either way.
        SUPABASE_SERVICE_ROLE_KEY: serviceKey || "local-stand-in",
        SUPABASE_ANON_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };
      const g = globalThis as unknown as { Deno?: unknown };
      g.Deno ??= { env: { get: (k: string) => denoEnv[k] } };

      const hasCorti = !!env.CORTI_CLIENT_ID && !!env.CORTI_CLIENT_SECRET;
      say(
        `medical-notes runs locally (real handler) · writer: ${env.LOCAL_NOTES_WRITER || "production routing"} · corti: ${
          hasCorti ? "ok" : "no creds"
        } · openrouter: never (key withheld) · retrieval: off`
      );
      say(
        qbankEnabled
          ? "qbank-generate runs locally (real handler, real database, real Corti)"
          : "qbank-generate: deployed function (run `npm run dev:qbank` to run it locally)"
      );

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(PREFIX)) return next();
        // The dev server listens on every interface; these routes spend real
        // API credit, so only this machine may call them.
        const remote = req.socket.remoteAddress ?? "";
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: "local functions are loopback-only" }));
        }
        const pathname = url.split("?")[0].slice(PREFIX.length);
        if (pathname === "/qbank-generate" && qbankEnabled && (req.method === "POST" || req.method === "OPTIONS")) {
          const startedAt = Date.now();
          try {
            await server.ssrLoadModule(QBANK_HANDLER);
            const handler = (globalThis as unknown as { __localServeHandler?: (r: Request) => Promise<Response> })
              .__localServeHandler;
            if (!handler) throw new Error("qbank-generate did not register a handler");
            const response = await handler(await toRequest(req));
            await sendResponse(response, res);
            say(`qbank-generate ${response.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
          } catch (err) {
            say(`qbank-generate crashed — ${err instanceof Error ? err.stack : String(err)}`);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: "local function error" }));
            } else res.end();
          }
          return;
        }
        if (pathname !== "/medical-notes" || (req.method !== "POST" && req.method !== "OPTIONS")) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: "not_found" }));
        }
        const startedAt = Date.now();
        try {
          const mod = await server.ssrLoadModule(HANDLER);
          const response: Response = await mod.handleMedicalNotes(await toRequest(req));
          await sendResponse(response, res);
          say(`medical-notes ${response.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        } catch (err) {
          say(`medical-notes crashed — ${err instanceof Error ? err.stack : String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "local function error" }));
          } else res.end();
        }
      });
    },
  };
}
