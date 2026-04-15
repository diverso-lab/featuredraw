"use client";
import { useEffect, useRef, useState } from "react";
import { useFM } from "@/lib/store";
import type { FeatureType } from "@/lib/types";

type Props = {
  x: number;
  y: number;
  nodeId?: string | null;
  edgeId?: string | null;
  onClose: () => void;
};

const typeColor: Record<FeatureType, string> = {
  Boolean: "#2b6cff",
  Integer: "#22a06b",
  Float: "#d98e00",
  String: "#b255d9",
};

function MenuItem({
  icon,
  label,
  shortcut,
  onClick,
  danger,
  check,
  disabled,
  hasSubmenu,
  onHover,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  shortcut?: string;
  onClick?: () => void;
  danger?: boolean;
  check?: boolean;
  disabled?: boolean;
  hasSubmenu?: boolean;
  onHover?: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onHover}
      className={`group w-full flex items-center gap-2.5 px-2.5 py-1.5 mx-1 rounded-md text-[13px] transition-colors ${
        disabled
          ? "text-black/30 cursor-not-allowed"
          : danger
          ? "text-red-600 hover:bg-red-50"
          : "text-black/80 hover:bg-blue-500 hover:text-white"
      }`}
    >
      <span className="w-4 shrink-0 grid place-items-center text-[13px] opacity-80 group-hover:opacity-100">
        {icon ?? ""}
      </span>
      <span className="flex-1 text-left truncate">{label}</span>
      {check && <span className="text-[11px]">✓</span>}
      {shortcut && <span className="text-[11px] text-black/40 group-hover:text-white/80 font-mono">{shortcut}</span>}
      {hasSubmenu && <span className="text-[10px] opacity-60">▸</span>}
    </button>
  );
}

const Separator = () => <div className="my-1 h-px bg-black/10 mx-2" />;
const Header = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-black/40">
    {children}
  </div>
);

