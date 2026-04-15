"use client";
import { useEffect, useMemo, useState } from "react";
import { useFM } from "@/lib/store";
import { toUVL } from "@/lib/uvl";
import { parseUVL } from "@/lib/uvlParser";
import { parseVisualConstraints } from "@/lib/constraintParser";
import { buildSVG, exportJPG, exportPDF, exportPNG, exportSVG } from "@/lib/exporter";
import UvlCodeView, { type RelKind } from "./UvlCodeView";
import type { FeatureType } from "@/lib/types";

/* -------- tiny UI helpers (same visual language as ContextMenu) -------- */
const btn =
  "px-3 py-1.5 rounded-md bg-black/[.04] hover:bg-blue-500 hover:text-white hover:border-blue-500 border border-black/10 text-[13px] text-black/80 transition-colors";
const btnPrimary =
  "px-3 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 border border-blue-600 text-[13px] font-medium transition-colors shadow-sm";
const btnDanger =
  "px-3 py-1.5 rounded-md bg-red-50 hover:bg-red-500 hover:text-white hover:border-red-500 border border-red-200 text-red-600 text-[13px] transition-colors";
const iconBtn =
  "w-8 h-8 grid place-items-center rounded-md border border-black/10 bg-white hover:bg-blue-500 hover:text-white hover:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const input =
  "w-full px-2.5 py-1.5 rounded-md bg-white border border-black/15 text-[13px] text-black outline-none focus:border-blue-500";
const chip =
  "px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-black/5 border border-black/10 text-black/60";

