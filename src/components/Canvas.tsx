"use client";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { useFM } from "@/lib/store";
import FeatureNode from "./FeatureNode";
import FeatureEdge from "./FeatureEdge";
import GroupArcs from "./GroupArcs";
import ContextMenu from "./ContextMenu";
import CanvasLoader from "./CanvasLoader";
import ConstraintEdge from "./ConstraintEdge";
import { parseVisualConstraints } from "@/lib/constraintParser";

function Inner() {
  const { nodes, edges: rawEdges, onNodesChange, onEdgesChange, onConnect, select, deleteNode, selectEdge, deleteEdge } = useFM();
  const constraints = useFM((s) => s.constraints);
  const deleteConstraint = useFM((s) => s.deleteConstraint);
  const selectedId = useFM((s) => s.selectedId);
  const selectedEdgeId = useFM((s) => s.selectedEdgeId);

  // Build constraint edges (requires / excludes) from parsed constraints.
  // Each one gets its own lane Y below the tree so they never overlap, and
  // they render behind feature nodes thanks to a negative zIndex.
  const constraintEdges = useMemo(() => {
    let maxBottom = 0;
    for (const n of nodes) {
      const b = n.position.y + 80;
      if (b > maxBottom) maxBottom = b;
    }
    const LANE_GAP = 28;
    const byName = new Map(nodes.map((n) => [n.data.name, n]));
    const visual = parseVisualConstraints(constraints);
    return visual
      .map((v, idx) => {
        const source = v.kind === "requires" ? byName.get(v.from) : byName.get(v.a);
        const target = v.kind === "requires" ? byName.get(v.to) : byName.get(v.b);
        if (!source || !target) return null;
        const raw = constraints.find((c) => c.id === v.id);
        const laneY = raw?.route?.laneY ?? maxBottom + 40 + idx * LANE_GAP;
        return {
          id: `cons_${v.id}`,
          source: source.id,
          target: target.id,
          type: "constraint" as const,
          zIndex: -1,
          selected: selectedEdgeId === `cons_${v.id}`,
          data: {
            kind: v.kind,
            constraintId: v.id,
            laneY,
            routeSourceX: raw?.route?.sourceX,
            routeTargetX: raw?.route?.targetX,
          },
          selectable: true,
          reconnectable: true,
        };
      })
      .filter(Boolean) as any[];
  }, [nodes, constraints, selectedEdgeId]);

  const edges = useMemo(
    () => [
      // tree edges are NOT reconnectable (would break the tree structure)
      ...rawEdges.map((e) => ({ ...e, selected: e.id === selectedEdgeId, reconnectable: false as const })),
      ...constraintEdges,
    ],
    [rawEdges, selectedEdgeId, constraintEdges]
  );

  const reconnectConstraint = useFM((s) => s.reconnectConstraint);
  const onReconnect = (oldEdge: Edge, newConnection: Connection) => {
    if (!oldEdge.id.startsWith("cons_")) return;
    const cid = oldEdge.id.slice(5);
    if (!newConnection.source || !newConnection.target) return;
    reconnectConstraint(cid, {
      sourceId: newConnection.source,
      targetId: newConnection.target,
    });
  };

  const undo = useFM((s) => s.undo);
  const redo = useFM((s) => s.redo);
  const relayout = useFM((s) => s.relayout);
  const pendingConstraint = useFM((s) => s.pendingConstraint);
  const completeConstraint = useFM((s) => s.completeConstraint);
  const cancelConstraint = useFM((s) => s.cancelConstraint);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (inField) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        if (inField) return;
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === "Escape" && pendingConstraint) {
        cancelConstraint();
        return;
      }

      if (e.shiftKey && !mod && (e.key === "l" || e.key === "L")) {
        if (inField) return;
        e.preventDefault();
        relayout();
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !inField) {
        if (selectedId) {
          e.preventDefault();
          deleteNode(selectedId);
        } else if (selectedEdgeId) {
          e.preventDefault();
          // constraint edges carry ids like `cons_<constraintId>`
          if (selectedEdgeId.startsWith("cons_")) {
            deleteConstraint(selectedEdgeId.slice(5));
            selectEdge(null);
          } else {
            deleteEdge(selectedEdgeId);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedEdgeId, deleteNode, deleteEdge, deleteConstraint, selectEdge, undo, redo, relayout, pendingConstraint, cancelConstraint]);

  const nodeTypes = useMemo(() => ({ feature: FeatureNode }), []);
  const edgeTypes = useMemo(() => ({ feature: FeatureEdge, constraint: ConstraintEdge }), []);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string | null;
    edgeId?: string | null;
  } | null>(null);
  const [ready, setReady] = useState(false);

  const handleNodeClick: NodeMouseHandler = (_e, n) => {
    if (pendingConstraint) {
      completeConstraint(n.id);
      return;
    }
    select(n.id);
  };

  const onNodeContextMenu: NodeMouseHandler = (e, n) => {
    e.preventDefault();
    const host = (e.currentTarget as HTMLElement).closest("main")?.getBoundingClientRect();
    const ox = host?.left ?? 0;
    const oy = host?.top ?? 0;
    select(n.id);
    setMenu({ x: e.clientX - ox, y: e.clientY - oy, nodeId: n.id });
  };

  const onPaneContextMenu = (e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const host = (e.currentTarget as HTMLElement).closest("main")?.getBoundingClientRect();
    const ox = host?.left ?? 0;
    const oy = host?.top ?? 0;
    setMenu({ x: (e as MouseEvent).clientX - ox, y: (e as MouseEvent).clientY - oy, nodeId: null });
  };

  const onEdgeContextMenu = (e: React.MouseEvent, edge: { id: string }) => {
    e.preventDefault();
    e.stopPropagation();
    const host = (e.currentTarget as HTMLElement).closest("main")?.getBoundingClientRect();
    const ox = host?.left ?? 0;
    const oy = host?.top ?? 0;
    selectEdge(edge.id);
    setMenu({ x: e.clientX - ox, y: e.clientY - oy, edgeId: edge.id });
  };

  const onEdgeClick = (_e: React.MouseEvent, edge: { id: string }) => {
    selectEdge(edge.id);
  };

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        reconnectRadius={16}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => { select(null); selectEdge(null); setMenu(null); }}
        onInit={() => {
          // Nodes are measured on the next frame — wait two RAFs so arcs
          // don't flash in "floating" state with fallback sizes.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setReady(true))
          );
        }}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
        defaultEdgeOptions={{ type: "feature" }}
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cfd3da" />
        <Controls />
      </ReactFlow>
      <GroupArcs />
      {pendingConstraint && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-2 rounded-lg bg-white border border-blue-400 shadow-md text-[12.5px] flex items-center gap-3 pointer-events-auto">
          <span className="text-black/80">
            {pendingConstraint.kind === "requires" ? "Creating requires →" : "Creating excludes ✕"} · click the target feature
          </span>
          <button className="text-[11px] text-black/60 hover:text-black underline" onClick={cancelConstraint}>
            cancel (Esc)
          </button>
        </div>
      )}
      {!ready && <CanvasLoader />}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          nodeId={menu.nodeId}
          edgeId={menu.edgeId}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
