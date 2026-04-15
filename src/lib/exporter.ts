import type { FMEdge, FMNode } from "./store";
import type { Constraint, Group } from "./types";
import { parseVisualConstraints } from "./constraintParser";

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const NODE_MIN_W = 140;  // matches FeatureNode's `min-w-[140px]`
const NODE_PAD = 24;     // same as src/lib/layout.ts
const CHAR_W = 8;
const ROW_H = 16;
const HEAD_H = 40;

const measureNode = (n: FMNode, includeAttrs = true) => {
  const attrLines = includeAttrs ? (n.data.attributes?.length ?? 0) : 0;
  const cardLine = n.data.cardinality ? 1 : 0;
  const h = HEAD_H + (attrLines + cardLine) * ROW_H + (attrLines + cardLine > 0 ? 6 : 0);
  // Width must follow the same rule as the on-screen layout so the exported
  // SVG reflects the spacing the user sees (long names no longer overlap).
  const nameW = (n.data.name?.length ?? 0) * CHAR_W;
  const w = Math.max(NODE_MIN_W, Math.ceil(nameW + NODE_PAD * 2));
  return { w, h };
};

function computeBounds(nodes: FMNode[], includeAttrs: boolean, pad = 40): Bounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 400, maxY: 200 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    const { w, h } = measureNode(n, includeAttrs);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
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

export type ExportOptions = {
  transparent?: boolean;
  legend?: boolean;
  includeAttributes?: boolean;
  drawConstraintLines?: boolean;
  /** Render the list of cross-tree constraints as a side block. */
  showConstraintsBlock?: boolean;
};

