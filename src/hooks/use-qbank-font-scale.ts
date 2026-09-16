import { useCallback, useState } from "react";

const STORAGE_KEY = "sb_qbank_font";

/** Text size steps for the player, as a multiplier on its base sizes. */
export const QBANK_FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;
const DEFAULT_STEP = 1;

const readStep = (): number => {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(n) && n >= 0 && n < QBANK_FONT_SCALES.length ? n : DEFAULT_STEP;
  } catch {
    return DEFAULT_STEP;
  }
};

/**
 * The player's text size. A preference of this browser rather than of a set,
 * so it lives in localStorage and never travels with a session.
 */
export const useQBankFontScale = () => {
  const [step, setStep] = useState<number>(readStep);

  const change = useCallback((delta: number) => {
    setStep((prev) => {
      const next = Math.min(Math.max(prev + delta, 0), QBANK_FONT_SCALES.length - 1);
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Private mode or storage blocked: the size still changes for this visit.
      }
      return next;
    });
  }, []);

  return { step, scale: QBANK_FONT_SCALES[step], maxStep: QBANK_FONT_SCALES.length - 1, change };
};
