import type { FMEdge, FMNode } from "./store";
import type { Constraint, Group } from "./types";
import { parseVisualConstraints } from "./constraintParser";
import { measureTextPx } from "./textMeasure";

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const NODE_MIN_W = 150;  // matches FeatureNode's `min-w-[150px]`
const NODE_PAD = 24;     // matches FeatureNode's `px-3` (12px each side)
                         //   + a small allowance so the rounded border has
                         //   breathing room around the glyphs.
const ROW_H = 18;        // for font-size 12 attributes
const HEAD_H = 44;       // for font-size 15 name, vertically centered

// Real text width — shared with layout.ts so the auto-layout, the canvas
// (CSS auto-sizes around the same span) and the exporter all agree on how
// wide each node box is. Without this, the exporter draws boxes wider than
// the canvas does → siblings overlap in the preview/PDF.
const measureNode = (n: FMNode, includeAttrs = true) => {
  const attrLines = includeAttrs ? (n.data.attributes?.length ?? 0) : 0;
  const cardLine = n.data.cardinality ? 1 : 0;
  const h = HEAD_H + (attrLines + cardLine) * ROW_H + (attrLines + cardLine > 0 ? 6 : 0);
  const nameW = measureTextPx(n.data.name ?? "", 15, 600);
  const w = Math.max(NODE_MIN_W, Math.ceil(nameW + NODE_PAD * 2));
  return { w, h };
};

function computeBounds(nodes: FMNode[], includeAttrs: boolean, pad = 40, fScale = 1): Bounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 400, maxY: 200 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    const { w, h } = measureNode(n, includeAttrs);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w * fScale);
    maxY = Math.max(maxY, n.position.y + h * fScale);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

const typeColor: Record<string, string> = {
  Boolean: "#2b6cff",
  Integer: "#22a06b",
  Float: "#d98e00",
  String: "#b255d9",
};

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type LegendPosition = "right" | "left" | "top" | "bottom";

export type ExportOptions = {
  transparent?: boolean;
  legend?: boolean;
  /** Where the legend block is placed relative to the diagram. */
  legendPosition?: LegendPosition;
  includeAttributes?: boolean;
  drawConstraintLines?: boolean;
  /** Render the list of cross-tree constraints as a side block. */
  showConstraintsBlock?: boolean;
  /** Keep the legend and constraints blocks side-by-side when both are shown
   *  (default true). With legend on right/left, the constraints block sits
   *  directly UNDER the legend in the same column. With legend on top/bottom,
   *  it sits to the RIGHT of the legend in the same strip. When false, the
   *  constraints block always docks to the right of the diagram regardless
   *  of the legend's position. */
  groupLegendAndConstraints?: boolean;
  // --- Preview-time overrides (absolute positions in the SVG's pre-translation
  //     coordinate system; the final SVG always re-crops with uniform padding
  //     around the union of everything visible, so dragging things around
  //     never leaves stray whitespace on any side). ---
  /** Per-node position override keyed by node id. */
  nodePosOverride?: Record<string, { x: number; y: number }>;
  /** Top-left override for the legend wrapper (replaces auto-placement). */
  legendPosOverride?: { x: number; y: number };
  /** Top-left override for the constraints block wrapper. */
  consPosOverride?: { x: number; y: number };
  // --- Per-section font size (px, base height). Defaults preserve current
  //     look (15 / 12 / 11.5). Implemented via SVG scale transforms wrapped
  //     around each section's inner content + corresponding scaling of the
  //     metrics used for bounds & positioning, so cropping and overlap-free
  //     legend layout still hold at any scale. ---
  featureFontPx?: number;
  legendFontPx?: number;
  constraintFontPx?: number;
};

// --- Legend geometry (uniform; same for all 4 positions) ---
// LG_ROW_H is sized to clear the tallest icon (cardinality: triangle apex
// at y=-10 + [n..m] text baseline at y=18 ≈ extent -10..+20 = 30px). With
// row height 34 there is always ≥3px of vertical breathing room between
// adjacent rows in BOTH vertical and 3×3 grid layouts (verified in tests).
const LG_PAD_X = 20;
const LG_PAD_TOP = 40;        // title (y=26) + divider (y=34) + 6px
const LG_PAD_BOTTOM = 12;
const LG_ROW_H = 34;
const LG_ICON_W = 32;
const LG_ICON_LBL_GAP = 14;
const LG_LABEL_W = 140;       // wider than "Alternative (XOR)" at 12px
const LG_ITEM_W = LG_ICON_W + LG_ICON_LBL_GAP + LG_LABEL_W; // 186
const LG_COL_GAP = 20;
const LEGEND_ITEM_COUNT = 9;

