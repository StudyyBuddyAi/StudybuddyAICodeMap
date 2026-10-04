import { useEffect, type RefObject } from "react";

/**
 * How the mark fires.
 *
 * A fire is one action potential: a signal climbs both strands of the helix
 * into the cell body, the nucleus flashes, and the signal spreads out along a
 * handful of branches until their bulbs swell and glow. A twitch is the small
 * version — one or two branches flicker on their own — so the mark looks alive
 * between fires without ever repeating itself.
 *
 * Everything runs through the Web Animations API as one-shot animations, so
 * between fires the mark costs nothing: no running CSS loop, no rAF, no timer
 * faster than once every few seconds. Fires only happen while the mark is on
 * screen, the tab is visible, and the student hasn't asked for reduced motion.
 */

export type MarkActivity =
  /** Rare fires and twitches: the resting rhythm of a nav or header. */
  | "idle"
  /** Firing often: something is being made (a sheet generating, a loader). */
  | "busy"
  /** Never on its own; only hover, tap or an explicit pulse fire it. */
  | "still";

export type FireKind = "full" | "twitch";

const PULSE_EVENT = "sb:brandmark-pulse";

/** Fires every mark on screen, for moments worth marking (a correct answer, a finished sheet). */
export function pulseBrandMark(kind: FireKind = "full") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FireKind>(PULSE_EVENT, { detail: kind }));
}

/** Gap before the next fire, in ms, by activity. */
const GAPS: Record<Exclude<MarkActivity, "still">, [number, number]> = {
  idle: [7000, 14000],
  busy: [900, 1900],
};
/** The first idle fire comes soon after load, so the mark announces it's alive. */
const FIRST_IDLE: [number, number] = [1400, 2800];
/** Share of idle fires that are twitches instead of full fires. */
const TWITCH_SHARE = 0.4;

const ASCENT_MS = 640;
const ASCENT_DASH = 0.16;
const ROUTE_DASH = 0.24;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: T[], count: number) => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
};

interface MarkState {
  running: Set<Animation>;
  busyUntil: number;
}

const states = new WeakMap<SVGSVGElement, MarkState>();
const stateOf = (svg: SVGSVGElement) => {
  let s = states.get(svg);
  if (!s) {
    s = { running: new Set(), busyUntil: 0 };
    states.set(svg, s);
  }
  return s;
};

const canAnimate = () => typeof Element !== "undefined" && "animate" in Element.prototype;

function run(state: MarkState, el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  if (!el) return;
  const a = el.animate(keyframes, { fill: "none", ...options });
  state.running.add(a);
  const done = () => state.running.delete(a);
  a.onfinish = done;
  a.oncancel = done;
}

/**
 * One signal along a route: the dash travels from start to end and fades at
 * both ends. A spark is a group of a soft glow under a bright core; both move.
 */
function travel(state: MarkState, spark: Element | null, dash: number, delay: number, duration: number, easing: string) {
  if (!spark) return;
  const strokes = spark.tagName.toLowerCase() === "g" ? Array.from(spark.children) : [spark];
  for (const path of strokes) run(
    state,
    path,
    [
      { strokeDashoffset: dash, opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.12 },
      { opacity: 1, offset: 0.82 },
      { strokeDashoffset: -1, opacity: 0, offset: 1 },
    ],
    { delay, duration, easing },
  );
}

