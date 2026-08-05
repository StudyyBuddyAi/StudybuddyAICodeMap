/**
 * Fix the escaping mistakes models make when asked for raw JSON.
 *
 * The sheet prompt asks for one JSON object, and a single unescaped quote
 * inside a flashcard question is enough to make `JSON.parse` reject the whole
 * response. This rebuilds the text with valid escaping so the parse survives.
 * It does not parse or validate — it only makes the text parseable.
 *
 * Known limit: `"He said "yes", and left"` is genuinely ambiguous. The inner
 * quote is followed by a comma, so it reads as the end of the string and this
 * pass can't recover it. Callers should treat a still-failing parse as a real
 * failure rather than assume this fixed everything.
 */

/** Escapes JSON accepts after a backslash (excluding `u`, handled separately). */
const SIMPLE_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

/** Characters that can legally follow a closing quote in JSON. */
const CLOSERS = new Set([",", ":", "}", "]"]);

const CONTROL_ESCAPES: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

const isHex = (ch: string | undefined): boolean =>
  !!ch && /[0-9a-fA-F]/.test(ch);

/**
 * Decide whether a `"` inside a string closes it, or is content the model
 * forgot to escape. A real closing quote is followed only by whitespace and
 * then a structural character (or the end of the text).
 */
function closesString(text: string, quoteIndex: number): boolean {
  let i = quoteIndex + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i >= text.length || CLOSERS.has(text[i]);
}

/** Drop a trailing comma before `}`/`]`, which JSON rejects but models emit. */
function dropTrailingComma(out: string[]): void {
  let i = out.length - 1;
  while (i >= 0 && /^\s*$/.test(out[i])) i--;
  if (i >= 0 && out[i] === ",") out.splice(i, 1);
}

export function repairLlmJson(text: string): string {
  const out: string[] = [];
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
        out.push(ch);
      } else if (ch === "}" || ch === "]") {
        dropTrailingComma(out);
        out.push(ch);
      } else {
        out.push(ch);
      }
      continue;
    }

    // ── inside a string ────────────────────────────────────────────────────
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) {
        // Stream cut on the backslash itself — the escape never arrived.
        break;
      } else if (SIMPLE_ESCAPES.has(next)) {
        out.push(ch, next);
        i++;
      } else if (next === "u") {
        const hex = text.slice(i + 2, i + 6);
        if (hex.length === 4 && [...hex].every(isHex)) {
          out.push(ch, next, hex);
          i += 5;
        } else if (i + 6 > text.length) {
          // Runs past the end: cut mid-escape, so drop the fragment. A
          // malformed \u anywhere else is the model's, and stays as text.
          break;
        } else {
          out.push("\\\\", next);
          i++;
        }
      } else {
        // Not a JSON escape at all (e.g. `\x`), so the backslash is literal.
        out.push("\\\\", next);
        i++;
      }
      continue;
    }

    if (ch === '"') {
      if (closesString(text, i)) {
        inString = false;
        out.push(ch);
      } else {
        out.push('\\"');
      }
      continue;
    }

    const controlEscape = CONTROL_ESCAPES[ch];
    if (controlEscape) {
      out.push(controlEscape);
    } else if (ch < " ") {
      out.push(`\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
    } else {
      out.push(ch);
    }
  }

  return out.join("");
}
