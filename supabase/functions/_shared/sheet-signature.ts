/**
 * Proof that a sheet's sections are the ones this server wrote.
 *
 * A branch or a rewrite is written from the sheet the page sends. Trusted as
 * sent, that makes the premium writer free to anyone who sends a made-up
 * "sheet" — a Python tutorial, say — and asks it to go further. So each
 * section a writer finishes is signed here (an HMAC over the topic, the
 * section's key and its body, as sheet-text.ts reads them), the page keeps the
 * signatures with the sheet, and a follow-up is checked against them.
 *
 * A request that doesn't check out is not refused — sheets saved before
 * signing, or damaged ones the server couldn't read, still grow — but it is
 * held to a much smaller daily allowance than a signed one.
 *
 * Web Crypto only, so Deno and the page's tests both run it.
 */
import type { SheetSectionBody } from "./sheet-text.ts";

export const SIGNATURE_VERSION = 1;

/** The signatures a sheet carries: the topic they were made for, and one per section. */
export interface SheetSignature {
  v: typeof SIGNATURE_VERSION;
  topic: string;
  sections: Record<string, string>;
}

const MAX_SECTIONS = 20;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, unpadded

/**
 * The sections a request sends, exactly as sent — the plan's keys only, and
 * only values shaped like a section. Nothing is trimmed or capped here: what
 * is checked must be byte for byte what was signed. (The prompts get their
 * own tidied copy.)
 */
export function sentSections(raw: unknown, keys: readonly string[]): Record<string, SheetSectionBody> {
  const out: Record<string, SheetSectionBody> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" || isStrings(v) || (Array.isArray(v) && v.length > 0 && v.every(isStrings))) {
      out[k] = v as SheetSectionBody;
    }
  }
  return out;
}

/** The topic as it is signed and sent: one line, at most 120 characters. */
export const signatureTopic = (topic: string): string => topic.replace(/\s+/g, " ").trim().slice(0, 120);

const encoder = new TextEncoder();

const keyFor = (secret: string) =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

const message = (topic: string, key: string, body: SheetSectionBody) =>
  encoder.encode(`v${SIGNATURE_VERSION}\n${topic}\n${key}\n${JSON.stringify(body)}`);

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Signs each section under the topic. */
export async function signSections(
  secret: string,
  topic: string,
  sections: Record<string, SheetSectionBody>
): Promise<SheetSignature> {
  const key = await keyFor(secret);
  const t = signatureTopic(topic);
  const out: Record<string, string> = {};
  for (const [k, body] of Object.entries(sections).slice(0, MAX_SECTIONS)) {
    out[k] = toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, message(t, k, body))));
  }
  return { v: SIGNATURE_VERSION, topic: t, sections: out };
}

/** A signature as it may arrive, its shape checked; null when it is not one. */
export function parseSignature(raw: unknown): SheetSignature | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== SIGNATURE_VERSION || typeof r.topic !== "string" || !r.sections || typeof r.sections !== "object") return null;
  const sections: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.sections as Record<string, unknown>).slice(0, MAX_SECTIONS)) {
    if (typeof v === "string" && SIG_RE.test(v)) sections[k] = v;
  }
  return { v: SIGNATURE_VERSION, topic: signatureTopic(r.topic), sections };
}

/**
 * Whether every one of `sections` was written by this server for `topic`:
 * each has a signature, and each signature checks. Constant-time per section
 * (Web Crypto's verify).
 */
export async function verifySections(
  secret: string,
  signature: SheetSignature | null,
  topic: string,
  sections: Record<string, SheetSectionBody>
): Promise<boolean> {
  if (!signature) return false;
  const t = signatureTopic(topic);
  if (signature.topic !== t) return false;
  const entries = Object.entries(sections);
  if (!entries.length) return false;
  const key = await keyFor(secret);
  for (const [k, body] of entries) {
    const sig = signature.sections[k];
    if (!sig) return false;
    const ok = await crypto.subtle.verify("HMAC", key, fromBase64Url(sig), message(t, k, body));
    if (!ok) return false;
  }
  return true;
}
