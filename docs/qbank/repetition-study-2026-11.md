# QBank repetition study — why repeat sessions on a topic re-test the same facts (2026-11-01)

Branch: `qbank-repetition-study` (cut from `origin/main` 169d889). Study only: nothing in the app
was changed. The harness is in `scripts/qbank-repetition/` (§7). No OpenRouter calls; Corti only.

**The question.** A student who types the same topic in three separate 5-question sessions seems
to get the same facts tested again. Is that the prompt or the delivery system, and how should the
system learn from a student's earlier attempts so a concept is not repeated (or is repeated only
on purpose)?

**The short answer.** It is mainly delivery. Every new session on a topic sends the writer a
request that is identical apart from the batch-plan shuffle, and nothing about what the student has
already seen. The model's idea of "the highest-yield facets of warfarin" is stable, so it writes
the same five facts each time. In a controlled run, **67% of the questions in sessions 2–4
re-tested a concept from an earlier session** (warfarin: 20 questions covered 7 concepts). Raising
the temperature barely helps (51%). Telling the writer what the student has already seen brings it
to 12–21%, and assigning each question a concept from a per-topic concept map brings it to **8%
while staying 100% on-topic**. Live data shows the same problem in the wild: **33% of later-session
questions repeat a concept, and 35 of those 85 were concepts the student had already answered
correctly.**

---

## 1. Why it happens — the code path

- The only duplication guard is `avoidSubtopics` ([qbank-generate/index.ts:256-268](../../supabase/functions/qbank-generate/index.ts)).
  The client fills it from the previous waves *of the same set* ([qbank-wave-runner.ts:581](../../src/lib/qbank-wave-runner.ts),
  `covered`), and `alreadyCovered` is only passed when a set is *resumed* ([QBankContext.tsx:820](../../src/contexts/QBankContext.tsx)).
  A new set starts with an empty list. Nothing reads the student's earlier sets.
