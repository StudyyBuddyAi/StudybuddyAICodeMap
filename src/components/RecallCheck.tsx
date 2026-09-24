import { useState } from "react";
import { m } from "motion/react";
import { Brain, Eye, EyeOff } from "lucide-react";
import type { Flashcard } from "@/types/generated-sheet";

/**
 * One question at the foot of a section, answer hidden until asked for.
 *
 * Trying to recall before looking is the point, so the answer is blurred rather
 * than omitted: the reader sees that an answer is there and how long it is,
 * but can't read it. While blurred it is hidden from assistive tech and can't
 * be selected, so neither a screen reader nor a drag-highlight gives it away.
 */
const RecallCheck = ({ card }: { card: Flashcard }) => {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      className="recall-check"
      style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: "1px dashed var(--border-strong)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--accent)",
        }}
      >
        <Brain style={{ width: 12, height: 12 }} aria-hidden />
        Check yourself
        {card.tag && (
          <span style={{ color: "var(--fg-subtle)", letterSpacing: "0.04em" }}>· {card.tag}</span>
        )}
      </div>

      <p className="text-sm text-foreground leading-relaxed" style={{ margin: 0 }}>
        {card.question}
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          marginTop: 8,
        }}
      >
        <m.p
          className="recall-answer text-sm text-muted-foreground leading-relaxed"
          aria-hidden={!revealed}
          initial={false}
          animate={{
            filter: revealed ? "blur(0px)" : "blur(6px)",
            opacity: revealed ? 1 : 0.7,
          }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          style={{
            flex: 1,
            margin: 0,
            userSelect: revealed ? "text" : "none",
            cursor: revealed ? "text" : "pointer",
          }}
          onClick={() => setRevealed(true)}
        >
          {card.answer}
        </m.p>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-expanded={revealed}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 h-7 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {revealed ? (
            <>
              <EyeOff className="h-3.5 w-3.5" aria-hidden /> Hide
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" aria-hidden /> Show answer
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default RecallCheck;
