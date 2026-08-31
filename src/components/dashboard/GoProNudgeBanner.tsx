import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import GoProModal from "@/components/GoProModal";

const GoProNudgeBanner = ({ isRealUser }: { isRealUser: boolean }) => {
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!isRealUser) return;
    const dismissed = localStorage.getItem("sb_gopro_nudge_dismissed");
    if (!dismissed) setShow(true);
  }, [isRealUser]);

  const dismiss = () => {
    localStorage.setItem("sb_gopro_nudge_dismissed", "1");
    setClosing(true);
    window.setTimeout(() => setShow(false), 260);
  };

  if (!show) return null;

  return (
    <>
      <div
        className={`animate-fade-in ${closing ? "banner-collapsing" : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 18px",
          maxHeight: 128,
          overflow: "hidden",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderInlineStart: "3px solid var(--accent)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm text-foreground">
            <span className="font-medium">Unlock Claude + unlimited generations</span>
            <span className="text-muted-foreground"> — Go Pro for Anthropic's AI and no limits.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="h-8 rounded-md font-medium text-xs px-3"
            onClick={() => setModalOpen(true)}
          >
            Go Pro
          </Button>
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <GoProModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
};

export default GoProNudgeBanner;
