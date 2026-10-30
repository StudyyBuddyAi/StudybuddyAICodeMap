# Shared question pool — design (2026-10-30)

Status: **designed, not built.** Owner decision 2026-10-30: build a shared, browsable question pool
"with all the bells and whistles", fitted to the current implementation and to how students
actually use the QBank. Read `research-2026-10.md` first; this builds on its numbers.

---

## 1. Why, in one paragraph

Every generated question is private and used once: on the live table each item has been answered
**1.1 times on average** (max 4). That single fact blocks most of what a real QBank offers — no
real difficulty, no "% of students chose B", no peer comparison, no custom blocks — and makes every
set cost a 20-second wait and a generation. The 853 admitted generated items already written are an
asset nobody else can reach. A pool turns written-once items into a bank everyone draws from,
with real statistics, instant sets, and a human-and-data quality loop that the machine gate alone
cannot provide.

## 2. What it has to fit

### The implementation already in place (reuse, don't rebuild)

| Exists | How the pool uses it |
|---|---|
| `questions` (`is_active`, `origin`, `created_by`, `generation_meta` with qaBlocked / verification / flagCheck / reviewerFlag / promptVersion) | The pool *is* this table. Promotion reads the stored quality signals; no re-scoring needed. |
| Column REVOKE on `correct_option`, `explanation`, `teaching_point`, `distractor_explanations` | Unchanged: pool items leak no key before grading. |
| `start_qbank_session` — random branch (`is_active`, `subject`, `domain`) and explicit-ids branch (`is_active` OR own generated) | Active pool items are `is_active = true`, so both branches already serve them. Pool-first assembly picks ids and uses the explicit branch. |
| `user_attempts` (`selected_option`, `is_correct`, `time_taken_ms`) | Raw material for per-item statistics. |
| `flagged_questions`, `question_reports` (built 2026-10-30), `get_qbank_review_queue` | Reports drive quarantine; the review queue works unchanged on pool items. |
| `get_qbank_performance` (`by_domain`) | Grows into the performance grid. |
| `curriculum_topics` — 183 level-1 topics across all 13 systems, with `yield_tier` | The taxonomy for tagging, coverage maps, custom blocks and seeding. |
| pgvector 0.8.2 (installed), `corti-s1-embedding` (2560-d; `halfvec` HNSW supports it) | Topic → item matching and near-duplicate detection, on Corti — no OpenRouter. |
| Router (`SYSTEM_ROUTER_PROMPT`) | Already maps any phrasing — and other languages — to a system; extend it to also return a canonical English topic for embedding. |

Not installed: `pg_cron` (Supabase can enable it). Until then, statistics are kept by trigger and
recomputed on demand.

### How students actually use it (live, 2026-10-30)

- Topics are **broad and multilingual**: "heart", "cardiology", "anatomy", "امراض القلب". 86 distinct
  topics. Matching must be semantic, not string equality.
- Sets are **small**: average 4.7 questions (the default 5). Timed mode: 5 of 116 sets.
- The demand is **skewed**: of admitted items, cardiovascular 266 and GI 167; immune 5, respiratory 20.
- The population is **small**: 25 QBank users. Per-item statistics will be thin for months, so every
  statistic below has a minimum-n before it is shown or acted on, and the early thresholds are set
  for low traffic.

## 3. Item lifecycle

```
 private ──promote──▶ candidate ──serve to others──▶ probation ──enough clean data──▶ active
    ▲                     │                              │                               │
    │                     └──────────────┬───────────────┴───────────────┬───────────────┘
    │                                    ▼                               ▼
    └──────── (author keeps it) ── quarantined ──fix (new version)──▶ probation      retired
```

