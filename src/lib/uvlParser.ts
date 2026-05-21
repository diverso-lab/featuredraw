import type { FMEdge, FMNode } from "./store";
import type { Attribute, Constraint, FeatureType, Group } from "./types";

/**
 * Pragmatic UVL importer.
 *
 * Scope (enough to round-trip the app's exporter + eShop example from the UVL paper):
 *   - indentation-based feature tree (4 spaces or tabs; auto-detected per block)
 *   - root feature (single, outside any group keyword)
 *   - group keywords: mandatory | optional | or | alternative | [n..m]
 *   - feature types prefix: Boolean | Integer | Float | String
 *   - feature cardinality:  <Name> cardinality [n..m]
 *   - attributes: {Key Value, "Key 2" 'str', Flag true}
 *   - constraints block (each line is one constraint expression, kept verbatim)
 *   - quoted identifiers: "Bank Transfer"
 *
 * Intentionally ignored (warnings collected in `warnings`):
 *   - `features` section header (optional)
 *   - `include` / `imports` blocks (skipped)
 *   - `constraint` / `constraints` attribute forms on features
 */

export type ImportResult = {
  nodes: FMNode[];
  edges: FMEdge[];
  groups: Group[];
  constraints: Constraint[];
  warnings: string[];
};

type Tok = { name: string; raw: string };

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const indentOf = (line: string) => {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
};