export function buildSVG(
  nodes: FMNode[],
  edges: FMEdge[],
  groups: Group[],
  opts: ExportOptions & { constraints?: Constraint[] } = {}
): string {
  const {
    transparent = false,
    legend = false,
    legendPosition = "right",
    includeAttributes = true,
    drawConstraintLines = true,
    showConstraintsBlock = true,
    groupLegendAndConstraints = true,
    constraints = [],
    nodePosOverride,
    legendPosOverride,
    consPosOverride,
    featureFontPx = 15,
    legendFontPx = 12,
    constraintFontPx = 11.5,
  } = opts;

  // Section scale factors: applied as SVG `transform="scale(...)"` wrappers
  // around each section's inner content AND folded into the metrics used
  // for bounds / placement so that:
  //  - feature boxes still butt up against each other proportionally
  //  - legend rows still clear the cardinality icon at any scale
  //  - the constraints block still fits its expressions
  const fScale = featureFontPx / 15;
  const lScale = legendFontPx / 12;
  const cScale = constraintFontPx / 11.5;

  // Rendered-size helper: every site that asks "how big is this node on the
  // page right now?" goes through here so scaling can never be forgotten.
  const measureRendered = (n: FMNode) => {
    const { w, h } = measureNode(n, includeAttributes);
    return { w: w * fScale, h: h * fScale };
  };

  // Apply per-node position overrides up-front so EVERY downstream
  // calculation (edges, group arcs, constraint lanes, content bounds…)
  // sees the same moved positions.
  //
  // When the feature font is scaled UP, node boxes grow but the stored
  // positions stay the same — siblings would overlap. So for any node
  // the user hasn't manually dragged, we also scale its position by
  // fScale: the whole tree spreads out proportionally and gaps that
  // looked right at 100% still look right at 130% / 200%. Dragged
  // nodes use their override verbatim (the user's chosen spot wins).
  const effectiveNodes: FMNode[] = nodes.map((n) => {
    const ov = nodePosOverride?.[n.id];
    if (ov) return { ...n, position: { x: ov.x, y: ov.y } };
    if (fScale === 1) return n;
    return { ...n, position: { x: n.position.x * fScale, y: n.position.y * fScale } };
  });

  // Raw (un-padded) bounds of the diagram in its natural coordinate system.
  const rawBounds = computeBounds(effectiveNodes, includeAttributes, 0, fScale);
  const diagramMinX = rawBounds.minX, diagramMaxX = rawBounds.maxX;
  const diagramMinY = rawBounds.minY, diagramMaxY = rawBounds.maxY;
  const diagramW = diagramMaxX - diagramMinX;

  const SIDE_GAP = 48;
  const PAD = 40;          // uniform outer padding (all 4 sides)

  // Constraints side-block geometry (BASE — what the inner SVG uses unscaled)
  const CONS_LINE_H = 18;
  const CONS_HEAD_H = 24;
  const CONS_PAD = 16;
  const hasConsBlock = showConstraintsBlock && constraints.length > 0;
  const consBlockH_BASE = hasConsBlock
    ? CONS_PAD * 2 + CONS_HEAD_H + constraints.length * CONS_LINE_H
    : 0;
  const consBlockH = consBlockH_BASE * cScale;   // rendered cons block height
  // Constraint block width: grow to fit the widest expression and the
  // header "Cross-tree constraints" so long expressions like
  // `!("Bank Transfer" & "Mobile App")` never bleed past the rounded
  // border. Measured at BASE font size — cScale scales the whole block.
  const SIDE_W_MIN = 240;
  const consTitleW = hasConsBlock
    ? measureTextPx("Cross-tree constraints", 13, 700, "system-ui, sans-serif")
    : 0;
  const consMaxExprW = hasConsBlock
    ? Math.max(0, ...constraints.map((c) => measureTextPx(c.expr, 11.5, 400, "ui-monospace, SFMono-Regular, Menlo, monospace")))
    : 0;
  const SIDE_W_BASE = hasConsBlock
    ? Math.max(SIDE_W_MIN, Math.ceil(Math.max(consTitleW, consMaxExprW) + CONS_PAD * 2 + 4))
    : SIDE_W_MIN;
  const SIDE_W = SIDE_W_BASE * cScale;

  // Legend dimensions depend on orientation. Vertical = 1 column × 9 rows;
  // horizontal (top/bottom) = 3 columns × 3 rows so the strip stays compact
  // and every cell is the same size — guarantees both no-overlap and
  // perfect per-column / per-row alignment by construction.
  const isHorizontalLegend = legend && (legendPosition === "top" || legendPosition === "bottom");
  const LG_COLS = isHorizontalLegend ? 3 : 1;
  const LG_ROWS = Math.ceil(LEGEND_ITEM_COUNT / LG_COLS);
  // BASE = the unscaled width/height of the inner SVG content.
  const legendW_BASE = legend
    ? 2 * LG_PAD_X + LG_COLS * LG_ITEM_W + (LG_COLS - 1) * LG_COL_GAP
    : 0;
  const legendH_BASE = legend
    ? LG_PAD_TOP + LG_ROWS * LG_ROW_H + LG_PAD_BOTTOM
    : 0;
  const legendW = legendW_BASE * lScale;   // rendered size (used for bounds + placement)
  const legendH = legendH_BASE * lScale;

  // === Default placement of legend & constraints block (natural coords). ===
  // All positions live in the same coordinate space as the diagram nodes,
  // so the final cropping pass can take a single union and translate once.
  // When groupLegendAndConstraints is true (default), legend & cons sit as a
  // single visual block (cons below legend in vertical layouts, cons to the
  // right of legend in horizontal layouts). When false, cons always docks
  // to the right of the diagram.
  let legendX = 0, legendY = 0;
  let consX = 0, consY = 0;
  const grouped = legend && hasConsBlock && groupLegendAndConstraints;
  // Inter-block gap between legend and constraints when grouped together.
  const GROUP_GAP = 16;

  if (legend && legendPosition === "right") {
    legendX = diagramMaxX + SIDE_GAP;
    legendY = diagramMinY;
    if (hasConsBlock) {
      consX = legendX;
      consY = legendY + legendH + GROUP_GAP;
    }
  } else if (legend && legendPosition === "left") {
    legendX = diagramMinX - SIDE_GAP - legendW;
    legendY = diagramMinY;
    if (hasConsBlock) {
      if (grouped) {
        // Cons directly under legend in the LEFT column.
        consX = legendX;
        consY = legendY + legendH + GROUP_GAP;
      } else {
        consX = diagramMaxX + SIDE_GAP;
        consY = diagramMinY;
      }
    }
  } else if (legend && legendPosition === "top") {
    if (grouped) {
      // Legend + cons share a single strip above the diagram, centred over
      // the diagram. Both boxes are top-aligned.
      const stripW = legendW + SIDE_GAP + SIDE_W;
      const centerX = (diagramMinX + diagramMaxX) / 2;
      legendX = centerX - stripW / 2;
      legendY = diagramMinY - SIDE_GAP - Math.max(legendH, consBlockH);
      consX = legendX + legendW + SIDE_GAP;
      consY = legendY;
    } else {
      const rightExtent = diagramMaxX + (hasConsBlock ? SIDE_GAP + SIDE_W : 0);
      const centerX = (diagramMinX + rightExtent) / 2;
      legendX = centerX - legendW / 2;
      legendY = diagramMinY - SIDE_GAP - legendH;
      if (hasConsBlock) {
        consX = diagramMaxX + SIDE_GAP;
        consY = diagramMinY;
      }
    }
  } else if (legend && legendPosition === "bottom") {
    if (grouped) {
      const stripW = legendW + SIDE_GAP + SIDE_W;
      const centerX = (diagramMinX + diagramMaxX) / 2;
      legendX = centerX - stripW / 2;
      legendY = diagramMaxY + SIDE_GAP;
      consX = legendX + legendW + SIDE_GAP;
      consY = legendY;
    } else {
      const rightExtent = diagramMaxX + (hasConsBlock ? SIDE_GAP + SIDE_W : 0);
      const centerX = (diagramMinX + rightExtent) / 2;
      legendX = centerX - legendW / 2;
      if (hasConsBlock) {
        consX = diagramMaxX + SIDE_GAP;
        consY = diagramMinY;
      }
      const consBottom = hasConsBlock ? consY + consBlockH : -Infinity;
      legendY = Math.max(diagramMaxY, consBottom) + SIDE_GAP;
    }
  } else if (hasConsBlock) {
    consX = diagramMaxX + SIDE_GAP;
    consY = diagramMinY;
  }

  // Apply preview-time drag overrides — same coordinate space, so just set.
  if (legend && legendPosOverride) {
    legendX = legendPosOverride.x;
    legendY = legendPosOverride.y;
  }
  if (hasConsBlock && consPosOverride) {
    consX = consPosOverride.x;
    consY = consPosOverride.y;
  }

  // === Content bounds = union of every visible element. ===
  // Whatever the user drags around, the final SVG is cropped tight to this
  // union and surrounded by PAD on all 4 sides — never any stray margin.
  let contentMinX = diagramMinX, contentMinY = diagramMinY;
  let contentMaxX = diagramMaxX, contentMaxY = diagramMaxY;
  if (legend) {
    contentMinX = Math.min(contentMinX, legendX);
    contentMinY = Math.min(contentMinY, legendY);
    contentMaxX = Math.max(contentMaxX, legendX + legendW);
    contentMaxY = Math.max(contentMaxY, legendY + legendH);
  }
  if (hasConsBlock) {
    contentMinX = Math.min(contentMinX, consX);
    contentMinY = Math.min(contentMinY, consY);
    contentMaxX = Math.max(contentMaxX, consX + SIDE_W);
    contentMaxY = Math.max(contentMaxY, consY + consBlockH);
  }
  // Constraint-arrow lanes extend below the diagram — account for them too.
  let visualConstraintCount = 0;
  if (drawConstraintLines && constraints.length) {
    visualConstraintCount = parseVisualConstraints(constraints).length;
    if (visualConstraintCount > 0) {
      const LANE_GAP = 28;
      contentMaxY = Math.max(contentMaxY, diagramMaxY + 40 + visualConstraintCount * LANE_GAP);
    }
  }

  const w = (contentMaxX - contentMinX) + 2 * PAD;
  const h = (contentMaxY - contentMinY) + 2 * PAD;
  // ONE translation applied around everything: maps contentMin → (PAD,PAD).
  const tx = PAD - contentMinX;
  const ty = PAD - contentMinY;

  const bg = transparent ? "" : `<rect width="${w}" height="${h}" fill="#ffffff"/>`;

  const nodeMap = new Map(effectiveNodes.map((n) => [n.id, n]));

  const edgeSvgs: string[] = [];
  // Bolitas (mandatory/optional markers) rendered AFTER the nodes so they
  // sit on top — half outside, half hiding the node border — instead of
  // being clipped behind the feature box.
  const markerSvgs: string[] = [];
  for (const e of edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    const sm = measureRendered(s);
    const tm = measureRendered(t);
    const x1 = s.position.x + sm.w / 2;
    const y1 = s.position.y + sm.h;
    const x2 = t.position.x + tm.w / 2;
    const y2 = t.position.y;
    const inGroup = !!(e.data as any)?.inGroup;
    const R = 8;
    edgeSvgs.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111418" stroke-width="2.5"/>`);

    if (!inGroup) {
      const rel = (e.data as any)?.parentRel ?? "mandatory";
      const fill = rel === "mandatory" ? "#111418" : "#ffffff";
      markerSvgs.push(
        `<circle cx="${x2}" cy="${y2}" r="${R}" fill="${fill}" stroke="#111418" stroke-width="2"/>`
      );
    }
  }

  // group arcs
  const arcSvgs: string[] = [];
  for (const g of groups) {
    // "and" groups are logical only — no visual arc.
    if (g.type === "and") continue;
    const p = nodeMap.get(g.parentId);
    const childs = g.childrenIds.map((id) => nodeMap.get(id)).filter(Boolean) as FMNode[];
    if (!p || childs.length === 0) continue;
    const pm = measureRendered(p);
    const px = p.position.x + pm.w / 2;
    const py = p.position.y + pm.h;
    const angles = childs.map((c) => {
      const cm = measureRendered(c);
      const cx = c.position.x + cm.w / 2;
      const cy = c.position.y;
      return Math.atan2(cy - py, cx - px);
    });
    const a1 = Math.min(...angles);
    const a2 = Math.max(...angles);
    const r = 28;
    const sx = px + r * Math.cos(a1);
    const sy = py + r * Math.sin(a1);
    const ex = px + r * Math.cos(a2);
    const ey = py + r * Math.sin(a2);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    const arc = `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
    const pie = `M ${px} ${py} L ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} Z`;
    if (g.type === "or" || g.type === "cardinality") {
      // White underlay so the tree edge crossing the sector stays hidden.
      arcSvgs.push(`<path d="${pie}" fill="#ffffff" stroke="none"/>`);
      arcSvgs.push(`<path d="${pie}" fill="#11141822" stroke="none"/>`);
    }
    arcSvgs.push(`<path d="${arc}" fill="none" stroke="#111418" stroke-width="2.5"/>`);
    if (g.type === "cardinality" && g.cardinality) {
      arcSvgs.push(
        `<text x="${px}" y="${py + r + 12}" fill="#111418" font-size="11" text-anchor="middle" font-family="system-ui, sans-serif">[${g.cardinality.lower}..${g.cardinality.upper}]</text>`
      );
    }
  }

  // nodes — inner content is rendered at BASE size; the per-node wrapper
  // applies translate(position) and then scale(fScale) so the whole box +
  // text + attrs grow together. Edge endpoints (computed above) and
  // bounds (above) use measureRendered so positioning agrees.
  const nodeSvgs: string[] = [];
  const hasChildren = new Set(edges.map((e) => e.source));
  for (const n of effectiveNodes) {
    const { w: nw, h: nh } = measureNode(n, includeAttributes);
    const color = typeColor[n.data.featureType] ?? "#2b6cff";
    const isAbstract = n.data.abstract ?? hasChildren.has(n.id);
    const fill = isAbstract ? "#e5e7eb" : "#ffffff";
    const attrs = includeAttributes ? n.data.attributes : [];
    const hasExtras = !!n.data.cardinality || attrs.length > 0;

    const rows: string[] = [];
    let y = HEAD_H + 4;
    if (n.data.cardinality) {
      rows.push(
        `<text x="10" y="${y + 13}" fill="#111418aa" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">cardinality [${n.data.cardinality.lower}..${n.data.cardinality.upper}]</text>`
      );
      y += ROW_H;
    }
    for (const a of attrs) {
      rows.push(
        `<text x="10" y="${y + 13}" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">
           <tspan fill="#11141866">${escape(a.key)}</tspan>
           <tspan fill="#111418" dx="4">${escape(a.value)}</tspan>
         </text>`
      );
      y += ROW_H;
    }

    nodeSvgs.push(`<g transform="translate(${n.position.x},${n.position.y})" data-drag="node" data-id="${n.id}" style="cursor: move">
      <g transform="scale(${fScale})">
        <rect width="${nw}" height="${nh}" rx="14" ry="14" fill="${fill}" stroke="#111418" stroke-width="2"/>
        <text x="${nw / 2}" y="28" fill="#111418" font-size="15" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${escape(n.data.name)}</text>
        ${hasExtras ? `<line x1="10" y1="${HEAD_H}" x2="${nw - 10}" y2="${HEAD_H}" stroke="#11141822" stroke-width="1"/>` : ""}
        ${rows.join("\n")}
      </g>
    </g>`);
  }
  void typeColor;

  // legend — uniform grid (vertical = 1×9, horizontal = 3×3).
  // Items are placed by (col,row) so per-column X and per-row Y are
  // identical by construction → perfect alignment. Row height (LG_ROW_H=34)
  // is larger than the tallest icon (cardinality: extent -10..+20 = 30) so
  // adjacent rows cannot overlap in either layout.
  let legendSvg = "";
  if (legend) {
    // --- Icons (origin = vertical midline of the row, left edge = x=0) ---
    const iconMandatory = `<circle cx="${LG_ICON_W / 2}" cy="0" r="7" fill="#111418" stroke="#111418" stroke-width="2"/>`;
    const iconOptional  = `<circle cx="${LG_ICON_W / 2}" cy="0" r="7" fill="#ffffff" stroke="#111418" stroke-width="2"/>`;

    // Shared "V" arms that mimic the real diagram (apex top-center).
    const arms = `<path d="M 2 10 L 16 -10 L 30 10" fill="none" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>`;
    const piePath = `M 16 -10 L 7.2 2 A 12 12 0 0 0 24.8 2 Z`;

    const iconAlt = `${arms}
      <path d="${piePath}" fill="#ffffff" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>`;
    const iconOr = `${arms}
      <path d="${piePath}" fill="#11141822" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>`;
    const iconCard = `${arms}
      <path d="${piePath}" fill="#ffffff" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>
      <text x="16" y="18" fill="#111418" font-size="9" font-weight="600" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">[n..m]</text>`;

    const iconAbstract  = `<rect x="0"  y="-11" width="${LG_ICON_W}" height="22" rx="6" ry="6" fill="#e5e7eb" stroke="#111418" stroke-width="2"/>`;
    const iconConcrete  = `<rect x="0"  y="-11" width="${LG_ICON_W}" height="22" rx="6" ry="6" fill="#ffffff" stroke="#111418" stroke-width="2"/>`;

    const iconRequires = `<defs><marker id="lg-arrow-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/></marker></defs>
      <path d="M 2 0 L ${LG_ICON_W - 2} 0" fill="none" stroke="#334155" stroke-width="1.8" stroke-dasharray="5 3" marker-end="url(#lg-arrow-c)"/>`;
    const iconExcludes = `<path d="M 2 0 L ${LG_ICON_W - 2} 0" fill="none" stroke="#334155" stroke-width="1.8" stroke-dasharray="5 3" marker-start="url(#lg-arrow-c)" marker-end="url(#lg-arrow-c)"/>`;

    const items: { icon: string; label: string }[] = [
      { icon: iconMandatory, label: "Mandatory" },
      { icon: iconOptional,  label: "Optional" },
      { icon: iconAlt,       label: "Alternative (XOR)" },
      { icon: iconOr,        label: "Or (≥1)" },
      { icon: iconCard,      label: "Cardinality" },
      { icon: iconAbstract,  label: "Abstract feature" },
      { icon: iconConcrete,  label: "Concrete feature" },
      { icon: iconRequires,  label: "Requires" },
      { icon: iconExcludes,  label: "Excludes" },
    ];

    const cells = items
      .map((it, i) => {
        const col = i % LG_COLS;
        const row = Math.floor(i / LG_COLS);
        const cellX = LG_PAD_X + col * (LG_ITEM_W + LG_COL_GAP);
        const cellY = LG_PAD_TOP + row * LG_ROW_H + LG_ROW_H / 2;
        return `
      <g transform="translate(${cellX},${cellY})">${it.icon}</g>
      <text x="${cellX + LG_ICON_W + LG_ICON_LBL_GAP}" y="${cellY + 5}" fill="#111418" font-size="12" font-family="system-ui, sans-serif">${it.label}</text>`;
      })
      .join("");

    legendSvg = `<g transform="translate(${legendX},${legendY})" data-drag="legend" style="cursor: move">
      <g transform="scale(${lScale})">
        <rect width="${legendW_BASE}" height="${legendH_BASE}" rx="14" ry="14" fill="#ffffff" stroke="#d0d5dd" stroke-width="1"/>
        <text x="${LG_PAD_X}" y="26" fill="#111418" font-size="13" font-weight="700" font-family="system-ui, sans-serif">Legend</text>
        <line x1="${LG_PAD_X}" y1="34" x2="${legendW_BASE - LG_PAD_X}" y2="34" stroke="#00000014"/>
        ${cells}
      </g>
    </g>`;
  }

  // Visual constraint lines (requires / excludes) rendered on the diagram
  const constraintLinesSvg: string[] = [];
  if (drawConstraintLines && constraints.length) {
    const byName = new Map<string, FMNode>();
    for (const n of effectiveNodes) byName.set(n.data.name, n);
    const allRects = effectiveNodes.map((n) => {
      const m = measureRendered(n);
      return { x: n.position.x, y: n.position.y, w: m.w, h: m.h, _id: n.id };
    });

    const orthRoute = (a: any, b: any) => {
      const EXIT = 18, CLEAR = 16;
      const anchorsOf = (r: any) => ({
        top:    { x: r.x + r.w / 2, y: r.y, side: "top" },
        bottom: { x: r.x + r.w / 2, y: r.y + r.h, side: "bottom" },
        left:   { x: r.x, y: r.y + r.h / 2, side: "left" },
        right:  { x: r.x + r.w, y: r.y + r.h / 2, side: "right" },
      });
      const step = (p: any) => p.side === "top" ? { x: p.x, y: p.y - EXIT } :
                               p.side === "bottom" ? { x: p.x, y: p.y + EXIT } :
                               p.side === "left" ? { x: p.x - EXIT, y: p.y } :
                               { x: p.x + EXIT, y: p.y };
      const hit = (ax: number, ay: number, bx: number, by: number) => {
        const vert = ax === bx;
        for (const r of allRects) {
          if (r._id === a._id || r._id === b._id) continue;
          const l = r.x - CLEAR, rt = r.x + r.w + CLEAR;
          const t = r.y - CLEAR, bt = r.y + r.h + CLEAR;
          if (vert) {
            const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
            if (ax >= l && ax <= rt && y1 >= t && y0 <= bt) return true;
          } else {
            const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
            if (ay >= t && ay <= bt && x1 >= l && x0 <= rt) return true;
          }
        }
        return false;
      };
      const pathHits = (pts: any[]) => {
        for (let i = 0; i < pts.length - 1; i++)
          if (hit(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y)) return true;
        return false;
      };

      const aa = anchorsOf(a), bb = anchorsOf(b);
      let best: { pts: any[]; len: number } | null = null;
      for (const sa of Object.values(aa)) for (const sb of Object.values(bb)) {
        const p1 = { x: sa.x, y: sa.y };
        const p2 = step(sa);
        const p4 = step(sb);
        const p5 = { x: sb.x, y: sb.y };
        for (const pts of [
          [p1, p2, { x: p4.x, y: p2.y }, p4, p5],
          [p1, p2, { x: p2.x, y: p4.y }, p4, p5],
        ]) {
          if (pathHits(pts)) continue;
          const len = pts.reduce((s, p, i) => s + (i === 0 ? 0 : Math.abs(p.x - pts[i-1].x) + Math.abs(p.y - pts[i-1].y)), 0);
          if (!best || len < best.len) best = { pts, len };
        }
      }
      if (!best) return [
        { x: a.x + a.w / 2, y: a.y + a.h / 2 },
        { x: b.x + b.w / 2, y: a.y + a.h / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      ];
      return best.pts;
    };

    constraintLinesSvg.push(`<defs><marker id="sv-arrow-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/></marker></defs>`);

    // Route all constraint lines through independent lanes BELOW the tree
    // so they never overlap, with a single neutral colour.
    let maxBottom = 0;
    for (const n of effectiveNodes) {
      const m = measureRendered(n);
      const b = n.position.y + m.h;
      if (b > maxBottom) maxBottom = b;
    }
    const LANE_GAP = 28;
    const visual = parseVisualConstraints(constraints);

    visual.forEach((v, idx) => {
      const aName = v.kind === "requires" ? v.from : v.a;
      const bName = v.kind === "requires" ? v.to : v.b;
      const a = allRects.find((r) => byName.get(aName)?.id === r._id);
      const b = allRects.find((r) => byName.get(bName)?.id === r._id);
      if (!a || !b) return;
      const laneY = maxBottom + 40 + idx * LANE_GAP;
      const sx = a.x + a.w / 2;
      const sy = a.y + a.h;
      const tx = b.x + b.w / 2;
      const ty = b.y + b.h;
      const d = `M ${sx} ${sy} L ${sx} ${laneY} L ${tx} ${laneY} L ${tx} ${ty}`;
      const markerStart = v.kind === "excludes" ? 'marker-start="url(#sv-arrow-c)"' : "";
      constraintLinesSvg.push(
        `<path d="${d}" fill="none" stroke="#334155" stroke-width="1.8" stroke-dasharray="6 4" stroke-linejoin="round" ${markerStart} marker-end="url(#sv-arrow-c)"/>`
      );
    });
    void orthRoute;
  }

  // constraints block — always lives in the right column. When the legend
  // is on the right it sits underneath; otherwise it occupies the right
  // column on its own at the top.
  let constraintsSvg = "";
  if (hasConsBlock) {
    // Inner SVG uses BASE dimensions; the wrapper applies cScale so the
    // whole block (rect + title + rows) grows together.
    const boxW = SIDE_W_BASE;
    const boxH = consBlockH_BASE;
    const rows = constraints
      .map((c, i) => {
        const y = CONS_PAD + CONS_HEAD_H + i * CONS_LINE_H + 12;
        return `<text x="${CONS_PAD}" y="${y}" fill="#111418" font-size="11.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escape(c.expr)}</text>`;
      })
      .join("\n");
    constraintsSvg = `<g transform="translate(${consX},${consY})" data-drag="cons" style="cursor: move">
      <g transform="scale(${cScale})">
        <rect width="${boxW}" height="${boxH}" rx="14" ry="14" fill="#ffffff" stroke="#d0d5dd" stroke-width="1"/>
        <text x="${CONS_PAD}" y="${CONS_PAD + 14}" fill="#111418" font-size="13" font-weight="700" font-family="system-ui, sans-serif">Cross-tree constraints</text>
        <line x1="${CONS_PAD}" y1="${CONS_PAD + 20}" x2="${boxW - CONS_PAD}" y2="${CONS_PAD + 20}" stroke="#00000014"/>
        ${rows}
      </g>
    </g>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${bg}
  <g transform="translate(${tx},${ty})">
    ${edgeSvgs.join("\n")}
    ${arcSvgs.join("\n")}
    ${constraintLinesSvg.join("\n")}
    ${nodeSvgs.join("\n")}
    ${markerSvgs.join("\n")}
    ${legendSvg}
    ${constraintsSvg}
  </g>
</svg>`;
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSVG(svg: string, filename = "feature-model.svg") {
  download(filename, new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
}

async function svgToCanvas(svg: string, scale = 2): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    const loaded = new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
    });
    img.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPNG(svg: string, opts: { transparent?: boolean } = {}, filename = "feature-model.png") {
  const canvas = await svgToCanvas(svg, 2);
  if (!opts.transparent) {
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#0f0f10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  canvas.toBlob((b) => {
    if (b) download(filename, b);
  }, "image/png");
}