| State | Who sees it | Enters when | Leaves when |
|---|---|---|---|
| `private` | its author only (today's behaviour) | written | promotion rules pass |
| `candidate` | its author only; queued for exposure | **all** of: not `qaBlocked`; verifier agreed; no `writer-critical`; any writer flag cleared by the fact check; `promptVersion` ≥ v14; no open report; no active near-duplicate (cosine ≥ 0.92 on stem+lead-in embedding — keep the item with better stats) | picked into a set for another student |
| `probation` | everyone, capped at **30% of any set**, tagged "New" with a prominent Report | first served to a non-author | stats or reports decide |
| `active` | everyone; counts in peer stats | n ≥ 30 non-author attempts **and** 0.25 ≤ p ≤ 0.95 **and** point-biserial ≥ 0.05 **and** no accepted report | quarantine or retirement rules |
| `quarantined` | nobody new; existing attempts kept | an accepted `wrong_key`/`outdated` report; ≥ 2 open `wrong_key` reports; at n ≥ 30, p < 0.20, or one distractor chosen more often than the key (the classic mis-key signal); at n ≥ 50, point-biserial < 0 | fixed → new version back to probation; or retired |
| `retired` | nobody new | duplicate superseded; Step 2 CK guideline item older than 18 months without re-verification | — |

Thresholds are starting points for a low-traffic bank: the literature treats p 0.3–0.7 as ideal
difficulty and a discrimination ≥ 0.2 as good, and a six-year medical-school analysis found static
cutoffs alone missed 14% of flawed items — which is why reports and distractor behaviour sit beside
the numbers rather than under them. Point-biserial is computed against each attempter's accuracy on
*other* items (corrected item–total), since sets are too small for a set score.

Curated rows (120) start `active`. Every transition is written to an audit table with its reason.

## 4. Data model (additive)

```sql
-- questions: lifecycle and matching
alter table questions add column pool_status text not null default 'private'
  check (pool_status in ('private','candidate','probation','active','quarantined','retired'));
alter table questions add column pool_changed_at timestamptz;
alter table questions add column version int not null default 1;
alter table questions add column supersedes uuid references questions(id);
alter table questions add column embedding halfvec(2560);          -- stem + lead-in + subtopic
alter table questions add column curriculum_topic_id uuid references curriculum_topics(id);
-- backfill: curated → 'active'; is_active follows pool_status in ('probation','active') via trigger

-- running statistics, kept by an AFTER INSERT trigger on user_attempts (author attempts excluded)
create table question_stats (
  question_id uuid primary key references questions(id) on delete cascade,
  n int not null default 0,
  n_correct int not null default 0,
  option_counts jsonb not null default '{}',   -- {"a": 12, "b": 3, ...}
  time_ms_sum bigint not null default 0,
  point_biserial real,                          -- recomputed in batch
  updated_at timestamptz not null default now()
);

create table question_pool_events (
  id bigserial primary key,
  question_id uuid not null references questions(id) on delete cascade,
  from_status text, to_status text not null,
  reason text not null,                          -- rule slug or 'report:<id>'
  created_at timestamptz not null default now()
);
```

RPCs (all `security definer`, own-user or service role):

- `promote_pool_candidates()` — service role; applies the candidate rules to private items. Run
  after each wave and nightly.
- `evaluate_pool_items()` — service role; recomputes point-biserials, applies probation → active
  and quarantine rules, writes events. Nightly (pg_cron) or after every N attempts.
- `assemble_qbank_set(p_embedding, p_system, p_track, p_size, p_filters)` — returns ids: unseen
  active items by similarity within system and track, plus up to 30% probation items, excluding
  anything the student has attempted, reported, or authored and already seen. Filters: `unused`,
  `incorrect`, `marked`, systems, disciplines, curriculum topics.
- `get_question_peer_stats(p_question)` — after grading only: % correct, per-option %, median
  time, real difficulty band. Returns nothing below n = 20.
- `triage_reports` (service role / admin page) — accept, reject, fix; a fix creates `version + 1`
  with `supersedes`, and the old version's stats stop counting.

Never exposed: `created_by`, `generation_meta` (it carries the requesting student's typed topic),
reports by other students.

## 5. Serving: pool first, fresh to fill

1. The student names a topic as today. The router (already called) also returns a canonical
   English topic; the edge function embeds it once with `corti-s1-embedding`.
2. `assemble_qbank_set` returns up to `size` matching unseen items (similarity floor tuned on an
   eval set, ~0.35–0.45). These start the session **instantly** — no 20-second first-item wait.
3. The shortfall is generated exactly as today, with the pool items' subtopics fed into
   `avoidSubtopics`. Fresh items enter as `private` → `candidate`, so every top-up grows the pool.
4. At least one fresh item per set while a topic's pool is thin (< 50 active), so novelty and pool
   growth continue; none once a topic is deep, unless the student asks for "fresh only".

The wave runner, the claim RPC, and resume all work unchanged: pool items are just explicit ids at
session start.

## 6. The bells and whistles (student-facing)

| Feature | Needs | Notes |
|---|---|---|
| **Instant sets** | §5 | The biggest UX win: the wait disappears for any covered topic. |
| **Custom block builder** | `assemble_qbank_set` filters | UWorld-style: exam track, systems, disciplines, curriculum topics; Unused / Incorrect / Marked / All; size; tutor/timed; the exam-block preset. Brings back the browse-the-bank experience the curated configurator used to give, now across all 13 systems. |
| **Peer stats on every graded item** | `question_stats`, n ≥ 20 | "64% answered correctly", "% chose each option" under each option, median time. |
| **Real difficulty** | n ≥ 30 | Easy / Medium / Hard from p bands; "New" before that. Replaces the writer's label, which was removed from view on 2026-10-30. |
| **Performance grid** | attempts × tags | System × discipline (Step 1) or system × task (Step 2 CK), with the weakest cells one tap from a targeted block. |
| **Percentile vs peers** | ≥ 50 active users per track | Hidden until the population makes it meaningful. |
| **Coverage map** | `curriculum_topic_id` | The 183 curriculum topics × your accuracy; high-yield topics you have not touched yet. |
| **Report loop closed** | `question_reports.status` | "Under review" → "Fixed — thanks" on the student's own report; the fixed version can be re-sat. |
| **Review queue on pool items** | exists | Missed pool items come back like private ones. |
| **"Your questions helped N students"** | authorship, opt-in | Optional contributor credit for the student whose set seeded an active item. Anonymous by default. |

## 7. Seeding

The skew (cardiovascular 266, immune 5) and the small user base mean organic growth alone leaves
most topics empty. Seed through the **same pipeline** (writer → gate → probe → fact check), driven by
`curriculum_topics`: ~15 items per high-yield topic per track ≈ 183 × 15 × 2 ≈ 5,500 items. At the
measured ~1¢ per delivered item that is roughly **$55 of Corti credit**. Seeded items enter as
`candidate`, never straight to `active` — they earn it like everything else. A small script (Node +
Deno shim, as `scripts/qbank-eval` does) writes them under a service "seed" author.

## 8. The free cap — decision needed

Pool items cost nothing to serve. Options:

1. **Pool items count toward the same 10/day** — simplest, keeps the Pro line where it is.
2. **Pool items are free; only fresh generation counts** — great for free users and for pool
   growth through reports and stats, and weakens the reason to go Pro.
3. **A separate, larger pool allowance** (e.g. 40/day) with fresh generation still at 10.

Recommendation: **3**. It matches the cap's cost rationale (fresh generation costs money, serving
does not), keeps a free student practising daily (which is what fills `question_stats`), and leaves
Pro as "unlimited, fresh, on any topic". Retries from the review queue stay free under every option.

## 9. Rollout

| Phase | Ships | Depends on |
|---|---|---|
| **P0 — done 2026-10-30** | reports, review queue, free cap, writer-flag fact check | — |
| **P1 — data** | `pool_status`, `question_stats` + trigger, audit table, `promote_pool_candidates` run over the 853 admitted items | decision §8 |
| **P2 — serving** | embeddings (backfill + on insert), `assemble_qbank_set`, pool-first sets with top-up, probation "New" tag, peer stats (n ≥ 20) | P1 |
| **P3 — browse** | custom block builder, real difficulty, performance grid, coverage map | P2 |
| **P4 — scale** | curriculum seeding, `evaluate_pool_items` nightly (pg_cron), admin triage page, report loop UI, versioning | P2 |

## 10. Measures (compare against research-2026-10.md §2)

Pool hit rate per set; share of sets that start instantly; time-to-first-question; reports per
100 attempts; quarantine rate and reason mix; accuracy distribution of active items (target band
55–75%); delivered-question cost; items per curriculum topic.

## 11. Risks

- **Cold start.** At today's traffic, n = 30 per item takes a long time; probation items carry the
  load early. Mitigation: seed with breadth, keep probation exposure at 30%, review the most-served
  probation items by hand.
- **One bad item reaches many students.** Mitigation: the 30% probation cap, the quarantine rules,
  and the stored fact-check/verifier history; Step 2 CK items expire without re-verification.
- **Privacy.** Items are synthetic, but `generation_meta.requestedTopic` is the student's own words:
  it never leaves the server, and promotion rejects any item whose text contains the requested topic
  verbatim when that topic is not a medical term (a name, say).
- **Grounding corpus licensing** (see research §2) — irrelevant while items are written from model
  knowledge; matters again if grounding (option A3) feeds the pool.

## Sources

- Item difficulty/discrimination cutoffs and the limits of static thresholds:
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12805726/ · https://pjmd.zu.edu.pk/?p=2335
- Live numbers: `docs/qbank/research-2026-10.md` §2 and the queries run 2026-10-30.
