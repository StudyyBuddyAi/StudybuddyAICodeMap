/**
 * Stands in for `https://deno.land/std/http/server.ts` when an edge function is
 * loaded inside the dev server: instead of listening, serve() hands the
 * handler to vite-plugin.ts, which calls it for each local request.
 */
type Handler = (req: Request) => Response | Promise<Response>;

export function serve(handler: Handler): void {
  (globalThis as unknown as { __localServeHandler?: Handler }).__localServeHandler = handler;
}
