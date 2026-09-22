import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";
import { scrollToSection, toneTokenFor, type AmbientFieldPreference } from "./reading-model";

/**
 * The rail beside the sheet.
 *
 * Narrowing the reading column to a readable measure frees a gutter, and this
 * is what earns it: a contents list that says where the reader is, how much is
 * left, and — while the sheet is still being written — which section is landing
 * next. It replaces the sticky hint strip that used to sit on top of every
 * sheet and push the first section down the page.
 */

export interface RailSection {
  key: string;
  /** Section name without its emoji — the rail has its own iconography. */
  label: string;
  icon: LucideIcon;
  state: "pending" | "writing" | "ready";
}

interface SheetRailProps {
  sections: RailSection[];
  activeKey: string | null;
  progress: number;
  field: AmbientFieldPreference;
}

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--fg-subtle)",
};

const HINT_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--fg-muted)",
};

const SheetRail = ({ sections, activeKey, progress, field }: SheetRailProps) => {
  const smooth = !field.reducedMotion;

  return (
    <nav
      aria-label="Sheet sections"
      data-no-print
      className="hidden lg:block sticky self-start"
      style={{ top: "calc(var(--nav-h, 64px) + 24px)" }}
    >
      <p style={{ ...LABEL_STYLE, margin: "0 0 12px 2px" }}>Contents</p>

      <div style={{ position: "relative", paddingLeft: 18 }}>
        {/* The track doubles as the progress bar: the accent portion is how far
            through the sheet the reader has come. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 4,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: 1,
            background: "hsl(var(--sb-border))",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 4,
            top: 6,
            height: `calc(${Math.round(progress * 100)}% - 12px)`,
            width: 2,
            borderRadius: 1,
            background: "hsl(var(--sb-accent))",
            opacity: 0.7,
            transition: field.reducedMotion ? undefined : "height 120ms linear",
          }}
        />

        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {sections.map(({ key, label, icon: Icon, state }) => {
            const isActive = key === activeKey;
            const tone = `hsl(var(${toneTokenFor(key)}))`;
            return (
              <li key={key} data-rail-section={key} data-state={state} style={{ position: "relative" }}>
                <span
                  aria-hidden="true"
                  className={state === "writing" ? "animate-pulse" : undefined}
                  style={{
                    position: "absolute",
                    left: -18,
                    top: 12,
                    width: 8,
                    height: 8,
                    marginLeft: 1,
                    borderRadius: "50%",
                    border: `1.5px solid ${state === "pending" ? "var(--border-strong)" : tone}`,
                    background: isActive ? tone : "var(--bg)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => scrollToSection(key, smooth)}
                  aria-current={isActive ? "true" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "5px 8px",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    background: isActive ? "var(--bg-elevated)" : "transparent",
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: "var(--font-sans)",
                    fontSize: 12.5,
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: "-0.003em",
                    color:
                      state === "pending"
                        ? "var(--fg-subtle)"
                        : isActive
                        ? "var(--fg)"
                        : "var(--fg-muted)",
                  }}
                >
                  <Icon
                    style={{
                      width: 13,
                      height: 13,
                      flexShrink: 0,
                      color: state === "pending" ? "var(--border-strong)" : tone,
                    }}
                  />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid hsl(var(--sb-border))",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <p style={{ ...HINT_STYLE, margin: 0, display: "flex", gap: 6 }}>
          <Sparkles style={{ width: 12, height: 12, flexShrink: 0, marginTop: 2, color: "hsl(var(--sb-accent))" }} />
          <span>Highlight any text to expand it or pull a clinical tie.</span>
        </p>

        <AmbientFieldToggle field={field} />
      </div>
    </nav>
  );
};

/**
 * Anyone can switch the field off, whatever their OS says. Motion behind text
 * is the one thing here that can make a page harder to study from, so it gets a
 * control rather than only a media query.
 */
const AmbientFieldToggle = ({ field }: { field: AmbientFieldPreference }) => (
  <button
    type="button"
    onClick={field.toggle}
    aria-pressed={field.enabled}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 2px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      ...HINT_STYLE,
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: 24,
        height: 14,
        flexShrink: 0,
        borderRadius: 7,
        border: "1px solid var(--border-strong)",
        background: field.enabled ? "hsl(var(--sb-accent))" : "var(--bg-panel)",
        position: "relative",
        transition: "background 160ms ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: field.enabled ? 12 : 2,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: field.enabled ? "var(--bg)" : "var(--fg-muted)",
          transition: "left 160ms ease",
        }}
      />
    </span>
    Ambient field
  </button>
);

/**
 * The rail's job on a phone, where there is no gutter to put it in: one line
 * that still answers "where am I" and "how much is left".
 */
export const SheetRailStrip = ({
  sections,
  activeKey,
  progress,
}: Pick<SheetRailProps, "sections" | "activeKey" | "progress">) => {
  const active = sections.find((s) => s.key === activeKey) ?? sections[0];
  const index = active ? sections.indexOf(active) + 1 : 0;

  return (
    <div
      data-no-print
      className="lg:hidden sticky animate-fade-in"
      style={{
        top: "var(--nav-h, 64px)",
        zIndex: 20,
        marginBottom: 12,
        borderRadius: "var(--radius-sm)",
        border: "1px solid hsl(var(--sb-border))",
        background: "color-mix(in srgb, var(--bg) 90%, transparent)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px" }}>
        {active && (
          <active.icon
            style={{ width: 13, height: 13, flexShrink: 0, color: `hsl(var(${toneTokenFor(active.key)}))` }}
          />
        )}
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--fg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {active?.label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            flexShrink: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.04em",
            color: "var(--fg-muted)",
          }}
        >
          {index}/{sections.length}
        </span>
      </div>
      <div aria-hidden="true" style={{ height: 2, background: "hsl(var(--sb-border))" }}>
        <div
          style={{
            height: 2,
            width: `${Math.round(progress * 100)}%`,
            background: "hsl(var(--sb-accent))",
            opacity: 0.8,
          }}
        />
      </div>
    </div>
  );
};

export default SheetRail;
