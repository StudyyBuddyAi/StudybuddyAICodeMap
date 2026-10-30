/**
 * The challenge catalogue: ready-made mixed sets that put something specific,
 * and a little daring, in front of a student who has not decided what to do.
 *
 * Two kinds (docs/qbank/topic-selection-ux.md §3):
 *  - showdown: confusable conditions mixed on purpose, so the student has to
 *    tell them apart — interleaving where the evidence says it helps most.
 *  - scenario: a clinical situation spanning several topics, as a ward or ED
 *    actually presents them (Step 2 CK).
 *
 * Every topic is a curriculum title (or a family topic) with its system key,
 * so a card generates without routing. Content, reviewed like content: copy
 * names a concrete task, the hook is one short line, no hype words.
 */
import type { ChallengeLevel } from "@/lib/qbank-types";

export type ChallengeKind = "showdown" | "scenario";
/** Which exam target a card suits. "both" shows for every target. */
export type ChallengeTrack = "step1" | "step2ck" | "both";

export interface ChallengeTopic {
  title: string;
  system: string;
}

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  track: ChallengeTrack;
  title: string;
  hook: string;
  topics: ChallengeTopic[];
  /** The card's own level (owner decision: cards run at it). */
  level: ChallengeLevel;
  size: number;
}

const t = (title: string, system: string): ChallengeTopic => ({ title, system });

