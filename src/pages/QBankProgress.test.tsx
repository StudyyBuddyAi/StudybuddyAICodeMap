import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildQBankProgress, type QBankProgress as Progress } from "@/lib/qbank-progress";

const navigateMock = vi.fn();
let hookValue: { progress: Progress | null; signedIn: boolean; isLoading: boolean; isError: boolean };

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));
vi.mock("@/hooks/use-qbank-progress", () => ({ useQBankProgress: () => hookValue }));
vi.mock("@/components/dashboard/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import QBankProgress from "./QBankProgress";

const at = new Date().toISOString();
const progress = buildQBankProgress({
  attempts: [
    ...["a", "b", "c", "d"].map((id, i) => ({ questionId: id, isCorrect: i === 0, createdAt: at, sessionId: "s1", subject: "Cardiovascular" })),
    ...["e", "f", "g"].map((id) => ({ questionId: id, isCorrect: true, createdAt: at, sessionId: "s2", subject: "Respiratory" })),
  ],
  sessions: [
    { id: "s1", topics: ["Heart Failure"] },
    { id: "s2", topics: ["Asthma"] },
  ],
  curriculum: [
    { title: "Heart Failure", system: "cardiovascular", sortOrder: 1 },
    { title: "Asthma", system: "respiratory", sortOrder: 1 },
    { title: "COPD", system: "respiratory", sortOrder: 2 },
  ],
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <QBankProgress />
    </MemoryRouter>
  );

describe("QBank progress page", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    hookValue = { progress, signedIn: true, isLoading: false, isError: false };
  });

  it("shows the totals and the curriculum covered", () => {
    renderPage();
    expect(screen.getByText("Questions answered").nextSibling).toHaveTextContent("7");
    expect(screen.getByText("Correct first time").nextSibling).toHaveTextContent("57%");
    expect(screen.getByText("Curriculum topics covered").nextSibling).toHaveTextContent("2 / 3");
  });

  it("puts the weakest topic first and practises it in one tap", () => {
    renderPage();
    const weak = screen.getByRole("region", { name: "Work on next" });
    const rows = within(weak).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Heart Failure");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Practise Heart Failure" }));
    expect(navigateMock).toHaveBeenCalledWith("/qbank", { state: { topic: "Heart Failure" } });
  });

  it("lists every system with its topics covered", () => {
    renderPage();
    const systems = screen.getByRole("region", { name: "By system" });
    expect(within(systems).getByText("Respiratory").parentElement).toHaveTextContent("3 questions · 1 of 2 topics");
    expect(within(systems).getByText("Renal & Urinary").parentElement).toHaveTextContent("Not started");
  });

  it("says what to do before anything is answered", () => {
    hookValue = { ...hookValue, progress: { ...progress, answered: 0 } };
    renderPage();
    expect(screen.getByText("Nothing answered yet")).toBeInTheDocument();
  });
});