export function buildSVG(
  nodes: FMNode[],
  edges: FMEdge[],
  groups: Group[],
  opts: ExportOptions & { constraints?: Constraint[] } = {}
): string {
  const {
    transparent = false,
    legend = false,
    includeAttributes = true,
    drawConstraintLines = true,
    showConstraintsBlock = true,
    constraints = [],
  } = opts;
  const bounds = computeBounds(nodes, includeAttributes);

  const SIDE_W = 240;
  const SIDE_GAP = 48;
  const LEGEND_H = 330;
  const LEGEND_TOP = 24;

  // Constraints side-block geometry
  const CONS_LINE_H = 18;
  const CONS_HEAD_H = 24;
  const CONS_PAD = 16;
  const hasConsBlock = showConstraintsBlock && constraints.length > 0;
  const consBlockH = hasConsBlock
    ? CONS_PAD * 2 + CONS_HEAD_H + constraints.length * CONS_LINE_H
    : 0;
  const consBlockY = legend ? LEGEND_TOP + LEGEND_H + 16 : LEGEND_TOP;

  const hasSideCol = legend || hasConsBlock;
  const sideColBottom = hasSideCol
    ? (hasConsBlock ? consBlockY + consBlockH : LEGEND_TOP + LEGEND_H)
    : 0;

  const extraW = hasSideCol ? SIDE_W + SIDE_GAP : 0;
  const diagramW = bounds.maxX - bounds.minX;
  const diagramH = bounds.maxY - bounds.minY;
  const w = diagramW + extraW;
  const h = Math.max(diagramH, sideColBottom + 24);
  const tx = -bounds.minX;
  const ty = -bounds.minY;

  const bg = transparent ? "" : `<rect width="${w}" height="${h}" fill="#ffffff"/>`;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const edgeSvgs: string[] = [];
  // Bolitas (mandatory/optional markers) rendered AFTER the nodes so they
  // sit on top — half outside, half hiding the node border — instead of
  // being clipped behind the feature box.
  const markerSvgs: string[] = [];
  for (const e of edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    const sm = measureNode(s, includeAttributes);
    const tm = measureNode(t, includeAttributes);
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
    const pm = measureNode(p, includeAttributes);
    const px = p.position.x + pm.w / 2;
    const py = p.position.y + pm.h;
    const angles = childs.map((c) => {
      const cm = measureNode(c, includeAttributes);
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

  // nodes
  const nodeSvgs: string[] = [];
  const hasChildren = new Set(edges.map((e) => e.source));
  for (const n of nodes) {
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
        `<text x="10" y="${y + 11}" fill="#111418aa" font-size="10.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">cardinality [${n.data.cardinality.lower}..${n.data.cardinality.upper}]</text>`
      );
      y += ROW_H;
    }
    for (const a of attrs) {
      rows.push(
        `<text x="10" y="${y + 11}" font-size="10.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">
           <tspan fill="#11141866">${escape(a.key)}</tspan>
           <tspan fill="#111418" dx="4">${escape(a.value)}</tspan>
         </text>`
      );
      y += ROW_H;
    }

    nodeSvgs.push(`<g transform="translate(${n.position.x},${n.position.y})">
      <rect width="${nw}" height="${nh}" rx="14" ry="14" fill="${fill}" stroke="#111418" stroke-width="2"/>
      <text x="${nw / 2}" y="25" fill="#111418" font-size="13" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${escape(n.data.name)}</text>
      ${hasExtras ? `<line x1="10" y1="${HEAD_H}" x2="${nw - 10}" y2="${HEAD_H}" stroke="#11141822" stroke-width="1"/>` : ""}
      ${rows.join("\n")}
    </g>`);
  }
  void typeColor;

  // legend
  let legendSvg = "";
  if (legend) {
    const lx = bounds.maxX - bounds.minX + SIDE_GAP;
    const ly = LEGEND_TOP;
    const LEGEND_W = SIDE_W;

    // Every icon lives in an identical 32×22 local box, so the column of
    // icons stays vertically aligned and all shapes look the same size.
    const ICON_W = 32;
    const row = (y: number, icon: string, label: string) => `
      <g transform="translate(20,${y})">${icon}</g>
      <text x="${20 + ICON_W + 14}" y="${y + 5}" fill="#111418" font-size="12" font-family="system-ui, sans-serif">${label}</text>`;

    // --- Icons (origin = vertical midline of the row) ---

    const iconMandatory = `<circle cx="${ICON_W / 2}" cy="0" r="7" fill="#111418" stroke="#111418" stroke-width="2"/>`;
    const iconOptional  = `<circle cx="${ICON_W / 2}" cy="0" r="7" fill="#ffffff" stroke="#111418" stroke-width="2"/>`;

    // Shared "V" arms that mimic the real diagram: apex at top-center, arms
    // spreading to the two bottom corners of the 32×22 box.
    // apex (16, -10), left (2, 10), right (30, 10) — identical for alt/or/card.
    const arms = `<path d="M 2 10 L 16 -10 L 30 10" fill="none" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>`;
    // Arc of radius 12 tangent to each arm, between them. Same arc for all 3.
    const arcPath = `M 7.2 2 A 12 12 0 0 1 24.8 2`;
    const piePath = `M 16 -10 L 7.2 2 A 12 12 0 0 0 24.8 2 Z`;

    // All three group icons share the same triangle shape (arms + pie sector);
    // only the fill of the sector changes so they read as a family.
    const iconAlt = `${arms}
      <path d="${piePath}" fill="#ffffff" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>`;
    const iconOr = `${arms}
      <path d="${piePath}" fill="#11141822" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>`;
    const iconCard = `${arms}
      <path d="${piePath}" fill="#ffffff" stroke="#111418" stroke-width="2" stroke-linejoin="round"/>
      <text x="16" y="18" fill="#111418" font-size="9" font-weight="600" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">[n..m]</text>`;

    const iconAbstract  = `<rect x="0"  y="-11" width="${ICON_W}" height="22" rx="6" ry="6" fill="#e5e7eb" stroke="#111418" stroke-width="2"/>`;
    const iconConcrete  = `<rect x="0"  y="-11" width="${ICON_W}" height="22" rx="6" ry="6" fill="#ffffff" stroke="#111418" stroke-width="2"/>`;

    const iconRequires = `<defs><marker id="lg-arrow-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/></marker></defs>
      <path d="M 2 0 L ${ICON_W - 2} 0" fill="none" stroke="#334155" stroke-width="1.8" stroke-dasharray="5 3" marker-end="url(#lg-arrow-c)"/>`;
    const iconExcludes = `<path d="M 2 0 L ${ICON_W - 2} 0" fill="none" stroke="#334155" stroke-width="1.8" stroke-dasharray="5 3" marker-start="url(#lg-arrow-c)" marker-end="url(#lg-arrow-c)"/>`;

    legendSvg = `<g transform="translate(${lx},${ly})">
      <rect width="${LEGEND_W}" height="${LEGEND_H}" rx="14" ry="14" fill="#ffffff" stroke="#d0d5dd" stroke-width="1"/>
      <text x="20" y="26" fill="#111418" font-size="13" font-weight="700" font-family="system-ui, sans-serif">Legend</text>
      <line x1="20" y1="34" x2="${LEGEND_W - 20}" y2="34" stroke="#00000014"/>

      ${row(60,  iconMandatory, "Mandatory")}
      ${row(88,  iconOptional,  "Optional")}
      ${row(120, iconAlt,       "Alternative (XOR)")}
      ${row(150, iconOr,        "Or (≥1)")}
      ${row(180, iconCard,      "Cardinality")}
      ${row(212, iconAbstract,  "Abstract feature")}
      ${row(240, iconConcrete,  "Concrete feature")}
      ${row(272, iconRequires,  "Requires")}
      ${row(300, iconExcludes,  "Excludes")}
    </g>`;
  }

  // Visual constraint lines (requires / excludes) rendered on the diagram
  const constraintLinesSvg: string[] = [];
  if (drawConstraintLines && constraints.length) {
    const byName = new Map<string, FMNode>();
    for (const n of nodes) byName.set(n.data.name, n);
    const allRects = nodes.map((n) => {
      const m = measureNode(n, includeAttributes);
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
    for (const n of nodes) {
      const m = measureNode(n, includeAttributes);
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

  // constraints block — lives in the right column under the legend (or in
  // the legend's place when there is no legend). Width matches the legend.
  let constraintsSvg = "";
  if (hasConsBlock) {
    const boxX = diagramW + SIDE_GAP;
    const boxY = consBlockY;
    const boxW = SIDE_W;
    const boxH = consBlockH;
    const rows = constraints
      .map((c, i) => {
        const y = CONS_PAD + CONS_HEAD_H + i * CONS_LINE_H + 12;
        return `<text x="${CONS_PAD}" y="${y}" fill="#111418" font-size="11.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escape(c.expr)}</text>`;
      })
      .join("\n");
    constraintsSvg = `<g transform="translate(${boxX},${boxY})">
      <rect width="${boxW}" height="${boxH}" rx="14" ry="14" fill="#ffffff" stroke="#d0d5dd" stroke-width="1"/>
      <text x="${CONS_PAD}" y="${CONS_PAD + 14}" fill="#111418" font-size="13" font-weight="700" font-family="system-ui, sans-serif">Cross-tree constraints</text>
      <line x1="${CONS_PAD}" y1="${CONS_PAD + 20}" x2="${boxW - CONS_PAD}" y2="${CONS_PAD + 20}" stroke="#00000014"/>
      ${rows}
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
  </g>
  ${legendSvg}
  ${constraintsSvg}
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

/** Fetch a TTF from jsdelivr and keep it in a module-level cache so the
 *  second PDF export doesn't re-download ~300 KB per typeface. Returns the
 *  binary encoded as a base64 string (what jsPDF's VFS expects). */
const _fontCache = new Map<string, string>();
async function fetchFontBase64(url: string): Promise<string> {
  const hit = _fontCache.get(url);
  if (hit) return hit;
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`font fetch ${r.status}`);
    return r.arrayBuffer();
  });
  // ArrayBuffer → base64 (no node Buffer in browser)
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  _fontCache.set(url, b64);
  return b64;
}

// @fontsource ships plain .ttf files on jsdelivr — same weights used by our
// SVG (600 for feature names / group titles, 400 elsewhere; mono 400).
const FONT_INTER_REGULAR = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.17/files/inter-latin-400-normal.ttf";
const FONT_INTER_BOLD    = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.17/files/inter-latin-600-normal.ttf";
const FONT_MONO_REGULAR  = "https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.20/files/jetbrains-mono-latin-400-normal.ttf";

async function embedPdfFonts(pdf: any) {
  const [inter, interBold, mono] = await Promise.all([
    fetchFontBase64(FONT_INTER_REGULAR),
    fetchFontBase64(FONT_INTER_BOLD),
    fetchFontBase64(FONT_MONO_REGULAR),
  ]);
  pdf.addFileToVFS("Inter-Regular.ttf", inter);
  pdf.addFont("Inter-Regular.ttf", "Inter", "normal");
  pdf.addFileToVFS("Inter-Bold.ttf", interBold);
  pdf.addFont("Inter-Bold.ttf", "Inter", "bold");
  pdf.addFileToVFS("JetBrainsMono-Regular.ttf", mono);
  pdf.addFont("JetBrainsMono-Regular.ttf", "JetBrainsMono", "normal");
}

/**
 * Vector PDF export via svg2pdf.js — every shape and glyph stays vector so
 * the file is crisp at any zoom in LaTeX / Overleaf / printers. Text uses
 * real Inter (sans) and JetBrains Mono (mono), embedded in the PDF so it
 * looks the same on every machine instead of falling back to Helvetica.
 */
export async function exportPDF(svg: string, _opts: { transparent?: boolean } = {}, filename = "feature-model.pdf") {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import("jspdf"),
    import("svg2pdf.js"),
  ]);

  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement as unknown as SVGSVGElement;
  const w = parseFloat(el.getAttribute("width") || "600");
  const h = parseFloat(el.getAttribute("height") || "400");
  sanitizeSvgForPdf(el);

  const pdf = new jsPDF({
    unit: "pt",
    format: [w, h],
    orientation: w >= h ? "landscape" : "portrait",
    compress: true,
  });

  // Try to embed proper typefaces; if the CDN is unreachable we silently
  // fall back to Helvetica so the export still succeeds.
  try {
    await embedPdfFonts(pdf);
  } catch {
    // leave default; sanitizeSvgForPdf already normalized to helvetica/courier
  }

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    await svg2pdf(el, pdf, { x: 0, y: 0, width: w, height: h });
    download(filename, pdf.output("blob"));
  } finally {
    host.remove();
  }
}

/**
 * Prepare an SVG tree for svg2pdf.js:
 *  - splits 8-digit hex (#RRGGBBAA) into 6-digit hex + fill-opacity /
 *    stroke-opacity (svg2pdf parses alpha incorrectly and renders solid
 *    black fills or drops strokes otherwise).
 *  - normalizes font-family stacks to a name jsPDF ships in its VFS so
 *    glyphs stay vector instead of falling back to Times serif.
 */
function sanitizeSvgForPdf(root: SVGSVGElement) {
  const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i;
  const splitColor = (v: string | null) => {
    if (!v) return null;
    const m = hex8.exec(v.trim());
    if (!m) return null;
    const alpha = parseInt(m[2], 16) / 255;
    return { color: `#${m[1]}`, opacity: alpha.toFixed(3) };
  };
  const pickFont = (family: string) => {
    const f = family.toLowerCase();
    if (f.includes("mono") || f.includes("courier") || f.includes("sfmono") || f.includes("consolas") || f.includes("menlo")) {
      // Inter + JetBrains Mono are embedded in the PDF (see embedPdfFonts),
      // so glyphs remain vector AND keep a modern look very close to the
      // system-ui / ui-monospace the SVG uses on screen.
      return "JetBrainsMono";
    }
    return "Inter";
  };
  const walk = (node: Element) => {
    for (const attr of ["fill", "stroke"] as const) {
      const split = splitColor(node.getAttribute(attr));
      if (split) {
        node.setAttribute(attr, split.color);
        const opAttr = attr === "fill" ? "fill-opacity" : "stroke-opacity";
        if (!node.getAttribute(opAttr)) node.setAttribute(opAttr, split.opacity);
      }
    }
    const style = node.getAttribute("style");
    if (style && /#([0-9a-f]{6})([0-9a-f]{2})/i.test(style)) {
      const newStyle = style.replace(
        /(fill|stroke)\s*:\s*#([0-9a-f]{6})([0-9a-f]{2})/gi,
        (_m, prop, rgb, aa) => {
          const a = parseInt(aa, 16) / 255;
          return `${prop}:#${rgb};${prop}-opacity:${a.toFixed(3)}`;
        }
      );
      node.setAttribute("style", newStyle);
    }
    const ff = node.getAttribute("font-family");
    if (ff) node.setAttribute("font-family", pickFont(ff));
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(root);
}

