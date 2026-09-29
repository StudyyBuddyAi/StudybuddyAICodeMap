/**
 * Strip the markdown fence some models wrap around JSON output. Lives with the
 * edge functions (supabase/functions/_shared/sheet-text.ts), which read a
 * finished sheet the same way the page does.
 */
export { stripFences } from "../../supabase/functions/_shared/sheet-text.ts";