- Even within a set, the guard carries **subtopic labels** ("Digoxin toxicity potentiated by
  loop-diuretic-induced hypokalemia"), not the fact tested, so a label change gets past it.
- The user message asks the writer to "spread the questions across its highest-yield facets"
  ([qbank-prompt.ts:1535](../../supabase/functions/_shared/qbank-prompt.ts)). With no history, that
  instruction points every session at the same top five. The System Briefs do not name the
  recurring facts (no digoxin, protein C, osteocalcin, CYP2C9 or β-hydroxybutyrate in them), so the
  convergence is the model's own prior, not something the prompt spells out.
- Answer letters are not sent, and reasoning orders are shuffled per wave, so two sessions on one
  topic at one exam mode and level differ only in the order of "1st/2nd/3rd" in the plan rows.

## 2. Live evidence

Method: every student × topic with 2+ generated sets on the same normalised `requestedTopic`
(`scripts/qbank-repetition/live-repeat-items.sql`, read-only), junk topics dropped, only items the
student could play (not QA-blocked, not disputed). 22 groups, 10 students, 407 items. A judge
(corti-s1, blind to session) grouped items by the concept the correct answer turns on — "a student
who learned one item's explanation would answer the other with no new knowledge".

| | |
|---|---|
| Later-session items that repeat a concept from an earlier session | **85 / 254 = 33%** |
| …of which the student had already answered that concept correctly | **35** |
| Same, where an earlier session had the same exam mode + challenge level | 33% |
| Same, where every earlier session was a different mode or level | 21% |
| Distinct concepts in 407 items | 291 |
| Duplicates inside one set | 37 (≈24 from sets before the 2026-10-30 dispatch-past-plan fix) |

What it looks like (each row is one student):

- **warfarin**, 3 sessions: protein C / skin necrosis, osteocalcin embryopathy, CYP2C9, factor VII
  and VKOR, recycled; session 3 was 100% repeats.
- **heart failure**, 6 sessions: the digoxin + loop-diuretic hypokalemia vignette in all six; an
  SGLT2 inhibitor as the add-on in four; milrinone/PDE3 in three. The student answered the digoxin
  item correctly from session 2 onwards and kept getting it.
- **cardiomyopathy**, 6 sessions: HCM sudden death → ICD in four.
- **DKA**, 2 sessions: K⁺ shift, cerebral edema, β-hydroxybutyrate, counter-regulation in both.
- **asthma**: 4 of session 2's 5 items repeat session 1. **urea cycle**: OTC, CPS I and NAG in all three.

The judge is deliberately strict, so these are lower bounds. It counted "digoxin toxicity: why does
hypokalemia potentiate it" and "digoxin toxicity: what is the arrhythmia mechanism" as different
concepts. The student saw the same patient both times.

Side finding: repetition also surfaces contradictory keys. One student's two DKA sessions keyed
Kussmaul breathing to the central chemoreceptors and then the peripheral ones.

## 3. Controlled experiment

One simulated student typing the same topic four times (4 × 5 questions), through the production
path: router, `buildBatchPlan`, `buildUserMessage`, the v14 system prompt, `corti-s1-instant` at
0.7, `prepareBatch` (QA gate) and `verifyOne`. Nothing is written to the database. Each session's
plan (reasoning orders, letters) is seeded, so every arm gets the same plans. History arms see only
the items that were playable.

Topics: heart failure (Step 2 CK), diabetic ketoacidosis (Step 1), warfarin (Step 1); balanced level.

| Arm | What changes | Repeat rate, sessions 2–4 | Distinct concepts | Playable |
|---|---|---|---|---|
| **A** production | nothing | **26/39 = 67%** | 27 of 53 | 90% |
| **D** | temperature 1.0 | 22/43 = 51% | 34 of 57 | 95% |
| **B1** | earlier sets' subtopic labels through the existing avoid block (delivery only) | 8/39 = 21% | 46 of 54 | 90% |
| **B2** | earlier sets' facts (subtopic + teaching point) as "do not re-test", with a "different fact, not a new vignette" rule | 5/41 = 12% | 50 of 56 | 93% |
| **C** | a per-topic concept blueprint (corti-s1, cached); each plan row assigned an unused concept | **3/39 = 8%** | 50 of 54 | 92% |

Per topic under A: warfarin 86% (sessions 2/3/4: 80/80/100%), DKA 62%, heart failure 50% (25/50/75%).
A judge-free cross-check counts only near-identical answer keys, so it undercounts heavily, but it
gives the same order: A 18%, D 12%, B1 8%, C 3%, B2 0%.

**Quality cost.** A second blind pass rated every item's relevance to the requested topic and its yield:

| Arm | On-topic (all) | On-topic (sessions 3–4) | High-yield (sessions 3–4) | Low-yield (sessions 3–4) |
|---|---|---|---|---|
| A | 100% | 100% | 93% | 0% |
| D | 93% | 93% | 93% | 0% |
| B1 | 94% | 92% | 46% | 0% |
| B2 | 84% | **75%** | 54% | **11%** |
| C | 100% | **100%** | 69% | 0% |

Production repeats *because* it only ever reaches for the top handful of high-yield facts. A
history list stops the repeats, but once the core is used up and the writer has no list of what is
left, it wanders. B2's DKA sessions 3–4 drifted into generic insulin/glucagon signalling (PDE3B,
phosphorylase kinase, insulin-receptor tyrosine kinase) and CD8⁺ insulitis. The blueprint stays
on-topic and moves through the topic's own tiers: DKA session 4 was stress leukocytosis,
mucormycosis, amylase without pancreatitis, effective osmolality and hypertriglyceridemia. Its
later sessions are less high-yield because the core concepts are used up. That point is where
planned re-tests of core concepts belong (§5).

Blueprint sizes (corti-s1): heart failure 30 concepts (11 core), DKA 26 (10 core), warfarin 22 (7 core).
At 5 a session, a narrow topic runs out of new core material by session 2 and of new material
altogether by session 5–6.