export async function exportJPG(svg: string, filename = "feature-model.jpg") {
  const canvas = await svgToCanvas(svg, 2);
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#0f0f10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  canvas.toBlob((b) => {
    if (b) download(filename, b);
  }, "image/jpeg", 0.95);
}

/**
 * PDF export — rasterized at 3× DPI from the same SVG used for on-screen
 * preview. Previously this went through svg2pdf.js for vector output, but
 * svg2pdf's text metrics consistently disagreed with the browser's, so
 * feature-name text inside boxes ended up mispositioned and clipped (the
 * user's standing complaint). Rasterizing the live SVG guarantees the PDF
 * looks IDENTICAL to what the user sees in the preview / SVG export — no
 * font-fetch dependency, no CDN, no font-metric drift between viewers.
 *
 * Tradeoff: PDF text is no longer selectable. For LaTeX / Overleaf this is
 * acceptable — \includegraphics handles raster-embedded PDFs fine. If
 * vector PDF is later needed, the original svg2pdf-based path lives in git
 * history (commit before this one) and can be brought back behind a flag.
 */
export async function exportPDF(svg: string, opts: { transparent?: boolean } = {}, filename = "feature-model.pdf") {
  const { jsPDF } = await import("jspdf");

  // Read native SVG dimensions from the document — these become the PDF
  // page size (in points = 1:1 with SVG px so nothing gets scaled).
  const m = svg.match(/<svg [^>]*width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/);
  const w = m ? parseFloat(m[1]) : 600;
  const h = m ? parseFloat(m[2]) : 400;

  // 3× supersample = print-quality (≈216 dpi when the PDF is shown at 1:1).
  const canvas = await svgToCanvas(svg, 3);
  if (!opts.transparent) {
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const dataUrl = canvas.toDataURL("image/png");

  const pdf = new jsPDF({
    unit: "pt",
    format: [w, h],
    orientation: w >= h ? "landscape" : "portrait",
    compress: true,
  });
  pdf.addImage(dataUrl, "PNG", 0, 0, w, h, undefined, "FAST");
  download(filename, pdf.output("blob"));
}

