/**
 * How each exam looks and reads in the QBank, in one place.
 *
 * Step 1 and Step 2 CK ask different things — why it happens versus what to do
 * next — and the page has to make that difference impossible to miss: each
 * exam gets its own colour (violet for the science, green for the clinic), its
 * own icon and its own one-line promise, carried from the picker through the
 * Start button, the suggestion cards and the waiting screen into the player.
 *
 * Class strings are written out whole so Tailwind keeps them.
 */
import type { ExamTarget } from "@/lib/qbank-suggestions";

export interface ExamTheme {
  label: string;
  /** What the exam tests, in four words or so. */
  tagline: string;
  /** The promise, one line. */
  blurb: string;
  /** Example topics for the composer's placeholder. */
  placeholder: string;
  /** Picker tile when selected. */
  tileOn: string;
  /** Icon chip. */
  icon: string;
  /** Accent text. */
  text: string;
  /** Solid fill for the Start button. */
  solid: string;
  /** Small badge. */
  badge: string;
  /** The composer card's border. */
  border: string;
  /** CSS colour for inline styles (the player's own stylesheet). */
  hsl: string;
  hslSoft: string;
}

export const EXAM_THEME: Record<ExamTarget, ExamTheme> = {
  step1: {
    label: "Step 1",
    tagline: "Foundational science",
    blurb: "Mechanisms — why it happens.",
    placeholder: "Type a topic — the RAAS, nephrotic syndrome, antiarrhythmics…",
    tileOn: "border-info bg-info-soft",
    icon: "bg-info text-info-foreground",
    text: "text-info",
    solid: "bg-info text-info-foreground hover:bg-info/90",
    badge: "bg-info-soft text-info",
    border: "border-info/40",
    hsl: "hsl(var(--info))",
    hslSoft: "hsl(var(--info-soft))",
  },
  step2ck: {
    label: "Step 2 CK",
    tagline: "Clinical decisions",
    blurb: "Diagnosis and management — what to do next.",
    placeholder: "Type a topic — chest pain in the ED, DKA, preeclampsia…",
    tileOn: "border-success bg-success-soft",
    icon: "bg-success text-success-foreground",
    text: "text-success",
    solid: "bg-success text-success-foreground hover:bg-success/90",
    badge: "bg-success-soft text-success",
    border: "border-success/40",
    hsl: "hsl(var(--success))",
    hslSoft: "hsl(var(--success-soft))",
  },
  mixed: {
    label: "Both",
    tagline: "Step 1 + Step 2 CK",
    blurb: "Half and half, shuffled — science and decisions.",
    placeholder: "Type a topic — heart failure, DKA, breaking bad news…",
    tileOn: "border-primary bg-primary/10",
    icon: "bg-primary text-primary-foreground",
    text: "text-primary",
    solid: "bg-primary text-primary-foreground hover:bg-primary/90",
    badge: "bg-primary/10 text-primary",
    border: "border-primary/40",
    hsl: "hsl(var(--primary))",
    hslSoft: "hsl(var(--primary) / 0.1)",
  },
};

/**
 * Test-taking tips for the waiting screen, one exam each. Strategy, not
 * medicine — nothing here can be wrong about a fact.
 */
export const EXAM_TIPS: Record<"step1" | "step2ck", string[]> = {
  step1: [
    "Read the question line first — it tells you whether they want a mechanism, a drug or a structure.",
    "Name the diagnosis in your head before you look at the options.",
    "Two options both look right? Pick the one that explains every finding in the stem.",
    "Mechanism questions go one step further than you expect: drug → receptor → side effect.",
    "Lab values in the stem are clues — compare each one to its range before you read on.",
    "Strike out what you know is wrong; it frees your working memory for what is left.",
  ],
  step2ck: [
    "Read the last sentence first: do they want the diagnosis, the next step or the treatment?",
    "Unstable patient? Stabilise before you investigate — the ABCs beat any scan.",
    "“Next best step” means the very next thing, not the definitive treatment.",
    "Check the vital signs before anything else — they decide how urgent the answer is.",
    "When two answers are both reasonable, choose the least invasive one that settles the question.",
    "Screening questions turn on age, sex and risk — find those three first.",
  ],
};

export const tipsFor = (target: ExamTarget): string[] =>
  target === "mixed" ? [...EXAM_TIPS.step1, ...EXAM_TIPS.step2ck] : EXAM_TIPS[target];
