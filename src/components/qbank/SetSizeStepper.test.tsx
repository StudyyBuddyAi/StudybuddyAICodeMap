import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SetSizeStepper from "./SetSizeStepper";

function Harness({ initial = 5, max = 20 }) {
  const [size, setSize] = useState(initial);
  return (
    <>
      <SetSizeStepper value={size} max={max} onChange={setSize} />
      <output data-testid="size">{size}</output>
    </>
  );
}

const box = () => screen.getByRole("spinbutton");
const size = () => screen.getByTestId("size").textContent;

describe("SetSizeStepper", () => {
  it("takes a number between the presets", () => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: "13" } });
    fireEvent.blur(box());
    expect(size()).toBe("13");
  });

  it("settles a typed number into range", () => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: "45" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(size()).toBe("20");
    fireEvent.change(box(), { target: { value: "0" } });
    fireEvent.blur(box());
    expect(size()).toBe("1");
  });

  it("keeps the old size when the box is left empty", () => {
    render(<Harness initial={8} />);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());
    expect(size()).toBe("8");
    expect(box()).toHaveValue(8);
  });

  it("steps by one and stops at the ends", () => {
    render(<Harness initial={19} />);
    fireEvent.click(screen.getByRole("button", { name: "One more question" }));
    expect(size()).toBe("20");
    expect(screen.getByRole("button", { name: "One more question" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "One fewer question" }));
    expect(size()).toBe("19");
  });

  it("offers only the presets a free account can afford", () => {
    render(<Harness initial={5} max={7} />);
    expect(screen.getByRole("button", { name: "5" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "10" })).toBeNull();
    expect(screen.queryByRole("button", { name: "20" })).toBeNull();
  });
});
