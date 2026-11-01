-- Migration: the full explanation of each QBank question, written once.
--
-- qbank-explain writes a deeper explanation than the generator's own — the
-- concept in depth, every option, a comparison table, the algorithm as a
-- figure (early-access feedback: the explanation was too short, and USMLE
-- students want tables and figures). One per question, whoever opens it
-- first, so the cost is bounded by the questions that exist.
--
-- It names the keyed answer, so nobody reads this table directly: there is no
-- policy, and the edge function (service role) serves a row only to a student
-- who has answered the question. A row the writer disputed (it doubted the
-- key) is kept for review and never served.

create table if not exists public.question_explanations (
  question_id    uuid primary key references public.questions(id) on delete cascade,
  status         text not null check (status in ('explained', 'disputed')),
  content        jsonb,
  dispute_reason text,
  model          text,
  prompt_version text not null,
  created_at     timestamptz not null default now(),
  check ((status = 'explained') = (content is not null))
);

alter table public.question_explanations enable row level security;
