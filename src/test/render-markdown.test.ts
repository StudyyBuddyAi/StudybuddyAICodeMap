import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/render-markdown";

describe("renderMarkdown", () => {
  it("returns an empty string for empty or null-ish input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("renders **bold** as <strong>", () => {
    expect(renderMarkdown("is **the** cause")).toBe("is <strong>the</strong> cause");
  });

  it("renders *italic* as <em>", () => {
    expect(renderMarkdown("a *subtle* sign")).toBe("a <em>subtle</em> sign");
  });

  it("does not let ** inside a bold span break the italic pass", () => {
    expect(renderMarkdown("**x *y* z**")).toBe("<strong>x <em>y</em> z</strong>");
  });

  it("escapes raw HTML so scripts cannot execute", () => {
    const html = "<script>alert('xss')</script>";
    const out = renderMarkdown(html);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes event-handler HTML attributes", () => {
    const out = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(out).not.toMatch(/<img[^>]*onerror/i);
    expect(out).toContain("&lt;img");
  });

  it("escapes tags but still applies markdown inside plain text", () => {
    const out = renderMarkdown("<b>**SA node**</b>");
    expect(out).toBe("&lt;b&gt;<strong>SA node</strong>&lt;/b&gt;");
  });

  it("escapes ampersands and quotes", () => {
    expect(renderMarkdown("A & B \"quoted\"")).toBe("A &amp; B &quot;quoted&quot;");
  });
});
