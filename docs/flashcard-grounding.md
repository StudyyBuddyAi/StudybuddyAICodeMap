# Flashcard RAG Grounding

Brings the flashcard generator to parity with the sheet generator's grounding
system, and adds three things sheets never had: **per-card** attribution,
**persistence** across sessions, and an honest verdict on **legacy** cards.

Branch: `feature/flashcards-rag-grounding` (from `main`).

---

## Why this was mostly a client-side change

The `medical-notes` edge function already ran retrieval for cards. Grounding is
enabled whenever the request is not `enhanceMode` / `explainMode`, and
`cardsOnly: true` satisfies that. It already injected `groundingContextBlock`
into the card prompts and already emitted the `__meta` SSE event carrying
`{ retrievedChunks, sources }`.

The client simply never listened. Cards were being generated *from* guideline
context while the UI said nothing about it, and nothing was persisted.

The one genuine server change is the **sourcing tag** (below), which is what
makes per-card attribution possible at all.

---

## The model now labels each card's source

Retrieval covering a topic does not mean it covered every card. A deck on
myocardial infarction can pull three guideline chunks about management and still
contain a card on embryology that nothing in the library touched.

So both card prompts (`haikuCardsPrompt` and `gptOssCardsPrompt` in
`supabase/functions/medical-notes/index.ts`) now ask for a **second bracket** on
every `Q:` line, alongside the existing clinical tag:

```
Q: [Mechanism][Grounded] Question text ending with question mark?
A: Answer in 1-2 sentences maximum.

Q: [Next Step][General] Question for a topic not in the context?
A: Answer.
```

- `[Grounded]` — the card's content comes from the retrieved Context block.
- `[General]` — no retrieved context covers it.
- If no Context was provided at all, every card must be `[General]`.

The clinical tag list is unchanged.

### Parsing it back out

`src/lib/parse-flashcards.ts` now reads the whole leading bracket run and
**classifies each bracket by content, not by position** — the model does not
reliably honour ordering, and older output has only one bracket:

```ts
const tagBlockMatch = question.match(/^(?:\s*\[[^\]]+\])+/);
```

Each bracket is either a known sourcing tag (`grounded` / `general`,
case-insensitive) or a clinical tag. The first clinical tag wins; a missing
sourcing tag means `grounded: false`.

`ParsedCard` gained `grounded: boolean`.

> **False is the deliberate default.** A card with no sourcing tag genuinely was
> not verified against a guideline, so claiming otherwise would be the only
> wrong answer here.

---

## Two grounding signals, two places to store them

| Signal | Grain | Stored on | Why |
|---|---|---|---|
| Which guideline chunks were retrieved, and the deck's overall verdict | Deck | `decks.grounding_metadata` (jsonb) | One generation runs one retrieval. Every card it emits shares it. |
| Whether *this* card used that context | Card | `cards.grounded` (boolean, default false) | Retrieval covering the topic ≠ covering every card. |

Migration: `supabase/migrations/20260825000000_flashcard_grounding.sql`

No RLS changes — the existing `decks` / `cards` policies are row-scoped by
`user_id` and already cover both columns.

`src/integrations/supabase/types.ts` was updated by hand to match (`grounded` on
`cards`, `grounding_metadata` on `decks`, in Row/Insert/Update).

---

## Deriving the deck-level verdict

`groundingLevelFromCards(retrievedChunks, cards)` in `src/lib/grounding.ts`:

| Retrieved | Cards tagged `[Grounded]` | Level |
|---|---|---|
| 0 | anything | `none` |
| > 0 | none of them | `none` |
| > 0 | some of them | `partial` |
| > 0 | all of them | `full` |

Retrieval stays the **ceiling**, exactly as `reconcileGroundingLevel` treats
sheets: the model's tags can only weaken the verdict, never invent one. Zero
chunks forces `none` no matter what the model wrote.

The "retrieved something, grounded nothing" row is the case worth naming — the
library matched the query but none of it survived into a card, which is
materially the same as not being covered.

---

## Client flow

### `FlashcardsGenerator.tsx`

