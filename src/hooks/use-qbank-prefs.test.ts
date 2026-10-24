import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QBANK_TEXT_SCALES, useQBankPrefs } from "./use-qbank-prefs";

afterEach(() => localStorage.clear());

describe("useQBankPrefs", () => {
  it("starts a new student at 100%, not the smallest size", () => {
    const { result } = renderHook(() => useQBankPrefs());
    expect(result.current.textScale).toBe(1);
  });

  it("reaches 200%, as the exam's text resize does", () => {
    expect(QBANK_TEXT_SCALES[QBANK_TEXT_SCALES.length - 1]).toBe(2);
  });

  it("remembers the size and clamps at both ends", () => {
    const { result } = renderHook(() => useQBankPrefs());
    act(() => result.current.changeText(-1));
    expect(result.current.textStep).toBe(0);
    act(() => result.current.changeText(2));
    expect(result.current.textScale).toBe(QBANK_TEXT_SCALES[2]);
    const again = renderHook(() => useQBankPrefs());
    expect(again.result.current.textStep).toBe(2);
  });

  it("ignores a stored value it does not understand", () => {
    localStorage.setItem("sb_qbank_text", "banana");
    const { result } = renderHook(() => useQBankPrefs());
    expect(result.current.textStep).toBe(0);
  });

  it("remembers a hidden clock", () => {
    const { result } = renderHook(() => useQBankPrefs());
    act(() => result.current.setTimerHidden(true));
    expect(renderHook(() => useQBankPrefs()).result.current.timerHidden).toBe(true);
  });
});
