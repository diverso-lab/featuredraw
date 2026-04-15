"use client";
import { useFM } from "@/lib/store";
import { useStore, useViewport } from "@xyflow/react";
import { useMemo } from "react";

/**
 * Overlay drawn in pane-local coordinates. We transform once with RF's viewport
 * matrix so arcs stay glued to parent nodes through pan/zoom.
 */
export default function GroupArcs() {
  const groups = useFM((s) => s.groups);
  const fmNodes = useFM((s) => s.nodes);
  const rfNodes = useStore((s) => s.nodeLookup);
  const { x: tx, y: ty, zoom } = useViewport();

  const arcs = useMemo(() => {
    return groups
      .map((g) => {
        // "and" groups are purely a logical container for mandatory/optional
        // children — they carry no FODA-style visual notation.
        if (g.type === "and") return null;
        const parent = fmNodes.find((n) => n.id === g.parentId);
        const children = g.childrenIds
          .map((cid) => fmNodes.find((n) => n.id === cid))
          .filter(Boolean) as typeof fmNodes;
        if (!parent || children.length < 1) return null;

        const pMeasured = rfNodes.get(parent.id)?.measured;
        // Skip drawing until React Flow has measured the involved nodes.
        // Otherwise arcs appear "floating" with fallback sizes during load.
        if (!pMeasured?.width || !pMeasured?.height) return null;
        const pW = pMeasured.width;
        const pH = pMeasured.height;
        const px = parent.position.x + pW / 2;
        const py = parent.position.y + pH;

        let missingChild = false;
        const childTops = children.map((c) => {
          const m = rfNodes.get(c.id)?.measured;
          if (!m?.width) missingChild = true;
          const cw = m?.width ?? 0;
          return { x: c.position.x + cw / 2, y: c.position.y };
        });
        if (missingChild) return null;

        const angles = childTops.map((c) => Math.atan2(c.y - py, c.x - px));
        const a1 = Math.min(...angles);
        const a2 = Math.max(...angles);
        if (!isFinite(a1) || !isFinite(a2) || a2 - a1 < 0.02) return null;

        const r = 28; // flow-units
        const sx = px + r * Math.cos(a1);
        const sy = py + r * Math.sin(a1);
        const ex = px + r * Math.cos(a2);
        const ey = py + r * Math.sin(a2);
        const large = a2 - a1 > Math.PI ? 1 : 0;
        const path = `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
        const pie = `M ${px} ${py} L ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} Z`;

        return {
          id: g.id,
          type: g.type,
          path,
          pie,
          label:
            g.type === "cardinality" && g.cardinality
              ? `[${g.cardinality.lower}..${g.cardinality.upper}]`
              : null,
          labelX: px,
          labelY: py + r + 12,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      type: string;
      path: string;
      pie: string;
      label: string | null;
      labelX: number;
      labelY: number;
    }>;
  }, [groups, fmNodes, rfNodes]);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="100%"
      height="100%"
      style={{ zIndex: 5, overflow: "hidden" }}
    >
      <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
        {arcs.map((a) => (
          <g key={a.id}>
            {(a.type === "or" || a.type === "cardinality") && (
              <>
                {/* Opaque white underlay first so the tree edge that crosses
                    the sector stays hidden behind the arc. */}
                <path d={a.pie} fill="#ffffff" stroke="none" />
                <path d={a.pie} className="fm-arc filled" />
              </>
            )}
            <path d={a.path} className="fm-arc" />
            {a.label && (
              <text
                x={a.labelX}
                y={a.labelY}
                textAnchor="middle"
                fill="#111"
                fontSize={11}
              >
                {a.label}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}
