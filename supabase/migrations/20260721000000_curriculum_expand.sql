-- Curriculum spine expansion: seeds the 12 remaining organ systems and their
-- high-yield level-1 topics, grounded in the official USMLE Step 1 + Step 2 CK
-- content blueprints. Additive per project schema rules — no table/index/RLS
-- changes here and no re-seed of Cardiovascular (already at sort_order 0).
--
-- Convention (matches 20260709000000):
--   level 0 = system header row, level 1 = topic.
--   yield_tier = 'high', is_active = true, generator_prompt = NULL for all rows.
--   System sort_order increments by 100 (Cardiovascular = 0); topics by 10.

-- Respiratory (sort_order 100)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Respiratory', 'Respiratory', 0, 'high', 100, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Respiratory', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Lung Anatomy & Pulmonary Physiology',                10),
  ('Obstructive Lung Disease — Asthma',                  20),
  ('Obstructive Lung Disease — COPD & Emphysema',        30),
  ('Restrictive Lung Disease — ILD & Fibrosis',          40),
  ('Pneumonia — Community, Hospital & Atypical',         50),
  ('Tuberculosis & Mycobacterial Disease',               60),
  ('Pulmonary Embolism & DVT',                           70),
  ('Pleural Effusion & Empyema',                         80),
  ('Pneumothorax',                                       90),
  ('Lung Cancer & Pulmonary Nodule Workup',             100),
  ('Respiratory Failure & Mechanical Ventilation',      110),
  ('Sleep Apnea & Hypoventilation Syndromes',           120),
  ('Cystic Fibrosis',                                   130),
  ('Pulmonary Hypertension',                            140)
) AS t(title, sort_order);

-- Renal & Urinary (sort_order 200)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Renal & Urinary', 'Renal & Urinary', 0, 'high', 200, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Renal & Urinary', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Renal Physiology — Tubule Function & Clearance',        10),
  ('Acid-Base Disorders',                                   20),
  ('Fluid & Electrolyte Disorders — Sodium & Water',        30),
  ('Potassium, Calcium & Magnesium Disorders',              40),
  ('Acute Kidney Injury — Pre-renal, Intrinsic & Post-renal', 50),
  ('Chronic Kidney Disease & Uremia',                       60),
  ('Glomerulonephritis — Nephritic Syndromes',              70),
  ('Nephrotic Syndrome & Minimal Change Disease',           80),
  ('Polycystic Kidney Disease',                             90),
  ('Urinary Tract Infections & Pyelonephritis',            100),
  ('Nephrolithiasis',                                      110),
  ('Renal Cell Carcinoma & Bladder Cancer',                120),
  ('Renal Replacement Therapy & Dialysis',                 130)
) AS t(title, sort_order);

-- Gastrointestinal (sort_order 300)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Gastrointestinal', 'Gastrointestinal', 0, 'high', 300, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Gastrointestinal', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('GI Physiology — Motility, Secretion & Absorption',   10),
  ('Gastroesophageal Reflux Disease & Esophagitis',      20),
  ('Peptic Ulcer Disease & H. pylori',                   30),
  ('Inflammatory Bowel Disease — Crohn''s Disease',      40),
  ('Inflammatory Bowel Disease — Ulcerative Colitis',    50),
  ('Celiac Disease & Malabsorption Syndromes',           60),
  ('Acute & Chronic Pancreatitis',                       70),
  ('Hepatitis — Viral (A, B, C, D, E)',                  80),
  ('Cirrhosis & Portal Hypertension',                    90),
  ('Liver Failure & Hepatic Encephalopathy',            100),
  ('Gallstones & Cholecystitis',                        110),
  ('Colorectal Cancer & Polyp Screening',               120),
  ('GI Bleeding — Upper & Lower',                        130),
  ('Intestinal Obstruction & Ileus',                    140),
  ('Appendicitis & Acute Abdomen',                      150)
) AS t(title, sort_order);

-- Neurology & Neurological Surgery (sort_order 400)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Neurology & Neurological Surgery', 'Neurology & Neurological Surgery', 0, 'high', 400, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Neurology & Neurological Surgery', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Neuroanatomy — Pathways & Localisation',                    10),
  ('Cerebrovascular Disease — Ischemic Stroke',                 20),
  ('Cerebrovascular Disease — Hemorrhagic Stroke & SAH',        30),
  ('Epilepsy & Seizure Disorders',                              40),
  ('Headache Disorders — Migraine, Tension & Cluster',          50),
  ('Dementia — Alzheimer''s, Lewy Body & Vascular',             60),
  ('Parkinson''s Disease & Movement Disorders',                 70),
  ('Multiple Sclerosis & Demyelinating Disease',                80),
  ('Peripheral Neuropathy & Guillain-Barré Syndrome',           90),
  ('Myasthenia Gravis & Neuromuscular Junction Disorders',     100),
  ('CNS Infections — Meningitis & Encephalitis',               110),
  ('Brain Tumors — Primary & Metastatic',                      120),
  ('Spinal Cord Disorders & Cord Syndromes',                   130),
  ('Vertigo & Vestibular Disorders',                           140),
  ('Altered Consciousness & Brain Death',                      150)
) AS t(title, sort_order);