## 4. Diagnosis

| Factor | Contribution | Evidence |
|---|---|---|
| No cross-session memory (delivery) | **Primary** | B1/B2/C cut repeats 67% → 8–21%; the code has no path from earlier sets into the prompt |
| Prompt asks for "highest-yield facets" with nothing to rotate them | Amplifier | Production is 96% high-yield *and* 67% repeat: it picks the same top-k every time |
| Sampling randomness | Minor | Temperature 1.0 only 67% → 51% |
| Within-set guard passes labels, not facts | Minor, within sets | B1 (labels) 21% vs B2 (facts) 12%; ≈13 live within-set repeats in sets the over-production bug did not touch (e.g. three P2Y12 items in one 25-question ACS set) |

## 5. Proposal

Three layers, each usable on its own, in the order I would ship them.

### Layer 1 — a per-student topic ledger (no migration)

In `qbank-generate`, on every wave, fetch the student's earlier playable items on this topic,
excluding the current `generationId`: last ~30, newest first, joined to their latest attempt in
`user_attempts`. Send them to the writer in two lists:

- **Do not re-test**: concepts answered correctly, or seen but not yet answered.
- **Revisit from a new angle**: concepts answered wrong, at least 2 days ago. At most 1 per 5
  questions, and it must be a new patient and a different lead-in direction, never the same item.
  Re-sitting the *same* item is the review queue's job (20 h spacing, `get_qbank_review_queue`).

Use the B2 wording: one line per item, `subtopic: teaching point`. Also include an instruction for
when the topic is used up: prefer a revisit or another high-yield facet of the topic over adjacent
material. That instruction targets the drift B2 showed.

Supporting changes:
- **Topic matching.** Exact `requestedTopic` misses "DKA" vs "diabetic ketoacidosis". Have the router,
  which already runs once per topic at temperature 0, also return a canonical name
  (`{"system": "...", "canonical": "Diabetic ketoacidosis"}`). Store it in `generation_meta.canonicalTopic`
  and match on that. No extra call.
- **The within-set guard** should carry the same fact lines rather than subtopic labels
  (`waveComplete.subtopics` → facts).
- The history goes in the user message, so the cached system prompt is untouched. It adds roughly
  1–1.5k input tokens per wave.

Expected effect: repeats 67% → ~12–21%. Risk: drift after 2–3 sets on a narrow topic, unless
layer 2 is also built.

### Layer 2 — topic blueprints (best result; small migration)

- New table `qbank_topic_blueprints(canonical_topic, exam_track, system, concepts jsonb, model,
  created_at)`. Built once per topic × track by corti-s1 (≈16k tokens and ≈80 s, mostly reasoning)
  and **shared by every student**, so the cost is paid once per topic, not per student. Build it in
  the background the first time a topic is seen, using `EdgeRuntime.waitUntil`. That session uses layer 1;
  later ones use the blueprint.
- Each generated row records `generation_meta.conceptId`. The batch plan assigns a concept per
  row, the same way it already assigns reasoning orders, and the student's concept state comes
  from their rows plus `user_attempts`.
- It gives a denominator, which opens up product surfaces: "you've covered 14 of 26 DKA concepts",
  a weak-concepts list, and a prompt to broaden ("anticoagulants") once a topic is used up.
- Lessons from the run:
  - **Build with corti-s1, not s1-instant.** s1-instant produced duplicate and garbled concepts.
  - **Phrase concepts as ≤15-word points tested.** A pilot with long explanatory concepts leaked
    them into the keys, and 2 of 5 items failed the key-longest gate.
  - **Validate blueprints for duplicates before caching.**
  - **Cap retries on a concept whose item keeps getting held** (one heart-failure concept was held
    twice in a row).
  - **Accept that the writer occasionally ignores its assigned concept** (1 seen in 54).

### Layer 3 — the repetition policy ("how much repeat is sensible")

