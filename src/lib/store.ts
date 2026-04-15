"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import type { FeatureNodeData, Group, Constraint } from "./types";
import { autoLayout } from "./layout";

export type FMNode = Node<FeatureNodeData, "feature">;
export type FMEdge = Edge<{ parentRel?: "mandatory" | "optional"; inGroup?: boolean }>;

type State = {
  nodes: FMNode[];
  edges: FMEdge[];
  groups: Group[];
  constraints: Constraint[];
  selectedId: string | null;
  selectedEdgeId: string | null;

  // interactive constraint wiring
  pendingConstraint: { kind: "requires" | "excludes"; fromId: string } | null;
  startConstraint: (kind: "requires" | "excludes", fromId: string) => void;
  completeConstraint: (toId: string) => void;
  cancelConstraint: () => void;

  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;

  addFeature: (pos: { x: number; y: number }, parentId?: string | null) => string;
  deleteNode: (id: string) => void;
  updateNode: (id: string, patch: Partial<FeatureNodeData>) => void;
  setParentRel: (childId: string, rel: "mandatory" | "optional") => void;
  select: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  deleteEdge: (id: string) => void;

  createGroup: (parentId: string, childrenIds: string[], type: Group["type"]) => void;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  deleteGroup: (id: string) => void;

  addConstraint: (expr: string) => void;
  updateConstraint: (id: string, expr: string) => void;
  deleteConstraint: (id: string) => void;
  reconnectConstraint: (id: string, endpoints: { sourceId?: string; targetId?: string }) => void;
  setConstraintRoute: (id: string, route: Partial<NonNullable<Constraint["route"]>>) => void;

  reset: (initialSample?: boolean) => void;
  loadModel: (m: { nodes: FMNode[]; edges: FMEdge[]; groups: Group[]; constraints: Constraint[] }) => void;

  // history
  past: Snapshot[];
  future: Snapshot[];
  undo: () => void;
  redo: () => void;

  relayout: () => void;

  // tabs
  tabs: Tab[];
  activeId: string;
  _snapshots: Record<string, TabSnapshot>;
  newTab: (opts?: { sample?: boolean; name?: string }) => void;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
};

type Tab = { id: string; name: string };

type TabSnapshot = {
  nodes: FMNode[];
  edges: FMEdge[];
  groups: Group[];
  constraints: Constraint[];
  selectedId: string | null;
  selectedEdgeId: string | null;
  past: Snapshot[];
  future: Snapshot[];
};

type Snapshot = {
  nodes: FMNode[];
  edges: FMEdge[];
  groups: Group[];
  constraints: Constraint[];
};

const HISTORY_LIMIT = 100;

let _id = 0;
const nid = (p: string) => `${p}_${++_id}_${Math.random().toString(36).slice(2, 6)}`;

