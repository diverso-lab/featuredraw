"use client";
import { BaseEdge, useReactFlow, useStore, type EdgeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useFM } from "@/lib/store";

type Data = {
  kind: "requires" | "excludes";
  constraintId: string;
  laneY: number;
  routeSourceX?: number;
  routeTargetX?: number;
};

const COLOR = "#334155";
const HANDLE_FILL = "#ffffff";
const HANDLE_STROKE = "#1d4ed8";

/**
 * Constraint edge rendered as a U-shape (down → across → up) under the tree.
 * Three invisible "hit" rectangles overlay each segment so the user can grab:
 *   - vertical source segment  → drag left/right to slide source exit X
 *   - horizontal lane segment  → drag up/down to change the lane Y
 *   - vertical target segment  → drag left/right to slide target entry X
 * The anchors at the source/target features stay attached (source_y = A.bottom,
 * target_y = B.bottom), so dragging never "detaches" the line.
 */
export default function ConstraintEdge(props: EdgeProps) {
  const { source, target, data, selected } = props;
  const d = data as Data;
  const rf = useReactFlow();
  const setConstraintRoute = useFM((s) => s.setConstraintRoute);

  const endpoints = useStore((s) => {
    const src = s.nodeLookup.get(source);
    const tgt = s.nodeLookup.get(target);
    if (!src || !tgt) return null;
    const sw = src.measured?.width ?? 160;
    const sh = src.measured?.height ?? 48;
    const tw = tgt.measured?.width ?? 160;
    const th = tgt.measured?.height ?? 48;
    return {
      srcL: src.position.x,
      srcR: src.position.x + sw,
      sy: src.position.y + sh,
      tgtL: tgt.position.x,
      tgtR: tgt.position.x + tw,
      ty: tgt.position.y + th,
      scx: src.position.x + sw / 2,
      tcx: tgt.position.x + tw / 2,
    };
  });

  const [drag, setDrag] = useState<null | "src" | "lane" | "tgt">(null);
  const startRef = useRef<{ x: number; y: number; base: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const pt = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      if (drag === "lane") {
        setConstraintRoute(d.constraintId, { laneY: Math.round(pt.y) });
      } else if (drag === "src") {
        setConstraintRoute(d.constraintId, { sourceX: Math.round(pt.x) });
      } else if (drag === "tgt") {
        setConstraintRoute(d.constraintId, { targetX: Math.round(pt.x) });
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, d.constraintId, rf, setConstraintRoute]);

  if (!endpoints) return null;
  const { srcL, srcR, sy, tgtL, tgtR, ty, scx, tcx } = endpoints;

  // Resolve the effective coords, clamping user-supplied offsets to the
  // bounding box of the source/target features so the line never detaches.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const sx = d.routeSourceX != null ? clamp(d.routeSourceX, srcL + 6, srcR - 6) : scx;
  const tx = d.routeTargetX != null ? clamp(d.routeTargetX, tgtL + 6, tgtR - 6) : tcx;
  const laneY = d.laneY;

  const path = `M ${sx} ${sy} L ${sx} ${laneY} L ${tx} ${laneY} L ${tx} ${ty}`;

  const markerStart = d.kind === "excludes" ? "url(#fd-cons-arrow)" : undefined;
  const markerEnd = "url(#fd-cons-arrow)";

  // midpoints for drag handles
  const hSrc = { x: sx, y: (sy + laneY) / 2 };
  const hLane = { x: (sx + tx) / 2, y: laneY };
  const hTgt = { x: tx, y: (laneY + ty) / 2 };

  const Handle = ({ x, y, cursor, onDown }: { x: number; y: number; cursor: string; onDown: () => void }) => (
    <g
      transform={`translate(${x} ${y})`}
      style={{ cursor, pointerEvents: "all" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        onDown();
      }}
    >
      <rect x={-5} y={-5} width={10} height={10} rx={2} ry={2} fill={HANDLE_FILL} stroke={HANDLE_STROKE} strokeWidth={1.5} />
    </g>
  );

  return (
    <>
      <defs>
        <marker
          id="fd-cons-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={COLOR} />
        </marker>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke: COLOR,
          strokeWidth: selected ? 2.5 : 1.8,
          strokeDasharray: "6 4",
          strokeLinejoin: "round",
          strokeLinecap: "round",
          fill: "none",
        }}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />

      {/* Draggable handles — only shown when the edge is selected */}
      {selected && (
        <>
          <Handle x={hSrc.x}  y={hSrc.y}  cursor="ew-resize" onDown={() => setDrag("src")} />
          <Handle x={hLane.x} y={hLane.y} cursor="ns-resize" onDown={() => setDrag("lane")} />
          <Handle x={hTgt.x}  y={hTgt.y}  cursor="ew-resize" onDown={() => setDrag("tgt")} />
        </>
      )}
    </>
  );
}
