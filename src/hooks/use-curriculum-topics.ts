import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CurriculumTopic } from "@/lib/qbank-suggestions";
import type { TopicOption } from "@/lib/topic-suggest";
import {
  FAMILY_KEYS,
  FAMILY_TOPICS,
  SYSTEM_KEYS,
  SYSTEM_NAMES,
  systemKeyFor,
} from "../../supabase/functions/_shared/qbank-systems.ts";

/**
 * The curriculum's level-1 topics (public read), with their system keys, plus
 * the topic options the QBank composer suggests from: every curriculum topic,
 * the Communication & Ethics and Biostatistics topics, and each whole system.
 * Cached for the session — the list changes with a migration, not a click.
 */
export function useCurriculumTopics() {
  const query = useQuery({
    queryKey: ["curriculum-topics", "level-1"],
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<CurriculumTopic[]> => {
      const { data, error } = await supabase
        .from("curriculum_topics")
        .select("title, system, sort_order")
        .eq("level", 1)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? [])
        .map((r) => ({ title: r.title, system: systemKeyFor(r.system) ?? "", sortOrder: r.sort_order ?? 0 }))
        .filter((r) => r.system);
    },
  });

  const curriculum = useMemo(() => query.data ?? [], [query.data]);

  const options: TopicOption[] = useMemo(() => {
    const out: TopicOption[] = curriculum.map((c) => ({
      title: c.title,
      systemName: SYSTEM_NAMES[c.system as keyof typeof SYSTEM_NAMES] ?? null,
      systemKey: c.system,
      source: "curriculum",
    }));
    for (const f of FAMILY_KEYS) {
      for (const title of FAMILY_TOPICS[f]) {
        out.push({ title, systemName: SYSTEM_NAMES[f], systemKey: f, source: "family" });
      }
    }
    for (const k of SYSTEM_KEYS) {
      out.push({ title: SYSTEM_NAMES[k], systemName: SYSTEM_NAMES[k], systemKey: k, source: "system" });
    }
    return out;
  }, [curriculum]);

  return { curriculum, options, isLoading: query.isLoading };
}
