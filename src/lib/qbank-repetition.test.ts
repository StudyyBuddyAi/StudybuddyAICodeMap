import { describe, it, expect } from "vitest";
import {
  REPETITION_POLICY,
  assignRows,
  buildLedger,
  buildThreads,
  revisitSlots,
  topicKey,
  type Blueprint,
  type HistoryItem,
  type TopicMemory,
} from "../../supabase/functions/_shared/qbank-repetition.ts";
import { applyAudit, finalise, isTransient, parseDraft } from "../../supabase/functions/_shared/qbank-blueprint.ts";
import {
  SYSTEM_ROUTER_PROMPT,
  buildBatchPlan,
  buildUserMessage,
} from "../../supabase/functions/_shared/qbank-prompt.ts";

/** Deterministic stand-in for Math.random. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const NOW = Date.parse("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

let nextId = 1;
function item(over: Partial<HistoryItem> = {}): HistoryItem {
  const id = over.id ?? `q${nextId++}`;
  return {
    id,
    createdAt: daysAgo(30),
    generationId: "g-old",
    storedKey: "warfarin",
    rawKey: "warfarin",
    examTrack: "step1",
    concept: null,
    revisitOf: null,
    subtopic: `Subtopic ${id}`,
    teachingPoint: `**Fact** ${id}.`,
    leadIn: `Which mechanism ${id}?`,
    playable: true,
    lastAttemptAt: null,
    lastCorrect: null,
    ...over,
  };
}

const blueprint = (id: string, n: number, tiers: ("core" | "standard" | "extended")[] = []): Blueprint => ({
  id,
  broader: "Anticoagulants",
  concepts: Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    text: `Concept ${i + 1}`,
    tier: tiers[i] ?? "core",
  })),
});

const memory = (threads: ReturnType<typeof buildThreads>, bp?: Blueprint): TopicMemory => ({
  key: "warfarin",
  canonical: "Warfarin",
  threads,
  blueprints: bp ? { step1: bp } : {},
});

const rows = (n: number, track: "step1" | "step2ck" = "step1") =>
  Array.from({ length: n }, (_, i) => ({ index: i + 1, examTrack: track, topicKey: "warfarin" }));

describe("topicKey", () => {
  it("trims, collapses whitespace and lower-cases, as the history SQL does", () => {
    expect(topicKey("  Diabetic   Ketoacidosis ")).toBe("diabetic ketoacidosis");
    expect(topicKey("DKA")).toBe("dka");
  });
});

describe("buildThreads", () => {
  it("rests a correct answer for correctRestDays, then makes it due a re-test", () => {
    const [recent] = buildThreads([item({ lastAttemptAt: daysAgo(20), lastCorrect: true })], NOW);
    const [due] = buildThreads([item({ lastAttemptAt: daysAgo(22), lastCorrect: true })], NOW);
    expect(recent.status).toBe("recent");
    expect(due.status).toBe("due-retest");
    expect(REPETITION_POLICY.correctRestDays).toBe(21);
  });

  it("cools a miss for missSpacingDays before it is due a revisit", () => {
    const [cooling] = buildThreads([item({ lastAttemptAt: daysAgo(1), lastCorrect: false })], NOW);
    const [due] = buildThreads([item({ lastAttemptAt: daysAgo(3), lastCorrect: false })], NOW);
    expect(cooling.status).toBe("cooling");
    expect(due.status).toBe("due-revisit");
  });

  it("treats an unanswered item as met, resting pendingRestDays from when it was given", () => {
    const [recent] = buildThreads([item({ createdAt: daysAgo(6) })], NOW);
    const [due] = buildThreads([item({ createdAt: daysAgo(8) })], NOW);
    expect(recent.outcome).toBe("pending");
    expect(recent.status).toBe("recent");
    expect(due.status).toBe("due-retest");
  });

  it("treats an omitted answer as met, not missed — as the review queue does", () => {
    const [t] = buildThreads([item({ lastAttemptAt: daysAgo(5), lastCorrect: null })], NOW);
    expect(t.outcome).toBe("pending");
  });

  it("ignores items that never reached the student", () => {
    const [t] = buildThreads([item({ playable: false, createdAt: daysAgo(1) })], NOW);
    expect(t.outcome).toBe("unseen");
    expect(t.status).toBeNull();
    expect(t.held).toBe(1);
  });

  it("joins a revisit to the item it revisits, so an answered revisit closes the miss", () => {
    const root = item({ id: "root", lastAttemptAt: daysAgo(10), lastCorrect: false });
    const revisit = item({ id: "rev", revisitOf: "root", createdAt: daysAgo(4), lastAttemptAt: daysAgo(4), lastCorrect: true });
    const threads = buildThreads([root, revisit], NOW);
    expect(threads).toHaveLength(1);
    expect(threads[0].rootId).toBe("root");
    expect(threads[0].outcome).toBe("correct");
    expect(threads[0].status).toBe("recent");
  });

  it("lets a newer unanswered item outrank an older verdict", () => {
    const root = item({ id: "r2", lastAttemptAt: daysAgo(10), lastCorrect: false });
    const revisit = item({ id: "v2", revisitOf: "r2", createdAt: daysAgo(1) });
    const [t] = buildThreads([root, revisit], NOW);
    expect(t.outcome).toBe("pending");
    expect(t.status).toBe("recent");
  });

  it("groups by blueprint concept across sets", () => {
    const a = item({ concept: { blueprint: "bp", id: "c1" }, generationId: "g1", lastAttemptAt: daysAgo(30), lastCorrect: true });
    const b = item({ concept: { blueprint: "bp", id: "c1" }, generationId: "g2", lastAttemptAt: daysAgo(2), lastCorrect: true });
    const threads = buildThreads([a, b], NOW);
    expect(threads).toHaveLength(1);
    expect(threads[0].playable).toBe(2);
    expect([...threads[0].generations].sort()).toEqual(["g1", "g2"]);
    expect(threads[0].status).toBe("recent");
  });
});

describe("buildLedger", () => {
  it("lists what the student met lately, newest first, and leaves out what is due", () => {
    const threads = buildThreads(
      [
        item({ id: "old", lastAttemptAt: daysAgo(40), lastCorrect: true }),
        item({ id: "new", lastAttemptAt: daysAgo(1), lastCorrect: true }),
        item({ id: "mid", lastAttemptAt: daysAgo(5), lastCorrect: true }),
        item({ id: "cool", lastAttemptAt: daysAgo(1.5), lastCorrect: false }),
        item({ id: "miss", lastAttemptAt: daysAgo(5), lastCorrect: false }),
      ],
      NOW
    );
    const [section] = buildLedger([memory(threads)]);
    expect(section.topic).toBe("Warfarin");
    expect(section.entries.map((e) => e.subtopic)).toEqual(["Subtopic new", "Subtopic cool", "Subtopic mid"]);
    expect(section.entries[0].fact).toBe("Fact new.");
  });

  it("lists blueprint items by what they taught, since the writer can drift off its assignment", () => {
    const bp = blueprint("bp", 10);
    const threads = buildThreads(
      [
        item({ id: "tagged", concept: { blueprint: "bp", id: "c1" }, teachingPoint: "Factor VII falls first.", lastAttemptAt: daysAgo(1), lastCorrect: true }),
        item({ id: "legacy", lastAttemptAt: daysAgo(2), lastCorrect: true }),
      ],
      NOW
    );
    const [section] = buildLedger([memory(threads, bp)]);
    expect(section.entries).toEqual([
      { subtopic: "Subtopic tagged", fact: "Factor VII falls first." },
      { subtopic: "Subtopic legacy", fact: "Fact legacy." },
    ]);
  });

  it("caps a topic's lines, and shares the cap across topics", () => {
    const many = buildThreads(
      Array.from({ length: 50 }, (_, i) => item({ lastAttemptAt: daysAgo(1 + i / 100), lastCorrect: true })),
      NOW
    );
    expect(buildLedger([memory(many)])[0].entries).toHaveLength(REPETITION_POLICY.ledgerLinesPerTopic);
    const five = Array.from({ length: 5 }, (_, i) => ({ ...memory(many), canonical: `T${i}`, key: `t${i}` }));
    const sections = buildLedger(five);
    expect(sections.every((s) => s.entries.length === 8)).toBe(true);
  });

  it("is empty for a student with no history", () => {
    expect(buildLedger([memory([])])).toEqual([]);
  });
});

describe("revisitSlots", () => {
  it("allows one row in five, so a short wave still gets one", () => {
    expect([1, 2, 3, 5, 7, 8].map(revisitSlots)).toEqual([0, 0, 1, 1, 1, 2]);
  });
});

describe("assignRows", () => {
  const memories = (m: TopicMemory) => new Map([[m.key, m]]);

  it("revisits a due miss on at most one row in five, as a new item with the earlier question quoted", () => {
    const threads = buildThreads(
      [
        item({ id: "m1", lastAttemptAt: daysAgo(10), lastCorrect: false }),
        item({ id: "m2", lastAttemptAt: daysAgo(5), lastCorrect: false }),
      ],
      NOW
    );
    const { assignments } = assignRows(rows(5), memories(memory(threads)), "g-now", seeded(1));
    const revisits = [...assignments.values()].filter((a) => a.mode === "revisit");
    expect(revisits).toHaveLength(1);
    // Oldest miss first.
    expect(revisits[0].revisitOf).toBe("m1");
    expect(revisits[0].earlierLeadIn).toBe("Which mechanism m1?");
    expect(revisits[0].text).toBe("Fact m1.");
    // Without a blueprint, the other rows are the writer's.
    expect(assignments.size).toBe(1);
  });

  it("never revisits a miss that is still cooling, or one written on the other track", () => {
    const threads = buildThreads(
      [
        item({ id: "cool", lastAttemptAt: daysAgo(1), lastCorrect: false }),
        item({ id: "s2", examTrack: "step2ck", lastAttemptAt: daysAgo(9), lastCorrect: false }),
      ],
      NOW
    );
    const { assignments } = assignRows(rows(5), memories(memory(threads)), "g-now", seeded(2));
    expect(assignments.size).toBe(0);
  });

  it("assigns unmet concepts, core before standard before extended, never twice in a wave", () => {
    const bp = blueprint("bp", 8, ["extended", "core", "standard", "core", "extended", "standard", "core", "standard"]);
    const { assignments } = assignRows(rows(5), memories(memory([], bp)), "g-now", seeded(3));
    const ids = [...assignments.values()].map((a) => a.conceptId);
    expect(new Set(ids).size).toBe(5);
    const tierOf = (id: string | null) => bp.concepts.find((c) => c.id === id)!.tier;
    expect(ids.filter((id) => tierOf(id) === "core")).toHaveLength(3);
    expect(ids.filter((id) => tierOf(id) === "standard")).toHaveLength(2);
    expect([...assignments.values()].every((a) => a.mode === "new" && a.blueprintId === "bp")).toBe(true);
  });

  it("skips concepts the student has met", () => {
    const bp = blueprint("bp", 7);
    const met = ["c1", "c2", "c3", "c4", "c5"].map((id) =>
      item({ concept: { blueprint: "bp", id }, lastAttemptAt: daysAgo(3), lastCorrect: true })
    );
    const { assignments, coverage } = assignRows(rows(2), memories(memory(buildThreads(met, NOW), bp)), "g-now", seeded(4));
    expect([...assignments.values()].map((a) => a.conceptId).sort()).toEqual(["c6", "c7"]);
    expect(coverage).toEqual([
      { topic: "Warfarin", examTrack: "step1", total: 7, covered: 7, exhausted: true, broader: "Anticoagulants" },
    ]);
  });

  it("retries a concept whose item was held back once, then leaves it alone", () => {
    const bp = blueprint("bp", 2);
    const heldOnce = buildThreads([item({ concept: { blueprint: "bp", id: "c1" }, playable: false })], NOW);
    const a1 = assignRows(rows(2), memories(memory(heldOnce, bp)), "g-now", seeded(5)).assignments;
    expect([...a1.values()].map((a) => a.conceptId).sort()).toEqual(["c1", "c2"]);

    const heldTwice = buildThreads(
      [item({ concept: { blueprint: "bp", id: "c1" }, playable: false }), item({ concept: { blueprint: "bp", id: "c1" }, playable: false })],
      NOW
    );
    const a2 = assignRows(rows(2), memories(memory(heldTwice, bp)), "g-now", seeded(5)).assignments;
    expect([...a2.values()].map((a) => a.conceptId)).toEqual(["c2"]);
  });

  it("once the topic is used up, re-tests what is due, oldest first, quoting the earlier question", () => {
    const bp = blueprint("bp", 3);
    const threads = buildThreads(
      [
        item({ concept: { blueprint: "bp", id: "c1" }, lastAttemptAt: daysAgo(25), lastCorrect: true, leadIn: "Old c1?" }),
        item({ concept: { blueprint: "bp", id: "c2" }, lastAttemptAt: daysAgo(40), lastCorrect: true, leadIn: "Old c2?" }),
        item({ concept: { blueprint: "bp", id: "c3" }, lastAttemptAt: daysAgo(2), lastCorrect: true }),
      ],
      NOW
    );
    const { assignments, coverage } = assignRows(rows(1), memories(memory(threads, bp)), "g-now", seeded(6));
    const [a] = [...assignments.values()];
    expect(a.mode).toBe("retest");
    expect(a.conceptId).toBe("c2");
    expect(a.earlierLeadIn).toBe("Old c2?");
    expect(coverage[0].exhausted).toBe(true);
  });

  it("forced to repeat, picks the one met longest ago — never one from this set, never one cooling", () => {
    const bp = blueprint("bp", 3);
    const threads = buildThreads(
      [
        item({ concept: { blueprint: "bp", id: "c1" }, generationId: "g-now", createdAt: daysAgo(0.01) }),
        item({ concept: { blueprint: "bp", id: "c2" }, lastAttemptAt: daysAgo(1), lastCorrect: false }),
        item({ concept: { blueprint: "bp", id: "c3" }, lastAttemptAt: daysAgo(5), lastCorrect: true }),
      ],
      NOW
    );
    const { assignments } = assignRows(rows(3), memories(memory(threads, bp)), "g-now", seeded(7));
    expect([...assignments.values()].map((a) => [a.conceptId, a.mode])).toEqual([["c3", "retest"]]);
  });

  it("names a missed concept brought back by exhaustion a revisit, not a re-test", () => {
    const bp = blueprint("bp", 1);
    const threads = buildThreads(
      [item({ id: "missed", concept: { blueprint: "bp", id: "c1" }, lastAttemptAt: daysAgo(9), lastCorrect: false })],
      NOW
    );
    // A wave of one has no revisit slot, so it reaches the concept through exhaustion.
    const { assignments } = assignRows(rows(1), memories(memory(threads, bp)), "g-now", seeded(8));
    const [a] = [...assignments.values()];
    expect(a.mode).toBe("revisit");
    expect(a.revisitOf).toBe("missed");
  });

  it("revisits a missed blueprint concept by its concept text, and does not assign it twice", () => {
    const bp = blueprint("bp", 6);
    const threads = buildThreads(
      [item({ concept: { blueprint: "bp", id: "c4" }, lastAttemptAt: daysAgo(6), lastCorrect: false })],
      NOW
    );
    const { assignments } = assignRows(rows(5), memories(memory(threads, bp)), "g-now", seeded(9));
    const all = [...assignments.values()];
    const revisit = all.find((a) => a.mode === "revisit")!;
    expect(revisit.text).toBe("Concept 4");
    expect(revisit.conceptId).toBe("c4");
    expect(all.filter((a) => a.conceptId === "c4")).toHaveLength(1);
    expect(all).toHaveLength(5);
  });

  it("does not put the revisit on the same row every time", () => {
    const threads = buildThreads([item({ lastAttemptAt: daysAgo(10), lastCorrect: false })], NOW);
    const positions = new Set(
      Array.from({ length: 30 }, (_, s) => [...assignRows(rows(5), memories(memory(threads)), "g", seeded(s + 1)).assignments.keys()][0])
    );
    expect(positions.size).toBeGreaterThan(2);
  });

  it("assigns per track from that track's blueprint", () => {
    const s1 = blueprint("bp1", 5);
    const s2 = blueprint("bp2", 5);
    const m: TopicMemory = { ...memory([]), blueprints: { step1: s1, step2ck: s2 } };
    const mixed = [
      { index: 1, examTrack: "step1" as const, topicKey: "warfarin" },
      { index: 2, examTrack: "step2ck" as const, topicKey: "warfarin" },
    ];
    const { assignments, coverage } = assignRows(mixed, memories(m), "g", seeded(10));
    expect(assignments.get(1)?.blueprintId).toBe("bp1");
    expect(assignments.get(2)?.blueprintId).toBe("bp2");
    expect(coverage.map((c) => c.examTrack).sort()).toEqual(["step1", "step2ck"]);
  });
});

describe("blueprint parsing", () => {
  const draft = JSON.stringify({
    broader: "Anticoagulants",
    concepts: [
      { concept: "Warfarin inhibits vitamin K epoxide reductase", tier: "core" },
      { concept: "Warfarin   inhibits vitamin K epoxide reductase", tier: "core" },
      { concept: "Warfarin", tier: "core" },
      { concept: "Protein C depletion causes early skin necrosis", tier: "core" },
      { concept: "Warfarin is teratogenic and crosses the placenta", tier: "weird" },
      { concept: "x ".repeat(40), tier: "core" },
    ],
  });

  it("drops headings, paragraphs and exact repeats, and defaults an unknown tier", () => {
    const d = parseDraft(`Here you go:\n\`\`\`json\n${draft}\n\`\`\``);
    expect(d.broader).toBe("Anticoagulants");
    expect(d.concepts.map((c) => c.text)).toEqual([
      "Warfarin inhibits vitamin K epoxide reductase",
      "Protein C depletion causes early skin necrosis",
      "Warfarin is teratogenic and crosses the placenta",
    ]);
    expect(d.concepts[2].tier).toBe("standard");
  });

  it("keeps the first of each duplicate group and drops unusable lines, ignoring numbers that name no line", () => {
    const concepts = ["a", "b", "c", "d", "e", "f"].map((t) => ({ text: t, tier: "core" as const }));
    const kept = applyAudit(concepts, JSON.stringify({ duplicates: [[4, 2], [9, 1]], unusable: [6, 0, "3"] }));
    expect(kept.map((c) => c.text)).toEqual(["a", "b", "c", "e"]);
  });

  it("refuses an audit that would empty most of the list", () => {
    const concepts = ["a", "b", "c", "d"].map((t) => ({ text: t, tier: "core" as const }));
    expect(() => applyAudit(concepts, JSON.stringify({ duplicates: [[1, 2, 3, 4]], unusable: [] }))).toThrow();
  });

  it("tells a busy gateway from a build that came out wrong", () => {
    expect(isTransient(new Error('corti_429: {"error":{"message":"The engine is currently busy"}}'))).toBe(true);
    expect(isTransient(new Error("corti_503: (empty body)"))).toBe(true);
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(new DOMException("The operation timed out.", "TimeoutError"))).toBe(true);
    expect(isTransient(new Error("corti_400: bad request"))).toBe(false);
    expect(isTransient(new Error("only 5 concepts"))).toBe(false);
    expect(isTransient(new Error("audit dropped 9 of 12"))).toBe(false);
  });

  it("numbers the concepts and refuses a thin list", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ text: `t${i}`, tier: "core" as const }));
    expect(finalise(eight).map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]);
    expect(() => finalise(eight.slice(0, 7))).toThrow();
  });
});

describe("buildUserMessage with history", () => {
  const plan = () => buildBatchPlan("heme_onc", 5, seeded(42), 1, "balanced", "step1", []);

  it("adds nothing for a student with no history", () => {
    const p = plan();
    expect(buildUserMessage({ topic: "warfarin", plan: p, ledger: [] })).toBe(buildUserMessage({ topic: "warfarin", plan: p }));
  });

  it("lists the do-not-re-test facts before the topic", () => {
    const msg = buildUserMessage({
      topic: "warfarin",
      plan: plan(),
      ledger: [{ topic: "Warfarin", entries: [{ subtopic: "Skin necrosis", fact: "Protein C falls first." }] }],
    });
    expect(msg).toContain("## Already asked of this student — do not re-test");
    expect(msg).toContain("- Skin necrosis: Protein C falls first.");
    expect(msg.indexOf("do not re-test")).toBeLessThan(msg.indexOf("## Requested topic"));
    expect(msg).toContain("not the general physiology beneath it, a neighbouring disease");
  });

  it("lets an assigned row's own concept override the list, and says so only when rows are assigned", () => {
    const ledger = [{ topic: "Warfarin", entries: [{ subtopic: "Skin necrosis", fact: "Protein C falls first." }] }];
    const exception = "The one exception is a concept a plan row names";
    expect(buildUserMessage({ topic: "warfarin", plan: plan(), ledger })).not.toContain(exception);
    const p = plan();
    p.questions[0].assignment = { mode: "new", text: "VKOR", conceptId: "c1", blueprintId: "bp", revisitOf: null, earlierLeadIn: null };
    expect(buildUserMessage({ topic: "warfarin", plan: p, ledger })).toContain(exception);
  });

  it("drops avoid-list subtopics the ledger already names", () => {
    const msg = buildUserMessage({
      topic: "warfarin",
      plan: plan(),
      avoidSubtopics: ["Skin necrosis", "CYP2C9"],
      ledger: [{ topic: "Warfarin", entries: [{ subtopic: "skin necrosis", fact: "Protein C falls first." }] }],
    });
    expect(msg).toContain("## Already covered — do not duplicate\n- CYP2C9\n");
    expect(msg).not.toContain("- Skin necrosis\n");
  });

  it("names each assigned row's concept and explains the modes it uses", () => {
    const p = plan();
    p.questions[0].assignment = { mode: "new", text: "VKOR inhibition", conceptId: "c1", blueprintId: "bp", revisitOf: null, earlierLeadIn: null };
    p.questions[1].assignment = {
      mode: "revisit",
      text: "Protein C falls first",
      conceptId: null,
      blueprintId: null,
      revisitOf: "q1",
      earlierLeadIn: "Which   mechanism explains the lesions?",
    };
    const msg = buildUserMessage({ topic: "warfarin", plan: p });
    expect(msg).toContain(`- Question ${p.questions[0].index}: reasoning order ${p.questions[0].reasoningOrder} — concept: VKOR inhibition`);
    expect(msg).toContain(`— revisit: Protein C falls first (earlier question: "Which mechanism explains the lesions?")`);
    expect(msg).toContain("Where a plan row names a concept, that is what its item must turn on.");
    expect(msg).toContain("A revisit row is a concept this student answered wrongly");
    expect(msg).not.toContain("A re-test row");
  });

  it("uses the measured wording when every row is assigned", () => {
    const p = plan();
    p.questions.forEach((q, i) => {
      q.assignment = { mode: "new", text: `C${i}`, conceptId: `c${i}`, blueprintId: "bp", revisitOf: null, earlierLeadIn: null };
    });
    const msg = buildUserMessage({ topic: "warfarin", plan: p });
    expect(msg).toContain(
      "whichever option is correct.\n\nEach plan row names the concept its item must turn on. Write the item so its correct answer depends on that concept and not on any other row's;"
    );
  });

  it("groups a mixed set's ledger by topic and labels its assigned rows", () => {
    const p = buildBatchPlan("heme_onc", 4, seeded(1), 1, "balanced", "step1", [
      { topic: "Warfarin", system: "heme_onc" },
      { topic: "DKA", system: "endocrine" },
    ]);
    p.questions[1].assignment = { mode: "retest", text: "Ketone dipstick", conceptId: "c2", blueprintId: "bp", revisitOf: null, earlierLeadIn: "Old?" };
    const msg = buildUserMessage({
      topic: "Warfarin · DKA",
      plan: p,
      ledger: [
        { topic: "Warfarin", entries: [{ subtopic: "A", fact: "a." }] },
        { topic: "Diabetic ketoacidosis", entries: [{ subtopic: "B", fact: "b." }] },
      ],
    });
    expect(msg).toContain("### Warfarin\n- A: a.\n\n### Diabetic ketoacidosis\n- B: b.");
    expect(msg).toContain("on these topics, in earlier sessions");
    expect(msg).toContain("(Endocrinology) — re-test: Ketone dipstick (earlier question: \"Old?\")");
    expect(msg).toContain("A re-test row is a concept this student met some time ago.");
  });
});

describe("router prompt", () => {
  it("asks for a canonical name that keeps the student's scope", () => {
    expect(SYSTEM_ROUTER_PROMPT).toContain('"canonical": "<topic name>"');
    expect(SYSTEM_ROUTER_PROMPT).toContain("never a broader or a narrower one");
  });
});
