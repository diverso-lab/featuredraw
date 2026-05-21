// Exact text-width measurement via a hidden <canvas> so the exporter and
// the auto-layout use the SAME widths the browser will render in the
// FeatureNode div (which simply auto-sizes around its <span>). Without
// this, a length × CHAR_W estimate consistently misses by ±10–15px on
// long names → boxes in the SVG/PDF preview were ~15px wider than the
// boxes on the canvas, so already-tight layouts overlapped on export.
//
// One canvas, one cache, one font stack. Same font stack as FeatureNode's
// `text-[15px] font-semibold` (system-ui / Tailwind default sans).

let _ctx: CanvasRenderingContext2D | null = null;
const _cache = new Map<string, number>();

function getCtx(): CanvasRenderingContext2D | null {
  if (_ctx) return _ctx;
  if (typeof document === "undefined") return null; // SSR
  const c = document.createElement("canvas");
  _ctx = c.getContext("2d");
  return _ctx;
}

export function measureTextPx(
  text: string,
  fontPx: number,
  weight: number = 400,
  family: string = "system-ui, sans-serif",
): number {
  if (!text) return 0;
  const key = `${family}|${weight}|${fontPx}|${text}`;
  const cached = _cache.get(key);
  if (cached !== undefined) return cached;
  const ctx = getCtx();
  let w: number;
  if (!ctx) {
    // SSR / no-canvas fallback — keep close to typical sans-serif metrics
    // (≈ 0.55em average) so the first render before hydration isn't wildly
    // off. The real measurement replaces this on the client.
    w = text.length * fontPx * 0.55;
  } else {
    ctx.font = `${weight} ${fontPx}px ${family}`;
    w = ctx.measureText(text).width;
  }
  _cache.set(key, w);
  return w;
}
