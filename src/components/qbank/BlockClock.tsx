import { useEffect, useRef, useState } from "react";
import { Clock, Timer } from "lucide-react";
import { formatClock } from "@/lib/qbank-answer";
import type { PlayMode } from "@/lib/qbank-types";

type Tone = "warn" | "urgent" | undefined;

const toneFor = (remaining: number | null): Tone =>
  remaining === null ? undefined : remaining < 60_000 ? "urgent" : remaining < 5 * 60_000 ? "warn" : undefined;

/**
 * The block clock, in the bottom bar as on the exam. Ticks on its own so the
 * rest of the player does not re-render every second. Timed mode counts down,
 * says so in words at five minutes and at one, and calls onTimeUp once at zero;
 * tutor mode counts up.
 */
const BlockClock = ({
  mode,
  getElapsedMs,
  getTimeRemainingMs,
  paused,
  hidden,
  compact,
  onTimeUp,
}: {
  mode: PlayMode;
  getElapsedMs: () => number;
  getTimeRemainingMs: () => number | null;
  paused: boolean;
  /** The student turned the clock off. Warnings still show. */
  hidden: boolean;
  /** Phone bar: the time without its label. */
  compact?: boolean;
  onTimeUp?: () => void;
}) => {
  const [, setTick] = useState(0);
  const firedRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = mode === "timed" ? getTimeRemainingMs() : null;
  const tone = toneFor(remaining);

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      onTimeUp?.();
    }
  });

  // Said once as each line is crossed, never on every tick.
  const lastTone = useRef<Tone>(tone);
  useEffect(() => {
    if (tone === lastTone.current) return;
    lastTone.current = tone;
    if (tone === "warn") setAnnouncement("Five minutes left in this block.");
    if (tone === "urgent") setAnnouncement("One minute left in this block.");
  }, [tone]);

  const label = mode === "timed" ? "Block time remaining" : "Time in block";
  const Icon = mode === "timed" ? Timer : Clock;
  const showTime = !hidden || tone !== undefined;

  return (
    <div className="qb-clock" data-tone={tone}>
      <Icon aria-hidden />
      {!compact && <span className="qb-clock-label">{label}</span>}
      {showTime ? (
        <span className="qb-clock-time" aria-label={compact ? `${label} ${formatClock(remaining ?? getElapsedMs())}` : undefined}>
          {formatClock(remaining ?? getElapsedMs())}
        </span>
      ) : (
        <span className="qb-clock-label">hidden</span>
      )}
      {tone && <span className="qb-clock-flag">{tone === "urgent" ? "Under 1 min" : "Under 5 min"}</span>}
      {paused && !compact && <span className="qb-clock-label">paused while the next question is written</span>}
      <span className="qb-sr" role="status">
        {announcement}
      </span>
    </div>
  );
};

export default BlockClock;
