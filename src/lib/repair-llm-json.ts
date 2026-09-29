/**
 * The escaping repair lives with the edge functions, which parse a finished
 * sheet the same way the page does (supabase/functions/_shared/sheet-text.ts).
 * This is the page's way in to it.
 */
export { repairLlmJson } from "../../supabase/functions/_shared/repair-llm-json.ts";
