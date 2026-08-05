import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";

export type ModelPreference = "claude" | "gpt-oss";

export function useModelPreference() {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const isLoggedIn = !!user && !isAnonymous;
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const prefQuery = useQuery({
    queryKey: ["model-preference", userId],
    enabled: isLoggedIn,
    queryFn: async (): Promise<ModelPreference> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("preferred_model")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.preferred_model as ModelPreference) ?? "gpt-oss";
    },
  });

  const preferredModel: ModelPreference = prefQuery.data ?? "gpt-oss";

  const setPreferredModel = async (model: ModelPreference) => {
    if (!isLoggedIn || !userId || saving) return;
    const queryKey = ["model-preference", userId];
    const previous = queryClient.getQueryData<ModelPreference>(queryKey);
    setSaving(true);
    // Move the chip immediately; roll back below if the write doesn't land.
    queryClient.setQueryData(queryKey, model);
    try {
      // .select() so an RLS-filtered no-op comes back as zero rows instead of a
      // misleading 204 — otherwise a rejected write looks identical to success.
      const { data, error } = await supabase
        .from("profiles")
        .update({ preferred_model: model })
        .eq("id", userId)
        .select("preferred_model");
      if (error) throw error;
      if (!data?.length) throw new Error("Preference update matched no profile row");
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      console.error("Failed to save model preference", err);
      toast({
        title: "Couldn't switch models, please try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return {
    preferredModel,
    setPreferredModel,
    saving,
    isLoading: prefQuery.isLoading,
  };
}