const sample = () => {
  _id = 0;
  const eShop: FMNode = {
    id: "eShop",
    type: "feature",
    position: { x: 400, y: 40 },
    data: { name: "eShop", featureType: "Boolean", attributes: [], parentRel: "mandatory" },
  };
  const security: FMNode = {
    id: "Security",
    type: "feature",
    position: { x: 120, y: 180 },
    data: { name: "Security", featureType: "Boolean", attributes: [], parentRel: "mandatory" },
  };
  const catalogue: FMNode = {
    id: "Catalogue",
    type: "feature",
    position: { x: 320, y: 180 },
    data: { name: "Catalogue", featureType: "Boolean", attributes: [], parentRel: "mandatory" },
  };
  const payment: FMNode = {
    id: "Payment",
    type: "feature",
    position: { x: 520, y: 180 },
    data: { name: "Payment", featureType: "Boolean", attributes: [], parentRel: "optional" },
  };
  const platform: FMNode = {
    id: "Platform",
    type: "feature",
    position: { x: 740, y: 180 },
    data: { name: "Platform", featureType: "Boolean", attributes: [], parentRel: "optional" },
  };
  const high: FMNode = {
    id: "High",
    type: "feature",
    position: { x: 40, y: 320 },
    data: { name: "High", featureType: "Boolean", attributes: [{ key: "Price", value: "100" }], parentRel: "mandatory", inGroup: true },
  };
  const std: FMNode = {
    id: "Standard",
    type: "feature",
    position: { x: 200, y: 320 },
    data: { name: "Standard", featureType: "Boolean", attributes: [{ key: "Price", value: "50" }], parentRel: "mandatory", inGroup: true },
  };
  const bank: FMNode = {
    id: "BankTransfer",
    type: "feature",
    position: { x: 440, y: 320 },
    data: { name: "Bank Transfer", featureType: "Boolean", attributes: [{ key: "Price", value: "10" }], parentRel: "mandatory", inGroup: true },
  };
  const card: FMNode = {
    id: "CreditCard",
    type: "feature",
    position: { x: 600, y: 320 },
    data: { name: "Credit Card", featureType: "Boolean", attributes: [{ key: "Price", value: "20" }], parentRel: "mandatory", inGroup: true },
  };
  const mobile: FMNode = {
    id: "MobileApp",
    type: "feature",
    position: { x: 720, y: 320 },
    data: { name: "Mobile App", featureType: "Boolean", attributes: [], parentRel: "mandatory", inGroup: true },
  };
  const browser: FMNode = {
    id: "Browser",
    type: "feature",
    position: { x: 860, y: 320 },
    data: { name: "Browser", featureType: "Boolean", attributes: [], parentRel: "mandatory", inGroup: true },
  };

  const mkEdge = (parent: string, child: string, rel: "mandatory" | "optional", inGroup = false): FMEdge => ({
    id: `e_${parent}_${child}`,
    source: parent,
    target: child,
    type: "feature",
    data: { parentRel: rel, inGroup },
  });

  return {
    nodes: [eShop, security, catalogue, payment, platform, high, std, bank, card, mobile, browser],
    edges: [
      mkEdge("eShop", "Security", "mandatory"),
      mkEdge("eShop", "Catalogue", "mandatory"),
      mkEdge("eShop", "Payment", "optional"),
      mkEdge("eShop", "Platform", "optional"),
      mkEdge("Security", "High", "mandatory", true),
      mkEdge("Security", "Standard", "mandatory", true),
      mkEdge("Payment", "BankTransfer", "mandatory", true),
      mkEdge("Payment", "CreditCard", "mandatory", true),
      mkEdge("Platform", "MobileApp", "mandatory", true),
      mkEdge("Platform", "Browser", "mandatory", true),
    ],
    groups: [
      { id: "g_Security", parentId: "Security", childrenIds: ["High", "Standard"], type: "alternative" },
      { id: "g_Payment", parentId: "Payment", childrenIds: ["BankTransfer", "CreditCard"], type: "alternative" },
      { id: "g_Platform", parentId: "Platform", childrenIds: ["MobileApp", "Browser"], type: "or" },
    ] as Group[],
    constraints: [
      { id: "c1", expr: '!("Bank Transfer" & "Mobile App")' },
      { id: "c2", expr: '"Credit Card" => High' },
    ] as Constraint[],
  };
};

const collectTabSnapshot = (s: State): TabSnapshot => ({
  nodes: s.nodes,
  edges: s.edges,
  groups: s.groups,
  constraints: s.constraints,
  selectedId: s.selectedId,
  selectedEdgeId: s.selectedEdgeId,
  past: s.past,
  future: s.future,
});

