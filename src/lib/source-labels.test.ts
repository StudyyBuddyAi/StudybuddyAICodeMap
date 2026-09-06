import { describe, it, expect } from "vitest";
import {
  applySourceLabels,
  bookNameIsSupported,
  chapterIsSupported,
  sectionIsSupported,
} from "@/lib/source-labels";
import type { SheetSource } from "@/types/generated-sheet";

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

describe("bookNameIsSupported", () => {
  it("accepts a tidied version of the same filename", () => {
    expect(
      bookNameIsSupported(
        "Nelson Textbook of Pediatrics, 22nd Edition",
        "OceanofPDF.comNelson_textbook_of_pediatrics_22nd_edition_-_Robert_M_Kliegman"
      )
    ).toBe(true);
    expect(
      bookNameIsSupported(
        "Harrison's Principles of Internal Medicine, 21st Edition",
        "Harrison's_Principles_of_Internal_Medicine,_Twenty_First_Edition"
      )
    ).toBe(true);
    expect(bookNameIsSupported("Pathoma 2023", "[Medicalstudyzone.com] Pathoma 2023 PDF")).toBe(true);
  });

  it("rejects a title inferred from content rather than the filename", () => {
    // We have no evidence this opaque code is First Aid, so it must not be
    // printed as though we did.
    expect(bookNameIsSupported("First Aid for the USMLE Step 1", "PsychReproRenalRes")).toBe(false);
    expect(bookNameIsSupported("Robbins Basic Pathology", "CardioEndoGIHeme")).toBe(false);
  });

  it("does not accept a match on generic words alone", () => {
    expect(bookNameIsSupported("Some Other Medical Textbook", "A Medical Textbook PDF")).toBe(false);
  });
});

describe("chapterIsSupported", () => {
  it("accepts a chapter whose number appears in the heading", () => {
    expect(
      chapterIsSupported(
        "Chapter 415 — Portal Hypertension",
        "Chapter 415 u Portal Hypertension 2103",
        "Portal vein thrombosis is also associated with hypercoagulable states."
      )
    ).toBe(true);
  });

  it("accepts a chapter whose number appears only in the passage", () => {
    expect(chapterIsSupported("Figure 11.6", "", "characterized by apoptosis of hepatocytes (Fig. 11.6).")).toBe(
      true
    );
  });

  it("rejects an invented chapter number", () => {
    expect(
      chapterIsSupported("Chapter 12 — Portal Hypertension", "Chapter 415 u Portal Hypertension", "portal vein")
    ).toBe(false);
  });

  it("accepts a purely textual section name", () => {
    expect(chapterIsSupported("Cirrhosis", "III. CIRRHOSIS", "")).toBe(true);
  });
});

describe("sectionIsSupported", () => {
  const passage =
    "Endoscopic therapy is indicated for actively bleeding lesions. Restrictive transfusion strategy targets hemoglobin above 7 g/dL in acute upper gastrointestinal bleeding.";

  it("accepts a contents entry built from the passage's own wording", () => {
    expect(sectionIsSupported("Transfusion thresholds in acute bleeding", "", passage)).toBe(true);
    expect(sectionIsSupported("Endoscopic therapy indications", "", passage)).toBe(true);
  });

  it("tolerates ordinary inflection", () => {
    // "bleeds" against "bleeding", "lesion" against "lesions".
    expect(sectionIsSupported("Endoscopic therapy for bleeds", "", passage)).toBe(true);
  });

  it("rejects a label that has drifted onto another topic", () => {
    expect(sectionIsSupported("Antibiotic prophylaxis in cirrhosis", "", passage)).toBe(false);
    expect(sectionIsSupported("Management of diabetic ketoacidosis", "", passage)).toBe(false);
  });

  it("rejects a label made only of generic words", () => {
    expect(sectionIsSupported("The medical textbook edition", "", passage)).toBe(false);
  });

  it("rejects any label when the passage is empty", () => {
    expect(sectionIsSupported("Transfusion thresholds", "", "")).toBe(false);
  });
});

describe("applySourceLabels", () => {
  const nelson = src({
    id: "a",
    guidelineName: "OceanofPDF.comNelson_textbook_of_pediatrics_22nd_edition_-_Robert_M_Kliegman",
    sectionTitle: "Chapter 415 u Portal Hypertension 2103",
    content: "Portal vein thrombosis is also associated with hypercoagulable states.",
  });

  it("applies a label that checks out against the chunk", () => {
    const [out] = applySourceLabels(
      [nelson],
      [{ id: "a", book: "Nelson Textbook of Pediatrics, 22nd Edition", chapter: "Chapter 415 — Portal Hypertension" }]
    );
    expect(out.book).toBe("Nelson Textbook of Pediatrics, 22nd Edition");
    expect(out.chapter).toBe("Chapter 415 — Portal Hypertension");
  });

  it("drops a fabricated book but keeps a sound chapter", () => {
    const [out] = applySourceLabels(
      [nelson],
      [{ id: "a", book: "Gray's Anatomy", chapter: "Chapter 415 — Portal Hypertension" }]
    );
    expect(out.book).toBeUndefined();
    expect(out.chapter).toBe("Chapter 415 — Portal Hypertension");
  });

  it("drops a fabricated chapter but keeps a sound book", () => {
    const [out] = applySourceLabels(
      [nelson],
      [{ id: "a", book: "Nelson Textbook of Pediatrics", chapter: "Chapter 12 — Portal Hypertension" }]
    );
    expect(out.book).toBe("Nelson Textbook of Pediatrics");
    expect(out.chapter).toBeUndefined();
  });

  it("ignores labels for ids that were never retrieved", () => {
    const out = applySourceLabels([nelson], [{ id: "not-a-real-id", book: "Nelson Textbook of Pediatrics" }]);
    expect(out).toHaveLength(1);
    expect(out[0].book).toBeUndefined();
  });

  it("treats placeholder strings as no label", () => {
    const [out] = applySourceLabels([nelson], [{ id: "a", book: "unknown", chapter: "null" }]);
    expect(out.book).toBeUndefined();
    expect(out.chapter).toBeUndefined();
  });

  it("collapses newlines that would break the citation line", () => {
    const [out] = applySourceLabels(
      [nelson],
      [{ id: "a", chapter: "Chapter 415\n—   Portal\tHypertension", book: null }]
    );
    expect(out.chapter).toBe("Chapter 415 — Portal Hypertension");
  });

  it("rejects an absurdly long label", () => {
    const [out] = applySourceLabels([nelson], [{ id: "a", book: "Nelson ".repeat(40) }]);
    expect(out.book).toBeUndefined();
  });

  it("returns the sources untouched when there are no labels", () => {
    const out = applySourceLabels([nelson], []);
    expect(out).toEqual([nelson]);
  });

  it("does not mutate its input", () => {
    const sources = [nelson];
    applySourceLabels(sources, [{ id: "a", book: "Nelson Textbook of Pediatrics" }]);
    expect(sources[0].book).toBeUndefined();
  });
});
