-- RAG Conversation Memory Tables
-- Sliding window of 10 interactions per authenticated user

-- rag_memory_state: tracks current window_id and turn_count per user
CREATE TABLE IF NOT EXISTS public.rag_memory_state (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_window_id uuid NOT NULL DEFAULT gen_random_uuid(),
    turn_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- rag_conversation_memory: stores Q/A pairs per window
CREATE TABLE IF NOT EXISTS public.rag_conversation_memory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    window_id uuid NOT NULL,
    turn_number integer NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient history lookup
CREATE INDEX IF NOT EXISTS idx_rag_conversation_memory_user_window
    ON public.rag_conversation_memory (user_id, window_id, turn_number);

-- Enable RLS
ALTER TABLE public.rag_memory_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_conversation_memory ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only access their own memory
CREATE POLICY "Users can view own memory state"
    ON public.rag_memory_state
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memory state"
    ON public.rag_memory_state
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own memory state"
    ON public.rag_memory_state
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view own conversation memory"
    ON public.rag_conversation_memory
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversation memory"
    ON public.rag_conversation_memory
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Note: UPDATE/DELETE not needed for conversation_memory (append-only)
-- Edge function uses service role key which bypasses RLS