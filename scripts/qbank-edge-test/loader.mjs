// Maps the edge function's URL imports onto local stubs so the real handler
// runs in Node: deno std serve() captures the handler; supabase-js returns
// whatever fake client the test installed.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
const here = new URL(".", import.meta.url).href;
register(
  "data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("https://deno.land/std")) return { url: ${JSON.stringify(here)} + "stub-server.mjs", shortCircuit: true };
  if (spec.startsWith("https://esm.sh/@supabase/supabase-js")) return { url: ${JSON.stringify(here)} + "stub-supabase.mjs", shortCircuit: true };
  return next(spec, ctx);
}`),
  import.meta.url
);
