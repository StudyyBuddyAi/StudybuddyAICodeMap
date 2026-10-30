import { describe, it, expect } from "vitest";
import { didYouMean, exactOption, matchScore, suggestTopics, type TopicOption } from "./topic-suggest";

const opt = (title: string, source: TopicOption["source"] = "curriculum", systemName: string | null = null): TopicOption => ({
  title,
  systemName,
  systemKey: null,
  source,
});

const OPTIONS: TopicOption[] = [
  opt("Diabetic Ketoacidosis & Hyperosmolar State", "curriculum", "Endocrinology"),
  opt("Heart Failure — HFrEF (GDMT)", "curriculum", "Cardiovascular"),
  opt("Heart Failure — HFpEF & Acute Decompensation", "curriculum", "Cardiovascular"),
  opt("Acute Leukemia — ALL & AML", "curriculum", "Hematology & Oncology"),
  opt("Atrial Fibrillation & Flutter", "curriculum", "Cardiovascular"),
  opt("Cardiovascular", "system", "Cardiovascular"),
  opt("Human Development & Pediatrics", "system", "Human Development & Pediatrics"),
  opt("Breaking bad news (SPIKES)", "family", "Communication & Ethics"),
  opt("heart failure", "library"),
];

describe("matchScore", () => {
  it("ranks whole, prefix, word-prefix, substring and typo matches in that order", () => {
    expect(matchScore("cardiovascular", "Cardiovascular")).toBe(100);
    expect(matchScore("heart fail", "Heart Failure — HFrEF (GDMT)")).toBe(90);
    expect(matchScore("fail heart", "Heart Failure — HFrEF (GDMT)")).toBe(80);
    expect(matchScore("ketoacid", "Diabetic Ketoacidosis & Hyperosmolar State")).toBe(80);
    expect(matchScore("luekemia", "Acute Leukemia — ALL & AML")).toBe(40);
    expect(matchScore("zebra", "Acute Leukemia — ALL & AML")).toBe(0);
  });
});

describe("suggestTopics", () => {
  it("puts the student's own topic first and collapses duplicates", () => {
    const out = suggestTopics("heart fail", OPTIONS);
    expect(out[0]).toMatchObject({ title: "heart failure", source: "library" });
    expect(out.filter((o) => o.title.toLowerCase().startsWith("heart failure")).length).toBe(3);
  });

  it("understands the abbreviations students type", () => {
    expect(suggestTopics("dka", OPTIONS)[0].title).toBe("Diabetic Ketoacidosis & Hyperosmolar State");
    expect(suggestTopics("afib", OPTIONS)[0].title).toBe("Atrial Fibrillation & Flutter");
    expect(suggestTopics("cardio", OPTIONS)[0].title).toBe("Cardiovascular");
    expect(suggestTopics("spikes", OPTIONS)[0].title).toBe("Breaking bad news (SPIKES)");
  });

  it("leaves out what is already chosen", () => {
    const out = suggestTopics("heart", OPTIONS, { exclude: ["heart failure"] });
    expect(out.some((o) => o.title === "heart failure")).toBe(false);
  });

  it("returns nothing for an empty query", () => {
    expect(suggestTopics("  ", OPTIONS)).toEqual([]);
  });
});

describe("didYouMean", () => {
  it("offers the fix for a typo that matches nothing cleanly", () => {
    expect(didYouMean("pediatrcs", OPTIONS)?.title).toBe("Human Development & Pediatrics");
    expect(didYouMean("luekemia", OPTIONS)?.title).toBe("Acute Leukemia — ALL & AML");
  });

  it("stays quiet when there is a clean match, or nothing close", () => {
    expect(didYouMean("leukemia", OPTIONS)).toBeNull();
    expect(didYouMean("porphyria", OPTIONS)).toBeNull();
    expect(didYouMean("hf", OPTIONS)).toBeNull();
  });
});

describe("exactOption", () => {
  it("finds the option a chip came from, ignoring case and punctuation", () => {
    expect(exactOption("atrial fibrillation & flutter", OPTIONS)?.systemName).toBe("Cardiovascular");
    expect(exactOption("something new", OPTIONS)).toBeNull();
  });
});
