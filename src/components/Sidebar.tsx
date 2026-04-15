"use client";
import { useMemo, useState } from "react";
import { useFM } from "@/lib/store";
import { toUVL } from "@/lib/uvl";
import { parseUVL } from "@/lib/uvlParser";
import { buildSVG, exportJPG, exportPDF, exportPNG, exportSVG } from "@/lib/exporter";
import UvlCodeView from "./UvlCodeView";
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
    addFeature, deleteNode, updateNode, setParentRel,
    createGroup, updateGroup, deleteGroup,
    addConstraint, updateConstraint, deleteConstraint,
    reset, loadModel,
    undo, redo, relayout,
  } = useFM();
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

  const [exportLegend, setExportLegend] = useState(true);
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exportAttributes, setExportAttributes] = useState(true);
  const [exportConstraintLines, setExportConstraintLines] = useState(true);
  const [exportConstraintsBlock, setExportConstraintsBlock] = useState(true);
  const [uvlInput, setUvlInput] = useState("");
  const [parseMsg, setParseMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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
        <div className="flex-1 min-w-0">
          <h1 className="text-[15px] font-bold tracking-tight">FeatureDraw</h1>
          <p className="text-[11px] text-black/50 -mt-0.5 truncate">
            Editing: <span className="text-black/70 font-medium">{activeTab?.name ?? ""}</span>
          </p>
        </div>
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
          <button className={btn} title="Clear canvas" onClick={() => reset(false)}>✕ Clear</button>
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
          <UvlCodeView code={uvlText} />
          <div className="grid grid-cols-2 gap-2">
            <button className={btnPrimary} onClick={doDownloadUVL}>↓ Download {safeName}.uvl</button>
            <button className={btn} onClick={() => navigator.clipboard.writeText(uvlText)}>⧉ Copy</button>
          </div>
        </Card>
        )}

        {!isEmptyTab && (<>
        {/* ========== CROSS-TREE CONSTRAINTS — right after UVL ========== */}
        <Card title="Cross-tree constraints" accent="#d98e00" right={
          <button className="text-[11px] text-blue-600 hover:underline" onClick={() => addConstraint("A => B")}>+ add</button>
        }>
          {constraints.length === 0 && (
            <div className="text-[11px] text-black/40 italic">None</div>
          )}
          <div className="space-y-1">
            {constraints.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_auto] gap-1">
                <input
                  className={input + " font-mono text-[12px]"}
                  value={c.expr}
                  onChange={(e) => updateConstraint(c.id, e.target.value)}
                />
                <button className="px-2 text-black/30 hover:text-red-500" onClick={() => deleteConstraint(c.id)}>✕</button>
              </div>
            ))}
          </div>
        </Card>

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
                  className={input}
                  value={selected.data.name}
                  onChange={(e) => updateNode(selected.id, { name: e.target.value })}
                />
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
