import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const startGeneratedSession = vi.fn();
const stopGeneration = vi.fn();
const navigateMock = vi.fn();

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAnonymous: false }) }));
vi.mock("@/contexts/QBankContext", () => ({
  useQBankContext: () => ({
    startGeneratedSession,
    startReviewSession: vi.fn(),
    generation: null,
    session: null,
    resumeSession: vi.fn(),
    discardSession: vi.fn(),
    stopGeneration,
  }),
}));
vi.mock("@/hooks/use-usage-limit", () => ({
  MAX_DAILY_QBANK_QUESTIONS: 10,
  useUsageLimit: () => ({ qbankRemaining: 10, isProUser: false, isLoading: false }),
}));
vi.mock("@/hooks/use-qbank-review-queue", () => ({
  useQBankReviewQueue: () => ({ queue: { due: [], dueCount: 0, missedDue: 0, marked: 0, upcoming: 0, nextDueAt: null } }),
}));
vi.mock("@/hooks/use-curriculum-topics", () => ({
  useCurriculumTopics: () => ({
    curriculum: [
      { title: "Heart Failure — HFrEF (GDMT)", system: "cardiovascular", sortOrder: 80 },
      { title: "Acid-Base Disorders", system: "renal", sortOrder: 20 },
    ],
    options: [
      { title: "Heart Failure — HFrEF (GDMT)", systemName: "Cardiovascular", systemKey: "cardiovascular", source: "curriculum" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-library-topics", () => ({ useLibraryTopics: () => ({ topics: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: [], error: null })) } }));
vi.mock("@/components/dashboard/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/GoProModal", () => ({ default: () => null }));
vi.mock("@/components/AuthModal", () => ({ default: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import QBank from "./QBank";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <QBank />
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("QBank page", () => {
  beforeEach(() => {
    startGeneratedSession.mockReset().mockResolvedValue("sess-1");
    navigateMock.mockReset();
    localStorage.clear();
  });

  it("renders the composer, today's challenge, catalogue cards and quick starts for a new student", () => {
    renderPage();
    expect(screen.getByRole("combobox", { name: /topics to practise/i })).toBeInTheDocument();
    expect(screen.getByText("Today's challenge")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /for you/i })).toBeInTheDocument();
    expect(screen.getByText(/Half exam block · 10 Q/)).toBeInTheDocument();
    expect(screen.getByText("Surprise me")).toBeInTheDocument();
    expect(screen.getByText(/10 of 10 free questions left today/)).toBeInTheDocument();
  });

  it("mixes typed topics into one set at the page's exam", async () => {
    renderPage();
    const box = screen.getByRole("combobox", { name: /topics to practise/i });
    fireEvent.change(box, { target: { value: "asthma" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "sepsis" } });
    expect(screen.getByText(/Mixed: 5 questions across 2 topics \(3 · 2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start 5 step 1 questions/i }));

    await waitFor(() => expect(startGeneratedSession).toHaveBeenCalled());
    expect(startGeneratedSession).toHaveBeenCalledWith(["asthma", "sepsis"], 5, "balanced", "step1", "tutor", {});
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/qbank/session?session=sess-1"));
  });

  it("starts a card with its own topics, systems and level, inside the free allowance", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: /^Step 2 CK/ }));
    const card = screen.getByText("Today's challenge").closest("button")!;
    fireEvent.click(card);

    await waitFor(() => expect(startGeneratedSession).toHaveBeenCalled());
    const [topics, size, level, exam, , opts] = startGeneratedSession.mock.calls[0];
    expect(exam).toBe("step2ck");
    expect(size).toBeLessThanOrEqual(10);
    expect(["foundations", "balanced", "challenge"]).toContain(level);
    expect(Array.isArray(topics) ? topics.length : 1).toBe(opts.systems.length);
    // The target is remembered.
    expect(localStorage.getItem("sb_qbank_target_v1")).toBe("step2ck");
  });

  it("makes the exam unmistakable: tiles say what each tests, and the Start button carries it", () => {
    renderPage();
    const step1 = screen.getByRole("radio", { name: /^Step 1/ });
    expect(step1).toHaveAttribute("aria-checked", "true");
    expect(step1).toHaveTextContent("Mechanisms — why it happens.");
    expect(screen.getByRole("radio", { name: /^Step 2 CK/ })).toHaveTextContent("what to do next");
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", expect.stringContaining("the RAAS"));

    fireEvent.click(screen.getByRole("radio", { name: /^Step 2 CK/ }));
    expect(screen.getByRole("radio", { name: /^Step 2 CK/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /start 5 step 2 ck questions/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", expect.stringContaining("chest pain in the ED"));
  });

  it("shows the writing screen while the first question is written, and cancels cleanly", async () => {
    startGeneratedSession.mockImplementation(() => new Promise(() => {}));
    renderPage();
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "asthma" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /start 5 step 1 questions/i }));

    const dialog = await screen.findByRole("dialog", { name: /writing your first question/i });
    expect(dialog).toHaveTextContent("Routing your topics");
    expect(dialog).toHaveTextContent(/high, low or normal/i);
    expect(dialog).toHaveTextContent(/Step 1 tip/);

    fireEvent.click(screen.getByRole("button", { name: /cancel this set/i }));
    expect(stopGeneration).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /writing your first question/i })).not.toBeInTheDocument());
  });

  it("builds an exam block with one pre-routed topic per question, timed", async () => {
    renderPage();
    fireEvent.click(screen.getByText(/Half exam block · 10 Q/).closest("button")!);
    await waitFor(() => expect(startGeneratedSession).toHaveBeenCalled());
    const [topics, size, , , mode, opts] = startGeneratedSession.mock.calls[0];
    expect(size).toBe(10);
    expect(mode).toBe("timed");
    expect(Array.isArray(topics)).toBe(true);
    expect(opts.systems).toHaveLength((topics as string[]).length);
  });
});
