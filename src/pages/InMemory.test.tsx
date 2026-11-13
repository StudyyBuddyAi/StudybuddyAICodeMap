import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import InMemory from "./InMemory";
import { MEMORIAL } from "@/content/memorial";

const renderPage = () =>
  render(
    <MemoryRouter>
      <InMemory />
    </MemoryRouter>,
  );

const [father, mother, brother, classmates] = MEMORIAL.tributes;
const n = MEMORIAL.tributes.length;
const showing = () => screen.getByRole("group").getAttribute("aria-label");

describe("InMemory", () => {
  // The deck holds still while a sheet is tucked away; let each move land
  // before the next by moving the clock a second on every read.
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1000));
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens with the heading, on the father's tribute", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MEMORIAL.heading);
    expect(showing()).toBe(`1 of 4: ${father.name}`);
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
  });

  it("holds every tribute, in order, word for word, paragraph by paragraph", () => {
    const { container } = renderPage();
    const sheets = Array.from(container.querySelectorAll("article.tribute"));
    expect(sheets).toHaveLength(n);
    sheets.forEach((sheet, i) => {
      const t = MEMORIAL.tributes[i];
      expect(sheet.querySelector(".tribute-name")?.textContent).toBe(t.name);
      expect(sheet.querySelector(".tribute-years")?.textContent).toBe(t.years);
      expect(Array.from(sheet.querySelectorAll(".tribute-text p"), (p) => p.textContent)).toEqual(t.paragraphs);
    });
  });

  it("lists the classmates on their own card, by name", () => {
    const { container } = renderPage();
    const card = container.querySelectorAll("article.tribute")[3];
    expect(Array.from(card.querySelectorAll(".tribute-roll li"), (li) => li.textContent)).toEqual(classmates.roll);
    expect(card.querySelector(".tribute-years")).toBeNull();
    expect(card.querySelector(".collage")).toBeNull();
  });

  it("moves through the tributes and goes round, by buttons and arrow keys", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(showing()).toBe(`2 of 4: ${mother.name}`);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(showing()).toBe(`3 of 4: ${brother.name}`);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(showing()).toBe(`4 of 4: ${classmates.name}`);
    // After the last comes the first again.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(showing()).toBe(`1 of 4: ${father.name}`);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(showing()).toBe(`4 of 4: ${classmates.name}`);
  });

  it("shows only the top tribute to a screen reader, with its own photos", () => {
    renderPage();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    const photos = screen.getAllByRole("img");
    expect(photos.map((img) => img.getAttribute("src"))).toEqual(father.photos.map((p) => p.src));
    expect(photos.every((img) => img.getAttribute("alt") === father.name)).toBe(true);
  });

  it("signs the page with the founder's name, and LinkedIn, email and WhatsApp buttons that open them", () => {
    renderPage();
    expect(screen.getByText("Osama Shihada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", "https://www.linkedin.com/in/osamashihada");
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:Osama200az@gmail.com");
    const whatsapp = screen.getByRole("link", { name: "WhatsApp" });
    expect(whatsapp).toHaveAttribute("href", "https://wa.me/972592823030");
    expect(whatsapp).toHaveAttribute("title", "+972 59 282 3030");
    expect(whatsapp).toHaveAttribute("target", "_blank");
  });

  it("lays each tribute's photos in its own collage on its sheet", () => {
    const { container } = renderPage();
    const sheets = Array.from(container.querySelectorAll("article.tribute"));
    expect(sheets.map((s) => s.querySelectorAll(".collage img").length)).toEqual([2, 1, 4, 0]);
    expect(sheets[2].querySelector(".collage--mosaic [data-lead] img")?.getAttribute("src")).toBe(brother.photos[0].src);
  });
});
