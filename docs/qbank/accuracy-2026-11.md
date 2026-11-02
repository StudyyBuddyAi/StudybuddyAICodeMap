# QBank accuracy — where faulty items get through, and the checks that stop them (2026-11)

Branch: `qbank-accuracy-gate`, cut from `qbank-repetition-study` (d09d1c4) so it carries the live
qbank-generate v11. Companion to `research-2026-10.md` (how the generator works) and
`repetition-study-2026-11.md`.

The goal: keep improving the generated questions, and never send a faulty one to a student.

---

## 1. How an item is checked today

Every item is written on demand and passes three checks before a student can see it:

| Check | File | Holds an item back when |
|---|---|---|
| Machine QA gate (14 rules + batch checks) | `_shared/qbank-qa.ts` | a `block` rule fires |
| Blind probe (answers without the key, temp 0, same model as the writer) | `_shared/qbank-verify.ts` `verifyOne` | its answer differs from the key |
| Writer-flag fact check (not blind) | `_shared/qbank-verify.ts` `checkWriterFlag` | the writer doubted the item and the check does not confirm the key |

`claim_generated_questions` serves only rows with `qaBlocked = false` and `verification.agreed`
not false. The full explanation (`qbank-explain`) is written later, after the student answers.

## 2. What the live table showed (2026-11-02)

1,302 generated items, 906 served, 569 answered (1.08 attempts per item).

- **The filter works.** No item the gate blocked or the probe disputed was ever served.
- **A stratified sample of 37 served items was read by hand:**
  - All 5 items where the probe agreed with the key but named a problem: 4 were faulty.
    - `0b653d2f`: qSOFA logic the stem does not meet.
    - `ff70e057`: two defensible answers (anthracycline vs trastuzumab).
    - `0b0ab96b`: "inadequate dietary iron" keyed for menorrhagia.
    - `57d851d9`: duplicate Charcot-Bouchard options.
  - The other 32 had no wrong keys, and about 4 had minor stem or explanation errors. One example is an echo with E/A 0.7 labelled grade 2.
- **Ammonia written in μmol/dL in 7 served items:** a hundredfold error the writer repeats.
- **40 served items lack at least one distractor explanation.** Most are from the v13.1 era; v14 runs at about 1.5%.
- **The writer-flag check confirmed 80 of 82 flagged items.** The 10 flagged Step 2 CK items in the sample were all correct, so the flags are mostly over-caution. But the check is the same model, shown the writer's own explanation, so it adds little independent evidence.
- **qbank-explain disputed 0 of 56.** Its prompt states the key is correct, and a dispute held only the explanation, never the item.
- **Student signal is nearly absent:** one report ever, and items are answered about once each.

The sample was read by Claude, a model independent of the Corti writer, not by a physician.
Treat the verdicts as provisional until a clinician confirms them.

## 3. Weak points, ranked

1. The probe's `solvable` and `issue` fields were stored but never gated anything.
2. Every check runs on `corti-s1-instant`, so the writer's blind spots are shared by its checkers.
3. No check reads the stem's own data: units, plausible values, internal consistency.
4. `duplicate-option` matches identical wording only, not synonyms.
5. Step 2 CK guidelines come from the model's memory, and some answers are dated.
6. Nothing measures accuracy. `scripts/qbank-eval` measures how often checks fire, not what they catch.
7. Later signals do not act. A report or an explanation dispute left the question in the review queue and in card decks.
8. A set's first question opens the session through `start_qbank_session`'s explicit-ids branch, which checked nothing. Only the browser filtered it.

## 4. Plan

1. **Gate fixes.** Built (§5).
2. **Accuracy test suite.** Built (§6.1).
   - A gold set of items with reviewer verdicts: 86 so far, aiming for about 150, starting from the 37 above.
   - A fault-injection set: a moved key, a near-duplicate option, a wrong unit, a removed deciding finding.
   - Both report each check's catch rate and false-hold rate, and run on every prompt or gate change plus a weekly live sample.
3. **Independence.** Measured, and the winners built (§6.2).
   - Probe self-consistency (3 samples, the key winning at least 2): measured, rejected.
   - A second Corti model: built.
   - A blind-first flag check: replaced by an ambiguity review that knows the key, which measured better.
4. **Human loop.** Built (§6.3), except item statistics.
   - A review queue for every item with a red signal.
   - Verdicts feed the gold set.
   - Item statistics (p-value, discrimination) and vetted-first serving wait on the shared pool; items are answered about once each today.

## 5. Step 1 — built on `qbank-accuracy-gate`

