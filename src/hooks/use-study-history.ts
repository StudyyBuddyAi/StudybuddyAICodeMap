import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { removeLocalLayer } from "@/lib/sheet-layer-store";

const STORAGE_KEY = "studybuddy_history";
const HISTORY_CHANGE_EVENT = "studybuddy:history-changed";
const MAX_ITEMS = 50;

export interface StudyHistoryItem {
  id: string;
  topic: string;
  input: string;
  output: string;
  timestamp: number;
  modeInfo?: {
    examMode: string;
    difficulty: string;
    length: string;
  };
}

type ModeInfo = NonNullable<StudyHistoryItem["modeInfo"]>;

type HistoryRow = {
  id: string;
  topic: string;
  input: string;
  output: string;
  exam_mode: string | null;
  difficulty: string | null;
  length: string | null;
  created_at: string;
};

function extractTopic(input: string): string {
  const firstLine = input.trim().split("\n")[0].trim();
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
}

function loadLocal(): StudyHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistLocal(items: StudyHistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(HISTORY_CHANGE_EVENT));
  } catch {
    // ignore
  }
}

function rowToItem(row: HistoryRow): StudyHistoryItem {
  const hasMode =
    row.exam_mode !== null ||
    row.difficulty !== null ||
    row.length !== null;
  return {
    id: row.id,
    topic: row.topic,
    input: row.input,
    output: row.output,
    timestamp: new Date(row.created_at).getTime(),
    modeInfo: hasMode
      ? {
          examMode: row.exam_mode ?? "",
          difficulty: row.difficulty ?? "",
          length: row.length ?? "",
        }
      : undefined,
  };
}

export function useStudyHistory() {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;
  const queryClient = useQueryClient();

  const [localItems, setLocalItems] = useState<StudyHistoryItem[]>(() =>
    loadLocal()
  );

  useEffect(() => {
    if (useServer) return;
    const refresh = () => setLocalItems(loadLocal());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(HISTORY_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HISTORY_CHANGE_EVENT, refresh);
    };
  }, [useServer]);

  const serverQuery = useQuery({
    queryKey: ["study-history", userId],
    enabled: useServer,
    queryFn: async (): Promise<StudyHistoryItem[]> => {
      const { data, error } = await supabase
        .from("study_history")
        .select(
          "id, topic, input, output, exam_mode, difficulty, length, created_at"
        )
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => rowToItem(row as HistoryRow));
    },
  });

  const history = useServer
    ? serverQuery.data ?? []
    : [...localItems].sort((a, b) => b.timestamp - a.timestamp);

  const isLoading = useServer ? serverQuery.isLoading : false;

  /** Saves a sheet and resolves to its id, which its personal layer is keyed by. */
  const saveItem = useCallback(
    async (input: string, output: string, modeInfo?: ModeInfo): Promise<string> => {
      const topic = extractTopic(input);

      if (useServer) {
        const { data, error } = await supabase
          .from("study_history")
          .insert({
            user_id: userId!,
            topic,
            input,
            output,
            exam_mode: modeInfo?.examMode ?? null,
            difficulty: modeInfo?.difficulty ?? null,
            // study_history.focus still exists and still holds values for rows
            // written before the Focus setting was retired. It is nullable, so
            // new rows simply leave it unset rather than requiring a migration
            // that would destroy what those older rows recorded.
            length: modeInfo?.length ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        await queryClient.invalidateQueries({
          queryKey: ["study-history", userId],
        });
        return data.id;
      }

      const current = loadLocal();
      const item: StudyHistoryItem = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        topic,
        input,
        output,
        timestamp: Date.now(),
        modeInfo,
      };
      current.unshift(item);
      if (current.length > MAX_ITEMS) {
        // A sheet pushed out of local history takes its layer with it.
        for (const dropped of current.slice(MAX_ITEMS)) removeLocalLayer(dropped.id);
        current.length = MAX_ITEMS;
      }
      persistLocal(current);
      setLocalItems(current);
      return item.id;
    },
    [useServer, userId, queryClient]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      if (useServer) {
        const { error } = await supabase
          .from("study_history")
          .delete()
          .eq("user_id", userId!)
          .eq("id", id);
        if (error) throw error;
        await queryClient.invalidateQueries({
          queryKey: ["study-history", userId],
        });
        return;
      }

      const next = loadLocal().filter((h) => h.id !== id);
      persistLocal(next);
      setLocalItems(next);
      // A server sheet's layer goes with it by cascade; a local one by hand.
      removeLocalLayer(id);
    },
    [useServer, userId, queryClient]
  );

  return { history, isLoading, saveItem, deleteItem };
}