1. **`__meta` interception.** Parsed and stashed in `groundingResultRef` *before*
   the `delta.content` read, then `continue` — otherwise the metadata event falls
   through into `fullText` and gets parsed as flashcard text.
2. **Grounding controls sent.** `useGrounding`, `topK: 8`, `threshold: 0.60`.
   Only the on/off toggle is user-facing; the two numbers live in state so
   they're tunable in one place if the retrieval quality needs adjusting.
3. **Verdict built after parsing**, using `groundingLevelFromCards`. If no
   `__meta` arrived at all, the deck is recorded as `{ retrievedChunks: 0, level:
   "none" }` rather than left unlabelled — the generation genuinely ran
   ungrounded.
4. **Passed to `saveCards(cards, groundingMeta)`.**

> **Why a ref for `pendingGrounding`.** The save fires inside the long-lived
> loading-message `setInterval` closure, whose deps are `[loading]`. Reading the
> state variable there would capture the value from before generation finished.
> `pendingGroundingRef` is what that closure reads; the state variable exists
> only for rendering.

**UI:** a Guideline Grounding On/Off toggle in Step 2 (matching the existing
pill-group pattern), and after generation a `GroundingNotice` plus `SheetSources`
listing the retrieved chunks — both reused as-is from the sheet generator.

The notice distinguishes three "none" cases, which it words very differently:

| Condition | `reason` |
|---|---|
| Grounding toggled off for this run | `disabled` |
| On, `retrievedChunks === 0` | `no-match` |
| On, chunks retrieved but no card used them | `not-relevant` |

`pendingGroundingRequested` records the toggle state *at generation time*, so
flipping the toggle afterwards doesn't relabel a finished deck.

### `use-flashcard-deck.ts`

- `Card` gained `grounded: boolean`; `NewCardInput` and `CardRow` follow.
- `saveCards(incoming, groundingMeta?)` writes `grounded` per card row, and
  `grounding_metadata` on the deck upsert — **only when metadata is present**.
  Omitting the key leaves an existing deck's grounding untouched rather than
  nulling it out on a regeneration that arrived without `__meta`.
- Deck upsert now passes `ignoreDuplicates: false` so the metadata actually
  updates on re-generation instead of being skipped.
- `loadCards()` normalizes `grounded ?? false` so localStorage decks written
  before this change read as booleans.
- New `useDeckGrounding(topic)` hook reads `decks.grounding_metadata`. Fails
  soft: a missing deck or a transient error returns `null`, because this drives
  a badge, not an error state.
- `saveCards` invalidates `["deck-grounding", userId]` alongside `["flashcards",
  userId]`, or a regeneration leaves the stale verdict on screen.

### `StudyMode.tsx`

- `CardFace` shows an amber **Unverified** badge when `!card.grounded`. There is
  deliberately **no** "Grounded" badge on the positive case — a chip on nearly
  every card is noise on the one surface meant to stay quiet.
- A session-level warning above the card stack when any card is ungrounded,
  wording itself differently for all-vs-some.

### `DeckList.tsx`

Each deck row carries a badge from a small `DeckGroundingBadge` component
(its own component so it can call the per-deck hook):

| Level | Badge |
|---|---|
| `full` | green **Grounded** |
| `partial` | amber **Partial** |
| `none` / unknown | grey **Unverified** |

It prefers `useDeckGrounding(topic)`, and **falls back to aggregating each
card's own `grounded` flag** when there is no metadata. That fallback is what
makes the badge correct for anonymous users, whose decks live in localStorage
and have no `decks` row at all — a spec-literal metadata-only badge would have
labelled every anonymous deck "Unverified" regardless of the truth.

### `SheetGenerator.tsx`

The sheet's "save to deck" button had to supply `grounded` for the new type. It
inherits the sheet's own verdict, narrowed by the model's coverage report:
`full`, or `partial` where `sourceCoverage.uncovered` does **not** list
`flashcards`. The sheet's retrieval metadata is passed through to the deck too.

---

## Legacy cards: no backfill

