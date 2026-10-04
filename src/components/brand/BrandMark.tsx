import { memo, useId, useMemo, useRef, type CSSProperties } from "react";
import { useActiveBackdropScene } from "@/components/backdrop/backdrop-scene";
import {
  MARK_ASCENT,
  MARK_BRANCHES,
  MARK_NUCLEUS,
  MARK_ROUTES,
  MARK_RUNGS,
  MARK_SOMA,
  MARK_SOMA_BLEND,
  MARK_STRANDS,
  type MarkTone,
} from "./brandmark-geometry";
import { useMarkFiring, type MarkActivity } from "./brandmark-motion";
import "./brandmark.css";

/**
 * How heavily each variant is drawn. The full mark is the designer's; the
 * compact one thickens every stroke and drops the finest twigs and rungs so it
 * still reads as a helix becoming a neuron at nav size.
 */
const VARIANTS = {
  full: { weight: 1.18, bulb: 1.04, rung: 1.25, drop: new Set<string>(), dropRungs: new Set<number>() },
  compact: {
    weight: 1.75,
    bulb: 1.32,
    rung: 1.7,
    drop: new Set(["t-mid", "c-twig", "c-ct", "c-dt", "c-b1"]),
    dropRungs: new Set([0, 4, 5, 7]),
  },
} as const;

type Variant = keyof typeof VARIANTS;

