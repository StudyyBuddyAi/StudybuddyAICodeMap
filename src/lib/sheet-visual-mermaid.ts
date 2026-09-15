import type { FlowchartNodeShape, VisualFlowchartSpec } from "@/types/generated-sheet";

/**
 * Mermaid source for a validated flowchart spec.
 *
 * The model never writes mermaid syntax. It supplies labels; this builds the
 * syntax around them, so the only model text that reaches `mermaid.render()`
 * sits inside a quoted label with every character mermaid treats specially
 * replaced by its entity code. Node ids are generated here (n0, n1, …) — the
 * model's own ids only resolve edges.
 */

/** Characters that could end a quoted label or start markup/markdown. `#` first, so the entities added after it survive. */
export function escapeMermaidLabel(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/`/g, "#96;")
    .replace(/\|/g, "#124;")
    .trim();
}

function nodeSyntax(id: string, label: string, shape: FlowchartNodeShape): string {
  const text = `"${escapeMermaidLabel(label)}"`;
  switch (shape) {
    case "decision":
      return `${id}{${text}}`;
    case "start":
    case "end":
      return `${id}([${text}])`;
    default:
      return `${id}[${text}]`;
  }
}

export function flowchartToMermaid(spec: VisualFlowchartSpec): string {
  const idFor = new Map(spec.nodes.map((node, i) => [node.id, `n${i}`]));
  const lines = [`flowchart ${spec.direction === "LR" ? "LR" : "TD"}`];

  for (const node of spec.nodes) {
    lines.push(`  ${nodeSyntax(idFor.get(node.id)!, node.label, node.shape)}`);
  }
  for (const edge of spec.edges) {
    const from = idFor.get(edge.from);
    const to = idFor.get(edge.to);
    if (!from || !to) continue;
    const label = edge.label ? escapeMermaidLabel(edge.label) : "";
    lines.push(label ? `  ${from} -->|"${label}"| ${to}` : `  ${from} --> ${to}`);
  }

  const terminals = spec.nodes
    .filter((n) => n.shape === "start" || n.shape === "end")
    .map((n) => idFor.get(n.id));
  const decisions = spec.nodes.filter((n) => n.shape === "decision").map((n) => idFor.get(n.id));
  if (terminals.length) lines.push(`  class ${terminals.join(",")} terminal`);
  if (decisions.length) lines.push(`  class ${decisions.join(",")} decision`);

  return lines.join("\n");
}
