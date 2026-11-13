import { MEMORIAL, memorialComplete } from "@/content/memorial";

/**
 * Whether the memorial shows: its page at /in-memory and its three ways in
 * (the footer line, the ribbon by the logo, the landing page's closing
 * dedication). Always on the dev server, so it can be seen while the words
 * and photos are being written; in production only once
 * src/content/memorial.ts is complete, so a placeholder can never ship.
 */
export const MEMORIAL_LIVE = import.meta.env.DEV || memorialComplete(MEMORIAL);
