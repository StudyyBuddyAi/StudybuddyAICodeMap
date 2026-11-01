import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FullExplanation } from "../../supabase/functions/_shared/qbank-explain.ts";

export type { FullExplanation };

/** What qbank-explain answers: the explanation, or "held" while a doubt about the key is reviewed. */
export type FullExplanationResult = { status: "explained"; explanation: FullExplanation } | { status: "held" };

const URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbank-explain`;

/** The house pattern (src/lib/callAnatomy.ts): the session's token, attached explicitly. */
async function fetchFullExplanation(questionId: string): Promise<FullExplanationResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ questionId }),
  });
  if (!response.ok) throw new Error(`qbank-explain failed: ${response.status}`);
  return (await response.json()) as FullExplanationResult;
}

/**
 * A graded question's full explanation (supabase/functions/qbank-explain).
 * Written once per question on the server and cached there, and kept for the
 * session here, so flipping back to a question never asks again.
 */
export function useFullExplanation(questionId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["qbank-explain", questionId],
    enabled: !!questionId && enabled,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    // A write takes ~15 s; one retry covers a cold start, more only repeats a failure.
    retry: 1,
    queryFn: () => fetchFullExplanation(questionId!),
  });
}
