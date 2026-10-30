import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { EMPTY_REVIEW_QUEUE, parseReviewQueue, type ReviewQueue } from "@/lib/qbank-review-queue";

/** React Query key; invalidated when a set ends, since that changes the queue. */
export const REVIEW_QUEUE_KEY = "qbank-review-queue";

/**
 * Missed and marked questions that are due to come back (see
 * src/lib/qbank-review-queue.ts). Accounts only — the QBank needs one.
 */
export function useQBankReviewQueue() {
  const { user, isAnonymous } = useAuth();
  const enabled = !!user && !isAnonymous;

  const query = useQuery({
    queryKey: [REVIEW_QUEUE_KEY, user?.id ?? null],
    enabled,
    queryFn: async (): Promise<ReviewQueue> => {
      const { data, error } = await supabase.rpc("get_qbank_review_queue");
      if (error) throw error;
      return parseReviewQueue(data);
    },
  });

  return {
    queue: query.data ?? EMPTY_REVIEW_QUEUE,
    isLoading: enabled && query.isLoading,
    error: query.error,
  };
}
