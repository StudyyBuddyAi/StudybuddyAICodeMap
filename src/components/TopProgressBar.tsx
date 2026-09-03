import { useEffect, useRef, useState } from "react";

/**
 * Global thin progress bar pinned to the top of the viewport.
 * Drive it from anywhere via startTopProgress() / finishTopProgress().
 * Mounted once in App.tsx.
 */

type Listener = (active: boolean) => void;

let listeners: Listener[] = [];
let activeCount = 0;

export function startTopProgress() {
  activeCount += 1;
  if (activeCount === 1) listeners.forEach((l) => l(true));
}

export function finishTopProgress() {
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount === 0) listeners.forEach((l) => l(false));
}

function subscribe(listener: Listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

const TopProgressBar = () => {
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const [fading, setFading] = useState(false);
  const creepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (creepTimer.current) clearInterval(creepTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      creepTimer.current = null;
      hideTimer.current = null;
      requestRef.current = null;
    };

    const unsub = subscribe((active) => {
      clearTimers();
      if (active) {
        setVisible(true);
        setFading(false);
        setWidth(0);
        // jump to 70% quickly, then creep toward 90%
        requestRef.current = requestAnimationFrame(() =>
          requestAnimationFrame(() => setWidth(70))
        );
        creepTimer.current = setInterval(() => {
          setWidth((w) => (w < 90 ? w + 2 : w));
        }, 800);
      } else {
        setWidth(100);
        setFading(true);
        hideTimer.current = setTimeout(() => {
          setVisible(false);
          setWidth(0);
          setFading(false);
        }, 350);
      }
    });

    return () => {
      unsub();
      clearTimers();
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[200] h-0.5 pointer-events-none"
      role="progressbar"
      aria-hidden="true"
    >
      <div
        className={`top-progress-bar h-full bg-primary ${fading ? "opacity-0" : "opacity-100"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
};

export default TopProgressBar;