function Card({ title, accent, right, children, pad = true }: {
  title: string;
  accent?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <section className="bg-white/95 backdrop-blur border border-black/10 rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,.04)]">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-black/10 bg-black/[.02]">
        {accent && <span className="w-1.5 h-4 rounded-full" style={{ background: accent }} />}
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-black/70 flex-1">{title}</h3>
        {right}
      </header>
      <div className={pad ? "p-3 space-y-2.5" : ""}>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-black/50 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-md border border-black/10 bg-black/[.04] p-0.5 w-full">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-2 py-1 text-[12px] rounded-md transition-colors ${
            value === o.value
              ? "bg-white shadow-sm border border-black/10 text-black"
              : "text-black/60 hover:text-black"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ========================================================================= */

export default function Sidebar() {
  const {
    nodes, edges, groups, constraints, selectedId,
    addFeature, deleteNode, updateNode, setParentRel, select,
    createGroup, updateGroup, deleteGroup,
    addConstraint, updateConstraint, deleteConstraint,
    reset, loadModel,
    undo, redo, relayout,
    alignNodes, distributeNodes,
  } = useFM();
  const multiSelectedIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const canUndo = useFM((s) => s.past.length > 0);
  const canRedo = useFM((s) => s.future.length > 0);
  const activeTab = useFM((s) => s.tabs.find((t) => t.id === s.activeId));
  const safeName = (activeTab?.name || "feature-model").trim().replace(/[^\w\-.]+/g, "_").replace(/_+/g, "_") || "feature-model";

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const selEdge = useMemo(() => (selectedId ? edges.find((e) => e.target === selectedId) : null), [edges, selectedId]);
  const selGroup = useMemo(
    () => (selectedId ? groups.find((g) => g.parentId === selectedId) : null),
    [groups, selectedId]
  );

  const uvlText = useMemo(() => toUVL(nodes, edges, groups, constraints), [nodes, edges, groups, constraints]);
  const featureNamesSet = useMemo(() => new Set(nodes.map((n) => n.data.name)), [nodes]);

  const selectedEdgeId = useFM((s) => s.selectedEdgeId);
  const selectEdges = useFM((s) => s.selectEdges);

  // Map the currently-selected tree edge back to a (parentName, kind, childNames)
  // triple so the UVL view can highlight the matching keyword line. The
  // childNames list distinguishes two `mandatory` blocks under the same parent
  // (e.g. one for loose mandatory, one for an `and`-group).
  const highlightedRel = useMemo<{ parentName: string; kind: RelKind; childNames: string[] } | null>(() => {
    if (!selectedEdgeId || selectedEdgeId.startsWith("cons_")) return null;
    const e = edges.find((x) => x.id === selectedEdgeId);
    if (!e) return null;
    const parent = nodes.find((n) => n.id === e.source);
    if (!parent) return null;
    const g = groups.find((gr) => gr.parentId === e.source && gr.childrenIds.includes(e.target));
    const kind: RelKind = g
      ? (g.type === "and" ? ((e.data as any)?.parentRel === "optional" ? "optional" : "mandatory")
        : g.type === "or" ? "or"
        : g.type === "alternative" ? "alternative"
        : "cardinality")
      : ((e.data as any)?.parentRel === "optional" ? "optional" : "mandatory");
    // Siblings that form the same block: either all children of the group,
    // or all loose (non-grouped) children of this parent with the same rel.
    const childNames = g
      ? g.childrenIds.map((cid) => nodes.find((n) => n.id === cid)?.data.name ?? "")
      : edges
          .filter((x) =>
            x.source === parent.id &&
            !(x.data as any)?.inGroup &&
            (((x.data as any)?.parentRel ?? "mandatory") === kind)
          )
          .map((x) => nodes.find((n) => n.id === x.target)?.data.name ?? "");
    return { parentName: parent.data.name, kind, childNames: childNames.filter(Boolean) };
  }, [selectedEdgeId, edges, nodes, groups]);

  const pickRel = (parentName: string, kind: RelKind, childNames: string[]) => {
    const parent = nodes.find((n) => n.data.name === parentName);
    if (!parent) return;
    // Resolve child names to node ids under this specific parent.
    const childIdsOfParent = edges
      .filter((e) => e.source === parent.id)
      .map((e) => e.target);
    const targetIds = new Set(
      childNames
        .map((name) => nodes.find((n) => n.data.name === name && childIdsOfParent.includes(n.id))?.id)
        .filter(Boolean) as string[]
    );
    const matchIds = edges
      .filter((e) => e.source === parent.id && targetIds.has(e.target))
      .map((e) => e.id);
    if (matchIds.length) selectEdges(matchIds);
  };

  const [exportLegend, setExportLegend] = useState(true);
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exportAttributes, setExportAttributes] = useState(true);
  const [exportConstraintLines, setExportConstraintLines] = useState(true);
  const [exportConstraintsBlock, setExportConstraintsBlock] = useState(true);
  const [uvlInput, setUvlInput] = useState("");
  const [parseMsg, setParseMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Rename field uses a local draft so the user can keep typing even when the
  // intermediate value collides with another feature — the store silently
  // rejects clashes and we surface the reason as a hint under the input.
  const [nameDraft, setNameDraft] = useState("");
  useEffect(() => { setNameDraft(selected?.data.name ?? ""); }, [selected?.id, selected?.data.name]);
  const nameDraftTrim = nameDraft.trim();
  const nameError =
    selected == null
      ? null
      : !nameDraftTrim
      ? "Name cannot be empty."
      : nodes.some((n) => n.id !== selected.id && n.data.name === nameDraftTrim)
      ? `"${nameDraftTrim}" is already used by another feature.`
      : null;

  const orphanNames = useMemo(() => {
    const known = new Set(nodes.map((n) => n.data.name));
    const re = /"([^"]+)"|([A-Za-z_][\w]*)/g;
    const kw = new Set(["true", "false", "and", "or", "not"]);
    const missing = new Set<string>();
    for (const c of constraints) {
      for (const m of c.expr.matchAll(re)) {
        const raw = (m[1] ?? m[2] ?? "").trim();
        if (!raw || kw.has(raw.toLowerCase())) continue;
        if (!known.has(raw)) missing.add(raw);
      }
    }
    return [...missing];
  }, [constraints, nodes]);

  const buildSVGWithOpts = () =>
    buildSVG(nodes, edges, groups, {
      transparent: exportTransparent,
      legend: exportLegend,
      includeAttributes: exportAttributes,
      drawConstraintLines: exportConstraintLines,
      showConstraintsBlock: exportConstraintsBlock,
      constraints,
    });

  const doDownloadUVL = () => {
    const blob = new Blob([uvlText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${safeName}.uvl`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImportUVL = () => {
    try {
      const r = parseUVL(uvlInput);
      loadModel({ nodes: r.nodes, edges: r.edges, groups: r.groups, constraints: r.constraints });
      setParseMsg(
        `✓ Loaded ${r.nodes.length} features, ${r.groups.length} groups, ${r.constraints.length} constraints${
          r.warnings.length ? ` — ${r.warnings.length} warning(s)` : ""
        }`
      );
    } catch (e: any) {
      setParseMsg(`Error: ${e.message ?? e}`);
    }
  };

  const childrenOfSel = selected ? edges.filter((e) => e.source === selected.id).map((e) => e.target) : [];
  const selIsAbstract = selected ? (selected.data.abstract ?? childrenOfSel.length > 0) : false;
  const isEmptyTab = nodes.length === 0 && constraints.length === 0;

  return (
    <aside className="w-[380px] shrink-0 h-full overflow-y-auto bg-[#f3f4f6] border-r border-black/10">
      {/* ========== TITLE BAR ========== */}
      <div className="sticky top-0 z-10 px-4 py-3 bg-white/90 backdrop-blur border-b border-black/10 flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="FeatureDraw" className="h-8 w-auto shrink-0" />
          <p className="text-[11px] text-black/50 truncate">
            Editing: <span className="text-black/70 font-medium">{activeTab?.name ?? ""}</span>
          </p>
        </div>
        <SaveIndicator />
        <button className={iconBtn} title="Undo (⌘Z)" onClick={undo} disabled={!canUndo}>↶</button>
        <button className={iconBtn} title="Redo (⇧⌘Z)" onClick={redo} disabled={!canRedo}>↷</button>
      </div>

      {/* ========== TOOLBAR ========== */}
      {!isEmptyTab && (
      <div className="px-3 pt-3">
        <div className="grid grid-cols-4 gap-2">
          <button
            className={btn}
            title="Add feature as child of selection (or loose)"
            onClick={() => {
              const pos = { x: 300 + Math.random() * 120, y: 300 + Math.random() * 120 };
              addFeature(pos, selectedId ?? undefined);
            }}
          >＋ Add</button>
          <button className={btn} title="Auto-layout the tree" onClick={relayout}>⇅ Layout</button>
          <button className={btn} title="Load eShop sample" onClick={() => reset(true)}>⟳ Sample</button>
          <button
            className={btn}
            title="Clear canvas"
            onClick={() => {
              if (nodes.length === 0 && constraints.length === 0) return reset(false);
              if (confirm("Clear the canvas? This will remove all features and constraints. You can undo with ⌘Z.")) reset(false);
            }}
          >✕ Clear</button>
        </div>
      </div>
      )}

      <div className="p-3 space-y-3">
        {isEmptyTab && (
          <Card title="Start" accent="#2b6cff" right={<span className={chip}>empty tab</span>}>
            <p className="text-[12px] text-black/60 leading-relaxed">
              This tab is empty. Paste an existing UVL model below, load a <span className="font-mono">.uvl</span> file, or start drawing on the canvas (right-click the empty canvas for "Add feature here").
            </p>
            <textarea
              className={input + " font-mono text-[11px] h-40"}
              placeholder={"features\n  RootFeature\n    mandatory\n      ChildFeature"}
              value={uvlInput}
              onChange={(e) => setUvlInput(e.target.value)}
            />
            {uvlInput.trim() ? (
              <button className={btnPrimary + " w-full"} onClick={doImportUVL}>↓ Draw</button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button className={btnPrimary} disabled title="Paste or load a UVL first">Draw</button>
                <label className={btn + " text-center cursor-pointer"}>
                  Load .uvl
                  <input
                    type="file"
                    accept=".uvl,text/plain"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setUvlInput(await f.text());
                    }}
                  />
                </label>
              </div>
            )}
            {parseMsg && <p className="text-[11px] text-black/60">{parseMsg}</p>}

            <div className="relative my-1">
              <div className="absolute inset-0 flex items-center"><div className="w-full h-px bg-black/10" /></div>
              <div className="relative flex justify-center">
                <span className="bg-white px-2 text-[10px] uppercase tracking-wider text-black/40">or try</span>
              </div>
            </div>

            <button
              onClick={() => reset(true)}
              className="w-full group flex items-center gap-3 px-3 py-2.5 rounded-md bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 transition-colors text-left"
            >
              <span className="w-8 h-8 grid place-items-center rounded-md bg-blue-500 text-white text-[15px]">★</span>
              <span className="flex-1">
                <span className="block text-[13px] font-semibold text-blue-900">Load eShop sample</span>
                <span className="block text-[11px] text-blue-900/70">A ready-made feature model from the UVL paper</span>
              </span>
              <span className="text-blue-500 group-hover:translate-x-0.5 transition-transform">→</span>
            </button>
          </Card>
        )}

        {/* ========== UVL (LIVE) — primary download, comes first ========== */}
        {!isEmptyTab && (
        <Card
          title={`UVL (live) · ${activeTab?.name ?? ""}`}
          accent="#22a06b"
          right={<span className={chip}>auto</span>}
        >
          <UvlCodeView
            code={uvlText}
            selectedName={selected?.data.name ?? null}
            featureNames={featureNamesSet}
            onPickName={(name) => {
              const n = nodes.find((x) => x.data.name === name);
              if (n) select(n.id);
            }}
            onPickRel={pickRel}
            highlightedRel={highlightedRel}
          />
          <div className="grid grid-cols-2 gap-2">
            <button className={btnPrimary} onClick={doDownloadUVL}>↓ Download {safeName}.uvl</button>
            <button className={btn} onClick={() => navigator.clipboard.writeText(uvlText)}>⧉ Copy</button>
          </div>
        </Card>
        )}

        {!isEmptyTab && (<>
        {/* ========== CROSS-TREE CONSTRAINTS — right after UVL ========== */}
        <ConstraintsCard
          nodes={nodes}
          constraints={constraints}
          orphanNames={orphanNames}
          addConstraint={addConstraint}
          updateConstraint={updateConstraint}
          deleteConstraint={deleteConstraint}
        />


        {/* ========== EXPORT IMAGE ========== */}
        <Card title="Export image" accent="#b255d9">
          <div className="space-y-1.5 text-[12px] text-black/70">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={exportAttributes} onChange={(e) => setExportAttributes(e.target.checked)} />
              Show feature attributes
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={exportConstraintLines} onChange={(e) => setExportConstraintLines(e.target.checked)} />
              Draw constraint arrows <span className="text-black/40">(requires / excludes)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={exportConstraintsBlock} onChange={(e) => setExportConstraintsBlock(e.target.checked)} />
              Include constraints block <span className="text-black/40">(text list)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={exportLegend} onChange={(e) => setExportLegend(e.target.checked)} />
              Include legend
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={exportTransparent} onChange={(e) => setExportTransparent(e.target.checked)} />
              Transparent background <span className="text-black/40">(SVG · PNG)</span>
            </label>
          </div>
          <div className="grid grid-cols-4 gap-2 pt-1">
            <button className={btn} onClick={() => exportSVG(buildSVGWithOpts(), `${safeName}.svg`)} title="Vector, crisp at any size">SVG</button>
            <button className={btn} onClick={() => exportPNG(buildSVGWithOpts(), { transparent: exportTransparent }, `${safeName}.png`)} title="Raster PNG">PNG</button>
            <button className={btn} onClick={() => exportJPG(buildSVGWithOpts(), `${safeName}.jpg`)} title="JPEG (no transparency)">JPG</button>
            <button className={btn} onClick={() => exportPDF(buildSVGWithOpts(), {}, `${safeName}.pdf`)} title="PDF (vector, Overleaf-ready)">PDF</button>
          </div>
          <div className="text-[10.5px] text-black/40">Files saved as <span className="font-mono text-black/60">{safeName}.*</span></div>
        </Card>

        {/* ========== ARRANGE: multi-selection ========== */}
        {multiSelectedIds.length >= 2 && (
          <Card title={`Arrange · ${multiSelectedIds.length} selected`} accent="#6b7280">
            <div className="space-y-2">
              <div>
                <span className="block text-[11px] text-black/50 mb-1">Align horizontally</span>
                <div className="grid grid-cols-3 gap-2">
                  <button className={btn} title="Align left" onClick={() => alignNodes(multiSelectedIds, "left")}>⇤ Left</button>
                  <button className={btn} title="Align center" onClick={() => alignNodes(multiSelectedIds, "centerH")}>↔ Center</button>
                  <button className={btn} title="Align right" onClick={() => alignNodes(multiSelectedIds, "right")}>⇥ Right</button>
                </div>
              </div>
              <div>
                <span className="block text-[11px] text-black/50 mb-1">Align vertically</span>
                <div className="grid grid-cols-3 gap-2">
                  <button className={btn} title="Align top" onClick={() => alignNodes(multiSelectedIds, "top")}>⤒ Top</button>
                  <button className={btn} title="Align middle" onClick={() => alignNodes(multiSelectedIds, "middleV")}>↕ Middle</button>
                  <button className={btn} title="Align bottom" onClick={() => alignNodes(multiSelectedIds, "bottom")}>⤓ Bottom</button>
                </div>
              </div>
              <div>
                <span className="block text-[11px] text-black/50 mb-1">Distribute</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={btn + (multiSelectedIds.length < 3 ? " opacity-40 cursor-not-allowed" : "")}
                    disabled={multiSelectedIds.length < 3}
                    title="Distribute horizontally (needs 3+)"
                    onClick={() => distributeNodes(multiSelectedIds, "h")}
                  >⇔ Horizontal</button>
                  <button
                    className={btn + (multiSelectedIds.length < 3 ? " opacity-40 cursor-not-allowed" : "")}
                    disabled={multiSelectedIds.length < 3}
                    title="Distribute vertically (needs 3+)"
                    onClick={() => distributeNodes(multiSelectedIds, "v")}
                  >⇕ Vertical</button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ========== EDITOR: selected feature ========== */}
        <Card
          title="Editor"
          accent="#2b6cff"
          right={selected ? (
            <span className="flex items-center gap-1.5">
              <span className={chip}>{selected.data.featureType}</span>
              {selIsAbstract && <span className={chip}>abstract</span>}
            </span>
          ) : <span className="text-[11px] text-black/40">nothing selected</span>}
        >
          {!selected ? (
            <div className="text-[12px] text-black/50 leading-relaxed">
              Click a feature to edit. <br />
              Right-click for the full menu. <br />
              Double-click a node to rename it.
            </div>
          ) : (
            <>
              <Field label="Name">
                <input
                  className={input + (nameError ? " border-red-400 focus:border-red-500" : "")}
                  value={nameDraft}
                  onChange={(e) => {
                    setNameDraft(e.target.value);
                    updateNode(selected.id, { name: e.target.value });
                  }}
                />
                {nameError && (
                  <span className="block mt-1 text-[11px] text-red-600">{nameError}</span>
                )}
              </Field>

              <Field label="Type">
                <Segmented<FeatureType>
                  value={selected.data.featureType}
                  onChange={(v) => updateNode(selected.id, { featureType: v })}
                  options={[
                    { value: "Boolean", label: "Bool" },
                    { value: "Integer", label: "Int" },
                    { value: "Float", label: "Float" },
                    { value: "String", label: "Str" },
                  ]}
                />
              </Field>

              {selEdge && (
                <Field label="Relation to parent">
                  <Segmented<"mandatory" | "optional">
                    value={selected.data.parentRel}
                    onChange={(v) => setParentRel(selected.id, v)}
                    options={[
                      { value: "mandatory", label: "● Mandatory" },
                      { value: "optional", label: "○ Optional" },
                    ]}
                  />
                </Field>
              )}

              <Field label="Feature cardinality">
                <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5">
                  <input
                    className={input}
                    type="number"
                    placeholder="n"
                    value={selected.data.cardinality?.lower ?? ""}
                    onChange={(e) => {
                      const lower = parseInt(e.target.value, 10);
                      if (isNaN(lower)) return updateNode(selected.id, { cardinality: undefined });
                      updateNode(selected.id, { cardinality: { lower, upper: selected.data.cardinality?.upper ?? lower } });
                    }}
                  />
                  <span className="text-black/40">..</span>
                  <input
                    className={input}
                    type="number"
                    placeholder="m"
                    value={selected.data.cardinality?.upper ?? ""}
                    onChange={(e) => {
                      const upper = parseInt(e.target.value, 10);
                      if (isNaN(upper)) return;
                      updateNode(selected.id, { cardinality: { lower: selected.data.cardinality?.lower ?? 1, upper } });
                    }}
                  />
                  {selected.data.cardinality && (
                    <button
                      className="text-black/40 hover:text-red-500 text-[11px]"
                      title="Remove cardinality"
                      onClick={() => updateNode(selected.id, { cardinality: undefined })}
                    >✕</button>
                  )}
                </div>
              </Field>

              {/* attributes */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-black/50">Attributes</span>
                  <button
                    className="text-[11px] text-blue-600 hover:underline"
                    onClick={() => updateNode(selected.id, { attributes: [...selected.data.attributes, { key: "key", value: "" }] })}
                  >+ add</button>
                </div>
                {selected.data.attributes.length === 0 && (
                  <div className="text-[11px] text-black/40 italic">None</div>
                )}
                <div className="space-y-1">
                  {selected.data.attributes.map((a, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                      <input
                        className={input}
                        placeholder="key"
                        value={a.key}
                        onChange={(e) => {
                          const next = [...selected.data.attributes];
                          next[i] = { ...next[i], key: e.target.value };
                          updateNode(selected.id, { attributes: next });
                        }}
                      />
                      <input
                        className={input}
                        placeholder="value"
                        value={a.value}
                        onChange={(e) => {
                          const next = [...selected.data.attributes];
                          next[i] = { ...next[i], value: e.target.value };
                          updateNode(selected.id, { attributes: next });
                        }}
                      />
                      <button
                        className="px-2 text-black/30 hover:text-red-500"
                        onClick={() => updateNode(selected.id, { attributes: selected.data.attributes.filter((_, j) => j !== i) })}
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* group section */}
              {childrenOfSel.length > 0 && (
                <Field label="Group of children">
                  {selGroup ? (
                    <div className="space-y-2">
                      <Segmented<"and" | "or" | "alternative" | "cardinality">
                        value={selGroup.type}
                        onChange={(v) => updateGroup(selGroup.id, { type: v })}
                        options={[
                          { value: "and", label: "and" },
                          { value: "or", label: "or" },
                          { value: "alternative", label: "xor" },
                          { value: "cardinality", label: "[n..m]" },
                        ]}
                      />
                      {selGroup.type === "cardinality" && (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                          <input className={input} type="number" placeholder="n"
                            value={selGroup.cardinality?.lower ?? 1}
                            onChange={(e) => updateGroup(selGroup.id, {
                              cardinality: { lower: parseInt(e.target.value) || 1, upper: selGroup.cardinality?.upper ?? 1 },
                            })}
                          />
                          <span className="text-black/40">..</span>
                          <input className={input} type="number" placeholder="m"
                            value={selGroup.cardinality?.upper ?? selGroup.childrenIds.length}
                            onChange={(e) => updateGroup(selGroup.id, {
                              cardinality: { lower: selGroup.cardinality?.lower ?? 1, upper: parseInt(e.target.value) || 1 },
                            })}
                          />
                        </div>
                      )}
                      <button className={btn + " w-full"} onClick={() => deleteGroup(selGroup.id)}>Remove group</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <button className={btn} onClick={() => createGroup(selected.id, childrenOfSel, "alternative")}>xor</button>
                      <button className={btn} onClick={() => createGroup(selected.id, childrenOfSel, "or")}>or</button>
                      <button className={btn} onClick={() => createGroup(selected.id, childrenOfSel, "cardinality")}>[n..m]</button>
                    </div>
                  )}
                </Field>
              )}

              <div className="pt-1">
                <button className={btnDanger + " w-full"} onClick={() => deleteNode(selected.id)}>
                  🗑 Delete feature (Del)
                </button>
              </div>
            </>
          )}
        </Card>

        {/* ========== IMPORT UVL (collapsed) ========== */}
        <Card
          title="Import UVL"
          accent="#6b7280"
          right={
            <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setImportOpen((o) => !o)}>
              {importOpen ? "hide" : "show"}
            </button>
          }
        >
          {importOpen ? (
            <>
              <textarea
                className={input + " font-mono text-[11px] h-36"}
                placeholder="Paste UVL here…"
                value={uvlInput}
                onChange={(e) => setUvlInput(e.target.value)}
              />
              {uvlInput.trim() ? (
                <button className={btnPrimary + " w-full"} onClick={doImportUVL}>↓ Draw</button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button className={btnPrimary} disabled title="Paste or load a UVL first">Draw</button>
                  <label className={btn + " text-center cursor-pointer"}>
                    Load .uvl
                    <input
                      type="file"
                      accept=".uvl,text/plain"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setUvlInput(await f.text());
                      }}
                    />
                  </label>
                </div>
              )}
              {parseMsg && <p className="text-[11px] text-black/60">{parseMsg}</p>}
            </>
          ) : (
            <p className="text-[11px] text-black/40 italic">Click “show” to paste or load a UVL file.</p>
          )}
        </Card>
        </>)}

        <div className="h-2" />
      </div>
    </aside>
  );
}

/* ====================== save indicator ================================= */

function SaveIndicator() {
  // Zustand's persist writes on every set(), so we treat any mutation as
  // "saved the next tick". We flash "Saving…" briefly then show a relative
  // timestamp so the user knows autosave is wired up.
  const [savedAt, setSavedAt] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = useFM.subscribe((s, prev) => {
      if (
        s.nodes !== prev.nodes ||
        s.edges !== prev.edges ||
        s.groups !== prev.groups ||
        s.constraints !== prev.constraints
      ) {
        setSaving(true);
        const t = setTimeout(() => {
          setSavedAt(Date.now());
          setSaving(false);
        }, 250);
        return () => clearTimeout(t);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const ago = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  const rel =
    ago < 5 ? "just now" : ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.round(ago / 60)}m ago` : `${Math.round(ago / 3600)}h ago`;

  return (
    <span
      className="text-[10.5px] text-black/45 mr-1 whitespace-nowrap"
      title="Autosaved to localStorage"
    >
      {saving ? (
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Saving…</span>
      ) : (
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Saved · {rel}</span>
      )}
    </span>
  );
}

/* ====================== constraints card (visual editor) ================= */

function ConstraintsCard({
  nodes, constraints, orphanNames,
  addConstraint, updateConstraint, deleteConstraint,
}: {
  nodes: ReturnType<typeof useFM>["nodes"];
  constraints: ReturnType<typeof useFM>["constraints"];
  orphanNames: string[];
  addConstraint: (expr: string) => void;
  updateConstraint: (id: string, expr: string) => void;
  deleteConstraint: (id: string) => void;
}) {
  const names = useMemo(() => nodes.map((n) => n.data.name).sort((a, b) => a.localeCompare(b)), [nodes]);
  const visualMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof parseVisualConstraints>[number]>();
    for (const v of parseVisualConstraints(constraints)) m.set(v.id, v);
    return m;
  }, [constraints]);

  const q = (n: string) => (/^[A-Za-z0-9_]*[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n}"`);
  const build = (kind: "requires" | "excludes", a: string, b: string) =>
    kind === "requires" ? `${q(a)} => ${q(b)}` : `!(${q(a)} & ${q(b)})`;

  const addVisual = () => {
    if (names.length < 2) return;
    addConstraint(build("requires", names[0], names[1]));
  };
  const addAdvanced = () => {
    // Seed with a valid stub so the UVL stays parseable.
    addConstraint(names.length >= 2 ? `(${q(names[0])} & ${q(names[1])}) => true` : "true");
  };

  // Per-row override: force the text editor even if the expression is
  // currently parseable. Useful to convert a visual row into a complex one.
  const [forceText, setForceText] = useState<Record<string, boolean>>({});

  return (
    <Card
      title="Cross-tree constraints"
      accent="#d98e00"
      right={
        <span className="flex items-center gap-2">
          <button
            className="text-[11px] text-blue-600 hover:underline disabled:text-black/30"
            disabled={names.length < 2}
            title={names.length < 2 ? "Need at least two features" : "Add a requires/excludes constraint"}
            onClick={addVisual}
          >+ add</button>
          <button
            className="text-[11px] text-black/50 hover:text-black hover:underline"
            title="Add a free-form constraint (e.g. (A & B) => C)"
            onClick={addAdvanced}
          >+ advanced</button>
        </span>
      }
    >
      {constraints.length === 0 && (
        <div className="text-[11px] text-black/40 italic">None</div>
      )}
      {orphanNames.length > 0 && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          Unknown feature{orphanNames.length > 1 ? "s" : ""} referenced:{" "}
          <span className="font-mono">{orphanNames.join(", ")}</span>
        </div>
      )}
      <div className="space-y-1.5">
        {constraints.map((c) => {
          const v = visualMap.get(c.id);
          if (v && !forceText[c.id]) {
            const left = v.kind === "requires" ? v.from : v.a;
            const right = v.kind === "requires" ? v.to : v.b;
            const setPart = (part: "kind" | "left" | "right", value: string) => {
              const next = {
                kind: part === "kind" ? (value as "requires" | "excludes") : v.kind,
                left: part === "left" ? value : left,
                right: part === "right" ? value : right,
              };
              if (next.left === next.right) return;
              updateConstraint(c.id, build(next.kind, next.left, next.right));
            };
            const missing = !names.includes(left) || !names.includes(right);
            return (
              <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_auto] gap-1 items-center">
                <select
                  className={`px-1.5 py-1 rounded-md bg-white border text-[12px] outline-none ${missing && !names.includes(left) ? "border-amber-400" : "border-black/15"}`}
                  value={names.includes(left) ? left : ""}
                  onChange={(e) => setPart("left", e.target.value)}
                >
                  {!names.includes(left) && <option value="">{left} (missing)</option>}
                  {names.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <select
                  className="px-1.5 py-1 rounded-md bg-black/[.04] border border-black/15 text-[12px] outline-none appearance-none text-center font-mono"
                  value={v.kind}
                  onChange={(e) => setPart("kind", e.target.value)}
                  title={v.kind === "requires" ? "A requires B" : "A excludes B"}
                >
                  <option value="requires">⇒</option>
                  <option value="excludes">✕</option>
                </select>
                <select
                  className={`px-1.5 py-1 rounded-md bg-white border text-[12px] outline-none ${missing && !names.includes(right) ? "border-amber-400" : "border-black/15"}`}
                  value={names.includes(right) ? right : ""}
                  onChange={(e) => setPart("right", e.target.value)}
                >
                  {!names.includes(right) && <option value="">{right} (missing)</option>}
                  {names.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <button
                  className="px-1 text-[10px] text-black/40 hover:text-black"
                  title="Edit as text (switch to advanced)"
                  onClick={() => setForceText((m) => ({ ...m, [c.id]: true }))}
                >{"{ }"}</button>
                <button className="px-1.5 text-black/30 hover:text-red-500" onClick={() => deleteConstraint(c.id)}>✕</button>
              </div>
            );
          }
          // Advanced / non-visual expression — raw text input.
          const canSwitchBack = !!visualMap.get(c.id);
          return (
            <div key={c.id} className="grid grid-cols-[1fr_auto_auto] gap-1 items-center">
              <input
                className="w-full px-2 py-1 rounded-md bg-white border border-black/15 text-black outline-none focus:border-blue-500 font-mono text-[12px]"
                value={c.expr}
                onChange={(e) => updateConstraint(c.id, e.target.value)}
                title="Free-form constraint (UVL propositional expression)"
              />
              {canSwitchBack && (
                <button
                  className="px-1 text-[10px] text-black/40 hover:text-black"
                  title="Back to visual editor"
                  onClick={() => setForceText((m) => { const { [c.id]: _, ...rest } = m; void _; return rest; })}
                >◨</button>
              )}
              <button className="px-2 text-black/30 hover:text-red-500" onClick={() => deleteConstraint(c.id)}>✕</button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
