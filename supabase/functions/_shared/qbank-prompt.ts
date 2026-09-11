/**
 * QBank item-writing prompt — v13.1-api.
 *
 * The author's v13 prompt, adapted for API use. The pedagogy is unchanged: the
 * ten mandatory item-writing rules, the Step 2 CK drift traps, the reasoning
 * order framework, the domain-calibrated vignette lengths, the learner-centered
 * explanation style, the bolding rules and the clue economy test are all v13
 * verbatim, and they line up well with NBME item-writing guidance.
 *
 * What changed, and why:
 *
 *  - Output is one JSON object instead of the `--- QUESTION [N] ---` text block.
 *    Corti supports response_format {type:"json_object"} but NOT json_schema, so
 *    the contract is stated here and the output has to survive being imperfect.
 *  - v13 assumed First Aid / Pathoma screenshots and a planning sheet prepared
 *    by a human author. An API call has neither, so the batch plan is computed
 *    in code (buildBatchPlan) and injected, and the buzzword authority falls
 *    back to the model's own knowledge with v13's honesty valve — anything not
 *    confirmable must be surfaced in reviewerFlag.
 *  - v13 told the model to ask for a missing System Brief. It must never ask:
 *    briefs are resolved server-side and always supplied.
 *  - The Completed Questions Log and the Quality Summary left the model's
 *    output. The log becomes an injected "do not duplicate" list; the summary is
 *    computed from the per-question fields. Both were pure output tokens.
 *  - The 20-line check/cross SELF-CHECK became a compact boolean object. It
 *    keeps the forcing function and saves ~200 output tokens per question.
 *
 * Two additions come from the research on LLM-generated medical MCQs, which
 * finds three consistent failure modes — items run too easy, they cluster at
 * Bloom's lower tiers, and a small but real fraction have factual errors:
 *
 *  - An explicit difficulty target (~65-70% correct for a prepared student),
 *    because AI items measure significantly easier than human-written ones.
 *  - An explicit Bloom mapping on the reasoning orders, because AI items
 *    cluster at Remember/Understand while human items reach Apply/Analyse.
 *
 * The third failure mode is deliberately NOT addressed here: a model cannot
 * self-report a factual error it does not know it made. That is handled outside
 * the prompt, by the independent cold-answering pass and the machine QA gate.
 */

export type OptionLetter = "a" | "b" | "c" | "d" | "e";
export type ReasoningOrder = "1st" | "2nd" | "3rd";

/**
 * How hard the student asked for the set to be.
 *
 * This is a reasoning-order dial, not a difficulty dial, because reasoning order
 * is the thing the batch plan actually controls. The model self-labels
 * difficulty, and it labels it downstream of the order it was told to write at —
 * so moving the order mix is what moves the difficulty, and claiming to set
 * difficulty directly would be claiming a control that does not exist.
 */
export type ChallengeLevel = "foundations" | "balanced" | "challenge";

export const CHALLENGE_LEVELS: ChallengeLevel[] = [
  "foundations",
  "balanced",
  "challenge",
];

export const DEFAULT_CHALLENGE: ChallengeLevel = "balanced";

/**
 * Target share of 1st- and 3rd-order items per level; 2nd-order takes the rest.
 *
 * The floors are what stop a small set collapsing to one note. "balanced" keeps
 * one item at each end however short the batch — the shape the mix has always
 * had. The other two drop the floor on the end they are moving away from, so
 * "foundations" is allowed to contain no 3rd-order item at all rather than
 * being forced to carry one.
 */
const CHALLENGE_MIX: Record<
  ChallengeLevel,
  { first: number; third: number; minFirst: number; minThird: number }
> = {
  foundations: { first: 0.5, third: 0.1, minFirst: 1, minThird: 0 },
  balanced: { first: 0.2, third: 0.2, minFirst: 1, minThird: 1 },
  challenge: { first: 0.1, third: 0.5, minFirst: 0, minThird: 1 },
};

/** Narrows unknown input — a request body, say — onto the enum. */
export function asChallengeLevel(value: unknown): ChallengeLevel {
  return CHALLENGE_LEVELS.includes(value as ChallengeLevel)
    ? (value as ChallengeLevel)
    : DEFAULT_CHALLENGE;
}

/**
 * System keys. The display names match `curriculum_topics.system` exactly so
 * generated items can be linked to the roadmap later without a mapping table,
 * and so the three systems that already hold curated questions
 * (Cardiovascular / Gastrointestinal / Respiratory) keep their existing
 * `questions.subject` values.
 */
export type SystemKey =
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
};

export const SYSTEM_KEYS = Object.keys(SYSTEM_NAMES) as SystemKey[];

/** The domain enum items must use. Mirrors v13's Domain line. */
export const DOMAINS = [
  "Anatomy",
  "Embryology",
  "Histopathology",
  "Physiology",
  "Pathology",
  "Pharmacology",
  "Pattern Recognition",
] as const;

/** v13's Competency line. */
export const COMPETENCIES = [
  "Foundational Science",
  "Diagnosis — H&P",
  "Diagnosis — Formulating",
  "Management — Pharmacotherapy",
] as const;

/**
 * The static system prompt. Byte-identical across requests so it lands in
 * Corti's cached-input tier (10x cheaper); everything varying per request goes
 * in the user message built by buildUserMessage().
 */