export default function ContextMenu({ x, y, nodeId, edgeId, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const {
    nodes, edges, groups,
    addFeature, deleteNode, updateNode, setParentRel,
    createGroup, deleteGroup,
    deleteEdge,
    relayout,
    startConstraint,
  } = useFM();

  const [submenu, setSubmenu] = useState<"type" | "group" | null>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep menu inside viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? window.innerWidth;
    const ph = parent?.clientHeight ?? window.innerHeight;
    const { offsetWidth: w, offsetHeight: h } = el;
    const nx = x + w > pw ? Math.max(4, pw - w - 4) : x;
    const ny = y + h > ph ? Math.max(4, ph - h - 4) : y;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  const edge = edgeId ? edges.find((e) => e.id === edgeId) : null;
  const edgeChild = edge ? nodes.find((n) => n.id === edge.target) : null;
  const edgeParent = edge ? nodes.find((n) => n.id === edge.source) : null;
  const edgeInGroup = !!(edge?.data as any)?.inGroup;
  const edgeRel: "mandatory" | "optional" = (edge?.data as any)?.parentRel ?? "mandatory";

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : null;
  const childrenIds = node ? edges.filter((e) => e.source === node.id).map((e) => e.target) : [];
  const existingGroup = node ? groups.find((g) => g.parentId === node.id) : null;
  const hasParent = node ? edges.some((e) => e.target === node.id) : false;

  const rename = () => {
    if (!node) return;
    const next = prompt("New name:", node.data.name);
    if (next && next.trim()) updateNode(node.id, { name: next.trim() });
    onClose();
  };
  const changeType = (t: FeatureType) => { if (node) updateNode(node.id, { featureType: t }); onClose(); };
  const addChild = () => {
    if (!node) return;
    const existingChildren = edges.filter((e) => e.source === node.id).length;
    const p = { x: node.position.x + (existingChildren * 180 - 80), y: node.position.y + 140 };
    addFeature(p, node.id);
    onClose();
  };
  const ensureChildren = (n: number): string[] => {
    if (!node) return [];
    const current = [...childrenIds];
    while (current.length < n) {
      const pos = {
        x: node.position.x + (current.length * 180 - 80),
        y: node.position.y + 140,
      };
      const id = addFeature(pos, node.id);
      current.push(id);
    }
    return current;
  };

  const group = (type: "alternative" | "or" | "cardinality") => {
    if (!node) return;
    const kids = childrenIds.length >= 2 ? childrenIds : ensureChildren(2);
    if (kids.length < 2) return;
    if (existingGroup) deleteGroup(existingGroup.id);
    createGroup(node.id, kids, type);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute z-50 min-w-[230px] py-1.5 rounded-xl bg-white/95 backdrop-blur border border-black/10 shadow-[0_10px_30px_rgba(0,0,0,0.15)] select-none"
      style={{ left: pos.x, top: pos.y, animation: "ctxfade 90ms ease-out" }}
    >
      <style>{`@keyframes ctxfade { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>

      {edge ? (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full"
              style={{
                background: edgeRel === "mandatory" ? "#111418" : "#ffffff",
                border: "1.5px solid #111418",
              }}
            />
            <span className="text-[13px] font-semibold text-black/90 truncate">
              {edgeParent?.data.name ?? edge.source} → {edgeChild?.data.name ?? edge.target}
            </span>
          </div>
          <Separator />

          {edgeInGroup ? (
            <div className="px-3 py-1.5 text-[11px] text-black/50 italic">
              Child is inside a group. Change the group type on the parent.
            </div>
          ) : (
            <>
              <Header>Relation type</Header>
              <MenuItem
                icon={<span className="w-2.5 h-2.5 rounded-full bg-black inline-block" />}
                label="Mandatory"
                check={edgeRel === "mandatory"}
                onClick={() => { if (edge) setParentRel(edge.target, "mandatory"); onClose(); }}
              />
              <MenuItem
                icon={<span className="w-2.5 h-2.5 rounded-full bg-white border border-black inline-block" />}
                label="Optional"
                check={edgeRel === "optional"}
                onClick={() => { if (edge) setParentRel(edge.target, "optional"); onClose(); }}
              />
              <Separator />
            </>
          )}

          <MenuItem
            icon="🗑"
            label="Delete relation"
            shortcut="⌫"
            danger
            onClick={() => { deleteEdge(edge.id); onClose(); }}
          />
        </>
      ) : node ? (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: typeColor[node.data.featureType] }}
              title={node.data.featureType}
            />
            <span className="text-[13px] font-semibold text-black/90 truncate">{node.data.name}</span>
            <span className="text-[10px] text-black/40 ml-auto uppercase">{node.data.featureType}</span>
          </div>
          <Separator />

          <MenuItem icon="✎" label="Rename…" shortcut="F2" onClick={rename} />
          <MenuItem icon="＋" label="Add child feature" shortcut="⏎" onClick={addChild} />

          {hasParent && (
            <>
              <Separator />
              <Header>Relation to parent</Header>
              <MenuItem
                icon={<span className="w-2 h-2 rounded-full bg-black inline-block" />}
                label="Mandatory"
                check={node.data.parentRel === "mandatory"}
                onClick={() => { setParentRel(node.id, "mandatory"); onClose(); }}
              />
              <MenuItem
                icon={<span className="w-2 h-2 rounded-full bg-white border border-black inline-block" />}
                label="Optional"
                check={node.data.parentRel === "optional"}
                onClick={() => { setParentRel(node.id, "optional"); onClose(); }}
              />
            </>
          )}

          <Separator />
          <div className="relative">
            <MenuItem
              icon="◧"
              label={
                <span>
                  Feature type
                  <span className="ml-1.5 text-[11px] text-black/40 group-hover:text-white/80">
                    {node.data.featureType}
                  </span>
                </span>
              }
              hasSubmenu
              onHover={() => setSubmenu("type")}
              onClick={() => setSubmenu(submenu === "type" ? null : "type")}
            />
            {submenu === "type" && (
              <div className="absolute left-full top-0 ml-1 min-w-[150px] py-1.5 rounded-xl bg-white/95 backdrop-blur border border-black/10 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
                {(["Boolean", "Integer", "Float", "String"] as FeatureType[]).map((t) => (
                  <MenuItem
                    key={t}
                    icon={<span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: typeColor[t] }} />}
                    label={t}
                    check={node.data.featureType === t}
                    onClick={() => changeType(t)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <MenuItem
              icon="⌒"
              label={
                <span>
                  {childrenIds.length >= 2 ? "Group children" : "Convert to group…"}
                  {existingGroup && (
                    <span className="ml-1.5 text-[11px] text-black/40 group-hover:text-white/80">
                      {existingGroup.type}
                    </span>
                  )}
                  {childrenIds.length < 2 && !existingGroup && (
                    <span className="ml-1.5 text-[11px] text-black/40 group-hover:text-white/80">
                      +children
                    </span>
                  )}
                </span>
              }
              hasSubmenu
              onHover={() => setSubmenu("group")}
              onClick={() => setSubmenu(submenu === "group" ? null : "group")}
            />
            {submenu === "group" && (
              <div className="absolute left-full top-0 ml-1 min-w-[220px] py-1.5 rounded-xl bg-white/95 backdrop-blur border border-black/10 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
                {childrenIds.length < 2 && (
                  <div className="px-3 py-1 text-[10.5px] text-black/45 leading-snug">
                    Adds {2 - childrenIds.length} child feature{2 - childrenIds.length === 1 ? "" : "s"} to build the group.
                  </div>
                )}
                <MenuItem
                  icon="△"
                  label="Alternative (XOR)"
                  check={existingGroup?.type === "alternative"}
                  onClick={() => group("alternative")}
                />
                <MenuItem
                  icon="▲"
                  label="Or (≥1)"
                  check={existingGroup?.type === "or"}
                  onClick={() => group("or")}
                />
                <MenuItem
                  icon="[…]"
                  label="Cardinality [n..m]"
                  check={existingGroup?.type === "cardinality"}
                  onClick={() => group("cardinality")}
                />
                {existingGroup && (
                  <>
                    <Separator />
                    <MenuItem
                      icon="↺"
                      label="Ungroup"
                      onClick={() => { deleteGroup(existingGroup.id); onClose(); }}
                    />
                  </>
                )}
              </div>
            )}
          </div>

          <Separator />
          <Header>Cross-tree constraint</Header>
          <MenuItem
            icon="→"
            label="Add requires…"
            onClick={() => { startConstraint("requires", node.id); onClose(); }}
          />
          <MenuItem
            icon="✕"
            label="Add excludes…"
            onClick={() => { startConstraint("excludes", node.id); onClose(); }}
          />

          <Separator />
          <MenuItem icon="⇅" label="Tidy layout" shortcut="⇧L" onClick={() => { relayout(); onClose(); }} />
          <MenuItem icon="🗑" label="Delete feature" shortcut="⌫" danger onClick={() => { deleteNode(node.id); onClose(); }} />
        </>
      ) : (
        <>
          <Header>Canvas</Header>
          <MenuItem icon="＋" label="Add feature here" onClick={() => { addFeature({ x: x + 20, y: y + 20 }, null); onClose(); }} />
          <Separator />
          <Header>Arrange</Header>
          <MenuItem
            icon="⇅"
            label="Tidy layout (auto-arrange)"
            shortcut="⇧L"
            onClick={() => { relayout(); onClose(); }}
          />
        </>
      )}
    </div>
  );
}
