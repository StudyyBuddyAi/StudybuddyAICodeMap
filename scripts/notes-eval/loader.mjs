// Lets Node import src/lib modules as Vite would: "@/x" maps to src/x, and
// extensionless relative imports resolve to .ts. Used via
//   node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/run.ts
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const SRC = path.resolve(${JSON.stringify(process.cwd())}, "src");
export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  const isRelative = spec.startsWith(".") || spec.startsWith("file:");
  if (isRelative && !/\\.[cm]?[jt]sx?$/.test(spec)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidate = new URL(spec + ext, spec.startsWith("file:") ? undefined : context.parentURL);
      if (fs.existsSync(candidate)) return next(candidate.href, context);
    }
  }
  return next(spec, context);
}
// Vite defines import.meta.env; Node does not. Only src/ modules read it.
export async function load(url, context, next) {
  const result = await next(url, context);
  if (url.startsWith(pathToFileURL(SRC).href) && result.source) {
    const text = String(result.source);
    if (text.includes("import.meta.env")) {
      return { ...result, source: text.replaceAll("import.meta.env", "({ DEV: false })") };
    }
  }
  return result;
}
`),
  import.meta.url
);