| Item | What changed | Files |
|---|---|---|
| Probe objection blocks | `probeConcern`: an agreed probe that says the item is unsolvable or names an issue holds the item back as `probe-concern`, before the flag check. "No issues." variants read as clean (`probeIssue`). | `_shared/qbank-verify.ts`, `qbank-generate/index.ts`, `scripts/qbank-eval/run.ts` |
| Lab values | `lab-unit` blocks molar or equivalent units per dL, and analytes in a unit they are never reported in. `lab-implausible` blocks values outside survivable extremes. Covers 13 analytes. Values are read only straight after their analyte. Other fluids keep only the unit check. Salts, doses and changes are skipped. | `_shared/qbank-qa.ts` |
| Distractor explanations | `missing-distractor-explanation` is now a block. A student who picked that option was told nothing. | `_shared/qbank-qa.ts` |
| Withdrawing a served question | `generation_meta.held`, set by the service-role `hold_generated_question`. The review queue skips held items. `start_qbank_session` refuses them by either branch. qbank-explain answers "held" for them. Card decks built from answered sets leave them out. | `20261103000000_qbank_held_questions.sql`, `qbank-explain/index.ts`, `_shared/medical-notes-handler.ts` |
| Explanation dispute | When qbank-explain disputes a key, it now also holds the question. | `qbank-explain/index.ts` |
| First question filtered on the server | `start_qbank_session`'s explicit-ids branch applies claim's filter: not `qaBlocked`, not disputed, not held. | same migration |
| Labels | Student-facing names for the three new rules. | `src/lib/qbank-rule-labels.ts` |

### Measured

- **Lab check, live table:** the 7 ammonia errors found, no false positives across all 1,302 items. One "glucose rises by 3 mg/dL" false positive appeared in testing and was fixed.
- **Lab check, fault injection on v14 items:** 349 of 350 planted errors caught. The planted errors scaled potassium, sodium and hemoglobin, and swapped units for creatinine, glucose and mmol/L. The one miss was a urine potassium, which is skipped on purpose.
- **New holds, v14 items replayed:** 1,174 items replayed. 7 lab-unit and 19 missing-distractor items; 3 of those were already blocked, so 23 are new holds. That is about 2% of items, each replaced by a later wave. `probe-concern` adds about 1% (12 issues in 1,302).
- **Migration rehearsed on live inside a rolled-back transaction:**
  - Explicit ids: blocked, disputed and held items refused; clean items served.
  - Curated sampling unaffected.
  - Students denied the hold function.
  - Review queue drops an item once held; the first hold's reason is kept.
  - Nothing left behind.
- **Clean-up rehearsed the same way:** 4 held, 7 corrected with an edit record, a second run a no-op.
- **Tests:**
  - `qbank-qa.test.ts` and `qbank-verify.test.ts`: 64 tests.
  - `scripts/qbank-edge-test`: 74 checks, including a new probe-objection case.
  - Full suite: 1,001 tests.
  - Typecheck and lint are clean.

## 6. Steps 2–4 — built on `qbank-accuracy-gate`

### 6.1 The accuracy suite (`scripts/qbank-accuracy`)

| File | What it is |
|---|---|
| `labels.json` | Reviewer verdicts by question id: `ok`, `minor` (servable, small flaw) or `fatal` (must not be served), with a fault tag and a note. 86 so far (25 fatal, 55 ok, 6 minor), all by Claude on 2026-11-02, `clinicianConfirmed: false`. |
| `gold.json` | The judged items as they were judged. `snapshot.mts` fetches new labels from live and keeps existing snapshots, so a later live edit never changes what a verdict was about. |
| `mutants.json` | 226 faults planted in the 55 sound items. Six are text edits: mislabelled key, lab unit, lab value, exact duplicate option, self-correcting explanation, missing explanation. Four are written by Corti: paraphrased key, second correct option, removed deciding finding, flipped finding. Made by `mutate.mts`, kept so reruns replay the same set. |
| `run.mts` | Runs every check and pipeline over both sets. Corti calls are cached in `out/cache`, so a rerun after a rule change costs nothing and an interrupted run resumes. Writes `out/report.md`. |
| `candidates.mts` | Checks measured but not wired in (key consistency). |
| `review-queue.mts`, `apply-verdicts.mts` | The human loop (§6.3). |

```
node scripts/qbank-accuracy/snapshot.mts     # after adding labels
node scripts/qbank-accuracy/mutate.mts       # only to rebuild the planted set (Corti)
node scripts/qbank-accuracy/run.mts          # the measurement; ~2,500 Corti calls cold, free warm
```

