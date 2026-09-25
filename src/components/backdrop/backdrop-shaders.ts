/**
 * The two passes of the app backdrop, WebGL 1 so it runs wherever WebGL does.
 *
 * FIELD — a full-screen triangle drawn at a fraction of the screen's
 * resolution: a slow, domain-warped noise field rendered as a faint ink wash
 * with fine contour lines, like a topographic plot drifting on paper. Each page
 * gives it its own grain (how dense the lines, how large the shapes, which way
 * it drifts) and a second colour that pools in parts of it. Its shapes take
 * minutes to change; nothing in it moves fast enough to pull the eye off a
 * line of text.
 *
 * MOLECULE — one draw call of points. The vertex shader derives every point
 * from its index, in one of six structures, one per page: a torus knot for a
 * sheet, a cell, a crystal lattice, a seed head, a neuron, a climbing path.
 * A change of page carries each point from the old structure to the new one.
 * `uAssemble` blends each point from a loose scatter to its place, so a
 * structure can form as a sheet is written. Depth sets size and fade, so it
 * reads as a volume rather than a flat pattern.
 */

export const FIELD_VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** `derivatives` switches the contour lines on; without the extension there are none. */
export const fieldFragment = (derivatives: boolean) => `
${derivatives ? "#extension GL_OES_standard_derivatives : enable" : ""}
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform vec3 uTint;
uniform vec3 uTint2;       // the page's second colour
uniform float uTint2Amt;
uniform vec3 uInk;
uniform float uStrength;   // overall presence, 0..1
uniform float uContrast;   // theme scale: paper needs less than night
uniform vec2 uGlow;        // where the molecule sits, in uv
uniform float uGlowAmt;
uniform vec2 uFlow;        // how far the field has drifted, in its own units
uniform float uZoom;       // how large its shapes are
uniform float uDensity;    // contour lines per unit of height

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Centred, so a change of zoom between pages breathes from the middle.
  vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5) * uZoom + uFlow;

  float t = uTime * 0.012;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  float n = fbm(p + 1.7 * q + vec2(t * 0.6, -t * 0.4));

  float wash = smoothstep(0.42, 0.9, n);

  float line = 0.0;
  ${derivatives ? `
  float c = n * uDensity;
  float g = abs(fract(c + 0.5) - 0.5);
  float w = fwidth(c);
  line = 1.0 - smoothstep(0.0, w * 1.4, g);
  line *= smoothstep(0.3, 0.7, n);` : ""}

  vec2 dv = vec2((vUv.x - uGlow.x) * uAspect, vUv.y - uGlow.y);
  float glow = exp(-dot(dv, dv) * 2.6);

  float a = uStrength * uContrast * (wash * 0.075 + line * 0.068 + glow * uGlowAmt * 0.13);
  vec3 col = mix(uInk, uTint, 0.7 + 0.3 * wash);
  // The page's second colour pools in parts of the field, and around the molecule.
  col = mix(col, uTint2, uTint2Amt * (0.7 * smoothstep(0.45, 0.8, q.x) + 0.5 * glow * uGlowAmt));
  gl_FragColor = vec4(col * a, a);
}
`;

/** Which structures have a backbone worth drawing: the knot and the climbing path. */
export const SHAPE_LINED = [1, 0, 0, 0, 0, 1];

