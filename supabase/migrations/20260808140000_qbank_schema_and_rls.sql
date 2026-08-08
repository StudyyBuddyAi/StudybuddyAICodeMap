-- QBank schema + RLS retrofit (Phase 5 / audit problem: QBank tables untracked)
--
-- PROBLEM
--   questions / media / question_media / user_attempts / qbank_sessions were
--   created directly in the Supabase dashboard, so the repo had no CREATE TABLE
--   and no verifiable RLS posture for any of them. This file retro-fits the
--   schema and permissive-but-own-row RLS policies that match how the client
--   actually uses them today. flagged_questions is already tracked (see
--   20260604000000 + 20260605000000 + 20260708140000) and is not recreated here.
--
-- SAFETY
--   * Purely additive: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
--     CREATE INDEX IF NOT EXISTS. Against the live DB every DDL is a no-op.
--   * RLS is enabled idempotently and each policy is guarded with DROP POLICY IF
--     EXISTS so re-runs cannot collide.
--   * Policies are behavior-preserving for today's client:
--       - questions / media / question_media: SELECT to anon + authenticated
--         (answer-key columns remain privilege-blocked by 20260708130000's
--         column REVOKE; RLS only filters rows, it cannot re-expose them).
--       - qbank_sessions / user_attempts: own-row SELECT + DELETE. Writes go
--         through the SECURITY DEFINER RPCs (start_qbank_session,
--         submit_answer, end_qbank_session) which run as the owner and bypass
--         RLS, so nothing changes for them.
--
-- VERIFY BEFORE APPLYING
--   Column/constraint state is inferred from src/integrations/supabase/types.ts
--   and the RPC bodies in 20260708120000_qbank_server_grading.sql. Diff the live
--   tables first (supabase db diff). If the live DB already has RLS enabled with
--   policies, dropping them here in favour of the ones below is a decision to
--   make deliberately, not by accident.
--
-- NOTE ON FRESH BUILDS
--   Earlier migrations in this repo already reference these tables (e.g.
--   20260604000000 creates flagged_questions with a FK to questions), so a
--   from-scratch `supabase db reset` is NOT possible from the current migration
--   chain. This file documents the live schema for reference; the chain remains
--   a layered retrofit of an existing database.

-- ── questions ───────────────────────────────────────────────────────────────
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  domain text not null,
  topic text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  reasoning_order text not null check (reasoning_order in ('1st', '2nd', '3rd')),
  competency text not null,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  option_e text not null,
  correct_option text not null check (correct_option in ('a', 'b', 'c', 'd', 'e')),
  explanation text not null,
  teaching_point text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  external_id text
);

-- ── media ───────────────────────────────────────────────────────────────────
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  file_url text not null,
  media_type text not null check (media_type in (
    'ecg',
    'histology_slide',
    'chest_xray',
    'anatomical_diagram',
    'action_potential_diagram',
    'pressure_volume_diagram'
  )),
  tags text[] not null default '{}',
  description text not null,
  source_url text not null,
  license text not null check (license in ('CC0', 'CC-BY', 'public_domain', 'ODC-BY', 'proprietary')),
  attribution text,
  created_at timestamptz not null default now()
);

-- ── question_media ──────────────────────────────────────────────────────────
create table if not exists public.question_media (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete cascade,
  display_order int not null default 0,
  caption text,
  display_context text not null default 'both' check (display_context in ('stem', 'explanation', 'both'))
);

-- ── qbank_sessions ──────────────────────────────────────────────────────────
-- status / question_ids were added by 20260708120000_qbank_server_grading.sql;
-- they are included in the CREATE so a table built from scratch here matches,
-- and re-added idempotently below for live DBs where the CREATE is a no-op.
create table if not exists public.qbank_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  score int not null default 0,
  total int not null default 0,
  total_time_ms bigint not null default 0,
  system text not null,
  created_at timestamptz not null default now(),
  status text not null default 'completed',
  question_ids uuid[]
);

alter table public.qbank_sessions
  add column if not exists status text not null default 'completed',
  add column if not exists question_ids uuid[];

-- ── user_attempts ───────────────────────────────────────────────────────────
create table if not exists public.user_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_option text not null check (selected_option in ('a', 'b', 'c', 'd', 'e')),
  is_correct boolean not null,
  time_taken_ms int,
  attempted_at timestamptz not null default now(),
  session_id uuid references public.qbank_sessions(id) on delete cascade
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists idx_questions_active   on public.questions(is_active);
create index if not exists idx_questions_subject  on public.questions(subject);
create index if not exists idx_questions_domain   on public.questions(domain);
create index if not exists idx_question_media_qid on public.question_media(question_id);
create index if not exists idx_qbank_sessions_uid on public.qbank_sessions(user_id);
create index if not exists idx_user_attempts_sid  on public.user_attempts(session_id);
create index if not exists idx_user_attempts_uid  on public.user_attempts(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.questions       enable row level security;
alter table public.media           enable row level security;
alter table public.question_media  enable row level security;
alter table public.qbank_sessions  enable row level security;
alter table public.user_attempts   enable row level security;

-- questions: any signed-in or anon user may read stems/meta. Answer-key columns
-- are NOT selectable at the privilege layer (20260708130000 column REVOKE), so a
-- row-permissive policy cannot leak them.
drop policy if exists "QBank can read questions" on public.questions;
create policy "QBank can read questions"
  on public.questions for select
  to anon, authenticated
  using (true);

drop policy if exists "QBank can read media" on public.media;
create policy "QBank can read media"
  on public.media for select
  to anon, authenticated
  using (true);

drop policy if exists "QBank can read question_media" on public.question_media;
create policy "QBank can read question_media"
  on public.question_media for select
  to anon, authenticated
  using (true);

-- Sessions + attempts are owned rows; the client reads its own history and
-- deletes its own sessions/attempts. Writes stay exclusively in the SECURITY
-- DEFINER RPCs, which bypass RLS as the table owner.
drop policy if exists "Users can view own sessions" on public.qbank_sessions;
create policy "Users can view own sessions"
  on public.qbank_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own sessions" on public.qbank_sessions;
create policy "Users can delete own sessions"
  on public.qbank_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can view own attempts" on public.user_attempts;
create policy "Users can view own attempts"
  on public.user_attempts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own attempts" on public.user_attempts;
create policy "Users can delete own attempts"
  on public.user_attempts for delete
  to authenticated
  using (auth.uid() = user_id);
