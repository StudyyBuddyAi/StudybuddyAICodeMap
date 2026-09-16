import { describe, it, expect } from "vitest";
import { buildTrainingItems, studyDayIndex, timeZoneOffsetMinutes } from "@/lib/fsrs-items";

const iso = (s: string) => new Date(s).toISOString();

describe("timeZoneOffsetMinutes", () => {
  it("reads fixed and DST offsets", () => {
    expect(timeZoneOffsetMinutes(Date.parse("2026-01-15T12:00:00Z"), "UTC")).toBe(0);
    expect(timeZoneOffsetMinutes(Date.parse("2026-01-15T12:00:00Z"), "Asia/Riyadh")).toBe(180);
    expect(timeZoneOffsetMinutes(Date.parse("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(timeZoneOffsetMinutes(Date.parse("2026-07-15T12:00:00Z"), "America/New_York")).toBe(-240);
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(timeZoneOffsetMinutes(Date.now(), "Not/AZone")).toBe(0);
  });
});

describe("studyDayIndex", () => {
  it("starts the day at 4 am local time", () => {
    // 03:30 and 04:30 local (UTC+3) fall on different study days.
    const before = studyDayIndex(Date.parse("2026-03-10T00:30:00Z"), "Asia/Riyadh");
    const after = studyDayIndex(Date.parse("2026-03-10T01:30:00Z"), "Asia/Riyadh");
    expect(after - before).toBe(1);
  });
});

describe("buildTrainingItems", () => {
  it("emits one item per later review, with day-based delta_t", () => {
    const rows = [
      { card_id: "a", rating: "good", reviewed_at: iso("2026-03-01T10:00:00Z") },
      { card_id: "a", rating: "good", reviewed_at: iso("2026-03-01T10:10:00Z") },
      { card_id: "a", rating: "again", reviewed_at: iso("2026-03-03T09:00:00Z") },
      { card_id: "a", rating: "easy", reviewed_at: iso("2026-03-08T09:00:00Z") },
    ];
    const items = buildTrainingItems(rows, "UTC");
    // The second review is same-day only, so its item carries no long-term signal.
    expect(items).toEqual([
      [
        { rating: 3, deltaT: 0 },
        { rating: 3, deltaT: 0 },
        { rating: 1, deltaT: 2 },
      ],
      [
        { rating: 3, deltaT: 0 },
        { rating: 3, deltaT: 0 },
        { rating: 1, deltaT: 2 },
        { rating: 4, deltaT: 5 },
      ],
    ]);
  });

  it("sorts each card's reviews and ignores unknown ratings", () => {
    const rows = [
      { card_id: "b", rating: "easy", reviewed_at: iso("2026-03-05T09:00:00Z") },
      { card_id: "b", rating: "bogus", reviewed_at: iso("2026-03-04T09:00:00Z") },
      { card_id: "b", rating: "hard", reviewed_at: iso("2026-03-01T09:00:00Z") },
    ];
    expect(buildTrainingItems(rows, "UTC")).toEqual([
      [
        { rating: 2, deltaT: 0 },
        { rating: 4, deltaT: 4 },
      ],
    ]);
  });

  it("keeps cards apart", () => {
    const rows = [
      { card_id: "a", rating: "good", reviewed_at: iso("2026-03-01T09:00:00Z") },
      { card_id: "b", rating: "good", reviewed_at: iso("2026-03-02T09:00:00Z") },
    ];
    expect(buildTrainingItems(rows, "UTC")).toEqual([]);
  });
});
