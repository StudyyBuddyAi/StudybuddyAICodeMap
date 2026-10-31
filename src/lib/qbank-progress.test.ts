import { describe, it, expect } from "vitest";
import { accuracy, buildQBankProgress, weakestTopics, type ProgressAttempt } from "./qbank-progress";
import type { CurriculumTopic } from "./qbank-suggestions";

const NOW = new Date("2026-10-31T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const curriculum: CurriculumTopic[] = [
  { title: "Heart Failure", system: "cardiovascular", sortOrder: 1 },
  { title: "Atrial Fibrillation & Flutter", system: "cardiovascular", sortOrder: 2 },
  { title: "Asthma", system: "respiratory", sortOrder: 1 },
];

const attempt = (questionId: string, isCorrect: boolean, sessionId: string, subject: string, at = daysAgo(1)): ProgressAttempt => ({
  questionId,
  isCorrect,
  createdAt: at,
  sessionId,
  subject,
});

describe("buildQBankProgress", () => {
  it("counts each question once, at its first answer", () => {
    const p = buildQBankProgress({
      attempts: [
        attempt("q1", false, "s1", "Cardiovascular", daysAgo(3)),
        attempt("q1", true, "review", "Cardiovascular", daysAgo(1)),
        attempt("q2", true, "s1", "Cardiovascular", daysAgo(3)),
      ],
      sessions: [{ id: "s1", topics: ["Heart failure"] }],
      curriculum,
      now: NOW,
    });
    expect(p.answered).toBe(2);
    expect(p.correct).toBe(1);
    expect(p.attempts).toBe(3);
    expect(accuracy(p)).toBe(50);
  });

  it("measures each system against its curriculum topics", () => {
    const p = buildQBankProgress({
      attempts: [attempt("q1", true, "s1", "Cardiovascular")],
      sessions: [{ id: "s1", topics: ["heart failure"] }],
      curriculum,
      now: NOW,
    });
    const cv = p.systems.find((s) => s.key === "cardiovascular")!;
    expect(cv).toMatchObject({ answered: 1, correct: 1, topicsTotal: 2, topicsPractised: 1 });
    expect(p.systems.find((s) => s.key === "respiratory")).toMatchObject({ answered: 0, topicsTotal: 1 });
    expect(p.curriculumTotal).toBe(3);
    expect(p.curriculumPractised).toBe(1);
    // A typed topic that is the curriculum's own takes its spelling.
    expect(p.topics[0]).toMatchObject({ title: "Heart Failure", inCurriculum: true });
  });

  it("lists the organ systems first and the families last", () => {
    const p = buildQBankProgress({ attempts: [], sessions: [], curriculum, now: NOW });
    expect(p.systems[0].key).toBe("cardiovascular");
    expect(p.systems.slice(-2).map((s) => s.key)).toEqual(["social_sciences", "biostats_epi"]);
  });

  it("gives a mixed set's question to the one topic of its system", () => {
    const p = buildQBankProgress({
      attempts: [
        attempt("q1", true, "mix", "Respiratory"),
        attempt("q2", false, "mix", "Cardiovascular"),
        attempt("q3", false, "mix", "Renal & Urinary"),
      ],
      sessions: [{ id: "mix", topics: ["Asthma", "Heart Failure"] }],
      curriculum,
      now: NOW,
    });
    expect(p.topics.find((t) => t.title === "Asthma")).toMatchObject({ answered: 1, correct: 1 });
    expect(p.topics.find((t) => t.title === "Heart Failure")).toMatchObject({ answered: 1, correct: 0 });
    // The renal question belongs to no topic of the mix, but still counts.
    expect(p.answered).toBe(3);
    expect(p.systems.find((s) => s.key === "renal")!.answered).toBe(1);
    // Both topics of the mix were practised.
    expect(p.curriculumPractised).toBe(2);
  });

  it("keeps a typed topic that is not in the curriculum", () => {
    const p = buildQBankProgress({
      attempts: [attempt("q1", true, "s1", "Cardiovascular")],
      sessions: [{ id: "s1", topics: ["امراض القلب"] }],
      curriculum,
      now: NOW,
    });
    expect(p.topics[0]).toMatchObject({ title: "امراض القلب", inCurriculum: false, answered: 1 });
    expect(p.curriculumPractised).toBe(0);
  });

  it("counts the last seven days", () => {
    const p = buildQBankProgress({
      attempts: [attempt("q1", true, "s1", "Cardiovascular", daysAgo(2)), attempt("q2", true, "s1", "Cardiovascular", daysAgo(9))],
      sessions: [{ id: "s1", topics: ["Heart Failure"] }],
      curriculum,
      now: NOW,
    });
    expect(p.lastWeek).toBe(1);
  });
});

describe("weakestTopics", () => {
  it("ranks topics with enough answers and a score under the bar, weakest first", () => {
    const attempts = [
      ...["a", "b", "c"].map((q, i) => attempt(q, i === 0, "s1", "Cardiovascular")),
      ...["d", "e", "f"].map((q) => attempt(q, true, "s2", "Respiratory")),
      attempt("g", false, "s3", "Cardiovascular"),
    ];
    const p = buildQBankProgress({
      attempts,
      sessions: [
        { id: "s1", topics: ["Heart Failure"] },
        { id: "s2", topics: ["Asthma"] },
        { id: "s3", topics: ["Atrial Fibrillation & Flutter"] },
      ],
      curriculum,
      now: NOW,
    });
    // Asthma at 100% needs no more work; AF has one answer, too few to judge.
    expect(weakestTopics(p).map((t) => t.title)).toEqual(["Heart Failure"]);
  });
});
