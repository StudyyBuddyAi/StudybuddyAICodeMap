/**
 * Planning a study sheet's one visual aid — a separate step after the sheet.
 *
 * Why separate: when the sheet writer chose the visual inside its own stream,
 * the choice moved with the writer (Corti at 0.3, GPT-OSS at 0.7, Haiku on
 * fallback), with persona and with topic phrasing — the same topic got an image
 * from one model and a flowchart from another. Here every tier's sheet is
 * planned by one fixed model at temperature 0 with a fixed seed and a strict
 * JSON schema, and the parts that should never vary (placement, what counts as
 * a real flowchart, whether chart numbers are real) are decided in code.
 *
 * Plans are made per sheet from its own text and not cached: labels follow each
 * sheet's wording; the kind of visual is what stays stable.
 *
 * Deno-free — used by the sheet-visual edge function and the local dev harness.
 */
import { isImageView, type ImageView } from "./sheet-image-key.ts";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const SHEET_VISUAL_MODEL = "openai/gpt-oss-120b";
const SHEET_VISUAL_SEED = 20260915;
const PLAN_TIMEOUT_MS = 25_000;

const TOPIC_MAX = 120;
const SECTION_MAX = 6_000;
const KEY_POINTS_MAX = 12;

export type TeachingPoint = "structure" | "decision" | "process" | "numbers" | "none";

export interface SheetVisualPlanInput {
  topic: string;
  overview: string;
  clinicalApproach: string;
  keyPoints: string[];
}

/** Validates the request body; null when there's nothing to plan from. */
export function cleanPlanInput(body: unknown): SheetVisualPlanInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const topic = text(b.topic, TOPIC_MAX);
  const overview = text(b.overview, SECTION_MAX);
  const clinicalApproach = text(b.clinicalApproach, SECTION_MAX);
  const keyPoints = Array.isArray(b.keyPoints)
    ? b.keyPoints.filter((k): k is string => typeof k === "string").slice(0, KEY_POINTS_MAX).map((k) => k.slice(0, 400))
    : [];
  if (!topic || (!overview && !clinicalApproach)) return null;
  return { topic, overview, clinicalApproach, keyPoints };
}

// ── The model call ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You choose ONE visual aid for a medical study sheet and write its content. Work in two steps.

STEP 1 — teachingPoint: the single thing a student most needs to picture.
- "structure": the topic itself names a physical structure (gross anatomy, histology, a sectional view) — e.g. brachial plexus, nephron histology, chambers and valves of the heart.
- "decision": the clinical approach contains a diagnostic or treatment algorithm with branches (if X → do Y, otherwise Z).
- "process": a causal mechanism or cascade that branches or loops back.
- "numbers": two or more comparable numeric values that are written in the sheet (thresholds, lab values by condition, dose steps).
- "none": none of these clearly applies.
When several apply, use this order: structure (only when the topic name itself is a structure) > decision > numbers > process > none.

STEP 2 — fill ONLY the field for your choice and set every other field to null.
- structure → "structure": the name of the whole structure the topic is about, 1-5 words (e.g. "brachial plexus", "renal corpuscle") — never a list of its parts. "structureView": histology for tissue- or cell-level topics, cross-section for sectional anatomy, schematic for networks such as plexuses, tracts or pathways, gross otherwise.
- decision or process → "flowchart": 4-12 nodes. Labels are at most 6 words, taken from the sheet. "decision" nodes are questions, and each of their outgoing edges carries the answer as its label. At least one node must branch.
- numbers → "chart": xLabels are the categories being compared. Every value is a number written in the sheet. One series per measured quantity, all in the same unit.
- "title": at most 8 words.`;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** Strict: every property required, nothing extra. Property order = generation order, so the decision comes first. */
export const VISUAL_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["teachingPoint", "title", "structure", "structureView", "flowchart", "chart"],
  properties: {
    teachingPoint: { type: "string", enum: ["structure", "decision", "process", "numbers", "none"] },
    title: { type: "string" },
    structure: nullable({ type: "string" }),
    structureView: nullable({ type: "string", enum: ["gross", "histology", "cross-section", "schematic"] }),
    flowchart: nullable({
      type: "object",
      additionalProperties: false,
      required: ["direction", "nodes", "edges"],
      properties: {
        direction: { type: "string", enum: ["TD", "LR"] },
        nodes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "shape"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              shape: { type: "string", enum: ["start", "step", "decision", "end"] },
            },
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "to", "label"],
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: nullable({ type: "string" }),
            },
          },
        },
      },
    }),
    chart: nullable({
      type: "object",
      additionalProperties: false,
      required: ["chartType", "xLabels", "series", "yLabel"],
      properties: {
        chartType: { type: "string", enum: ["bar", "line"] },
        xLabels: { type: "array", items: { type: "string" } },
        series: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "values"],
            properties: {
              name: { type: "string" },
              values: { type: "array", items: { type: "number" } },
            },
          },
        },
        yLabel: nullable({ type: "string" }),
      },
    }),
  },
} as const;

function userContent(input: SheetVisualPlanInput): string {
  return `Topic: ${input.topic}

