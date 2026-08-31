import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { LIMITS, isWithinLimit, limitFor, tierOf } from "@/config/product";

interface ProfileRow {
  is_pro: boolean;
  pro_expires_at: string | null;
}

interface CitationUsageRow {
  count: number;
}

// Re-exported from src/config/product.ts, the single source for every quota the
// UI states or enforces. Kept as named exports so consumers and the parity test
// keep a stable import path.
export const ANON_CITATION_LIMIT = LIMITS.citations.anon;
export const FREE_CITATION_LIMIT = LIMITS.citations.free;

const todayUtc = () => new Date().toISOString().split("T")[0];

/**
 * Display-only citation usage. The get-citations edge function is the ONLY
 * writer of citation_usage (via the service-role consume_citation / refund_citation
 * RPCs), so the client never increments anything. Anonymous users are tracked in
 * the DB under their real (anon) Supabase id, which survives anonymous→account
 * upgrades — the old localStorage counter (sb_anon_citation) is obsolete.
 *
 * `canUseCitation` is a UI hint: the server still enforces the real limit and
 * answers quota-exceeded lookups itself, so a stale count can never bypass it.
 */
export function useCitationUsage() {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const today = todayUtc();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_pro, pro_expires_at")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const usageQuery = useQuery({
    queryKey: ["citation_usage", userId, today],
    enabled: !!userId,
    queryFn: async (): Promise<CitationUsageRow | null> => {
      const { data, error } = await supabase
        .from("citation_usage")
        .select("count")
        .eq("user_id", userId!)
        .eq("usage_date", today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profile = profileQuery.data ?? null;
  const isProUser =
    profile?.is_pro === true &&
    (profile.pro_expires_at === null ||
      new Date(profile.pro_expires_at) > new Date());

  const citationCount = usageQuery.data?.count ?? 0;
  const tier = tierOf({ isPro: !!isProUser, isAnonymous: !!isAnonymous });
  const citationLimit = limitFor("citations", tier);
  const canUseCitation = isWithinLimit(citationCount, "citations", tier);

  const refreshCitation = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: ["citation_usage", userId, today],
    });
  };

  return {
    citationCount,
    citationLimit,
    /** Remaining uses today; `Infinity` for Pro. */
    citationsRemaining: Math.max(0, citationLimit - citationCount),
    canUseCitation,
    isProUser: !!isProUser,
    isLoggedIn: !!user && !isAnonymous,
    refreshCitation,
    isLoading: profileQuery.isLoading || usageQuery.isLoading,
  };
}
