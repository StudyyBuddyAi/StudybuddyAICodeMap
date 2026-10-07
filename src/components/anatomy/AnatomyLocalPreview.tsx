import { useCallback } from "react";
import AnatomySection from "./AnatomySection";
import type { AnatomyImage, AnatomyRegion } from "@/lib/callAnatomy";

/**
 * TEMPORARY preview for /sheets?anatomy=local.
 *
 * Reads anatomy_images over REST with the publishable key, so the markers,
 * hover, selection animation and zoom can all be seen without deploying
 * anatomy-match. Explanations still need anatomy-explain deployed — without it
 * a selected structure shows its error line, which is itself worth seeing.
 *
 * Goes over REST rather than the typed supabase client on purpose: the
 * generated types predate these tables, and regenerating them for a throwaway
 * harness would rewrite a file the whole app depends on.
 *
 * Delete with the rest of the harness once the functions are live.
 */

interface Row {
  id: string;
  title: string;
  labels: string[] | null;
  regions: AnatomyRegion[] | null;
  aspect_ratio: string | number | null;
  storage_path: string;
  attribution: string | null;
  source_url: string | null;
}

export default function AnatomyLocalPreview() {
  const match = useCallback(async (): Promise<{ images: AnatomyImage[] }> => {
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

    const response = await fetch(
      `${base}/rest/v1/anatomy_images` +
        "?select=id,title,labels,regions,aspect_ratio,storage_path,attribution,source_url",
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!response.ok) throw new Error(`anatomy_images ${response.status}`);

    const rows = (await response.json()) as Row[];
    const images = rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        labels: row.labels ?? [],
        regions: row.regions ?? [],
        aspectRatio: row.aspect_ratio === null ? null : Number(row.aspect_ratio),
        url: `${base}/storage/v1/object/public/anatomy/${row.storage_path}`,
        attribution: row.attribution,
        sourceUrl: row.source_url,
      }))
      // The ones carrying interactive structures first, so the preview opens
      // on something worth looking at.
      .sort((a, b) => (b.regions?.length ?? 0) - (a.regions?.length ?? 0))
      .slice(0, 3);

    return { images };
  }, []);

  return <AnatomySection topic="preview" match={match} />;
}
