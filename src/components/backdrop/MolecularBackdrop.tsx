import { useEffect, useRef, useState } from "react";
import { FIELD_VERTEX, MOLECULE_FRAGMENT, MOLECULE_VERTEX, SHAPE_LINED, fieldFragment } from "./backdrop-shaders";
import type { BackdropMode, BackdropScene, BackdropVariant } from "./backdrop-scene";

/** Points in the molecule: one draw call for the beads, one for the backbone through them. */
const POINTS = 1800;
/** The drawing buffer never exceeds this, however large or dense the screen. */
const MAX_PIXELS = 900_000;
/** Frames per second by what the page is doing: least while the student reads or answers. */
const FPS: Record<BackdropMode, number> = { compose: 24, generating: 30, reading: 15, ambient: 20, focus: 12 };
/** While one page's structure turns into the next, and a moment after, it draws at this rate. */
const TRANSITION_FPS = 30;
const TRANSITION_MS = 2400;
/** Seconds for one structure to become another. */
const MORPH_S = 1.8;
/** Past this much scrolling the student is in the page's content, and the emblem steps back. */
const SCROLLED_PX = 140;

/** Four folds, from the simplest knot up. A topic always gets the same one. */
const FOLDS: [number, number][] = [
  [2, 3],
  [3, 4],
  [2, 5],
  [3, 5],
];

const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

interface Character {
  /** The structure, by its index in the vertex shader. */
  shape: number;
  /** The second colour, on paper and at night. */
  tint2: [string, string];
  tint2Amt: number;
  /** Field grain: contour lines per unit, size of its shapes, drift per second. */
  density: number;
  zoom: number;
  flow: [number, number];
  /** How the structure is held and how fast it turns. */
  tilt: number;
  spin: number;
  /** Its place in the empty space beside the page's heading, on a desktop. */
  hero: { cx: number; cy: number; scale: number };
}

/**
 * Each part of the app, told apart. The places are the open space to the right
 * of each page's heading — on the dashboard, between the heading and the
 * session card.
 */
const CHARACTER: Record<BackdropVariant, Character> = {
  sheets: {
    shape: 0, tint2: ["var(--accent)", "var(--accent)"], tint2Amt: 0,
    density: 16, zoom: 1.35, flow: [0, 0], tilt: 0.5, spin: 0.05,
    hero: { cx: 0.62, cy: 0.64, scale: 0.3 },
  },
  dashboard: {
    shape: 1, tint2: ["hsl(var(--warning))", "hsl(var(--warning))"], tint2Amt: 0.35,
    density: 13, zoom: 1.2, flow: [0.004, 0.003], tilt: 0.25, spin: 0.035,
    hero: { cx: 0.25, cy: 0.62, scale: 0.33 },
  },
  qbank: {
    shape: 2, tint2: ["var(--fg)", "var(--fg)"], tint2Amt: 0.3,
    density: 21, zoom: 1.3, flow: [0, -0.004], tilt: -0.62, spin: 0.04,
    hero: { cx: 0.6, cy: 0.62, scale: 0.32 },
  },
  library: {
    shape: 3, tint2: ["hsl(var(--success))", "hsl(var(--success))"], tint2Amt: 0.35,
    density: 14, zoom: 1.6, flow: [0.005, 0], tilt: -1.05, spin: 0.06,
    hero: { cx: 0.62, cy: 0.63, scale: 0.34 },
  },
  flashcards: {
    shape: 4, tint2: ["hsl(var(--info))", "hsl(var(--info))"], tint2Amt: 0.35,
    density: 18, zoom: 1.5, flow: [-0.004, 0.002], tilt: 0.35, spin: 0.045,
    hero: { cx: 0.6, cy: 0.62, scale: 0.3 },
  },
  roadmap: {
    shape: 5, tint2: ["hsl(205 65% 38%)", "hsl(205 70% 68%)"], tint2Amt: 0.35,
    density: 11, zoom: 1.25, flow: [0, 0.006], tilt: -0.3, spin: 0.07,
    hero: { cx: 0.62, cy: 0.6, scale: 0.28 },
  },
};