`cards.grounded` defaults to `false`, so every card written before this
migration reads as ungrounded, shows the **Unverified** badge, and counts toward
the session warning. `decks.grounding_metadata` stays `NULL` and the badge falls
back to the card aggregate, which is also all-false.

That is the correct verdict, not a degraded one — those cards were generated
before grounding existed and were never checked against a guideline.

---

## Tests

`npm test` → 97 passing (was 83).

- `src/test/parse-flashcards.test.ts` — 9 new cases covering the two-tag branch:
  both orderings, whitespace between brackets, case-insensitivity, one-tag and
  no-tag legacy output, extra clinical tags, and a `[sic]` bracket mid-question
  that must survive.
- `src/lib/grounding.test.ts` — 5 new cases for `groundingLevelFromCards`,
  including the two `none` paths.

Per the spec, the SSE interception and the prompt text itself are **not**
covered by automated tests. If the model's output format drifts, these are the
two places that will catch it:

1. `parseFlashcardsFromOutput` — the two-tag extraction branch.
2. `use-flashcard-deck.saveCards` — the `grounding_metadata` upsert.

`npm run typecheck` clean. `npm run lint` unchanged from baseline (19
pre-existing warnings, 0 errors).

---

## Deploy status

Both target the shared remote Supabase project `ntubppijiiwahogpnrxx`.

### Migration — APPLIED

`supabase db push` was initially blocked by pre-existing drift in the migration
history, unrelated to this work:

- remote carried `20260823192809` with no local file (a dashboard-applied
  squash), and
- four local migrations (`20260721000000`, `20260805000000`, `20260810010000`,
  `20260810020000`) showed as unapplied.

Probing the live schema over PostgREST confirmed all four were already present
(`rag_logs`, `rag_conversation_memory`, `curriculum_topics.yield_tier` all
resolve), so the history table was stale, not the schema. Repaired with:

```bash
supabase migration repair --status applied 20260721000000 20260805000000 20260810010000 20260810020000
supabase migration repair --status reverted 20260823192809
supabase db push          # applied 20260825000000 only
```

Only the history table was edited; no schema object was re-created. Verified
after the push: `cards.grounded` and `decks.grounding_metadata` both resolve.

### Edge function — HELD, deliberately

`supabase functions deploy medical-notes` has **not** been run.

Deploying the sourcing-tag prompt ahead of this frontend would regress the live
site. `main`'s parser strips only the first bracket:

```ts
const tagMatch = question.match(/^\s*\[([^\]]+)\]\s*/);
```

so `[Mechanism][Grounded] Why?` would reach production users as a card question
reading literally `[Grounded] Why?`. The function should ship **with or after**
this branch merges — or behind a defensive patch to `main`'s parser.

Until it ships, the model emits no sourcing tag, so every card parses as
ungrounded and reads "Unverified". Everything else — the toggle, `__meta`
interception, the notice, the sources panel, deck badges, persistence — is fully
exercisable today.

---

## Manual test plan

| Scenario | Expected |
|---|---|
| Well-covered topic (e.g. *Myocardial Infarction*) | `__meta` shows `retrievedChunks > 0`; most cards tagged `[Grounded]`; Guideline Sources panel lists the chunks; deck badge **Grounded** or **Partial** |
| Obscure topic | `retrievedChunks = 0`; all cards `[General]`; "we don't have this topic in our reference library" notice; **Unverified** on every card in Study Mode |
| Grounding toggled **Off** | `useGrounding: false` sent, edge function skips retrieval; notice says the library was turned off for this deck |
| Pre-migration deck reopened | All cards **Unverified**, session warning appears, deck badge grey |
| Regenerate a grounded deck | Deck badge and sources refresh rather than showing the previous run's verdict |

> Rows mentioning `[Grounded]` / `[General]` tags depend on the edge function
> deploy above. Until then, retrieval and the sources panel behave exactly as
> described, but every card parses as ungrounded, so deck badges read
> **Unverified** and the deck-level verdict resolves to `none`.

Dev server for manual testing: `npm run dev` → http://localhost:8081/
(port 8080 was already occupied).