const newTabId = () => `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

export const useFM = create<State>()(persist((set, get) => {
  const initRaw = sample();
  const init = { ...initRaw, nodes: autoLayout(initRaw.nodes, initRaw.edges) };
  const firstTabId = "tab_1";

  const snap = (): Snapshot => {
    const s = get();
    return {
      nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, attributes: [...(n.data.attributes ?? [])] }, position: { ...n.position } })),
      edges: s.edges.map((e) => ({ ...e, data: { ...(e.data || {}) } })),
      groups: s.groups.map((g) => ({ ...g, childrenIds: [...g.childrenIds], cardinality: g.cardinality ? { ...g.cardinality } : undefined })),
      constraints: s.constraints.map((c) => ({ ...c })),
    };
  };

  const pushHistory = () => {
    const snapshot = snap();
    const past = [...get().past, snapshot];
    if (past.length > HISTORY_LIMIT) past.shift();
    set({ past, future: [] });
  };

  return {
    nodes: init.nodes,
    edges: init.edges,
    groups: init.groups,
    constraints: init.constraints,
    selectedId: null,
    selectedEdgeId: null,
    pendingConstraint: null,
    past: [],
    future: [],
    tabs: [{ id: firstTabId, name: "eShop" }],
    activeId: firstTabId,
    _snapshots: {},

    onNodesChange: (changes) => {
      // Take a snapshot once per drag gesture — at the moment dragging ends.
      const endedDrag = changes.some((c: any) => c.type === "position" && c.dragging === false);
      if (endedDrag) pushHistory();
      // Remove changes should also be historized (though we usually delete via deleteNode)
      const hasRemove = changes.some((c: any) => c.type === "remove");
      if (hasRemove) pushHistory();
      set({ nodes: applyNodeChanges(changes, get().nodes) as FMNode[] });
    },
    onEdgesChange: (changes) => {
      const hasRemove = changes.some((c: any) => c.type === "remove");
      if (hasRemove) pushHistory();
      set({ edges: applyEdgeChanges(changes, get().edges) as FMEdge[] });
    },
    onConnect: (c) => {
      if (!c.source || !c.target) return;
      if (get().edges.some((e) => e.target === c.target)) return;
      if (c.source === c.target) return;
      pushHistory();
      const newEdge: FMEdge = {
        id: `e_${c.source}_${c.target}`,
        source: c.source,
        target: c.target,
        type: "feature",
        data: { parentRel: "mandatory", inGroup: false },
      };
      set({ edges: addEdge(newEdge, get().edges) as FMEdge[] });
    },

    addFeature: (pos, parentId) => {
      pushHistory();
      const id = nid("F");
      const node: FMNode = {
        id,
        type: "feature",
        position: pos,
        data: { name: id, featureType: "Boolean", attributes: [], parentRel: "optional" },
      };
      set({ nodes: [...get().nodes, node] });
      if (parentId) {
        const e: FMEdge = {
          id: `e_${parentId}_${id}`,
          source: parentId,
          target: id,
          type: "feature",
          data: { parentRel: "optional" },
        };
        set({ edges: [...get().edges, e] });
      }
      return id;
    },

    deleteNode: (id) => {
      pushHistory();
      // Cascade delete: collect the whole subtree rooted at `id`.
      const { nodes, edges, groups, constraints, selectedId } = get();
      const children = new Map<string, string[]>();
      for (const e of edges) {
        children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
      }
      const toRemove = new Set<string>();
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        if (toRemove.has(cur)) continue;
        toRemove.add(cur);
        for (const c of children.get(cur) ?? []) stack.push(c);
      }

      // Clean constraints that reference any removed feature name.
      const removedNames = new Set(
        nodes.filter((n) => toRemove.has(n.id)).map((n) => n.data.name)
      );
      const nameMentioned = (expr: string) => {
        for (const name of removedNames) {
          if (!name) continue;
          const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // match bare identifier, quoted identifier, or dotted member
          const re = new RegExp(
            `(?:^|[^\\w"])(?:"${esc}"|${esc})(?=[^\\w"]|$)`
          );
          if (re.test(expr)) return true;
        }
        return false;
      };

      const prunedGroups = groups
        .map((g) => ({ ...g, childrenIds: g.childrenIds.filter((c) => !toRemove.has(c)) }))
        .filter((g) => !toRemove.has(g.parentId));

      // A group with < 2 children is not a group anymore — dissolve it and
      // clear the `inGroup` marker on the surviving child (edge + node) so the
      // mandatory/optional circle reappears.
      const kept: typeof prunedGroups = [];
      const orphanChildren = new Set<string>();
      for (const g of prunedGroups) {
        if (g.childrenIds.length >= 2) kept.push(g);
        else g.childrenIds.forEach((c) => orphanChildren.add(c));
      }

      const nextNodes = nodes
        .filter((n) => !toRemove.has(n.id))
        .map((n) => (orphanChildren.has(n.id) ? { ...n, data: { ...n.data, inGroup: false } } : n));

      const nextEdges = edges
        .filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target))
        .map((e) =>
          orphanChildren.has(e.target) ? { ...e, data: { ...(e.data || {}), inGroup: false } } : e
        );

      set({
        nodes: nextNodes,
        edges: nextEdges,
        groups: kept,
        constraints: constraints.filter((c) => !nameMentioned(c.expr)),
        selectedId: selectedId && toRemove.has(selectedId) ? null : selectedId,
      });
    },

    updateNode: (id, patch) => {
      pushHistory();
      set({
        nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      });
    },

    setParentRel: (childId, rel) => {
      pushHistory();
      set({
        edges: get().edges.map((e) =>
          e.target === childId ? { ...e, data: { ...(e.data || {}), parentRel: rel } } : e
        ),
        nodes: get().nodes.map((n) => (n.id === childId ? { ...n, data: { ...n.data, parentRel: rel } } : n)),
      });
    },

    select: (id) => set({ selectedId: id, selectedEdgeId: null }),
    selectEdge: (id) => set({ selectedEdgeId: id, selectedId: null }),

    deleteEdge: (id) => {
      pushHistory();
      const { edges, groups, nodes } = get();
      const e = edges.find((x) => x.id === id);
      if (!e) return;
      // If the child was part of a group, strip it from the group and
      // dissolve the group if it drops below 2 children.
      const affectedGroups = groups
        .map((g) => ({ ...g, childrenIds: g.childrenIds.filter((c) => c !== e.target) }))
        .map((g) =>
          g.parentId === e.source && g.childrenIds.includes(e.target)
            ? g
            : g
        );
      const kept: typeof affectedGroups = [];
      const orphans = new Set<string>();
      for (const g of affectedGroups) {
        if (g.childrenIds.length >= 2) kept.push(g);
        else g.childrenIds.forEach((c) => orphans.add(c));
      }
      set({
        edges: edges.filter((x) => x.id !== id),
        groups: kept,
        nodes: nodes.map((n) =>
          n.id === e.target
            ? { ...n, data: { ...n.data, inGroup: false } }
            : orphans.has(n.id)
            ? { ...n, data: { ...n.data, inGroup: false } }
            : n
        ),
        selectedEdgeId: get().selectedEdgeId === id ? null : get().selectedEdgeId,
      });
    },

    createGroup: (parentId, childrenIds, type) => {
      pushHistory();
      const id = nid("G");
      set({
        groups: [...get().groups, { id, parentId, childrenIds, type }],
        edges: get().edges.map((e) =>
          e.source === parentId && childrenIds.includes(e.target)
            ? { ...e, data: { ...(e.data || {}), inGroup: true } }
            : e
        ),
        nodes: get().nodes.map((n) =>
          childrenIds.includes(n.id) ? { ...n, data: { ...n.data, inGroup: true } } : n
        ),
      });
    },

    updateGroup: (id, patch) => {
      pushHistory();
      set({ groups: get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
    },

    deleteGroup: (id) => {
      const g = get().groups.find((x) => x.id === id);
      if (!g) return;
      pushHistory();
      set({
        groups: get().groups.filter((x) => x.id !== id),
        edges: get().edges.map((e) =>
          e.source === g.parentId && g.childrenIds.includes(e.target)
            ? { ...e, data: { ...(e.data || {}), inGroup: false } }
            : e
        ),
        nodes: get().nodes.map((n) =>
          g.childrenIds.includes(n.id) ? { ...n, data: { ...n.data, inGroup: false } } : n
        ),
      });
    },

    reconnectConstraint: (id, endpoints) => {
      const st = get();
      const c = st.constraints.find((x) => x.id === id);
      if (!c) return;
      const visual = (() => {
        const e = c.expr.trim();
        const req = e.match(/^"?([^"=!&|()]+?)"?\s*=>\s*"?([^"=!&|()]+?)"?$/);
        if (req) return { kind: "requires" as const, from: req[1].replace(/^"(.*)"$/, "$1"), to: req[2].replace(/^"(.*)"$/, "$1") };
        const exc = e.match(/^!\s*\(\s*"?([^"&()]+?)"?\s*&\s*"?([^"&()]+?)"?\s*\)$/);
        if (exc) return { kind: "excludes" as const, a: exc[1].replace(/^"(.*)"$/, "$1"), b: exc[2].replace(/^"(.*)"$/, "$1") };
        return null;
      })();
      if (!visual) return;
      const nameOf = (nid: string | undefined) =>
        nid ? st.nodes.find((n) => n.id === nid)?.data.name : undefined;
      const q = (n: string) => (/^[A-Za-z0-9_]*[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n}"`);
      let newExpr: string;
      if (visual.kind === "requires") {
        const from = nameOf(endpoints.sourceId) ?? visual.from;
        const to = nameOf(endpoints.targetId) ?? visual.to;
        if (from === to) return; // refuse self-loop
        newExpr = `${q(from)} => ${q(to)}`;
      } else {
        const a = nameOf(endpoints.sourceId) ?? visual.a;
        const b = nameOf(endpoints.targetId) ?? visual.b;
        if (a === b) return;
        newExpr = `!(${q(a)} & ${q(b)})`;
      }
      pushHistory();
      set({ constraints: st.constraints.map((x) => (x.id === id ? { ...x, expr: newExpr } : x)) });
    },

    setConstraintRoute: (id, routePatch) => {
      set({
        constraints: get().constraints.map((c) =>
          c.id === id ? { ...c, route: { ...(c.route || {}), ...routePatch } } : c
        ),
      });
    },

    addConstraint: (expr) => { pushHistory(); set({ constraints: [...get().constraints, { id: nid("C"), expr }] }); },
    updateConstraint: (id, expr) => {
      pushHistory();
      set({ constraints: get().constraints.map((c) => (c.id === id ? { ...c, expr } : c)) });
    },
    deleteConstraint: (id) => {
      pushHistory();
      set({ constraints: get().constraints.filter((c) => c.id !== id) });
    },

    loadModel: (m) => {
      pushHistory();
      const laid = autoLayout(m.nodes, m.edges);
      set({ nodes: laid, edges: m.edges, groups: m.groups, constraints: m.constraints, selectedId: null });
    },

    reset: (initialSample = true) => {
      pushHistory();
      if (initialSample) {
        const s = sample();
        const laid = autoLayout(s.nodes, s.edges);
        set({ ...s, nodes: laid, selectedId: null });
      } else {
        set({ nodes: [], edges: [], groups: [], constraints: [], selectedId: null });
      }
    },

    relayout: () => {
      pushHistory();
      set({ nodes: autoLayout(get().nodes, get().edges) });
    },

    undo: () => {
      const { past, future } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      const current: Snapshot = snap();
      set({
        ...previous,
        past: past.slice(0, -1),
        future: [...future, current],
        selectedId: null,
      });
    },

    redo: () => {
      const { past, future } = get();
      if (future.length === 0) return;
      const next = future[future.length - 1];
      const current: Snapshot = snap();
      set({
        ...next,
        past: [...past, current],
        future: future.slice(0, -1),
        selectedId: null,
      });
    },

    newTab: (opts = {}) => {
      const st = get();
      const snapshots = { ...st._snapshots, [st.activeId]: collectTabSnapshot(st) };
      const id = newTabId();
      const name = opts.name ?? (opts.sample ? "Sample" : "Untitled");
      const data = opts.sample
        ? sample()
        : { nodes: [] as FMNode[], edges: [] as FMEdge[], groups: [] as Group[], constraints: [] as Constraint[] };
      const laid = autoLayout(data.nodes, data.edges);
      set({
        _snapshots: snapshots,
        tabs: [...st.tabs, { id, name }],
        activeId: id,
        nodes: laid,
        edges: data.edges,
        groups: data.groups,
        constraints: data.constraints,
        selectedId: null,
        selectedEdgeId: null,
        past: [],
        future: [],
      });
    },

    switchTab: (id) => {
      const st = get();
      if (id === st.activeId) return;
      const snapshots = { ...st._snapshots, [st.activeId]: collectTabSnapshot(st) };
      const target = snapshots[id];
      if (!target) return;
      const { [id]: _target, ...rest } = snapshots;
      void _target;
      set({
        _snapshots: rest,
        activeId: id,
        nodes: target.nodes,
        edges: target.edges,
        groups: target.groups,
        constraints: target.constraints,
        selectedId: target.selectedId,
        selectedEdgeId: target.selectedEdgeId,
        past: target.past,
        future: target.future,
      });
    },

    closeTab: (id) => {
      const st = get();
      const tabs = st.tabs.filter((t) => t.id !== id);
      const snapshots = { ...st._snapshots };
      delete snapshots[id];

      if (tabs.length === 0) {
        // never leave the user without a tab — spawn a fresh blank one
        const newId = newTabId();
        set({
          tabs: [{ id: newId, name: "Untitled" }],
          activeId: newId,
          _snapshots: {},
          nodes: [],
          edges: [],
          groups: [],
          constraints: [],
          selectedId: null,
          selectedEdgeId: null,
          past: [],
          future: [],
        });
        return;
      }

      if (st.activeId === id) {
        // activate a sibling (previous, else first)
        const idx = st.tabs.findIndex((t) => t.id === id);
        const next = tabs[Math.max(0, idx - 1)] ?? tabs[0];
        const target = snapshots[next.id];
        if (target) {
          const { [next.id]: _t, ...rest } = snapshots;
          void _t;
          set({
            _snapshots: rest,
            tabs,
            activeId: next.id,
            nodes: target.nodes,
            edges: target.edges,
            groups: target.groups,
            constraints: target.constraints,
            selectedId: target.selectedId,
            selectedEdgeId: target.selectedEdgeId,
            past: target.past,
            future: target.future,
          });
        } else {
          set({ _snapshots: snapshots, tabs });
        }
      } else {
        set({ _snapshots: snapshots, tabs });
      }
    },

    renameTab: (id, name) => {
      set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, name } : t)) });
    },

    startConstraint: (kind, fromId) => set({ pendingConstraint: { kind, fromId } }),
    cancelConstraint: () => set({ pendingConstraint: null }),
    completeConstraint: (toId) => {
      const st = get();
      const pending = st.pendingConstraint;
      if (!pending) return;
      if (pending.fromId === toId) {
        set({ pendingConstraint: null });
        return;
      }
      const fromNode = st.nodes.find((n) => n.id === pending.fromId);
      const toNode = st.nodes.find((n) => n.id === toId);
      if (!fromNode || !toNode) return;
      const q = (n: string) => (/^[A-Za-z0-9_]*[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n}"`);
      const expr =
        pending.kind === "requires"
          ? `${q(fromNode.data.name)} => ${q(toNode.data.name)}`
          : `!(${q(fromNode.data.name)} & ${q(toNode.data.name)})`;
      pushHistory();
      set({
        constraints: [...st.constraints, { id: nid("C"), expr }],
        pendingConstraint: null,
      });
    },
  };
}, {
  name: "featuredraw",
  version: 3,
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({
    nodes: s.nodes,
    edges: s.edges,
    groups: s.groups,
    constraints: s.constraints,
    selectedId: s.selectedId,
    selectedEdgeId: s.selectedEdgeId,
    past: s.past,
    future: s.future,
    tabs: s.tabs,
    activeId: s.activeId,
    _snapshots: s._snapshots,
  }) as any,
  // Incompatible persisted snapshots (from earlier revisions) would produce
  // dangling `inGroup` flags with no matching group entry — the diagram
  // renders without arcs and without circles. Drop anything older than
  // the current version to restart clean.
  migrate: (persisted, version) => {
    if (version < 3) return undefined as any;
    return persisted;
  },
  merge: (persisted: any, current: State) => {
    if (!persisted) return current;
    return {
      ...current,
      ...persisted,
      // Defensive: never let a stray partial persist blow away arrays/maps.
      nodes: Array.isArray(persisted.nodes) ? persisted.nodes : current.nodes,
      edges: Array.isArray(persisted.edges) ? persisted.edges : current.edges,
      groups: Array.isArray(persisted.groups) ? persisted.groups : current.groups,
      constraints: Array.isArray(persisted.constraints) ? persisted.constraints : current.constraints,
      tabs: Array.isArray(persisted.tabs) && persisted.tabs.length ? persisted.tabs : current.tabs,
      activeId: persisted.activeId || current.activeId,
      _snapshots: persisted._snapshots ?? {},
    };
  },
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    // Consistency sweep: if an edge / node is still marked as `inGroup` but
    // its parent has no matching group in the persisted state, clear the flag
    // so the mandatory/optional circle shows up again.
    const validInGroup = new Set<string>();
    for (const g of state.groups ?? []) {
      for (const c of g.childrenIds) validInGroup.add(`${g.parentId}::${c}`);
    }
    state.edges = state.edges.map((e) =>
      (e.data as any)?.inGroup && !validInGroup.has(`${e.source}::${e.target}`)
        ? { ...e, data: { ...(e.data || {}), inGroup: false } }
        : e
    );
    state.nodes = state.nodes.map((n) => {
      if (!n.data?.inGroup) return n;
      const parentEdge = state.edges.find((e) => e.target === n.id);
      const stillInGroup = parentEdge && validInGroup.has(`${parentEdge.source}::${n.id}`);
      return stillInGroup ? n : { ...n, data: { ...n.data, inGroup: false } };
    });
  },
}));