const parseIdent = (s: string, i: number): { value: string; end: number } | null => {
  if (s[i] === '"') {
    const end = s.indexOf('"', i + 1);
    if (end < 0) return null;
    return { value: s.slice(i + 1, end), end: end + 1 };
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
  if (!m) return null;
  return { value: m[0], end: i + m[0].length };
};

const parseCard = (s: string, i: number): { lower: number; upper: number; end: number } | null => {
  if (s[i] !== "[") return null;
  const m = /^\[\s*(\d+)\s*\.\.\s*(\d+|\*)\s*\]/.exec(s.slice(i));
  if (!m) return null;
  const upper = m[2] === "*" ? 999 : parseInt(m[2], 10);
  return { lower: parseInt(m[1], 10), upper, end: i + m[0].length };
};

// Parses a {k v, k2 v2} attribute list starting at `i` (pointing at '{')
const parseAttrList = (s: string, i: number, warnings: string[]): { attrs: Attribute[]; end: number } | null => {
  if (s[i] !== "{") return null;
  let j = i + 1;
  const attrs: Attribute[] = [];
  const skipWs = () => {
    while (j < s.length && /[\s]/.test(s[j])) j++;
  };
  skipWs();
  if (s[j] === "}") return { attrs, end: j + 1 };
  while (j < s.length) {
    skipWs();
    const k = parseIdent(s, j);
    if (!k) return null;
    j = k.end;
    skipWs();
    // value: string 'xxx', number, bool, nested attrs, or none (=> true)
    let value = "true";
    if (s[j] === "'" ) {
      const end = s.indexOf("'", j + 1);
      if (end < 0) return null;
      value = s.slice(j + 1, end);
      j = end + 1;
    } else if (/[\d\-]/.test(s[j] ?? "")) {
      const m = /^-?\d+(\.\d+)?/.exec(s.slice(j));
      if (m) {
        value = m[0];
        j += m[0].length;
      }
    } else if (s.slice(j, j + 4) === "true") {
      value = "true";
      j += 4;
    } else if (s.slice(j, j + 5) === "false") {
      value = "false";
      j += 5;
    } else if (s[j] === "{") {
      // nested attribute list — flatten as JSON-ish string (warn)
      const nested = parseAttrList(s, j, warnings);
      if (!nested) return null;
      value = JSON.stringify(nested.attrs);
      j = nested.end;
      warnings.push(`Nested attribute list flattened for key "${k.value}"`);
    } else if (s[j] === "," || s[j] === "}") {
      // key-only → Boolean true
    } else {
      // bare identifier as value
      const v = parseIdent(s, j);
      if (v) {
        value = v.value;
        j = v.end;
      }
    }
    attrs.push({ key: k.value, value });
    skipWs();
    if (s[j] === ",") {
      j++;
      continue;
    }
    if (s[j] === "}") return { attrs, end: j + 1 };
    return null;
  }
  return null;
};

type ParsedLine =
  | { kind: "section"; name: "features" | "constraints" | "include" | "imports"; indent: number }
  | { kind: "group"; groupType: "mandatory" | "optional" | "or" | "alternative" | "cardinality"; cardinality?: { lower: number; upper: number }; indent: number }
  | { kind: "feature"; indent: number; name: string; featureType: FeatureType; cardinality?: { lower: number; upper: number }; attrs: Attribute[] }
  | { kind: "constraint"; text: string; indent: number }
  | { kind: "blank" };

const isSection = (t: string): ParsedLine["kind"] | null => {
  const s = t.trim();
  if (s === "features") return "section";
  if (s === "constraints") return "section";
  if (s === "include") return "section";
  if (s === "imports") return "section";
  return null;
};

function parseLine(line: string, warnings: string[]): ParsedLine {
  if (!line.trim()) return { kind: "blank" };
  const indent = indentOf(line);
  const body = line.slice(indent);
  const trimmed = body.trim();

  // UVL top-level metadata that doesn't belong to the feature tree
  // (`namespace <name[.qualified]>`). We have no use for it and if we let
  // the feature-line fallback handle it, the keyword itself ends up as a
  // stray feature node floating next to the diagram.
  if (indent === 0 && /^namespace\s+[A-Za-z_][\w.]*\s*$/.test(trimmed)) {
    return { kind: "blank" };
  }

  if (isSection(trimmed)) {
    return { kind: "section", name: trimmed as any, indent };
  }

  if (trimmed === "mandatory" || trimmed === "optional" || trimmed === "or" || trimmed === "alternative") {
    return { kind: "group", groupType: trimmed as any, indent };
  }
  const gc = parseCard(trimmed, 0);
  if (gc && gc.end === trimmed.length) {
    return { kind: "group", groupType: "cardinality", cardinality: { lower: gc.lower, upper: gc.upper }, indent };
  }

  // feature line
  let i = 0;
  let featureType: FeatureType = "Boolean";
  const typeMatch = /^(Boolean|Integer|Float|String)\s+/.exec(body);
  if (typeMatch) {
    featureType = typeMatch[1] as FeatureType;
    i = typeMatch[0].length;
  }
  const id = parseIdent(body, i);
  if (id) {
    i = id.end;
    while (body[i] === " ") i++;
    let cardinality: { lower: number; upper: number } | undefined;
    if (body.slice(i).startsWith("cardinality")) {
      i += "cardinality".length;
      while (body[i] === " ") i++;
      const c = parseCard(body, i);
      if (c) {
        cardinality = { lower: c.lower, upper: c.upper };
        i = c.end;
      }
    }
    while (body[i] === " ") i++;
    let attrs: Attribute[] = [];
    if (body[i] === "{") {
      const a = parseAttrList(body, i, warnings);
      if (a) {
        attrs = a.attrs;
        i = a.end;
      } else {
        warnings.push(`Could not parse attributes on line: ${line}`);
      }
    }
    return { kind: "feature", indent, name: id.value, featureType, cardinality, attrs };
  }

  return { kind: "constraint", text: trimmed, indent };
}

export function parseUVL(src: string): ImportResult {
  const warnings: string[] = [];
  const raw = stripComments(src).split("\n");
  const lines = raw.map((l) => parseLine(l, warnings));

  const nodes: FMNode[] = [];
  const edges: FMEdge[] = [];
  const groups: Group[] = [];
  const constraints: Constraint[] = [];

  let mode: "none" | "features" | "constraints" | "skip" = "none";
  let skipIndent = -1;

  type Frame =
    | { kind: "feature"; id: string; indent: number }
    | {
        kind: "group";
        groupType: "mandatory" | "optional" | "or" | "alternative" | "cardinality";
        cardinality?: { lower: number; upper: number };
        parentId: string;
        indent: number;
        children: string[];
      };
  const stack: Frame[] = [];

  const uniqId = (() => {
    const seen = new Map<string, number>();
    return (name: string) => {
      const base = name.replace(/[^A-Za-z0-9_]/g, "_") || "F";
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : `${base}_${n}`;
    };
  })();

  let cId = 0;
  let nodeCount = 0;

  const placeNode = (name: string, depth: number): { x: number; y: number } => {
    // simple auto-layout: depth*140 for y, sequential x
    const x = (nodeCount % 8) * 200 + 40;
    const y = depth * 140 + 40;
    nodeCount++;
    return { x, y };
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx];
    if (l.kind === "blank") continue;

    // handle skip block (include/imports)
    if (mode === "skip") {
      if (l.kind === "section") {
        // any new top-level section ends skip
      } else if ("indent" in l && l.indent > skipIndent) {
        continue;
      }
      mode = "none";
    }

    if (l.kind === "section") {
      if (l.name === "features") {
        mode = "features";
        stack.length = 0;
      } else if (l.name === "constraints") {
        mode = "constraints";
      } else if (l.name === "include" || l.name === "imports") {
        mode = "skip";
        skipIndent = l.indent;
      }
      continue;
    }

    // If we see a feature line without ever having a `features` header, enter features mode.
    if (mode === "none" && l.kind === "feature") mode = "features";

    // Inside a `constraints` block, take the raw line content as a constraint
    // expression (parseLine may mistakenly classify lines like `A => B` as a
    // feature, since they start with an identifier).
    if (mode === "constraints") {
      const expr = raw[idx].replace(/^\s+/, "").trimEnd();
      if (expr) constraints.push({ id: `c_${++cId}`, expr });
      continue;
    }

    if (mode !== "features") continue;

    // pop stack until top.indent < l.indent
    while (stack.length && stack[stack.length - 1].indent >= l.indent) {
      const popped = stack.pop()!;
      if (popped.kind === "group") {
        if (popped.children.length) {
          groups.push({
            id: `g_${popped.parentId}_${groups.length}`,
            parentId: popped.parentId,
            childrenIds: popped.children,
            type: popped.groupType === "mandatory" || popped.groupType === "optional" ? "and" : popped.groupType,
            cardinality: popped.cardinality,
          });
          // mark inGroup on edges/nodes when or/alternative/cardinality
          if (popped.groupType === "or" || popped.groupType === "alternative" || popped.groupType === "cardinality") {
            for (const cid of popped.children) {
              const e = edges.find((x) => x.source === popped.parentId && x.target === cid);
              if (e) e.data = { ...(e.data || {}), inGroup: true };
              const n = nodes.find((x) => x.id === cid);
              if (n) n.data = { ...n.data, inGroup: true };
            }
          }
        }
      }
    }

    if (l.kind === "group") {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== "feature") {
        warnings.push(`Group "${l.groupType}" without parent feature (line ${idx + 1})`);
        continue;
      }
      stack.push({
        kind: "group",
        groupType: l.groupType,
        cardinality: l.cardinality,
        parentId: top.id,
        indent: l.indent,
        children: [],
      });
      continue;
    }

    if (l.kind === "feature") {
      const id = uniqId(l.name);
      const parentFrame = [...stack].reverse().find((f) => f.kind === "group") as
        | Extract<Frame, { kind: "group" }>
        | undefined;
      const rel: "mandatory" | "optional" =
        parentFrame?.groupType === "optional"
          ? "optional"
          : parentFrame?.groupType === "mandatory"
          ? "mandatory"
          : parentFrame
          ? "mandatory"
          : "mandatory";

      const depth = stack.filter((f) => f.kind === "feature").length;
      const node: FMNode = {
        id,
        type: "feature",
        position: placeNode(l.name, depth),
        data: {
          name: l.name,
          featureType: l.featureType,
          attributes: l.attrs,
          parentRel: rel,
          cardinality: l.cardinality,
        },
      };
      nodes.push(node);

      if (parentFrame) {
        edges.push({
          id: `e_${parentFrame.parentId}_${id}`,
          source: parentFrame.parentId,
          target: id,
          type: "feature",
          data: { parentRel: rel },
        });
        parentFrame.children.push(id);
      }

      stack.push({ kind: "feature", id, indent: l.indent });
    }
  }

  // flush remaining stack
  while (stack.length) {
    const popped = stack.pop()!;
    if (popped.kind === "group" && popped.children.length) {
      groups.push({
        id: `g_${popped.parentId}_${groups.length}`,
        parentId: popped.parentId,
        childrenIds: popped.children,
        type: popped.groupType === "mandatory" || popped.groupType === "optional" ? "and" : popped.groupType,
        cardinality: popped.cardinality,
      });
      if (popped.groupType === "or" || popped.groupType === "alternative" || popped.groupType === "cardinality") {
        for (const cid of popped.children) {
          const e = edges.find((x) => x.source === popped.parentId && x.target === cid);
          if (e) e.data = { ...(e.data || {}), inGroup: true };
          const n = nodes.find((x) => x.id === cid);
          if (n) n.data = { ...n.data, inGroup: true };
        }
      }
    }
  }

  // Tidy up: simple tree layout per depth (spread x)
  const byDepth = new Map<number, FMNode[]>();
  const parentOf = new Map<string, string>();
  edges.forEach((e) => parentOf.set(e.target, e.source));
  const depthOf = (id: string): number => {
    let d = 0;
    let cur: string | undefined = id;
    while (cur && parentOf.has(cur)) {
      cur = parentOf.get(cur);
      d++;
    }
    return d;
  };
  for (const n of nodes) {
    const d = depthOf(n.id);
    byDepth.set(d, [...(byDepth.get(d) ?? []), n]);
  }
  for (const [d, arr] of byDepth) {
    const spacing = 200;
    const totalW = Math.max(1, arr.length) * spacing;
    arr.forEach((n, i) => {
      n.position = { x: 40 + i * spacing, y: 40 + d * 150 };
    });
    void totalW;
  }

  return { nodes, edges, groups, constraints, warnings };
}