-- Endocrinology (sort_order 500)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Endocrinology', 'Endocrinology', 0, 'high', 500, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Endocrinology', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Diabetes Mellitus — Type 1 & Pathophysiology',              10),
  ('Diabetes Mellitus — Type 2 Management & Complications',     20),
  ('Diabetic Ketoacidosis & Hyperosmolar State',                30),
  ('Hypothyroidism & Hashimoto''s Thyroiditis',                 40),
  ('Hyperthyroidism — Graves'' Disease & Thyroid Storm',        50),
  ('Thyroid Nodule & Thyroid Cancer',                           60),
  ('Adrenal Insufficiency & Addison''s Disease',                70),
  ('Cushing''s Syndrome & Hyperaldosteronism',                  80),
  ('Pheochromocytoma & Paraganglioma',                          90),
  ('Pituitary Disorders — Hypopituitarism & Hyperpituitarism', 100),
  ('Calcium Disorders — Hyper & Hypoparathyroidism',           110),
  ('MEN Syndromes',                                            120),
  ('Obesity & Metabolic Syndrome',                             130)
) AS t(title, sort_order);

-- Reproductive & Obstetrics/Gynecology (sort_order 600)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Reproductive & Obstetrics/Gynecology', 'Reproductive & Obstetrics/Gynecology', 0, 'high', 600, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Reproductive & Obstetrics/Gynecology', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Female Reproductive Physiology & Menstrual Cycle',                 10),
  ('Amenorrhea — Primary & Secondary',                                 20),
  ('Polycystic Ovary Syndrome',                                        30),
  ('Endometriosis & Uterine Fibroids',                                 40),
  ('Cervical Cancer & HPV',                                            50),
  ('Endometrial Cancer',                                               60),
  ('Ovarian Cancer & Adnexal Masses',                                  70),
  ('Breast Cancer — Screening, Diagnosis & Management',                80),
  ('Normal Pregnancy & Prenatal Care',                                 90),
  ('Ectopic Pregnancy & Spontaneous Abortion',                        100),
  ('Hypertensive Disorders of Pregnancy — Preeclampsia & Eclampsia',  110),
  ('Gestational Diabetes',                                            120),
  ('Labor, Delivery & Postpartum Complications',                      130),
  ('TORCH Infections in Pregnancy',                                   140),
  ('Contraception Methods & Efficacy',                                150)
) AS t(title, sort_order);

-- Hematology & Oncology (sort_order 700)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Hematology & Oncology', 'Hematology & Oncology', 0, 'high', 700, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Hematology & Oncology', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Hematopoiesis & Blood Cell Physiology',                       10),
  ('Iron Deficiency & Microcytic Anemias',                        20),
  ('Megaloblastic Anemia — B12 & Folate Deficiency',              30),
  ('Hemolytic Anemias — Intrinsic & Extrinsic',                   40),
  ('Sickle Cell Disease & Hemoglobinopathies',                    50),
  ('Bleeding Disorders — Platelet & Coagulation Defects',         60),
  ('Thrombotic Disorders — DVT, PE & Hypercoagulable States',     70),
  ('Acute Leukemia — ALL & AML',                                  80),
  ('Chronic Leukemia — CLL & CML',                                90),
  ('Lymphoma — Hodgkin''s & Non-Hodgkin''s',                     100),
  ('Multiple Myeloma & Plasma Cell Dyscrasias',                  110),
  ('Myeloproliferative Neoplasms',                               120),
  ('Transfusion Medicine & Blood Products',                      130)
) AS t(title, sort_order);

-- Infectious Disease (sort_order 800)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Infectious Disease', 'Infectious Disease', 0, 'high', 800, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Infectious Disease', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Principles of Microbiology — Gram Stain & Culture',            10),
  ('Bacterial Infections — Gram-Positive Organisms',              20),
  ('Bacterial Infections — Gram-Negative Organisms',              30),
  ('Sexually Transmitted Infections',                             40),
  ('HIV/AIDS — Pathophysiology, Staging & ART',                   50),
  ('Opportunistic Infections in Immunocompromise',                60),
  ('Fungal Infections — Candida, Aspergillus & Cryptococcus',     70),
  ('Parasitic Infections — Malaria, Toxoplasma & Helminths',      80),
  ('Viral Infections — Herpes, CMV & EBV',                        90),
  ('Sepsis & Septic Shock',                                      100),
  ('Antimicrobial Pharmacology & Resistance',                    110),
  ('Healthcare-Associated Infections',                           120),
  ('Vaccine-Preventable Diseases',                               130)
) AS t(title, sort_order);

