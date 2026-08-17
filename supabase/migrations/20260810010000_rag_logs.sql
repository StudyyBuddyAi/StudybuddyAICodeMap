-- Audit logging table for RAG queries and generations
create table if not exists public.rag_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  feature text default 'general',
  query text not null,
  grounded boolean not null default false,
  source_ids text[] default '{}',
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.rag_logs enable row level security;

-- Users can read their own logs
create policy if not exists "Users can read own rag logs"
  on public.rag_logs
  for select
  using (auth.uid() = user_id);

-- Note: edge function writes using service_role key, bypassing RLS
