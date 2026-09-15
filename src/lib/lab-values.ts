// Reference ranges for the QBank lab values panel.
//
// Typical adult ranges of the kind board-style vignettes are written against,
// in conventional and SI units. Ranges vary between laboratories; the panel says
// so. Static data, so the panel works offline and costs no request.

export interface LabValue {
  name: string;
  conventional: string;
  si?: string;
  /** Qualifier shown under the name — sex, timing, specimen. */
  note?: string;
}

export interface LabGroup {
  heading: string;
  values: LabValue[];
}

export interface LabTab {
  id: "serum" | "hematology" | "csf" | "urine" | "other";
  label: string;
  groups: LabGroup[];
}

export const LAB_TABS: LabTab[] = [
  {
    id: "serum",
    label: "Serum",
    groups: [
      {
        heading: "Electrolytes & renal",
        values: [
          { name: "Sodium (Na⁺)", conventional: "136–146 mEq/L", si: "136–146 mmol/L" },
          { name: "Potassium (K⁺)", conventional: "3.5–5.0 mEq/L", si: "3.5–5.0 mmol/L" },
          { name: "Chloride (Cl⁻)", conventional: "95–105 mEq/L", si: "95–105 mmol/L" },
          { name: "Bicarbonate (HCO₃⁻)", conventional: "22–28 mEq/L", si: "22–28 mmol/L" },
          { name: "Magnesium (Mg²⁺)", conventional: "1.5–2.0 mg/dL", si: "0.75–1.0 mmol/L" },
          { name: "Calcium, total", conventional: "8.4–10.2 mg/dL", si: "2.1–2.6 mmol/L" },
          { name: "Phosphorus, inorganic", conventional: "3.0–4.5 mg/dL", si: "1.0–1.5 mmol/L" },
          { name: "Urea nitrogen (BUN)", conventional: "7–18 mg/dL", si: "2.5–6.4 mmol/L" },
          { name: "Creatinine", conventional: "0.6–1.2 mg/dL", si: "53–106 µmol/L" },
          { name: "Uric acid", conventional: "3.0–8.2 mg/dL", si: "0.18–0.48 mmol/L" },
          { name: "Osmolality", conventional: "275–295 mOsmol/kg H₂O", si: "275–295 mOsmol/kg H₂O" },
        ],
      },
      {
        heading: "Glucose & lipids",
        values: [
          { name: "Glucose", note: "Fasting", conventional: "70–100 mg/dL", si: "3.8–5.6 mmol/L" },
          { name: "Hemoglobin A1c", conventional: "≤ 6%", si: "≤ 42 mmol/mol" },
          { name: "Cholesterol, total", note: "Desirable", conventional: "< 200 mg/dL", si: "< 5.2 mmol/L" },
          { name: "HDL cholesterol", conventional: "40–60 mg/dL", si: "1.0–1.6 mmol/L" },
          { name: "LDL cholesterol", note: "Desirable", conventional: "< 130 mg/dL", si: "< 3.4 mmol/L" },
          { name: "Triglycerides", note: "Normal", conventional: "< 150 mg/dL", si: "< 1.70 mmol/L" },
        ],
      },
      {
        heading: "Liver & pancreas",
        values: [
          { name: "Alanine aminotransferase (ALT)", conventional: "10–40 U/L", si: "10–40 U/L" },
          { name: "Aspartate aminotransferase (AST)", conventional: "12–38 U/L", si: "12–38 U/L" },
          { name: "Alkaline phosphatase", conventional: "25–100 U/L", si: "25–100 U/L" },
          { name: "Bilirubin, total", conventional: "0.1–1.0 mg/dL", si: "2–17 µmol/L" },
          { name: "Bilirubin, direct", conventional: "0.0–0.3 mg/dL", si: "0–5 µmol/L" },
          { name: "Albumin", conventional: "3.5–5.5 g/dL", si: "35–55 g/L" },
          { name: "Protein, total", conventional: "6.0–7.8 g/dL", si: "60–78 g/L" },
          { name: "Amylase", conventional: "25–125 U/L", si: "25–125 U/L" },
          { name: "Ammonia", conventional: "19–60 µg/dL", si: "11–35 µmol/L" },
          { name: "Lactate dehydrogenase (LDH)", conventional: "45–200 U/L", si: "45–200 U/L" },
        ],
      },
      {
        heading: "Iron & vitamins",
        values: [
          { name: "Iron", conventional: "50–170 µg/dL", si: "9–30 µmol/L" },
          { name: "Total iron-binding capacity", conventional: "250–400 µg/dL", si: "45–72 µmol/L" },
          { name: "Transferrin saturation", conventional: "20–50%", si: "0.20–0.50" },
          { name: "Ferritin", note: "Male", conventional: "20–250 ng/mL", si: "20–250 µg/L" },
          { name: "Ferritin", note: "Female", conventional: "10–120 ng/mL", si: "10–120 µg/L" },
          { name: "Vitamin B₁₂", conventional: "200–800 pg/mL", si: "148–590 pmol/L" },
          { name: "Folate", conventional: "2–20 ng/mL", si: "4.5–45 nmol/L" },
        ],
      },
      {
        heading: "Endocrine",
        values: [
          { name: "TSH", conventional: "0.4–4.0 µU/mL", si: "0.4–4.0 mIU/L" },
          { name: "Thyroxine (T₄), free", conventional: "0.9–1.7 ng/dL", si: "12–22 pmol/L" },
          { name: "Thyroxine (T₄), total", conventional: "5–12 µg/dL", si: "64–155 nmol/L" },
          { name: "Cortisol", note: "08:00", conventional: "5–23 µg/dL", si: "138–635 nmol/L" },
          { name: "Cortisol", note: "16:00", conventional: "3–16 µg/dL", si: "82–413 nmol/L" },
          { name: "Parathyroid hormone (PTH)", conventional: "10–60 pg/mL", si: "10–60 ng/L" },
          { name: "Prolactin", note: "Male", conventional: "< 17 ng/mL", si: "< 17 µg/L" },
          { name: "Prolactin", note: "Female", conventional: "< 25 ng/mL", si: "< 25 µg/L" },
        ],
      },
      {
        heading: "Cardiac & muscle",
        values: [
          { name: "Troponin I", conventional: "≤ 0.04 ng/mL", si: "≤ 0.04 µg/L" },
          { name: "Creatine kinase", note: "Male", conventional: "25–90 U/L", si: "25–90 U/L" },
          { name: "Creatine kinase", note: "Female", conventional: "10–70 U/L", si: "10–70 U/L" },
        ],
      },
      {
        heading: "Arterial blood gas (room air)",
        values: [
          { name: "pH", conventional: "7.35–7.45", si: "[H⁺] 35–45 nmol/L" },
          { name: "PaCO₂", conventional: "33–45 mm Hg", si: "4.4–5.9 kPa" },
          { name: "PaO₂", conventional: "75–105 mm Hg", si: "10.0–14.0 kPa" },
        ],
      },
    ],
  },
  {
    id: "hematology",
    label: "Hematology",
    groups: [
      {
        heading: "Complete blood count",
        values: [
          { name: "Hemoglobin", note: "Male", conventional: "13.5–17.5 g/dL", si: "135–175 g/L" },
          { name: "Hemoglobin", note: "Female", conventional: "12.0–16.0 g/dL", si: "120–160 g/L" },
          { name: "Hematocrit", note: "Male", conventional: "41–53%", si: "0.41–0.53" },
          { name: "Hematocrit", note: "Female", conventional: "36–46%", si: "0.36–0.46" },
          { name: "Leukocyte count", conventional: "4,500–11,000/mm³", si: "4.5–11.0 × 10⁹/L" },
          { name: "Platelet count", conventional: "150,000–400,000/mm³", si: "150–400 × 10⁹/L" },
          { name: "Mean corpuscular volume (MCV)", conventional: "80–100 µm³", si: "80–100 fL" },
          { name: "Mean corpuscular hemoglobin (MCH)", conventional: "25–35 pg/cell", si: "0.39–0.54 fmol/cell" },
          { name: "MCH concentration (MCHC)", conventional: "31–36% Hb/cell", si: "4.8–5.6 mmol Hb/L" },
          { name: "Red cell distribution width (RDW)", conventional: "11.5–14.5%", si: "0.115–0.145" },
          { name: "Reticulocyte count", conventional: "0.5–1.5% of RBCs", si: "0.005–0.015" },
        ],
      },
      {
        heading: "Leukocyte differential",
        values: [
          { name: "Neutrophils, segmented", conventional: "54–62%", si: "0.54–0.62" },
          { name: "Neutrophils, bands", conventional: "3–5%", si: "0.03–0.05" },
          { name: "Lymphocytes", conventional: "25–33%", si: "0.25–0.33" },
          { name: "Monocytes", conventional: "3–7%", si: "0.03–0.07" },
          { name: "Eosinophils", conventional: "1–3%", si: "0.01–0.03" },
          { name: "Basophils", conventional: "0–0.75%", si: "0–0.0075" },
        ],
      },
      {
        heading: "Coagulation & inflammation",
        values: [
          { name: "Prothrombin time (PT)", conventional: "11–15 s", si: "11–15 s" },
          { name: "INR", conventional: "0.8–1.2", si: "0.8–1.2" },
          { name: "Partial thromboplastin time (aPTT)", conventional: "25–40 s", si: "25–40 s" },
          { name: "Bleeding time", conventional: "2–7 min", si: "2–7 min" },
          { name: "Fibrinogen", conventional: "200–400 mg/dL", si: "2–4 g/L" },
          { name: "D-dimer", conventional: "≤ 250 ng/mL", si: "≤ 1.4 nmol/L" },
          { name: "Erythrocyte sedimentation rate", note: "Male", conventional: "0–15 mm/h", si: "0–15 mm/h" },
          { name: "Erythrocyte sedimentation rate", note: "Female", conventional: "0–20 mm/h", si: "0–20 mm/h" },
        ],
      },
    ],
  },
  {
    id: "csf",
    label: "CSF",
    groups: [
      {
        heading: "Cerebrospinal fluid",
        values: [
          { name: "Cell count", conventional: "0–5/mm³", si: "0–5 × 10⁶/L" },
          { name: "Glucose", conventional: "40–70 mg/dL", si: "2.2–3.9 mmol/L" },
          { name: "Proteins, total", conventional: "< 40 mg/dL", si: "< 0.40 g/L" },
          { name: "Chloride", conventional: "118–130 mEq/L", si: "118–130 mmol/L" },
          { name: "Gamma globulin", conventional: "3–12% of total proteins", si: "0.03–0.12" },
          { name: "Opening pressure", conventional: "70–180 mm H₂O", si: "70–180 mm H₂O" },
        ],
      },
    ],
  },
  {
    id: "urine",
    label: "Urine",
    groups: [
      {
        heading: "Urine",
        values: [
          { name: "Osmolality", conventional: "50–1,200 mOsmol/kg H₂O", si: "50–1,200 mOsmol/kg H₂O" },
          { name: "Specific gravity", conventional: "1.005–1.030", si: "1.005–1.030" },
          { name: "Proteins, total", note: "24 h", conventional: "< 150 mg/24 h", si: "< 0.15 g/24 h" },
          { name: "Calcium", note: "24 h", conventional: "100–300 mg/24 h", si: "2.5–7.5 mmol/24 h" },
          { name: "Creatinine clearance", note: "Male", conventional: "97–137 mL/min", si: "97–137 mL/min" },
          { name: "Creatinine clearance", note: "Female", conventional: "88–128 mL/min", si: "88–128 mL/min" },
          { name: "Sodium, potassium, chloride", note: "Spot", conventional: "Varies with intake", si: "Varies with intake" },
        ],
      },
    ],
  },
  {
    id: "other",
    label: "BMI & other",
    groups: [
      {
        heading: "Body mass index (adult)",
        values: [
          { name: "Formula", conventional: "weight (kg) ÷ height (m)²", si: "kg/m²" },
          { name: "Underweight", conventional: "< 18.5 kg/m²" },
          { name: "Normal", conventional: "18.5–24.9 kg/m²" },
          { name: "Overweight", conventional: "25.0–29.9 kg/m²" },
          { name: "Obesity", conventional: "≥ 30 kg/m²" },
        ],
      },
      {
        heading: "Other",
        values: [
          { name: "Anion gap", note: "Na⁺ − (Cl⁻ + HCO₃⁻)", conventional: "8–12 mEq/L", si: "8–12 mmol/L" },
          { name: "Sweat chloride", conventional: "< 60 mEq/L", si: "< 60 mmol/L" },
        ],
      },
    ],
  },
];

/** Case-insensitive search across every tab, keeping each match's group heading. */
export const searchLabValues = (query: string): { tab: LabTab; group: LabGroup; value: LabValue }[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: { tab: LabTab; group: LabGroup; value: LabValue }[] = [];
  for (const tab of LAB_TABS) {
    for (const group of tab.groups) {
      for (const value of group.values) {
        const hay = `${value.name} ${value.note ?? ""} ${group.heading}`.toLowerCase();
        if (hay.includes(needle)) out.push({ tab, group, value });
      }
    }
  }
  return out;
};
