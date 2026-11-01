-- Where a card was written from, when it was the student's own material: their
-- sheet, or the QBank questions they answered (medical-notes deckSource). Null
-- for a deck written on a topic. The card shows it in place of the
-- grounded/unverified badge (early-access feedback: exam students trust what
-- they studied, not a research paper).
alter table public.cards
  add column if not exists origin text
  check (origin is null or origin in ('sheet', 'qbank'));
