import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // ── Accessibility ────────────────────────────────────────────────
      // Staged to match the ground each rule covers. Switching the whole
      // recommended set to "error" today would fail the build on 35 existing
      // violations across 11 files — most of them outside the Stage 3a scope —
      // and a red build nobody can fix just gets muted.
      ...jsxA11y.configs.recommended.rules,

      // Errors: these rules pass cleanly now, so they lock in the Stage 3a
      // fixes rather than describing an aspiration.
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/tabindex-no-positive": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/interactive-supports-focus": "error",

      // Warnings: real violations still outstanding. Flip each to "error" as
      // its files are cleaned — QBankSession (13) and OutputSection (6) are the
      // bulk, and both are already scheduled for later stages.
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "warn",
      "jsx-a11y/no-noninteractive-tabindex": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/heading-has-content": "warn",
      "jsx-a11y/anchor-has-content": "warn",

      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // Was "off", which is how seven unused components and eight unused icon
      // imports accumulated unnoticed. "warn" surfaces them without failing the
      // build while Stage 4's cleanup is still outstanding.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

      // ── Writing direction ────────────────────────────────────────────
      // The product markets itself across MENA but has no `dir`, no i18n and
      // no locale switch. Measured exposure is small — ~29 physical inline
      // properties and 74 physical Tailwind utilities — so the cheap move is to
      // stop adding more, not to rewrite what exists. New code uses logical
      // properties (ps-*/pe-*, ms-*/me-*, border-s/border-e, text-start/end).
      //
      // "warn", not "error": the existing 74 are legitimate until an RTL locale
      // actually ships, and failing the build on them today would just get the
      // rule switched off.
      // ── Colour ───────────────────────────────────────────────────────
      // Raw Tailwind palette classes bypass the semantic tokens in index.css,
      // which is how red/emerald/amber ended up hard-coded at a dozen different
      // alpha levels and the two themes drifted apart. Flipped to "error" in
      // Stage 4a once the last violation was migrated.
      //
      // Editor hint only — `npm run lint:colors` is the enforcement, because an
      // AST selector cannot see a class built at runtime. Identity palettes are
      // the deliberate exception and live in src/lib/categorical-colors.ts.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(text|bg|border|ring)-(red|emerald|amber|green|slate|violet|rose|sky|purple|orange|yellow)-[0-9]{3}/]",
          message:
            "Use semantic tokens (text-success / text-warning / text-danger / text-info). Identity palettes belong in src/lib/categorical-colors.ts.",
        },
        {
          // ── Writing direction ──────────────────────────────────────────
          // The product markets itself across MENA but has no `dir`, no i18n
          // and no locale switch. The 22 physical properties that existed were
          // converted in Stage 4b — small enough to fix outright, which is why
          // this can ship as "error" rather than an ignorable warning.
          selector:
            "Property[key.name=/^(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)$/]",
          message:
            "Use logical properties (marginInlineStart/End, paddingInlineStart/End, borderInlineStart/End) so an RTL locale works without a rewrite.",
        },
      ],

    },
  },
  {
    // The two deliberate identity palettes, and the shadcn primitives we do not
    // own. See the header note in categorical-colors.ts.
    files: [
      "src/lib/categorical-colors.ts",
      "src/lib/tag-colors.ts",
      "src/components/ui/**",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
);
