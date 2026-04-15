import type { FMEdge, FMNode } from "./store";

const NODE_MIN_W = 140;  // matches FeatureNode's `min-w-[140px]`
const NODE_PAD = 24;     // px each side for padding + border
const CHAR_W = 8;        // rough average glyph width for the feature name
const H_GAP = 10;        // min horizontal gap between sibling subtrees
const V_GAP = 110;       // vertical gap between levels
const ORIGIN_X = 40;
const ORIGIN_Y = 40;

/**
 * Tidy-tree layout:
 *   - computes subtree widths bottom-up
 *   - centers each parent over the horizontal span of its children's subtrees
 *   - guarantees no horizontal overlap (siblings get disjoint x-ranges)
 */
export function autoLayout(nodes: FMNode[], edges: FMEdge[]): FMNode[] {
  if (nodes.length === 0) return nodes;

  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    parentOf.set(e.target, e.source);
    childrenOf.set(e.source, [...(childrenOf.get(e.source) ?? []), e.target]);
  }
  const roots = nodes.filter((n) => !parentOf.has(n.id));

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Per-node rendered width: long names get more horizontal space so they
  // don't overlap once we tighten the sibling gap.
  const nodeW = (id: string) => {
    const n = byId.get(id);
    if (!n) return NODE_MIN_W;
    const nameW = (n.data.name?.length ?? 0) * CHAR_W;
    return Math.max(NODE_MIN_W, Math.ceil(nameW + NODE_PAD * 2));
  };

  const widthCache = new Map<string, number>();
  const subtreeWidth = (id: string): number => {
    if (widthCache.has(id)) return widthCache.get(id)!;
    const self = nodeW(id);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      widthCache.set(id, self);
      return self;
    }
    const sum = kids.reduce((s, k) => s + subtreeWidth(k), 0) + (kids.length - 1) * H_GAP;
    const w = Math.max(self, sum);
    widthCache.set(id, w);
    return w;
  };

  const out: FMNode[] = nodes.map((n) => ({ ...n, position: { ...n.position } }));
  const outById = new Map(out.map((n) => [n.id, n]));

  let cursor = ORIGIN_X;
  const place = (id: string, left: number, depth: number) => {
    const w = subtreeWidth(id);
    const centerX = left + w / 2;
    const node = outById.get(id);
    if (node) node.position = { x: centerX - nodeW(id) / 2, y: ORIGIN_Y + depth * V_GAP };

    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) return;
    const kidsTotal =
      kids.reduce((s, k) => s + subtreeWidth(k), 0) + (kids.length - 1) * H_GAP;
    let startX = centerX - kidsTotal / 2;
    for (const k of kids) {
      const kw = subtreeWidth(k);
      place(k, startX, depth + 1);
      startX += kw + H_GAP;
    }
  };

  for (const r of roots) {
    place(r.id, cursor, 0);
    cursor += subtreeWidth(r.id) + H_GAP * 2;
  }
  // Nodes not connected to any root (orphans): line them up to the right
  for (const n of out) {
    if (!roots.some((r) => r.id === n.id) && !parentOf.has(n.id)) {
      n.position = { x: cursor, y: ORIGIN_Y };
      cursor += nodeW(n.id) + H_GAP;
    }
  }

  return out;
}
