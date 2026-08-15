# StudyBuddy AI — Full Codebase Audit

**Scope:** every source file, migration, edge function, config, and doc in the repo (195 tracked files).
**Method:** file-by-file inspection, full migration reads, `npm run build` / `npm run lint` / `npm test` executed, git history checked for secrets, greps for risky patterns.
**Date:** 2026-08-08 · **Auditor:** opencode

---

## 1. Executive Summary

StudyBuddy AI is a single-developer, anonymous-first medical study app: React 18 + Vite + TS (non-strict) + Tailwind/shadcn on the front, Supabase (Postgres RLS + Deno edge functions) on the back, models served through OpenRouter (GPT-OSS 20B default, Claude Haiku 4.5 for Pro). The architecture is genuinely strong in places — **server-side QBank sampling/grading**, **atomic SECURITY DEFINER quota RPCs**, **additive-only migrations with a repair-migration convention**, and an **SSE streaming generator** — but it ships with **gaping entitlement problems** that a paying-tier business model cannot ignore, **no tests**, **a failing lint**, **no CI**, and **a 933 kB single JS bundle**.

The single most damaging finding: **Pro status is trivially bypassable** (Section 24, finding #1). The second: **edge functions trust client-supplied `isPro`/`userId`/`preferredModel` from the request body with no JWT verification**, so anyone can route free generations through paid Claude Haiku and even burn other users' daily quotas. Everything else is fixable with moderate effort; these two are existential for the monetization path.

**Overall score: 5/10** — solid solo-dev foundation, real production-feature ambition, but security-of-entitlements, testing, and tooling discipline trail the feature set.

---

## 2. Methodology & Evidence

- **Read** every file in `src/`, `supabase/functions/`, `supabase/migrations/`, root configs, and docs (README, ONBOARDING, CONTEXT).
- **Executed:** `npm run build` (passes, chunk-size warning), `npm run lint` (**fails**: 9 errors, 20 warnings), `npm test` (1 placeholder test passes).
- **Verified git state:** `.env` is untracked and gitignored (never committed); uncommitted diff is a cosmetic comment change in `medical-notes/index.ts`.
- **Scans:** `console.*` usage, `TODO/FIXME`, `catch (e: any)`, `: any` annotations, `dangerouslySetInnerHTML`, spaced-repetition references, RAG-spike reachability.
- **Not measured:** live Supabase DB contents (no credentials path needed); NCBI/OpenRouter latency.

---

## 3. Technology Stack & Dependency Inventory

| Layer | Technology | Version |
|---|---|---|
| UI runtime | React (SPA) | 18.3.1 |
| Bundler / dev server | Vite + `@vitejs/plugin-react-swc` | 5.4.x / 3.11 |
| Language | TypeScript (non-strict — see §24.10) | 5.8.3 |
| Styling | Tailwind CSS + `tailwindcss-animate` + `@tailwindcss/typography` | 3.4.17 |
| Component kit | shadcn/ui (Radix primitives, baseColor `slate`) | ~44 Radix packages |
| Data / cache | `@supabase/supabase-js` + TanStack Query | 2.101 / 5.83 |
| Router | react-router-dom | 6.30.1 |
| Forms / validation | react-hook-form + zod + @hookform/resolvers | 7.61 / 3.25 |
| Charts | recharts (biggest vendor chunk) | 2.15.4 |
| Charts/primitives extras | lucide-react, sonner, vaul, cmdk, date-fns, embla-carousel, next-themes, react-day-picker, input-otp, react-resizable-panels | — |
| Analytics | `@vercel/analytics` | 2.0.1 |
| Backend | Supabase Postgres + Deno edge functions + OpenRouter + NCBI E-utilities | CLI 2.109 |
| Test/dev tooling | vitest, @testing-library, @playwright/test, eslint 9 + typescript-eslint | 3.2 / 1.57 |

Dependency hygiene is reasonable: no abandoned packages, versions current-ish. `recharts` (+ transitive d3) is the largest single cost in the bundle (see §25).

---

## 4. Repository Layout & Codebase Health

```
src/
  pages/        12 route pages (Dashboard, Sheets, Flashcards, QBank*, Library, Roadmap, …)
  components/   25 app components + ui/ (47 shadcn primitives)
  hooks/        14 hooks (use-auth, use-flashcard-deck, use-qbank, use-persona, …)
  lib/          8 libs (callMedicalNotes, citation*, parse-flashcards, spacedRepetition-not-present, …)
  contexts/     QBankContext (real impl), SidebarContext
  integrations/ supabase client (auto-generated) + generated types
supabase/
  functions/    medical-notes (672 L), get-citations (269 L)
  migrations/   16 SQL migrations (additive-only convention)
scripts/rag-spike/  isolated pgvector experiment (own package.json — NOT wired in)
```

Health notes:
- **No `typecheck` script** in `package.json`. `build` (vite) type-checks nothing (SWC esbuild-style transform).
- ESLint runs over `supabase/functions/**` and `tailwind.config.ts` too (mixed concerns; edge fns are Deno, config is CJS) — **9 errors, 20 warnings** (§26).
- 1 TODO in app code (SheetGenerator.tsx:227, intentional Phase-1 marker). 7 `console.error` sites (error paths only). 4 `catch (e: any)`.
- `CLAUDE.md` is in `.gitignore` — the working rules file is local-only, not versioned. CONTEXT.md is committed.

---

## 5. Build, Lint & Test Status (measured)

| Command | Result |
|---|---|
| `npm run build` | ✅ Passes — 933.48 kB JS (gzip 266.16 kB) + 118.43 kB CSS (gzip 20.77 kB). **Vite warning: chunk > 500 kB.** 1828 modules, 18.3 s |
| `npm run lint` | ❌ **9 errors / 20 warnings** — see §26 for the full list |
| `npm test` | ⚠️ 1 test file, 1 trivial test (`expect(true).toBe(true)`), passes. **Effective coverage ≈ 0%** |
| `tsc` | ⚠️ No script exists; strictness disabled anyway (`tsconfig.app.json`) |

---

## 6. Frontend Architecture

- **No state library** — TanStack Query for server state, React Context for QBank session + sidebar, component-local state elsewhere. Appropriate for this size.
- **Two UI shells coexist**: the current `DashboardLayout.tsx` (AppNav + AuthModal + AccountDashboard, wide=1280px / default 860px) and a **legacy collapsible `DashboardSidebar.tsx`** that is dead-weight duplicate navigation.
- **`OutputSection.tsx` (1733 lines)** is the largest component — renders sheets and flashcards, owns enhance (`expand`/`clinical`), saved-highlight anchor logic, and shared nudge/disclaimer. Single-responsibility boundaries are blurry but it works and is internally consistent.
- **Legacy duplication:** `hooks/use-qbank.ts` is dead code whose *types* are still imported by the live `QBankContext.tsx` (documented in CONTEXT.md). `src/components/NavLink.tsx` vs shadcn `nav-link` conventions. Two `timeAgo` implementations (`Library.tsx` local, `lib/utils.ts`).
- **Persona IS on main** — `hooks/use-persona.ts` (`sb_persona_v1`, `student|clinician|expert`) is consumed by `SheetGenerator.tsx:501` to adjust generation persona. This contradicts CONTEXT.md ("Persona — NOT on main. Treat as aspirational") — see §29.
- Good patterns: `Dashboard.tsx` guards animation with `prefers-reduced-motion`; `StatsStrip` respects it; `GradientBackground`/`PageLoader` are clean presentational components.

---

## 7. Routing & Provider Tree

`App.tsx`: `QueryClientProvider → TooltipProvider → SidebarProvider → BrowserRouter`.

- `/` → `Index` (redirects returning users to `/dashboard` via `APP_STORAGE_KEYS`)
- `/dashboard`, `/sheets`, `/flashcards`, `/library`, `/roadmap`, `/reset-password`, `*` → `NotFound`
- `/qbank`, `/qbank/session`, `/qbank/summary` share **one `QBankProvider`** via a parent `<Outlet/>` so session state survives navigation — correctly scoped, no other route gets it.
- `vercel.json` rewrites all paths to `/index.html` (SPA). No security headers/CSP configured (see §24.14).

---

## 8. Authentication & Session Model

Anonymous-first (`use-auth.ts`):
- New visitor → `signInAnonymously()`; **anon users hold real Supabase ids + JWTs with the `authenticated` role** (this is why QBank RPC grants to `authenticated` cover them, and why `consume_usage` needs an explicit `p_user`).
- **Sign-up on anon** = `updateUser({email,password})` keeping the id, then `migrateLocalCardsToServer` + `migrateLocalStudyHistoryToServer`.
- **Sign-in** reconciles today's `usage_records` from the anon id (merge max count per kind).
- `supabase` client (`client.ts`): anon/publishable key, localStorage session persistence, auto-refresh. The **publishable key is a browser key by design** — not a secret, but it must be paired with strict RLS.
- Migrations set up `handle_new_user` (trigger, SECURITY DEFINER) and `handle_user_email_update` (anon→email upgrade sync).

---

## 9. Data Model (Tables)

**Created via migrations (11):**

| Table | Purpose / key columns | Notes |
|---|---|---|
| `profiles` | id, email (nullable), is_pro, pro_expires_at, pro_source, **premium_used**, **preferred_model** | + 5 vestigial Stripe cols (unused); `preferred_model` CHECK is stale (§15) |
| `decks` | topic, topic_emoji · `UNIQUE(user_id,topic)` | — |
| `cards` | question, answer, tag, topic, deck_id, **client_id** · `UNIQUE(user_id,client_id)` | SM-2-lite: interval_days, due_at, last_reviewed_at, review_count |
| `usage_records` | kind (`sheet|cards`), usage_date, count · `UNIQUE(user_id,kind,usage_date)` | write access removed from client (§12) |
| `pro_codes` | code PK, duration_days, redeemed_by, redeemed_at | **40 seed codes committed in migration** (§24.1) |
| `study_history` | topic, input, output, exam_mode, difficulty, focus, length, curriculum_topic_id | — |
| `review_sessions` | card_id, rating (`again|hard|good|easy`), reviewed_at | feeds streak/retention |
| `citation_usage` | usage_date, count · `UNIQUE(user_id,usage_date)` | client-written (§24.3) |
| `flagged_questions` | question_id, session_id · `UNIQUE(user_id,session_id,question_id)` | widened constraint after drift incident |
| `curriculum_topics` | parent_id self-ref, system, title, level, yield_tier, sort_order, generator_prompt, is_active | seeded: Cardiovascular + 18 topics |
| `guideline_chunks` | pgvector(768), chunk_index, content, metadata | **RAG spike only — not in app path** |

**Created in Supabase dashboard only (5) — no CREATE/RLS in repo:** `questions`, `media`, `question_media`, `qbank_sessions`, `user_attempts`. Their live posture is unverifiable from source (§24.6).

---

## 10. Migrations Inventory (16, additive-only)

| Migration | Content |
|---|---|
| `20260505154708` | profiles, decks, cards, usage_records, pro_codes (+40 seed codes), handle_new_user trigger, **all core RLS**, redeem_pro_code |
| `20260505154719` | REVOKE handle_new_user; GRANT redeem_pro_code to authenticated |
| `20260508000000` | Stripe columns (vestigial); redeem_pro_code v2 blocks anon (`account_required`) |
| `20260508120000` | email nullable; handle_user_email_update trigger |
| `20260508130000` | study_history + RLS |
| `20260509100000` | review_sessions + RLS |
| `20260511000000` | pgvector `guideline_chunks` + `match_guideline_chunks` (spike) |
| `20260513000000` | citation_usage + RLS |
| `20260516000000` | premium_used; preferred_model **DEFAULT 'flash' CHECK IN ('flash','gpt-oss') — stale vs code** |
| `20260604000000` | flagged_questions + RLS (2-col unique) |
| `20260605000000` | + session_id; widen unique (3-col) |
| `20260708000000` | **server quota**: consume_usage/refund_usage (SECURITY DEFINER, service_role-only), drop client insert/update on usage_records |
| `20260708120000` | **QBank server grading**: start/submit/end/get_session_review RPCs; answer-key column REVOKE |
| `20260708130000` | **access fix**: table-level REVOKE then safe-column GRANT on questions; REVOKE INSERT on user_attempts |
| `20260708140000` | flagged_questions.session_id **repair** (idempotent, guard-on-pg_constraint) |
| `20260709000000` | curriculum_topics + public-read policy + Cardiovascular seed |

The discipline is good: every migration is additive, idempotent-ish, and documented with intent. The `20260708140000` repair migration is exactly the right response to schema drift (documents root cause, re-applies idempotently, stays additive).

---

## 11. Row-Level Security Posture

| Table | SELECT | INSERT | UPDATE | DELETE | Source |
|---|---|---|---|---|---|
| `profiles` | own | — (trigger) | own | — | ✅ migration |
| `decks` | own | own | own | own | ✅ |
| `cards` | own | own | own | own | ✅ |
| `usage_records` | own | ❌ revoked | ❌ revoked | — | ✅ |
| `pro_codes` | **any authenticated** | — | — | — | ✅ — **see §24.1** |
| `study_history` | own | own | — | own | ✅ |
| `review_sessions` | own | own | — | — | ✅ |
| `citation_usage` | own | own | own | — | ✅ (client-written) |
| `flagged_questions` | own | own | — | own | ✅ |
| `curriculum_topics` | public (`is_active`) | — | — | — | ✅ |
| `guideline_chunks` | public | — (service_role) | — | — | ✅ (spike) |
| `questions` | **safe columns only** (answer key revoked) | — | — | — | ✅ via 13000 fix |
| `media` / `question_media` | live-DB grant (anon) | — | — | — | ⚠️ inferred |
| `qbank_sessions` / `user_attempts` | own (live-DB) | **INSERT revoked on user_attempts** | — | — | ⚠️ partially in repo |

**Assessment:** the hand-rolled RLS is correct and minimal for the migration-managed tables. The QBank tables' posture depends on live-DB grants that the repo cannot reproduce from scratch — the proven consequence was the `flagged_questions.session_id` 42703 incident (documented in the repair migration).

---

## 12. Database Functions (RPCs) & Triggers

| Function | SECURITY | Callable by | Purpose |
|---|---|---|---|
| `handle_new_user` (trigger) | DEFINER | — (revoked) | auto-create profile |
| `handle_user_email_update` (trigger) | DEFINER | — | sync email on upgrade |
| `redeem_pro_code(text)` | DEFINER | authenticated (anon blocked) | redeem code → is_pro |
| `consume_usage(uuid,text,int)` | DEFINER | **service_role only** | atomic daily cap increment |
| `refund_usage(uuid,text)` | DEFINER | **service_role only** | refund failed generation |
| `start_qbank_session(text[],int,text,uuid[])` | DEFINER | authenticated | server sample + create session, no answer key |
| `submit_answer(uuid,uuid,text,int)` | DEFINER | authenticated | server-grade + record attempt (anti-oracle guards) |
| `end_qbank_session(uuid)` | DEFINER | authenticated | recompute score from attempts |
| `get_session_review(uuid)` | DEFINER | authenticated | owner-only full review incl. answer fields |
| `match_guideline_chunks(...)` | invoker | public | spike-only similarity search |

**Strengths:** `consume_usage` is genuinely atomic (single upsert with `DO UPDATE ... WHERE count < p_cap`, row-lock serialization, refund floors at 0); `submit_answer` blocks lookups (already-answered check) and enforces ownership/activity/membership; all QBank RPCs verify `auth.uid()` ownership.
**Weakness:** `redeem_pro_code` reads codes that are themselves world-readable to authenticated users (§24.1).

---

## 13. Edge Function: `medical-notes` (the AI generator)

`supabase/functions/medical-notes/index.ts` (672 lines).

- **Modes** (request-body gated): default sheet, `cardsOnly`+`cardCount` (flashcards), `explainMode`+`focusCard` (explain), `enhanceMode` (`expand`/`clinical`) + `itemText`/`sectionKey`.
- **Two prompt families**: `gptOss*Prompt` (default) / `haiku*Prompt`.
- **Model routing** (§15) and **quota** via `consume_usage`/`refund_usage` (service-role client; 429 `quota_exceeded` on cap; refund on failure).
- **Premium hook**: anon=1, free=3 lifetime generations routed to Haiku; `profiles.premium_used` read+incremented server-side.
- **OpenRouter**: SSE streaming, `temperature 0.7`, `max_tokens 8192`, `HTTP-Referer studybuddy.app`.
- **Response headers** `x-model-used`, `x-is-premium`; client detects model by substring (e.g. `claude`).
- **Critical flaw**: `isPro`, `isAnonymous`, `preferredModel`, `userId` are read **from the request body, not verified from the JWT** (§24.2). CORS `*`.

---

## 14. Edge Function: `get-citations` (PubMed)

`supabase/functions/get-citations/index.ts` (269 lines).

- **Specialty detection**: `SPECIALTY_MAP` maps keyword fragments → `SpecialtyProfile {journalFilters[], societyLabel}` for 7 specialties — cardiology (Circulation / JACC → "AHA/ACC"), OBGYN (Obstet Gynecol → "ACOG"), nephrology (Kidney Int → "KDIGO"), endocrinology (Diabetes Care / JCEM → "ADA/Endocrine Society"), infectious disease (Clin Infect Dis / JID → "IDSA"), pulmonology (ERJ / AJRCCM → "GOLD/ERS"), pediatrics (Pediatrics / Arch Dis Child → "AAP").
- **Query build**: strips "according to …"/"management of ", strips punctuation, ≤120 chars; journal-filtered `esearch` with an unfiltered fallback.
- **Relevance**: `esummary` per PMID, stopword-filtered title substring match; label = society or "PubMed"; title truncated to 80 chars; **returns at most 1 citation** (`tier 1`).
- **Flaws**: unauthenticated invocation + CORS `*` + no rate limiting (NCBI cost abuse surface); up to ~12 serial external HTTP calls per request worst case (2 searches + 10 summaries); empty `NCBI_API_KEY` silently downgrades rate limits; no server-side caching (client caches in localStorage).

---

## 15. AI Model Routing & Premium Entitlements

| User | Model |
|---|---|
| Pro + `claude` | `anthropic/claude-haiku-4.5` |
| Pro + `gpt-oss` (client default) | `openai/gpt-oss-20b` |
| Free/anon within premium hook | Haiku (counter `premium_used`: anon 1 / free 3) |
| Free/anon beyond hook | `openai/gpt-oss-20b` |

**Stale naming (confirmed):** DB CHECK allows `('flash','gpt-oss')` with DEFAULT `'flash'` (migration comment even says "Gemini 2.5 Flash"); client union is `'claude'|'gpt-oss'` default `'gpt-oss'`; edge fn branches on `preferredModel === "claude"`. The live DB constraint must have been altered out-of-band — the repo's migration no longer matches reality.

---

## 16. Quota & Usage Enforcement

- **Sheets + cards**: free/anon **5/day each** (`MAX_DAILY_*` in `use-usage-limit`); enforced server-side in `medical-notes` via `consume_usage` (atomic) + `refund_usage` (failure-safe). The client only *displays* counts. **This is done right.**
- **QBank**: not quota-tracked (undocumented decision).
- **Citations**: anon 1/day (localStorage `sb_anon_citation`), free 3/day (`citation_usage` table), Pro unlimited — **entirely client-enforced** (§24.3).
- **QBank sessions**: persisted mid-flight to localStorage `sb_qbank_session` (24 h TTL), restored by `restoreSession()`.

---

## 17. QBank Subsystem

Flow: `QBank.tsx` (landing, marketing + count/domain meta queries) → `QBankSession.tsx` (runner) → `QBankSummary.tsx` (review), all under one `QBankProvider`.

**Server-side core (migrated 2026-07-08):**
- `start_qbank_session` samples `questions` server-side (`random()`, active-only, system/domain filters, cap 40), creates the session row up front, returns **sanitized stems** (options but no answer key).
- `submit_answer` grades server-side, enforces session-ownership, active status, question-in-session, and **no double-answer** (anti-oracle). Returns explanation/teaching_point only for the answered question.
- `end_qbank_session` recomputes score from `user_attempts` (idempotent-ish).
- `get_session_review` is owner-only and returns full question data incl. answer fields for the deep-link summary.
- **Access fix** (13000): table-level `REVOKE SELECT` on `questions` then re-`GRANT` only safe columns (the earlier column-level REVOKE in 12000 was a documented **no-op** — Postgres column privileges don't subtract from table-level grants — caught during verification). Direct `INSERT` on `user_attempts` revoked to stop forged `is_correct=true`.

**Remaining gaps:**
- `media` / `question_media` / `questions`-remaining / `qbank_sessions` RLS still not in repo (§24.6).
- Flags are held in `SessionState.flaggedIds` (localStorage) and written to `flagged_questions` on `endSession` — client-supplied but non-authoritative.
- `dangerouslySetInnerHTML` markdown rendering of answers/explanations (§24.5).

**Historical (pre-fix) state for the record:** the answer key shipped to the browser and `is_correct`/`score` were client-computed. **Both are now fixed server-side.**

---

## 18. Flashcards & Spaced Repetition

- **Algorithm**: `PROGRESSION = [1, 3, 7, 21, 60]` days (`use-flashcard-deck.ts`). This is a **fixed interval ladder, not SM-2** — README's "SM-2 spaced repetition" claim is overstated (§29).
- **Persistence**: server `decks`/`cards` (djb2-derived `client_id` for dedupe via `UNIQUE(user_id,client_id)`); anon fallback localStorage `studybuddy_decks_v1` + custom event `studybuddy:deck-changed`; migrated to server on signup.
- **Reviews**: `review_sessions` rows per rating (`again|hard|good|easy`) feed streak/retention stats; `due_at`/`interval_days` updated in `use-flashcard-deck`.
- **Parsing**: `parse-flashcards.ts` line-start `Q:`/`A:` regex, stops at `REFERENCE NOTE`, emoji extraction, 60-char topic truncation.

---

## 19. Study Sheets & Study History

- Persisted per generation in `study_history` (`topic`, `input`, `output` JSON, `exam_mode/difficulty/focus/length`); typed by `generated-sheet.ts`; anon fallback localStorage `studybuddy_history` migrated on signup.
- `OutputSection.tsx` renders both sheet and flashcard outputs; supports enhance (`expand`/`clinical`) via `medical-notes`, saved-highlight anchors (`sectionKey:lineIdx` / `:end` / `saved`), and shared nudge/disclaimer copy.
- `use-sheets-stats` computes week stats UTC Monday→Sunday against `usage_records` kind `sheet`.

---

## 20. Citations Feature

- `lib/citation.ts` → `fetchBestCitation(topic)` → invokes `get-citations` edge fn. Returns `CitationResult { label, title, url, tier }`; **label comment in code lists "ADA" but the function returns "ADA/Endocrine Society"** (cosmetic drift).
- `lib/citation-store.ts`: localStorage `studybuddy_citations_by_topic`, topic normalized (trim/lowercase), legacy object→array migration.
- UI: `CitationBadgeList` (states loading/found/locked/hidden; lock copy "Upgrade to Pro to cite sources" / "Sign in to access cited generations"), `CitationCTABanner` ("get 1 cited generation today, no account needed").
- **Gate is client-side**: anon 1/day localStorage counter; free uses `citation_usage` upserted by the client; Pro unlimited. A 3-line client change unlocks citations for everyone (§24.3).

---

## 21. Roadmap / Curriculum Feature

- `curriculum_topics` seeded with **Cardiovascular (level 0) + 18 level-1 topics** (foundation→risk→ischemic→HF→valvular→arrhythmia→emergency study order), `yield_tier` default `high`, `generator_prompt` column present but **unpopulated in v1**.
- Public-read RLS (`is_active` only); `study_history.curriculum_topic_id` FK `ON DELETE SET NULL` so archiving never destroys history.
- `Roadmap.tsx` builds a two-level tree via `groupBySystem`.
- "Coverage tracking" is explicitly deferred to v2 (comment in migration).

---

## 22. Design System & Theming

- `openmed-tokens.css` is a **verbatim transplant of OpenMed's design tokens** (raw hex palette from openmed.life assets, Google Fonts Newsreader / Inter Tight / JetBrains Mono; header warns "Do not tune these by hand").
- `index.css` bridges tokens to Tailwind via **namespaced `--sb-*` HSL variables** (border/accent) so Tailwind utilities don't clobber the raw palette — a deliberate, documented workaround.
- `openmed-components.css` (1113 lines) is scoped under `.openmed` to avoid collisions.
- Tailwind config: `darkMode: ['class']`, fonts, `fade-in`/accordion animations; `border: hsl(var(--sb-border))`, `accent: hsl(var(--sb-accent))`.
- Mixed styling conventions (inline style mutation in Dashboard's `onMouseEnter/Leave` + Tailwind + `.openmed` classes) — cosmetic debt, not functional.

---

## 23. Client State & Persistence

localStorage keys in play (two eras):
- `sb_*`: `sb_qbank_session`, `sb_welcomed`, `sb_anon_citation`, `sb_first_sheet_seen`, `sb_first_deck_seen`, `sb_sheet_hint_dismissed`, `sb_recent_flashcard_topics_v1`, `sb_persona_v1`
- `studybuddy_*`: `studybuddy_decks_v1`, `studybuddy_history`, `studybuddy_citations_by_topic`
- `APP_STORAGE_KEYS` (Index.tsx) = "has used app before" set.

Concerns: QBank session (answers) is localStorage-resident and tamperable (display-only, grading is server-side); anon citation count lives purely client-side; `sb_persona_v1` is fine. Supabase auth session also in localStorage (standard).

---

## 24. Security Findings (severity-ranked)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | 🔴 **HIGH** | **Pro is trivially bypassable.** RLS grants any *authenticated* user `SELECT` on `pro_codes`, and the migration **commits 40 seed codes**. Anyone can read the codes and call `redeem_pro_code`. The "hidden admin feature" premise is void. | `20260505154708` lines 52–69, 131–132 |
| 2 | 🔴 **HIGH** | **Edge functions trust client-supplied entitlements.** `medical-notes` reads `isPro`, `isAnonymous`, `preferredModel`, `userId` from the request body with no JWT verification. A crafted request routes free traffic to paid Claude Haiku, and passing another user's `userId` consumes **their** daily quota (griefing). `get-citations` has no auth/rate limit at all (NCBI cost + DoS surface). | `medical-notes/index.ts` body parsing; `get-citations/index.ts` handler |
| 3 | 🟠 **MEDIUM** | **Citation gating is client-only.** Anon counter = localStorage; free counter = client-upserted `citation_usage`. Both bypassable in devtools. | `use-citation-usage.ts`, `citation_usage` policy |
| 4 | 🟠 **MEDIUM** | **`dangerouslySetInnerHTML` markdown rendering.** `renderMarkdown` regex → innerHTML in `QBankSession.tsx:302/320` (+ `ui/chart.tsx:70`). Safe while content is curated DB text; becomes an XSS surface if anything user-supplied reaches it. | QBankSession.tsx |
| 5 | 🟠 **MEDIUM** | **5 core QBank tables have no RLS in repo** (`questions`, `media`, `question_media`, `qbank_sessions`, `user_attempts`). Live grants are unverifiable; drift already bit once (`session_id` 42703). | migration headers |
| 6 | 🟠 **MEDIUM** | **No CSP / security headers / rate limiting at the edge** (Vercel `vercel.json` only rewrites; edge fns CORS `*`). | vercel.json, edge fns |
| 7 | 🟡 **LOW-MED** | **No typecheck, strict TS off** (`strict:false`, `noImplicitAny:false`, `noUnusedLocals:false`), 4 `catch (e: any)` swallow failures silently. | tsconfig.app.json |
| 8 | 🟡 **LOW** | `.env` with live URL + anon key exists in the working dir — **untracked & gitignored (good), never in history (verified)**, but no rotation practice; anon key is publishable by design, so the risk is modest. | git status/log |
| 9 | 🟡 **LOW** | Vestigial Stripe columns on `profiles` are unused but present — not a vulnerability, a maintenance hazard. | `20260508000000` |
| 10 | 🟡 **LOW** | `sb_qbank_session` (answers) is localStorage-resident and editable; `endSession` writes are client-driven. Non-authoritative for grading (server-side), so low risk. | QBankContext.tsx |

**What's genuinely done well (credit where due):**
- Server-side QBank sampling/grading with a **corrected** answer-key revoke (documented no-op→fix) and direct-INSERT revoke.
- Atomic, service_role-only quota RPCs; refund-on-failure; floors at 0.
- All QBank RPCs enforce ownership; `submit_answer` has anti-oracle guards.
- Additive-only migration discipline with an idempotent repair migration.
- JWT-Bearer centralized caller (`callMedicalNotes`).
- Secrets are not in git; service-role key never shipped to the client.

---

## 25. Performance & Bundle Analysis

**Measured build** (`vite build`):
- `index.js` **933.48 kB raw / 266.16 kB gzip** — single chunk, no code splitting. Vite warns > 500 kB.
- `index.css` 118.43 kB / 20.77 kB gzip.

Issues:
- No route-level `React.lazy`; every page (QBank, Dashboard, recharts charts) loads upfront.
- `recharts` + d3 is the dominant vendor cost, imported eagerly.
- 44 Radix packages + `cmdk`/`vaul`/`input-otp` inflate the vendor graph even with tree-shaking.
- `get-citations` serial external HTTP chain (up to ~12 NCBI calls) adds real latency to cited generations.
- No `manualChunks`/`chunkSizeWarningLimit` configuration.

**Good:** SSE streaming for generation (perceived latency is fine), `dedupe` of react/react-query in vite.config, HMR overlay off, `prefers-reduced-motion` guards.

**Recommendations:** route-level lazy(), `manualChunks` (react, recharts), consider a lighter chart (or lazy recharts), keep analytics deferred.

---

## 26. Testing, CI/CD & Quality Gates

- **Tests:** vitest + jsdom configured; `src/test/setup.ts` (jest-dom + matchMedia mock). **Only `src/test/example.test.ts` exists** — a `expect(true).toBe(true)` placeholder. Coverage ≈ 0%. No component/unit/integration/e2e tests for auth, quota, QBank, parsing, or edge functions.
- **Playwright** is a dependency but there are no specs in the repo (config wraps a lovable-agent harness).
- **Lint (`eslint .`) fails — 9 errors, 20 warnings:**
  - `no-explicit-any` ×4: FlashcardsGenerator.tsx:203, SaveButton.tsx:28, SheetGenerator.tsx:625, StudyMode.tsx:411
  - `no-empty-object-type` ×2: ui/command.tsx:24, ui/textarea.tsx:5
  - `prefer-const`: lib/parse-flashcards.ts:39
  - `no-useless-escape`: supabase/functions/get-citations/index.ts:124
  - `no-require-imports`: tailwind.config.ts:92
  - Warnings: 8× `react-refresh/only-export-components`, 7× `react-hooks/exhaustive-deps`, `use-flashcard-deck.ts:132` useCallback-stability, `QBank.tsx:199` unnecessary dep.
- **No CI config** in repo (no GitHub Actions / Vercel build checks); **no `typecheck` script**; **no typecheck in build** (SWC transform).

---

## 27. Observability & Monitoring

- `@vercel/analytics` — page-level product analytics only.
- **No error tracking** (no Sentry/LogRocket); errors surface via 7 `console.error` sites + `catch (e: any)` silently swallowing (4 sites).
- Edge functions log only on error (`get-citations` catches and returns `{citations:[]}` with a `console.error`); **no request logging, no latency/cost metrics, no structured logs** for OpenRouter spend, quota hit-rates, or model routing decisions.
- No health checks or uptime monitoring in the repo.
- Recommendation: Sentry (frontend + edge fns) is the highest-leverage single add.

---

## 28. Deployment & Infrastructure

- **Frontend:** Vercel SPA (`vercel.json` rewrite-only). `@vercel/analytics` wired.
- **Backend:** Supabase project (URL from gitignored `.env`); Deno edge functions (`medical-notes`, `get-citations`).
- **Env vars:** app needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.example` has exactly these). Edge fns need `OPENROUTER_API_KEY` and `NCBI_API_KEY` (server-side, not in `.env.example`). RAG spike additionally wants `SUPABASE_SERVICE_ROLE_KEY` + `GEMINI_API_KEY` (local only, gitignored).
- **Dev:** Docker-only (`Dockerfile` node:20-alpine, `docker-compose.yml` bind-mount + named node_modules volume, `.env` mounted read-only, port 8080); **Dockerfile explicitly says "Dev environment only — not a production image"**.
- **Git:** 3 remotes (RoshdiRaed / OsamaShihadaMedDev / StudyBuddyAi org). No branch-protection or CI in repo.

---

## 29. Documentation Accuracy vs Reality

| Claim | Reality |
|---|---|
| README: "SM-2 spaced repetition" | ❌ Inaccurate — fixed `[1,3,7,21,60]` interval ladder, not SM-2 (§18) |
| README: Claude Haiku 4.5 (Pro), GPT-OSS 20B default | ✅ Accurate |
| CONTEXT.md: `preferred_model` migration stale (`flash` vs `claude`) | ✅ Confirmed (`20260516000000`) |
| CONTEXT.md: "Persona — NOT on main… no table, prop, or type" | ❌ Stale — `use-persona.ts` exists and is used in `SheetGenerator.tsx:501` (`sb_persona_v1`, student/clinician/expert). The multi-agent Writer→Reviewers→Editor personas indeed don't exist, but a lightweight persona feature does |
| CONTEXT.md: `use-qbank.ts` is legacy dead-code, only types imported | ✅ Confirmed |
| CONTEXT.md: QBank tables unverifiable from repo | ✅ Confirmed (dashboard-created) |
| CONTEXT.md: `planBlock.ts`/`generateBlock.ts` absent | ✅ Confirmed absent |
| CONTEXT.md: RAG spike isolated | ✅ Confirmed — own package.json, no `src/**` references |
| .env not committed | ✅ Verified (untracked + gitignored, no history) |

---

## 30. Top 10 Problems, Scorecard & Roadmap

### Top 10 Problems

1. 🔴 `pro_codes` world-readable to authenticated + 40 seed codes committed → **Pro free-for-all**.
2. 🔴 Edge fns trust body-supplied `isPro`/`userId`/`preferredModel` with no JWT verification → free Haiku routing + quota griefing.
3. 🟠 Citation gating entirely client-side (localStorage + client-upserted `citation_usage`).
4. 🟠 **No meaningful tests** (1 placeholder), **no CI**, lint failing (9 errors), no typecheck script.
5. 🟠 Single 933 kB JS bundle with no code splitting.
6. 🟠 QBank tables (`questions`, `media`, `question_media`, `qbank_sessions`, `user_attempts`) absent from migrations → posture unverifiable, drift already proven.
7. 🟠 `dangerouslySetInnerHTML` markdown rendering in QBank review path.
8. 🟡 Non-strict TS + `catch (e: any)` + silent failure swallowing.
9. 🟡 Docs drift (SM-2, persona, `preferred_model`, `.env.example` incomplete for edge-fn vars).
10. 🟡 localStorage as source of truth for QBank session + anon data (loss/tamper/incognito edge cases).

### Top 10 Improvements

1. Revoke `SELECT` on `pro_codes`; redemption only via RPC (optionally hash codes at rest).
2. Verify JWT in edge functions (`supabase.auth.getUser(authorization)`), derive `isPro`/model/quota **server-side** from `profiles`; add per-user rate limiting; keep body `userId` only as a cross-check.
3. Move citation quotas server-side (mirror `consume_usage`) or fold into `medical-notes` itself.
4. Add CI (GitHub Actions): `lint` (fix the 9 errors), `tsc --noEmit` (new script), `vitest run`, `supabase functions` smoke tests. Gate deploys on green.
5. Route-level `lazy()` + `manualChunks`; lazy-load recharts; add CSP + security headers in `vercel.json`.
6. Author migrations for the 5 dashboard-only QBank tables (CREATE IF NOT EXISTS + explicit RLS policies) so the repo is the source of truth.
7. Replace regex→innerHTML with a vetted sanitizer or structured render.
8. Turn on strict mode incrementally; replace `any` catches with typed errors + reporting.
9. Add Sentry + structured edge-fn logs; reconcile `.env.example` (add `OPENROUTER_API_KEY`, `NCBI_API_KEY`); correct README/CONTEXT drift.
10. Kill dead weight: legacy `DashboardSidebar`, `use-qbank.ts` type re-export, duplicate `timeAgo`, vestigial Stripe columns.

### Scorecard

| Dimension | Score |
|---|---|
| Architecture & organization | 7 |
| Data model & migration discipline | 7 |
| Security | 4.5 |
| Frontend UX & code quality | 6 |
| Testing & CI | 1.5 |
| Performance | 5 |
| Observability | 2.5 |
| Documentation accuracy | 5 |
| **Overall** | **5/10** |

### 90-Day Technical Roadmap

**Weeks 1–3 — Security of entitlements (highest priority):**
- Revoke `pro_codes` SELECT; harden `redeem_pro_code`; JWT-verify in both edge functions; server-side `isPro`/model/quota; citation quota RPC; rate limiting + CSP headers.

**Weeks 4–6 — Quality gates:**
- Fix 9 lint errors; add `typecheck` script + strict-mode rollout; GitHub Actions CI; first real test suites (parse-flashcards, spaced-repetition progression, auth migration, edge-fn auth, quota RPCs).

**Weeks 7–9 — Performance & robustness:**
- Route-level code splitting; vendor chunking; lazy recharts; migrations for the 5 QBank tables; typed error handling; Sentry.

**Weeks 10–13 — Hardening & polish:**
- Observability on edge fns (OpenRouter cost, quota hit-rate, model mix); markdown sanitization; remove dead code + vestigial Stripe columns (additive migration); docs reconciliation; re-run full audit.

---

*End of audit. All findings are code-verified; "inferred"/"unverifiable" is stated explicitly where the repo cannot prove live-DB state.*
