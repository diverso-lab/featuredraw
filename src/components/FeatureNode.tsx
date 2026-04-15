"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useFM } from "@/lib/store";
import type { FeatureNodeData } from "@/lib/types";

const typeColor: Record<string, string> = {
  Boolean: "#2b6cff",
  Integer: "#22a06b",
  Float: "#d98e00",
  String: "#b255d9",
};

export default function FeatureNode({ data, selected, id }: NodeProps) {
  const d = data as FeatureNodeData;
  const color = typeColor[d.featureType] ?? "#2b6cff";
  const updateNode = useFM((s) => s.updateNode);
  const hasChildren = useFM((s) => s.edges.some((e) => e.source === id));
  const isAbstract = d.abstract ?? hasChildren;

  // While the user is creating a cross-tree constraint, highlight every
  // candidate target feature. The starting feature gets a dashed outline.
  const pending = useFM((s) => s.pendingConstraint);
  const isPickingTarget = !!pending && pending.fromId !== id;
  const isSource = !!pending && pending.fromId === id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(d.name); }, [d.name]);
  useEffect(() => {
    if (editing) { ref.current?.focus(); ref.current?.select(); }
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== d.name) updateNode(id, { name: v });
    setEditing(false);
  };

  return (
    <div
      className={`rounded-xl border-2 px-3 py-2 min-w-[140px] text-center ${
        isPickingTarget ? "fd-node-target" : ""
      } ${isSource ? "fd-node-source" : ""}`}
      style={{
        background: isAbstract ? "#e5e7eb" : "#ffffff",
        borderColor: selected ? "#2b6cff" : "#111418",
        boxShadow: selected ? "0 0 0 2px #2b6cff33" : "0 1px 2px rgba(0,0,0,.06)",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "transparent", border: "none", width: 1, height: 1, top: 0 }}
      />
      {editing ? (
        <input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") { setDraft(d.name); setEditing(false); }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="nodrag text-sm font-semibold text-center bg-white outline-none border border-blue-400 rounded px-1 w-full"
        />
      ) : (
        <span
          className="text-sm font-semibold text-black/90 cursor-text"
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        >
          {d.name || id}
        </span>
      )}

      {(d.cardinality || d.attributes.length > 0) && (
        <div className="mt-1.5 pt-1.5 border-t border-black/10 text-left space-y-0.5">
          {d.cardinality && (
            <div className="text-[10.5px] font-mono text-black/60 px-0.5">
              cardinality [{d.cardinality.lower}..{d.cardinality.upper}]
            </div>
          )}
          {d.attributes.map((a, i) => (
            <div key={i} className="text-[10.5px] font-mono px-0.5 flex gap-1.5 truncate">
              <span className="text-black/40 truncate">{a.key}</span>
              <span className="text-black/80 truncate">{a.value}</span>
            </div>
          ))}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "transparent", border: "none", width: 1, height: 1, bottom: 0 }}
      />
    </div>
  );
}
