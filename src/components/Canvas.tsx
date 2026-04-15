"use client";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import SearchPalette from "./SearchPalette";
import { useFM } from "@/lib/store";
import FeatureNode from "./FeatureNode";
import FeatureEdge from "./FeatureEdge";
import GroupArcs from "./GroupArcs";
import EdgeMarkers from "./EdgeMarkers";
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
      // tree edges are NOT reconnectable (would break the tree structure).
      // Respect whichever `selected` flag the store already carries (used for
      // multi-edge selection triggered from the UVL view) and also honour
      // the legacy single `selectedEdgeId` so the context menu still works.
      ...rawEdges.map((e) => ({
        ...e,
        selected: !!e.selected || e.id === selectedEdgeId,
        reconnectable: false as const,
      })),
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
  const duplicateNode = useFM((s) => s.duplicateNode);
  const deleteNodes = useFM((s) => s.deleteNodes);
  const copySelection = useFM((s) => s.copySelection);
  const pasteClipboard = useFM((s) => s.pasteClipboard);
  const rf = useReactFlow();
  const [searchOpen, setSearchOpen] = useState(false);

  const getSelectedIds = () => nodes.filter((n) => n.selected).map((n) => n.id);
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

      if (mod && (e.key === "d" || e.key === "D")) {
        if (inField) return;
        if (selectedId) {
          e.preventDefault();
          duplicateNode(selectedId);
        }
        return;
      }

      if (mod && (e.key === "c" || e.key === "C")) {
        if (inField) return;
        const ids = getSelectedIds();
        if (ids.length === 0 && selectedId) ids.push(selectedId);
        if (ids.length === 0) return;
        e.preventDefault();
        copySelection(ids);
        return;
      }

      if (mod && (e.key === "v" || e.key === "V")) {
        if (inField) return;
        e.preventDefault();
        pasteClipboard();
        return;
      }

      if (mod && (e.key === "0" || e.key === "1")) {
        if (inField) return;
        e.preventDefault();
        rf.fitView({ duration: 300, padding: 0.2 });
        return;
      }

      if (mod && (e.key === "k" || e.key === "K")) {
        if (inField) return;
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (mod && (e.key === "a" || e.key === "A")) {
        if (inField) return;
        e.preventDefault();
        onNodesChange(nodes.map((n) => ({ id: n.id, type: "select", selected: true })));
        return;
      }

      if (e.key === "F2" && !inField && selectedId) {
        e.preventDefault();
        useFM.setState({ editingNodeId: selectedId });
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
        const multi = getSelectedIds();
        if (multi.length > 1) {
          e.preventDefault();
          deleteNodes(multi);
          return;
        }
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
  }, [nodes, selectedId, selectedEdgeId, deleteNode, deleteEdge, deleteConstraint, selectEdge, undo, redo, relayout, duplicateNode, deleteNodes, copySelection, pasteClipboard, rf, pendingConstraint, cancelConstraint]);

  const nodeTypes = useMemo(() => ({ feature: FeatureNode }), []);
  const edgeTypes = useMemo(() => ({ feature: FeatureEdge, constraint: ConstraintEdge }), []);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    flowX?: number;
    flowY?: number;
    nodeId?: string | null;
    edgeId?: string | null;
    multiIds?: string[];
  } | null>(null);
  const [ready, setReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuOffset = () => {
    const r = rootRef.current?.getBoundingClientRect();
    return { ox: r?.left ?? 0, oy: r?.top ?? 0 };
  };

  // Manual right-drag pan: we don't hand button 2 to React Flow (that would
  // kill the native contextmenu). Instead we listen here, drag the viewport
  // ourselves, and suppress the contextmenu only when a real drag happened.
  const rdRef = useRef<{ sx: number; sy: number; vx: number; vy: number; z: number; dragging: boolean } | null>(null);
  const suppressCtxRef = useRef(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      if (!rootRef.current?.contains(e.target as Node)) return;
      const vp = rf.getViewport();
      rdRef.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y, z: vp.zoom, dragging: false };
    };
    const onMove = (e: MouseEvent) => {
      const d = rdRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.dragging && Math.hypot(dx, dy) > 5) d.dragging = true;
      if (d.dragging) rf.setViewport({ x: d.vx + dx, y: d.vy + dy, zoom: d.z });
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 2) return;
      const dragged = rdRef.current?.dragging;
      rdRef.current = null;
      if (dragged) suppressCtxRef.current = true; // eat the upcoming contextmenu
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [rf]);

  const onRootContextMenu = (e: React.MouseEvent) => {
    if (suppressCtxRef.current) {
      suppressCtxRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleNodeClick: NodeMouseHandler = (_e, n) => {
    if (pendingConstraint) {
      completeConstraint(n.id);
      return;
    }
    select(n.id);
  };

  const onNodeContextMenu: NodeMouseHandler = (e, n) => {
    e.preventDefault();
    const { ox, oy } = menuOffset();
    const f = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const multi = nodes.filter((x) => x.selected).map((x) => x.id);
    if (multi.length >= 2 && multi.includes(n.id)) {
      setMenu({ x: e.clientX - ox, y: e.clientY - oy, flowX: f.x, flowY: f.y, multiIds: multi });
      return;
    }
    select(n.id);
    setMenu({ x: e.clientX - ox, y: e.clientY - oy, flowX: f.x, flowY: f.y, nodeId: n.id });
  };

  // Right-click on the React Flow multi-selection wrapper (not an individual
  // node) — shows the bulk menu.
  const onSelectionContextMenu = (e: React.MouseEvent, selNodes: { id: string }[]) => {
    e.preventDefault();
    const { ox, oy } = menuOffset();
    const f = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const ids = selNodes.map((n) => n.id);
    if (ids.length < 2) return;
    setMenu({ x: e.clientX - ox, y: e.clientY - oy, flowX: f.x, flowY: f.y, multiIds: ids });
  };

  const onPaneContextMenu = (e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const { ox, oy } = menuOffset();
    const cx = (e as MouseEvent).clientX;
    const cy = (e as MouseEvent).clientY;
    const f = rf.screenToFlowPosition({ x: cx, y: cy });
    setMenu({ x: cx - ox, y: cy - oy, flowX: f.x, flowY: f.y, nodeId: null });
  };

  const onEdgeContextMenu = (e: React.MouseEvent, edge: { id: string }) => {
    e.preventDefault();
    e.stopPropagation();
    const { ox, oy } = menuOffset();
    const f = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    selectEdge(edge.id);
    setMenu({ x: e.clientX - ox, y: e.clientY - oy, flowX: f.x, flowY: f.y, edgeId: edge.id });
  };

  const onEdgeClick = (_e: React.MouseEvent, edge: { id: string }) => {
    selectEdge(edge.id);
  };

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full"
      onContextMenuCapture={onRootContextMenu}
    >
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
        onSelectionContextMenu={onSelectionContextMenu}
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
        multiSelectionKeyCode={["Meta", "Shift", "Control"]}
        selectionOnDrag
        panActivationKeyCode="Space"
        panOnDrag={[1]}
        defaultEdgeOptions={{ type: "feature" }}
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cfd3da" />
        <Controls />
      </ReactFlow>
      <GroupArcs />
      <EdgeMarkers />
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
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          flowX={menu.flowX}
          flowY={menu.flowY}
          nodeId={menu.nodeId}
          edgeId={menu.edgeId}
          multiIds={menu.multiIds}
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
