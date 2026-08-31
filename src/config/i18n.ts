import en from "./en.json";

/**
 * Minimal copy accessor.
 *
 * Deliberately not a full i18n runtime — there is one locale today. The point
 * is the *key structure*: claim-bearing copy now lives in one file, so adding
 * Arabic later means adding `ar.json` and a locale switch, not reopening the
 * ten components that state a price or a quota.
 *
 * Values stay in `src/config/product.ts` and are interpolated in, so a
 * translator never edits a number and no surface hard-codes one.
 */

type Vars = Record<string, string | number>;

const DICTIONARIES = { en } as const;
type Locale = keyof typeof DICTIONARIES;

let locale: Locale = "en";

/** Reserved for the locale switch; the RTL work will call this. */
export const setLocale = (next: Locale) => {
  locale = next;
};

function lookup(key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      DICTIONARIES[locale]
    );
  return typeof value === "string" ? value : undefined;
}

/**
 * Resolve `key` and substitute `{{name}}` placeholders.
 *
 * A missing key returns the key itself rather than throwing or rendering empty:
 * a visible `pricing.proBadge` in the UI is a bug report, while a blank space is
 * a bug that ships.
 */
export function t(key: string, vars?: Vars): string {
  const template = lookup(key);
  if (template === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}
