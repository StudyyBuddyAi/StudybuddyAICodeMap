// The shared edge-function modules (supabase/functions/_shared) read Deno.env,
// always inside a function and never at import. Unit tests import some of them
// — qbank-verify brings in corti.ts — which makes them part of this program,
// so the one Deno API they touch is typed here. App code runs in the browser
// and must never call it.
declare const Deno: { env: { get(key: string): string | undefined } };
