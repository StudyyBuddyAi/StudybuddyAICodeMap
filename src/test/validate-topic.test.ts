import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateTopic,
  topicRejectionMessage,
  TOPIC_MIN_LENGTH,
  TOPIC_MAX_LENGTH,
  type TopicRejection,
} from "@/lib/validate-topic";

describe("validateTopic — rejections", () => {
  const cases: [string, TopicRejection, string][] = [
    ["<script>alert(1)</script>", "markup", "the reported case"],
    ["<img src=x onerror=alert(1)>", "markup", "tag with an event handler"],
    ["javascript:alert(1)", "markup", "a bare javascript: scheme"],
    ["asdfasdf", "repetitive", "a repeated 4-char unit"],
    ["aaaaaaaa", "repetitive", "a repeated 1-char unit"],
    ["abcabcabc", "repetitive", "a repeated 3-char unit"],
    ["qwerty", "keyboard_mash", "a keyboard row"],
    ["asdfgh", "keyboard_mash", "another keyboard row"],
    ["12345", "no_letters", "digits only"],
    ["!!!!!", "no_letters", "punctuation only"],
    ["<>{}", "no_letters", "brackets only (also has no letters)"],
    ["ab", "too_short", "below the minimum length"],
    ["", "too_short", "empty string"],
    ["   ", "too_short", "whitespace only"],
    ["a".repeat(TOPIC_MAX_LENGTH + 1), "too_long", "over the maximum length"],
  ];

  it.each(cases)("rejects %j as %s (%s)", (input, expected) => {
    expect(validateTopic(input)).toBe(expected);
  });

  it("strips zero-width characters before measuring length", () => {
    // A 2-char string padded with zero-width spaces must not slip past
    // too_short by counting invisible characters as content.
    const zeroWidthSpace = "\u200b";
    const padded = "a" + zeroWidthSpace.repeat(20) + "b";
    expect(validateTopic(padded)).toBe("too_short");
  });

  it("every rejection reason has a non-empty user-facing message", () => {
    const reasons: TopicRejection[] = [
      "too_short",
      "too_long",
      "no_letters",
      "markup",
      "repetitive",
      "keyboard_mash",
    ];
    for (const reason of reasons) {
      expect(topicRejectionMessage(reason).length).toBeGreaterThan(0);
    }
  });
});

describe("validateTopic — must never reject a real medical topic", () => {
  // This is the guard against over-blocking, which is the real risk in a
  // change like this one — false positives here would break generation for
  // legitimate use, silently, for anyone typing an unusual-looking term.
  const realTopics = [
    "Sphygmomanometer",
    "Streptococcus pneumoniae",
    "HFpEF vs HFrEF",
    "β-blocker overdose",
    "Type 2 DM",
    "COVID-19",
    "SIADH",
    "Guillain-Barré syndrome",
    "5-HT3 receptor antagonists",
    "Wolff-Parkinson-White syndrome",
    `Heart failure lecture notes:
Reduced ejection fraction leads to compensatory mechanisms including
RAAS activation and sympathetic overdrive. Patients present with dyspnea,
orthopnea, and peripheral edema. First-line management includes ACE
inhibitors, beta-blockers, and diuretics for symptom control.`,
  ];

  it.each(realTopics)("accepts %j", (topic) => {
    expect(validateTopic(topic)).toBeNull();
  });
});

describe("validateTopic — well-formed but non-medical (left to the model)", () => {
  // These pass the structural gate on purpose — Part 4 of the fix lets the
  // model decline them instead of the regex layer guessing at "medical-ness".
  it.each(["banana bread recipe", "kdjfhskjdfh", "what's the weather today"])(
    "does not structurally reject %j",
    (topic) => {
      expect(validateTopic(topic)).toBeNull();
    }
  );
});

describe("client/server copies stay in sync", () => {
  // The server copy at supabase/functions/_shared/validate-topic.ts is
  // authoritative; this one is a UX-only mirror. A tuned threshold or a new
  // rejection reason added to only one side is the realistic failure mode.
  const serverPath = resolve(
    process.cwd(),
    "supabase/functions/_shared/validate-topic.ts"
  );
  const serverSource = readFileSync(serverPath, "utf-8");

  it("agrees on TOPIC_MIN_LENGTH", () => {
    expect(serverSource).toContain(`TOPIC_MIN_LENGTH = ${TOPIC_MIN_LENGTH}`);
  });

  it("agrees on TOPIC_MAX_LENGTH", () => {
    expect(serverSource).toContain(`TOPIC_MAX_LENGTH = ${TOPIC_MAX_LENGTH}`);
  });

  it("agrees on the set of rejection reasons", () => {
    const reasons: TopicRejection[] = [
      "too_short",
      "too_long",
      "no_letters",
      "markup",
      "repetitive",
      "keyboard_mash",
    ];
    for (const reason of reasons) {
      expect(serverSource).toContain(`"${reason}"`);
    }
  });
});
