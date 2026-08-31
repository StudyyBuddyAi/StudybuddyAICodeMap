import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The hero demonstration.
 *
 * The most interesting thing this product does is turn a bare topic name into
 * structure. Every version of this hero so far *described* that — a headline
 * plus a static screenshot of the result. This performs it: the topic types
 * itself, then the sheet resolves section by section, and it loops.
 *
 * Two constraints shaped the pacing. It has to be legible at a glance, so
 * sections resolve one at a time rather than racing. And it sits under a
 * student's eyes for as long as they read the headline beside it, so nothing
 * blinks, flashes or bounces — the only motion is text arriving, at reading
 * speed.
 *
 * Under `prefers-reduced-motion` the finished state renders immediately and no
 * timer is ever scheduled.
 */

interface Section {
  label: string;
  lines: string[];
}

interface Demo {
  topic: string;
  sections: Section[];
}

const DEMOS: Demo[] = [
  {
    topic: "heart failure",
    sections: [
      {
        label: "Overview",
        lines: [
          "Reduced output despite adequate filling.",
          "Split by ejection fraction: HFrEF ≤40%, HFpEF ≥50%.",
        ],
      },
      {
        label: "Key finding",
        lines: ["S3 gallop — the most specific bedside sign of overload."],
      },
      {
        label: "Exam trap",
        lines: ["HFpEF still has symptoms. Normal EF is not a normal heart."],
      },
    ],
  },
  {
    topic: "diabetic ketoacidosis",
    sections: [
      {
        label: "Overview",
        lines: [
          "Insulin deficiency → lipolysis → ketogenesis.",
          "Anion-gap acidosis with hyperglycaemia and ketosis.",
        ],
      },
      {
        label: "Key finding",
        lines: ["Kussmaul breathing; total-body potassium is depleted."],
      },
      {
        label: "Exam trap",
        lines: ["Give fluids and potassium before insulin, not after."],
      },
    ],
  },
  {
    topic: "ischemic stroke",
    sections: [
      {
        label: "Overview",
        lines: [
          "Focal deficit from arterial occlusion.",
          "Time is the whole management algorithm.",
        ],
      },
      {
        label: "Key finding",
        lines: ["Non-contrast CT first — to exclude haemorrhage, not confirm."],
      },
      {
        label: "Exam trap",
        lines: ["Do not lower blood pressure before thrombolysis is decided."],
      },
    ],
  },
];

const TYPE_MS = 55;      // per character — deliberately unhurried
const SECTION_MS = 700;  // between sections resolving
const HOLD_MS = 2600;    // finished sheet stays put, so it can be read
const CLEAR_MS = 420;

type Phase = "typing" | "building" | "holding" | "clearing";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const HeroDemo = () => {
  const still = useMemo(prefersReducedMotion, []);
  const [demoIndex, setDemoIndex] = useState(0);
  const [typed, setTyped] = useState(still ? DEMOS[0].topic.length : 0);
  const [revealed, setRevealed] = useState(still ? DEMOS[0].sections.length : 0);
  const [phase, setPhase] = useState<Phase>(still ? "holding" : "typing");
  const timer = useRef<number>();

  const demo = DEMOS[demoIndex];

  useEffect(() => {
    if (still) return;
    window.clearTimeout(timer.current);

    if (phase === "typing") {
      if (typed < demo.topic.length) {
        timer.current = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS);
      } else {
        timer.current = window.setTimeout(() => setPhase("building"), 420);
      }
    } else if (phase === "building") {
      if (revealed < demo.sections.length) {
        timer.current = window.setTimeout(
          () => setRevealed((n) => n + 1),
          SECTION_MS
        );
      } else {
        timer.current = window.setTimeout(() => setPhase("holding"), HOLD_MS);
      }
    } else if (phase === "holding") {
      timer.current = window.setTimeout(() => setPhase("clearing"), 100);
    } else {
      timer.current = window.setTimeout(() => {
        setDemoIndex((i) => (i + 1) % DEMOS.length);
        setTyped(0);
        setRevealed(0);
        setPhase("typing");
      }, CLEAR_MS);
    }

    return () => window.clearTimeout(timer.current);
  }, [phase, typed, revealed, demo, still]);

  const clearing = phase === "clearing";

  return (
    <div className="hero-demo" aria-hidden="true">
      {/* Topic line — the input the student would actually type */}
      <div className="hero-demo__bar">
        <span className="hero-demo__prompt">Topic</span>
        <span className="hero-demo__typed">
          {demo.topic.slice(0, typed)}
          {!still && phase === "typing" && <i className="hero-demo__caret" />}
        </span>
      </div>

      {/* The sheet, resolving */}
      <div className="hero-demo__sheet">
        {demo.sections.map((section, i) => (
          <div
            key={`${demoIndex}-${section.label}`}
            className="hero-demo__section"
            data-shown={!clearing && i < revealed ? "true" : "false"}
            style={{ transitionDelay: clearing ? "0ms" : `${i * 60}ms` }}
          >
            <div className="hero-demo__label">{section.label}</div>
            {section.lines.map((line) => (
              <p key={line} className="hero-demo__line">
                {line}
              </p>
            ))}
          </div>
        ))}

        {/* Holds the panel's height so nothing below it moves as sections land */}
        <div className="hero-demo__spacer" />
      </div>

      <div className="hero-demo__foot">
        <span className="hero-demo__dot" />
        {revealed >= demo.sections.length && !clearing
          ? "Sheet ready · grounded in clinical guidelines"
          : "Writing…"}
      </div>
    </div>
  );
};

/** The same content, flattened, for assistive tech and for search engines. */
export const HeroDemoText = () => (
  <p className="sr-only">
    Example: entering the topic “heart failure” produces a study sheet with an
    overview, the key bedside finding, and a common exam trap.
  </p>
);

export default HeroDemo;
