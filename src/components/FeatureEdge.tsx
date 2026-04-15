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
  const { source, target, data, style, selected } = props;

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

  // FODA-style marker: circle is centered on the child's top-center border,
  // so half sits outside the node and half inside.
  const cx = tx;
  const cy = ty;

  // Line always ends at the top-center of the node (== circle center when
  // there is a marker).
  const endX = tx;
  const endY = ty;

  const [path] = getStraightPath({
    sourceX: sx, sourceY: sy, targetX: endX, targetY: endY,
  });

  // Markers (the mandatory/optional bolita) live in EdgeMarkers overlay so
  // they paint on top of nodes — inside the edge layer React Flow clips
  // them behind the feature boxes.
  void cx; void cy; void R; void rel;
  const selStyle = selected ? { stroke: "#2b6cff", strokeWidth: 3 } : undefined;
  return <BaseEdge id={props.id} path={path} style={{ ...style, ...selStyle }} />;
}
