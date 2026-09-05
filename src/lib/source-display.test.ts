import { describe, it, expect } from "vitest";
import {
  cleanDocumentName,
  looksLikeHeading,
  resolveLocation,
  formatLocation,
  cleanExcerpt,
  matchStrength,
  highlightQuery,
  orderSources,
} from "@/lib/source-display";
import type { SheetSource } from "@/types/generated-sheet";

/**
 * Every `sectionTitle` and `content` string in this file was copied verbatim
 * out of the live `guideline_chunks` table. They are ugly on purpose — the
 * point of the module under test is that real ingestion output is this messy.
 */
function src(over: Partial<SheetSource>): SheetSource {
  return {
    id: "id",
    guidelineName: "Book",
    sectionTitle: null,
    sourceUrl: null,
    similarity: 0.7,
    content: "",
    ...over,
  };
}

describe("cleanDocumentName", () => {
  it("strips a bracketed source tag and a trailing PDF", () => {
    expect(cleanDocumentName("[Medicalstudyzone.com] Pathoma 2023 PDF")).toBe("Pathoma 2023");
  });

  it("strips a host name fused to the start of the title", () => {
    expect(
      cleanDocumentName("OceanofPDF.comNelson_textbook_of_pediatrics_22nd_edition_-_Robert_M_Kliegman")
    ).toBe("Nelson textbook of pediatrics 22nd edition — Robert M Kliegman");
  });

  it("turns underscores into spaces", () => {
    expect(cleanDocumentName("Harrison's_Principles_of_Internal_Medicine,_Twenty_First_Edition")).toBe(
      "Harrison's Principles of Internal Medicine, Twenty First Edition"
    );
  });

  it("leaves a name it cannot improve alone", () => {
    expect(cleanDocumentName("PsychReproRenalRes")).toBe("PsychReproRenalRes");
    expect(cleanDocumentName("CardioEndoGIHeme")).toBe("CardioEndoGIHeme");
  });

  it("never returns an empty name", () => {
    expect(cleanDocumentName("[everything]")).toBe("[everything]");
  });
});

describe("looksLikeHeading", () => {
  it("accepts title-cased headings containing function words", () => {
    expect(looksLikeHeading("Hypoxia and Cyanosis")).toBe(true);
    expect(looksLikeHeading("Decision-Making in Clinical Medicine")).toBe(true);
    expect(looksLikeHeading("Vaccine Opposition and Hesitancy")).toBe(true);
    expect(looksLikeHeading("Influenza")).toBe(true);
  });

  it("accepts all-caps running heads", () => {
    expect(looksLikeHeading("CYANOSIS")).toBe(true);
    expect(looksLikeHeading("IV. BENIGN AND MALIGNANT HTN")).toBe(true);
  });

  it("rejects sentence fragments sliced out of the body text", () => {
    expect(looksLikeHeading("development process and safety monitoring systems if they are to")).toBe(false);
    expect(looksLikeHeading("of reasoning, the dual-process theory distinguishes two general")).toBe(false);
    expect(looksLikeHeading("beneath the muscle fiber membrane are best demonstrated by special")).toBe(false);
    expect(looksLikeHeading("1. May arise from preexisting benign HTN or de novo")).toBe(false);
  });

  it("rejects contributor bylines", () => {
    expect(looksLikeHeading("Chris A. Liacouras")).toBe(false);
  });

  it("rejects ingestion noise", () => {
    expect(looksLikeHeading("www.who.int/immunization/programmes_systems/Survey_Questi")).toBe(false);
    expect(looksLikeHeading("Www.Medicalstudyzone.com")).toBe(false);
  });
});

