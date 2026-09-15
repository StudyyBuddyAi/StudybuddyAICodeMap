# Corti as the AI provider for study generation — spike

Branch: `feat/corti-provider-spike` · Status: evaluation (nothing in production calls the new code)

## 1. What calls an AI model today

| Surface | Edge function | Model(s) today | Provider | Client caller |
|---|---|---|---|---|
| Study sheet (JSON) | `medical-notes` | Claude Haiku 4.5 (premium: Pro + "claude" pref, or free/anon premium hook) · GPT-OSS 20B (everyone else) | OpenRouter | `SheetGenerator` |
| Flashcard deck (text) | `medical-notes` `cardsOnly` | same routing | OpenRouter | `FlashcardsGenerator` |
| Explain a card (text) | `medical-notes` `explainMode` | same routing | OpenRouter | `StudyMode` |
| Enhance: expand / clinical (prose) | `medical-notes` `enhanceMode` | Haiku for Pro, else GPT-OSS | OpenRouter | `OutputSection` |
| Source labels for retrieved passages | `medical-notes` → `_shared/source-labels.ts` | GPT-OSS 20B | OpenRouter | (server side-call) |
| Grounding embeddings | `_shared/rag.ts` | text-embedding-3-small (1536-d) | OpenRouter | (server) |
| QBank writer / router / verifier | `qbank-generate` | corti-s1-instant | **Corti (already)** | `callQbankGenerate` |
| RAG Q&A | `rag-generate` | gpt-4o-mini via LangChain | OpenRouter | **none** — no client code calls it |
| Citations | `get-citations` | — (PubMed E-utilities, no LLM) | — | `citation.ts` |

**Scope of this spike** (agreed): the `medical-notes` writer call only. Anything RAG- or
embedding-related stays exactly as it is — embeddings, retrieval and the source-label side
call keep running through OpenRouter.

## 2. What Corti offers (checked live against `GET /v1/models`, 2026-09-14)

| Model | Base | Reasoning | Context | $/1M in · out |
|---|---|---|---|---|
| corti-s1 | GLM 5.2 | yes (effort high/max only) | 262k | 2 · 8 |
| corti-s1-instant | GLM 5.2 | no | 262k | 2 · 8 |
| corti-s1-mini | Qwen 3.6 | yes | 262k | 1 · 4 |
| corti-s1-mini-instant | Qwen 3.6 | no | 262k | 1 · 4 |
| corti-s1-tiny / -tiny-instant | ? | ? | 32k | **not published** (listed by the API, absent from docs) |
| corti-s1-embedding | Qwen3-Embedding-4B | — | 16k | 0.03 · — — fixed **2560-d**, rejects `dimensions` |

For reference: Claude Haiku 4.5 is $1 · $5; GPT-OSS 20B on OpenRouter is roughly $0.04 · $0.15.
So Corti's cheapest priced model (mini) costs about Haiku's price, and **~25× GPT-OSS** — the
free tier is where cost moves.

Why the embedding model is out of scope even beyond the agreement: 2560-d vectors cannot go
in the existing `vector(1536)` column, and pgvector's HNSW/IVFFlat indexes cap `vector` at
2000 dimensions (`halfvec` would be required), so it is a full re-ingest plus schema change.

## 3. How the test works

```
scripts/notes-eval/run.ts ──(user JWT, body.eval)──► medical-notes-corti (deployed, prod project)
                                                     │  same retrieval · same prompt builder · same relay
                                                     ├─► OpenRouter  (baselines: Haiku 4.5, GPT-OSS 20B)
                                                     └─► Corti       (candidates)
```

