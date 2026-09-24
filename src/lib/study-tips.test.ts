import { describe, it, expect, beforeEach } from "vitest";
import {
  STUDY_TIPS,
  readTipCursor,
  tipText,
  tipsForDevice,
  writeTipCursor,
} from "./study-tips";

describe("study tips", () => {
  beforeEach(() => localStorage.removeItem("sb_loading_tip_cursor"));

  it("alternates features and study science, most useful first", () => {
    expect(STUDY_TIPS[0].kind).toBe("feature");
    expect(STUDY_TIPS[1].kind).toBe("study");
    // Every study-science tip names the effect and the study behind it.
    for (const tip of STUDY_TIPS.filter((t) => t.kind === "study")) {
      expect(tip.source, String(tip.text)).toMatch(/ · .+, \d{4}$/);
    }
  });

  it("names the platform's own modifier key", () => {
    const shortcut = STUDY_TIPS.find((t) => t.kind === "shortcut")!;
    expect(tipText(shortcut, { mac: true })).toMatch(/^⌘ \+ Enter/);
    expect(tipText(shortcut, { mac: false })).toMatch(/^Ctrl \+ Enter/);
  });

  it("leaves keyboard shortcuts out on a touch screen", () => {
    expect(tipsForDevice(true).some((t) => t.kind === "shortcut")).toBe(false);
    expect(tipsForDevice(false).some((t) => t.kind === "shortcut")).toBe(true);
  });

  it("starts the next wait where the last one left off, wrapping round", () => {
    expect(readTipCursor(5)).toBe(0);
    writeTipCursor(3);
    expect(readTipCursor(5)).toBe(3);
    writeTipCursor(7);
    expect(readTipCursor(5)).toBe(2);
  });

  it("ignores a cursor it can't read", () => {
    localStorage.setItem("sb_loading_tip_cursor", "not a number");
    expect(readTipCursor(5)).toBe(0);
  });
});
