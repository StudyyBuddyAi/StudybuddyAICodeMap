-- Flashcard RAG grounding.
--
-- Two additions, mirroring what the sheet generator already persists:
--
--   decks.grounding_metadata  — deck-level retrieval result. One generation
--     produces one retrieval, shared by every card it emits, so this belongs
--     on the deck rather than the card. NULL = the deck predates grounding.
--
--   cards.grounded            — per-card attribution, driven by the
--     [Grounded]/[General] sourcing tag the model now writes on every Q: line.
--     Retrieval covering the topic does not mean it covered every card.
--
-- No RLS changes: the existing decks/cards policies are row-scoped by
-- user_id and already cover both columns.

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS grounding_metadata jsonb;

COMMENT ON COLUMN public.decks.grounding_metadata IS
  'RAG retrieval result for the most recent generation of this deck.
   Shape: { retrievedChunks: number, groundingLevel: "full"|"partial"|"none",
            sources: RagChunk[] }
   NULL means the deck was created before grounding was added (legacy).';

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS grounded boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cards.grounded IS
  'true = this card was generated with a retrieved guideline chunk in context.
   false = general knowledge or pre-grounding legacy card.';
