import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_SRS_SETTINGS,
  RETENTION_MAX,
  RETENTION_MIN,
  SrsState,
  clampRetention,
  studyDayStart,
  type SrsSettings,
} from "@/lib/spaced-repetition";

/**
 * Per-user FSRS settings and what has been used of today's limits.
 *
 * Signed-in users keep settings on `profiles` (written through set_srs_settings)
 * and read today's counts from review_sessions. Anonymous users keep both in
 * localStorage; the anonymous deck hook bumps the daily counter as it reviews.
 */

export interface SrsSettingsInfo extends SrsSettings {
  weightsUpdatedAt: number | null;
  weightsReviewCount: number | null;
  weightsLogLoss: number | null;
}

export interface SrsToday {
  newCards: number;
  reviews: number;
  /** Every review this user has logged (server only; the optimizer threshold). */
  totalReviews: number | null;
}

const SETTINGS_KEY = "studybuddy_srs_settings_v1";
const DAILY_KEY = "studybuddy_srs_daily_v1";
const DAILY_CHANGE_EVENT = "studybuddy:srs-daily-changed";
const SETTINGS_CHANGE_EVENT = "studybuddy:srs-settings-changed";

function clampInt(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(9999, Math.max(0, Math.round(v)));
}

export function normalizeSettings(raw: Partial<SrsSettings> | null | undefined): SrsSettings {
  return {
    desiredRetention: clampRetention(raw?.desiredRetention ?? DEFAULT_SRS_SETTINGS.desiredRetention),
    newPerDay: clampInt(raw?.newPerDay, DEFAULT_SRS_SETTINGS.newPerDay),
    maxReviewsPerDay: clampInt(raw?.maxReviewsPerDay, DEFAULT_SRS_SETTINGS.maxReviewsPerDay),
    weights: Array.isArray(raw?.weights) ? (raw!.weights as number[]) : null,
  };
}

function loadLocalSettings(): SrsSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SRS_SETTINGS };
  }
}

type DailyRecord = { dayStart: number; newCards: number; reviews: number };

function loadLocalDaily(now = Date.now()): DailyRecord {
  const dayStart = studyDayStart(now);
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const parsed = raw ? (JSON.parse(raw) as DailyRecord) : null;
    if (parsed && parsed.dayStart === dayStart) return parsed;
  } catch {
    // fall through
  }
  return { dayStart, newCards: 0, reviews: 0 };
}

/** Count one anonymous review against today's limits. */
export function recordLocalReview(stateBefore: number, now = Date.now()) {
  const daily = loadLocalDaily(now);
  if (stateBefore === SrsState.New) daily.newCards += 1;
  else if (stateBefore === SrsState.Review) daily.reviews += 1;
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(daily));
    window.dispatchEvent(new CustomEvent(DAILY_CHANGE_EVENT));
  } catch {
    // ignore
  }
}

export function srsTodayKey(userId: string | null) {
  return ["srs-today", userId] as const;
}

export function useSrsSettings() {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;
  const queryClient = useQueryClient();

  const [localSettings, setLocalSettings] = useState<SrsSettings>(() => loadLocalSettings());
  const [localDaily, setLocalDaily] = useState<DailyRecord>(() => loadLocalDaily());

  // Several components hold this hook; keep their localStorage copies in step.
  useEffect(() => {
    if (useServer) return;
    const refreshDaily = () => setLocalDaily(loadLocalDaily());
    const refreshSettings = () => setLocalSettings(loadLocalSettings());
    window.addEventListener(DAILY_CHANGE_EVENT, refreshDaily);
    window.addEventListener(SETTINGS_CHANGE_EVENT, refreshSettings);
    return () => {
      window.removeEventListener(DAILY_CHANGE_EVENT, refreshDaily);
      window.removeEventListener(SETTINGS_CHANGE_EVENT, refreshSettings);
    };
  }, [useServer]);

  const settingsQuery = useQuery({
    queryKey: ["srs-settings", userId],
    enabled: useServer,
    queryFn: async (): Promise<SrsSettingsInfo> => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "srs_desired_retention, srs_new_per_day, srs_max_reviews_per_day, srs_weights, srs_weights_updated_at, srs_weights_review_count, srs_weights_log_loss"
        )
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      const base = normalizeSettings({
        desiredRetention: data?.srs_desired_retention,
        newPerDay: data?.srs_new_per_day,
        maxReviewsPerDay: data?.srs_max_reviews_per_day,
        weights: (data?.srs_weights as number[] | null) ?? null,
      });
      return {
        ...base,
        weightsUpdatedAt: data?.srs_weights_updated_at ? new Date(data.srs_weights_updated_at).getTime() : null,
        weightsReviewCount: data?.srs_weights_review_count ?? null,
        weightsLogLoss: data?.srs_weights_log_loss ?? null,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  // The study day changes at 4 am; the key carries it so counts reset on their own.
  const dayStart = studyDayStart(Date.now());
  const todayQuery = useQuery({
    queryKey: [...srsTodayKey(userId), dayStart],
    enabled: useServer,
    queryFn: async (): Promise<SrsToday> => {
      const { data, error } = await supabase.rpc("get_srs_today", {
        p_since: new Date(dayStart).toISOString(),
      });
      if (error) throw error;
      const d = (data ?? {}) as { new_cards?: number; reviews?: number; total_reviews?: number };
      return {
        newCards: d.new_cards ?? 0,
        reviews: d.reviews ?? 0,
        totalReviews: d.total_reviews ?? 0,
      };
    },
  });

  const settings: SrsSettingsInfo = useServer
    ? settingsQuery.data ?? {
        ...DEFAULT_SRS_SETTINGS,
        weightsUpdatedAt: null,
        weightsReviewCount: null,
        weightsLogLoss: null,
      }
    : { ...localSettings, weightsUpdatedAt: null, weightsReviewCount: null, weightsLogLoss: null };

  const today: SrsToday = useServer
    ? todayQuery.data ?? { newCards: 0, reviews: 0, totalReviews: null }
    : {
        newCards: localDaily.dayStart === dayStart ? localDaily.newCards : 0,
        reviews: localDaily.dayStart === dayStart ? localDaily.reviews : 0,
        totalReviews: null,
      };

  const saveSettings = useCallback(
    async (next: Pick<SrsSettings, "desiredRetention" | "newPerDay" | "maxReviewsPerDay">) => {
      const clean = normalizeSettings({ ...next, weights: null });
      if (useServer) {
        const { error } = await supabase.rpc("set_srs_settings", {
          p_desired_retention: clean.desiredRetention,
          p_new_per_day: clean.newPerDay,
          p_max_reviews_per_day: clean.maxReviewsPerDay,
        });
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: ["srs-settings", userId] });
        return;
      }
      const merged = { ...clean, weights: localSettings.weights };
      setLocalSettings(merged);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent(SETTINGS_CHANGE_EVENT));
      } catch {
        // ignore
      }
    },
    [useServer, userId, queryClient, localSettings.weights]
  );

  const resetWeights = useCallback(async () => {
    if (!useServer) return;
    const { error } = await supabase.rpc("set_srs_weights", {
      p_weights: null,
      p_review_count: 0,
      p_log_loss: 0,
    });
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ["srs-settings", userId] });
  }, [useServer, userId, queryClient]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["srs-settings", userId] }),
    [queryClient, userId]
  );

  return {
    settings,
    today,
    refresh,
    isServer: useServer,
    isLoading: useServer && settingsQuery.isLoading,
    saveSettings,
    resetWeights,
    retentionBounds: { min: RETENTION_MIN, max: RETENTION_MAX },
  };
}