export const QBANK_SYSTEM_PROMPT = `# StudyBuddy QBank — Question Generation | v13.1-api

## Your Role

You are a medical question writer working to the same standard as NBME item writers. You generate original, high-quality USMLE Step 1-style MCQs for StudyBuddy, a live med student study platform. Every question is reviewed by a medical student before going live. Write as if a real exam board will scrutinize every word.

The output is a teaching tool for medical students, not a prompt engineering document. Two failure modes from earlier versions are corrected here permanently: questions drifting into Step 2 CK management, and explanations written for the question constructor rather than the learner.

## Step 2 CK Drift — applies to every system

Every organ system has clinical algorithms that feel natural to write and are Step 2 CK territory, not Step 1. These must NEVER be the tested concept: fluid and resuscitation protocols; staging or grading thresholds and referral criteria; therapy-initiation indications such as dialysis, mechanical ventilation, anticoagulation start/stop, or transfusion thresholds; transplant or surgical candidacy criteria; drug-selection algorithms within a class, and step-up or step-down sequencing; dosing, titration, or monitoring protocols; screening interval or follow-up guidelines.

The physiology or pathophysiology BEHIND a clinical decision is fair game. The decision or protocol itself is not. If the correct answer requires knowing a guideline, threshold, or management protocol, rewrite it to test the underlying mechanism instead. The active System Brief lists further traps specific to its system.

## Never Test

Clinical management protocols, guideline thresholds, dosing, contraindication hierarchies, or drug and intervention selection algorithms.

Test only: mechanisms, transport and receptor biology, anatomy, embryology, histology, pathophysiology, pharmacology MOA, and pattern recognition tied to mechanism — scoped to the active System Brief's topic tiers.

## Source Material & Authority

- Content scope: Official 2025 USMLE Content Outline, for the system named in the active System Brief.
- Depth ceiling: First Aid for USMLE Step 1 (2025 edition). Pathoma is acceptable for pathology mechanism depth. Do not exceed Step 1 foundational science depth.
- Buzzwords: use established First Aid high-yield phrases. You are working from your own knowledge with no reference material attached, so any buzzword you are not fully confident is a genuine First Aid phrase must be named in reviewerFlag as "buzzword from memory, unconfirmed".
- Uncertainty rule: if uncertain about any fact, say so in reviewerFlag. Never fabricate. An honest flag costs nothing; a confident error reaches a student.

## Reasoning Order Framework

Write the reasoning chain BEFORE writing the vignette. It is your construction blueprint.

- 1st-order — one step. Direct pattern recognition or single fact recall. Bloom: Remember / Understand.
- 2nd-order — two sequential steps. An intermediate conclusion is required. Bloom: Apply.
- 3rd-order — three chained steps. The answer is never directly stated; it must be constructed across all three links. Bloom: Analyse.

Rules:
- Reasoning order must be genuinely earned. A question answerable by one memorized fact is 1st-order regardless of vignette length.
- For 3rd-order, each distractor must represent stopping at a different step in the chain.
- The words "Step 1", "Step 2", "Step 3" must NEVER appear in the explanation or the distractor explanations. The reasoning chain is internal scaffolding only.

## Difficulty Calibration

Target: a well-prepared student sitting this item should answer correctly roughly 65-70% of the time. Generated items run systematically easier than human-written ones, so when an item feels comfortable it is probably too easy — tighten the clue economy rather than reaching for obscurity. Difficulty comes from the reasoning required, never from rare facts, ambiguous wording, or withheld information.

## Vignette Length — domain-calibrated

These are requirements, not suggestions. Count the sentences in your stem before you emit it.

- Short, 3-5 sentences plus lead-in: histopathology, anatomy, 1st-order pharmacology, pattern recognition from labs or imaging.
- Medium, 5-8 sentences plus lead-in: physiology, embryology, 2nd-order pharmacology, quantitative or physiologic-calculation problems.
- Long, 8-12 sentences plus lead-in: 3rd-order only, and multi-system integration questions.

A 2nd-order item with a three-sentence stem has not been made concise, it has been made 1st-order: there was no room in it for the intermediate conclusion the reader is supposed to reach. If you find yourself under the floor, the fix is not to pad with filler — it is that the item is not carrying the reasoning its label claims, so build more clinical context into the presentation until the reader has to work through it.

If a sentence can be removed without making the question unanswerable or ambiguous, remove it — then check the count again and rebuild the item if it now falls short.

## Mandatory Item-Writing Rules

Every question must pass all ten before you output it.

1. Foundational science only. No clinical protocols. The answer is derivable from mechanism, not memorized management.
2. Student-generatable answer. Reachable by a prepared student through explicit reasoning. Write the reasoning chain first.
3. Closed, focused lead-in. A single specific answerable question. Never "which of the following is true about X".
4. Homogeneous options. All five belong to the same category. Never mix categories. Read your own lead-in back: if it asks "which cord", every option is a cord — not a trunk, not a root, not a nerve. An option that is not a member of the category asked for can be eliminated without any medical knowledge, which turns a five-option item into a three-option one.
5. All distractors genuinely plausible. Every wrong answer represents a specific reasoning failure a real student could make. No throwaway options.
6. No absolute or vague language. Banned in options: always, never, usually, frequently, may, could be, is associated with, is useful for.
7. Parallel format, equal length. Options grammatically parallel. The correct answer must not be the longest option.
8. No all or none of the above. Always exactly five distinct options, a through e.
9. No red herrings. Every vignette element is clinically realistic and serves a purpose.
10. No answer telegraphing. The vignette must not encode the answer through word choice, finding sequence, description specificity, or redundant stacking of confirming signals.
   - Do not describe findings in language exclusive to the correct diagnosis; state findings at clinical face value.
   - Do not sequence vignette elements in the same order as the reasoning chain. It should read like a patient presentation, not a worked solution.
   - The lead-in must not contain vocabulary that maps directly onto one option.
   - Distractors must be eliminable only by mechanistic reasoning, not by surface mismatch with the phrasing.
   - If three or more independent findings each individually identify the same diagnosis, the vignette is over-clued regardless of phrasing. Remove the weakest one or two and replace them with equivocal findings that keep the presentation realistic.

## Vignette and Lead-In Are Separate Fields

This is the most commonly broken rule, so it is stated as a rule rather than a formatting note.

The vignette is the patient presentation. It ends on a finding, never on a question. **The vignette must not contain a question mark at all.** The moment you write "Which…" or "What…" you have left the vignette and started the lead-in — that sentence belongs in the leadIn field and nowhere else. Do not write the question twice, once at the end of the vignette and again in leadIn, and do not write a shortened version in one and a longer version in the other. Write the presentation, stop, then write the question once.

## Clue Economy

Before output, apply the clue stripping test to every item: mentally remove the two most confirming details from the stem. Is the answer still reachable? If yes, those details were redundant — revise. 1st-order carries one pathognomonic finding only. 2nd-order must not state the intermediate conclusion in the stem. 3rd-order requires every chain link to be inferred.

Count the findings in your stem that independently point at the diagnosis. Two is the ceiling. A patient who is tall, has long fingers, an arm span exceeding height, and dislocated lenses has been identified four times over — that stem tests whether the reader has heard of the syndrome, not whether they can reason about it. Keep the one or two findings that most require interpretation and replace the rest with findings that are consistent but not by themselves diagnostic.

An over-determined stem requires recognition only, not reasoning. It is 0th-order regardless of its label.

## Explanation Writing — learner-centered

The explanation is a teaching tool. It must read like a confident teacher walking a student through the medicine.

- Open directly with the mechanism or finding that makes the answer correct.
- Walk through the reasoning as connected prose: because, this means, as a result, therefore.
- Never use Step 1 / Step 2 / Step 3 labels, or any meta-language about reasoning chains or steps.
- Embed First Aid buzzwords naturally as retrieval anchors.
- Length proportional to complexity: 1st-order 2-3 sentences; 3rd-order one tight paragraph.

Bolding, using markdown double-asterisks inside the explanation string:
- Bold First Aid buzzwords and established high-yield phrases that anchor the concept.
- Bold the core mechanism phrase — the single clause capturing why the answer is correct.
- Bold drug class labels, transporter names and receptor names when they are the tested concept.
- Bold histologic, imaging or gross-pathology descriptors that are the key pattern.
- Cap at 4-5 bolded items. If everything is bolded, nothing is.
- Never bold transitional filler, patient demographics, or clinical context that carries no retrieval weight.

Distractor explanations: 1-2 sentences each, maximum. State what the student was thinking, then the specific medical error. Plain medical language only. Never bold anything in a distractor explanation — the contrast is what lets the learner locate the key teaching content.

Tone, wrong: "Step 1: hypokalemia plus metabolic alkalosis, so diuretic. Step 2: normal chloride, not vomiting, so thiazide."

Tone, right: "**Thiazide diuretics** inhibit the **NCC cotransporter** in the early distal convoluted tubule, increasing NaCl delivery to the collecting duct. Aldosterone-driven potassium secretion at the principal cell then drives hypokalemia and metabolic alkalosis. Crucially, thiazides increase calcium reabsorption in the DCT: when intracellular sodium falls, the **basolateral Na/Ca exchanger** becomes more active, pulling more calcium out of the cell and lowering tubular calcium, which is why urine calcium is low despite the hypokalemic alkalosis."

Distractor, right: "Loop diuretics also cause hypokalemia and metabolic alkalosis, but they block paracellular calcium reabsorption in the thick ascending limb, producing hypercalciuria rather than hypocalciuria."

## Answer Position

Put the correct answer wherever it naturally belongs and say which letter that is in correctOption. Do not try to spread your answers across the letters, and do not move an option to reach a particular letter — the options are shuffled after you hand the batch over, so answer position is not your problem and any effort you spend on it is wasted.

The one thing that matters here: never change which option is medically correct in order to satisfy anything about position. If the correct answer is option c, the answer is c.

## Verbosity

This applies to the explanations, the teaching point and the reasoning chain, and NOT to the vignette. In those fields, be 10% more concise than your default: remove any sentence restating what was already said, remove transitional filler, and keep distractor explanations to 1-2 sentences, no exceptions.

The vignette is governed by the length rules above instead, and those are floors. A stem that runs short is the more common failure and the more damaging one: it is what makes a question that is labelled 3rd-order answerable in one step. Concision in a vignette means removing sentences that carry no finding, never compressing the presentation into fewer findings than the reasoning requires.

## Known Pitfalls — avoid all

1. Factual hallucination. Flag uncertainty, never fabricate.
2. Insolvable question. Every reasoning step must be completable from the vignette alone.
3. Reasoning inconsistency. The explanation must trace the exact chain the vignette requires.
4. Implausible distractors. Each wrong answer must be a real biological alternative.
5. False complexity. A question answerable by one memorized fact is 1st-order however long the vignette.
6. Step 2 CK drift. Test the mechanism, not the decision. Check the universal list and the System Brief's traps.
7. Explanation meta-language. Any explanation containing "Step 1", "Step 2", "Step 3", "reasoning chain" or "fails at step" is a failed explanation.
8. Vignette padding. Any removable sentence must be removed.
9. Missing buzzwords. If the answer turns on a First Aid high-yield phrase, that phrase appears bolded in the explanation.
10. Bending the medicine to fit a letter. correctOption names the option that is actually correct, always. Never move the key onto a different letter for any reason.
11. Answer telegraphing. If a prepared student could identify the answer from phrasing alone, rewrite.
12. Over-bolding. More than five bolded items dilutes the signal.
13. Bolding the wrong things. Never bold transitions, demographics or context.
14. System overlap drift. An item that slides into an adjacent system's primary physiology, pharmacology or anatomy belongs in that system's block. Flag it in reviewerFlag and revise.
15. Clue stacking. Three or more independent confirming signals collapses every difficulty level. Enforce clue economy before output.

## Output Contract

Return ONE JSON object and nothing else. No prose before or after it, and no markdown code fences. The only markdown permitted is double-asterisk bolding inside explanation and teachingPoint strings.

{
  "batchPlan": { "system": string, "answerPositions": [string] },
  "questions": [
    {
      "index": number,
      "system": string,
      "domain": one of "Anatomy" | "Embryology" | "Histopathology" | "Physiology" | "Pathology" | "Pharmacology" | "Pattern Recognition",
      "subtopic": string,
      "competency": one of "Foundational Science" | "Diagnosis — H&P" | "Diagnosis — Formulating" | "Management — Pharmacotherapy",
      "difficulty": one of "Easy" | "Medium" | "Hard",
      "reasoningOrder": one of "1st" | "2nd" | "3rd",
      "reasoningChain": string,
      "vignette": string,
      "leadIn": string,
      "options": { "a": string, "b": string, "c": string, "d": string, "e": string },
      "correctOption": one of "a" | "b" | "c" | "d" | "e",
      "explanation": string,
      "distractorExplanations": { "<letter>": string },
      "teachingPoint": string,
      "suggestedImage": {
        "needed": one of "Yes" | "No" | "Optional",
        "type": one of "histology_light_microscopy" | "histology_electron_microscopy" | "immunofluorescence_pattern" | "gross_pathology_specimen" | "radiologic_imaging" | "ecg" | "peripheral_blood_smear" | "karyotype_genetic" | "anatomical_diagram" | "embryologic_diagram" | "physiologic_process_diagram" | "algorithm_flowchart" | "none",
        "searchTags": [string],
        "mustShow": string
      },
      "selfCheck": {
        "rule1": boolean, "rule2": boolean, "rule3": boolean, "rule4": boolean, "rule5": boolean,
        "rule6": boolean, "rule7": boolean, "rule8": boolean, "rule9": boolean, "rule10": boolean,
        "reasoningOrderEarned": boolean, "explanationClean": boolean, "vignetteLengthAppropriate": boolean,
        "depthCheck": boolean, "step2DriftCheck": boolean, "answerPositionMatchesPlan": boolean,
        "boldingCorrect": boolean, "clueEconomy": boolean
      },
      "reviewerFlag": string
    }
  ]
}

Field notes:
- vignette holds the clinical stem only and contains no question mark. leadIn holds the question sentence, ending in a question mark. See "Vignette and Lead-In Are Separate Fields" above — a batch where the vignettes end in questions is a failed batch.
- reasoningChain is internal scaffolding. It is stored for review and never shown to a student, so write it plainly.
- correctOption is the option that is medically correct. Nothing else determines it.
- distractorExplanations has one entry for each of the four incorrect letters, and no entry for the correct one. If you find yourself writing an entry that argues an option is right, that option is your key and correctOption is wrong — fix correctOption, do not write the entry.
- Every selfCheck field must be true before you emit the question. If one would be false, fix the question instead. Never emit an item you know fails a rule.
- reviewerFlag is "None." only when you are fully confident. Otherwise state the specific concern: factual uncertainty, depth, distractor risk, unconfirmed buzzword, or system overlap.
- suggestedImage describes an image that would help. No image is fetched or rendered, so never write a vignette that depends on seeing one.
- Emit the questions in index order, and finish each question object completely before starting the next. The client renders them as they arrive.`;

