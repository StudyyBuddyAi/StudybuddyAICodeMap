import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Layers, Brain, BookMarked } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";

const WelcomeModal = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const seen = localStorage.getItem("sb_welcomed");
    if (!seen) setOpen(true);
  }, []);

  const handleClose = () => {
    localStorage.setItem("sb_welcomed", "1");
    setOpen(false);
    navigate("/dashboard?start=sheet", { replace: true });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden rounded-xl">
        {/* Header */}
        <div className="border-b border-border px-7 pt-7 pb-6 text-center">
          <div className="flex justify-center mb-4">
            <BrandMark size={56} />
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
              title: "Evidence-backed sources on every generation",
              desc: "Cited directly from PubMed peer-reviewed literature.",
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
            onClick={handleClose}
          >
            Generate my first sheet →
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeModal;
