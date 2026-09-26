import { describe, it, expect } from "vitest";
import {
  MAX_SECTIONS,
  resolveSheetPlan,
  sectionQuota,
  toWirePlan,
} from "../../supabase/functions/_shared/sheet-plan.ts";
import {
  ARCHETYPE_IDS,
  ARCHETYPES,
  SECTIONS,
  asArchetype,
} from "../../supabase/functions/_shared/sheet-sections.ts";
import { parsePlan } from "./sheet-plan";

const keys = (req: Parameters<typeof resolveSheetPlan>[0]) =>
  resolveSheetPlan(req).map((s) => s.key);

describe("the section catalogue", () => {
  it("has a template for every key any archetype asks for", () => {
    for (const id of ARCHETYPE_IDS) {
      const a = ARCHETYPES[id];
      const referenced = [
        ...a.spine,
        ...Object.values(a.byExamMode ?? {}).flat(),
        ...Object.values(a.byDifficulty ?? {}).flat(),
      ];
      for (const key of referenced) {
        expect(SECTIONS[key], `${id} references unknown section "${key}"`).toBeDefined();
      }
    }
  });

  it("gives every section a count or budget for its core and for its depth", () => {
    for (const id of ARCHETYPE_IDS) {
      for (const section of resolveSheetPlan({ archetype: id })) {
        if (section.kind === "prose") {
          expect(section.budget).toBeTruthy();
          expect(section.moreBudget).toBeTruthy();
        } else {
          expect(section.items).toBeDefined();
          expect(section.moreItems).toBeDefined();
        }
        expect(sectionQuota(section)).not.toBe("");
        expect(sectionQuota(section, "more")).not.toBe("");
        expect(section.moreBrief, section.key).toBeTruthy();
      }
    }
  });

  it("fixes two to four columns on every table template", () => {
    for (const template of Object.values(SECTIONS)) {
      if (template.kind !== "table") continue;
      expect(template.columns?.length, template.key).toBeGreaterThanOrEqual(2);
      expect(template.columns?.length, template.key).toBeLessThanOrEqual(4);
    }
  });

  it("sends a table's columns over the wire and counts it in rows", () => {
    const plan = resolveSheetPlan({ archetype: "pathway", examMode: "USMLE Step 1" });
    const cofactors = plan.find((s) => s.key === "cofactors")!;
    expect(cofactors.kind).toBe("table");
    expect(sectionQuota(cofactors)).toMatch(/rows$/);
    const wire = toWirePlan(plan).find((s) => s.key === "cofactors")!;
    expect(wire.columns).toEqual(["Enzyme", "Cofactor", "Without it"]);
    // Only tables carry columns; a prose or list spec stays as it was.
    expect(toWirePlan(plan).filter((s) => s.kind !== "table").every((s) => !("columns" in s))).toBe(true);
  });

  it("produces a usable plan for every archetype", () => {
    for (const id of ARCHETYPE_IDS) {
      const plan = resolveSheetPlan({ archetype: id });
      expect(plan.length, id).toBeGreaterThanOrEqual(4);
      expect(plan.length, id).toBeLessThanOrEqual(MAX_SECTIONS);
    }
  });

  it("survives the client's own validation", () => {
    for (const id of ARCHETYPE_IDS) {
      const wire = toWirePlan(resolveSheetPlan({ archetype: id }));
      expect(parsePlan(wire)?.map((s) => s.key), id).toEqual(wire.map((s) => s.key));
    }
  });
});

describe("archetype decides the sections", () => {
  it("gives a drug and a disease genuinely different sheets", () => {
    const drug = keys({ archetype: "drug" });
    const condition = keys({ archetype: "condition" });
    expect(drug).toContain("moa");
    expect(drug).toContain("adverseEffects");
    // The disease template's clinical section has no business on a drug sheet.
    expect(drug).not.toContain("clinicalApproach");
    expect(condition).toContain("clinicalApproach");
    expect(condition).not.toContain("moa");
  });

  it("falls back to the condition sheet for an unknown archetype", () => {
    expect(keys({ archetype: null })).toEqual(keys({ archetype: "condition" }));
  });
});

describe("the settings change the sections, not just the wording", () => {
  it("exam mode adds a section", () => {
    const step2 = keys({ archetype: "condition", examMode: "USMLE Step 2" });
    const general = keys({ archetype: "condition", examMode: "General" });
    expect(step2).toContain("differentials");
    expect(general).not.toContain("differentials");
  });

  it("difficulty adds a section", () => {
    const advanced = keys({ archetype: "drug", difficulty: "Advanced" });
    const basic = keys({ archetype: "drug", difficulty: "Basic" });
    expect(advanced).toContain("interactions");
    expect(basic).not.toContain("interactions");
  });

  it("depth is not a plan setting: both depths share one outline", () => {
    // The plan request has no depth; a comprehensive sheet is the same
    // sections with each one's "_more" written after the cores.
    const plan = resolveSheetPlan({ archetype: "condition" });
    const traps = plan.find((s) => s.key === "examTraps")!;
    expect(traps.items).toEqual([2, 3]);
    expect(traps.moreItems).toEqual([1, 3]);
  });
});