/**
 * System Briefs.
 *
 * v13 requires a filled brief before any generation and tells the model to ask
 * for missing fields. On-demand there is nobody to ask, so all thirteen are
 * pre-written here and resolved server-side from the student's topic. They are
 * what makes a system-agnostic prompt renal, cardiac or endocrine for a given
 * request — the drift traps in particular are the highest-value field, since
 * each system fails toward Step 2 CK in its own characteristic way.
 */
export const SYSTEM_BRIEFS: Record<SystemKey, string> = {
  cardiovascular: `CONTENT DISTRIBUTION: Pathology/Histopathology 40-45%, Physiology 25-30%, Pharmacology (MOA only) 15-20%, Anatomy & Embryology 10%.
TIER 1: atherosclerosis and ischemic heart disease; heart failure and pressure-volume relationships; valvular lesions and murmurs; congenital shunts; arrhythmia mechanisms and the cardiac action potential; hypertension and RAAS.
TIER 2: cardiomyopathies; pericardial disease; endocarditis; vasculitides; aneurysm and dissection; shock physiology; lipid disorders.
TIER 3: cardiac tumours; congenital arch anomalies; Starling and Frank-Starling detail; baroreceptor reflexes.
PHARMACOLOGY: antiarrhythmics by class and channel, beta blockers, calcium channel blockers, ACE inhibitors and ARBs, nitrates, diuretics acting on preload, statins, cardiac glycosides. MOA, site of action and mechanism-based adverse effects only.
OVERLAP: Renal (RAAS, volume, edema), Respiratory (V/Q, cor pulmonale, pulmonary hypertension), Endocrine (catecholamines, thyroid on the heart), Heme (thrombosis, anticoagulant MOA).
SYSTEM DRIFT TRAPS: reperfusion strategy selection in ACS; heart failure medication titration and sequencing; anticoagulation initiation in atrial fibrillation; valve replacement candidacy; lipid treatment thresholds.`,

  respiratory: `CONTENT DISTRIBUTION: Pathology/Histopathology 40%, Physiology 30%, Pharmacology (MOA only) 15%, Anatomy & Embryology 15%.
TIER 1: obstructive versus restrictive mechanics and PFT patterns; V/Q mismatch, shunt and dead space; oxygen-haemoglobin dissociation; asthma and COPD pathophysiology; pneumonia patterns; lung cancer histology and paraneoplastic syndromes.
TIER 2: pulmonary embolism and infarction; ARDS pathophysiology; interstitial lung disease and pneumoconioses; cystic fibrosis; surfactant and neonatal RDS; pleural pathology.
TIER 3: bronchiectasis; sleep apnoea physiology; high-altitude adaptation; lung development stages.
PHARMACOLOGY: beta-2 agonists, muscarinic antagonists, inhaled corticosteroids, leukotriene modifiers, methylxanthines, pulmonary vasodilators. MOA and mechanism-based adverse effects only.
OVERLAP: Cardiovascular (pulmonary hypertension, cor pulmonale), Renal (acid-base compensation), ID (pneumonia pathogens), Immune (hypersensitivity, atopy).
SYSTEM DRIFT TRAPS: ventilator setting selection in ARDS; oxygen therapy targets; asthma step-up and step-down therapy; PE anticoagulation choice; lung cancer staging thresholds.`,

  gastrointestinal: `CONTENT DISTRIBUTION: Pathology/Histopathology 45%, Physiology 25%, Pharmacology (MOA only) 15%, Anatomy & Embryology 15%.
TIER 1: peptic ulcer disease and H pylori; inflammatory bowel disease; cirrhosis and portal hypertension; viral hepatitis; malabsorption syndromes; colorectal neoplasia sequence; oesophageal pathology.
TIER 2: pancreatitis mechanisms; biliary disease and bilirubin metabolism; GI bleeding sources; motility disorders; hernias and the inguinal canal; gut hormone physiology.
TIER 3: carcinoid and neuroendocrine tumours; congenital atresias and malrotation; vitamin deficiency syndromes; enteric nervous system.
PHARMACOLOGY: proton pump inhibitors, H2 blockers, prokinetics, laxatives and antidiarrhoeals, antiemetics by receptor, aminosalicylates. MOA and mechanism-based adverse effects only.
OVERLAP: Heme (iron and B12 absorption, GI bleeding), ID (hepatitis viruses, enteric pathogens), Endocrine (gut hormones, insulin and glucagon), Immune (coeliac, IBD immunology).
SYSTEM DRIFT TRAPS: variceal bleeding management protocols; IBD biologic selection; hepatitis treatment regimens; colonoscopy screening intervals; pancreatitis severity scoring and fluid protocols.`,

  renal: `CONTENT DISTRIBUTION: Physiology 35%, Pathology/Histopathology 35%, Pharmacology (MOA only) 15%, Anatomy & Embryology 15%.
TIER 1: nephron transport by segment; glomerular filtration and clearance; acid-base disorders; potassium and sodium handling; nephritic versus nephrotic syndromes; acute tubular necrosis and casts.
TIER 2: RAAS and ADH physiology; diabetic and hypertensive nephropathy; cystic kidney disease; nephrolithiasis chemistry; renal tubular acidoses; obstructive uropathy.
TIER 3: renal embryology and congenital anomalies; renal cell carcinoma; countercurrent multiplication detail; EPO and mineral bone axis.
PHARMACOLOGY: loop, thiazide and potassium-sparing diuretics, carbonic anhydrase inhibitors, ADH analogues and antagonists, RAAS blockers, SGLT2 inhibitors. MOA, site of action and mechanism-based adverse effects only.
OVERLAP: Cardiovascular (volume, edema, hypertension), Endocrine (RAAS, ADH, aldosterone), Heme (EPO and anemia of CKD), ID (pyelonephritis pathogens).
SYSTEM DRIFT TRAPS: dialysis initiation criteria; transplant candidacy; CKD staging thresholds and referral; potassium correction protocols; contrast nephropathy prophylaxis regimens.`,

  endocrine: `CONTENT DISTRIBUTION: Physiology 35%, Pathology/Histopathology 30%, Pharmacology (MOA only) 20%, Anatomy & Embryology 15%.
TIER 1: hypothalamic-pituitary axes and feedback; thyroid physiology and dysfunction; adrenal cortex and medulla disorders; diabetes mellitus pathophysiology; calcium and PTH regulation.
TIER 2: pituitary adenomas; MEN syndromes; congenital adrenal hyperplasias; insulin and glucagon signalling; growth hormone axis; diabetes insipidus and SIADH.
TIER 3: pancreatic islet tumours; thyroid histopathology subtypes; vitamin D metabolism detail; endocrine embryology.
PHARMACOLOGY: insulin preparations by kinetics, metformin, sulfonylureas, GLP-1 agonists, SGLT2 inhibitors, thionamides, corticosteroids, bisphosphonates. MOA and mechanism-based adverse effects only.
OVERLAP: Renal (RAAS, ADH, calcium handling), Cardiovascular (catecholamines, thyroid on the heart), Repro (sex steroid axes), Heme (steroid effects on marrow).
SYSTEM DRIFT TRAPS: insulin regimen selection and titration; diabetes screening intervals; thyroid nodule workup algorithms; steroid tapering protocols; osteoporosis treatment thresholds.`,

  heme_onc: `CONTENT DISTRIBUTION: Pathology/Histopathology 45%, Physiology 25%, Pharmacology (MOA only) 20%, Anatomy & Embryology 10%.
TIER 1: microcytic, macrocytic and hemolytic anemias; coagulation cascade and platelet function; leukemias and lymphomas by lineage; hemoglobinopathies; iron studies interpretation.
TIER 2: myeloproliferative neoplasms; plasma cell dyscrasias; thrombophilias; transfusion reaction mechanisms; DIC and TTP/HUS mechanisms; oncogenes and tumour suppressors.
TIER 3: bone marrow failure syndromes; paraneoplastic syndromes; tumour lysis biochemistry; hematopoiesis ontogeny.
PHARMACOLOGY: anticoagulants and antiplatelets by target, thrombolytics, chemotherapy agents by cell-cycle site, targeted kinase inhibitors, hematopoietic growth factors. MOA and mechanism-based adverse effects only.
OVERLAP: Immune (lymphocyte biology, immunodeficiency), GI (iron and B12 absorption), Renal (EPO), ID (febrile neutropenia pathogens).
SYSTEM DRIFT TRAPS: transfusion thresholds; chemotherapy regimen choice; anticoagulation duration and bridging; cancer staging and referral criteria; growth factor dosing protocols.`,

  repro: `CONTENT DISTRIBUTION: Pathology/Histopathology 35%, Physiology 30%, Anatomy & Embryology 20%, Pharmacology (MOA only) 15%.
TIER 1: menstrual cycle hormonal control; sexual differentiation and embryology; placental physiology; gestational complications by mechanism; ovarian and testicular neoplasms; androgen and estrogen synthesis.
TIER 2: PCOS and hyperandrogenism; endometriosis and fibroids; cervical and endometrial neoplasia; male infertility mechanisms; pregnancy physiologic adaptations; congenital genital anomalies.
TIER 3: gestational trophoblastic disease; breast pathology; lactation physiology; teratogen mechanisms.
PHARMACOLOGY: combined and progestin-only contraceptives, SERMs and aromatase inhibitors, GnRH agonists and antagonists, tocolytics, uterotonics, testosterone and 5-alpha reductase inhibitors. MOA and mechanism-based adverse effects only.
OVERLAP: Endocrine (HPG axis, sex steroid synthesis), Peds/Development (fetal development, teratogens), Immune (Rh isoimmunisation), Heme (pregnancy hypercoagulability).
SYSTEM DRIFT TRAPS: obstetric management and delivery decisions; cervical cancer screening intervals; infertility treatment algorithms; contraception selection counselling; preeclampsia management protocols.`,

  msk_derm: `CONTENT DISTRIBUTION: Pathology/Histopathology 35%, Anatomy 25%, Physiology 20%, Pharmacology (MOA only) 20%.
TIER 1: upper and lower limb nerve lesions and their deficits; muscle contraction and neuromuscular junction physiology; bone remodelling and metabolic bone disease; inflammatory versus degenerative arthritis; skin layers and common dermatoses.
TIER 2: crystal arthropathies; seronegative spondyloarthropathies; muscular dystrophies; skin cancers and their precursors; bullous disorders by immunofluorescence; connective tissue disorders.
TIER 3: bone tumours by age and location; brachial and lumbosacral plexus detail; limb embryology; wound healing phases.
PHARMACOLOGY: NSAIDs and COX selectivity, colchicine, urate-lowering agents, DMARDs and biologics by target, muscle relaxants, corticosteroids in skin. MOA and mechanism-based adverse effects only.
OVERLAP: Immune (autoimmune arthritis, vasculitis skin signs), Neuro (peripheral nerve, NMJ), Endocrine (PTH and vitamin D on bone), Heme (marrow in bone lesions).
SYSTEM DRIFT TRAPS: DMARD escalation sequencing; fracture fixation decisions; gout treatment thresholds and prophylaxis timing; melanoma excision margins; biologic selection in psoriasis.`,

  neuro: `CONTENT DISTRIBUTION: Anatomy 30%, Pathology/Histopathology 25%, Physiology 25%, Pharmacology (MOA only) 20%.
TIER 1: motor and sensory tract localisation; brainstem and cranial nerve syndromes; cerebrovascular territories; neurotransmitter systems; seizure mechanisms; demyelinating disease.
TIER 2: neurodegenerative disease pathology and inclusions; CNS tumours by cell of origin and location; hydrocephalus and CSF dynamics; spinal cord syndromes; neurocutaneous syndromes.
TIER 3: neural tube and CNS embryology; sleep architecture; special senses physiology; congenital malformations.
PHARMACOLOGY: antiepileptics by channel or receptor, dopaminergic agents, cholinesterase inhibitors, triptans, anaesthetics and analgesics by receptor, neuromuscular blockers. MOA and mechanism-based adverse effects only.
OVERLAP: Psych (neurotransmitters, psychotropic MOA), MSK (peripheral nerve, NMJ), Cardiovascular (stroke mechanism, perfusion), ID (meningitis and encephalitis pathogens).
SYSTEM DRIFT TRAPS: thrombolysis time windows and eligibility; antiepileptic drug selection and switching; MS disease-modifying therapy choice; ICP management protocols; tumour resection criteria.`,

  psych: `CONTENT DISTRIBUTION: Physiology and neurochemistry 35%, Pharmacology (MOA only) 30%, Pathology 20%, Behavioural science 15%.
TIER 1: neurotransmitter systems and their receptors; antidepressant, antipsychotic and mood stabiliser mechanisms; substance intoxication and withdrawal mechanisms; the dopamine hypothesis; sleep neurophysiology.
TIER 2: defence mechanisms; developmental milestones and their disruption; extrapyramidal and metabolic drug effects by mechanism; stress axis and cortisol; personality disorder clusters.
TIER 3: ethics and consent principles; epidemiology of psychiatric illness; grief versus depression; behavioural conditioning.
PHARMACOLOGY: SSRIs and SNRIs, TCAs, MAOIs, typical and atypical antipsychotics by receptor profile, lithium, benzodiazepines, stimulants. MOA, receptor profile and mechanism-based adverse effects only.
OVERLAP: Neuro (neurotransmitters, receptor pharmacology), Endocrine (HPA axis, thyroid and mood), Cardiovascular (QT effects by mechanism), Peds/Development (neurodevelopmental disorders).
SYSTEM DRIFT TRAPS: antidepressant selection and switching algorithms; antipsychotic dosing and monitoring schedules; involuntary hold criteria; suicide risk stratification tools; therapy modality selection.`,

  infectious_disease: `CONTENT DISTRIBUTION: Microbiology and pathology 50%, Pharmacology (MOA only) 25%, Immunology and physiology 15%, Anatomy 10%.
TIER 1: bacterial classification, virulence factors and toxins; antibiotic mechanisms and resistance mechanisms; viral replication strategies; fungal and parasitic morphology; host-pathogen entry routes.
TIER 2: organism-specific pathogenesis for high-yield pathogens; vaccine mechanisms; congenital and opportunistic infections; biofilms and device infection; sterilisation principles.
TIER 3: prion biology; emerging pathogens; vector biology; laboratory identification methods.
PHARMACOLOGY: cell wall agents, protein synthesis inhibitors by ribosomal subunit, nucleic acid inhibitors, antifungals, antivirals, antiparasitics. MOA, resistance mechanism and mechanism-based adverse effects only.
OVERLAP: Immune (host defence, immunodeficiency-specific organisms), Respiratory (pneumonia), GI (enteric and hepatitis), Neuro (meningitis and encephalitis).
SYSTEM DRIFT TRAPS: empiric antibiotic selection; treatment duration; isolation and prophylaxis protocols; vaccine schedules; HIV regimen composition.`,

  immune: `CONTENT DISTRIBUTION: Physiology and immunology 40%, Pathology/Histopathology 30%, Pharmacology (MOA only) 20%, Embryology 10%.
TIER 1: innate versus adaptive immunity; T and B cell development and selection; MHC and antigen presentation; the four hypersensitivity types; complement pathways; cytokine functions.
TIER 2: primary immunodeficiencies by defective step; autoimmunity mechanisms and autoantibodies; transplant rejection by timing and mechanism; lymphoid organ architecture; immunoglobulin class switching.
TIER 3: tolerance mechanisms; tumour immunology; splenic function and asplenia; lymphatic drainage.
PHARMACOLOGY: calcineurin inhibitors, antimetabolites, biologic agents by cytokine target, checkpoint inhibitors, corticosteroids. MOA and mechanism-based adverse effects only.
OVERLAP: ID (immunodeficiency-specific organisms), Heme (lymphoid malignancy, marrow), MSK/Derm (autoimmune arthritis, bullous disease), Repro (Rh isoimmunisation).
SYSTEM DRIFT TRAPS: immunosuppression regimen selection; transplant matching criteria; biologic escalation in autoimmune disease; immunoglobulin replacement protocols; vaccination schedules in immunodeficiency.`,

  peds_dev: `CONTENT DISTRIBUTION: Embryology and development 35%, Pathology 30%, Physiology 20%, Pharmacology (MOA only) 15%.
TIER 1: embryologic derivatives by germ layer and pharyngeal arch; fetal circulation and its transition at birth; developmental milestones; congenital malformations by mechanism; genetic and chromosomal syndromes.
TIER 2: inborn errors of metabolism by blocked enzyme; neonatal jaundice mechanisms; growth and puberty physiology; teratogen mechanisms; paediatric tumours by cell of origin.
TIER 3: newborn screening biochemistry; adolescent physiology; failure to thrive mechanisms; APGAR physiology.
PHARMACOLOGY: agents affecting the ductus arteriosus, surfactant, drugs crossing the placenta or entering milk, age-dependent pharmacokinetic differences. MOA and mechanism-based effects only.
OVERLAP: Repro (fetal development, teratogens), Cardiovascular (congenital heart disease, fetal shunts), Endocrine (growth axis, congenital adrenal hyperplasia), Neuro (neurodevelopment).
SYSTEM DRIFT TRAPS: immunisation schedules; growth chart thresholds and referral; neonatal resuscitation protocols; feeding and fluid protocols; developmental screening intervals.`,
};

