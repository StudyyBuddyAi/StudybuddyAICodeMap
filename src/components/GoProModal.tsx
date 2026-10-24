import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { MessageCircle, Check } from "lucide-react";
import RedeemCodeForm from "@/components/RedeemCodeForm";
import { useAuth } from "@/hooks/use-auth";
import BrandMark from "@/components/brand/BrandMark";
import { PoweredByCorti } from "@/components/PoweredByCorti";

interface GoProModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GoProModal = ({ open, onOpenChange }: GoProModalProps) => {
  const { user, isAnonymous } = useAuth();
  const isGuest = !user || isAnonymous;
  const [showRedeem, setShowRedeem] = useState(false);
  useEffect(() => {
    if (!open) setShowRedeem(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-center rounded-xl">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <BrandMark size={52} />
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
            manually — message us on WhatsApp and we'll activate your account within a
            few hours.
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
        </div>

        {/* Someone sent a code already: use it here instead of hunting for Settings. */}
        <div className="border-t border-border pt-3 text-left">
          {!showRedeem ? (
            <p className="text-center text-sm text-muted-foreground">
              Already have a code?{" "}
              <button
                type="button"
                onClick={() => setShowRedeem(true)}
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Redeem it
              </button>
            </p>
          ) : isGuest ? (
            <p className="text-center text-sm text-muted-foreground">
              Sign in first — a code unlocks Pro on your account. Use <b className="text-foreground">Sign in</b> at
              the top of the page, then come back here.
            </p>
          ) : (
            <RedeemCodeForm autoFocus onRedeemed={() => onOpenChange(false)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GoProModal;
