# QBank topic selection — research and design (2026-10-30)

Status: **researched and designed, not built.** The owner asked, before the shared pool: how should
a student choose what to practise — one topic, several, a mixed block — what scenarios exist, and
how do we put inviting, challenging topics in front of them. Companion docs: `research-2026-10.md`,
`shared-pool-design.md` (the pool makes several of these entry points cheaper, but none of them
waits for it).

---

## 1. What we found

### What students type today (live, 2026-10-30)

The QBank has one free-text box. What came through it:

| Kind | Examples | Share / note |
|---|---|---|
| A focused topic | heart failure, DKA, nephrotic syndrome, cardiac tamponade, warfarin | the majority |
| A whole system or field | "cardiology", "heart", "cardio", "pediatrics mixed", "trauma surgery", "breast" | common — students want a *mixed block* and have no way to ask |
| Two topics in one box | "acute tubular necrosis, aki" | rare, because nothing suggests it is possible |
| Communication / ethics | "SPIKES protocol on communication", "breaking bad news", "BRAN protocol" | real demand our 13 organ systems cannot route |
| Typos / other languages | "pediatrcs", "luekemia", "امراض القلب" | the router copes; the student gets no help typing |
| Junk / probes | "h", "hhhhhh", an `<img onerror>` string | validation catches most |

Other signals: topics average **2.4 words**; sets average **4.7 questions** (the default); exam mode
split **Step 1 39 · Step 2 CK 30 · Mixed 14** sets — a large clinical cohort, and their sheet topics
are clinical too (SBO, femoral hernia, PPH, AML, ovarian cancer). The 183 curriculum topics are all
tagged `yield_tier = high`, so "high-yield" cannot be what ranks a suggestion; the student's own
history has to.

### What the established QBanks do

- **UWorld**: "Create Test" — pick subjects × systems (with sub-topics), a question mode
  (unused / incorrect / marked / all), tutor or timed, a count. Performance reports by subject,
  system and topic, and a test can be created straight from a weak area in Reports.
- **AMBOSS**: "Create a Qbank session" — filters for exam, systems, symptoms, discipline, articles,
  difficulty and status; a **study objective** (the exam) decides what is offered and **filters
  persist** between sessions; premade **study plans** are system-by-system exam blocks; a session can
  start from an article. Students asked for multi-keyword search and it was not supported.
- Both are **filter-first**: excellent once a bank exists and the student knows what they want, cold
  and laborious otherwise. Neither starts from "type what you studied" — which is our advantage,
  because we generate on demand for *any* phrasing.

### What the learning science says

- **Interleaving** (mixing topics within a block) improves *discrimination* between look-alike
  categories — ECG diagnoses (Hatala 2003), lung auscultation — but students find it harder and do
  not notice it helps. A well-run McMaster factorial ECG trial found no benefit and a *delayed-test
  advantage for blocked practice* on material that was still new; its authors suggest interleaving
  pays off **after initial mastery**.
- So: **blocked (one topic) when it is new, mixed when consolidating, and mixed *deliberately* with
  confusable neighbours** ("contrastive" sets) when the goal is telling things apart. Spacing (now
  live in the review queue) does the rest.
- The exam itself is interleaved: Step 1 and Step 2 CK blocks mix systems by fixed weights (below).

### What the exam weights say

| | Step 1 | Step 2 CK |
|---|---|---|
| Communication / ethics / professionalism / safety | **6–9%** | **10–15%** |
| Biostatistics & epidemiology | **4–6%** | **3–5%** |
| Multisystem processes (incl. nutrition, toxicology) | 8–12% | 4–8% |
| Example systems | Cardiovascular 7–11%, Resp + Renal 11–15%, Repro + Endo 12–16% | Renal + Repro 7–13%, Cardiovascular 6–12%, Pregnancy 3–7% |

Up to a fifth of the real exam lives in areas our router cannot place (it forces everything into 13
organ systems), and students are already asking for them.

## 2. The scenarios