export interface PlannedQuestion {
  index: number;
  answerLetter: OptionLetter;
  reasoningOrder: ReasoningOrder;
}

export interface BatchPlan {
  system: SystemKey;
  systemName: string;
  challenge: ChallengeLevel;
  questions: PlannedQuestion[];
}

const LETTERS: OptionLetter[] = ["a", "b", "c", "d", "e"];

/** Fisher-Yates, in place, on a copy. */
function shuffle<T>(values: T[], random: () => number): T[] {
  const pool = [...values];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * v13's answer position rule: shuffle a-e, then cycle through the shuffle for
 * the batch length, so no letter repeats until all five have appeared.
 *
 * These letters are a target for permuteToPlannedLetter, not an instruction to
 * the model. Asking the model to write its answer onto an assigned letter was
 * measured to be actively harmful: in a 50-item run it hit the assigned letter
 * 50 times out of 50, and the one item where obeying the letter conflicted with
 * the medicine shipped with a factually wrong answer key — a correct question
 * about the canalicular stage of lung development, keyed to "alveolar stage"
 * because the plan had assigned that position. The model now picks whichever
 * letter is correct and the options are shuffled afterwards, which buys the same
 * flat distribution with none of that risk.
 */
function shuffledLetters(random: () => number): OptionLetter[] {
  return shuffle(LETTERS, random);
}

/**
 * Reasoning order mix.
 *
 * Generated items cluster at Bloom's Remember/Understand tier, so the mix is
 * imposed rather than left to the model. At the default level that is a
 * majority of 2nd-order with one item at each end — for five questions, 1/3/1.
 * The other levels shift the same shape toward one end or the other; see
 * CHALLENGE_MIX. It generalises over count, so a later batch size does not need
 * a second code path.
 *
 * Shuffled across positions, because emitting it in order made every set
 * identical in shape. A measured run put the single 1st-order item at index 1
 * and the 3rd-order item at index 5 in all ten batches, and the model labelled
 * difficulty to match: every Easy item in fifty was its batch's first question
 * and every Hard one was its fourth or fifth. A student who generates two sets
 * learns the ramp and stops reading the early items carefully.
 */
function reasoningOrderMix(
  count: number,
  random: () => number,
  challenge: ChallengeLevel = DEFAULT_CHALLENGE
): ReasoningOrder[] {
  const mixFor = CHALLENGE_MIX[challenge];
  const firsts = Math.max(mixFor.minFirst, Math.round(count * mixFor.first));
  const thirds = Math.max(mixFor.minThird, Math.round(count * mixFor.third));
  const seconds = Math.max(0, count - firsts - thirds);
  const mix = [
    ...Array<ReasoningOrder>(firsts).fill("1st"),
    ...Array<ReasoningOrder>(seconds).fill("2nd"),
    ...Array<ReasoningOrder>(thirds).fill("3rd"),
  ].slice(0, count);

  return shuffle(mix, random);
}

/**
 * Builds the per-batch plan the model is required to honour. `random` is
 * injectable so the plan is deterministic under test.
 *
 * `startIndex` exists because a large set is generated as several sequential
 * waves rather than one call, and the index has to stay unique across the whole
 * set: it is what the reconciliation RPC sorts by to put the questions back in
 * the order the plan intended, so a third wave numbering itself 1-5 again would
 * shuffle the student's set. Each wave still shuffles its own letters and
 * reasoning orders, which composes to an even spread across the whole set
 * without the plan needing to know how many waves there are.
 */
export function buildBatchPlan(
  system: SystemKey,
  count: number,
  random: () => number = Math.random,
  startIndex = 1,
  challenge: ChallengeLevel = DEFAULT_CHALLENGE
): BatchPlan {
  const letters = shuffledLetters(random);
  const orders = reasoningOrderMix(count, random, challenge);

  return {
    system,
    systemName: SYSTEM_NAMES[system],
    challenge,
    questions: Array.from({ length: count }, (_, i) => ({
      index: startIndex + i,
      answerLetter: letters[i % letters.length],
      reasoningOrder: orders[i],
    })),
  };
}

/** The shape permuteToPlannedLetter rewrites. Both parsers produce it. */
export interface PermutableQuestion {
  options: Record<OptionLetter, string>;
  correctOption: OptionLetter;
  distractorExplanations: Partial<Record<OptionLetter, string>>;
}

/**
 * The wrong-option explanations, keyed by the letter each one describes.
 *
 * These used to be flattened into the single `explanation` column, because the
 * questions table had nowhere else to put them. The student got the words but
 * lost the association: nothing tied the sentence about option C to option C,
 * and the one explanation that matters most — why the option THEY chose is
 * wrong — sat in the middle of a list. questions.distractor_explanations now
 * holds them keyed by letter, so the player can put each under its own option.
 *
 * The key never gets an entry: an explanation of why the correct answer is
 * wrong is a contradiction, and the QA gate blocks an item that emits one
 * (`distractor-explains-key`). This is the last place it can be stopped before
 * it renders under the option the student got right.
 *
 * Lives here rather than in qbank-persist because it operates on exactly the
 * shape permuteToPlannedLetter rewrites and has to run AFTER it — the two are a
 * pair, and this module is the one both runtimes can import.
 *
 * Empty rather than null when the model wrote none, so a reader can tell "this
 * set wrote none" from "this row predates the column".
 */
export function buildDistractorExplanations(
  question: PermutableQuestion
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of LETTERS) {
    if (k === question.correctOption) continue;
    const text = question.distractorExplanations[k];
    if (text) out[k] = text;
  }
  return out;
}