Concept states per student: unseen · seen-correct · seen-wrong · held (never shown). For each new
set of 5:

| Slot source | Rule |
|---|---|
| Unseen concepts | Fill first, core → standard → extended |
| Seen-wrong | ≤ 1 per 5 (20%), due ≥ 2–3 days after the miss, new angle; a second miss restarts the clock |
| Seen-correct | Not before ~3–4 weeks, unless the unseen pool is empty |
| Pool exhausted (≥ ~80% covered) | Re-test oldest-correct core concepts from a new angle, and suggest a broader topic |
| Held | Treated as unseen; retry once, then skip |

So, for a 5-question set: 0 repeats while new material lasts, at most 1 deliberate revisit of a
miss, and planned re-tests only once the topic is used up. Later, the same states can drive FSRS at
concept level (FSRS already runs the flashcards, `20260918000000_flashcard_fsrs.sql`), which would
replace the fixed intervals with ones fitted to the student.

## 6. Caveats

- 3 topics × 4 sessions; about 40 later-session items per arm. The gap (67% vs 8–12%) is large enough to
  trust the direction, not the second digit.
- Concept grouping, relevance and yield come from one LLM judge (corti-s1). I read the heart-failure,
  ACS and urea-cycle groupings and agree with them; the judge errs strict. corti-s1 returned nothing
  for two large live groups (ACS, urea cycle), which were judged with s1-instant and checked by reading.
- The experiment's arms each had their own judge call, so granularity could differ slightly between
  arms; the judge-free key check agrees on the order.
- The lab control (67%) is higher than live (33%) because the lab runs the same mode and level back
  to back. Live students switch modes and levels, and many live sets are short or abandoned.

## 7. Re-running

```sh
# live (read-only SQL, then judge, then metrics)
npx --no-install supabase db query --linked -f scripts/qbank-repetition/live-repeat-items.sql > scripts/qbank-repetition/out/live-repeat-items.raw
node scripts/qbank-repetition/live-groups.cjs
node scripts/qbank-repetition/judge.mts scripts/qbank-repetition/out/live-groups.json scripts/qbank-repetition/out/judge-live
node scripts/qbank-repetition/metrics.cjs live

# experiment (arms A B1 B2 C D; ONLY_ARMS / ONLY_TOPICS / SESSIONS to narrow)
node scripts/qbank-repetition/gen.mts
node scripts/qbank-repetition/exp-groups.cjs
node scripts/qbank-repetition/judge.mts scripts/qbank-repetition/out/exp-groups-arm.json scripts/qbank-repetition/out/judge-arm
node scripts/qbank-repetition/rate.mts scripts/qbank-repetition/out/exp-groups-arm.json scripts/qbank-repetition/out/rate
node scripts/qbank-repetition/metrics.cjs exp judge-arm
node scripts/qbank-repetition/keyrepeat.cjs
```

`out/` is git-ignored: the live pull contains students' generated items. After layer 1 or 2 is
built, re-run the experiment with the real implementation as a new arm. It is the regression test.
The whole study cost a few dollars of Corti credit.

The shipped code is measured the same way by `gen-impl.mts` (arms E–H, §8.2), and the revisit
wording by `revisit-ab.mts`. Both write beside the study arms, so `exp-groups.cjs`, the judge,
`rate.mts` and `metrics.cjs` read them unchanged.

## 8. What was built (2026-11-01, branch `qbank-repetition-study`)

All three layers, built and tested locally. **Not deployed.** It needs one migration and a
function deploy, plus the frontend for the student-facing parts (§8.4).

### 8.1 The pieces

