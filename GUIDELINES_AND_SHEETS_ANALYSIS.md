# Guidelines Page & Study Sheet Page — Detailed Analysis

Scope: the `/guidelines` page (clinical RAG search) and the `/sheets` page (AI study sheet generator), covering frontend, edge functions, data model, and prompt/model design. Paths below are repo-relative.

---

## 1. Guidelines page (`/guidelines`)

### 1.1 Route & UI
- Route: `src/App.tsx:71` → `<Route path="/guidelines" element={<RagSearch />} />`
- Nav label "Guidelines" (`src/components/dashboard/AppNav.tsx:42`, `BookOpen` icon)
- Page component: [RagSearch.tsx](src/pages/RagSearch.tsx) — a single-screen "Clinical RAG Intelligence" search UI:
  - Free-text query box, four canned sample queries, Ctrl+Enter to submit.
  - An "Advanced Parameters" drawer exposing **Top K** (1–10 retrieved chunks), **Cutoff Similarity** (0.40–0.90), and a **Persona/Feature scope** select (`general` / `clinical` / `exam`) — sent through but currently only reflected in the audit log, not in the backend prompt (see 1.3).
  - Result view shows a grounding banner ("VERIFIED SOURCE COMPLIANT" vs "UNGROUNDED RESPONSE WARNING"), the synthesized markdown answer, and an expandable "Guidelines Explored" list of source chunks with similarity %, section title, and an external link to the source document.

### 1.2 Client → edge function contract
- `src/lib/callRagGenerate.ts` posts `{ query, topK, threshold, feature }` to the `rag-generate` Supabase Edge Function, attaching the user's Supabase JWT if present (**optional** — anonymous callers are allowed).
- Notably it supports overriding the target URL via `VITE_N8N_RAG_WEBHOOK_URL`, i.e. the same request can be routed to an n8n workflow instead of the edge function. If that env var is used, `rag-generate`'s quota/audit/memory logic (below) is bypassed entirely — worth knowing if answers are inconsistent between environments.
- `src/hooks/use-rag-query.ts` wraps the call in a React Query `useMutation`.

### 1.3 Backend: `supabase/functions/rag-generate/index.ts`
Pipeline per request:
1. **Auth (optional)** — verifies the bearer JWT if present to resolve `userId`; falls back to `"anonymous"`. Unlike the Sheets backend, a missing/invalid token is **not rejected** — grounded answers are available to anonymous users with no rate limiting.
2. **Conversation memory** — for authenticated users, maintains a 10-turn sliding window per user in `rag_memory_state` / `rag_conversation_memory`. After 10 Q&A turns, a new `window_id` is minted (old rows are never deleted, just abandoned) and history resets. History is injected as prior `user`/`assistant` messages plus an explicit system-prompt instruction to resolve pronouns/follow-ups.
3. **Embedding** — `text-embedding-3-small` via LangChain's `OpenAIEmbeddings`, routed through OpenRouter (`baseURL: openrouter.ai/api/v1`), 1536-dim.
4. **Retrieval** — calls Postgres RPC `match_guideline_chunks(query_embedding, match_threshold, match_count)` (pgvector cosine search) via the Supabase service-role client.
5. **Grounding decision** — `grounded = true` iff at least one match's similarity ≥ `threshold` (client default 0.65). If grounded, the top-K chunks are concatenated into a `Context:` block; if not, the model is instructed to answer from general knowledge and flag itself as ungrounded.
6. **Generation** — `gpt-4o-mini` via `ChatOpenAI` (also OpenRouter), temperature 0.3, with LangSmith tracing (`LangChainTracer`) if `LANGSMITH_API_KEY`/`LANGCHAIN_API_KEY` is set. The persona/`feature` parameter from the client (`general`/`clinical`/`exam`) is **read but not used** to alter `systemPrompt` — it is only logged.
7. **Persistence** — fire-and-forget insert into `rag_logs` (audit trail: user, feature, query, `grounded`, `source_ids`); for authenticated users, `rag_conversation_memory` + `rag_memory_state.turn_count` are updated with an **awaited** write (comment in code explains this is intentional — Deno edge isolates can be killed before a non-awaited write lands).
8. **Response** — `{ answer, grounded, sources[] }`, each source carrying `similarity`, `guidelineName`, `sectionTitle`, `sourceUrl`, and the raw chunk `content` (full snippet text is shipped to the client, not just a preview).

Error handling: embedding failures and completion failures return typed errors (`EMBEDDING_FAILED`, `AI_PROVIDER_FAILED`) with `refundQuota: true` in the payload — but the edge function itself has no quota mechanism, so this flag appears to be a contract left over from/for a caller that does track quota (none currently reads it client-side).