/**
 * Moves a question's correct answer onto the letter the batch plan wanted.
 *
 * A single swap: whatever sits on the target letter trades places with the key.
 * Everything else keeps its position, so the option order stays as close to what
 * the writer chose as moving one answer allows.
 *
 * `distractorExplanations` is keyed by letter and has to travel with the swap,
 * or the entry explaining why option c is wrong ends up attached to the text
 * that is now option e.
 *
 * This is what replaced telling the model its letters were locked. The batch
 * still gets an even spread of answer positions, and the model never has to
 * choose between the plan and the medicine.
 */
export function permuteToPlannedLetter<T extends PermutableQuestion>(
  question: T,
  target: OptionLetter
): T {
  const from = question.correctOption;
  if (from === target) return question;

  const options = { ...question.options };
  [options[from], options[target]] = [options[target], options[from]];

  const explanations = { ...question.distractorExplanations };
  const fromText = explanations[from];
  const targetText = explanations[target];
  if (targetText === undefined) delete explanations[from];
  else explanations[from] = targetText;
  if (fromText === undefined) delete explanations[target];
  else explanations[target] = fromText;

  return { ...question, options, correctOption: target, distractorExplanations: explanations };
}

/**
 * One line per level, appended to the batch plan.
 *
 * The plan already assigns a reasoning order per item, which is the binding
 * instruction; this only tells the model what the set as a whole is for, so its
 * vignette length and its own difficulty labelling follow the same intent
 * instead of drifting back to the middle.
 */
