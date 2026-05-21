"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSVG, exportJPG, exportPDF, exportPNG, exportSVG,
  type LegendPosition,
} from "@/lib/exporter";
import type { FMEdge, FMNode } from "@/lib/store";
import type { Constraint, Group } from "@/lib/types";

export type ExportOpts = {
  transparent: boolean;
  legend: boolean;
  legendPosition: LegendPosition;
  includeAttributes: boolean;
  drawConstraintLines: boolean;
  showConstraintsBlock: boolean;
  groupLegendAndConstraints: boolean;
  /** Base font size in px for feature names (attrs/cardinality scale too). */
  featureFontPx: number;
  /** Base font size for legend items (title scales proportionally). */
  legendFontPx: number;
  /** Base font size for constraint expressions (title scales too). */
  constraintFontPx: number;
};

const FEATURE_PRESETS = [13, 15, 17, 20];
const LEGEND_PRESETS  = [10, 12, 14, 16];
const CONS_PRESETS    = [10, 11.5, 14, 16];

type Overrides = {
  nodePos: Record<string, { x: number; y: number }>;
  legendPos: { x: number; y: number } | null;
  consPos: { x: number; y: number } | null;
};

const EMPTY_OVERRIDES: Overrides = { nodePos: {}, legendPos: null, consPos: null };