**When to run it:** on every change to the writer prompt, the gate or a check, and on each batch of new labels.

**Caveats:**
- The gold fatal items lean towards what the checks already caught: 20 of the 25 were picked because a check had fired.
- Some Corti-written planted faults are not real. One "second correct option" was "efferent arteriole via norepinephrine". So the catch rates for second-correct and remove-finding are lower bounds; the six text-edit types are exact.

### 6.2 What it measured, and what was built

| Pipeline | Faulty gold held | Planted faults held | Sound gold held |
|---|---|---|---|
| Live until step 1 | 20/25 (80%) | 99/226 (44%) | 2/55 (4%) |
| Step 1 (gate, probe concern, text rules below) | 23/25 (92%) | 188/226 (83%) | 3/55 (5%) |
| + second blind read (`-mini-instant`) | 24/25 (96%) | 190/226 (84%) | 3/55 (5%) |
| **+ ambiguity review (`-instant`) — this branch** | **24/25 (96%)** | **195/226 (86%)** | **3/55 (5%)** |
| Probe as 3-read majority instead (rejected) | 21/25 (84%) | 189/226 (84%) | 4/55 (7%) |
| Ambiguity review on `-mini-instant` (rejected) | 24/25 (96%) | 193/226 (85%) | 8/55 (15%) |
| Key-consistency check added (not wired in) | 24/25 (96%) | 190/226 (84%) | 3–4/55 |

Of the 3 sound items held, one is missing three distractor explanations, a real defect for a student. The true waste is about 2 in 55.

**By planted fault, this branch:**
- Caught every time: mislabelled key, lab unit, lab value, duplicate option, self-correcting explanation, missing explanation.
- Paraphrased key: 23/25.
- Flipped finding: 22/25.
- Second correct option: 14/25.
- Removed finding: 10/25.

The last two are the open gap, and they are also where the planted faults are least reliable.

**Built from the measurements:**

| Item | What changed | Files |
|---|---|---|
| Second blind read | `corti-s1-mini-instant` answers blind beside the first read, in parallel. Either read off the key holds the item. A read that fails open is covered by the other. On its own it held 0/55 sound items. `CORTI_SECOND_VERIFIER_MODEL=none` turns it off. Both reads are stored in `generation_meta.reads`. | `_shared/corti.ts`, `_shared/qbank-verify.ts` (`verifyTwice`, `combineReads`), `qbank-generate/index.ts`, `_shared/qbank-persist.ts` |
| Ambiguity review | A reviewer shown the key, asked only about a second defensible answer or missing deciding data. It blocks as `reviewer-ambiguity`, runs beside both reads, is skipped for gate-blocked items, and fails open. Stored in `generation_meta.ambiguity`. | `_shared/qbank-verify.ts` (`checkAmbiguity`), same files |
| Explanation text rules | `explanation-self-correction` ("Wait, correct answer is a. Let me fix."). `explanation-letter-reference` (letters move in the shuffle). A writer flag naming the "real" key letter is now `writer-critical`: all 4 such flags on the live table were on faulty items, one of them served. | `_shared/qbank-qa.ts` |
| Withdrawn notice | A reviewed set says "Withdrawn after review" on a held question. The graded payload carries `withdrawn`, never before grading. | migration (`qbank_question_payload`), `AnswerReview.tsx` |

**Found on the way:** two more faulty served items.
- `23bfc058`: the explanation argues a different option from its key, and its first blind read failed open.
- `d460612a`: copper IUD, with two defensible answers.

**Cost and load:**
- Each item now makes three short calls, all running together: two blind reads and the review. Before, it made one, plus the occasional flag check.
- That is roughly a 10–15% increase in a wave's Corti spend, with no added wait.
- Corti answered 429 at around 9 parallel calls in earlier work. Items close about 17 s apart, so a wave stays well under that.
- Watch `secondReadErrors` and `ambiguityErrors` in `wave_complete`.

**The flag check now adds nothing measurable.** Without it the scores are identical. It is kept because it is the only check aimed at outdated guidelines, and the gold set has no outdated items to measure it on. That is a gap for the next round of labels.

### 6.3 The human loop

- `review-queue.mts` (read-only) writes `out/review-<date>.md` to read and `out/review-<date>.json` to fill in. It covers:
  - open student reports
  - questions withdrawn automatically and not yet reviewed
  - served questions carrying a signal the gate now holds
  - a random spot check (`SAMPLE=10`)

  Anything already in `labels.json` is skipped.