| # | The student's situation | What they want | Best entry point | Default shape |
|---|---|---|---|---|
| 1 | Just studied a topic (lecture, sheet, deck) | "Test me on *this*" | type it, or a **From your Library** suggestion | 1 topic · 5–10 Q · tutor · blocked |
| 2 | In a system course / module | "Mix everything from cardio" | **browse a system**, tick several sub-topics or "all" | 1 system, 3–6 topics, interleaved |
| 3 | Revising several things this week | "Mix *these* topics" | type several (chips) or pick from Library | 2–5 topics, interleaved |
| 4 | Keeps confusing two conditions | "Make me tell them apart" | a **Showdown** challenge card | 2–4 confusable topics, interleaved, contrastive |
| 5 | On a clerkship / shelf | "Internal medicine shelf practice" | **Shelf** quick start | clerkship-weighted mix, Step 2 CK |
| 6 | Dedicated board prep | "Like the real thing" | **Exam block** (exists) — now mixed across systems by exam weight | 20 Q · timed · 30 min (free: 10 · 15 min) |
| 7 | Has weak spots | "Fix what I'm bad at" | **Weak spots** card | the 2–4 lowest-accuracy topics, mixed |
| 8 | Missed / marked questions waiting | "Retry what I got wrong" | **Review queue** (live) | due misses + marks |
| 9 | Ten spare minutes | "Something quick" | **Daily 5** / **Surprise me** | 5 Q, one tap |
| 10 | Clinical-reasoning practice | "A realistic shift" | a **Scenario pack** ("Chest pain in the ED") | 3–5 linked topics, Step 2 CK |
| 11 | Communication / ethics / biostats | "SPIKES", "sensitivity and specificity" | type it — needs new content families (§6) | 1 topic |

## 3. The page

One principle: **the fastest path is one tap, the most flexible path is one screen, and nothing in
between asks a question the student has not reached yet.** Today's page asks for a topic, then shows
every option at once.

```
┌──────────────────────────────────────────────────────────────┐
│ QBank                                   Studying for: [Step 1 ▾]│  ← persisted, like AMBOSS's study objective
├──────────────────────────────────────────────────────────────┤
│ Pick up                                                        │
│  [↻ Retry 7 questions · 5 missed · 2 marked]   [▶ Finish "DKA" 3/10]│  ← review queue + unfinished (exist)
├──────────────────────────────────────────────────────────────┤
│ What do you want to practise?                                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ [Heart failure ×] [Aortic stenosis ×] [atrial fib|      ] │ │  ← chips; Enter or comma adds
│  └──────────────────────────────────────────────────────────┘ │
│   ↳ Atrial Fibrillation & Flutter (Cardiovascular)            │  ← autocomplete: curriculum + your Library
│   ↳ Did you mean "Pediatrics"?                                 │  ← fuzzy match for typos
│  [Browse by system]   3 topics · mixed together  ⓘ            │
│                                                                │
│  10 questions · Tutor · Balanced          [Change]  [Start ▶]  │  ← options collapsed to one summary line
├──────────────────────────────────────────────────────────────┤
│ For you                                         [Show others ↻]│
│  ┌ From your Library ─────┐ ┌ Weak spot ────────────┐ ┌ Showdown ───────────┐ │
│  │ Nephrotic syndrome      │ │ Asthma — 40% last time │ │ Nephritic or        │ │
│  │ You wrote a sheet,      │ │ Win it back.           │ │ nephrotic?          │ │
│  │ never tested it.        │ │ 5 Q · ~8 min           │ │ 6 Q · contrast set  │ │
│  │ 5 Q · ~8 min   [Start]  │ │              [Start]   │ │          [Start]    │ │
│  └─────────────────────────┘ └────────────────────────┘ └─────────────────────┘ │
│  ┌ Today's challenge ─────┐ ┌ Scenario ─────────────┐ ┌ Not touched yet ────┐ │
│  │ Microcytic anemias:     │ │ Chest pain in the ED   │ │ Pheochromocytoma &  │ │
│  │ four look-alikes        │ │ 5 Q · Step 2 CK        │ │ paraganglioma       │ │
│  └─────────────────────────┘ └────────────────────────┘ └─────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Quick start   [Exam block 20·30min]  [Shelf: IM ▾]  [Daily 5]  [Surprise me] │
└──────────────────────────────────────────────────────────────┘
```

