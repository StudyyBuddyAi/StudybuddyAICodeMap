#!/usr/bin/env bash
# Fails if a raw Tailwind palette class appears outside the allowlist.
#
# This is the enforcement, not the ESLint rule: a lint selector only sees string
# literals, so a class assembled at runtime slips past it. grep sees the source.
#
# Allowed: src/lib/categorical-colors.ts and src/lib/tag-colors.ts (identity
# palettes, documented in place) and src/components/ui/** (vendored shadcn).
set -euo pipefail

PATTERN='(text|bg|border|ring|from|to)-(red|emerald|amber|teal|green|slate|violet|rose|sky|purple|blue|orange|yellow)-[0-9]{3}'

if hits=$(grep -rEn "$PATTERN" src --include='*.tsx' --include='*.ts' \
  | grep -vE 'src/components/ui/|src/lib/categorical-colors\.ts|src/lib/tag-colors\.ts'); then
  echo "Raw palette colours found outside the allowlist:" >&2
  echo "$hits" >&2
  echo >&2
  echo "Use semantic tokens: text-success / text-warning / text-danger / text-info." >&2
  echo "Identity palettes belong in src/lib/categorical-colors.ts." >&2
  exit 1
fi

echo "colour check: clean"
