import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, FileText, Layers, Brain, BookMarked } from "lucide-react";
import { LIMITS } from "@/config/product";
import { t } from "@/config/i18n";

const WelcomeModal = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const seen = localStorage.getItem("sb_welcomed");
    if (!seen) setOpen(true);
  }, []);

  /** Mark the modal seen and close it, without moving the user anywhere. */
  const dismiss = () => {
    localStorage.setItem("sb_welcomed", "1");
    setOpen(false);
  };

  /**
   * The CTA is the only path that navigates. It used to send everyone to
   * `/dashboard?start=sheet` — a param nothing reads — and it fired on plain
   * dismissal too, so closing the dialog silently moved the page.
   */
  const startFirstSheet = () => {
    dismiss();
    navigate("/sheets");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden rounded-xl">
        {/* Header */}
        <div className="border-b border-border px-7 pt-7 pb-6 text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-foreground tracking-tight">
            Welcome to StudyBuddy
          </h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            The fastest way for medical students to turn any topic into
            exam-ready notes — no prompting, no setup, no fluff.
          </p>
        </div>

        {/* Feature highlights */}
        <div className="px-7 py-5 space-y-3.5 text-left">
          {[
            {
              icon: FileText,
              title: "Exam-focused study sheets",
              desc: "Memory hooks, exam traps, key facts — all structured.",
            },
            {
              icon: Layers,
              title: "Instant flashcard decks",
              desc: "Generated from any topic and ready to review.",
            },
            {
              icon: BookMarked,
              // Was "on every generation" — citations are metered per tier, so
              // that promise broke on the free plan's fourth sheet of the day.
              title: t("citations.welcomeItem"),
              desc: t("citations.welcomeItemBody", {
                free: LIMITS.citations.free,
              }),
            },
            {
              icon: Brain,
              title: "Spaced repetition built in",
              desc: "Your deck surfaces the cards you need most.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background mt-0.5">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="px-7 pb-7">
          <Button
            className="w-full h-10 rounded-lg font-medium text-sm"
            onClick={startFirstSheet}
          >
            Generate my first sheet →
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeModal;