describe("resolveLocation", () => {
  it("reads chapter and printed page from a Nelson recto running head", () => {
    const loc = resolveLocation(src({ sectionTitle: "Chapter 428 u The Common Cold 2551" }));
    expect(loc).toEqual({ heading: "Chapter 428 — The Common Cold", page: 2551, section: null });
    // "p." is joined to its page number by a non-breaking space, so a
    // line break can never separate the two.
    expect(formatLocation(loc)).toBe("Chapter 428 — The Common Cold · p.\u00a02551");
  });

  it("reads part and printed page from a Nelson verso running head", () => {
    const loc = resolveLocation(
      src({ sectionTitle: "2552 Part XVII u The Respiratory System › adenoviruses, or there can be no apparent histologic damage, as" })
    );
    expect(loc).toEqual({ heading: "Part XVII — The Respiratory System", page: 2552, section: null });
  });

  it("keeps the sub-section number but drops its truncated title", () => {
    const loc = resolveLocation(
      src({
        sectionTitle:
          "Chapter 559 u Isolated Glomerular Diseases Associated with Recurrent Gross Hematuria 3193 › 559.6 Membranoproliferative › as mesangiocapillary glomerulonephritis, most commonly occurs",
      })
    );
    expect(loc.page).toBe(3193);
    expect(loc.section).toBe("559.6");
    expect(loc.heading).toContain("Chapter 559");
    expect(formatLocation(loc)).toContain("§559.6");
  });

  it("reads a Harrison's chapter head and reports no page", () => {
    const loc = resolveLocation(
      src({ sectionTitle: "40 Hypoxia and Cyanosis › phosphorylation and ATP production. The tissues are unable to use" })
    );
    expect(loc.heading).toBe("Chapter 40 — Hypoxia and Cyanosis");
    expect(loc.page).toBeNull();
    expect(formatLocation(loc)).toBe("Chapter 40 — Hypoxia and Cyanosis");
  });

  it("keeps a nested all-caps heading from Harrison's", () => {
    expect(resolveLocation(src({ sectionTitle: "40 Hypoxia and Cyanosis › CYANOSIS" })).heading).toBe(
      "Chapter 40 — Hypoxia and Cyanosis"
    );
  });

  it("recovers First Aid's printed page from the inline running head", () => {
    const loc = resolveLocation(
      src({
        sectionTitle: null,
        content:
          "(sebaceous) gland. Xanthelasma Yellowish patch on medial eyelid. A C B D NEUROLOGY AND SPECIAL SENSES ▶ NEUROLOGY—PHARMACOLOGY SEC TION III 560 NEUROLOGY—PHARMACOLOGY▶ Anticonvulsants",
      })
    );
    expect(loc.page).toBe(560);
  });

  it("title-cases a page-then-caps running head", () => {
    const loc = resolveLocation(
      src({ sectionTitle: "220 FUNDAMENTALS OF PATHOLOGY › Skeletal system, 195-202" })
    );
    expect(loc.page).toBe(220);
    expect(loc.heading).toBe("Fundamentals of Pathology");
  });

  it("falls back to the heading the chunk itself opens with", () => {
    const loc = resolveLocation(
      src({
        sectionTitle: "1. May arise from preexisting benign HTN or de novo",
        content:
          "IV. BENIGN AND MALIGNANT HTN\nA. HTN can also be classified as benign or malignant. B. Benign HTN is a mild elevation.",
      })
    );
    expect(loc.heading).toBe("IV. BENIGN AND MALIGNANT HTN");
  });

  it("accepts a lettered sub-heading from the chunk text", () => {
    const loc = resolveLocation(
      src({
        sectionTitle: null,
        content: "D. Pathogenesis\n1. Damage to endothelium allows lipids to leak into the intima.",
      })
    );
    expect(loc.heading).toBe("D. Pathogenesis");
  });

  it("never mistakes a mid-sentence first line for a heading", () => {
    // Both of these open a Harrison's chunk sliced out of running text.
    expect(
      resolveLocation(src({ sectionTitle: null, content: "98-2), and\nunloading more O2 from hemoglobin." })).heading
    ).toBeNull();
    expect(
      resolveLocation(
        src({
          sectionTitle: null,
          content: "103). In persons with chronic hypoxemia secondary to\nprolonged residence at altitude.",
        })
      ).heading
    ).toBeNull();
    expect(
      resolveLocation(
        src({ sectionTitle: null, content: "Airway augmentation procedures in bilateral vocal cord\nparalysis." })
      ).heading
    ).toBeNull();
  });

  it("returns nothing rather than a fragment when the stack is all noise", () => {
    const loc = resolveLocation(
      src({ sectionTitle: "chapter provides an introduction to three of the pillars upon which" })
    );
    expect(loc).toEqual({ heading: null, page: null, section: null });
    expect(formatLocation(loc)).toBeNull();
  });

  it("never invents a page from a null section title", () => {
    expect(resolveLocation(src({ sectionTitle: null, content: "plain prose" })).page).toBeNull();
  });

  it("ignores the ingestion page metadata entirely", () => {
    // Nelson's metadata page (74) is the split-volume PDF index; the printed
    // page is 2291. Rendering the metadata value would be confidently wrong.
    const loc = resolveLocation(
      src({ sectionTitle: "Chapter 378 u Motility Disorders and Hirschsprung Disease 2291", pageStart: 74, pageEnd: 74 })
    );
    expect(loc.page).toBe(2291);
  });
});

