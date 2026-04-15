"use client";
import { BaseEdge, getStraightPath, useStore, type EdgeProps } from "@xyflow/react";

/**
 * Parent→child edge with FODA-style marker at the child end.
 * We ignore the handle positions that React Flow passes in and instead
 * compute endpoints from the actual node bounding boxes, so the line goes
 * from the bottom center of the parent to the top center of the child
 * (touching both boxes exactly).
 */
export default function FeatureEdge(props: EdgeProps) {
  const { source, target, data, style } = props;

  const endpoints = useStore((s) => {
    const src = s.nodeLookup.get(source);
    const tgt = s.nodeLookup.get(target);
    if (!src || !tgt) return null;
    const sw = src.measured?.width ?? 160;
    const sh = src.measured?.height ?? 48;
    const tw = tgt.measured?.width ?? 160;
    return {
      sx: src.position.x + sw / 2,
      sy: src.position.y + sh,
      tx: tgt.position.x + tw / 2,
      ty: tgt.position.y,
    };
  });

  if (!endpoints) return null;
  const { sx, sy, tx, ty } = endpoints;

  const rel = (data as any)?.parentRel ?? "mandatory";
  const inGroup = !!(data as any)?.inGroup;

  const R = 8;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;

  // Circle sits tangent to the child's top edge (center at R away from ty).
  const cx = tx - ux * R;
  const cy = ty - uy * R;

  // Stop the edge line at the OUTER tangent of the circle (2R away from the
  // node border). That way the line doesn't pass through the filled disc and
  // the mandatory marker reads as a clean circle, not as two half-arcs.
  const endX = inGroup ? tx : tx - ux * 2 * R;
  const endY = inGroup ? ty : ty - uy * 2 * R;

  const [path] = getStraightPath({
    sourceX: sx, sourceY: sy, targetX: endX, targetY: endY,
  });

  return (
    <>
      <BaseEdge id={props.id} path={path} style={style} />
      {!inGroup && (
        <circle
          cx={cx}
          cy={cy}
          r={R}
          className={rel === "mandatory" ? "fm-marker-mandatory" : "fm-marker-optional"}
          strokeWidth={2}
        />
      )}
    </>
  );
}