interface Look {
  /** Clip-space centre of the molecule. */
  cx: number;
  cy: number;
  /** Size, in half-heights of the screen. */
  scale: number;
  /** Molecule opacity. */
  alpha: number;
  /** Field presence. */
  strength: number;
  glow: number;
}

/**
 * Where the molecule sits and how present everything is, per scene.
 *
 * Composing a sheet it has the right margin to itself. Writing and reading a
 * sheet it waits in the empty lower-right margin, beside the contents rail and
 * clear of the text. Elsewhere in the app it is the page's emblem, in the open
 * space beside the heading; once the student scrolls into the content it
 * fades back so it never sits behind what they are reading. While a question
 * or a card is being answered it leaves entirely and the field all but stops.
 * Below desktop width every margin is text: on a tablet it keeps a corner
 * while composing, and on a phone it never appears.
 */
function lookFor(mode: BackdropMode, variant: BackdropVariant, w: number, scrolled: boolean): Look {
  const hidden = (strength: number): Look => ({ cx: 0.8, cy: -0.5, scale: 0.3, alpha: 0, strength, glow: 0 });
  if (mode === "focus") return hidden(0.4);
  if (w >= 1180) {
    if (mode === "compose") return { cx: 0.76, cy: 0.02, scale: 0.55, alpha: 1, strength: 1.05, glow: 1 };
    if (mode === "ambient") {
      const { cx, cy, scale } = CHARACTER[variant].hero;
      return scrolled
        ? { cx, cy, scale, alpha: 0.2, strength: 0.9, glow: 0.15 }
        : { cx, cy, scale, alpha: 0.85, strength: 1, glow: 0.7 };
    }
    const reading = mode === "reading";
    return { cx: 0.8, cy: -0.5, scale: 0.4, alpha: reading ? 0.65 : 1, strength: reading ? 0.8 : 0.95, glow: reading ? 0.55 : 0.85 };
  }
  if (w >= 768 && mode === "compose") {
    return { cx: 0.7, cy: 0.66, scale: 0.26, alpha: 0.7, strength: 0.95, glow: 0.5 };
  }
  return hidden(mode === "compose" || mode === "ambient" ? 0.9 : 0.6);
}

