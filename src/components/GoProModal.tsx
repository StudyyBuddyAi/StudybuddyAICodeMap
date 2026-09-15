import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle, Mail, Sparkles, Check } from "lucide-react";
import { PoweredByCorti } from "@/components/PoweredByCorti";

interface GoProModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GoProModal = ({ open, onOpenChange }: GoProModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-center rounded-xl">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--accent)",
              marginBottom: 8,
            }}
          >
            StudyBuddy AI · Pro
          </div>
          <DialogTitle className="text-xl text-foreground font-semibold tracking-tight">Go Pro</DialogTitle>
          <div className="pt-1">
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              $4.99 <span className="text-sm font-medium text-muted-foreground">USD / month</span>
            </p>
          </div>
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            Everything in StudyBuddy, unlocked — with every sheet, deck and explanation
            written by Corti S1, an AI model built for healthcare. Pro access is granted
            manually — reach out on WhatsApp or Email and we'll activate your account
            within a few hours.
          </DialogDescription>
          <div className="flex justify-center pt-2">
            <PoweredByCorti />
          </div>
        </DialogHeader>

        <ul className="space-y-2 text-left pt-1">
          {[
            "Unlimited sheets & flashcard generations",
            "Corti S1 — AI built for healthcare, tuned for USMLE study",
            "Publication-backed sources on every generation — cited directly from PubMed",
            "Priority access to new features",
          ].map((benefit) => (
            <li
              key={benefit}
              className="flex items-start gap-2.5 text-sm text-foreground"
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Check className="h-3 w-3 text-primary" />
              </span>
              <span className="leading-snug">{benefit}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3 pt-2">
          <a
            href="https://wa.me/972592823030"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full"
          >
            <Button className="w-full h-10 rounded-lg font-medium gap-2">
              <MessageCircle className="h-4 w-4" />
              Message on WhatsApp
            </Button>
          </a>
          <a href="mailto:Osama200az@gmail.com" className="w-full">
            <Button
              variant="outline"
              className="w-full h-10 rounded-lg font-medium gap-2"
            >
              <Mail className="h-4 w-4" />
              Send an Email
            </Button>
          </a>
        </div>

        <p className="text-[11px] text-muted-foreground pt-1 opacity-70">
          Access is usually granted within a few hours.
        </p>
      </DialogContent>
    </Dialog>
  );
};

export default GoProModal;