describe("cleanExcerpt", () => {
  it("strips the ClinicalKey download watermark", () => {
    const { text } = cleanExcerpt(
      "**Relative frequency of colds caused by the agent. Downloaded for mohamed ahmed (dr.mms2020@gmail.com) at University of Southern California from ClinicalKey.com by Elsevier on May 01, 2024. For personal use only. No other uses without permission. Copyright ©2024. Elsevier Inc. All rights reserved. Viruses spread by direct hand contact."
    );
    expect(text).not.toContain("dr.mms2020@gmail.com");
    expect(text).not.toContain("Downloaded for");
    expect(text).toContain("Viruses spread by direct hand contact.");
  });

  it("strips a First Aid running head out of the middle of a chunk", () => {
    const { text } = cleanExcerpt(
      "Yellowish patch on medial eyelid. NEUROLOGY AND SPECIAL SENSES ▶ NEUROLOGY—PHARMACOLOGY SEC TION III 560 Anticonvulsants block sodium channels."
    );
    expect(text).not.toContain("SEC TION III 560");
    expect(text).toContain("Yellowish patch on medial eyelid.");
    expect(text).toContain("Anticonvulsants block sodium channels.");
  });

  it("unwraps the PDF's hard line breaks into prose", () => {
    const { text } = cleanExcerpt(
      "Viruses that cause the common cold are spread by three mechanisms:\ndirect hand contact (self-inoculation of one's own nasal mucosa or con\njunctival epithelium)."
    );
    expect(text).toBe(
      "Viruses that cause the common cold are spread by three mechanisms: direct hand contact (self-inoculation of one's own nasal mucosa or con junctival epithelium)."
    );
  });

  it("keeps list items and all-caps headings on their own lines", () => {
    const { text } = cleanExcerpt(
      "D. Pathogenesis\n1. Damage to endothelium allows lipids to leak into the intima. 2. Lipids are oxidized."
    );
    expect(text.split("\n")).toEqual([
      "D. Pathogenesis",
      "1. Damage to endothelium allows lipids to leak into the intima. 2. Lipids are oxidized.",
    ]);
  });

  it("flags a chunk sliced out of the middle of a sentence", () => {
    const cleaned = cleanExcerpt(
      "in older children or young adults. MPGN can be classified into primary and secondary forms of glomerular"
    );
    expect(cleaned.startsMidSentence).toBe(true);
    expect(cleaned.endsMidSentence).toBe(true);
  });

  it("does not flag a chunk with clean boundaries", () => {
    const cleaned = cleanExcerpt("Benign HTN is a mild or moderate elevation in blood pressure.");
    expect(cleaned.startsMidSentence).toBe(false);
    expect(cleaned.endsMidSentence).toBe(false);
  });

  it("falls back to the raw chunk when cleaning removes everything", () => {
    const raw = "Downloaded for someone (x@y.com) at Somewhere. All rights reserved.";
    expect(cleanExcerpt(raw).text).toBe(raw);
  });
});

describe("matchStrength", () => {
  it("buckets similarity into words", () => {
    expect(matchStrength(0.91)).toBe("strong");
    expect(matchStrength(0.75)).toBe("strong");
    expect(matchStrength(0.7)).toBe("good");
    expect(matchStrength(0.66)).toBe("good");
    expect(matchStrength(0.61)).toBe("related");
  });
});

describe("highlightQuery", () => {
  it("marks the query terms that appear in the excerpt", () => {
    const segments = highlightQuery("Benign hypertension damages vessels slowly.", "malignant hypertension");
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(["hypertension"]);
    expect(segments.map((s) => s.text).join("")).toBe("Benign hypertension damages vessels slowly.");
  });

  it("is case-insensitive and skips short or generic terms", () => {
    const segments = highlightQuery("The Management of Asthma", "management of asthma");
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(["Asthma"]);
  });

  it("returns the whole excerpt unmarked when there is no usable query", () => {
    expect(highlightQuery("Some text", "")).toEqual([{ text: "Some text", hit: false }]);
  });

  it("never drops or duplicates text", () => {
    const text = "Hypertension and hypertensive crisis in hypertension.";
    const joined = highlightQuery(text, "hypertension").map((s) => s.text).join("");
    expect(joined).toBe(text);
  });
});

describe("orderSources", () => {
  it("groups by document and reads in book order within a document", () => {
    const sources = [
      src({ id: "a", guidelineName: "Pathoma", chunkIndex: 202, similarity: 0.71 }),
      src({ id: "b", guidelineName: "Harrison", chunkIndex: 10, similarity: 0.8 }),
      src({ id: "c", guidelineName: "Pathoma", chunkIndex: 200, similarity: 0.68 }),
      src({ id: "d", guidelineName: "Harrison", chunkIndex: 5, similarity: 0.62 }),
    ];
    expect(orderSources(sources).map((s) => s.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("falls back to similarity for legacy sources with no chunk index", () => {
    const sources = [
      src({ id: "a", guidelineName: "Book", similarity: 0.6 }),
      src({ id: "b", guidelineName: "Book", similarity: 0.9 }),
    ];
    expect(orderSources(sources).map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("does not mutate its input", () => {
    const sources = [
      src({ id: "a", guidelineName: "B", similarity: 0.1 }),
      src({ id: "b", guidelineName: "A", similarity: 0.9 }),
    ];
    orderSources(sources);
    expect(sources.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
