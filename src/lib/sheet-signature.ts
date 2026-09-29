/**
 * A sheet's signatures, as the page sends them back. The server signs each
 * section it writes (supabase/functions/_shared/sheet-signature.ts); a branch
 * or a rewrite sends the sheet together with its signatures, and the server
 * checks one against the other.
 */
import type { GeneratedSheet } from "@/types/generated-sheet";
import type { SheetLayer } from "./sheet-layer";
import { parseSignature, type SheetSignature } from "../../supabase/functions/_shared/sheet-signature.ts";

export { parseSignature, type SheetSignature };

/**
 * The signature for the sheet as the student has it: the sheet's own, with a
 * rewritten section's signature in place of the original's. A rewrite without
 * one (from before signing) leaves its key unsigned, and the request is then
 * held to the smaller unsigned allowance — which is right: the server can't
 * vouch for it. Null for a sheet from before signing.
 */
export function requestSignature(sheet: GeneratedSheet, layer: SheetLayer): SheetSignature | null {
  const own = sheet.signature;
  if (!own) return null;
  const sections = { ...own.sections };
  for (const [key, s] of Object.entries(layer.sections)) {
    if (s.kind !== "rewrite") continue;
    if (s.sig) sections[key] = s.sig;
    else delete sections[key];
  }
  return { v: own.v, topic: own.topic, sections };
}

/** The topic a follow-up request names: the one the sheet was signed under, else what the page calls it. */
export const requestTopic = (sheet: GeneratedSheet, fallback: string): string => (sheet.signature?.topic ?? fallback).slice(0, 120);