### The composer

- **Chips, not a sentence.** Typing then Enter or a comma makes a chip; up to **5 topics** per set.
  Each chip shows the system it routed to once known (a small label), so a student sees "DKA →
  Endocrinology" and trusts the set.
- **Autocomplete** from three sources, in this order: the student's own topics (sheets, decks,
  past sets), the 183 curriculum topics, then recent popular topics. Fuzzy-matched, so "pediatrcs"
  and "luekemia" find their targets; free text is always allowed (anything medical still works).
- **Browse by system**: the 13 systems (+ the new families in §6) as a grid; opening one shows its
  curriculum topics as checkboxes with "All of Cardiovascular". This is UWorld's system picker,
  without the cold start.
- **Mixing is explained once**: with two or more topics, a line reads "Mixed together — switching
  between topics is harder, and better for telling them apart." With one topic just studied, nothing
  is suggested. If the student ran a single-topic set on something in the last few days, the next
  suggestion offers to mix it with its neighbours — **blocked first, mixed later**.
- **Options collapse** into one summary line ("10 questions · Tutor · Balanced · Step 1"), opened
  with *Change*. The exam lives at the top of the page as a persisted setting, not a per-set pill —
  students prepare for one exam for months.
- The per-topic split is shown when it matters: "10 questions across 3 topics (4 · 3 · 3)".

### Suggestions that feel inviting and challenging

At most **six cards** at a time — enough to choose from, few enough to choose. "Show others"
reshuffles. Each card is a **one-tap start** with its size and time on it.

Ranking, first match wins per slot:
1. **From your Library** — a sheet or deck with no QBank set yet ("You wrote a sheet, never tested it").
2. **Weak spot** — lowest accuracy with ≥ 5 answered ("40% last time — win it back").
3. **Mix it** — a topic sat once in the last week, offered with its curriculum neighbours.
4. **Showdown** or **Scenario** for the student's exam (catalogue below).
5. **Today's challenge** — the same card for everyone that day (deterministic by date), which is
   what makes it shareable and, once the pool exists, comparable ("62% got it today").
6. **Not touched yet** — a curriculum topic in a system they practise, never attempted.

Copy rules: name a concrete task, never a vague subject ("Nephritic or nephrotic?" beats
"Renal review"); a hook in one short line; size, time and exam on the card; no hype words; a
challenge level shown as words (Foundations / Balanced / Challenge), not flames or skulls.

### The starting catalogue

Drawn from the curriculum topic titles so every card generates against topics the system already
knows. ★ = suggested Challenge level.

**Step 1 — Showdowns (contrastive sets)**

| Card | Hook | Topics mixed |
|---|---|---|
| Nephritic or nephrotic? | Blood or protein — call it from the urine. | Glomerulonephritis — Nephritic; Nephrotic Syndrome & MCD |
| Crohn's or UC? | Skip lesions, crypt abscesses, fistulas — whose is whose? | IBD — Crohn's; IBD — UC |
| Four hypersensitivities | One stem each. Which type? | Hypersensitivity Reactions I–IV |
| Small red cells | Iron, thalassemia, chronic disease — read the indices. | Iron Deficiency & Microcytic Anemias; Hemoglobinopathies |
| Which leukemia? | Age, smear, one marker. | Acute Leukemia — ALL & AML; Chronic Leukemia — CLL & CML |
| Name the murmur | AS, AR, MS, MR — by timing and maneuver. | Aortic Valve Disease; Mitral Valve Disease |
| Cyanotic or acyanotic? | Follow the shunt. | Congenital Heart Disease |
| Hyper or hypo? | Graves, Hashimoto, storm. | Hypothyroidism & Hashimoto's; Hyperthyroidism — Graves' |
| Joint pain lineup | Lupus, RA, or a spondyloarthropathy? | SLE; RA; Seronegative Spondyloarthropathies |
| Weak, but where? ★ | MS, Guillain-Barré, myasthenia — localise the lesion. | MS & Demyelinating; Peripheral Neuropathy & GBS; Myasthenia Gravis |
| Typical vs atypical | Receptors, side effects, NMS. | Antipsychotics — Typical, Atypical & NMS |
| Gram-positive or negative? | Name the bug from the stain and the story. | Gram-Positive Organisms; Gram-Negative Organisms |
| Mixed acid–base ★ | Two disorders at once. Find both. | Acid-Base Disorders |
| PV loops ★ | Preload, afterload, contractility — read the loop. | Cardiac Physiology & Hemodynamics |
| Diuretics by transporter | Which pump, which electrolyte? | Renal Physiology — Tubule Function; Essential Hypertension & Antihypertensives |