export const CHALLENGES: Challenge[] = [
  // ── Showdowns ────────────────────────────────────────────────────────────
  {
    id: "nephritic-nephrotic", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "Nephritic or nephrotic?", hook: "Blood or protein — call it from the urine.",
    topics: [t("Glomerulonephritis — Nephritic Syndromes", "renal"), t("Nephrotic Syndrome & Minimal Change Disease", "renal")],
  },
  {
    id: "crohns-uc", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "Crohn's or UC?", hook: "Skip lesions, crypt abscesses, fistulas — whose is whose?",
    topics: [t("Inflammatory Bowel Disease — Crohn's Disease", "gastrointestinal"), t("Inflammatory Bowel Disease — Ulcerative Colitis", "gastrointestinal")],
  },
  {
    id: "hypersensitivity", kind: "showdown", track: "step1", level: "balanced", size: 5,
    title: "Four hypersensitivities", hook: "One stem each. Which type?",
    topics: [t("Hypersensitivity Reactions — Types I–IV", "immune")],
  },
  {
    id: "microcytic", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "Small red cells", hook: "Iron, thalassemia, chronic disease — read the indices.",
    topics: [t("Iron Deficiency & Microcytic Anemias", "heme_onc"), t("Sickle Cell Disease & Hemoglobinopathies", "heme_onc")],
  },
  {
    id: "which-leukemia", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "Which leukemia?", hook: "Age, smear, one marker.",
    topics: [t("Acute Leukemia — ALL & AML", "heme_onc"), t("Chronic Leukemia — CLL & CML", "heme_onc")],
  },
  {
    id: "murmurs", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "Name the murmur", hook: "AS, AR, MS, MR — by timing and maneuver.",
    topics: [t("Aortic Valve Disease (AS & AR)", "cardiovascular"), t("Mitral Valve Disease (MS, MR, MVP)", "cardiovascular")],
  },
  {
    id: "congenital-heart", kind: "showdown", track: "step1", level: "balanced", size: 5,
    title: "Cyanotic or acyanotic?", hook: "Follow the shunt.",
    topics: [t("Congenital Heart Disease (Cyanotic & Acyanotic)", "cardiovascular")],
  },
  {
    id: "thyroid", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "Hyper or hypo?", hook: "Graves, Hashimoto, storm.",
    topics: [t("Hypothyroidism & Hashimoto's Thyroiditis", "endocrine"), t("Hyperthyroidism — Graves' Disease & Thyroid Storm", "endocrine")],
  },
  {
    id: "joint-pain", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "Joint pain lineup", hook: "Lupus, RA, or a spondyloarthropathy?",
    topics: [t("Systemic Lupus Erythematosus", "msk_derm"), t("Rheumatoid Arthritis", "msk_derm"), t("Seronegative Spondyloarthropathies", "msk_derm")],
  },
  {
    id: "weak-where", kind: "showdown", track: "both", level: "challenge", size: 6,
    title: "Weak, but where?", hook: "MS, Guillain-Barré, myasthenia — localise the lesion.",
    topics: [
      t("Multiple Sclerosis & Demyelinating Disease", "neuro"),
      t("Peripheral Neuropathy & Guillain-Barré Syndrome", "neuro"),
      t("Myasthenia Gravis & Neuromuscular Junction Disorders", "neuro"),
    ],
  },
  {
    id: "antipsychotics", kind: "showdown", track: "step1", level: "balanced", size: 5,
    title: "Typical vs atypical", hook: "Receptors, side effects, NMS.",
    topics: [t("Antipsychotics — Typical, Atypical & NMS", "psych")],
  },
  {
    id: "gram", kind: "showdown", track: "step1", level: "balanced", size: 6,
    title: "Gram-positive or negative?", hook: "Name the bug from the stain and the story.",
    topics: [t("Bacterial Infections — Gram-Positive Organisms", "infectious_disease"), t("Bacterial Infections — Gram-Negative Organisms", "infectious_disease")],
  },
  {
    id: "acid-base", kind: "showdown", track: "both", level: "challenge", size: 5,
    title: "Mixed acid–base", hook: "Two disorders at once. Find both.",
    topics: [t("Acid-Base Disorders", "renal")],
  },
  {
    id: "pv-loops", kind: "showdown", track: "step1", level: "challenge", size: 5,
    title: "PV loops", hook: "Preload, afterload, contractility — read the loop.",
    topics: [t("Cardiac Physiology & Hemodynamics", "cardiovascular")],
  },
  {
    id: "diuretics", kind: "showdown", track: "step1", level: "balanced", size: 5,
    title: "Diuretics by transporter", hook: "Which pump, which electrolyte?",
    topics: [t("Renal Physiology — Tubule Function & Clearance", "renal"), t("Essential Hypertension & Antihypertensives", "cardiovascular")],
  },
  {
    id: "two-by-two", kind: "showdown", track: "both", level: "balanced", size: 6,
    title: "The 2×2 table", hook: "Sensitivity, PPV, NNT — and what they mean for the patient.",
    topics: [
      t("Sensitivity, specificity & predictive values", "biostats_epi"),
      t("Relative risk, odds ratio & number needed to treat", "biostats_epi"),
      t("Study designs & bias", "biostats_epi"),
    ],
  },

  // ── Scenarios ────────────────────────────────────────────────────────────
  {
    id: "ed-chest-pain", kind: "scenario", track: "step2ck", level: "balanced", size: 5,
    title: "Chest pain in the ED", hook: "Five patients, five different killers.",
    topics: [
      t("Acute Coronary Syndrome (STEMI/NSTEMI/UA)", "cardiovascular"),
      t("Aortic Aneurysm & Dissection", "cardiovascular"),
      t("Pulmonary Embolism & DVT", "respiratory"),
      t("Pericardial Disease (Pericarditis & Tamponade)", "cardiovascular"),
      t("Pneumothorax", "respiratory"),
    ],
  },
  {
    id: "crashing", kind: "scenario", track: "step2ck", level: "challenge", size: 6,
    title: "The crashing patient", hook: "Which shock, and what now?",
    topics: [t("Shock Syndromes", "cardiovascular"), t("Sepsis & Septic Shock", "infectious_disease"), t("Pericardial Disease (Pericarditis & Tamponade)", "cardiovascular")],
  },
  {
    id: "sob-ward", kind: "scenario", track: "step2ck", level: "balanced", size: 6,
    title: "Short of breath on the ward", hook: "Heart, clot, infection or airway?",
    topics: [
      t("Heart Failure — HFpEF & Acute Decompensation", "cardiovascular"),
      t("Pulmonary Embolism & DVT", "respiratory"),
      t("Pneumonia — Community, Hospital & Atypical", "respiratory"),
      t("Obstructive Lung Disease — COPD & Emphysema", "respiratory"),
    ],
  },
  {
    id: "pregnancy-pain", kind: "scenario", track: "step2ck", level: "balanced", size: 6,
    title: "Abdominal pain in pregnancy", hook: "Surgical, obstetric, or both?",
    topics: [
      t("Ectopic Pregnancy & Spontaneous Abortion", "repro"),
      t("Appendicitis & Acute Abdomen", "gastrointestinal"),
      t("Hypertensive Disorders of Pregnancy — Preeclampsia & Eclampsia", "repro"),
    ],
  },
  {
    id: "ams", kind: "scenario", track: "step2ck", level: "balanced", size: 6,
    title: "Altered mental status", hook: "Sugar, salt, infection or bleed?",
    topics: [
      t("Altered Consciousness & Brain Death", "neuro"),
      t("CNS Infections — Meningitis & Encephalitis", "neuro"),
      t("Fluid & Electrolyte Disorders — Sodium & Water", "renal"),
      t("Diabetic Ketoacidosis & Hyperosmolar State", "endocrine"),
    ],
  },
  {
    id: "gi-bleed", kind: "scenario", track: "step2ck", level: "balanced", size: 5,
    title: "GI bleed: scope, band or operate?", hook: "Stabilise first — then decide.",
    topics: [t("GI Bleeding — Upper & Lower", "gastrointestinal"), t("Cirrhosis & Portal Hypertension", "gastrointestinal")],
  },
  {
    id: "stroke-code", kind: "scenario", track: "step2ck", level: "balanced", size: 5,
    title: "Stroke code", hook: "Thrombolyse, thrombectomy, or neither?",
    topics: [t("Cerebrovascular Disease — Ischemic Stroke", "neuro"), t("Cerebrovascular Disease — Hemorrhagic Stroke & SAH", "neuro")],
  },
  {
    id: "endo-emergencies", kind: "scenario", track: "step2ck", level: "challenge", size: 6,
    title: "Endocrine emergencies", hook: "DKA, thyroid storm, adrenal crisis.",
    topics: [
      t("Diabetic Ketoacidosis & Hyperosmolar State", "endocrine"),
      t("Hyperthyroidism — Graves' Disease & Thyroid Storm", "endocrine"),
      t("Adrenal Insufficiency & Addison's Disease", "endocrine"),
    ],
  },
  {
    id: "electrolytes", kind: "scenario", track: "both", level: "balanced", size: 6,
    title: "Electrolyte emergencies", hook: "Potassium, sodium, calcium — what kills first?",
    topics: [t("Potassium, Calcium & Magnesium Disorders", "renal"), t("Fluid & Electrolyte Disorders — Sodium & Water", "renal")],
  },
  {
    id: "immunocompromised", kind: "scenario", track: "step2ck", level: "balanced", size: 5,
    title: "Fever without defenses", hook: "The immunocompromised patient.",
    topics: [t("Opportunistic Infections in Immunocompromise", "infectious_disease"), t("HIV/AIDS — Pathophysiology, Staging & ART", "infectious_disease")],
  },
  {
    id: "well-child", kind: "scenario", track: "step2ck", level: "foundations", size: 5,
    title: "The well-child visit", hook: "Milestones, shots and screening.",
    topics: [
      t("Developmental Milestones — Infancy to Adolescence", "peds_dev"),
      t("Childhood Immunisation Schedule", "peds_dev"),
      t("Preventive Care & Well-Child Visits", "peds_dev"),
    ],
  },
  {
    id: "labor-ward", kind: "scenario", track: "step2ck", level: "balanced", size: 5,
    title: "Labor ward night", hook: "Bleeding, pressure, seizures.",
    topics: [
      t("Labor, Delivery & Postpartum Complications", "repro"),
      t("Hypertensive Disorders of Pregnancy — Preeclampsia & Eclampsia", "repro"),
    ],
  },
  {
    id: "screening", kind: "scenario", track: "step2ck", level: "foundations", size: 5,
    title: "Who gets screened, and when?", hook: "Colon, breast, cervix.",
    topics: [
      t("Colorectal Cancer & Polyp Screening", "gastrointestinal"),
      t("Breast Cancer — Screening, Diagnosis & Management", "repro"),
      t("Cervical Cancer & HPV", "repro"),
    ],
  },
  {
    id: "hard-conversations", kind: "scenario", track: "both", level: "balanced", size: 5,
    title: "Hard conversations", hook: "Bad news, capacity, an error to disclose.",
    topics: [
      t("Breaking bad news (SPIKES)", "social_sciences"),
      t("Informed consent & decision-making capacity", "social_sciences"),
      t("Disclosure of medical errors", "social_sciences"),
    ],
  },
];

/** The cards that suit a student's exam target. */
export function challengesFor(target: "step1" | "step2ck" | "mixed"): Challenge[] {
  if (target === "mixed") return CHALLENGES;
  return CHALLENGES.filter((c) => c.track === "both" || c.track === target);
}

/** Today's challenge — the same card for every student on a target that day. */
export function dailyChallenge(target: "step1" | "step2ck" | "mixed", now = Date.now()): Challenge {
  const pool = challengesFor(target);
  const day = Math.floor(now / 86_400_000);
  return pool[day % pool.length];
}
