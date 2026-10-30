import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  FREE_DAILY_QBANK_QUESTIONS,
  QBANK_USAGE_KIND,
} from "../../supabase/functions/_shared/qbank-allowance.ts";

export const MAX_DAILY_SHEETS = 5;
export const MAX_DAILY_CARDS = 5;
/** Delivered QBank questions per day for a free account; Pro is unlimited. */
export const MAX_DAILY_QBANK_QUESTIONS = FREE_DAILY_QBANK_QUESTIONS;

interface ProfileRow {
  is_pro: boolean;
  pro_expires_at: string | null;
}

interface UsageRow {
  kind: string;
  count: number;
}

const todayUtc = () => new Date().toISOString().split("T")[0];

export function useUsageLimit() {
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
    queryKey: ["usage", userId, today],
    enabled: !!userId,
    queryFn: async (): Promise<UsageRow[]> => {
      const { data, error } = await supabase
        .from("usage_records")
        .select("kind, count")
        .eq("user_id", userId!)
        .eq("usage_date", today);
      if (error) throw error;
      return data ?? [];
    },
  });

  const profile = profileQuery.data ?? null;
  const isProUser =
    !isAnonymous &&
    profile?.is_pro === true &&
    (profile.pro_expires_at === null ||
      new Date(profile.pro_expires_at) > new Date());

  const sheetCount =
    usageQuery.data?.find((r) => r.kind === "sheet")?.count ?? 0;
  const cardsCount =
    usageQuery.data?.find((r) => r.kind === "cards")?.count ?? 0;

  // Counted server-side by qbank-generate, which reserves a wave and hands back
  // what it did not deliver — so this is delivered questions, as the cap is.
  const qbankCount =
    usageQuery.data?.find((r) => r.kind === QBANK_USAGE_KIND)?.count ?? 0;
  /** Null for Pro: unlimited. */
  const qbankRemaining = isProUser ? null : Math.max(0, MAX_DAILY_QBANK_QUESTIONS - qbankCount);

  const isSheetLimited = sheetCount >= MAX_DAILY_SHEETS && !isProUser;
  const isCardsLimited = cardsCount >= MAX_DAILY_CARDS && !isProUser;

  // Counts are now incremented server-side (medical-notes edge fn via the
  // consume_usage RPC); the client no longer writes usage_records. `refresh`
  // re-reads today's counts so the display reflects the server-side increment
  // after a successful generation.
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["usage", userId, today] });

  return {
    sheetCount,
    cardsCount,
    isSheetLimited,
    isCardsLimited,
    qbankCount,
    qbankRemaining,
    isProUser: !!isProUser,
    isLoading: profileQuery.isLoading || usageQuery.isLoading,
    refresh,
  };
}