| Layer | What | Where |
|---|---|---|
| 1 · ledger | Every wave reads the student's history on its topics (`qbank_topic_history`, service role only) and sends the writer a do-not-re-test list: one line per recently met item, `subtopic: teaching point`. That includes items from earlier waves of the same set, so it also replaces the label-only within-set guard. | `_shared/qbank-memory.ts`, `_shared/qbank-repetition.ts` `buildLedger`, `qbank-prompt.ts` `ledgerBlock` |
| 1 · topic identity | The router also returns a canonical name ("DKA" → "Diabetic ketoacidosis"). Rows store `generation_meta.topicKey` and `canonicalTopic`, and history matches on either the canonical key or what was typed, so rows written before keys existed still count. Later waves are not routed, so they read the name wave one stored. Only trusted names (router, curriculum title, stored) are stored or used to build a shared blueprint. | `qbank-prompt.ts` `SYSTEM_ROUTER_PROMPT`, `qbank-generate/index.ts` |
| 2 · blueprints | `qbank_topic_blueprints`: a topic's distinct concepts per exam track, shared by every student. Built in the background (`EdgeRuntime.waitUntil`) the first time a topic is seen. At most 2 builds per wave, one builder per topic (`claim_qbank_blueprint_build`), failure backoff 1h doubling to 7d. Build = an `s1-instant` draft at 0.5, then an `s1-instant` audit that may only name duplicate groups and unusable lines (it never rewrites and never judges the medicine), then validation (≥ 8 concepts). About 25–45 s. | `_shared/qbank-blueprint.ts`, migration `20261102000000` |
| 2 · assignment | Each plan row is assigned a concept the student has not met: core before standard before extended, shuffled within a tier. The row records `generation_meta.concept`. | `qbank-repetition.ts` `assignRows` |
| 3 · policy | Correct → not re-tested for 21 days. Given but unanswered → 7 days. Missed → cools 2 days, then at most one row in five revisits it as a **new item from a new direction**. A second miss restarts the clock, and a revisit that is answered closes the miss. A concept held back by the gate is retried once, then skipped. Once a topic is used up: re-test what is due, oldest first, never one from the same set or one still cooling. | `REPETITION_POLICY`, `buildThreads`, `assignRows` |
| 3 · student-facing | The waiting screen says what history did ("Built from your history: 4 new concepts, a concept you missed before, asked a new way."). The summary says how far through the topic they are, and once it is used up offers **Move on to {broader}**, using the broader topic the blueprint names. | `src/lib/qbank-coverage.ts`, `WritingOverlay.tsx`, `QBankSummary.tsx` |

Safety properties:
- Every read fails open. An unreadable history (migration not applied, timeout) writes the
  wave blind, exactly as before, and the rows record `repetition.memory = "unavailable"`.
- With no history and no assignment, the user message is **byte-identical** to `main`
  (checked across 2,160 plan configurations). System prompts are unchanged.
- The stream's plan frame no longer carries each row's answer letter, and it never carries an
  assigned concept. Both would give the answer away to anyone reading the network tab.

### 8.2 Measured on the shipped code

`scripts/qbank-repetition/gen-impl.mts` replays the study through the production
`applyTopicMemory`, router, blueprint builder and prompt, with an in-memory database. Same
topics, same seeded plans and the same blind judge as §3:

| Arm | Repeats, sessions 2–4 | Unintended | On-topic, sessions 3–4 | Low-yield, sessions 3–4 |
|---|---|---|---|---|
| A · production today | 67% | 67% | 100% | 0% |
| E · ledger only (topic has no blueprint yet) | 7% | 7% | 79% | 0% |
| F · blueprint, before the ledger listed blueprint items | 14% | 14% | 100% | 0% |
| **H · blueprint + full ledger (as shipped)** | **5%** | **5%** | **97%** | 3% (1 item) |
| G · blueprint with answers (60% right, sessions 3 days apart) | 33% | 12% | 97% | 0% |

