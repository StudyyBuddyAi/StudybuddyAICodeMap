import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => rpc(name, args) },
}));

import ReportQuestion from "./ReportQuestion";

const open = () => fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
const send = () => screen.getByRole("button", { name: /send report/i });

describe("ReportQuestion", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("sends the reason, the note and the set the question was served in", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    render(<ReportQuestion questionId="q-1" sessionId="s-1" />);

    open();
    expect(send()).toBeDisabled(); // nothing chosen yet
    fireEvent.click(screen.getByRole("radio", { name: /answer is wrong/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  C is the best answer.  " } });
    fireEvent.click(send());

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/thanks — reported/i));
    expect(rpc).toHaveBeenCalledWith("report_question", {
      p_question: "q-1",
      p_reason: "wrong_key",
      p_note: "C is the best answer.",
      p_session: "s-1",
    });
  });

  it("asks for words when the reason is 'something else'", () => {
    render(<ReportQuestion questionId="q-1" />);
    open();
    fireEvent.click(screen.getByRole("radio", { name: /something else/i }));
    expect(send()).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "The image is missing." } });
    expect(send()).toBeEnabled();
  });

  it("says why a report was refused and keeps the dialog open", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "question_not_served" } });
    render(<ReportQuestion questionId="q-9" />);
    open();
    fireEvent.click(screen.getByRole("radio", { name: /typo/i }));
    fireEvent.click(send());

    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't in any of your sets/i);
    expect(send()).toBeInTheDocument();
  });

  it("starts clean on the next question", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { rerender } = render(<ReportQuestion questionId="q-1" />);
    open();
    fireEvent.click(screen.getByRole("radio", { name: /out of date/i }));
    fireEvent.click(send());
    await screen.findByRole("status");

    rerender(<ReportQuestion questionId="q-2" />);
    expect(screen.getByRole("button", { name: /report a problem/i })).toBeInTheDocument();
  });
});
