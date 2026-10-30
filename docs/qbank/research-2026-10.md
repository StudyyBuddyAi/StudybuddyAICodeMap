# QBank research — how it works, what the data says, and the options (2026-10-30)

Branch: `qbank-research` (cut from `origin/main` 68422d0). This is the reference for any QBank
work: read it before changing the generator, the gate, the session engine or the QBank pages.
Decisions the owner made are in §5; what was built off the back of it is in §6.

Companion docs in this folder:
- `shared-pool-design.md` — design for the shared question pool (decided: build it).
- `baseline-queries.sql` — the read-only SQL behind every number in §2, so they can be re-run.

---

## 1. How the QBank works today

Every set is written on demand. There is no browsable bank any more: the 120 curated rows
(three systems) are still in `questions` but nothing in the UI reaches them.

```
QBank.tsx ──startGeneratedSession──▶ QBankContext ──runQbankGeneration (waves of 5)──▶ qbank-generate
                                                                                          │
   router (corti-s1-instant, 13 systems, fails open to cardiovascular)  ◀─────────────────┤
   buildBatchPlan: reasoning order (1st/2nd/3rd) + answer letter per item, in code        │
   writer (corti-s1-instant, v14 prompt: step1 | step2ck | mixed), streamed JSON          │
   per item as it closes: prepareBatch (parse → permute key → QA gate)                    │
                          verifyOne (blind cold answer, same model, temp 0)               │
                          persistOne → questions row, is_active=false, origin='generated' │
                          __meta.questionReady frame                                      ▼
QBankContext ◀── claim_generated_questions(session, generationId) — skips qaBlocked / disputed rows
QBankSession (tutor | timed) ── submit_answer / record_timed_answer ── end_qbank_session ── QBankSummary
```

Key files:

| Piece | File |
|---|---|
| Edge function (one wave) | `supabase/functions/qbank-generate/index.ts` |
| Prompts, briefs, batch plan, letter permutation | `supabase/functions/_shared/qbank-prompt.ts` |
| Machine QA gate (14 rules + batch duplicate checks) | `supabase/functions/_shared/qbank-qa.ts` |
| Blind second read | `supabase/functions/_shared/qbank-verify.ts` |
| Parse + persist | `supabase/functions/_shared/qbank-persist.ts` |
| Corti client, model choices | `supabase/functions/_shared/corti.ts` |
| Wave loop (client) | `src/lib/qbank-wave-runner.ts` |
| Session engine | `src/contexts/QBankContext.tsx`, `src/lib/qbank-session-state.ts` |
| Pages | `src/pages/QBank.tsx`, `QBankSession.tsx`, `QBankSummary.tsx` |
| Grading / review / claim RPCs | `supabase/migrations/2026070812*`, `20260908*`, `20260909*`, `2026091[2-7]*` |
| Measurement harness (Corti, no writes) | `scripts/qbank-eval/run.ts`, `analyze.ts`, `regate.ts` |

What is solid: server-side grading (the key never ships before grading), crash-safe
reconciliation by `generationId`, flat answer-key positions (a–e ≈190 each), streaming first item
in ~20 s, resume across devices.

## 2. What the live data said (2026-10-30)

Small samples, few users, one heavy test account. Read as direction, not proof.

