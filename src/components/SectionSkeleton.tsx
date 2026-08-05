interface SectionSkeletonProps {
  variant?: "sheet-section" | "sheet-body" | "flashcard" | "qbank-options";
  className?: string;
}

const Bar = ({ className = "" }: { className?: string }) => (
  <div
    className={`skeleton-shimmer ${className}`}
    style={{ borderRadius: "var(--radius-sm)", background: "var(--border)" }}
  />
);

/**
 * Animated skeleton placeholders that mirror the real content layout,
 * with a left-to-right shimmer sweep.
 */
const SectionSkeleton = ({ variant = "sheet-section", className = "" }: SectionSkeletonProps) => {
  // Body only — for slotting inside a section card that already has its own
  // chrome and heading, so a streaming sheet keeps its structure visible.
  if (variant === "sheet-body") {
    return (
      <div className={`space-y-2.5 ${className}`}>
        <Bar className="h-3.5 w-full" />
        <Bar className="h-3.5 w-11/12" />
        <Bar className="h-3.5 w-4/5" />
        <Bar className="h-3.5 w-2/3" />
      </div>
    );
  }

  if (variant === "flashcard") {
    return (
      <div
        className={`space-y-3 ${className}`}
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          padding: 20,
        }}
      >
        <Bar className="h-5 w-20" />
        <Bar className="h-4 w-11/12" />
        <Bar className="h-4 w-3/4" />
        <Bar className="h-4 w-2/3" />
      </div>
    );
  }

  if (variant === "qbank-options") {
    return (
      <div className={`space-y-2.5 ${className}`}>
        {["w-11/12", "w-4/5", "w-3/4", "w-2/3"].map((w, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-4"
            style={{
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
            }}
          >
            <Bar className="h-7 w-7 shrink-0" />
            <Bar className={`h-4 ${w}`} />
          </div>
        ))}
      </div>
    );
  }

  // sheet-section: title bar + 4 lines of text
  return (
    <div
      className={`space-y-4 ${className}`}
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        padding: 24,
      }}
    >
      <div className="flex items-center gap-2.5">
        <Bar className="h-7 w-7" />
        <Bar className="h-4 w-32" />
      </div>
      <div className="space-y-2.5">
        <Bar className="h-3.5 w-full" />
        <Bar className="h-3.5 w-11/12" />
        <Bar className="h-3.5 w-4/5" />
        <Bar className="h-3.5 w-2/3" />
      </div>
    </div>
  );
};

export default SectionSkeleton;
