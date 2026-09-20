import { useEffect, useRef } from "react";
import { useThemeVersion } from "@/components/sheet-visual/visual-theme";

/**
 * The field behind the sheet.
 *
 * It is interactive rather than animated, and that distinction is the whole
 * design. Continuous ambient motion behind text is documented to raise
 * cognitive load and to make a page harder to read, so nothing here moves on
 * its own: every frame is a response to the reader's own pointer or scroll, and
 * the loop stops entirely the moment they settle. What it shows is information,
 * not decoration — the tone is the section being read, and the field inks in as
 * the sheet is worked through, so the gutters report position peripherally
 * while the rail reports it explicitly.
 */

interface StudyFieldBackgroundProps {
  /** CSS custom property holding the active section's tone, as `H S% L%`. */
  toneToken: string;
  /** 0..1 through the sheet. Drives how far the field is inked in. */
  progress: number;
  /** Draw the field, but never move it. */
  reducedMotion: boolean;
}

type Rgb = [number, number, number];

const SPACING = 30;
/** How far the pointer reaches. Beyond this, dots sit at their resting value. */
const LAMP_RADIUS = 190;
/** Distinct dot appearances. Each is one fillStyle and one Path2D fill. */
const BUCKETS = 7;

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lum - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Reads an `H S% L%` design token. Returns null when it isn't resolvable. */
function readToneRgb(token: string): Rgb | null {
  if (typeof window === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const parts = raw.match(/-?[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  return hslToRgb(Number(parts[0]), Number(parts[1]), Number(parts[2]));
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const rgba = ([r, g, b]: Rgb, alpha: number) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha.toFixed(3)})`;

/** Ease so the lamp has a soft edge instead of a visible circular boundary. */
const smoothstep = (t: number) => t * t * (3 - 2 * t);

const StudyFieldBackground = ({ toneToken, progress, reducedMotion }: StudyFieldBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeVersion = useThemeVersion();

  // Everything the draw loop reads lives in refs: prop changes nudge these and
  // kick the loop rather than re-running the effect and rebuilding listeners.
  const pointerTarget = useRef({ x: -1, y: -1, strength: 0 });
  const pointer = useRef({ x: -1, y: -1, strength: 0 });
  const toneTarget = useRef<Rgb>([13, 110, 110]);
  const tone = useRef<Rgb>([13, 110, 110]);
  const progressRef = useRef(progress);
  const reducedRef = useRef(reducedMotion);
  const frame = useRef<number | null>(null);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const dark = document.documentElement.classList.contains("dark");
    const ink: Rgb = dark ? [233, 228, 215] : [14, 17, 22];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const p = pointer.current;
      const toneRgb = tone.current;
      // A sheet part-read is a field part-inked. The range is deliberately
      // narrow: legible out of the corner of the eye, invisible as a texture.
      const base = (dark ? 0.05 : 0.042) + progressRef.current * (dark ? 0.045 : 0.04);
      const peak = base + (dark ? 0.2 : 0.17);

      // A wash under the dots, so the pointer reads as a lamp on paper rather
      // than as a ring of brighter dots.
      if (p.strength > 0.01) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, LAMP_RADIUS * 1.5);
        glow.addColorStop(0, rgba(toneRgb, 0.05 * p.strength));
        glow.addColorStop(1, rgba(toneRgb, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(p.x - LAMP_RADIUS * 1.5, p.y - LAMP_RADIUS * 1.5, LAMP_RADIUS * 3, LAMP_RADIUS * 3);
      }

      // Dots are bucketed by how lit they are so the whole field costs a
      // handful of fills instead of one per dot. At rest every dot falls in
      // bucket 0, which is a single fill for the entire screen.
      const paths = Array.from({ length: BUCKETS }, () => new Path2D());

      for (let y = SPACING / 2; y < height + SPACING; y += SPACING) {
        for (let x = SPACING / 2; x < width + SPACING; x += SPACING) {
          let lit = 0;
          if (p.strength > 0.01) {
            const dx = x - p.x;
            const dy = y - p.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < LAMP_RADIUS) {
              lit = smoothstep(1 - distance / LAMP_RADIUS) * p.strength;
            }
          }
          const bucket = Math.min(BUCKETS - 1, Math.round(lit * (BUCKETS - 1)));
          const t = bucket / (BUCKETS - 1);
          paths[bucket].moveTo(x + 1 + t * 1.5, y);
          paths[bucket].arc(x, y, 1 + t * 1.5, 0, Math.PI * 2);
        }
      }

      for (let bucket = 0; bucket < BUCKETS; bucket++) {
        const t = bucket / (BUCKETS - 1);
        // Even unlit, dots carry a third of the section's tone, so the tint is
        // there for a reader who never moves the pointer.
        ctx.fillStyle = rgba(mix(ink, toneRgb, 0.35 + t * 0.65), base + (peak - base) * t);
        ctx.fill(paths[bucket]);
      }
    };

    const step = () => {
      frame.current = null;
      const target = pointerTarget.current;
      const current = pointer.current;
      const ease = 0.16;

      current.strength += (target.strength - current.strength) * ease;
      // Jumping to the pointer on first entry avoids a dot trail sweeping in
      // from wherever it was last seen.
      if (current.x < 0 || current.strength < 0.02) {
        current.x = target.x;
        current.y = target.y;
      } else {
        current.x += (target.x - current.x) * ease;
        current.y += (target.y - current.y) * ease;
      }

      const toneNow = tone.current;
      const toneNext = toneTarget.current;
      for (let i = 0; i < 3; i++) toneNow[i] += (toneNext[i] - toneNow[i]) * 0.09;

      draw();

      const settled =
        Math.abs(target.strength - current.strength) < 0.005 &&
        Math.abs(target.x - current.x) < 0.6 &&
        Math.abs(target.y - current.y) < 0.6 &&
        Math.abs(toneNext[0] - toneNow[0]) < 0.6 &&
        Math.abs(toneNext[1] - toneNow[1]) < 0.6 &&
        Math.abs(toneNext[2] - toneNow[2]) < 0.6;

      // Settled means no frames at all until the reader does something again.
      if (!settled) frame.current = requestAnimationFrame(step);
    };

    wake.current = () => {
      if (reducedRef.current) {
        pointer.current = { x: -1, y: -1, strength: 0 };
        tone.current = [...toneTarget.current] as Rgb;
        draw();
        return;
      }
      if (frame.current === null) frame.current = requestAnimationFrame(step);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (reducedRef.current || e.pointerType === "touch") return;
      pointerTarget.current = { x: e.clientX, y: e.clientY, strength: 1 };
      wake.current();
    };

    const onPointerLeave = () => {
      pointerTarget.current.strength = 0;
      wake.current();
    };

    const onResize = () => {
      resize();
      wake.current();
    };

    resize();
    tone.current = [...toneTarget.current] as Rgb;
    draw();

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("blur", onPointerLeave);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      window.removeEventListener("resize", onResize);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    // Theme decides the ink colour and is baked into the closure, so a theme
    // flip rebuilds the loop.
  }, [themeVersion]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
    if (reducedMotion) pointerTarget.current.strength = 0;
    wake.current();
  }, [reducedMotion]);

  useEffect(() => {
    toneTarget.current = readToneRgb(toneToken) ?? toneTarget.current;
    wake.current();
  }, [toneToken, themeVersion]);

  useEffect(() => {
    progressRef.current = progress;
    wake.current();
  }, [progress]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-no-print
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
};

export default StudyFieldBackground;
