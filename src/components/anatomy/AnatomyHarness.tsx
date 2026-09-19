import AnatomyPanel from "@/components/anatomy/AnatomyPanel";
import AnatomySection from "@/components/anatomy/AnatomySection";
import type { AnatomyImage } from "@/lib/callAnatomy";

/**
 * Development harness for the anatomy feature, mounted by /sheets?anatomy=…
 * only in a dev build (see src/pages/Sheets.tsx).
 *
 * - `placeholder`: one hardcoded image, so the interaction, the tall-image
 *   layout and zoom can be exercised with no database, storage or matching.
 *   The artwork is a crude placeholder, labelled as such inside the SVG — a
 *   layout fixture, not anatomy to learn from.
 * - anything else: real matching for `topic` against the ingested library.
 */
const NEPHRON_HARNESS: AnatomyImage = {
  id: "nephron_placeholder",
  title: "Nephron (placeholder)",
  // Deliberately tall: 400 × 900 is the case a fixed 4/3 box would letterbox.
  aspectRatio: 400 / 900,
  url: "/nephron-placeholder.svg",
  labels: [
    "Glomerulus",
    "Bowman's capsule",
    "Proximal convoluted tubule",
    "Loop of Henle",
    "Distal convoluted tubule",
    "Collecting duct",
  ],
  attribution: null,
  sourceUrl: null,
};

export default function AnatomyHarness({ mode, topic }: { mode: string; topic: string }) {
  if (mode === "placeholder") return <AnatomyPanel image={NEPHRON_HARNESS} />;
  return <AnatomySection key={topic} topic={topic} />;
}
