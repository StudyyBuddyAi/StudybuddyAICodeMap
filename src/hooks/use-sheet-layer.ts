import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { emptyLayer, parseLayer, type SheetLayer } from "@/lib/sheet-layer";
import { loadLocalLayers, saveLocalLayer } from "@/lib/sheet-layer-store";

/*
 * Where a sheet's personal layer lives: `sheet_layers` for a signed-in student,
 * localStorage for an anonymous one (whose sheets are local too), carried over
 * to the account on sign-up by `migrateLocalStudyHistoryToServer`.
 */

/** Wait this long after the last change before writing. */
const SAVE_DELAY_MS = 600;

export type LayerStatus = "loading" | "ready" | "error";

export interface SheetLayerState {
  layer: SheetLayer;
  /** "ready" once the saved layer (if any) has arrived; edits before that are refused. */
  status: LayerStatus;
  /** True while a change is waiting to be written, or failed to be. */
  unsaved: boolean;
  /** The last write failed; the next change retries it. */
  saveFailed: boolean;
  update: (fn: (layer: SheetLayer) => SheetLayer) => void;
}

/**
 * The personal layer of the sheet on screen.
 *
 * `sheetKey` names the sheet being shown and changes whenever another one is
 * (a new generation, a sheet opened from history); `sheetId` is its saved id,
 * null until it is saved. They are separate because "the same sheet just got
 * saved" and "a different, saved sheet was opened" both look like an id
 * appearing — and only the first may keep what the student has done so far.
 * A change to an unsaved sheet is held, and written the moment the sheet gets
 * its id: the page saves the sheet on the student's first touch.
 */
export function useSheetLayer(sheetKey: string | number, sheetId: string | null): SheetLayerState {
  const { user, isAnonymous } = useAuth();
  const userId = user?.id ?? null;
  const useServer = !!userId && !isAnonymous;

  const [layer, setLayer] = useState<SheetLayer>(emptyLayer);
  const [status, setStatus] = useState<LayerStatus>(sheetId ? "loading" : "ready");
  const [unsaved, setUnsaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // The sheet and id the pending layer belongs to (undefined until the first
  // load), and the layer itself.
  const keyRef = useRef<string | number | undefined>(undefined);
  const idRef = useRef<string | null | undefined>(undefined);
  const pendingRef = useRef<SheetLayer | null>(null);
  const timerRef = useRef<number | null>(null);
  const serverRef = useRef({ useServer, userId });
  serverRef.current = { useServer, userId };

  const write = useCallback(async (id: string, next: SheetLayer) => {
    const { useServer: server, userId: uid } = serverRef.current;
    if (!server || !uid) {
      saveLocalLayer(id, next);
      return;
    }
    const { error } = await supabase.from("sheet_layers").upsert(
      { sheet_id: id, user_id: uid, layer: next as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: "sheet_id" }
    );
    if (error) throw error;
  }, []);

  /** Writes whatever is pending, if the sheet has an id to write it under. */
  const flush = useCallback(async () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = idRef.current;
    const next = pendingRef.current;
    if (!id || !next) return;
    pendingRef.current = null;
    try {
      await write(id, next);
      setSaveFailed(false);
      if (!pendingRef.current) setUnsaved(false);
    } catch (e) {
      console.error("sheet layer save failed", e);
      // Kept, so the next change (or the next flush) tries again.
      pendingRef.current ??= next;
      setSaveFailed(true);
    }
  }, [write]);

  // A different sheet: write what the last one was waiting on, then load this one.
  useEffect(() => {
    const sameSheet = keyRef.current === sheetKey;
    if (sameSheet && idRef.current === sheetId) return;

    // The sheet on screen has just been saved: it keeps its layer. There is
    // nothing stored under a brand-new id to load, and what the student did
    // before the save is exactly what should be written under it.
    if (sameSheet && idRef.current === null && sheetId) {
      idRef.current = sheetId;
      void flush();
      return;
    }

    void flush();
    keyRef.current = sheetKey;
    idRef.current = sheetId;
    pendingRef.current = null;
    setUnsaved(false);
    setSaveFailed(false);
    setLayer(emptyLayer());

    if (!sheetId) {
      setStatus("ready");
      return;
    }
    setStatus("loading");
    let cancelled = false;
    (async () => {
      try {
        let raw: unknown = null;
        if (useServer) {
          const { data, error } = await supabase
            .from("sheet_layers")
            .select("layer")
            .eq("sheet_id", sheetId)
            .maybeSingle();
          if (error) throw error;
          raw = data?.layer ?? null;
        } else {
          raw = loadLocalLayers()[sheetId] ?? null;
        }
        if (cancelled) return;
        setLayer(parseLayer(raw));
        setStatus("ready");
      } catch (e) {
        console.error("sheet layer load failed", e);
        if (cancelled) return;
        // Readable as empty, but not editable: writing now could overwrite a
        // layer we simply failed to read.
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetKey, sheetId, useServer, flush]);

  // Whatever is waiting is written when the page goes away.
  useEffect(() => () => void flush(), [flush]);

  const update = useCallback(
    (fn: (layer: SheetLayer) => SheetLayer) => {
      setLayer((prev) => {
        const next = fn(prev);
        if (next === prev) return prev;
        pendingRef.current = next;
        return next;
      });
      setUnsaved(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush]
  );

  return { layer, status, unsaved, saveFailed, update };
}

/** A saved sheet's layer, read once, for views that only show it. */
export function useSavedSheetLayer(sheetId: string | null): SheetLayer | null {
  const { user, isAnonymous } = useAuth();
  const useServer = !!user?.id && !isAnonymous;
  const [layer, setLayer] = useState<SheetLayer | null>(null);

  useEffect(() => {
    setLayer(null);
    if (!sheetId) return;
    let cancelled = false;
    (async () => {
      if (!useServer) {
        if (!cancelled) setLayer(parseLayer(loadLocalLayers()[sheetId] ?? null));
        return;
      }
      const { data } = await supabase.from("sheet_layers").select("layer").eq("sheet_id", sheetId).maybeSingle();
      if (!cancelled) setLayer(parseLayer(data?.layer ?? null));
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetId, useServer]);

  return layer;
}
