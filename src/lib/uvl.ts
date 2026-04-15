import type { FMEdge, FMNode } from "./store";
import type { Constraint, Group } from "./types";

const needsQuote = (name: string) => !/^[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
const q = (n: string) => (needsQuote(n) ? `"${n}"` : n);

export function toUVL(
  nodes: FMNode[],
  edges: FMEdge[],
  groups: Group[],
  constraints: Constraint[]
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    parentOf.set(e.target, e.source);
    childrenOf.set(e.source, [...(childrenOf.get(e.source) ?? []), e.target]);
  }
  const root = nodes.find((n) => !parentOf.has(n.id));
  if (!root) return "// empty model";

  const groupByParent = new Map<string, Group[]>();
  for (const g of groups) {
    groupByParent.set(g.parentId, [...(groupByParent.get(g.parentId) ?? []), g]);
  }

  const ind = (n: number) => "  ".repeat(n);
  const lines: string[] = [];

  lines.push("features");

  const emit = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n) return;
    const d = n.data;
    const typePrefix = d.featureType !== "Boolean" ? `${d.featureType} ` : "";
    const card = d.cardinality ? ` cardinality [${d.cardinality.lower}..${d.cardinality.upper}]` : "";
    const attrs =
      d.attributes.length > 0
        ? ` {${d.attributes
            .map((a) => {
              const v = a.value.trim();
              if (v === "true" || v === "false") return `${q(a.key)} ${v}`;
              if (/^-?\d+(\.\d+)?$/.test(v)) return `${q(a.key)} ${v}`;
              if (v === "") return q(a.key);
              return `${q(a.key)} '${v}'`;
            })
            .join(", ")}}`
        : "";
    lines.push(`${ind(depth)}${typePrefix}${q(d.name)}${card}${attrs}`);

    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) return;

    const gs = groupByParent.get(id) ?? [];
    const grouped = new Set<string>();
    for (const g of gs) g.childrenIds.forEach((c) => grouped.add(c));
    const looseMand = kids.filter((c) => !grouped.has(c) && byId.get(c)?.data.parentRel === "mandatory");
    const looseOpt = kids.filter((c) => !grouped.has(c) && byId.get(c)?.data.parentRel === "optional");

    if (looseMand.length) {
      lines.push(`${ind(depth + 1)}mandatory`);
      looseMand.forEach((c) => emit(c, depth + 2));
    }
    if (looseOpt.length) {
      lines.push(`${ind(depth + 1)}optional`);
      looseOpt.forEach((c) => emit(c, depth + 2));
    }
    for (const g of gs) {
      const header =
        g.type === "or"
          ? "or"
          : g.type === "alternative"
          ? "alternative"
          : g.type === "cardinality"
          ? `[${g.cardinality?.lower ?? 1}..${g.cardinality?.upper ?? g.childrenIds.length}]`
          : "mandatory";
      lines.push(`${ind(depth + 1)}${header}`);
      g.childrenIds.forEach((c) => emit(c, depth + 2));
    }
  };

  emit(root.id, 1);

  if (constraints.length) {
    lines.push("");
    lines.push("constraints");
    constraints.forEach((c) => lines.push(`    ${c.expr}`));
  }

  return lines.join("\n") + "\n";
}