**Step 2 CK — Scenario packs (clinical, mixed)**

| Card | Hook | Topics mixed |
|---|---|---|
| Chest pain in the ED | Five patients, five different killers. | ACS; Aortic Aneurysm & Dissection; PE & DVT; Pericardial Disease; Pneumothorax |
| The crashing patient ★ | Which shock, and what now? | Shock Syndromes; Sepsis & Septic Shock; Pericardial Disease |
| Short of breath on the ward | Heart, clot, infection or airway? | HF — HFpEF & Acute Decompensation; PE & DVT; Pneumonia; COPD |
| Abdominal pain in pregnancy | Surgical, obstetric, or both? | Ectopic Pregnancy; Appendicitis & Acute Abdomen; Hypertensive Disorders of Pregnancy |
| Altered mental status | Sugar, salt, infection or bleed? | Altered Consciousness; CNS Infections; Sodium & Water; DKA & HHS |
| GI bleed: scope, band or operate? | Stabilise first — then decide. | GI Bleeding — Upper & Lower; Cirrhosis & Portal Hypertension |
| Stroke code | Thrombolyse, thrombectomy, or neither? | Ischemic Stroke; Hemorrhagic Stroke & SAH |
| Endocrine emergencies ★ | DKA, thyroid storm, adrenal crisis. | DKA & HHS; Graves' & Thyroid Storm; Adrenal Insufficiency |
| Electrolyte emergencies | Potassium, sodium, calcium — what kills first? | K, Ca & Mg Disorders; Sodium & Water |
| Fever without defenses | The immunocompromised patient. | Opportunistic Infections; HIV/AIDS |
| The well-child visit | Milestones, shots and screening. | Developmental Milestones; Immunisation Schedule; Well-Child Visits |
| Labor ward night | Bleeding, pressure, seizures. | Labor, Delivery & Postpartum Complications; Hypertensive Disorders of Pregnancy |
| Who gets screened, and when? | Colon, breast, cervix. | Colorectal Cancer & Polyp Screening; Breast Cancer; Cervical Cancer & HPV |
| Hard conversations | Breaking bad news, capacity, consent. | *needs the Communication & Ethics family (§6)* |

The catalogue lives in code (a typed list, reviewed like any other content) so it can grow without a
migration, and each card records its own completion rate once live — a card nobody finishes is a
card to rewrite.

## 4. Mixed blocks in the engine — the "multi-focus plan"

Today a wave has **one topic → one router call → one system brief**, and a set is a sequence of
those waves. Mixing needs no new pipeline, only a richer plan:

- The request carries `topics: string[]` (still accepts `topic`). The router runs **once per
  topic**, in parallel (cheap — one short call each), giving each topic its system.
- `buildBatchPlan` assigns each plan row a **focus** (topic) and **system**, round-robin by index:
  row *i* gets `topics[(i − 1) mod T]`. Because it is a pure function of the index, every wave —
  including a resumed one — knows its rows from `startIndex` alone, and the set comes out
  **interleaved by construction** (A B C A B C…). Uneven counts fall out of the modulus.
