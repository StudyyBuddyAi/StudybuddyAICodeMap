/**
 * Tips for the wait between Generate and the first words of a sheet.
 *
 * That wait is the server's preparation — retrieval, choosing the sections —
 * plus the model thinking before it writes, and nothing on the page moves
 * during it. Like a game's loading screen, it is put to use: half the tips
 * teach a feature a reader might not find alone, half are study techniques
 * with the research behind them, which suits a reader about to study.
 *
 * The two kinds alternate, and the most useful tip comes first, since a
 * first-time reader may only see one before the sheet starts.
 */

export type TipKind = "feature" | "study" | "shortcut";

export interface StudyTip {
  kind: TipKind;
  /** A function where the wording depends on the platform (key names). */
  text: string | ((platform: { mac: boolean }) => string);
  /** For a study technique: the effect and the study it comes from. */
  source?: string;
}

export const TIP_KIND_LABELS: Record<TipKind, string> = {
  feature: "Using StudyBuddy",
  study: "Study science",
  shortcut: "Shortcut",
};

/** How long each tip stays, in ms — about a sentence's reading time. */
export const TIP_DURATION_MS = 6500;

export const STUDY_TIPS: readonly StudyTip[] = [
  {
    kind: "feature",
    text: "Most sections end with a recall question. Answer it in your head before you tap Show answer — the attempt is what makes it stick.",
  },
  {
    kind: "study",
    text: "Close the sheet and write down what you remember. Pulling it back out does more for recall than a second read.",
    source: "Testing effect · Roediger & Karpicke, 2006",
  },
  {
    kind: "feature",
    text: "Highlight a phrase, or click a bold term, to expand it or get a clinical tie-in right where you're reading.",
  },
  {
    kind: "study",
    text: "Review it tomorrow, then again in a few days. Spreading the same time out beats one long sitting.",
    source: "Spacing effect · Cepeda et al., 2006",
  },
  {
    kind: "feature",
    text: "Keep the sheet's flashcards with Add to my deck. Spaced repetition brings each card back just before you'd forget it.",
  },
  {
    kind: "study",
    text: "Guess before you look. Even a wrong guess at a question makes the right answer stick better.",
    source: "Pretesting effect · Richland, Kornell & Kao, 2009",
  },
  {
    kind: "feature",
    text: "Sources lists the guideline passages the sheet was built on. Open any line to read the original text.",
  },
  {
    kind: "study",
    text: "Mix topics when you drill questions. It feels harder than one topic at a time, and it works better.",
    source: "Interleaving · Rohrer & Taylor, 2007",
  },
  {
    kind: "feature",
    text: "Edit, in the bar above, changes exam mode, difficulty or length — then Regenerate rewrites the sheet.",
  },
  {
    kind: "study",
    text: "Explain a mechanism out loud, as if to a classmate. The gaps show up the moment you can't.",
    source: "Self-explanation · Chi et al., 1994",
  },
  {
    kind: "feature",
    text: "Comparison sections come out as tables. On a phone, swipe sideways — the first column stays put.",
  },
  {
    kind: "study",
    text: "Sketch it once: a pathway, a curve, a nerve's course. Words with a picture are remembered better than words alone.",
    source: "Dual coding · Paivio, 1971",
  },
  {
    kind: "feature",
    text: "Save a sheet and it waits for you under Continue studying — no need to generate it again.",
  },
  {
    kind: "study",
    text: "Make up your own mnemonic. What you generate yourself is remembered better than what you only read.",
    source: "Generation effect · Slamecka & Graf, 1978",
  },
  {
    kind: "shortcut",
    text: ({ mac }) =>
      `${mac ? "⌘" : "Ctrl"} + Enter in the topic box generates a sheet without reaching for the button.`,
  },
  {
    kind: "feature",
    text: "Export PDF prints just the sheet — no menus, no buttons.",
  },
];

export function tipText(tip: StudyTip, platform: { mac: boolean }): string {
  return typeof tip.text === "function" ? tip.text(platform) : tip.text;
}

/**
 * The tips for this device. A keyboard shortcut means nothing on a touch
 * screen, so it is left out there rather than shown as a tip that can't apply.
 */
export function tipsForDevice(coarsePointer: boolean): StudyTip[] {
  return STUDY_TIPS.filter((t) => !(coarsePointer && t.kind === "shortcut"));
}

// ── Where the next loading screen starts ────────────────────────────────────
// Each tip shown moves the cursor on, so the next wait starts where this one
// left off instead of showing the same first tip every time.

const CURSOR_KEY = "sb_loading_tip_cursor";

export function readTipCursor(count: number): number {
  if (count <= 0) return 0;
  try {
    const n = Number(localStorage.getItem(CURSOR_KEY));
    return Number.isInteger(n) && n >= 0 ? n % count : 0;
  } catch {
    return 0;
  }
}

export function writeTipCursor(next: number): void {
  try {
    localStorage.setItem(CURSOR_KEY, String(next));
  } catch {
    // Not persisted: the next wait starts from the first tip again.
  }
}
