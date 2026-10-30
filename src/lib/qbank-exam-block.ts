/**
 * An exam block mixed the way the real exam is: topics sampled across the
 * systems by the USMLE specification weights, one question per topic, sent
 * with their systems already resolved so nothing needs routing.
 *
 * The weights are the published ranges' midpoints (usmle.org Step 1 and
 * Step 2 CK content specifications, 2026), split across our systems where the
 * outline groups two together (Step 1 "Respiratory & Renal/Urinary 11-15%"
 * becomes 6 + 7). Nutrition is a cross-cutting discipline, not a system, so it
 * has no row. "mixed" averages the two exams.
 */
import { FAMILY_TOPICS, isFamily, type SystemKey } from "../../supabase/functions/_shared/qbank-systems.ts";
import type { CurriculumTopic, ExamTarget } from "@/lib/qbank-suggestions";

export const EXAM_WEIGHTS: Record<"step1" | "step2ck", Record<SystemKey, number>> = {
  step1: {
    peds_dev: 2,
    immune: 5,
    heme_onc: 6,
    psych: 5,
    neuro: 7,
    msk_derm: 10,
    cardiovascular: 9,
    respiratory: 6,
    renal: 7,
    gastrointestinal: 8,
    repro: 7,
    endocrine: 7,
    infectious_disease: 10,
    biostats_epi: 5,
    social_sciences: 7.5,
  },
  step2ck: {
    social_sciences: 12.5,
    renal: 5,
    repro: 10,
    cardiovascular: 9,
    msk_derm: 9,
    psych: 7.5,
    heme_onc: 4,
    immune: 3.5,
    gastrointestinal: 7.5,
    neuro: 7.5,
    respiratory: 7.5,
    infectious_disease: 6,
    endocrine: 5,
    biostats_epi: 4,
    peds_dev: 3,
  },
};

function weightsFor(target: ExamTarget): Record<SystemKey, number> {
  if (target !== "mixed") return EXAM_WEIGHTS[target];
  const out = {} as Record<SystemKey, number>;
  for (const k of Object.keys(EXAM_WEIGHTS.step1) as SystemKey[]) {
    out[k] = (EXAM_WEIGHTS.step1[k] + EXAM_WEIGHTS.step2ck[k]) / 2;
  }
  return out;
}

/** Fisher-Yates on a copy. */
function shuffle<T>(values: T[], random: () => number): T[] {
  const pool = [...values];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * How many questions each system gets: largest-remainder apportionment, so the
 * counts sum to `size` exactly, with remainder ties broken at random so a
 * 10-question block does not always favour the same systems.
 */
export function apportion(size: number, weights: Record<string, number>, random: () => number): Record<string, number> {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const total = keys.reduce((n, k) => n + weights[k], 0);
  const raw = keys.map((k) => ({ k, exact: (size * weights[k]) / total, tie: random() }));
  const counts: Record<string, number> = {};
  let given = 0;
  for (const r of raw) {
    counts[r.k] = Math.floor(r.exact);
    given += counts[r.k];
  }
  raw
    .sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.tie - b.tie)
    .slice(0, size - given)
    .forEach((r) => (counts[r.k] += 1));
  return counts;
}

export interface ExamBlock {
  topics: string[];
  systems: string[];
}

/** One topic per question, across the systems by exam weight, shuffled. */
export function buildExamBlock(input: {
  target: ExamTarget;
  size: number;
  curriculum: CurriculumTopic[];
  random?: () => number;
}): ExamBlock {
  const random = input.random ?? Math.random;
  const poolFor = (system: SystemKey): string[] =>
    isFamily(system) ? FAMILY_TOPICS[system] : input.curriculum.filter((c) => c.system === system).map((c) => c.title);

  // Only systems that have topics to draw from take part.
  const weights = Object.fromEntries(
    Object.entries(weightsFor(input.target)).filter(([k]) => poolFor(k as SystemKey).length > 0)
  );
  const counts = apportion(input.size, weights, random);

  const picked: { topic: string; system: string }[] = [];
  for (const [system, n] of Object.entries(counts)) {
    const pool = shuffle(poolFor(system as SystemKey), random);
    for (let i = 0; i < n && i < pool.length; i++) picked.push({ topic: pool[i], system });
  }
  const order = shuffle(picked, random);
  return { topics: order.map((p) => p.topic), systems: order.map((p) => p.system) };
}