G's 33% includes 9 repeats the policy asked for: revisits of missed concepts. G was run before
the ledger change that H measures. The F → H change came from reading F's repeats. Handed a
thin concept ("warfarin toxicity presents with bleeding"), the writer fell back to a famous fact
the student had already met (factor VII falls first), and nothing told it that fact was taken.
With the full ledger, warfarin went from 30% to 7%, and H had the best playable rate of any arm
(97%). Every repeat left in H is a pair of blueprint concepts the writer followed faithfully
but the strict judge counted as one ("CYP2C9 inhibitors potentiate warfarin" / "CYP2C9
polymorphisms change dosing"). None is drift.

Revisit wording, A/B on the 9 identical revisit prompts × 2 samples. Similarity is between the
new item's lead-in and the earlier question's:

| | identical lead-in | near-identical | mean similarity |
|---|---|---|---|
| "a new patient and a different question" | 4/18 | 8/18 | 0.56 |
| shipped: "come at it from a different direction … if that asked for the treatment, ask what to monitor …" | 0/18 | 2/18 | 0.30 |

The new-wording revisits still test the missed concept. An example: "most appropriate
addition: spironolactone" came back as "why an MRA should not be started in this patient:
hyperkalemia risk".

Router: system unchanged for 25/26 test inputs. The exception is warfarin, cardiovascular →
heme_onc, which the old prompt also returned in the study run. Canonical names are good:
"DKA", "dka", "diabetic ketoacidosis" and "Diabetic Ketoacidosis high yield for step 1" all →
"Diabetic ketoacidosis"; "nephrotic syndrom" → "Nephrotic syndrome"; Arabic "heart diseases" →
"Heart disease". Junk is still declined.

Blueprint builds measured: Heart failure (Step 2 CK) 40 concepts in 26 s, Diabetic ketoacidosis
21 in 43 s, Warfarin 22 in 25 s.

### 8.3 Tests

- `src/lib/qbank-repetition.test.ts` — policy, ledger, assignment, blueprint parsing, prompt rendering.
- `src/lib/qbank-coverage.test.ts`, `qbank-wave-runner.test.ts`, `WritingOverlay.test.tsx` and
  `QBankSummary.test.tsx` — the client side.
- `scripts/qbank-edge-test/edge-test.mjs` — the real handler against a fake database and Corti.
  66 checks: canonical identity, ledger, revisits, assignment, background builds, later
  waves, fail-open, curriculum mixes.
- The migration was run in PGlite: history matching (legacy and canonical keys, whitespace and
  case, mixed-set focus), latest attempt, lead-in, playable flag, claim backoff, and grants
  (`authenticated` cannot call either function or read the table).

### 8.4 Deploying

1. `npx supabase db push`: migration `20261102000000_qbank_topic_memory.sql`, additive.
2. `npx supabase functions deploy qbank-generate`. It fails open without step 1, so the order
   is a preference, not a requirement. Optional env: `CORTI_BLUEPRINT_MODEL`
   (default `corti-s1-instant`).
3. Frontend: the waiting-screen line, the coverage note and **Move on**. Older frontends ignore
   the new fields.

Rollback: redeploy the previous `qbank-generate`. The migration can stay; nothing reads it then.

After deploying, check:

```sql
-- Did waves read history?
select generation_meta->'repetition'->>'memory' as memory, count(*)
from questions where origin = 'generated' and created_at > now() - interval '1 day' group by 1;
-- Blueprints building, built, failing
select status, count(*), max(attempts) from qbank_topic_blueprints group by 1;
```

Then re-run §7's live measurement after a couple of weeks of use.

### 8.5 Known limits

- The writer still drifts off an assigned concept now and then. The full ledger contains the
  damage, but a concept is recorded as assigned, not as actually tested.
- Blueprint quality rests on `s1-instant` plus the audit. Near-duplicates can survive (warfarin
  "teratogenic" vs "crosses the placenta").
- Without a blueprint, the ledger alone drifts into adjacent material once the familiar facets
  are used up (79% on-topic in sessions 3–4). It lasts one set, because the blueprint is built
  in the background on the topic's first wave.
- Spacing uses fixed intervals. FSRS at concept level (as the flashcards use) is the natural
  next step, and `buildThreads` is where it would plug in.