const CHALLENGE_BRIEFS: Record<ChallengeLevel, string> = {
  foundations:
    "This set is for consolidating fundamentals. Favour single-step recall and mechanism identification, keep vignettes short, and do not stack findings — one clear signal per item.",
  balanced:
    "This set is standard exam calibration: aim for roughly 65-70% correct for a prepared student.",
  challenge:
    "This set is for a student who already knows the fundamentals. Favour multi-step reasoning: make them connect a mechanism to a consequence, or discriminate between two conditions that share a presentation. Do not achieve difficulty by obscurity — the medicine stays high-yield.",
};

export interface UserMessageInput {
  /** The student's free-text topic, verbatim. */
  topic: string;
  plan: BatchPlan;
  /** Subtopics already generated in this session — v13's duplication guard. */
  avoidSubtopics?: string[];
}

/**
 * The per-request user message: the System Brief, the batch plan, and the
 * topic. Everything static lives in QBANK_SYSTEM_PROMPT so it stays cacheable.
 */
export function buildUserMessage({ topic, plan, avoidSubtopics = [] }: UserMessageInput): string {
  // Answer letters are deliberately NOT sent. They are applied after the fact
  // by permuteToPlannedLetter; telling the model about them only gives it a
  // reason to move a key off the option that is actually correct.
  const planRows = plan.questions
    .map((q) => `- Question ${q.index}: reasoning order ${q.reasoningOrder}`)
    .join("\n");

  const avoidBlock = avoidSubtopics.length
    ? `\n## Already covered — do not duplicate\n${avoidSubtopics.map((s) => `- ${s}`).join("\n")}\n`
    : "";

  return `## System Brief — ${plan.systemName}

SYSTEM: ${plan.systemName}
CONTENT SCOPE: Official 2025 USMLE Content Outline, ${plan.systemName} System
COMPETENCY BREAKDOWN: 60-70% Foundational Science; 20-25% Diagnosis tied to mechanism; 10% Management limited to drug or intervention MOA — why it works, never which protocol.
${SYSTEM_BRIEFS[plan.system]}

## Batch Plan — ${plan.questions.length} questions

${planRows}

Write each item at the reasoning order assigned to it, and put its correct answer on whichever option is correct.

${CHALLENGE_BRIEFS[plan.challenge]}
${avoidBlock}
## Requested topic

${topic}

Generate ${plan.questions.length} questions on this topic, within the ${plan.systemName} system and the brief above. If the topic is broader than one item can cover, spread the questions across its highest-yield facets; if it is narrow, approach it from different mechanisms rather than restating it. Return the JSON object only.`;
}

/**
 * Router prompt: maps a student's free-text topic onto one system key.
 *
 * Deliberately a separate cheap call rather than a field the writer model
 * chooses for itself — the System Brief has to be selected before the writing
 * prompt is assembled, and a wrong system means the wrong drift traps and the
 * wrong overlap rules for the whole batch.
 */
export const SYSTEM_ROUTER_PROMPT = `You classify a medical study topic into exactly one USMLE Step 1 organ system.

Systems, by key:
${SYSTEM_KEYS.map((k) => `- ${k}: ${SYSTEM_NAMES[k]}`).join("\n")}

Return ONE JSON object: {"system": "<key>", "confidence": <0-1>}

Use the key exactly as written above. Pick the system whose content outline the topic primarily belongs to, not one it merely touches — a topic about anaemia of chronic kidney disease is heme_onc if it is about the anaemia and renal if it is about the kidney. If the topic is too vague to place, return the closest system with a low confidence rather than refusing.`;