/** A bulb receiving the signal: it swells, its halo blooms. */
function land(state: MarkState, svg: SVGSVGElement, id: string, delay: number) {
  run(
    state,
    svg.querySelector(`[data-bulb="${id}"]`),
    [
      { transform: "scale(1)" },
      { transform: "scale(1.3)", offset: 0.3 },
      { transform: "scale(1)" },
    ],
    { delay, duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" },
  );
  run(
    state,
    svg.querySelector(`[data-halo="${id}"]`),
    [
      { opacity: 0, transform: "scale(.55)" },
      { opacity: 0.9, transform: "scale(1)", offset: 0.28 },
      { opacity: 0, transform: "scale(1.15)" },
    ],
    { delay, duration: 640, easing: "ease-out" },
  );
}

/** Fires the mark once. Returns false if it was already firing. */
export function fireMark(svg: SVGSVGElement, kind: FireKind = "full"): boolean {
  if (!canAnimate()) return false;
  const state = stateOf(svg);
  const now = performance.now();
  if (now < state.busyUntil) return false;

  const routes = Array.from(svg.querySelectorAll<SVGGElement>('[data-spark="route"]'));
  if (!routes.length) return false;

  if (kind === "twitch") {
    let end = 0;
    pick(routes, Math.random() < 0.5 ? 1 : 2).forEach((route, i) => {
      const delay = i * rand(90, 220);
      const duration = rand(360, 460);
      travel(state, route, ROUTE_DASH, delay, duration, "cubic-bezier(.3,.6,.4,1)");
      land(state, svg, route.dataset.for ?? "", delay + duration * 0.86);
      end = Math.max(end, delay + duration + 640);
    });
    state.busyUntil = now + end;
    return true;
  }

  // Up both strands; the copper one a beat behind, as if the helix unwinds.
  travel(state, svg.querySelector('[data-spark="ascent-teal"]'), ASCENT_DASH, 0, ASCENT_MS, "cubic-bezier(.55,0,.75,.9)");
  travel(state, svg.querySelector('[data-spark="ascent-copper"]'), ASCENT_DASH, 70, ASCENT_MS - 60, "cubic-bezier(.55,0,.75,.9)");

  // The cell body takes the charge and the nucleus lights.
  const reach = ASCENT_MS - 90;
  run(state, svg.querySelector('[data-glow="soma"]'), [{ opacity: 0 }, { opacity: 0.36, offset: 0.35 }, { opacity: 0 }], {
    delay: reach,
    duration: 560,
    easing: "ease-out",
  });
  run(
    state,
    svg.querySelector('[data-glow="nucleus"]'),
    [
      { opacity: 0, transform: "scale(.4)" },
      { opacity: 1, transform: "scale(1)", offset: 0.3 },
      { opacity: 0, transform: "scale(1.1)" },
    ],
    { delay: reach, duration: 680, easing: "ease-out" },
  );

  // Then out along most of the branches, never quite the same ones twice.
  const count = Math.max(4, Math.round(routes.length * rand(0.55, 0.85)));
  let end = reach + 680;
  pick(routes, count).forEach((route) => {
    const delay = reach + 40 + rand(0, 170);
    const duration = rand(400, 540);
    travel(state, route, ROUTE_DASH, delay, duration, "cubic-bezier(.25,.6,.35,1)");
    land(state, svg, route.dataset.for ?? "", delay + duration * 0.86);
    end = Math.max(end, delay + duration + 640);
  });
  state.busyUntil = now + end;
  return true;
}

/** Stops whatever is in flight, leaving the mark at rest. */
export function settleMark(svg: SVGSVGElement) {
  const state = states.get(svg);
  if (!state) return;
  state.running.forEach((a) => a.cancel());
  state.running.clear();
  state.busyUntil = 0;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Keeps a mark firing on its own rhythm and answering pulses and the pointer.
 * Returns nothing; the mark's element does the rest.
 */
export function useMarkFiring(ref: RefObject<SVGSVGElement>, activity: MarkActivity, interactive: boolean) {
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !canAnimate()) return;

    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reduced = prefersReducedMotion();
    let visible = true;
    let timer: number | undefined;
    let lastPointerFire = 0;

    const ready = () => !reduced && visible && document.visibilityState === "visible";

    const schedule = (first = false) => {
      window.clearTimeout(timer);
      if (activity === "still" || reduced) return;
      const [min, max] = first && activity === "idle" ? FIRST_IDLE : first ? [250, 600] : GAPS[activity];
      timer = window.setTimeout(tick, rand(min, max));
    };
    const tick = () => {
      if (ready()) fireMark(svg, activity === "idle" && Math.random() < TWITCH_SHARE ? "twitch" : "full");
      schedule();
    };

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (!visible) settleMark(svg);
          })
        : null;
    io?.observe(svg);

    const onMotionChange = () => {
      reduced = prefersReducedMotion();
      if (reduced) settleMark(svg);
      schedule();
    };
    motionQuery?.addEventListener?.("change", onMotionChange);

    const onPulse = (e: Event) => {
      if (ready()) fireMark(svg, (e as CustomEvent<FireKind>).detail ?? "full");
    };
    window.addEventListener(PULSE_EVENT, onPulse);

    const onPointer = () => {
      const now = performance.now();
      if (!ready() || now - lastPointerFire < 1200) return;
      if (fireMark(svg, "full")) lastPointerFire = now;
    };
    // Hovering anywhere on the brand link or button fires it, not only the glyph.
    const target: Element = (interactive && svg.closest("a, button")) || svg;
    if (interactive) {
      target.addEventListener("pointerenter", onPointer);
      target.addEventListener("pointerdown", onPointer);
    }

    schedule(true);

    // A change of rhythm lets a fire in flight finish: the pulse for a sheet
    // that just finished lands in the same render that ends "busy".
    return () => {
      window.clearTimeout(timer);
      io?.disconnect();
      motionQuery?.removeEventListener?.("change", onMotionChange);
      window.removeEventListener(PULSE_EVENT, onPulse);
      target.removeEventListener("pointerenter", onPointer);
      target.removeEventListener("pointerdown", onPointer);
    };
  }, [ref, activity, interactive]);

  useEffect(() => {
    const svg = ref.current;
    return () => {
      if (svg) settleMark(svg);
    };
  }, [ref]);
}