describe("no two sections are briefed for the same content", () => {
  const brief = (req: Parameters<typeof resolveSheetPlan>[0], key: string) =>
    resolveSheetPlan(req).find((s) => s.key === key)!.brief;
  const moreBrief = (req: Parameters<typeof resolveSheetPlan>[0], key: string) =>
    resolveSheetPlan(req).find((s) => s.key === key)!.moreBrief;

  it("names only text its brief actually contains, so an edit cannot silently stop the hand-off", () => {
    for (const template of Object.values(SECTIONS)) {
      // A labelled prose brief is its lead plus its labelled lines.
      const full = [template.brief, ...(template.labels ?? []).map((l) => `${l.label}: ${l.line}`)].join("\n");
      for (const [key, text] of Object.entries(template.yieldsTo ?? {})) {
        expect(SECTIONS[key], `${template.key} yields to unknown section "${key}"`).toBeDefined();
        expect(full, `${template.key} → ${key}`).toContain(text);
      }
      for (const label of template.labels ?? []) {
        if (label.droppedBy) expect(SECTIONS[label.droppedBy], `${template.key}: ${label.label}`).toBeDefined();
      }
    }
  });

  it("drops Clinical Approach's complications when the sheet has a Complications section", () => {
    const advanced = { archetype: "condition" as const, difficulty: "Advanced" };
    const intermediate = { archetype: "condition" as const, difficulty: "Intermediate" };
    expect(keys(advanced)).toContain("complications");
    // Complications is depth, not core, so it lives in the "_more" brief.
    expect(moreBrief(advanced, "clinicalApproach")).not.toContain("Complications:");
    expect(moreBrief(intermediate, "clinicalApproach")).toContain("Complications:");
    expect(brief(intermediate, "clinicalApproach")).not.toContain("Complications:");
  });

  it("puts Workup and Avoid in the core only where the exam tests them", () => {
    const step2 = brief({ archetype: "condition", examMode: "USMLE Step 2" }, "clinicalApproach");
    const step1 = brief({ archetype: "condition", examMode: "USMLE Step 1" }, "clinicalApproach");
    expect(step2).toContain("Workup:");
    expect(step2).toContain("Avoid:");
    expect(step1).not.toContain("Workup:");
    expect(step1).not.toContain("Avoid:");
    // What Step 1's core leaves out, its depth adds.
    const step1More = moreBrief({ archetype: "condition", examMode: "USMLE Step 1" }, "clinicalApproach");
    expect(step1More).toContain("Workup:");
    expect(step1More).toContain("Avoid:");
  });

  it("drops the distinguishing findings when a differential table covers them", () => {
    expect(brief({ archetype: "condition", examMode: "USMLE Step 2" }, "clinicalApproach")).not.toContain("distinguishing");
    expect(brief({ archetype: "condition", examMode: "General" }, "clinicalApproach")).toContain("Key distinguishing findings.");
  });

  it("keeps every other label of the brief intact", () => {
    const both = brief({ archetype: "condition", examMode: "USMLE Step 2", difficulty: "Advanced" }, "clinicalApproach");
    for (const label of ["Diagnosis:", "Workup:", "Management:", "Avoid:"]) expect(both).toContain(label);
  });
});

describe("plan assembly", () => {
  it("never repeats a section listed under both a mode and a difficulty", () => {
    // pathway lists "deficiencies" under both Step 1 and Advanced.
    const k = keys({ archetype: "pathway", examMode: "USMLE Step 1", difficulty: "Advanced" });
    expect(k.filter((x) => x === "deficiencies")).toHaveLength(1);
  });

  it("sorts study aids after the content they build on", () => {
    const k = keys({ archetype: "drug", examMode: "USMLE Step 1", difficulty: "Advanced" });
    const lastContent = Math.max(k.indexOf("moa"), k.indexOf("pharmacokinetics"), k.indexOf("interactions"));
    expect(k.indexOf("memoryHooks")).toBeGreaterThan(lastContent);
    expect(k.indexOf("examTraps")).toBeGreaterThan(lastContent);
  });

  it("caps the sheet, dropping additions rather than the spine", () => {
    const plan = resolveSheetPlan({
      archetype: "condition",
      examMode: "USMLE Step 2",
      difficulty: "Advanced",
    });
    expect(plan.length).toBeLessThanOrEqual(MAX_SECTIONS);
    for (const key of ARCHETYPES.condition.spine) {
      expect(plan.map((s) => s.key)).toContain(key);
    }
  });

  it("keeps the server's briefs and counts off the wire", () => {
    const wire = toWirePlan(resolveSheetPlan({ archetype: "drug" }));
    for (const spec of wire) {
      for (const field of ["brief", "moreBrief", "items", "moreItems", "budget", "moreBudget", "coreLabels", "moreLabels"]) {
        expect(spec).not.toHaveProperty(field);
      }
    }
  });
});

describe("asArchetype", () => {
  it("accepts what the classifier actually replies", () => {
    expect(asArchetype("drug")).toBe("drug");
    expect(asArchetype(" Drug.\n")).toBe("drug");
    expect(asArchetype("ORGANISM")).toBe("organism");
  });

  it("returns null for anything it does not recognise, so the caller falls back", () => {
    expect(asArchetype("pharmacology")).toBeNull();
    expect(asArchetype("")).toBeNull();
    expect(asArchetype(undefined)).toBeNull();
    expect(asArchetype(42)).toBeNull();
  });
});
