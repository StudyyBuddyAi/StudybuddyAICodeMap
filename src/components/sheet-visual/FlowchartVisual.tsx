import { useEffect, useId, useState } from "react";
import type { VisualFlowchartSpec } from "@/types/generated-sheet";
import { flowchartToMermaid } from "@/lib/sheet-visual-mermaid";
import { readVisualTheme, useThemeVersion } from "./visual-theme";
import SectionSkeleton from "@/components/SectionSkeleton";

let renderSeq = 0;

/** The same steps as plain text — shown if the diagram can't render, and always available for screen readers. */
function StepList({ spec }: { spec: VisualFlowchartSpec }) {
  const label = new Map(spec.nodes.map((n) => [n.id, n.label]));
  return (
    <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-muted-foreground">
      {spec.edges.map((e, i) => (
        <li key={i}>
          {label.get(e.from)} → {e.label ? `(${e.label}) ` : ""}
          {label.get(e.to)}
        </li>
      ))}
    </ol>
  );
}

const FlowchartVisual = ({ spec, title }: { spec: VisualFlowchartSpec; title: string }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const themeVersion = useThemeVersion();
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  // A string, not the spec: the parent re-parses the sheet on every render, so
  // the spec object is new each time even when nothing changed.
  const source = flowchartToMermaid(spec);

  useEffect(() => {
    let cancelled = false;
    const renderId = `sheet-visual-${baseId}-${++renderSeq}`;

    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        // Mermaid sizes each label box from measured text; measured in the
        // fallback font, the real one then overflows and clips ("Ye" for "Yes").
        await document.fonts?.ready;
        const t = readVisualTheme();
        mermaid.initialize({
          startOnLoad: false,
          // Labels are escaped at build time; strict is the second fence.
          securityLevel: "strict",
          theme: "base",
          fontFamily: t.font,
          themeVariables: {
            fontFamily: t.font,
            fontSize: "13px",
            background: t.surface,
            primaryColor: t.surface,
            primaryBorderColor: t.border,
            primaryTextColor: t.fg,
            lineColor: t.fgMuted,
            textColor: t.fg,
            edgeLabelBackground: t.surface,
          },
          flowchart: {
            curve: "basis",
            useMaxWidth: true,
            nodeSpacing: 28,
            rankSpacing: 36,
            padding: 10,
            // Diamonds grow with their label's line length; wrapping narrower
            // keeps a long decision question from dwarfing the rest of the chart.
            wrappingWidth: 150,
          },
        });
        const code = [
          source,
          `  classDef terminal fill:${t.accent},stroke:${t.accent},color:${t.surface}`,
          `  classDef decision fill:${t.panel},stroke:${t.accent},color:${t.fg}`,
        ].join("\n");
        const result = await mermaid.render(renderId, code);
        if (!cancelled) {
          setSvg(result.svg);
          setFailed(false);
        }
      } catch (err) {
        // Mermaid leaves its error graphic in <body> when a render throws.
        document.getElementById(`d${renderId}`)?.remove();
        if (import.meta.env.DEV) console.warn("[sheet-visual] mermaid render failed", err);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, themeVersion, baseId]);

  if (failed) {
    return (
      <div>
        <p className="mb-2 text-[12px] text-muted-foreground">
          The diagram couldn&apos;t be drawn — here are its steps:
        </p>
        <StepList spec={spec} />
      </div>
    );
  }

  if (!svg) return <SectionSkeleton variant="sheet-body" />;

  return (
    <>
      <div
        role="img"
        aria-label={title || "Flowchart"}
        className="flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-h-[560px] [&_foreignObject]:overflow-visible"
        // Mermaid's own output, rendered at securityLevel "strict" from syntax
        // this app generated — no model text reaches it unescaped.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <details className="mt-2 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer select-none">Text version</summary>
        <div className="mt-2">
          <StepList spec={spec} />
        </div>
      </details>
    </>
  );
};

export default FlowchartVisual;
