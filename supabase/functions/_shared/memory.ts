import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

/** Sliding window size: after this many turns, the next request rolls over to a fresh window. */
export const MEMORY_WINDOW_TURNS = 10;

/** Character budget for the whole injected history block (whole turns dropped, oldest first, to fit). */
export const MEMORY_CHAR_BUDGET = 4000;

/** Per-field trim applied to both the user and assistant side of a turn. */
const FIELD_CHAR_LIMIT = 500;

export type MemoryTurn = { role: "user" | "assistant"; content: string };

export function trim500(text: string): string {
  return text.trim().slice(0, FIELD_CHAR_LIMIT);
}

/**
 * Follow-up resolution instruction appended to systemPrompt when history is
 * non-empty. Wording lifted from rag-generate/index.ts, which has carried
 * this exact rule since the conversation-memory feature was first built.
 */
export const MEMORY_FOLLOWUP_INSTRUCTION =
  '\n\nIMPORTANT: You have access to the previous conversation history between you and this user (provided as prior user/assistant message pairs). Use this context to understand follow-up questions, resolve pronouns (e.g., "it", "that", "the same"), and maintain continuity. If the user refers to something from a previous turn, answer in that context.';

/**
 * Resolves the user's current memory window, creating the rag_memory_state
 * row on first use. Never throws — returns null on any failure, which the
 * caller treats as "memory unavailable this request" (fail-open, same as
 * grounding retrieval).
 */
export async function openMemoryWindow(
  sb: SupabaseClient,
  userId: string
): Promise<{ windowId: string; turnCount: number } | null> {
  try {
    const { data: existing, error: selectErr } = await sb
      .from("rag_memory_state")
      .select("current_window_id, turn_count")
      .eq("user_id", userId)
      .maybeSingle();
    if (selectErr) throw selectErr;
    if (existing) {
      return { windowId: existing.current_window_id, turnCount: existing.turn_count };
    }

    const { data: inserted, error: insertErr } = await sb
      .from("rag_memory_state")
      .insert({ user_id: userId })
      .select("current_window_id, turn_count")
      .single();
    if (!insertErr) {
      return { windowId: inserted.current_window_id, turnCount: inserted.turn_count };
    }

    // user_id is the primary key — a concurrent first-ever request may have
    // inserted the row a moment ago. Re-read rather than treat this as fatal.
    const { data: retry } = await sb
      .from("rag_memory_state")
      .select("current_window_id, turn_count")
      .eq("user_id", userId)
      .maybeSingle();
    if (retry) return { windowId: retry.current_window_id, turnCount: retry.turn_count };
    throw insertErr;
  } catch {
    return null;
  }
}

/**
 * Fetches the current window's turns, most recent MEMORY_WINDOW_TURNS only,
 * oldest-first, then trims to MEMORY_CHAR_BUDGET by dropping whole oldest
 * turns until the block fits. Never throws — returns [] on failure.
 *
 * Queries descending + reverses in JS rather than ascending + limit: while a
 * window holds more than MEMORY_WINDOW_TURNS rows (orphans from a failed
 * claim, or a race), ascending+limit would return the *oldest* ten instead
 * of the ten that actually matter.
 */
export async function readMemoryTurns(
  sb: SupabaseClient,
  userId: string,
  windowId: string
): Promise<MemoryTurn[]> {
  try {
    const { data, error } = await sb
      .from("rag_conversation_memory")
      .select("question, answer")
      .eq("user_id", userId)
      .eq("window_id", windowId)
      .neq("answer", "") // skip turns whose stream died before flush() completed it
      .order("turn_number", { ascending: false })
      .limit(MEMORY_WINDOW_TURNS);
    if (error) throw error;

    const rows = (data ?? []).slice().reverse(); // oldest -> newest
    const pairs: [MemoryTurn, MemoryTurn][] = rows.map((row) => [
      { role: "user", content: row.question },
      { role: "assistant", content: row.answer },
    ]);
    return capToBudget(pairs);
  } catch {
    return [];
  }
}

function capToBudget(pairs: [MemoryTurn, MemoryTurn][]): MemoryTurn[] {
  let total = pairs.reduce((sum, [u, a]) => sum + u.content.length + a.content.length, 0);
  let start = 0;
  // Always keep at least the most recent turn, even if it alone exceeds budget.
  while (total > MEMORY_CHAR_BUDGET && start < pairs.length - 1) {
    const [u, a] = pairs[start];
    total -= u.content.length + a.content.length;
    start++;
  }
  return pairs.slice(start).flat();
}

/**
 * Claims the next turn number atomically — rolling the window over first if
 * it is already full — and inserts the user side with a placeholder ("")
 * answer. Must be called and awaited before the OpenRouter fetch, using the
 * turnCount `openMemoryWindow` returned moments earlier.
 *
 * Both branches are a compare-and-swap on that turnCount: a zero-row result
 * means another concurrent request (or a rollover) claimed the turn first,
 * in which case this returns null and the caller skips memory for this
 * request rather than risk a duplicate/skipped turn_number.
 *
 * Rollover happens *inside* this same guarded update, not later in
 * completeTurn: deferring it would leave a gap in which a request reads
 * turn_count === 10, passes the CAS, writes turn_number 11 into the window
 * about to be retired, and then can never complete because that window no
 * longer matches current_window_id.
 */
export async function writeUserTurn(
  sb: SupabaseClient,
  userId: string,
  windowId: string,
  turnCount: number,
  question: string
): Promise<{ rowId: string; turnNumber: number; windowId: string } | null> {
  try {
    const update =
      turnCount < MEMORY_WINDOW_TURNS
        ? { current_window_id: windowId, turn_count: turnCount + 1 }
        : { current_window_id: crypto.randomUUID(), turn_count: 1 };

    const { data: claim, error: claimErr } = await sb
      .from("rag_memory_state")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("current_window_id", windowId)
      .eq("turn_count", turnCount)
      .select("current_window_id, turn_count")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claim) return null; // lost the race — memory unavailable this request

    const { data: inserted, error: insertErr } = await sb
      .from("rag_conversation_memory")
      .insert({
        user_id: userId,
        window_id: claim.current_window_id,
        turn_number: claim.turn_count,
        question: trim500(question),
        answer: "",
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    return { rowId: inserted.id, turnNumber: claim.turn_count, windowId: claim.current_window_id };
  } catch {
    return null;
  }
}

/**
 * Fills in the assistant side of an already-claimed turn. One write,
 * addressed by primary key — rollover was already settled by writeUserTurn,
 * so this never touches rag_memory_state. Must be awaited inside the
 * TransformStream's flush() before the controller closes: the Deno isolate
 * can be torn down the instant the response completes, and a fire-and-forget
 * write here would silently lose the turn.
 */
export async function completeTurn(sb: SupabaseClient, rowId: string, answer: string): Promise<void> {
  try {
    await sb.from("rag_conversation_memory").update({ answer }).eq("id", rowId);
  } catch {
    // best effort — a failed memory write must never fail the request
  }
}
