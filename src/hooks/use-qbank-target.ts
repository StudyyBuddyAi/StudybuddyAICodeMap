import { useCallback, useState } from "react";
import type { ExamTarget } from "@/lib/qbank-suggestions";

const KEY = "sb_qbank_target_v1";
const TARGETS: ExamTarget[] = ["step1", "step2ck", "mixed"];

const read = (): ExamTarget => {
  try {
    const v = localStorage.getItem(KEY);
    return TARGETS.includes(v as ExamTarget) ? (v as ExamTarget) : "step1";
  } catch {
    return "step1";
  }
};

/**
 * The exam the student is preparing for, remembered on this device — a page
 * setting rather than a choice on every set, because a student prepares for one
 * exam for months (as AMBOSS's study objective). It picks the exam every set is
 * written for and which challenge cards are offered.
 */
export function useQBankTarget(): [ExamTarget, (t: ExamTarget) => void] {
  const [target, setTargetState] = useState<ExamTarget>(read);
  const setTarget = useCallback((t: ExamTarget) => {
    setTargetState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // Private mode: the choice lasts for this visit.
    }
  }, []);
  return [target, setTarget];
}
