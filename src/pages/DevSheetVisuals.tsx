import { useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import OutputSection from "@/components/OutputSection";
import type { GeneratedSheet, IllustrationSpec, VisualSpec } from "@/types/generated-sheet";
import { SheetImageError, type SheetImageRequester } from "@/lib/generate-sheet-image";
import type { VisualPlanner } from "@/components/sheet-visual/visual-section-ui";

/**
 * DEV ONLY — /dev/sheet-visuals. Never routed in a production build (see App.tsx).
 *
 * Renders the real OutputSection with fixture sheets, one per visual kind, so
 * the visuals can be reviewed without a deployed edge function. Fixtures go
 * through the same `visual` shape the parser produces.
 */

const BASE_SHEET: GeneratedSheet = {
  topicEmoji: "🫀",
  topic: "Heart Failure with Reduced Ejection Fraction",
  overview:
    "Mechanism: **Impaired systolic contraction** lowers stroke volume.\nPathophysiology: Low output → **RAAS and sympathetic activation** → sodium retention and remodeling → further decline in ejection fraction.\nKey associations:\n1. **S3 gallop** → rapid filling of a dilated ventricle\n2. **Raised JVP** → venous congestion from volume overload\n3. **Orthopnea** → redistribution of fluid when supine",
  memoryHooks: [
    "HFrEF pillars: ARNI, BB, MRA, SGLT2i — 'All Big Men Sleep'",
    "S3 = 'Slosh-ing in' to a baggy ventricle",
    "Loop diuretics fix symptoms, not survival",
  ],
  clinicalApproach:
    "Diagnosis: **Echocardiogram** → LVEF ≤ 40%. BNP supports the diagnosis.\nManagement:\nFirst-line → **ARNI or ACE inhibitor + beta-blocker + MRA + SGLT2 inhibitor**, loop diuretic for congestion.\nComplications: **cardiogenic shock**, **ventricular arrhythmias**.",
  keyPoints: [
    "If LVEF ≤ 40% → HFrEF; 41–49% → mildly reduced; ≥ 50% → preserved",
    "If BNP is normal → heart failure is unlikely",
    "If hyperkalemia on MRA → check renal function and reduce the dose",
    "If NYHA III–IV despite therapy → consider device therapy",
    "If new AF in HF → rate control and anticoagulate",
  ],
  examTraps: [
    "Starting a beta-blocker during acute decompensation",
    "Non-dihydropyridine CCBs worsen HFrEF",
    "Digoxin improves symptoms, not mortality",
  ],
  flashcards: [
    {
      tag: "Next Step",
      question: "A 64-year-old with LVEF 30% on an ACE inhibitor and beta-blocker remains NYHA II. What next?",
      answer: "Add a mineralocorticoid receptor antagonist and an SGLT2 inhibitor.",
    },
  ],
  referenceNote: "Fixture sheet for local preview — not medical content for study.",
};

const FIXTURES: Record<string, VisualSpec> = {
  flowchart: {
    kind: "flowchart",
    title: "Chronic HFrEF treatment pathway",
    placement: "clinicalApproach",
    flowchart: {
      direction: "TD",
      nodes: [
        { id: "a", label: "Symptoms + LVEF ≤ 40%", shape: "start" },
        { id: "b", label: "Congested?", shape: "decision" },
        { id: "c", label: "Loop diuretic", shape: "step" },
        { id: "d", label: "Start ARNI/ACEi + BB + MRA + SGLT2i", shape: "step" },
        { id: "e", label: "Still NYHA III–IV on therapy?", shape: "decision" },
        { id: "f", label: "Consider ICD / CRT, refer", shape: "step" },
        { id: "g", label: "Continue, titrate to target doses", shape: "end" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c", label: "Yes" },
        { from: "b", to: "d", label: "No" },
        { from: "c", to: "d" },
        { from: "d", to: "e" },
        { from: "e", to: "f", label: "Yes" },
        { from: "e", to: "g", label: "No" },
      ],
    },
  },
  "chart (bar)": {
    kind: "chart",
    title: "NT-proBNP rule-in cut-off by age",
    placement: "keyPoints",
    chart: {
      chartType: "bar",
      xLabels: ["< 50 y", "50–75 y", "> 75 y"],
      series: [{ name: "NT-proBNP", values: [450, 900, 1800] }],
      yLabel: "pg/mL",
    },
  },
  "chart (line, 2 series)": {
    kind: "chart",
    title: "Blood pressure during titration",
    placement: "keyPoints",
    chart: {
      chartType: "line",
      xLabels: ["Week 0", "Week 2", "Week 4", "Week 8"],
      series: [
        { name: "Systolic", values: [138, 131, 124, 118] },
        { name: "Diastolic", values: [86, 82, 78, 74] },
      ],
      yLabel: "mmHg",
    },
  },
};

const ILLUSTRATION_FIXTURE: IllustrationSpec = {
  title: "Heart chambers and valves",
  view: "cross-section",
  subject: "heart — cross-section",
  alt: "Cross-section of the heart with the four chambers and four valves labeled.",
};

type MockOutcome = "success" | "quota" | "failure";

/** Stands in for the edge function: a placeholder drawing after a realistic delay. */
function mockRequester(outcome: MockOutcome): SheetImageRequester {
  return async ({ topic, view }) => {
    await new Promise((r) => setTimeout(r, 3000));
    if (outcome === "quota") throw new SheetImageError("quota_exceeded", 3);
    if (outcome === "failure") throw new SheetImageError("unavailable");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#fff"/><rect x="40" y="40" width="720" height="520" fill="none" stroke="#CBC3AE" stroke-dasharray="8 6"/><text x="400" y="290" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#545042">Mock image — edge function not called</text><text x="400" y="325" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#7C7461">${`${topic} · ${view}`.replace(/[<&>]/g, "")}</text></svg>`;
    return {
      // Not base64: btoa() throws on the non-Latin-1 characters in the text.
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      provider: "mock",
      generatedAt: new Date().toISOString(),
    };
  };
}

/** The key order the model writes in. The visual is planned after the stream, so it appears once all of these close. */
const STREAM_ORDER = [
  "topicEmoji",
  "topic",
  "overview",
  "memoryHooks",
  "clinicalApproach",
  "keyPoints",
  "examTraps",
  "flashcards",
  "referenceNote",
];

const DevSheetVisuals = () => {
  const [fixture, setFixture] = useState<string>("flowchart");
  // Start without a visual to exercise the section's button and planning state.
  const [unplanned, setUnplanned] = useState(false);
  const [streamedKeys, setStreamedKeys] = useState<string[] | null>(null);
  const [imageOutcome, setImageOutcome] = useState<MockOutcome>("success");
  const timer = useRef<number | null>(null);

  // Every fixture sheet also offers the illustration, so both cards can be tried.
  const chosen: VisualSpec | undefined = FIXTURES[fixture];
  const sheet: GeneratedSheet = {
    ...BASE_SHEET,
    visual: unplanned ? undefined : chosen,
    illustration: unplanned ? undefined : ILLUSTRATION_FIXTURE,
  };

  /** Stands in for sheet-visual: returns the selected fixtures after a realistic pause. */
  const mockPlanner: VisualPlanner = async () => {
    await new Promise((r) => setTimeout(r, 1800));
    return { diagram: chosen, illustration: ILLUSTRATION_FIXTURE };
  };

  const simulateStream = () => {
    if (timer.current) window.clearInterval(timer.current);
    let i = 0;
    setStreamedKeys([]);
    timer.current = window.setInterval(() => {
      i += 1;
      if (i > STREAM_ORDER.length) {
        window.clearInterval(timer.current!);
        timer.current = null;
        setStreamedKeys(null);
        return;
      }
      setStreamedKeys(STREAM_ORDER.slice(0, i));
    }, 450);
  };

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  return (
    <DashboardLayout wide>
      <div className="mx-auto max-w-3xl space-y-4 py-6">
        <div className="rounded-lg border border-dashed border-border p-4 text-sm">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Dev preview · sheet visuals
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(FIXTURES).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setFixture(name)}
                className={`rounded-md border px-3 py-1.5 text-xs ${
                  fixture === name ? "border-primary text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {name}
              </button>
            ))}
            {fixture === "image" && (
              <select
                aria-label="Mock image outcome"
                value={imageOutcome}
                onChange={(e) => setImageOutcome(e.target.value as MockOutcome)}
                className="rounded-md border border-border bg-transparent px-2 py-1.5 text-xs text-muted-foreground"
              >
                <option value="success">mock: success</option>
                <option value="quota">mock: quota exceeded</option>
                <option value="failure">mock: failure</option>
              </select>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={unplanned} onChange={(e) => setUnplanned(e.target.checked)} />
              start unplanned (button)
            </label>
            <button
              type="button"
              onClick={simulateStream}
              className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground"
            >
              Simulate streaming
            </button>
          </div>
        </div>

        <OutputSection
          key={`${fixture}:${imageOutcome}:${unplanned}`}
          output={JSON.stringify(sheet)}
          requestVisualImage={mockRequester(imageOutcome)}
          requestVisualPlan={mockPlanner}
          inputText={sheet.topic}
          modeInfo={{ examMode: "General", difficulty: "Basic", focus: "Quick Revision", length: "Concise" }}
          isStreaming={streamedKeys !== null}
          streamedKeys={streamedKeys ?? undefined}
        />
      </div>
    </DashboardLayout>
  );
};

export default DevSheetVisuals;
