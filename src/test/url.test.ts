import { describe, it, expect } from "vitest";
import { isSafeUrl, sanitizeUrl } from "@/lib/url";

describe("url sanitizer / validator (isSafeUrl & sanitizeUrl)", () => {
  it("allows standard http and https URLs", () => {
    expect(isSafeUrl("https://pubmed.ncbi.nlm.nih.gov/12345/")).toBe(true);
    expect(isSafeUrl("http://example.com/test?q=1")).toBe(true);
    expect(sanitizeUrl("https://studybuddy.app")).toBe("https://studybuddy.app");
  });

  it("allows safe relative paths", () => {
    expect(isSafeUrl("/dashboard?start=sheet")).toBe(true);
    expect(isSafeUrl("#features")).toBe(true);
    expect(sanitizeUrl("/sheets")).toBe("/sheets");
  });

  it("rejects javascript: URIs", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JAVASCRIPT:alert('xss')")).toBe(false);
    expect(isSafeUrl("javascript :alert(1)")).toBe(false);
    expect(sanitizeUrl("javascript:console.log(1)")).toBe(undefined);
  });

  it("rejects data: and vbscript: URIs", () => {
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(sanitizeUrl("data:image/svg+xml;base64,123")).toBe(undefined);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeUrl("//evil.com/xss")).toBe(false);
  });

  it("handles empty or invalid inputs gracefully", () => {
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(sanitizeUrl("   ")).toBe(undefined);
  });
});
