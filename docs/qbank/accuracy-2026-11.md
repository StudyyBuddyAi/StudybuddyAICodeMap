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

1. **Gate fixes (built, §5).**
2. **Accuracy test suite.**
   - A gold set of about 150 items with reviewer verdicts, starting from the 37 above.
   - A fault-injection set: a moved key, a near-duplicate option, a wrong unit, a removed deciding finding.
   - Both report each check's catch rate and false-hold rate, and run on every prompt or gate change plus a weekly live sample.
   - Builds on `regate.ts`.
3. **Independence.**
   - Probe self-consistency: 3 samples, with the key winning at least 2.
   - A second Corti model.
   - A blind-first flag check.
   - Measured with step 2 before shipping.
4. **Human loop.**
   - A review queue for every item with a red signal.
   - Verdicts feed the gold set.
   - Once the shared pool exists, item statistics (p-value, discrimination) and vetted-first serving.

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

### Deploy order (needs the owner's go-ahead)

1. `npx supabase db push --linked`. The dry run shows exactly `20261103000000_qbank_held_questions.sql`.
2. `npx supabase db query --linked -f docs/qbank/accuracy-cleanup-2026-11-02.sql`. It holds the 4 faulty items and fixes the 7 ammonia units.
3. `npx supabase functions deploy qbank-generate`, then `qbank-explain`, then `medical-notes` and `medical-notes-next` (both import `medical-notes-handler`).
   - qbank-generate has no dependency on step 1.
   - qbank-explain calls the new RPC, so it goes after step 1.
   - The medical-notes handler has not changed since #31 apart from this filter. The only other shared change is an additive field in `corti.ts`.
4. Frontend: only the labels. It ships with the branch's merge and is harmless before or after the functions.

**Rollback:**
- Redeploy the functions from `d09d1c4`.
- The migration can stay. Without the edge changes nothing sets `held`, and its filters only remove items.

### After deploying

- Watch `wave_complete.probeConcerns` and `blocked` in the qbank-generate logs.
- After a week, re-run the audit queries: the served rows with a probe issue should be 0, and so should the served rows with a lab finding.
