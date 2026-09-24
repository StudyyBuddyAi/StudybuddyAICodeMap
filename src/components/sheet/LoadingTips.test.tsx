import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LazyMotion, domAnimation } from "motion/react";
import LoadingTips from "./LoadingTips";
import { STUDY_TIPS, tipText } from "@/lib/study-tips";

const text = (i: number) => tipText(STUDY_TIPS[i], { mac: false });

const tips = (active: boolean) => (
  <LazyMotion features={domAnimation}>
    <LoadingTips active={active} />
  </LazyMotion>
);

describe("LoadingTips", () => {
  beforeEach(() => localStorage.removeItem("sb_loading_tip_cursor"));

  it("waits a beat before showing, so a fast start never flashes it", async () => {
    render(tips(true));
    expect(screen.queryByText(text(0))).not.toBeInTheDocument();
    expect(await screen.findByText(text(0))).toBeInTheDocument();
  });

  it("moves to the next tip when its countdown ends", async () => {
    render(tips(true));
    await screen.findByText(text(0));
    await act(async () => {
      fireEvent.animationEnd(screen.getByTestId("tip-timer"));
    });
    expect(await screen.findByText(text(1))).toBeInTheDocument();
  });

  it("steps back and forth on request, wrapping round", async () => {
    render(tips(true));
    await screen.findByText(text(0));
    await act(async () => screen.getByRole("button", { name: "Previous tip" }).click());
    expect(await screen.findByText(text(STUDY_TIPS.length - 1))).toBeInTheDocument();
    await act(async () => screen.getByRole("button", { name: "Next tip" }).click());
    expect(await screen.findByText(text(0))).toBeInTheDocument();
  });

  it("starts the next wait after the tips already seen", async () => {
    render(tips(true));
    await screen.findByText(text(0));
    expect(localStorage.getItem("sb_loading_tip_cursor")).toBe("1");
  });

  it("goes as soon as the sheet starts arriving", async () => {
    const { rerender } = render(tips(true));
    await screen.findByText(text(0));
    rerender(tips(false));
    await waitFor(() => expect(screen.queryByText(text(0))).not.toBeInTheDocument());
  });
});