| Signal | Value |
|---|---|
| Generated items | 955 — v13.1 Step 1 128, v14 Step 1 486, v14 Step 2 CK 341 (curated: 120 active) |
| QA-blocked / verifier-disputed | 3.2% / 9.1% overall |
| Step 2 CK only: blocked / disputed / writer-flagged | 6.2% / 13.2% / 24.9% |
| Step 1 (v14): blocked / disputed / writer-flagged | 1.9% / 7.6% / 6.8% |
| Writer-flagged items that still reached students | 63 Step 2 CK + 30 Step 1 — mostly "guideline from memory, unconfirmed" |
| Model difficulty label vs order | 3rd→Hard 96%, 2nd→Medium 87%, 1st→Easy 59% (label ≈ restated order) |
| Accuracy by label (all users) | Easy 41%, Medium 47%, Hard 57% — inverted |
| Real students (heaviest account excluded, ≥20 s on item) | Step 1 56.7% (n=60, 8 users, 126 s), Step 2 CK 58.0% (n=69, 6 users, 111 s) |
| Click-throughs (<20 s) | 59 of 119 non-dev Step 1 attempts, 13.6% correct, 4 s avg |
| Sessions | 116 sets, 25 users, avg size 4.7 Q, timed 5/116, 37 left active |
| Marks | 29 marks by 9 users — nothing reads them after the summary |
| Gate findings, most frequent | stem-key-cueing 151 (warn), writer-flagged 119, over-bolding 66, key-longest 18 |
| Writer asked for an image | 9 items (ECG 4, histology 4) — nothing renders one |
| Generators | 22 free accounts, 5 Pro; top account wrote 363 items |

Sample writer flags that reached students: SGLT2i in HFpEF trial names; AASLD HBV surveillance
interval and 200,000 IU/mL tenofovir threshold; ICD criteria "against the 2025 guideline text";
empiric prosthetic-valve endocarditis regimen; dobutamine vs milrinone in cardiogenic shock.
Several flags said outright "CRITICAL: correctOption is wrong" or "options a and b are identical";
those were caught only because another rule (duplicate-option, distractor-explains-key) also fired.

Grounding corpus (`guideline_chunks`, used by sheets): Harrison's 21e, Nelson 22e, Pathoma 2023 and
two system bundles. The ingested filenames carry download-site prefixes. Using that corpus to write
questions for a paid product, or citing it to students, is a licensing exposure, and for Step 2 CK
guideline thresholds it is also dated.

## 3. Problems, ranked

1. **Writer-doubted items ship silently.** `writer-flagged` is a warn (`qbank-qa.ts`
   `checkReviewerFlag`), so a self-declared "guideline from memory, unconfirmed" — and even
   "CRITICAL: correctOption is wrong" — does not stop an item.
2. **The verifier is not independent.** Same model as the writer (`corti.ts` says so itself). A
   disagreement usually carries no reason, and the item is discarded rather than repaired.
3. **Difficulty labels carry no information**, and an item is answered once by its author, so an
   empirical difficulty can never accumulate while every item is private.
4. **Nothing happens after a miss.** No retry of incorrects, marks unused, no route to cards or the
   sheet, no way to report a bad item. Every set is disposable.
5. **Items run long** — ~2 min per item against a 90 s pace; Step 2 CK stems are 12–16 sentences.
6. **No generation cap.** The `qbank_generate` usage kind exists (migration `20260911000000`) but
   `qbank-generate` never consumes it.
7. **No images** — the prompt forbids image-dependent stems, so ECG/smear/histology/imaging
   recognition is untested.
8. **Housekeeping.** UI says held-back items were "rewritten" (they are replaced by a different
   item); the prompt claims every item is "reviewed by a medical student" (untrue on demand);
   `qbank-prompt-identity.test.ts` fails on a Windows checkout because `core.autocrlf` gives the
   fixture CRLF while template literals normalise to LF.

## 4. Options

Effort: S ≈ a day or less, M ≈ several days, L ≈ a week or more.

### A. Medical content safety
- **A1 (S) Act on writer flags.** Block critical self-reports (wrong key, duplicate options,
  "regenerate"); run a focused fact-check call on "from memory / unconfirmed" flags and hold the
  item back unless the check confirms the keyed answer.
- **A2 (S–M) Repair, don't discard; diversify the verifier.** Add `corti-s1-mini-instant` as a
  second blind probe (ensemble, as QUEST-AI did), and send disputed items to a non-blind critic that
  can fix the key or the stem.
- **A3 (L) Ground Step 2 CK in guidelines.** Inject retrieved guideline text, store and show the
  source. Needs a licensed corpus (USPSTF/CDC/NIH are public domain) and ideally moving embeddings
  from OpenRouter to `corti-s1-embedding` (2560-d, re-embed).
