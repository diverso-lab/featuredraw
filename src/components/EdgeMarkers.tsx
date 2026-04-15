"use client";
import { useFM } from "@/lib/store";
import { useStore, useViewport } from "@xyflow/react";
import { useMemo } from "react";

/**
 * Renders the FODA-style mandatory/optional discs that sit half-in-half-out
 * on the child's top border. Lives in its own SVG overlay so the circles
 * paint ABOVE the feature boxes — inside the edge layer React Flow puts them
 * behind the nodes, so the lower half would be clipped.
 */
export default function EdgeMarkers() {
  const edges = useFM((s) => s.edges);
  const fmNodes = useFM((s) => s.nodes);
  const rfNodes = useStore((s) => s.nodeLookup);
  const { x: tx, y: ty, zoom } = useViewport();

  const markers = useMemo(() => {
    return edges
      .map((e) => {
        if ((e.data as any)?.inGroup) return null;
        const child = fmNodes.find((n) => n.id === e.target);
        if (!child) return null;
        const m = rfNodes.get(child.id)?.measured;
        if (!m?.width) return null;
        const cx = child.position.x + m.width / 2;
        const cy = child.position.y; // top border
        const rel = (e.data as any)?.parentRel ?? "mandatory";
        return {
          id: e.id,
          cx,
          cy,
          rel,
          selected: !!e.selected,
        };
      })
      .filter(Boolean) as Array<{ id: string; cx: number; cy: number; rel: "mandatory" | "optional"; selected: boolean }>;
  }, [edges, fmNodes, rfNodes]);

  const R = 8;
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="100%"
      height="100%"
      style={{ zIndex: 6, overflow: "hidden" }}
    >
      <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
        {markers.map((m) => (
          <circle
            key={m.id}
            cx={m.cx}
            cy={m.cy}
            r={R}
            fill={m.rel === "mandatory" ? "#111418" : "#ffffff"}
            stroke={m.selected ? "#2b6cff" : "#111418"}
            strokeWidth={m.selected ? 3 : 2}
          />
        ))}
      </g>
    </svg>
  );
}