-- Musculoskeletal, Skin & Subcutaneous Tissue (sort_order 900)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Musculoskeletal, Skin & Subcutaneous Tissue', 'Musculoskeletal, Skin & Subcutaneous Tissue', 0, 'high', 900, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Musculoskeletal, Skin & Subcutaneous Tissue', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Musculoskeletal Anatomy & Common Fractures',                        10),
  ('Rheumatoid Arthritis',                                              20),
  ('Systemic Lupus Erythematosus',                                      30),
  ('Seronegative Spondyloarthropathies',                                40),
  ('Osteoarthritis & Crystal Arthropathies — Gout & Pseudogout',        50),
  ('Vasculitis Syndromes',                                              60),
  ('Myositis — Polymyositis & Dermatomyositis',                         70),
  ('Bone Disorders — Osteoporosis & Paget''s Disease',                  80),
  ('Bone & Soft Tissue Tumors',                                         90),
  ('Common Skin Disorders — Psoriasis, Eczema & Acne',                 100),
  ('Skin Infections — Bacterial, Viral & Fungal',                      110),
  ('Skin Cancer — Melanoma, BCC & SCC',                                120)
) AS t(title, sort_order);

-- Psychiatry & Behavioral Health (sort_order 1000)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Psychiatry & Behavioral Health', 'Psychiatry & Behavioral Health', 0, 'high', 1000, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Psychiatry & Behavioral Health', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Psychiatric Assessment & Mental Status Exam',           10),
  ('Major Depressive Disorder & Treatment',                 20),
  ('Bipolar Disorder',                                      30),
  ('Schizophrenia & Psychotic Disorders',                   40),
  ('Anxiety Disorders — GAD, Panic & Phobias',              50),
  ('Trauma & Stressor-Related Disorders — PTSD',            60),
  ('Obsessive-Compulsive & Related Disorders',              70),
  ('Substance Use Disorders & Withdrawal',                  80),
  ('Personality Disorders',                                 90),
  ('Eating Disorders — Anorexia & Bulimia',                100),
  ('Neurodevelopmental Disorders — ADHD & Autism',         110),
  ('Antidepressants — Mechanisms & Side Effects',          120),
  ('Antipsychotics — Typical, Atypical & NMS',             130)
) AS t(title, sort_order);

-- Blood, Lymphoreticular & Immune System (sort_order 1100)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Blood, Lymphoreticular & Immune System', 'Blood, Lymphoreticular & Immune System', 0, 'high', 1100, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Blood, Lymphoreticular & Immune System', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Innate & Adaptive Immunity',                10),
  ('Hypersensitivity Reactions — Types I–IV',   20),
  ('Autoimmune Disease Mechanisms',             30),
  ('Primary Immunodeficiencies',                40),
  ('Transplant Immunology & Rejection',         50),
  ('Complement System Disorders',               60),
  ('Lymph Node & Spleen Pathology',             70)
) AS t(title, sort_order);

-- Human Development & Pediatrics (sort_order 1200)
WITH sys AS (
  INSERT INTO public.curriculum_topics (system, title, level, yield_tier, sort_order, is_active)
  VALUES ('Human Development & Pediatrics', 'Human Development & Pediatrics', 0, 'high', 1200, true)
  RETURNING id
)
INSERT INTO public.curriculum_topics (parent_id, system, title, level, yield_tier, sort_order, is_active)
SELECT sys.id, 'Human Development & Pediatrics', t.title, 1, 'high', t.sort_order, true
FROM sys, (VALUES
  ('Embryology & Fetal Development',                            10),
  ('Neonatal Assessment & Common Neonatal Conditions',         20),
  ('Developmental Milestones — Infancy to Adolescence',        30),
  ('Childhood Immunisation Schedule',                          40),
  ('Congenital Anomalies & Genetic Syndromes',                 50),
  ('Common Pediatric Infectious Diseases',                     60),
  ('Pediatric Respiratory Emergencies — Croup & Epiglottitis', 70),
  ('Childhood Cancers — ALL, Wilms'' & Neuroblastoma',         80),
  ('Preventive Care & Well-Child Visits',                      90)
) AS t(title, sort_order);
