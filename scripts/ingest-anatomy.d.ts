/**
 * Types for the pure helpers in ingest-anatomy.js.
 *
 * The script is plain Node ESM and tsconfig.app.json does not enable allowJs,
 * so this declaration is what lets src/test/ingest-anatomy.test.ts import and
 * test the extraction logic directly.
 */
export declare function extractLabels(svg: string): string[];
export declare function aspectFromViewBox(svg: string): number | null;
export declare function parseName(file: string): {
  organ: string;
  view: string | null;
  title: string;
};
export declare function systemFor(title: string, organ: string | null): string | null;
