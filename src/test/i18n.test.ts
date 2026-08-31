import { describe, expect, it } from "vitest";
import { t } from "@/config/i18n";
import { LIMITS, formatPrice } from "@/config/product";
import en from "@/config/en.json";

/**
 * Every price and quota the UI states now flows through `t()`. If interpolation
 * silently failed, the app would render raw `{{price}}` to users — so the
 * placeholder contract is worth pinning.
 */
describe("copy accessor", () => {
  it("substitutes values into placeholders", () => {
    expect(t("pricing.proBadge", { price: formatPrice() })).toBe("$5/mo");
  });

  it("returns the key for a missing lookup rather than an empty string", () => {
    // A visible key is a bug report; a blank space is a bug that ships.
    expect(t("nope.not.here")).toBe("nope.not.here");
  });

  it("leaves unknown placeholders intact instead of printing undefined", () => {
    expect(t("pricing.proBadge", { wrongName: 5 })).toBe("{{price}}/mo");
  });

  it("renders the free-plan line with no placeholders left over", () => {
    const line = t("free.planLine", {
      sheets: LIMITS.sheets.free,
      cards: LIMITS.cards.free,
      citations: LIMITS.citations.free,
      price: formatPrice(),
    });
    expect(line).not.toMatch(/\{\{/);
    expect(line).toContain("$5");
  });

  it("no longer claims the QBank needs no account", () => {
    // The old copy said "no account required to begin" while QBank hard-blocks
    // anonymous users. Guard the specific false claim, not the whole sentence.
    const claims = [t("pricing.freeBody"), t("free.planLine")].join(" ");
    expect(claims).not.toMatch(/no account/i);
  });

  it("keeps every string in the dictionary reachable through t()", () => {
    const walk = (node: unknown, path: string[] = []): string[] =>
      typeof node === "string"
        ? [path.join(".")]
        : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
            walk(v, [...path, k])
          );

    for (const key of walk(en)) {
      expect(t(key), `unreachable key: ${key}`).not.toBe(key);
    }
  });
});