export default function ExportPreviewModal({
  open, onClose, nodes, edges, groups, constraints, fileBase, opts, onOptsChange,
}: {
  open: boolean;
  onClose: () => void;
  nodes: FMNode[];
  edges: FMEdge[];
  groups: Group[];
  constraints: Constraint[];
  fileBase: string;
  opts: ExportOpts;
  onOptsChange: (next: ExportOpts) => void;
}) {
  // Drag overrides are LOCAL to the modal — they only affect the exported
  // image. The canvas state is never mutated. On reopen, layout is fresh.
  const [overrides, setOverrides] = useState<Overrides>(EMPTY_OVERRIDES);
  useEffect(() => { if (open) setOverrides(EMPTY_OVERRIDES); }, [open]);

  // Zoom (1 = 100%) and pan in SCREEN px. transform applied: translate then scale.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The SVG is the single source of truth — same string is rendered in the
  // preview AND fed into every download path, so what-you-see is exactly
  // what-you-export. Re-rendered on any opts/override change.
  const svg = useMemo(() => buildSVG(nodes, edges, groups, {
    ...opts,
    constraints,
    nodePosOverride: overrides.nodePos,
    legendPosOverride: overrides.legendPos ?? undefined,
    consPosOverride: overrides.consPos ?? undefined,
  }), [nodes, edges, groups, constraints, opts, overrides]);

  // Parse outer SVG width/height so we can size the inner box and compute fit.
  const svgDim = useMemo(() => {
    const m = svg.match(/<svg [^>]*width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/);
    return m ? { w: +m[1], h: +m[2] } : { w: 600, h: 400 };
  }, [svg]);

  // Fit-to-screen: compute zoom so the SVG fills the surface with breathing room.
  const fitToScreen = useCallback(() => {
    if (!surfaceRef.current) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const z = Math.min((rect.width - 48) / svgDim.w, (rect.height - 48) / svgDim.h);
    const newZoom = Math.max(0.1, Math.min(2, z));
    setZoom(newZoom);
    // Center the SVG within the surface at the new zoom.
    setPan({
      x: (rect.width - svgDim.w * newZoom) / 2,
      y: (rect.height - svgDim.h * newZoom) / 2,
    });
  }, [svgDim.w, svgDim.h]);

  // Auto-fit on open + when the SVG's natural size changes a lot (e.g. user
  // toggled "include legend" so the canvas reshaped).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(fitToScreen, 30);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opts.legend, opts.legendPosition, opts.showConstraintsBlock]);

  // Wheel zoom — centred on cursor so the spot under the mouse stays put.
  const onWheel = (e: React.WheelEvent) => {
    if (!surfaceRef.current) return;
    e.preventDefault();
    const rect = surfaceRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const oldZoom = zoom;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newZoom = Math.max(0.1, Math.min(5, oldZoom * factor));
    // Solve: cursor stays over same SVG point.
    //   sx = (cx - pan.x) / oldZoom        (SVG x under cursor pre-zoom)
    //   pan.x' = cx - sx * newZoom         (pan so same sx lands at cx after zoom)
    setPan({
      x: cx - (cx - pan.x) * newZoom / oldZoom,
      y: cy - (cy - pan.y) * newZoom / oldZoom,
    });
    setZoom(newZoom);
  };

  // Drag bookkeeping in a ref so pointermove doesn't churn re-renders for
  // bookkeeping that isn't on the render path.
  const dragState = useRef<null | {
    kind: "pan" | "node" | "legend" | "cons";
    id?: string;
    startScreenX: number;
    startScreenY: number;
    origX: number;       // SVG coords (for node/legend/cons) OR pan px (for pan)
    origY: number;
    pointerId: number;
  }>(null);

  // Read element's current local translate — that's the raw SVG coord which
  // is exactly what buildSVG accepts as a *PosOverride.
  const readTranslate = (el: SVGElement): { x: number; y: number } => {
    const tf = el.getAttribute("transform") || "";
    const m = tf.match(/translate\(([^,]+),\s*([^)]+)\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const dragEl = target.closest("[data-drag]") as SVGElement | null;
    if (dragEl) {
      const kind = dragEl.getAttribute("data-drag") as "node" | "legend" | "cons";
      const id = dragEl.getAttribute("data-id") ?? undefined;
      const { x: origX, y: origY } = readTranslate(dragEl);
      dragState.current = {
        kind, id,
        startScreenX: e.clientX, startScreenY: e.clientY,
        origX, origY,
        pointerId: e.pointerId,
      };
    } else {
      dragState.current = {
        kind: "pan",
        startScreenX: e.clientX, startScreenY: e.clientY,
        origX: pan.x, origY: pan.y,
        pointerId: e.pointerId,
      };
      setIsPanning(true);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.startScreenX;
    const dy = e.clientY - st.startScreenY;
    if (st.kind === "pan") {
      setPan({ x: st.origX + dx, y: st.origY + dy });
      return;
    }
    // Screen delta → SVG delta (must un-scale by zoom).
    const newX = st.origX + dx / zoom;
    const newY = st.origY + dy / zoom;
    if (st.kind === "node" && st.id) {
      setOverrides((o) => ({ ...o, nodePos: { ...o.nodePos, [st.id!]: { x: newX, y: newY } } }));
    } else if (st.kind === "legend") {
      setOverrides((o) => ({ ...o, legendPos: { x: newX, y: newY } }));
    } else if (st.kind === "cons") {
      setOverrides((o) => ({ ...o, consPos: { x: newX, y: newY } }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current && dragState.current.pointerId === e.pointerId) {
      if (dragState.current.kind === "pan") setIsPanning(false);
      dragState.current = null;
    }
  };

  if (!open) return null;

  const set = <K extends keyof ExportOpts>(k: K, v: ExportOpts[K]) =>
    onOptsChange({ ...opts, [k]: v });

  const hasOverrides =
    Object.keys(overrides.nodePos).length > 0 || !!overrides.legendPos || !!overrides.consPos;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[1400px] h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-black/10">
          <h2 className="text-[14px] font-semibold text-black/80">
            Export preview · <span className="font-mono text-black/50">{fileBase}.*</span>
          </h2>
          <button
            className="w-8 h-8 grid place-items-center rounded-md hover:bg-black/5 text-black/60"
            onClick={onClose}
            aria-label="Close"
          >✕</button>
        </header>

        {/* Body: preview surface + options sidebar */}
        <div className="flex-1 flex min-h-0">
          {/* Preview column */}
          <div className="flex-1 min-w-0 flex flex-col bg-[#eef0f3]">
            {/* Zoom toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-black/10 bg-white">
              <button className={tbBtn} onClick={() => setZoom((z) => Math.max(0.1, z * 0.85))} title="Zoom out">−</button>
              <span className="px-2 text-[12px] text-black/60 font-mono w-14 text-center select-none">{Math.round(zoom * 100)}%</span>
              <button className={tbBtn} onClick={() => setZoom((z) => Math.min(5, z * 1.18))} title="Zoom in">+</button>
              <button className={tbBtn} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset zoom to 100%">100%</button>
              <button className={tbBtn} onClick={fitToScreen} title="Fit SVG to the visible area">⛶ Fit</button>
              <div className="flex-1" />
              {hasOverrides && (
                <button
                  className="px-2.5 py-1 rounded border border-amber-300 bg-amber-50 text-[12px] text-amber-700 hover:bg-amber-100"
                  onClick={() => setOverrides(EMPTY_OVERRIDES)}
                  title="Discard all drag positions and restore the automatic layout"
                >↺ Reset positions</button>
              )}
              <span className="text-[11px] text-black/45 ml-2 hidden md:inline">
                drag elements · drag empty area to pan · wheel to zoom
              </span>
            </div>

            {/* Surface: scrollable transparent-checker background */}
            <div
              ref={surfaceRef}
              className="flex-1 overflow-hidden relative select-none touch-none"
              style={{
                cursor: isPanning ? "grabbing" : "grab",
                backgroundImage:
                  "linear-gradient(45deg, #d8dde3 25%, transparent 25%, transparent 75%, #d8dde3 75%, #d8dde3)," +
                  "linear-gradient(45deg, #d8dde3 25%, #f3f4f6 25%, #f3f4f6 75%, #d8dde3 75%, #d8dde3)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 10px 10px",
              }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className="absolute top-0 left-0"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "0 0",
                  width: svgDim.w,
                  height: svgDim.h,
                  background: opts.transparent ? "transparent" : "#ffffff",
                  boxShadow: opts.transparent ? "none" : "0 1px 8px rgba(0,0,0,.18)",
                }}
                // Inline SVG so the data-drag attrs on its groups are real DOM
                // nodes our pointer handlers can find.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>

          {/* Options sidebar */}
          <aside className="w-[280px] shrink-0 border-l border-black/10 bg-[#fafbfc] overflow-y-auto p-4 space-y-5">
            <section className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-black/50">Content</h3>
              <Toggle label="Show attributes"        v={opts.includeAttributes}    on={(b) => set("includeAttributes", b)} />
              <Toggle label="Constraint arrows"      v={opts.drawConstraintLines}  on={(b) => set("drawConstraintLines", b)} />
              <Toggle label="Constraints block"      v={opts.showConstraintsBlock} on={(b) => set("showConstraintsBlock", b)} />
              <Toggle label="Transparent background" v={opts.transparent}          on={(b) => set("transparent", b)} hint="SVG · PNG" />
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-black/50">Legend</h3>
              <Toggle label="Include legend" v={opts.legend} on={(b) => set("legend", b)} />
              <div className={opts.legend ? "" : "opacity-40 pointer-events-none"}>
                <span className="block text-[11px] text-black/50 mb-1">Position</span>
                <LegendPositionPicker value={opts.legendPosition} onChange={(p) => set("legendPosition", p)} />
                <div className="mt-2">
                  <Toggle
                    label="Keep next to constraints"
                    v={opts.groupLegendAndConstraints}
                    on={(b) => set("groupLegendAndConstraints", b)}
                  />
                  <p className="text-[10.5px] text-black/40 mt-1 leading-snug pl-5">
                    Treats legend + constraints as a single block (cons under
                    the legend for side layouts, to the right for top/bottom).
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-black/50">Text size</h3>
              <FontSizePicker
                label="Features"
                value={opts.featureFontPx}
                presets={FEATURE_PRESETS}
                onChange={(v) => set("featureFontPx", v)}
              />
              <FontSizePicker
                label="Legend"
                value={opts.legendFontPx}
                presets={LEGEND_PRESETS}
                onChange={(v) => set("legendFontPx", v)}
              />
              <FontSizePicker
                label="Constraints"
                value={opts.constraintFontPx}
                presets={CONS_PRESETS}
                onChange={(v) => set("constraintFontPx", v)}
              />
            </section>

            <section className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-black/50">Edit</h3>
              <p className="text-[11px] text-black/60 leading-snug">
                Drag any node, the legend, or the constraints box to reposition
                it. Whatever you drag, the exported file is always re-cropped
                with equal padding on all four sides.
              </p>
            </section>
          </aside>
        </div>

        {/* Download footer */}
        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-black/10 bg-white">
          <span className="text-[12px] text-black/50">Files saved as <span className="font-mono text-black/70">{fileBase}.*</span></span>
          <div className="flex items-center gap-2">
            <DLBtn label="SVG" onClick={() => exportSVG(svg, `${fileBase}.svg`)} title="Vector, crisp at any size" />
            <DLBtn label="PNG" onClick={() => exportPNG(svg, { transparent: opts.transparent }, `${fileBase}.png`)} title="Raster PNG" />
            <DLBtn label="JPG" onClick={() => exportJPG(svg, `${fileBase}.jpg`)} title="JPEG (no transparency)" />
            <DLBtn label="PDF" onClick={() => exportPDF(svg, {}, `${fileBase}.pdf`)} title="PDF (identical to preview)" />
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ---------- bits ---------- */

const tbBtn = "px-2.5 py-1 rounded border border-black/10 bg-white text-[12.5px] text-black/70 hover:bg-black/[.04]";

function Toggle({ label, v, on, hint }: {
  label: string; v: boolean; on: (b: boolean) => void; hint?: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-[12.5px] text-black/75">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-black/35">{hint}</span>}
    </label>
  );
}

function DLBtn({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
  return (
    <button
      className="px-3.5 py-2 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-[13px] font-medium border border-blue-600 transition-colors shadow-sm"
      title={title}
      onClick={onClick}
    >
      ↓ {label}
    </button>
  );
}

function LegendPositionPicker({ value, onChange }: { value: LegendPosition; onChange: (p: LegendPosition) => void }) {
  const opts: { v: LegendPosition; label: string; mini: React.ReactNode }[] = [
    { v: "right",  label: "Right",  mini: <Mini orientation="row"    legendOn="end"   /> },
    { v: "left",   label: "Left",   mini: <Mini orientation="row"    legendOn="start" /> },
    { v: "top",    label: "Top",    mini: <Mini orientation="column" legendOn="start" /> },
    { v: "bottom", label: "Bottom", mini: <Mini orientation="column" legendOn="end"   /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`flex flex-col items-center gap-1 p-2 rounded-md border transition-colors ${
            value === o.v
              ? "border-blue-500 bg-blue-50"
              : "border-black/10 bg-white hover:border-black/25"
          }`}
        >
          {o.mini}
          <span className="text-[11px] text-black/70">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function FontSizePicker({ label, value, presets, onChange }: {
  label: string; value: number; presets: number[]; onChange: (v: number) => void;
}) {
  return (
    <div>
      <span className="block text-[11px] text-black/60 mb-1">{label} · <span className="font-mono text-black/40">{value}px</span></span>
      <div className="inline-flex rounded-md border border-black/10 bg-black/[.04] p-0.5 w-full">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`flex-1 px-1 py-0.5 text-[11px] rounded-md transition-colors ${
              Math.abs(value - p) < 0.01
                ? "bg-white shadow-sm border border-black/10 text-black"
                : "text-black/60 hover:text-black"
            }`}
            title={`${p}px`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function Mini({ orientation, legendOn }: { orientation: "row" | "column"; legendOn: "start" | "end" }) {
  const isRow = orientation === "row";
  const diagram = <div className={isRow ? "flex-1 bg-black/15 rounded-sm" : "flex-1 bg-black/15 rounded-sm"} />;
  const legend = (
    <div className="bg-blue-500 rounded-sm" style={isRow ? { width: 12 } : { height: 8 }} />
  );
  return (
    <div className={`flex gap-1 w-12 h-9 ${isRow ? "flex-row" : "flex-col"}`}>
      {legendOn === "start" ? legend : diagram}
      {legendOn === "start" ? diagram : legend}
    </div>
  );
}
