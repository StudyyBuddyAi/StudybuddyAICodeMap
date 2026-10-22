import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import QBankCalculator from "./QBankCalculator";

const MARGIN = 8;

/**
 * The calculator as its own small window, as on the exam: it floats over the
 * question, moves out of the way by its title bar, and keeps what was typed
 * while the student reads the next lab value. Hidden rather than unmounted when
 * closed, for the same reason.
 */
const FloatingCalculator = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // Focus the keypad on opening, so typing goes straight in.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("[data-qbank-capture-keys]")?.focus();
  }, [open]);

  const clamp = (x: number, y: number) => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 272;
    const h = el?.offsetHeight ?? 360;
    return {
      x: Math.min(Math.max(x, MARGIN), window.innerWidth - w - MARGIN),
      y: Math.min(Math.max(y, MARGIN), window.innerHeight - h - MARGIN),
    };
  };

  return createPortal(
    <div
      ref={panelRef}
      className="qb-calc qb-exam-portal"
      role="dialog"
      aria-modal="false"
      aria-label="Calculator"
      hidden={!open}
      style={pos ? { left: pos.x, top: pos.y } : { right: 24, bottom: 72 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="qb-calc-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const rect = panelRef.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        Calculator
        <button type="button" className="qb-btn qb-btn--icon" onClick={onClose} aria-label="Close calculator">
          <X />
        </button>
      </div>
      <div className="qb-calc-body">
        <QBankCalculator />
      </div>
    </div>,
    document.body
  );
};

export default FloatingCalculator;
