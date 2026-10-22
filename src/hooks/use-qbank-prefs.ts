import { useCallback, useState } from "react";

/**
 * Text size steps for the player, as a multiplier on its base sizes. The real
 * exam's settings menu scales text to 200%, so this does too.
 */
export const QBANK_TEXT_SCALES = [1, 1.15, 1.3, 1.5, 1.75, 2] as const;

// A new key: the old one stored an index into a scale that started at 0.9.
const TEXT_KEY = "sb_qbank_text";
const TIMER_KEY = "sb_qbank_timer_hidden";

const readStep = (): number => {
  try {
    const raw = localStorage.getItem(TEXT_KEY);
    // Number(null) is 0, a valid step: a missing preference must not read as one.
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < QBANK_TEXT_SCALES.length ? n : 0;
  } catch {
    return 0;
  }
};

const readTimerHidden = (): boolean => {
  try {
    return localStorage.getItem(TIMER_KEY) === "1";
  } catch {
    return false;
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or storage blocked: the change still holds for this visit.
  }
};

/**
 * The player's display preferences. Preferences of this browser rather than of
 * a set, so they live in localStorage and never travel with a session.
 */
export const useQBankPrefs = () => {
  const [step, setStep] = useState<number>(readStep);
  const [timerHidden, setTimerHiddenState] = useState<boolean>(readTimerHidden);

  const changeText = useCallback((delta: number) => {
    setStep((prev) => {
      const next = Math.min(Math.max(prev + delta, 0), QBANK_TEXT_SCALES.length - 1);
      write(TEXT_KEY, String(next));
      return next;
    });
  }, []);

  const resetText = useCallback(() => {
    setStep(0);
    write(TEXT_KEY, "0");
  }, []);

  const setTimerHidden = useCallback((hidden: boolean) => {
    setTimerHiddenState(hidden);
    write(TIMER_KEY, hidden ? "1" : "0");
  }, []);

  return {
    textStep: step,
    textScale: QBANK_TEXT_SCALES[step],
    maxTextStep: QBANK_TEXT_SCALES.length - 1,
    changeText,
    resetText,
    timerHidden,
    setTimerHidden,
  };
};
