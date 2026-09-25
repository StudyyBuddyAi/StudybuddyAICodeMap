import { isEmptyLayer, type SheetLayer } from "@/lib/sheet-layer";

/**
 * Anonymous students' layers, keyed by their local sheet id. Their sheets are
 * local too (studybuddy_history); both move to the account on sign-up.
 *
 * Kept apart from the hook so the sign-up migration can use it without
 * importing React state or the auth hook that imports the migration.
 */
export const LOCAL_LAYERS_KEY = "sb_sheet_layers_v1";

export function loadLocalLayers(): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_LAYERS_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** Writes one sheet's layer; an empty layer removes the entry. */
export function saveLocalLayer(sheetId: string, layer: SheetLayer | null): void {
  try {
    const all = loadLocalLayers();
    if (!layer || isEmptyLayer(layer)) delete all[sheetId];
    else all[sheetId] = layer;
    localStorage.setItem(LOCAL_LAYERS_KEY, JSON.stringify(all));
  } catch {
    // quota exceeded or storage blocked — the layer lives for this session only
  }
}

export const removeLocalLayer = (sheetId: string) => saveLocalLayer(sheetId, null);
