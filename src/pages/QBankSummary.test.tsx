import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Question, SessionGeneration, TopicCoverage } from "@/lib/qbank-types";

/**
 * The summary page's topic-memory surface: where the student stands on each
 * topic's concept list, and the way on once a topic is used up. The rest of
 * the page is exercised by hand; this pins the wiring that is easy to break —
 * which topic "Another set" and "Move on" each write.
 */

const navigateMock = vi.fn();
const startGeneratedSession = vi.fn(async () => "session-2");
let generation: SessionGeneration | null = null;

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));
vi.mock("@/components/dashboard/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/qbank-generation-report", () => ({ fetchGenerationReport: async () => null }));
vi.mock("@/hooks/use-usage-limit", () => ({ useDailyLimit: () => ({ reached: false, percent: 0, resetsIn: "5h", isLoading: false, refresh: vi.fn() }) }));
vi.mock("@/hooks/use-flashcard-deck", () => ({ useFlashcardDeck: () => ({ saveCards: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const question: Question = {
  id: "q1",
  subject: "Hematology & Oncology",
  domain: "Pharmacology",
  topic: "Warfarin skin necrosis",
  difficulty: "Medium",
  competency: "Foundational Science",
  question_text: "A woman starts warfarin.\n\nWhich protein falls first?",
  option_a: "Protein C",
  option_b: "Factor II",
  option_c: "Factor X",
  option_d: "Factor IX",
  option_e: "Antithrombin",
  correct_option: "a",
  explanation: "Protein C has the shortest half-life.",
};

// Stable references, as the real provider's are: the page's load effect
// depends on loadSummary, and a fresh function per render would re-run it
// forever.
const lastSummary = {
  questions: [question],
  answers: [{ question_id: "q1", selected_option: "a", is_correct: true, time_taken_ms: 30_000 }],
  totalTime: 30_000,
  score: 1,
  total: 1,
  flaggedIds: [],
};
const stable = { enterSummaryReview: vi.fn(), setReviewIndex: vi.fn(), loadSummary: vi.fn() };
vi.mock("@/contexts/QBankContext", () => ({
  useQBankContext: () => ({
    lastSummary,
    startGeneratedSession,
    lastGeneration: generation,
    lastMode: "tutor",
    ...stable,
  }),
}));

import QBankSummary from "./QBankSummary";

const cov = (over: Partial<TopicCoverage> = {}): TopicCoverage => ({
  topic: "Warfarin",
  examTrack: "step1",
  total: 22,
  covered: 10,
  exhausted: false,
  broader: "Anticoagulants",
  ...over,
});

const gen = (coverage?: TopicCoverage[]): SessionGeneration => ({
  generationId: "g1",
  topic: "warfarin",
  system: "heme_onc",
  systemName: "Hematology & Oncology",
  target: 5,
  challenge: "balanced",
  examMode: "step1",
  nextIndex: 6,
  covered: [],
  ...(coverage ? { coverage } : {}),
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <QBankSummary />
    </MemoryRouter>
  );

describe("QBank summary — topic memory", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    startGeneratedSession.mockClear();
  });

  it("says nothing about coverage for a topic without a blueprint", async () => {
    generation = gen();
    renderPage();
    await screen.findByText(/Another 5 on this topic/);
    expect(screen.queryByText(/concepts we track/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move on to/ })).not.toBeInTheDocument();
  });

  it("says how far through the topic the student is", async () => {
    generation = gen([cov()]);
    renderPage();
    expect(
      await screen.findByText("You've now been asked 10 of the 22 concepts we track in Warfarin; the next set on it goes to ones you haven't met.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move on to/ })).not.toBeInTheDocument();
  });

  it("offers the broader topic once this one is used up, and writes it at the same size and level", async () => {
    generation = gen([cov({ covered: 22, exhausted: true })]);
    renderPage();
    expect(await screen.findByText(/You've now been asked every concept we track in Warfarin \(22\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move on to Anticoagulants" }));
    await waitFor(() => expect(startGeneratedSession).toHaveBeenCalledWith("Anticoagulants", 5, "balanced", "step1", "tutor"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/qbank/session?session=session-2"));
  });

  it("still writes the same topic again from the try-again button", async () => {
    generation = gen([cov({ covered: 22, exhausted: true })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Another 5 on this topic/ }));
    await waitFor(() => expect(startGeneratedSession).toHaveBeenCalledWith("warfarin", 5, "balanced", "step1", "tutor"));
  });
});