### 1.4 Data model (retrieval corpus)
- `guideline_chunks` (migration `20260511000000_rag_spike_pgvector.sql`, dimension later widened in `20260810000000_rag_embedding_1536.sql`):
  `id, guideline_id, guideline_name, source_url, section_title, chunk_index, content, embedding vector(1536), metadata jsonb, created_at`.
  RLS: public read-only (`using (true)`); writes are service-role only (ingestion script).
- `match_guideline_chunks(query_embedding, match_threshold, match_count)` — SQL function, cosine distance (`<=>`) via pgvector, returns `similarity = 1 - distance`, ordered ascending distance, capped at `match_count`.
- `rag_logs` (`20260810010000_rag_logs.sql`) — audit log, user-readable via RLS (`auth.uid() = user_id`), written by service role.
- `rag_conversation_memory` / `rag_memory_state` (`20260810020000_rag_conversation_memory.sql`) — sliding-window chat memory keyed by `user_id` + `window_id`.

### 1.5 Ingestion pipeline (`scripts/rag-spike/`)
- A standalone Node/TS toolkit (`ingest.ts`, `retrieve.ts`, `generate.ts`, `check_db.ts`) that is **not part of the deployed app** — it's an offline corpus-building spike.
- **Current corpus is a single document**: `pdfs/NICE-NG136.pdf` ("NICE NG136 — Hypertension in adults: diagnosis and management"), hardcoded as `GUIDELINE_ID = "nice-ng136"` in `ingest.ts`. This means the "Guidelines Explored" grid in production can only ever surface hypertension-guideline content — the sample queries in `RagSearch.tsx` (CAP treatment, DKA, pancreatitis) will legitimately fall through to the **ungrounded** path unless more guidelines have since been ingested outside this script.
- Chunking (`lib/chunker.ts`): paragraph-based splitting on blank lines, heading detection (numbered `1.2.3` style or short ALL-CAPS lines) to tag `section_title`, short-chunk merging (<200 chars) forward within a section, and long-chunk splitting (>1500 chars) at sentence boundaries targeting ~800 chars. Also strips page headers, bare URLs, and copyright lines.
- Ingestion is resumable (tracks max `chunk_index` already in the DB per `guideline_id`), batches embeddings 50 at a time with a 1s inter-batch delay (rate-limit friendliness), and is idempotent against partial failures.
- `scripts/check_guidelines_client.js` is a separate, minimal ad hoc script (uses the **publishable** key, not service role) to eyeball a few `guideline_chunks` rows and their embedding dimension — a debugging aid, not part of any pipeline.

### 1.6 Observability
- Structured JSON logs (`log()` helper) at every pipeline stage, tagged `fn: "rag-generate"` — designed for Supabase edge function log search.
- Optional LangSmith tracing end-to-end (embedding + chat calls), explicitly flushed (`awaitAllCallbacks` + `client.awaitPendingTraceBatches`) before the response returns, because the Deno isolate can be torn down immediately after responding otherwise.

---

## 2. Study Sheet page (`/sheets`)

### 2.1 Route & UI
- Route: `src/App.tsx:64` → `<Route path="/sheets" element={<Sheets />} />` (lazy-loaded)
- Nav label "Sheets" (`AppNav.tsx:39`, `FileText` icon)
- [Sheets.tsx](src/pages/Sheets.tsx) is a thin wrapper: page header + `<SheetGenerator>`. It accepts a `topic` via router `location.state` (used when the Roadmap feature deep-links here with a pre-filled topic).
- [SheetGenerator.tsx](src/components/SheetGenerator.tsx) (1,428 lines) is the actual feature: a two/three-pane layout —
  - **Left (35%, desktop) / drawer (tablet)**: configurator — free-text notes/topic box or quick-pick chips (Heart Failure, Pneumonia, Ischemic Stroke, DKA, Nephrotic Syndrome), plus pill-toggle groups for **Exam Mode** (General / USMLE Step 1 / Step 2), **Difficulty** (Basic/Medium/Advanced), **Focus** (Quick Revision / Deep Understanding / Clinical Reasoning), **Length** (Concise/Moderate/Detailed), a Pro-only model switch (GPT-OSS 20B vs Claude Haiku 4.5), and three **persona** buttons (Student / Clinician / Expert) that double as the generate trigger — there's no separate "Submit" button.
  - **Middle (fluid)**: the "living document" — loading skeletons with rotating status text ("Reading topic…" → "Finalizing your sheet…"), then the rendered sheet via `OutputSection`, then a "Save deck to library" action that extracts `flashcards` into the user's spaced-repetition deck.
  - **Right (≥1536px only)**: a sticky section navigator (`SheetSectionNav`) that IntersectionObserver-highlights the section currently in view and smooth-scrolls on click.
  - Empty state (`SheetsEmptyState`) is history-aware: new users see topic quick-picks; returning users see their 4 most recent sheets ("Continue studying") above a lighter "start fresh" path.
  - Client-side gating: daily sheet cap display (`useUsageLimit`/`MAX_DAILY_SHEETS`), a "premium hook" banner for free/anon users' first Claude generations (`usePremiumHook`), and `AuthModal`/`GoProModal` upsells.