- **A4 (S + eval) Prompt refresh.** USMLE nutrition enhancement (June 2026), drop the false review
  claim, cap Step 2 CK stem length toward a 90 s pace. Changing the Step 1 prompt means updating the
  identity fixture, bumping `PROMPT_VERSION`, and re-running `scripts/qbank-eval`.
- **A5 (L) Images.** CC-BY/public-domain library with a per-image licence log; image-first item
  writing.

### B. Learning features
- **B1 (M) Retry misses and marks, spaced.** `start_qbank_session`'s explicit-ids branch already
  admits a student's own inactive rows.
- **B2 (S–M) Miss → flashcard** from the teaching point, into the FSRS deck.
- **B3 (S) "Why I missed it" + confidence tap.** Metacognition; modest evidence.
- **B4 (M) Analytics by system × discipline × competency**, with a one-tap targeted set.
- **B5 (M) "Ask about this question" tutor**, grounded on the item's own explanation (UWorld UAsk
  and AMBOSS AI Mode shipped this in 2026).
- **B6 (L) Shared question pool** — clean items promoted into a bank everyone draws from: real
  p-values, answer-choice distributions, instant sets, lower cost. See `shared-pool-design.md`.

### C. UX
- **C1 (S) "Exam block" preset** — 20 Q, timed, 30 min: the USMLE block format since May 2026.
- **C2 (S) Report-a-problem** on every graded item — the first human loop.
- **C3 (S) Free generation cap.**
- **C4 (S) Honest "replaced" copy; drop the model difficulty label** from what students see.

## 5. Decisions (owner, 2026-10-30)

- **Shared pool: yes**, "with all the bells and whistles", fitted to the current implementation
  and usage. Design in `shared-pool-design.md`.
- **Free cap: 10 questions per day.** Counts *delivered* questions only — items the gate or the
  verifier hold back, and retries of questions the student already has, are free. Pro unlimited.
  QBank stays sign-in only (anon cannot generate).
- **AI tutor (B5): available to free users too.** The cap is the only free/Pro difference for the
  QBank.
- **Exam block for free users: a 10-question, 15-minute half block** at the same 90 s pace; Pro gets
  the full 20 / 30 min.
- Build and test locally; ask before applying migrations or deploying. Commit to `qbank-research`
  per feature, no push.

## 6. Sequencing

- **Now:** A1, C2, B1, C1, C3 (10/day), C4, CRLF fix. Status of each: see the commit log on
  `qbank-research` and the "Built" section appended below.
- **Next (1–2 weeks):** A2, B2, B4, A4 with an eval run compared against §2.
- **Later:** B6 shared pool (designed), A3 (licensed corpus first), B5 tutor, A5 images.

## 7. Sources

- LLM-generated USMLE/COMLEX-style practice items: 49% item-writing flaws, 22% factual/conceptual
  errors — Adv Physiol Educ 2025:
  https://researchdiscovery.drexel.edu/esploro/outputs/journalArticle/LLM-Generated-Multiple-Choice-Practice-Quizzes-for/991022059818004721
- QUEST-AI (generate → ensemble-flag → refine, Step 2 CK), PSB 2025:
  https://psb.stanford.edu/psb-online/proceedings/psb25/bedi.pdf · preprint:
  https://www.medrxiv.org/content/10.1101/2023.04.25.23288588v2.full
- MCQG-SRefine (self-critique and correction for USMLE-style MCQs): https://arxiv.org/pdf/2410.13191v4
- NUS TAPS commentary on hidden pitfalls in AI MCQs: https://medicine.nus.edu.sg/taps/?p=73257
- USMLE 30-minute, 20-item blocks from May 2026:
  https://usmle.org/test-delivery-software-updates-step-2-ck-and-step-1-coming-may-2026
- USMLE nutrition enhancement, June 2026:
  https://www.usmle.org/enhancements-nutrition-content-usmle-step-exams-coming-june-2026