- `buildUserMessage` lists each plan row with its focus ("Question 4: reasoning order 2nd — focus:
  aortic stenosis") and includes **one brief per distinct system** in the wave, as Mixed mode already
  includes two track briefs. The Step 1 *system* prompt does not change, so the identity test stands.
- Persistence takes `subject` from the row's system rather than the wave's, so a cross-system set is
  labelled correctly; `generation_meta.focus` records the row's topic.
- `avoidSubtopics` and the QA gate's batch duplicate checks work unchanged; a contrastive set is
  *meant* to share option pools, so `shared-option-pool` stays a warn.
- The client stores `topics` in the session's generation metadata in place of `topic`; resume,
  claim and the review queue are untouched.

**Weighted exam blocks** reuse the same mechanism: sample 20 curriculum topics by the exam's
system weights (table in §1) and pass them as the focus list. **Shelf** blocks do the same with a
clerkship weighting once the 183 topics carry a clerkship tag (a one-off Corti classification).

With the shared pool later, a mixed block is a filtered draw and the plan only fills the gaps.

## 5. Small fixes that ride along

- Autocomplete and the fuzzy "did you mean" remove most typos before they reach the router.
- The exam target moves to a persisted page-level setting; the Exam Mode pills go.
- Topic validation shows a friendly hint for single letters and keyboard mash instead of an error.

## 6. Content gaps the scenarios exposed

**Communication & Ethics** (Step 1 6–9%, Step 2 CK 10–15%) and **Biostatistics & Epidemiology**
(3–6%) have demand and no home. They need their own families: router keys, briefs for each track,
and — for Step 1 — a scope exception, because the Step 1 prompt's "test only mechanisms…" rule
would reject an ethics item outright. Changing the Step 1 *system* prompt means updating the
identity fixture, bumping `PROMPT_VERSION` and re-running `scripts/qbank-eval`. Worth its own
small project; the composer can list both families as "coming soon" until then.

## 7. Build phases

| Phase | Ships | Effort |
|---|---|---|
| **T1 — composer** | chips (≤ 5), autocomplete (Library + curriculum + fuzzy), browse-by-system, collapsed options, persisted exam target, multi-focus plan (same- and cross-system), interleaved sets | M |
| **T2 — suggestions** | "For you" cards with the ranking above, the catalogue (Showdowns, Scenarios), Today's challenge, Daily 5, Surprise me | M |
| **T3 — blocks** | exam-weighted mixed Exam block, Weak-spots mix, "Mix it" follow-ups | S–M |
| **T4 — families** | Communication & Ethics, Biostatistics; Shelf mode with clerkship tags | M–L |
| **Pool** | Unused / Incorrect / Marked filters and instant mixed blocks once `shared-pool-design.md` P2 lands | — |

## 8. Decisions for the owner

1. Max topics per set — proposed **5**.
2. Exam target as a **persisted page setting** (replacing the per-set Exam Mode pills) — yes/no.
3. Does a **Showdown / Scenario** card run at its own suggested level (★ = Challenge) or the
   student's chosen level?
4. Is the **Communication & Ethics** family (prompt work, eval run) worth doing in T1 rather than T4,
   given students are already asking for it?

## Sources

- UWorld: create test by subject/system, question modes, test from Reports —
  https://medical.uworld.com/blog/product-updates/creating-a-test-from-the-reports-section/ ·
  https://www.studentdevelopment.arizona.edu/step-1-resources
- AMBOSS: creating a Qbank session, persistent filters, study plans, multi-keyword request —
  https://support.amboss.com/hc/en-us/articles/360032477132 ·
  https://support.amboss.com/hc/en-us/articles/12691272974868-Persistent-Filters ·
  https://support.amboss.com/hc/en-us/articles/360039112851-Study-Plan-Overview ·
  https://support.amboss.com/hc/de/community/posts/19143627508369/comments/19390686976017
- Interleaving: McMaster factorial ECG trial (blocked advantage on a delayed test) —
  https://link.springer.com/article/10.1007/s40037-017-0365-x ; lung auscultation field study —
  https://research.tudelft.nl/en/publications/improving-diagnostic-accuracy-of-lung-auscultation-through-interl/
- USMLE specifications: Step 1 —
  https://www.usmle.org/exam-resources/step-1-materials/step-1-content-outline-and-specifications ;
  Step 2 CK — https://usmle.org/exam-resources/step-2-ck-materials/step-2-ck-content-outline-specifications
- Live StudyBuddy data: topics typed into the QBank and sheets, exam-mode split, curriculum topics
  (queried 2026-10-30).