/** A CSS colour as 0..1 RGB, resolved through the element so theme variables apply. */
function probe(host: HTMLElement, css: string): [number, number, number] {
  const el = document.createElement("span");
  el.style.color = css;
  el.style.display = "none";
  host.appendChild(el);
  const m = getComputedStyle(el).color.match(/[\d.]+/g) ?? ["0", "0", "0"];
  el.remove();
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

type Props = BackdropScene & { variant: BackdropVariant };

/**
 * The app's living backdrop: a slow ink field on the page, and a molecule —
 * each part of the app its own — that forms as a sheet is written and
 * otherwise keeps to the open space beside a page's heading. Moving between
 * pages, the field regrains and recolours and the molecule turns into the next
 * page's structure, all eased, so the app reads as one continuous surface.
 *
 * Decoration only, and priced like it: a lazily loaded chunk, one WebGL
 * context, three draw calls, a capped drawing buffer, 12–30fps by scene (30
 * only for the couple of seconds a page change takes), nothing drawn in a
 * hidden tab, one still frame under reduced motion, and nothing at all without
 * WebGL. It sits behind the content and never takes input.
 */
const MolecularBackdrop = ({ mode, progress = 0, seed = "", variant }: Props) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Read by the render loop without restarting it.
  const live = useRef({ mode, progress, seed, variant });
  live.current = { mode, progress, seed, variant };
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.appendChild(canvas);

    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false });
    if (!gl) {
      canvas.remove();
      setFailed(true);
      return;
    }
    const derivatives = !!gl.getExtension("OES_standard_derivatives");

    const build = (vs: string, fs: string) => {
      const program = gl.createProgram()!;
      for (const [type, src] of [
        [gl.VERTEX_SHADER, vs],
        [gl.FRAGMENT_SHADER, fs],
      ] as const) {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        gl.attachShader(program, s);
      }
      gl.linkProgram(program);
      return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
    };
    const field = build(FIELD_VERTEX, fieldFragment(derivatives));
    const molecule = build(MOLECULE_VERTEX, MOLECULE_FRAGMENT);
    if (!field || !molecule) {
      canvas.remove();
      setFailed(true);
      return;
    }

    const triangle = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const indices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, indices);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from({ length: POINTS }, (_, i) => i), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(field, "aPos");
    const aIdx = gl.getAttribLocation(molecule, "aIdx");

    const fu = (n: string) => gl.getUniformLocation(field, n);
    const mu = (n: string) => gl.getUniformLocation(molecule, n);
    const F = {
      time: fu("uTime"), aspect: fu("uAspect"), tint: fu("uTint"), tint2: fu("uTint2"), tint2Amt: fu("uTint2Amt"),
      ink: fu("uInk"), strength: fu("uStrength"), contrast: fu("uContrast"), glow: fu("uGlow"), glowAmt: fu("uGlowAmt"),
      flow: fu("uFlow"), zoom: fu("uZoom"), density: fu("uDensity"),
    };
    const M = {
      n: mu("uN"), time: mu("uTime"), fold: mu("uFold"), p: mu("uP"), q: mu("uQ"),
      shapeA: mu("uShapeA"), shapeB: mu("uShapeB"), morph: mu("uMorph"), assemble: mu("uAssemble"),
      scale: mu("uScale"), aspect: mu("uAspect"), px: mu("uPx"), center: mu("uCenter"), tilt: mu("uTilt"),
      spin: mu("uSpin"), tint: mu("uTint"), tint2: mu("uTint2"), ink: mu("uInk"), alpha: mu("uAlpha"), line: mu("uLine"),
    };

    // The fold a topic gets. A new topic does not rebuild anything: the
    // molecule fades, takes the new fold, and gathers again.
    let foldSeed = live.current.seed;
    const foldFor = (s: string) => {
      const hash = hashString(s);
      return { pq: FOLDS[hash % FOLDS.length], angle: ((hash >>> 8) % 628) / 100 };
    };
    let fold = foldFor(foldSeed);

    // Theme colours, re-read when the theme changes. The page's second colour
    // is resolved per page and theme, and cached.
    let tint: [number, number, number] = [0, 0.43, 0.43];
    let ink: [number, number, number] = [0.05, 0.07, 0.09];
    let dark = false;
    let tint2Cache: Partial<Record<BackdropVariant, [number, number, number]>> = {};
    const readTheme = () => {
      tint = probe(host, "var(--accent)");
      ink = probe(host, "var(--fg)");
      dark = document.documentElement.classList.contains("dark");
      tint2Cache = {};
    };
    const tint2For = (v: BackdropVariant) => (tint2Cache[v] ??= probe(host, CHARACTER[v].tint2[dark ? 1 : 0]));
    readTheme();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    // Scrolled into the content or not — a state the emblem eases between,
    // not a gesture it follows.
    let scrolled = window.scrollY > SCROLLED_PX;
    const onScroll = () => {
      const now = window.scrollY > SCROLLED_PX;
      if (now === scrolled) return;
      scrolled = now;
      if (reduce) still();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    let w = 0;
    let h = 0;
    let px = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);
      let cw = Math.round(window.innerWidth * dpr);
      let ch = Math.round(window.innerHeight * dpr);
      const over = Math.sqrt((cw * ch) / MAX_PIXELS);
      if (over > 1) {
        cw = Math.round(cw / over);
        ch = Math.round(ch / over);
      }
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        gl.viewport(0, 0, cw, ch);
      }
      w = window.innerWidth;
      h = window.innerHeight;
      px = cw / w;
    };

    // Everything eases toward the current page and scene, so a change of
    // either is a slow drift rather than a cut. The molecule starts loose and
    // gathers.
    const first = CHARACTER[live.current.variant];
    const cur = {
      ...lookFor(live.current.mode, live.current.variant, window.innerWidth, scrolled),
      alpha: 0,
      assemble: reduce ? 1 : 0,
      tilt: first.tilt,
      spinRate: first.spin,
      density: first.density,
      zoom: first.zoom,
      flowX: first.flow[0],
      flowY: first.flow[1],
      tint2Amt: first.tint2Amt,
    };
    let tint2Now = [...tint2For(live.current.variant)] as [number, number, number];
    let spin = hashString(live.current.variant) % 7; // the first page does not always face the same way
    const flow = [0, 0];

    // The morph: points go from structure A to B as `morph` runs 0 → 1. A
    // change of page mid-way back to A reverses it; to a third page, it
    // finishes this one first.
    let shapeA = first.shape;
    let shapeB = first.shape;
    let morph = 1;
    let heading = 1;

    let seen = { variant: live.current.variant, mode: live.current.mode, scrolled };
    let busyUntil = 0;
    let prevMs = 0;

    const draw = (ms: number, settle = false) => {
      resize();
      const { mode: m, progress: prog, seed: wantSeed, variant: v } = live.current;
      const ch = CHARACTER[v];
      if (v !== seen.variant || m !== seen.mode || scrolled !== seen.scrolled) {
        seen = { variant: v, mode: m, scrolled };
        busyUntil = performance.now() + TRANSITION_MS;
      }

      const dt = prevMs ? Math.min(ms - prevMs, 100) / 1000 : 0;
      prevMs = ms;

      // Which structure, and how far between two.
      const want = ch.shape;
      if (settle) {
        shapeA = shapeB = want;
        morph = heading = 1;
      } else {
        if (morph >= 1 && want !== shapeB) {
          shapeA = shapeB;
          shapeB = want;
          morph = 0;
        } else if (morph <= 0 && want !== shapeA) {
          shapeB = want;
        }
        if (want === shapeA && morph < 1) heading = 0;
        else if (want === shapeB) heading = 1;
        morph = Math.max(0, Math.min(1, morph + (heading ? dt : -dt) / MORPH_S));
      }

      const target = lookFor(m, v, w, scrolled);
      if (wantSeed !== foldSeed) {
        // The knot takes a topic's fold. Out of sight it simply changes; in
        // sight on the sheets page it fades, changes and gathers again; and
        // leaving the sheets it keeps its fold until it has gone.
        const knotShown = (shapeB === 0 && morph > 0) || (shapeA === 0 && morph < 1);
        if (settle || !knotShown || cur.alpha < 0.02) {
          foldSeed = wantSeed;
          fold = foldFor(foldSeed);
          if (knotShown) cur.assemble = settle ? 1 : 0;
        } else if (v === "sheets") {
          target.alpha = 0;
        }
      }

      const assemble = m === "generating" ? 0.12 + 0.88 * Math.max(0, Math.min(1, prog)) : 1;
      const k = settle ? 1 : 1 - Math.exp(-dt * 1.6);
      const ka = settle ? 1 : 1 - Math.exp(-dt * 0.9);
      const kf = settle ? 1 : 1 - Math.exp(-dt * 1.2);
      for (const key of ["cx", "cy", "scale", "alpha", "strength", "glow"] as const) {
        cur[key] += (target[key] - cur[key]) * k;
      }
      cur.assemble += (assemble - cur.assemble) * ka;
      cur.tilt += (ch.tilt - cur.tilt) * kf;
      cur.spinRate += (ch.spin - cur.spinRate) * kf;
      cur.density += (ch.density - cur.density) * kf;
      cur.zoom += (ch.zoom - cur.zoom) * kf;
      cur.flowX += (ch.flow[0] - cur.flowX) * kf;
      cur.flowY += (ch.flow[1] - cur.flowY) * kf;
      cur.tint2Amt += (ch.tint2Amt - cur.tint2Amt) * kf;
      const tint2 = tint2For(v);
      tint2Now = tint2Now.map((c, i) => c + (tint2[i] - c) * kf) as [number, number, number];
      spin += cur.spinRate * dt;
      flow[0] += cur.flowX * dt;
      flow[1] += cur.flowY * dt;

      const t = reduce ? 20 : ms / 1000;
      const aspect = w / h;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(field);
      gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(F.time, t);
      gl.uniform1f(F.aspect, aspect);
      gl.uniform3fv(F.tint, tint);
      gl.uniform3fv(F.tint2, tint2Now);
      gl.uniform1f(F.tint2Amt, cur.tint2Amt);
      gl.uniform3fv(F.ink, ink);
      gl.uniform1f(F.strength, cur.strength);
      gl.uniform1f(F.contrast, dark ? 1.35 : 1);
      gl.uniform2f(F.glow, cur.cx * 0.5 + 0.5, cur.cy * 0.5 + 0.5);
      gl.uniform1f(F.glowAmt, cur.glow * Math.min(1, cur.alpha * 1.4));
      gl.uniform2f(F.flow, flow[0], flow[1]);
      gl.uniform1f(F.zoom, cur.zoom);
      gl.uniform1f(F.density, cur.density);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(aPos);

      if (cur.alpha > 0.01) {
        gl.useProgram(molecule);
        gl.bindBuffer(gl.ARRAY_BUFFER, indices);
        gl.enableVertexAttribArray(aIdx);
        gl.vertexAttribPointer(aIdx, 1, gl.FLOAT, false, 0, 0);
        gl.uniform1f(M.n, POINTS);
        gl.uniform1f(M.time, t);
        gl.uniform1f(M.fold, fold.angle);
        gl.uniform1f(M.p, fold.pq[0]);
        gl.uniform1f(M.q, fold.pq[1]);
        gl.uniform1f(M.shapeA, shapeA);
        gl.uniform1f(M.shapeB, shapeB);
        gl.uniform1f(M.morph, morph);
        gl.uniform1f(M.assemble, cur.assemble);
        gl.uniform1f(M.scale, cur.scale);
        gl.uniform1f(M.aspect, aspect);
        gl.uniform1f(M.px, px);
        gl.uniform2f(M.center, cur.cx, cur.cy);
        gl.uniform1f(M.tilt, cur.tilt);
        gl.uniform1f(M.spin, spin);
        gl.uniform3fv(M.tint, tint);
        gl.uniform3fv(M.tint2, tint2Now);
        gl.uniform3fv(M.ink, ink);
        // The backbone first, under the beads: the bare curve that gives a
        // knot or a path its shape. It shows only once the structure has
        // gathered, and fades through a change of page — drawn through
        // scattered or travelling points it would be a scribble.
        const formed = cur.assemble * cur.assemble * cur.assemble;
        const lined = SHAPE_LINED[shapeA] * (1 - morph) ** 3 + SHAPE_LINED[shapeB] * morph ** 3;
        if (formed * lined > 0.02) {
          gl.uniform1f(M.line, 1);
          gl.uniform1f(M.alpha, cur.alpha * formed * lined * (dark ? 0.32 : 0.22));
          gl.drawArrays(gl.LINE_STRIP, 0, POINTS);
        }
        gl.uniform1f(M.line, 0);
        gl.uniform1f(M.alpha, cur.alpha);
        gl.drawArrays(gl.POINTS, 0, POINTS);
        gl.disableVertexAttribArray(aIdx);
      }
    };

    let raf = 0;
    let last = 0;
    const loop = (ms: number) => {
      raf = 0;
      if (document.hidden) return; // resumed by visibilitychange
      raf = requestAnimationFrame(loop);
      const moving = performance.now() < busyUntil || (morph > 0 && morph < 1);
      if (ms - last < 1000 / (moving ? TRANSITION_FPS : FPS[live.current.mode])) return;
      last = ms;
      draw(ms);
    };
    const start = () => {
      if (reduce || raf || document.hidden) return;
      prevMs = 0; // no jump after a pause
      raf = requestAnimationFrame(loop);
    };

    // Reduced motion: one still frame, redrawn only when something it shows changes.
    const still = () => draw(0, true);
    redrawRef.current = reduce ? still : () => {};
    const onVisible = () => start();
    const onResize = () => (reduce ? still() : undefined);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("resize", onResize);
    const themeWatch = new MutationObserver(() => {
      readTheme();
      if (reduce) still();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    if (reduce) still();
    else start();

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      raf = -1; // nothing restarts it
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      themeWatch.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  // Under reduced motion the still frame follows the scene and the page.
  useEffect(() => redrawRef.current(), [mode, progress, seed, variant]);

  if (failed) return null;
  return <div ref={hostRef} className="absolute inset-0" />;
};

export default MolecularBackdrop;