OVERVIEW:
${input.overview || "(none)"}

CLINICAL APPROACH:
${input.clinicalApproach || "(none)"}

KEY POINTS:
${input.keyPoints.length ? input.keyPoints.map((k) => `- ${k}`).join("\n") : "(none)"}`;
}

/** Calls the planner and returns its parsed JSON object. Throws on any transport or parse failure. */
export async function requestVisualPlan(apiKey: string, input: SheetVisualPlanInput): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://studybuddy.app",
        "X-Title": "StudyBuddy",
      },
      body: JSON.stringify({
        model: SHEET_VISUAL_MODEL,
        temperature: 0,
        seed: SHEET_VISUAL_SEED,
        max_tokens: 4000,
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "sheet_visual", strict: true, schema: VISUAL_PLAN_SCHEMA },
        },
        // Groq and Cerebras honour the schema and the seed and answer in a few
        // seconds; left to OpenRouter's default pick, requests queued at slower
        // providers for 20s+. require_parameters keeps any fallback honest too.
        provider: { order: ["Groq", "Cerebras"], allow_fallbacks: true, require_parameters: true },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`openrouter_${res.status}: ${body.slice(0, 300)}`);
    }
    const content = (await res.json())?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("no_content");
    const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// ── Deterministic rules ─────────────────────────────────────────────────────

/** The client re-validates this shape with src/lib/parse-sheet-visual.ts. */
export type PlannedVisual = Record<string, unknown> & { kind: "flowchart" | "chart" | "image" };

export interface VisualPlanResult {
  visual: PlannedVisual | null;
  teachingPoint: TeachingPoint | "invalid";
  /** Why the visual is what it is — logged, never shown. */
  reason: string;
}

/** Placement is decided here, never by the model. */
const PLACEMENT: Record<"structure" | "decision" | "process" | "numbers", string> = {
  structure: "overview",
  decision: "clinicalApproach",
  process: "overview",
  numbers: "keyPoints",
};

const VIEW_LABEL: Record<ImageView, string> = {
  gross: "Gross anatomy",
  histology: "Histology",
  "cross-section": "Cross-section",
  schematic: "Schematic",
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Every number written in the sheet, including "1,800"-style thousands. */
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/-?\d+(?:[.,]\d+)*/g)) {
    const raw = match[0];
    out.push(parseFloat(raw.replace(/,/g, "")));
    if (/^-?\d+,\d+$/.test(raw)) out.push(parseFloat(raw.replace(",", "."))); // decimal comma
  }
  return out.filter(Number.isFinite);
}

function finalizeFlowchart(raw: unknown): { flowchart: Record<string, unknown> | null; reason: string } {
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    return { flowchart: null, reason: "flowchart_missing" };
  }
  const nodes = raw.nodes
    .filter(isRecord)
    .map((n) => ({ id: str(n.id, 40), label: str(n.label, 60), shape: n.shape }))
    .filter((n) => n.id && n.label);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = raw.edges
    .filter(isRecord)
    .map((e) => ({ from: str(e.from, 40), to: str(e.to, 40), label: str(e.label, 24) }))
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

  if (nodes.length < 3 || edges.length < 2) return { flowchart: null, reason: "flowchart_too_small" };

  // A chain of boxes is a list, not a flowchart: require a real branch, merge or loop.
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const e of edges) {
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }
  const branches = nodes.some((n) => (outDegree.get(n.id) ?? 0) >= 2 || (inDegree.get(n.id) ?? 0) >= 2);
  if (!branches) return { flowchart: null, reason: "flowchart_linear" };

  return {
    flowchart: {
      direction: raw.direction === "LR" ? "LR" : "TD",
      nodes,
      edges: edges.map((e) => (e.label ? e : { from: e.from, to: e.to })),
    },
    reason: "ok",
  };
}

function finalizeChart(raw: unknown, sheetText: string): { chart: Record<string, unknown> | null; reason: string } {
  if (!isRecord(raw) || !Array.isArray(raw.xLabels) || !Array.isArray(raw.series)) {
    return { chart: null, reason: "chart_missing" };
  }
  const xLabels = raw.xLabels.map((l) => str(l, 60));
  const series = raw.series.filter(isRecord).map((s) => ({ name: str(s.name, 60), values: s.values }));
  if (xLabels.length < 2 || xLabels.some((l) => !l) || series.length === 0) return { chart: null, reason: "chart_malformed" };

  const written = numbersInText(sheetText);
  for (const s of series) {
    if (!s.name || !Array.isArray(s.values) || s.values.length !== xLabels.length) {
      return { chart: null, reason: "chart_malformed" };
    }
    for (const v of s.values) {
      if (typeof v !== "number" || !Number.isFinite(v)) return { chart: null, reason: "chart_malformed" };
      // Never plot a number the sheet doesn't state.
      if (!written.some((w) => Math.abs(w - v) < 1e-9)) return { chart: null, reason: "chart_number_not_in_sheet" };
    }
  }
  const yLabel = str(raw.yLabel, 60);
  return {
    chart: { chartType: raw.chartType === "line" ? "line" : "bar", xLabels, series, ...(yLabel ? { yLabel } : {}) },
    reason: "ok",
  };
}

/** Turns the planner's answer into the visual the sheet gets — or none, with the reason. */
export function finalizeVisualPlan(raw: unknown, input: SheetVisualPlanInput): VisualPlanResult {
  if (!isRecord(raw)) return { visual: null, teachingPoint: "invalid", reason: "invalid_response" };
  const teachingPoint = raw.teachingPoint as TeachingPoint;
  const title = str(raw.title, 80);

  switch (teachingPoint) {
    case "structure": {
      const structure = str(raw.structure, 60);
      const view = raw.structureView;
      if (!structure || !isImageView(view)) return { visual: null, teachingPoint, reason: "structure_incomplete" };
      return {
        teachingPoint,
        reason: "ok",
        visual: {
          kind: "image",
          title: title || structure,
          placement: PLACEMENT.structure,
          imageSubject: `${structure} — ${VIEW_LABEL[view].toLowerCase()}`,
          imageAlt: `${VIEW_LABEL[view]} illustration of ${structure}.`,
          imageView: view,
        },
      };
    }
    case "decision":
    case "process": {
      const { flowchart, reason } = finalizeFlowchart(raw.flowchart);
      if (!flowchart) return { visual: null, teachingPoint, reason };
      return {
        teachingPoint,
        reason,
        visual: { kind: "flowchart", title, placement: PLACEMENT[teachingPoint], flowchart },
      };
    }
    case "numbers": {
      const sheetText = [input.overview, input.clinicalApproach, ...input.keyPoints].join("\n");
      const { chart, reason } = finalizeChart(raw.chart, sheetText);
      if (!chart) return { visual: null, teachingPoint, reason };
      return { teachingPoint, reason, visual: { kind: "chart", title, placement: PLACEMENT.numbers, chart } };
    }
    case "none":
      return { visual: null, teachingPoint, reason: "planner_chose_none" };
    default:
      return { visual: null, teachingPoint: "invalid", reason: "invalid_teaching_point" };
  }
}
