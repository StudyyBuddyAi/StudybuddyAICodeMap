import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WritingOverlay from "./WritingOverlay";
import LabLightning from "./LabLightning";
import type { GenerationState } from "@/contexts/QBankContext";

const gen = (over: Partial<GenerationState> = {}): GenerationState => ({
  status: "running",
  topic: "Heart failure · SPIKES",
  target: 5,
  systemName: "Mixed",
  heldBack: 0,
  heldBackItems: [],
  error: null,
  capReached: false,
  blueprint: [
    { index: 1, reasoningOrder: "2nd", focus: "Heart failure" },
    { index: 2, reasoningOrder: "3rd", focus: "SPIKES" },
  ],
  focuses: [
    { topic: "Heart failure", systemName: "Cardiovascular" },
    { topic: "SPIKES", systemName: "Communication & Ethics" },
  ],
  writing: { stage: "case", chars: 1800 },
  ...over,
});

describe("WritingOverlay", () => {
  it("shows real progress, the blueprint, a warm-up and a tip for the exam", () => {
    render(
      <WritingOverlay open target="step2ck" generation={gen()} elapsed={9} size={5} topics={["Heart failure", "SPIKES"]} onCancel={vi.fn()} />
    );
    const dialog = screen.getByRole("dialog", { name: /writing your first question/i });
    expect(dialog).toHaveTextContent("Step 2 CK · Clinical decisions");
    expect(dialog).toHaveTextContent("9s");
    // Stages before "case" are done, "case" is the active one.
    const steps = screen.getByRole("list", { name: "Progress" });
    expect(steps).toHaveTextContent("Writing the patient case");
    expect(dialog).toHaveTextContent("Q1 2-step (Heart failure) · Q2 3-step (SPIKES)");
    expect(dialog).toHaveTextContent("Communication & Ethics");
    expect(dialog).toHaveTextContent(/Step 2 CK tip/);
    expect(dialog).toHaveTextContent(/high, low or normal/i);
  });

  it("renders nothing when closed, and cancels on request", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <WritingOverlay open={false} target="step1" generation={gen()} elapsed={0} size={5} topics={[]} onCancel={onCancel} />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<WritingOverlay open target="step1" generation={null} elapsed={0} size={5} topics={["asthma"]} onCancel={onCancel} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Routing your topics");
    fireEvent.click(screen.getByRole("button", { name: /cancel this set/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("LabLightning", () => {
  it("grades a tap, shows the range, and keeps score", () => {
    render(<LabLightning autoFocus={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));
    expect(screen.getByRole("status")).toHaveTextContent(/normal is/);
    expect(screen.getByText(/\/1$/)).toBeInTheDocument();
    // Answer buttons lock until the next value.
    expect(screen.getByRole("button", { name: /High/ })).toBeDisabled();
  });

  it("answers from the keyboard", () => {
    render(<LabLightning autoFocus={false} />);
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByRole("status")).toHaveTextContent(/normal is/);
  });
});