export interface BrandMarkProps {
  /** Rendered size in px (or any CSS length). The mark is square. */
  size?: number | string;
  /** "auto" draws the compact mark below 48px and the full one above. */
  variant?: "auto" | Variant;
  /**
   * "auto" follows the app: firing often while a sheet generates, still while
   * the student answers questions, and resting otherwise.
   */
  activity?: "auto" | MarkActivity;
  /** Fire when the pointer enters or taps the mark (or its link). */
  interactive?: boolean;
  /** Accessible name. Leave out when the mark sits next to the wordmark. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const ids = (base: string) => {
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, "");
  return {
    teal: `sbm-${safe}-t`,
    copper: `sbm-${safe}-c`,
    soma: `sbm-${safe}-s`,
    haloTeal: `sbm-${safe}-ht`,
    haloCopper: `sbm-${safe}-hc`,
    spark: `sbm-${safe}-k`,
    rung: (i: number) => `sbm-${safe}-r${i}`,
  };
};

type Ids = ReturnType<typeof ids>;

const fillFor = (tone: MarkTone, id: Ids) =>
  tone === "teal" ? `url(#${id.teal})` : tone === "soma" ? `url(#${id.soma})` : `url(#${id.copper})`;

/** Teal tones glow cyan, everything else warm. */
const haloFor = (tone: MarkTone, id: Ids) => (tone === "teal" ? `url(#${id.haloTeal})` : `url(#${id.haloCopper})`);

const haloStroke = (tone: MarkTone) => (tone === "teal" ? "var(--sb-mark-halo-teal)" : "var(--sb-mark-halo-copper)");

/**
 * A signal: a soft glow in the strand's colour under a bright core, both one
 * short dash on a path normalised to length 1, parked before its start.
 */
function Spark({ spark, target, d, dash, width, glow }: { spark: string; target?: string; d: string; dash: number; width: number; glow: string }) {
  const common = { d, pathLength: 1, strokeDasharray: `${dash} 2`, strokeDashoffset: dash };
  return (
    <g data-spark={spark} data-for={target}>
      <path {...common} stroke={glow} strokeOpacity={0.55} strokeWidth={width * 2.6} />
      <path {...common} stroke="var(--sb-mark-spark)" strokeWidth={width} />
    </g>
  );
}

const stop = (offset: number | string, color: string, opacity?: number) => (
  <stop offset={offset} style={{ stopColor: color, stopOpacity: opacity }} />
);

const MarkArt = memo(function MarkArt({ variant, id }: { variant: Variant; id: Ids }) {
  const v = VARIANTS[variant];
  const branches = MARK_BRANCHES.filter((b) => !v.drop.has(b.id));
  const sparkW = (w: number) => Math.max(0.55, w * v.weight * 0.42);

  return (
    <>
      <defs>
        <linearGradient id={id.teal} gradientUnits="userSpaceOnUse" x1="0" y1="5" x2="0" y2="95">
          {stop(0, "var(--sb-mark-teal-hi)")}
          {stop(1, "var(--sb-mark-teal-lo)")}
        </linearGradient>
        <linearGradient id={id.copper} gradientUnits="userSpaceOnUse" x1="0" y1="7" x2="0" y2="98">
          {stop(0, "var(--sb-mark-copper-hi)")}
          {stop(1, "var(--sb-mark-copper-lo)")}
        </linearGradient>
        <linearGradient id={id.soma} gradientUnits="userSpaceOnUse" x1={MARK_SOMA_BLEND.x1} y1="0" x2={MARK_SOMA_BLEND.x2} y2="0">
          {stop(0, "var(--sb-mark-teal-mid)")}
          {stop(1, "var(--sb-mark-copper-mid)")}
        </linearGradient>
        <radialGradient id={id.haloTeal}>
          {stop(0, "var(--sb-mark-halo-teal)", 0.85)}
          {stop(0.45, "var(--sb-mark-halo-teal)", 0.28)}
          {stop(1, "var(--sb-mark-halo-teal)", 0)}
        </radialGradient>
        <radialGradient id={id.haloCopper}>
          {stop(0, "var(--sb-mark-halo-copper)", 0.85)}
          {stop(0.45, "var(--sb-mark-halo-copper)", 0.28)}
          {stop(1, "var(--sb-mark-halo-copper)", 0)}
        </radialGradient>
        <radialGradient id={id.spark}>
          {stop(0, "var(--sb-mark-spark)", 1)}
          {stop(0.55, "var(--sb-mark-spark)", 0.55)}
          {stop(1, "var(--sb-mark-spark)", 0)}
        </radialGradient>
        {MARK_RUNGS.map((r, i) =>
          r.tone === "mix" && !v.dropRungs.has(i) ? (
            <linearGradient key={i} id={id.rung(i)} gradientUnits="userSpaceOnUse" x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}>
              {stop(0.35, "var(--sb-mark-teal-mid)")}
              {stop(0.65, "var(--sb-mark-copper-mid)")}
            </linearGradient>
          ) : null,
        )}
      </defs>

      {/* The mark at rest. */}
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        {MARK_RUNGS.map((r, i) =>
          v.dropRungs.has(i) ? null : (
            <line
              key={i}
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              strokeWidth={r.w * v.rung}
              stroke={r.tone === "mix" ? `url(#${id.rung(i)})` : fillFor(r.tone, id)}
            />
          ),
        )}
        {MARK_STRANDS.map((s, i) => (
          <path key={i} d={s.d} fill={fillFor(s.tone, id)} stroke="none" />
        ))}
        <path d={MARK_SOMA} fill={`url(#${id.soma})`} fillRule="evenodd" stroke="none" />
        {branches.map((b) => (
          <path key={b.id} d={b.d} stroke={fillFor(b.tone, id)} strokeWidth={b.w * v.weight} />
        ))}
        {branches.map((b) =>
          b.bulb ? (
            <circle key={b.id} data-bulb={b.id} cx={b.bulb.cx} cy={b.bulb.cy} r={b.bulb.r * v.bulb} fill={fillFor(b.tone, id)} stroke="none" />
          ) : null,
        )}
      </g>

      {/* The signal: invisible until a fire animates it. */}
      <g className="sb-mark-signal" aria-hidden="true" strokeLinecap="round" fill="none">
        <path data-glow="soma" d={MARK_SOMA} fillRule="evenodd" fill="var(--sb-mark-spark)" stroke="none" />
        <circle data-glow="nucleus" cx={MARK_NUCLEUS.cx} cy={MARK_NUCLEUS.cy} r={MARK_NUCLEUS.r * 1.15} fill={`url(#${id.spark})`} stroke="none" />
        {branches.map((b) =>
          b.bulb ? (
            <circle
              key={b.id}
              data-halo={b.id}
              cx={b.bulb.cx}
              cy={b.bulb.cy}
              r={b.bulb.r * v.bulb * 2.5}
              fill={haloFor(b.tone, id)}
              stroke="none"
            />
          ) : null,
        )}
        {(["teal", "copper"] as const).map((tone) => (
          <Spark
            key={tone}
            spark={`ascent-${tone}`}
            d={MARK_ASCENT[tone]}
            dash={0.16}
            width={(variant === "compact" ? 2.6 : 1.9) * (tone === "teal" ? 1 : 0.85)}
            glow={haloStroke(tone)}
          />
        ))}
        {branches.map((b) =>
          b.bulb && MARK_ROUTES[b.id] ? (
            <Spark
              key={b.id}
              spark="route"
              target={b.id}
              d={MARK_ROUTES[b.id]}
              dash={0.24}
              width={sparkW(b.w)}
              glow={haloStroke(b.tone)}
            />
          ) : null,
        )}
      </g>
    </>
  );
});

const activityFor = (mode: string | undefined): MarkActivity =>
  mode === "generating" ? "busy" : mode === "focus" ? "still" : "idle";

/**
 * The StudyBuddy mark: a DNA helix rising into a neuron, which fires now and
 * then like one. Inline SVG, so it takes the theme and costs a few kilobytes;
 * see brandmark-motion for how and when it fires.
 */
export default function BrandMark({
  size = 32,
  variant = "auto",
  activity = "auto",
  interactive = true,
  label,
  className,
  style,
}: BrandMarkProps) {
  const ref = useRef<SVGSVGElement>(null);
  const rawId = useId();
  const id = useMemo(() => ids(rawId), [rawId]);
  const scene = useActiveBackdropScene();

  const resolved: Variant =
    variant !== "auto" ? variant : typeof size === "number" && size < 48 ? "compact" : "full";
  const rhythm: MarkActivity = activity === "auto" ? activityFor(scene?.mode) : activity;

  useMarkFiring(ref, rhythm, interactive);

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className ? `sb-mark ${className}` : "sb-mark"}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-variant={resolved}
    >
      <MarkArt variant={resolved} id={id} />
    </svg>
  );
}

