import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { historyStart, summarizeCredits, timeUntilReset, utcDay } from "@/lib/daily-credits";

/**
 * Today's usage limit and the week behind it. The count is written by the
 * spend ledger's trigger (20261107000000_credits_meter.sql) as each AI call
 * finishes; the client only reads it.
 */
export function useDailyCredits(enabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // The countdown, and the day the query is keyed on, move with the clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [enabled]);

  const today = utcDay(now);
  const query = useQuery({
    queryKey: ["credits", userId, today],
    enabled: !!userId && enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_records")
        .select("usage_date, count")
        .eq("user_id", userId!)
        .eq("kind", "credits")
        .gte("usage_date", historyStart(new Date(`${today}T12:00:00Z`)));
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    credits: query.data ? summarizeCredits(query.data, now) : null,
    resetsIn: timeUntilReset(now),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