- `apply-verdicts.mts <file>` always adds the verdicts to `labels.json`, so the gold set grows. With `--apply` it also writes to live:
  - withdraws each `fatal` item through `hold_generated_question`
  - stamps every judged item `generation_meta.review`, so the queue does not offer it again
  - closes its open reports: `accepted` when fatal, `rejected` when ok, untouched when minor

  `REVIEWER=` names the reviewer and `CLINICIAN=1` marks the verdicts as clinician-confirmed.
- **Suggested rhythm:** weekly, then `snapshot.mts` and `run.mts`.
- The gold set needs a clinician's pass before its numbers are quoted outside the team.

## 7. Deploy order (needs the owner's go-ahead)

1. `npx supabase db push --linked`. The dry run showed exactly `20261103000000_qbank_held_questions.sql`, which includes the `withdrawn` payload.
2. `npx supabase db query --linked -f docs/qbank/accuracy-cleanup-2026-11-02.sql`. It holds the 6 faulty served items (the 4 from §2 and the 2 from §6.2) and fixes the 7 ammonia units. Rehearsed on live with rollback: 6 held, 7 fixed, a second run a no-op.
3. Deploy the functions:
   - `npx supabase functions deploy qbank-generate`. It has no dependency on step 1. It needs no new environment variables; the second read is on by default.
   - `qbank-explain`, which calls the new RPC, so after step 1.
   - `medical-notes` and `medical-notes-next`, both of which import `medical-notes-handler`. The handler has not changed since #31 apart from the held filter; `corti.ts` gained two additive fields.
4. Frontend: the labels and the withdrawn notice. Ships with the branch's merge. Before step 1 the notice never shows, because nothing sets `withdrawn`.

**Rollback:**
- Redeploy the functions from `d09d1c4`.
- The migration can stay. Without the edge changes nothing sets `held`, and its filters only remove items.
- `CORTI_SECOND_VERIFIER_MODEL=none` drops the second read without a redeploy.

### After deploying

- Watch these in `wave_complete` in the qbank-generate logs: `probeConcerns`, `secondReadHolds`, `ambiguityHolds`, the matching `*Errors`, and `blocked`.
- **The delivered share will fall** by a few percent. Each hold is replaced by a later wave and is never charged to a free account.
- **After a week:**
  - Run `review-queue.mts` and judge the spot checks.
  - Re-run the audit queries: the served rows with a probe issue, a lab finding or a key-naming writer flag should all be 0.

## 8. Deployed 2026-11-02

The branch was rebased onto main `b92ca26` (#32 squash-merged, plus #30) before deploying, so what is live is what the PR holds.

| Piece | Before | Now |
|---|---|---|
| Migration | — | `20261103000000_qbank_held_questions.sql` applied |
| Clean-up | — | `accuracy-cleanup-2026-11-02.sql` run: 6 items withdrawn, 7 ammonia units fixed |
| `qbank-generate` | v11 | v12 |
| `qbank-explain` | v1 | v2 |
| `medical-notes` | v35 | v36 |
| `medical-notes-next` | v16 | v17 |

Function deploys used `--use-api`, since there is no Docker on this machine. No new environment variables; the second read is on by default.

**Checked on live after the migration:**
- `hold_generated_question` is executable by the service role only.
- Students can still start sessions and read their queue, but cannot call `qbank_question_payload`.
- All three filters are present.

**Live end-to-end check** (throwaway Pro account, deleted afterwards with nothing left behind): 24/24.
- A real Step 2 CK wave of 5 on "heart failure", in 57 s.
- Both blind reads stored on every row (the mini read answered every item), the ambiguity review stored, and the combined verdict consistent with the reads.
- The session admitted only the playable id; claim added the rest.
- qbank-explain v2 explained a question; after `hold_generated_question` it answered `held`.
- The review queue dropped the item, a re-sit by id was refused, and the reviewed set showed `withdrawn: true` on that item only.
- A student's call to the hold function got 403.
- This wave held nothing back, so the refusal of blocked and disputed items at session start was proven in the rolled-back rehearsal, not live.

**Not exercised live:** the held-question filter in the medical-notes deck source. The deck path's card writer may reach OpenRouter, which is off limits for testing. It is covered by typecheck and code review only.

**Rollback:** redeploy the four functions from `b92ca26`. The migration and the clean-up can stay. `CORTI_SECOND_VERIFIER_MODEL=none` drops the second read.

The frontend (labels, withdrawn notice) ships when the PR merges. The live payload's extra `withdrawn` field is ignored by the current frontend.
