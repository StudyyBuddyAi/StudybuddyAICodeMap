/**
 * The QBank's content areas: the thirteen organ systems and, since 2026-10-30,
 * two families that are not organ systems at all.
 *
 * Its own module so the browser can map a curriculum topic onto a system key
 * without bundling the item-writing prompts (qbank-prompt.ts re-exports all of
 * this). No imports, no Deno API.
 *
 * The organ-system display names match `curriculum_topics.system` exactly, so
 * a curriculum topic routes without a mapping table and the three systems that
 * already hold curated questions keep their `questions.subject` values.
 *
 * The families exist because the router used to force every topic into an
 * organ system, and up to a fifth of the real exam is not one: Communication &
 * Ethics is 6-9% of Step 1 and 10-15% of Step 2 CK, Biostatistics &
 * Epidemiology 3-6% (USMLE specifications). Students were already asking —
 * "SPIKES protocol", "breaking bad news", "BRAN protocol" — and getting items
 * written against a psychiatry brief.
 */

export type OrganSystemKey =
  | "cardiovascular"
  | "respiratory"
  | "gastrointestinal"
  | "renal"
  | "endocrine"
  | "heme_onc"
  | "repro"
  | "msk_derm"
  | "neuro"
  | "psych"
  | "infectious_disease"
  | "immune"
  | "peds_dev";

export type FamilyKey = "social_sciences" | "biostats_epi";

export type SystemKey = OrganSystemKey | FamilyKey;

export const SYSTEM_NAMES: Record<SystemKey, string> = {
  cardiovascular: "Cardiovascular",
  respiratory: "Respiratory",
  gastrointestinal: "Gastrointestinal",
  renal: "Renal & Urinary",
  endocrine: "Endocrinology",
  heme_onc: "Hematology & Oncology",
  repro: "Reproductive & Obstetrics/Gynecology",
  msk_derm: "Musculoskeletal, Skin & Subcutaneous Tissue",
  neuro: "Neurology & Neurological Surgery",
  psych: "Psychiatry & Behavioral Health",
  infectious_disease: "Infectious Disease",
  immune: "Blood, Lymphoreticular & Immune System",
  peds_dev: "Human Development & Pediatrics",
  social_sciences: "Communication & Ethics",
  biostats_epi: "Biostatistics & Epidemiology",
};

export const SYSTEM_KEYS = Object.keys(SYSTEM_NAMES) as SystemKey[];

export const FAMILY_KEYS: FamilyKey[] = ["social_sciences", "biostats_epi"];

export const isFamily = (key: string | null | undefined): key is FamilyKey =>
  FAMILY_KEYS.includes(key as FamilyKey);

/** Display name → key, for curriculum topics and stored subjects. */
export function systemKeyFor(name: string | null | undefined): SystemKey | null {
  if (!name) return null;
  const hit = SYSTEM_KEYS.find((k) => SYSTEM_NAMES[k] === name);
  return hit ?? null;
}

/**
 * The families' topics, for autocomplete and browsing. curriculum_topics holds
 * only the organ systems; these are the high-yield areas of each family as the
 * USMLE outlines them.
 */
export const FAMILY_TOPICS: Record<FamilyKey, string[]> = {
  social_sciences: [
    "Breaking bad news (SPIKES)",
    "Informed consent & decision-making capacity",
    "Confidentiality & its legal exceptions",
    "Disclosure of medical errors",
    "Advance directives & surrogate decision-making",
    "Minors, consent & confidentiality",
    "Responding to difficult patients & emotions",
    "Patient safety, handoffs & error analysis",
    "Conflicts of interest & professional boundaries",
  ],
  biostats_epi: [
    "Sensitivity, specificity & predictive values",
    "Relative risk, odds ratio & number needed to treat",
    "Study designs & bias",
    "Hypothesis testing, errors & power",
    "Screening tests & lead-time bias",
    "Incidence, prevalence & measures of disease",
    "Confidence intervals & reading a trial result",
  ],
};