### 2.2 Data contract: `GeneratedSheet`
Defined in [src/types/generated-sheet.ts](src/types/generated-sheet.ts):
```
{ topic?, overview, memoryHooks[], clinicalApproach, keyPoints[], examTraps[],
  flashcards: {tag, question, answer}[], referenceNote, topicEmoji?, enhancements? }
```
- Sheets are persisted to `study_history` as `JSON.stringify(GeneratedSheet)` in the `output` column. `isJsonSheet()` distinguishes new JSON rows from legacy plain-text blobs (pre-migration), and `parseStoredSheet()` safely parses with a `null` fallback — the UI falls back to a "legacy renderer" (`legacyOutput` string state) when parsing fails, so old history rows keep rendering.
- `enhancementKey(sourceText, mode)` builds a stable cache key for "expand"/"clinical" per-item AI enhancements, keyed off a 40-char slice of the source text — collisions are theoretically possible for two different items sharing a 40-char prefix, but low-risk given real note text.

### 2.3 Backend: `supabase/functions/medical-notes/index.ts`
This is a considerably more elaborate edge function than `rag-generate`, and — importantly — **it is not connected to the guideline RAG system at all**. It is a direct, ungrounded LLM call; the "Based on standard medical references and clinical guidelines" `referenceNote` text is asserted by the prompt, not backed by retrieval (see §3).

Key mechanics:
1. **Hard auth requirement** — rejects any request without a valid Supabase JWT (`401 invalid_token`), unlike `rag-generate`.
2. **Server-derived entitlement** — `isPro`, `isAnonymous`, `preferredModel` are read from the verified JWT + a `profiles` row lookup; any of those fields sent in the request body are explicitly ignored ("UI hints at most") to prevent client-side tampering with pro/quota status.
3. **Six prompt modes**, each with a GPT-OSS and a Claude-Haiku variant: full sheet generation, cards-only, "explain" (single flashcard deep-dive), and two "enhance" modes (`expand`, `clinical`) for expanding a single sheet bullet in place.
4. **Persona system** (`personaPreamble()`) — three tone/depth presets (student/clinician/expert) that change prompt content and register only, explicitly never model routing or the JSON schema — enforced by keeping `sheetSchemaBlock` identical across personas and models.
5. **Shared JSON contract** (`sheetSchemaBlock`) — a very detailed, appended-to-every-sheet-prompt spec: exact field shapes, a mandated `\n`-delimited sub-structure inside `overview`/`clinicalApproach` (Mechanism/Pathophysiology/Key associations vs Diagnosis/Workup/Management/Complications/Avoid), a hard rule that `overview` must exclude drug names/diagnostic criteria/management (reserved for `clinicalApproach`), a fixed emoji palette, and **length-gated hard caps** (exact item counts per Concise/Moderate/Detailed) enforced purely through prompt instructions, not code.
6. **Model routing / monetization**:
   - Pro + prefers Claude → `anthropic/claude-haiku-4.5`; Pro + prefers GPT-OSS (default) → `openai/gpt-oss-20b`.
   - Free/anonymous users get a limited number of free Claude ("premium hook") generations — 1 for anonymous, 3 for logged-in-free — consumed atomically via the `consume_premium_hook` RPC; once exhausted, falls back to GPT-OSS. RPC failure fails open to GPT-OSS (never blocks generation).
   - Provider pinning per model via OpenRouter `provider.order` (`Cerebras`/`Groq` for GPT-OSS, `Anthropic` for Haiku), with fallback allowed.
