# The credits meter

Every Corti call the app makes is recorded with the tokens Corti reports and their cost. Each account has a daily budget, and a request that does not fit in it can be refused before it spends anything. This is the base for making StudyBuddy free for every student without one account draining the Corti credit. The dashboard's usage bar and the Usage tab in Settings read what this records.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Prices, budget, holds | `supabase/functions/_shared/credits.ts` | List prices in micro-dollars (µ$), the daily budget, and what each kind of request sets aside. It has no imports, so the client can use it too. |
| Meter | `_shared/corti.ts`, `_shared/meter.ts` | A config that carries a `meter` reports every call made with it. The meter asks for Corti's usage frame and strips it again, so callers read the same stream as before. Each call becomes one `ai_spend` row. |
| Ledger and count | `20261107000000_credits_meter.sql` | `ai_spend` holds one row per call. A trigger adds each charged row to the student's `usage_records` row of kind `credits` for the day. `reserve_credits` and `release_credit_hold` manage the holds. |

Before its first Corti call, a request takes a hold sized to its worst case (`CREDIT_HOLDS`). It gives the hold back when it ends. A student's parallel requests therefore cannot spend past the budget together. A hold that is never given back expires after 5 minutes.

What gets charged:

| Call | Charged? | Cost recorded as |
|---|---|---|
| Corti reported its usage | Yes | Its tokens at list price |
| The student cut the stream off before the usage frame | Yes | An estimate |
| Aborted by our own timeout | No | An estimate, for our accounting |
| The network broke | No | An estimate, for our accounting |
| Refused by Corti (non-2xx) | No | Zero |
| A topic's blueprint build, shared by every student | No | Its tokens, for our accounting |

## Modes

`CREDITS_MODE` is a function secret.

| Mode | Behaviour |
|---|---|
| `record` (default) | Meters and charges the count, and takes holds, but refuses nothing. Requests that would have been refused are logged as `credits_would_refuse`. |
| `enforce` | A request that does not fit gets `429 {code: "credits_exhausted", used, budget, resetsAt}` before any Corti call. A count that cannot be read gets 500, so it fails closed. |
| `off` | Nothing is metered or held. |

## The numbers

Measured end to end on Corti on 2026-11-07, at list price, running the production code locally with Corti's usage frames.

| Unit | Cost |
|---|---|
| Comprehensive sheet with its 6 automatic deep dives | 49.2¢ (the sheet itself 5.3¢, each dive 7.3¢) |
| QBank question, delivered | 1.8¢ |
| 50-card deck | 4.1¢ |
| Explain / Expand / Clinical | 0.1–0.3¢ |

The daily budget is **3,250,000 µ$ ($3.25)**. It covers the day it was sized for, five comprehensive sheets, a 50-card deck and forty questions ($3.21), and resets at midnight UTC. An average active student-day since the campaign costs about $0.37.

The deep dive's review runs on `corti-s1`, which reasons. It is about half of a comprehensive sheet's cost, and in the measurement 29% of reviews hit the 100 s timeout, which shows up as "unchecked". Those are recorded as aborted and are not charged to the student.

## Also in this change: closing the open paths

- **`rag-generate` deleted.** No client called it, and it accepted the public key, with no account and no limit, spending Corti and OpenRouter.
- **Explain, Expand, Clinical and personalize** count on a daily `assist` cap of 150, Pro included. They had none. Their replies are capped at 1,200 tokens instead of 8,192.
- **Input ceilings on medical-notes** (`_shared/request-limits.ts`): `notes` up to 5,000 characters (the rule decks and QBank already used), plus the enhance fields.
- **`medical-notes-next` and `medical-notes-corti` locked.** They run the real writer and nothing in production calls them. They now need `STAFF_USER_IDS`, and the spike also accepts its eval user. With the secret unset, they are closed to everyone.

## Deploying

Deployed to production on 2026-11-09, in `record` mode. These steps are for any later environment or a full redeploy.

The order matters. The `assist` count needs the migration's `usage_records` kind check.

1. **Apply the migration** (`supabase db push`, or run it in the SQL editor). It was rehearsed on the live schema inside a rolled-back transaction on 2026-11-07.
2. **Set the secrets:**
   - `STAFF_USER_IDS` lists whoever uses `medical-notes-next` and `medical-notes-corti`.
   - `CREDITS_MODE` can be left unset, which means `record`.
3. **Deploy** `medical-notes`, `medical-notes-next`, `medical-notes-corti`, `qbank-generate`, `qbank-explain` and `anatomy-explain`.
4. **Delete the old function:** `supabase functions delete rag-generate`.
5. **Watch it for a week in record mode** (queries below). Then set `CREDITS_MODE=enforce`.

To roll back, set `CREDITS_MODE=off`. The tables can stay.

## Reading the ledger

```sql
-- Spend per day, and how much of it the students were charged.
select usage_date, count(*) calls, sum(cost_micros) / 1e6 as dollars,
       sum(cost_micros) filter (where charged) / 1e6 as charged_dollars,
       count(*) filter (where estimated) as estimated
from ai_spend group by 1 order by 1 desc;

-- What costs the most.
select feature, model, count(*) calls, round(avg(cost_micros)) avg_micros, sum(cost_micros) / 1e6 dollars
from ai_spend where usage_date > current_date - 7 group by 1, 2 order by dollars desc;

-- The heaviest accounts today, against the budget.
select user_id, count, round(100.0 * count / 3250000, 1) as pct_of_budget
from usage_records where kind = 'credits' and usage_date = current_date order by count desc limit 20;
```

The functions also log one `spend` line per request (`kind`, `mode`, `calls`, `chargedMicros`), and `credits_would_refuse` / `credits_refused` when a hold does not fit.

## Tests

- `src/lib/corti-meter.test.ts` covers the metered client: streams, the usage frame, replies, errors, timeouts and cancels.
- `src/lib/credits-meter.test.ts` covers prices, charge rules, the meter, holds in each mode, request limits and staff.
- The migration was run on PGlite (Postgres) over the live shape of `usage_records`, and rehearsed on the live database inside a transaction that always rolls back.
- End to end, the real `medical-notes` and `qbank-generate` handlers ran locally against Corti with their database faked. Every ledger row matched Corti's reported tokens exactly, refusals in enforce mode spent nothing, and the staff-only copy refused others.
