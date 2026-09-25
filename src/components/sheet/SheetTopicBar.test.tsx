import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { LazyMotion, domAnimation } from "motion/react";
import SheetTopicBar from "./SheetTopicBar";
import type { SheetSectionSpec } from "@/types/generated-sheet";

const SECTIONS: SheetSectionSpec[] = [
  { key: "overview", title: "Overview", kind: "prose" },
  { key: "clinicalApproach", title: "Clinical Approach", kind: "prose" },
  { key: "keyPoints", title: "Key Points", kind: "list" },
  { key: "referenceNote", title: "Sources", kind: "prose" },
];

const bar = (props: Partial<Parameters<typeof SheetTopicBar>[0]> = {}) =>
  render(
    <LazyMotion features={domAnimation}>
      <SheetTopicBar
        emoji="🫀"
        title="Heart Failure"
        summary="Step 2 · Intermediate · Concise"
        streaming={false}
        progress={{
          sections: SECTIONS,
          readyKeys: ["overview"],
          liveKey: "clinicalApproach",
          status: { planned: true, sources: 4 },
        }}
        readingTarget={createRef<HTMLElement>()}
        actions={<button type="button">Edit</button>}
        {...props}
      />
    </LazyMotion>
  );

describe("SheetTopicBar", () => {
  it("names the sheet, and carries the page's actions", () => {
    bar();
    expect(screen.getByRole("heading", { name: /Heart Failure/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("reports the generation's progress while it runs", () => {
    bar({ streaming: true });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Writing Clinical Approach");
    expect(status).toHaveTextContent("4 sources");
    expect(status).toHaveTextContent("1/4");
  });

  it("describes how a finished sheet was made", () => {
    bar({ details: ["5 sources"] });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Step 2 · Intermediate · Concise · 5 sources")).toBeInTheDocument();
  });

  it("marks the finish before settling", () => {
    const { rerender } = bar({ streaming: true });
    rerender(
      <LazyMotion features={domAnimation}>
        <SheetTopicBar
          title="Heart Failure"
          summary="Step 2 · Intermediate · Concise"
          streaming={false}
          progress={{ sections: SECTIONS, readyKeys: ["overview"], status: { planned: true, sources: 4 } }}
          readingTarget={createRef<HTMLElement>()}
          actions={null}
        />
      </LazyMotion>
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sheet ready");
    expect(screen.getByRole("status")).toHaveTextContent("4/4");
  });
});
