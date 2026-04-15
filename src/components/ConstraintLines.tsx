"use client";
import { useMemo } from "react";
import { useFM } from "@/lib/store";
import { useStore, useViewport } from "@xyflow/react";
import { parseVisualConstraints } from "@/lib/constraintParser";

type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

// Generous clearance so orthogonal paths glide around nodes.
const CLEAR = 16;

// Check segment (ax,ay)-(bx,by) against a set of rectangles.
// Assumes axis-aligned segment (either ax==bx or ay==by).
function segmentHitsRect(ax: number, ay: number, bx: number, by: number, rects: Rect[], skip: Set<string> = new Set()) {
  const vert = ax === bx;
  for (const r of rects) {
    if ((r as any)._id && skip.has((r as any)._id)) continue;
    const left = r.x - CLEAR, right = r.x + r.w + CLEAR;
    const top = r.y - CLEAR, bottom = r.y + r.h + CLEAR;
    if (vert) {
      const x = ax;
      const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      if (x >= left && x <= right && y1 >= top && y0 <= bottom) return true;
    } else {
      const y = ay;
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
      if (y >= top && y <= bottom && x1 >= left && x0 <= right) return true;
    }
  }
  return false;
}

function pathHits(pts: Pt[], rects: Rect[], skip: Set<string>) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentHitsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, rects, skip)) return true;
  }
  return false;
}

type Anchor = { x: number; y: number; side: "top" | "bottom" | "left" | "right" };

function anchorsOf(r: Rect): Record<string, Anchor> {
  return {
    top:    { x: r.x + r.w / 2, y: r.y, side: "top" },
    bottom: { x: r.x + r.w / 2, y: r.y + r.h, side: "bottom" },
    left:   { x: r.x, y: r.y + r.h / 2, side: "left" },
    right:  { x: r.x + r.w, y: r.y + r.h / 2, side: "right" },
  };
}

// Build an orthogonal path A→B using a small heuristic:
// - try every pair of anchors on A and B (4×4 = 16 candidates)
// - for each, use a 3-segment (S-shape) route: out → perpendicular → in
// - keep the candidate that doesn't cross any node and has the smallest length
function orthRoute(a: Rect, b: Rect, allRects: Rect[], skip: Set<string>): Pt[] {
  const aa = anchorsOf(a);
  const bb = anchorsOf(b);
  const EXIT = 18; // initial run out from the box on the chosen side

  const step = (p: Anchor): Pt => {
    switch (p.side) {
      case "top":    return { x: p.x, y: p.y - EXIT };
      case "bottom": return { x: p.x, y: p.y + EXIT };
      case "left":   return { x: p.x - EXIT, y: p.y };
      case "right":  return { x: p.x + EXIT, y: p.y };
    }
  };

  let best: { pts: Pt[]; len: number } | null = null;

  for (const sa of Object.values(aa)) {
    for (const sb of Object.values(bb)) {
      const p1 = { x: sa.x, y: sa.y };
      const p2 = step(sa);
      const p4 = step(sb);
      const p5 = { x: sb.x, y: sb.y };

      // Build an L-shape between p2 and p4 (a single bend): either horizontal-first
      // or vertical-first, whichever fits.
      const candidates: Pt[][] = [];

      // horizontal-first
      candidates.push([p1, p2, { x: p4.x, y: p2.y }, p4, p5]);
      // vertical-first
      candidates.push([p1, p2, { x: p2.x, y: p4.y }, p4, p5]);

      for (const pts of candidates) {
        if (pathHits(pts, allRects, skip)) continue;
        const len = pts.reduce((s, p, i) => s + (i === 0 ? 0 : Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y)), 0);
        if (!best || len < best.len) best = { pts, len };
      }
    }
  }

  if (best) return best.pts;

  // fallback: straight-through orthogonal via box centers (not obstacle-aware)
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  return [{ x: ax, y: ay }, { x: bx, y: ay }, { x: bx, y: by }];
}

function ptsToPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
}

export default function ConstraintLines() {
  const constraints = useFM((s) => s.constraints);
  const fmNodes = useFM((s) => s.nodes);
  const rfNodes = useStore((s) => s.nodeLookup);
  const { x: tx, y: ty, zoom } = useViewport();

  const data = useMemo(() => {
    const byName = new Map<string, typeof fmNodes[number]>();
    for (const n of fmNodes) byName.set(n.data.name, n);

    const rectOf = (n: typeof fmNodes[number] | undefined): Rect | null => {
      if (!n) return null;
      const m = rfNodes.get(n.id)?.measured;
      if (!m?.width || !m?.height) return null;
      return { x: n.position.x, y: n.position.y, w: m.width, h: m.height, ...(({} as any)), _id: n.id } as any;
    };

    const allRects = fmNodes.map((n) => rectOf(n)).filter(Boolean) as Rect[];

    const visual = parseVisualConstraints(constraints);
    return visual
      .map((v) => {
        if (v.kind === "requires") {
          const a = rectOf(byName.get(v.from));
          const b = rectOf(byName.get(v.to));
          if (!a || !b) return null;
          const skip = new Set<string>([(a as any)._id, (b as any)._id]);
          const pts = orthRoute(a, b, allRects, skip);
          return { kind: "requires" as const, id: v.id, pts };
        }
        const a = rectOf(byName.get(v.a));
        const b = rectOf(byName.get(v.b));
        if (!a || !b) return null;
        const skip = new Set<string>([(a as any)._id, (b as any)._id]);
        const pts = orthRoute(a, b, allRects, skip);
        return { kind: "excludes" as const, id: v.id, pts };
      })
      .filter(Boolean) as Array<{ kind: "requires" | "excludes"; id: string; pts: Pt[] }>;
  }, [constraints, fmNodes, rfNodes]);

  return (
    <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%" style={{ zIndex: 4, overflow: "visible" }}>
      <defs>
        <marker id="fd-arrow-req" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1d4ed8" />
        </marker>
      </defs>
      <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
        {data.map((s) => {
          const d = ptsToPath(s.pts);
          if (s.kind === "requires") {
            return (
              <path
                key={s.id}
                d={d}
                fill="none"
                stroke="#1d4ed8"
                strokeWidth={1.8}
                strokeDasharray="6 4"
                markerEnd="url(#fd-arrow-req)"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          }
          // excludes — find the midpoint of the middle segment for the × badge
          const midIdx = Math.floor(s.pts.length / 2);
          const pa = s.pts[Math.max(0, midIdx - 1)];
          const pb = s.pts[midIdx] ?? pa;
          const mx = (pa.x + pb.x) / 2;
          const my = (pa.y + pb.y) / 2;
          return (
            <g key={s.id}>
              <path
                d={d}
                fill="none"
                stroke="#b91c1c"
                strokeWidth={1.8}
                strokeDasharray="6 4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <g transform={`translate(${mx} ${my})`}>
                <circle r="9" fill="#ffffff" stroke="#b91c1c" strokeWidth="1.6" />
                <path d="M -4 -4 L 4 4 M -4 4 L 4 -4" stroke="#b91c1c" strokeWidth="1.8" strokeLinecap="round" />
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