7. **Server-side daily quota** — `consume_usage` RPC with a cap of 5/day for sheets and cards combined (`explain`/`enhance` calls are exempt), consumed **before** calling OpenRouter and refunded via `refund_usage` if the upstream call throws or returns non-2xx — so failed generations never burn quota. Pro users bypass the cap entirely (server-verified, not body-supplied).
8. **Streaming** — proxies OpenRouter's SSE stream through a `TransformStream`, re-encoding only the `delta.content` payloads and appending a synthetic `data: [DONE]` on flush; the client (`SheetGenerator.generate()`) accumulates `fullText` from the stream, then (after a client-side simulated step-by-step loading animation completes) sanitizes markdown code fences and `JSON.parse`s the full text into a `GeneratedSheet`.
9. Response headers `X-Model-Used` / `X-Is-Premium` let the client label which model actually produced the sheet.

### 2.4 Notable client-side loading UX
`SheetGenerator`'s streaming code fully buffers the response and does **not** render partial content incrementally — instead a `setInterval` cycles through five canned status strings ("Reading topic…" → "Finalizing your sheet…") over ~5 seconds, and only *after* the real stream finishes AND that fake timer completes does it parse and reveal the sheet. If the fetch is slower than the interval, the last message ("Finalizing your sheet…") holds until the real data lands (`allStepsDone` gate) — so the animation never lies about completion, but on fast responses users wait for the animation regardless.

---

## 3. Cross-cutting observations

1. **The two features are architecturally independent.** "Guidelines" is a real retrieval-augmented system grounded in `guideline_chunks` (pgvector similarity search, explicit `grounded`/ungrounded signaling, cited sources). "Sheets" is a persona-prompted, ungrounded chat completion — it never queries `guideline_chunks` or calls `rag-generate`. The sheet's `referenceNote` field ("Based on standard medical references and clinical guidelines") is model-asserted text, not a retrieval result, which could read as a stronger evidence claim than what's actually backing it. If clinical-accuracy grounding is a goal for Sheets too, wiring `medical-notes` to the same `match_guideline_chunks` RPC (or to `rag-generate`) would be the natural next step — but that's a product decision, not something implied by the current code.
2. **Corpus coverage gap.** The retrieval corpus behind "Guidelines" currently contains only one ingested document (NICE NG136, hypertension). Three of the four sample queries shown to users on that page (pneumonia, DKA, pancreatitis) are outside that corpus and will legitimately return "UNGROUNDED RESPONSE WARNING" unless more guidelines have been ingested since `scripts/rag-spike/pdfs/` was last touched.
3. **Asymmetric auth/quota posture.** `rag-generate` allows fully anonymous, unrate-limited access (only an audit log, no quota); `medical-notes` requires a verified JWT and enforces a server-side daily cap. This is presumably intentional (Guidelines is a lighter-weight "search" feature; Sheets is the metered core product) but is worth confirming is still the intended trust boundary, especially since `rag-generate` can also be pointed at an arbitrary n8n webhook via env var, which would bypass even its own audit logging.
4. **`feature` parameter on Guidelines is inert.** The client's persona selector ("General Medical Educator" / "Actionable Bedside Clinician" / "High-Yield Board Prep") is sent to `rag-generate` and stored in `rag_logs.feature`, but the edge function's `systemPrompt` never branches on it — the UI implies persona-tailored answers on that page, but retrieval/generation is currently persona-agnostic there (unlike Sheets, where persona is a first-class, well-implemented prompt axis).
5. **Prompt-enforced structure has no server-side validation.** Both the sheet JSON contract and the length-gate item counts are enforced entirely through prompt instructions; `medical-notes` does not validate the model's JSON against the `GeneratedSheet` shape before streaming it back — malformed output is caught client-side only by `JSON.parse` failing, which falls back to the legacy plain-text renderer.

---

## 4. Quick reference

| | Guidelines (`/guidelines`) | Sheets (`/sheets`) |
|---|---|---|
| Frontend | `RagSearch.tsx` | `Sheets.tsx` + `SheetGenerator.tsx` |
| Backend | `rag-generate` edge fn | `medical-notes` edge fn |
| Grounded? | Yes — pgvector search over `guideline_chunks` | No — direct LLM prompt only |
| Auth | Optional | Required (401 if missing) |
| Models | `gpt-4o-mini` (chat) + `text-embedding-3-small` via OpenRouter | `openai/gpt-oss-20b` or `anthropic/claude-haiku-4.5` via OpenRouter, tier-routed |
| Quota | None (audit log only) | 5/day free cap + premium-hook Claude allowance; Pro unlimited |
| Persistence | `rag_logs`, `rag_conversation_memory`, `rag_memory_state` | `study_history` (client-saved), `profiles` (entitlement) |
| Output shape | Free-text answer + source list | Strict JSON (`GeneratedSheet`) with length-gated sections |
| Corpus | 1 guideline ingested (NICE NG136) via `scripts/rag-spike/` | N/A (no corpus) |