- UWorld UAsk: https://newsroom.uworld.com/story/ai-powered-learning-tool-mcat-usmle-test-prep/
- AMBOSS AI Mode (vendor-adjacent blog): https://www.iatrox.com/blog/amboss-ai-mode-learning-three-months-on
- Practice questions and spaced repetition vs Step 1 (associational): https://pmc.ncbi.nlm.nih.gov/articles/PMC4673073
- Certainty-based marking: https://impressions.manipal.edu/open-access-archive/11604
- Open medical image licensing: https://libguides.uams.edu/open-access-medical-images/creative-commons

---

## 8. Built on `qbank-research` (2026-10-30) — not yet deployed

| Item | What shipped | Key files | Tested by |
|---|---|---|---|
| A1 writer flags | `writer-critical` gate block; non-blind fact check (`checkWriterFlag`) on every flagged item still in play, fails closed, verdict stored as `generation_meta.flagCheck` | `_shared/qbank-qa.ts`, `_shared/qbank-verify.ts`, `qbank-generate/index.ts`, `scripts/qbank-eval/run.ts` | unit tests; live Corti on 12 real flagged items (12 confirmed) and a wrong-key control (12/12 `wrong_key`) |
| C3 free cap | 10 delivered questions/day, Pro unlimited; `reserve_usage`/`release_usage`; client picker sized to what is left; capped run ends "short" with a Go Pro offer | `20261030000000_qbank_free_daily_cap.sql`, `_shared/qbank-allowance.ts`, `use-usage-limit.ts`, `qbank-wave-runner.ts`, `QBank.tsx`, `QBankSession.tsx` | SQL rehearsal on live (rolled back); runner tests; offline handler test |
| C1 exam block | preset: 20 Q · timed · 30 min (free: 10 Q · 15 min) | `_shared/qbank-allowance.ts`, `QBank.tsx` | unit tests |
| C2 report a problem | `question_reports` + `report_question` (served-only, one per student per question); link + dialog under every explanation | `20261030000100_question_reports.sql`, `components/qbank/ReportQuestion.tsx` | SQL rehearsal (RLS, refusals, upsert); component tests |
| B1 review queue | `get_qbank_review_queue`: misses due after 20 h, marks at once, reported/unreachable excluded; QBank card, summary note, Dashboard plan item; re-sits labelled `Review`, free under the cap; Library ignores review sets | `20261030000200_qbank_review_queue.sql`, `lib/qbank-review-queue.ts`, `hooks/use-qbank-review-queue.ts`, `QBankContext.tsx` | SQL rehearsal with 8 seeded cases; unit tests |
| C4 honesty | "replaced" not "rewritten"; model difficulty label removed from view; summary by discipline | `QBankSession.tsx`, `QBankSummary.tsx`, `AnswerReview.tsx` | typecheck, tests |
| Fix | dispatch stops at the wave's plan (over-production could exceed the cap and collide indices) | `qbank-generate/index.ts` | `scripts/qbank-edge-test` (23 checks) |
| Housekeeping | `.gitattributes` keeps the prompt fixture LF; `src/types/edge-runtime.d.ts` types `Deno.env` for shared modules under test | | identity test passes on Windows; typecheck clean |

Run the offline handler test any time:
`node --import ./scripts/qbank-edge-test/loader.mjs scripts/qbank-edge-test/edge-test.mjs`

### Deploy order (needs the owner's go-ahead)

1. `npx supabase db push --linked` — applies exactly the three `20261030*` migrations (dry run
   confirmed). `20261030000200` depends on `20261030000100`.
2. Frontend (merge to `main` → Vercel), so clients understand `daily_cap` before it is enforced.
3. `npx supabase functions deploy qbank-generate`. It fails closed without `reserve_usage`, so never
   before step 1. No new environment variables.
4. Re-run `baseline-queries.sql` after a week and compare with §2: writer-flagged items admitted
   (should fall to near zero unconfirmed), held-back rate, report rate, review-queue use.