export const MOLECULE_VERTEX = `
precision highp float;
attribute float aIdx;
uniform float uN;
uniform float uTime;
uniform float uFold;       // the knot's turn for this topic
uniform float uP;
uniform float uQ;
uniform float uShapeA;     // the structure the points come from...
uniform float uShapeB;     // ...the one they go to...
uniform float uMorph;      // ...and how far along, 0..1
uniform float uAssemble;
uniform float uScale;      // size, in half-heights of the screen
uniform float uAspect;
uniform float uPx;         // device pixels per CSS pixel at render scale
uniform vec2 uCenter;      // clip-space position of the molecule
uniform float uTilt;
uniform float uSpin;
uniform float uLine;       // 1 for the backbone pass: the bare curve, no jitter, no halo
varying float vAlpha;
varying float vNode;
varying float vPulse;
// The fragment shader learns which pass it is from this, not from uLine:
// a uniform shared by both stages must match precision, and they differ.
varying float vLine;

const float TAU = 6.2831853;
const float GOLDEN = 2.39996323;

float h(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

// Whole-number division and remainder that survive a GPU's inexact divide.
float idiv(float a, float b) { return floor((a + 0.5) / b); }
float imod(float a, float b) { return a - b * idiv(a, b); }

vec3 sphere(float u, float v) {
  float th = u * TAU;
  float z = 2.0 * v - 1.0;
  float r = sqrt(1.0 - z * z);
  return vec3(r * cos(th), r * sin(th), z);
}

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

// Where point i sits in structure k, and what it is there: a node (a larger,
// brighter bead), lit by a travelling pulse, or faint (the loose halo); and
// how much it drifts in place — a crystal's bonds hold still, or they blur —
// and whether it is a membrane, which shows by its rim, like a bubble.
void shape(float k, float i, vec4 r, float t, out vec3 pos, out float node, out float pulse, out float faint, out float jit, out float rim) {
  float s = i / uN;
  float tight = 1.0 - uLine;
  vec3 halo = (1.2 + r.z * 0.35) * sphere(r.x, r.y);
  node = 0.0;
  pulse = 0.0;
  faint = 0.0;
  jit = 1.0;
  rim = 0.0;

  if (k < 0.5) {
    // A sheet: a torus knot, in the fold its topic gets.
    faint = step(0.92, r.w) * tight;
    float a = s * TAU;
    float rr = cos(uQ * a) + 2.0;
    vec3 c = rotY(uFold) * (vec3(rr * cos(uP * a), rr * sin(uP * a), -sin(uQ * a) * 1.25) * 0.34);
    pos = mix(c + (r.xyz - 0.5) * 0.07 * tight, halo, faint);
    node = step(0.94, r.y) * (1.0 - faint);
  } else if (k < 1.5) {
    // The dashboard: a cell — a membrane that breathes, studded with
    // receptors, a nucleus that glows, and a little cytoplasm between.
    if (s < 0.76) {
      float m = floor(uN * 0.76);
      float y = 1.0 - 2.0 * (i + 0.5) / m;
      float rad = sqrt(max(0.0, 1.0 - y * y));
      float th = i * GOLDEN;
      vec3 d = vec3(rad * cos(th), y, rad * sin(th));
      float breathe = 1.0 + 0.05 * sin(d.x * 3.1 + t * 0.5) * sin(d.y * 2.7 - t * 0.4) + 0.03 * sin(d.z * 4.0 + t * 0.33);
      pos = d * 0.86 * breathe;
      node = step(0.95, r.y);
      rim = 1.0;
    } else if (s < 0.92) {
      pos = vec3(0.18, 0.1, 0.06) + sphere(r.x, r.y) * 0.3 * (0.8 + 0.2 * r.z);
      node = step(0.88, r.z);
      pulse = 0.3 * (0.5 + 0.5 * sin(t * 0.8 + r.z * 2.0));
    } else {
      pos = sphere(r.x, r.y) * (0.42 + 0.32 * r.z);
      node = step(0.9, r.w);
      faint = 0.6;
    }
  } else if (k < 2.5) {
    // The question bank: a crystal — a 3×3×3 cell of atoms and the 54 bonds
    // between them, thirty points to a bond. Now and then an atom lights, and
    // a few bonds carry a signal across.
    jit = 0.3;
    if (i < 27.0) {
      vec3 g = vec3(imod(i, 3.0), imod(idiv(i, 3.0), 3.0), idiv(i, 9.0));
      pos = (g - 1.0) * 0.55;
      node = 1.0;
      pulse = smoothstep(0.985, 1.0, sin(t * 0.6 + r.x * 60.0));
    } else if (i < 1647.0) {
      float j = i - 27.0;
      float e = idiv(j, 30.0);
      float f = (imod(j, 30.0) + 1.0) / 31.0;
      float ax = idiv(e, 18.0);
      float b = imod(e, 18.0);
      vec3 g = vec3(imod(b, 2.0) + f, imod(idiv(b, 2.0), 3.0), idiv(b, 6.0));
      if (ax > 1.5) g = g.yzx;
      else if (ax > 0.5) g = g.zxy;
      pos = (g - 1.0) * 0.55;
      faint = 0.2;
      float he = h(e + 3.0);
      pulse = 0.6 * step(0.7, he) * smoothstep(0.1, 0.0, abs(f - fract(t * 0.25 + he * 5.0)));
    } else {
      pos = halo;
      faint = 1.0;
    }
  } else if (k < 3.5) {
    // The library: a seed head — thirteen arms curling out from the centre,
    // seeds strung along them, and a slow ripple running outward.
    float a = imod(i, 13.0);
    float u = (idiv(i, 13.0) + 0.5) / ceil(uN / 13.0);
    float rr = 0.1 + 0.95 * u;
    float th = a * TAU / 13.0 + 2.4 * u * u;
    float wave = sin(rr * 10.0 - t * 0.7);
    pos = vec3(rr * cos(th), (1.0 - rr * rr) * 0.34 - 0.12 + 0.035 * wave, rr * sin(th)) + (r.xyz - 0.5) * 0.03 * u;
    node = 1.0 - step(0.07, fract(u * 8.0 + a * 0.37));
    pulse = 0.5 * pow(max(wave, 0.0), 6.0);
  } else if (k < 4.5) {
    // Flashcards: a neuron — a soma, eight dendrites that fork, and a signal
    // running out along each, the way a memory fires.
    if (s < 0.12) {
      pos = sphere(r.x, r.y) * 0.2 * (0.75 + 0.25 * r.z);
      node = step(0.9, r.w);
      pulse = 0.25 + 0.25 * sin(t * 1.1);
    } else if (s < 0.95) {
      float u = (s - 0.12) / 0.83 * 8.0;
      float b = floor(u);
      float f = fract(u); // 0 at the soma, 1 at the tip
      float hb = h(b + 11.0);
      float y = 1.0 - 2.0 * (b + 0.5) / 8.0;
      float rad = sqrt(1.0 - y * y);
      float th = b * GOLDEN + hb;
      vec3 dir = vec3(rad * cos(th), y, rad * sin(th));
      vec3 side = normalize(cross(dir, abs(dir.y) > 0.8 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(dir, side);
      vec3 p = dir * (0.18 + f * (0.7 + 0.35 * hb)) + side * f * f * (hb - 0.5) * 0.6;
      // Past halfway it forks, and each point takes one of the two twigs.
      p += (up * (r.z < 0.5 ? 1.0 : -1.0) + side * 0.4) * max(0.0, f - 0.5) * 0.55;
      p += side * sin(t * 0.45 + b * 1.7) * 0.05 * f;
      pos = p + (r.xyz - 0.5) * 0.035 * (1.0 + f);
      node = step(0.975, f);
      pulse = smoothstep(0.07, 0.0, abs(f - fract(t * 0.16 + hb)));
    } else {
      pos = halo;
      faint = 1.0;
    }
  } else {
    // The roadmap: a path that winds upward and narrows, milestones along
    // it, and a light that climbs it.
    faint = step(0.94, r.w) * tight;
    float a = s * 3.5 * TAU;
    float rad = 0.8 - 0.45 * s;
    vec3 c = vec3(rad * cos(a), -0.85 + 1.7 * s, rad * sin(a));
    pos = mix(c + (r.xyz - 0.5) * 0.05 * tight, halo, faint);
    node = (1.0 - step(0.025, fract(s * 12.0))) * (1.0 - faint);
    pulse = smoothstep(0.045, 0.0, abs(s - fract(t * 0.05))) * (1.0 - faint);
  }
}

void main() {
  float i = aIdx;
  vec4 r = vec4(h(i), h(i + 0.37), h(i + 0.71), h(i + 0.13));
  float s = i / uN;

  vec3 pa;
  vec3 pb;
  float na, nb, ua, ub, fa, fb, ja, jb, ra, rb;
  shape(uShapeA, i, r, uTime, pa, na, ua, fa, ja, ra);
  shape(uShapeB, i, r, uTime, pb, nb, ub, fb, jb, rb);

  // A change of page carries each point from one structure to the next in a
  // wave along it: each lifts, turns a little and settles. The backbone pass
  // keeps neighbours in step, so its curve never scribbles.
  float e = clamp(uMorph * 1.6 - (s * 0.45 + r.w * 0.15 * (1.0 - uLine)), 0.0, 1.0);
  e = e * e * (3.0 - 2.0 * e);
  float lift = sin(3.14159265 * e);
  vec3 target = rotY(lift * 0.6) * mix(pa, pb, e) * (1.0 + 0.25 * lift);
  float node = mix(na, nb, e);
  float pulse = mix(ua, ub, e);
  float faint = mix(fa, fb, e);

  // Loose before it assembles; each point arrives on its own delay.
  vec3 scatter = sphere(r.x, r.y) * (2.0 + r.z * 0.6) + (vec3(r.z, r.x, r.y) - 0.5) * 1.4;
  float d = clamp(uAssemble * 1.6 - r.w * 0.6, 0.0, 1.0);
  d = d * d * (3.0 - 2.0 * d);
  vec3 pos = mix(scatter, target, mix(d, 1.0, uLine));

  pos += 0.018 * mix(ja, jb, e) * vec3(sin(uTime * 0.55 + r.x * 6.28), sin(uTime * 0.47 + r.y * 6.28), sin(uTime * 0.61 + r.z * 6.28));

  vec3 p = rotX(uTilt) * (rotY(uSpin) * pos);
  float zc = p.z + 3.2;
  vec2 proj = p.xy * (2.3 / zc) * uScale;
  gl_Position = vec4(uCenter + vec2(proj.x / uAspect, proj.y), 0.0, 1.0);

  gl_PointSize = uPx * (1.4 + 1.8 * r.x + 2.6 * node) * (1.0 + 0.6 * pulse) * mix(1.0, 0.8, faint)
    * (3.2 / zc) * (0.6 + 0.4 * uScale / 0.5);
  float fog = smoothstep(4.3, 2.3, zc);
  fog = pow(fog, 1.4);
  vAlpha = (0.12 + 0.88 * fog) * mix(1.0, 0.3, faint) * (0.5 + 0.5 * d);
  // A membrane is faint face-on and bright where it turns away, at its rim.
  float edge = 1.0 - abs(normalize(p + 1e-4).z);
  vAlpha *= mix(1.0, 0.3 + 1.6 * edge * edge, mix(ra, rb, e) * d);
  vNode = node;
  vPulse = pulse;
  vLine = uLine;
}
`;

export const MOLECULE_FRAGMENT = `
precision mediump float;
uniform vec3 uTint;
uniform vec3 uTint2;
uniform vec3 uInk;
uniform float uAlpha;
varying float vAlpha;
varying float vNode;
varying float vPulse;
varying float vLine;
void main() {
  float a;
  if (vLine > 0.5) {
    a = vAlpha * uAlpha;
  } else {
    float d = length(gl_PointCoord - 0.5);
    a = smoothstep(0.5, 0.05, d);
    a *= a * vAlpha * uAlpha * (1.0 + 1.2 * vPulse);
  }
  a = min(a, 1.0);
  // Ink and teal for the body; the page's second colour on its nodes and pulses.
  vec3 col = mix(mix(uInk, uTint, 0.72), uTint, vNode);
  col = mix(col, uTint2, clamp(vNode * 0.6 + vPulse * 0.8, 0.0, 1.0));
  gl_FragColor = vec4(col * a, a);
}
`;