- **One pipeline for both providers.** `medical-notes-corti` is a copy of `medical-notes` with the
  writer call swapped. In *eval mode* (only for the harness's allowlisted anonymous user) the
  request names provider + model + prompt set, so baselines and candidates go through identical
  retrieval, prompt construction and SSE relay, using the function's own secrets. Eval mode writes
  nothing: no quota, premium hook, memory, or rag_logs.
- **Same prompts, byte for byte.** `_shared/medical-notes-prompts.ts` is generated as a verbatim
  lift of the prompt code in `medical-notes/index.ts`. Premium-tier arms use the Haiku prompts,
  standard-tier arms the GPT-OSS prompts — exactly what production pairs them with.
- **Cases** (`cases.ts`): 7 sheets (3 personas × 3 lengths, a topic name, a pasted-notes blob, a
  student's vernacular question, one grounded topic), 3 card decks (8/10/12 cards), 3 explains,
  3 expand and 3 clinical enhances — request bodies shaped as the client sends them.
- **Arms**

  | Tier | Baseline | Corti candidates |
  |---|---|---|
  | premium (Haiku route) | Claude Haiku 4.5 | corti-s1-instant, corti-s1-mini-instant |
  | standard (GPT-OSS route) | GPT-OSS 20B | corti-s1-mini-instant, corti-s1-tiny-instant (corti-s1-mini dropped after smoke test — see §4) |

- **Scoring**, two independent layers:
  1. *Contract* (`score.ts`) — every output through the app's own parsers
     (`parseSheetOutput`, `parseFlashcardsFromOutput`) and the rules each prompt states: JSON
     parses as sent, length gate counts, overview/clinical structure, no template placeholder
     leaks, honest `sourceCoverage`, exact card count and tags, explain headers and 180-word cap,
     enhance sentence/word caps, truncation. Plus TTFC, total time, tokens and cost.
  2. *Quality* (`judge.ts`) — per case and tier, all arms' outputs side by side under shuffled
     letters; each scored 1–5 for medical accuracy, teaching quality and fit to
     persona/mode/instructions, then unblinded. Caveat: the judge (Claude) shares a model
     family with the Haiku baseline; blinding reduces but cannot remove that bias.
- **Phase 2**: rewrite the prompts for Corti (`_shared/medical-notes-prompts-corti.ts`, selected by
  `prompts: "tuned"` / `CORTI_NOTES_PROMPTS=tuned`) aimed at the failures Phase 1 surfaces, re-run
  the Corti arms, and score the same way.
- **Phase 3**: point a local dev client at `medical-notes-corti`
  (`VITE_MEDICAL_NOTES_FN=medical-notes-corti` in `.env.local`) and exercise sheet, cards,
  explain and enhance end to end in the browser.

Reproduce:

```sh
node scripts/notes-eval/session.ts                       # once: creates the eval user
node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/run.ts
node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/score.ts <run>
node --import ./scripts/notes-eval/loader.mjs scripts/notes-eval/judge.ts packets <run>
```

## 4. Results

### Headline

- **Quality is not the blocker — Corti matched or beat both current models** on blind review, once
  its prompts were adjusted. The main Corti failures were formatting, and formatting is fixable in
  the prompt.
- **Premium route (Haiku today → corti-s1-instant): a straight win.** Higher quality (13.4 vs 9.6
  of 15 on sheets and card decks; 12.6 vs 11.1 across all modes even before tuning), faster sheets
  (~19 s vs ~34 s), and about the same cost per sheet ($2.36 vs $2.18 per 100),
  because Corti writes shorter sheets that actually respect the length setting.
- **Standard route (GPT-OSS 20B today → corti-s1-mini-instant): better quality, but ~10× the cost
  and ~8× slower.** GPT-OSS on Cerebras writes a sheet in ~3.4 s for ~$0.001; mini-instant takes
  ~27 s and ~$0.01. That is a business decision, not a quality one (see §5).
- **End to end in the real app, every surface works on Corti**: sheet (both routes), expand,
  clinical tie, a 12-card deck, explain — with grounding, source labels, citations, memory and quota
  all running through the normal pipeline.

### Phase 1 — the current prompts, unchanged (19 cases per arm)

| Tier | Arm | Contract checks passed | Quality /15 (blind) | Sheet: first token / total | $ per 100 sheets |
|---|---|---|---|---|---|
| Premium | **Claude Haiku 4.5** (today) | 82% | 11.1 | 0.7 s / 34 s | $2.18 |
| Premium | corti-s1-instant | **97%** | **12.6** | 0.4 s / 18 s | $2.32 |
| Premium | corti-s1-mini-instant | 93% | 12.5 | 0.8 s / 30 s | $1.08 |
| Standard | **GPT-OSS 20B** (today) | 99% | 10.4 | 2.2 s / **3.4 s** | **$0.10** |
| Standard | corti-s1-mini-instant | 90% | 11.8 | 0.7 s / 27 s | $0.98 |
| Standard | corti-s1-tiny-instant | 96% | 12.4 | 7.0 s / 21 s | unpriced |
| Standard | corti-s1-mini (reasoning) | — | — | **98 s to first token for a two-sentence answer** | — |

Quality = medical accuracy + teaching quality + fit to persona/length/format, each 1–5.

What went wrong, by model:

- **Claude Haiku 4.5 ignored the length gate** on most sheets (a "Concise" student sheet arriving
  as a full Detailed reference page), and its card decks came back **without the `FLASHCARDS`
  header and without `Q:` prefixes — the app's parser reads those as 0 cards** (3 of 3 decks).
- **GPT-OSS 20B** followed the format best but was the least accurate on sheets (2.3/5 accuracy):
  "insulin first, then fluids" in DKA, "deliver at 34 weeks" for preeclampsia without severe
  features, "peaked T waves in digoxin toxicity".
- **Corti models** made fewer medical errors, but dropped the `FLASHCARDS` header (mini/tiny),
  invented card tags, echoed the prompt's rule text after the last card, followed off-topic
  retrieved passages (lidocaine cards in a beta-blocker deck), and occasionally overran or collapsed
  the length gate.
- **corti-s1-mini** (reasoning) is unusable interactively: it spent 5,400 hidden reasoning tokens
  and 98 s before emitting a two-sentence enhance. Dropped after the smoke test.

### Phase 2 — prompts adjusted for Corti

`_shared/medical-notes-prompts-corti.ts` makes targeted edits, not a rewrite: the card format block
becomes rules → literal example → explicit first/last line; a final checklist with the concrete
counts for the requested length is appended to sheets; word/sentence counts are restated for
enhance. It also fixes a bug in the current cards prompt, which tells a card deck to "fill every
field of the JSON output below… never truncate the sheet".

| Arm | Contract checks (orig → tuned) | Quality /15 (orig → tuned) | Cards | Sheets |
|---|---|---|---|---|
| corti-s1-instant (premium) | 97% → **99%** | 11.9 → **13.4** | 12.0 → 14.0 | 11.9 → 13.1 |
| corti-s1-mini-instant (premium) | 93% → 98% | 11.9 → 13.0 | 11.7 → 14.0 | 12.0 → 12.6 |
| corti-s1-mini-instant (standard) | 90% → 98% | 11.0 → **13.1** | 10.3 → 14.0 | 11.3 → 12.7 |
| corti-s1-tiny-instant (standard) | 96% → 99% | 11.8 → 12.0 | 9.7 → 12.3 | 12.7 → 11.9 |

Phase 2 re-ran and re-judged sheets and card decks (enhance was re-run and contract-scored only;
explain prompts were unchanged), so the quality columns cover those 10 cases, and "orig" is each
model's Phase 1 output on the same cases. For comparison, Haiku scored 9.6 and GPT-OSS 8.4 on the
same 10.

Card-deck contract compliance for the three arms that were failing it (48%, 29%, 67%) went to 100%. Tuning helps cards on
every model; on sheets it helps s1-instant and mini-instant but not tiny-instant.

### Phase 3 — end to end in the browser

Local dev client with `VITE_MEDICAL_NOTES_FN=medical-notes-corti`, driven by Playwright as a real
anonymous visitor (`scripts/notes-eval/e2e-*.mjs`, screenshots in `out/e2e/`):

| Surface | Route → model | Result |
|---|---|---|
| Sheet (DKA, clinician) | premium hook → corti-s1-instant | Streamed section by section, 6 grounded sources with book/chapter labels, reference note, citations; ~32 s |
| Sheet (hyperkalemia, student) | premium hook → corti-s1-instant | Rendered; ~26 s |
| Sheet (IDA) | standard → corti-s1-mini-instant | Rendered; ~56 s |
| Expand / Clinical tie | standard → corti-s1-mini-instant | Inline results rendered |
| Flashcards (beta blockers, 12) | standard → corti-s1-mini-instant | 12/12 cards parsed and saved, grounding tags shown |
| Explain this card | standard → corti-s1-mini-instant | All three sections rendered; ~9 s |

### Things this found in production, independent of Corti

1. **Premium flashcard decks can come back empty today.** Haiku omits the `FLASHCARDS` header and
   `Q:` prefixes; `parseFlashcardsFromOutput` returns `[]` without the header. New free/anon users
   get their premium-hook generations on Haiku. Worth fixing now: make the parser tolerate a missing
   header and missing `Q:` when `A:` lines are present.
2. **The cards prompt contradicts itself**: the shared grounding block tells a card deck to fill a
   JSON sheet.
3. **Grounding silently fails under concurrent load.** With 5 generations in flight, identical
   queries returned 0 chunks on one call and 6 on the next; run one at a time, every query retrieved.
   Retrieval is fail-open, so users just get an ungrounded sheet with no signal. Check the
   `retrieval_failed` logs.
4. **Haiku ignores the length gate** on most sheets (5 of 7 over on exam traps).
5. `src/lib/qbank-prompt-identity.test.ts` fails on Windows checkouts (`core.autocrlf=true` gives
   the prompt CRLF line endings). Pre-existing; unrelated to this branch.

### Caveats

- 19 cases, one sample each at temperature 0.7 — directionally strong, not statistically tight.
- The quality judge is a Claude model, blind to arm labels; it shares a family with the Haiku
  baseline. In Phase 2 the "original" outputs were ones the judge had already read in Phase 1, so
  that comparison was not fully blind. Read the side-by-sides in `out/phase1/judge/*.md` yourself
  before deciding.
- `corti-s1-tiny*` are listed by the API but absent from Corti's docs and price list.

## 5. Recommendation and migration plan

1. **Fix the flashcard parser now** (finding 1), whatever is decided about providers.
2. **Move the premium route to corti-s1-instant with the tuned prompts.** Better quality, faster,
   same cost. Low risk.
3. **Decide the standard route on cost**, since quality favours Corti either way:
   - (a) keep GPT-OSS 20B — cheapest and fastest by far, weakest medically;
   - (b) corti-s1-mini-instant — ~10× cost, ~8× slower sheets, clearly better;
   - (c) ask Corti for tiny-instant pricing and SLA — it was competitive on sheets, but slow to first
     token (~7 s) and undocumented.
4. **Rollout**: fold the Corti path into `medical-notes` behind `AI_PROVIDER=openrouter|corti` plus
   the per-route model env vars (`CORTI_NOTES_PREMIUM_MODEL` / `CORTI_NOTES_STANDARD_MODEL`). Switch
   `medical-notes` to import `_shared/medical-notes-prompts.ts` so there is one copy of the prompts
   (`check-prompts.ts` guards drift until then). Start with the premium route, watch `X-Model-Used`,
   parse-failure and empty-deck rates, and the Corti non-2xx rate — there is no provider fallback
   the way OpenRouter has one.
5. **Leave alone**: embeddings and retrieval (Corti's embedder is fixed at 2560-d against a 1536-d
   corpus), the source-label side call, `rag-generate` (unused), and QBank (already on Corti).
6. **Clean up the spike** when done: delete the `medical-notes-corti` function and remove the
   harness user from `EVAL_USER_IDS`; or keep both as a standing eval rig.

## 6. Round 3 — confirming the shipped configuration

Run: `scripts/notes-eval/out/round3/` (31 cases, 3 samples on the main arms; `corti-s1` 1 sample,
120 s timeout). Blind judging on sample 1, in three sets: premium sheets and decks, explain across all
five arms, and standard sheets and decks. Scores are accuracy + teaching + fit, out of 15.

| Arm | Contract checks | Median first text | Median sheet | Judged |
|---|---|---|---|---|
| corti-s1-instant, tuned, temp 0.3 | 99.8% | 0.37 s | 17.4 s | **13.7** (explain 14.4) |
| corti-s1-instant, tuned, temp 0.7 | 99.8% | 0.43 s | 20.5 s | 13.3 (explain 14.2) |
| corti-s1 (reasoning), tuned | 94% | 33 s on sheets, 3.1 s on explain | 49 s | explain 13.8 |
| gpt-oss-20b, tuned prompts | 99.3% | 2.7 s | 3.8 s | **11.6** (cards 13.0) |
| gpt-oss-20b, original prompts | 99.1% | 2.3 s | 3.5 s | 10.8 (cards 11.5) |

Decisions, now in `_shared/medical-notes-handler.ts`:

- **Corti at temperature 0.3.** Better in 14 of 18 head-to-heads, fewer factual slips (0.7 produced
  the "factor X longest half-life", "low C3 → IgA" and hydralazine q4–6h errors), and 3 s faster
  on sheets.
- **No `corti-s1` reasoning anywhere.** It lost to s1-instant even on explain, the only mode where it
  came close to the ~3 s latency bar. On sheets and decks it timed out twice, truncated once, and
  returned one empty deck.
- **GPT-OSS gets the tuned prompts too.** Quality is up (clearly on decks), coverage-honesty failures
  dropped from 7 to 4, and the cost is about 0.3 s per sheet. `NOTES_PROMPTS=original` reverts both tiers.
- GPT-OSS is still well behind Corti on medical accuracy: preeclampsia dosing, nephritic complement,
  IDA and SIADH sheets had real errors in both prompt sets. That gap is the tier difference.
