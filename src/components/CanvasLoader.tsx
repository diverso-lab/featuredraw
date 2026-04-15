"use client";
/**
 * Lightweight, self-contained loading overlay.
 * Draws a tiny animated feature-tree skeleton while React Flow measures nodes.
 */
export default function CanvasLoader() {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#f3f4f6]/80 backdrop-blur-sm pointer-events-none">
      <style>{`
        @keyframes fd-pulse { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
        @keyframes fd-draw  { from { stroke-dashoffset: 120 } to { stroke-dashoffset: 0 } }
        @keyframes fd-fade  { from { opacity: 0 } to { opacity: 1 } }
        .fd-node { animation: fd-pulse 1.4s ease-in-out infinite; }
        .fd-n0 { animation-delay: 0s }
        .fd-n1 { animation-delay: .15s }
        .fd-n2 { animation-delay: .30s }
        .fd-n3 { animation-delay: .45s }
        .fd-edge { stroke-dasharray: 120; animation: fd-draw 1.2s ease-out forwards, fd-pulse 1.4s ease-in-out infinite 1.2s; }
        .fd-card { animation: fd-fade .25s ease-out; }
      `}</style>

      <div className="fd-card flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-white/95 border border-black/10 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <svg width="160" height="90" viewBox="0 0 160 90" fill="none">
          {/* edges */}
          <line x1="80" y1="22" x2="28" y2="68" stroke="#111418" strokeWidth="2" className="fd-edge" />
          <line x1="80" y1="22" x2="80" y2="68" stroke="#111418" strokeWidth="2" className="fd-edge" />
          <line x1="80" y1="22" x2="132" y2="68" stroke="#111418" strokeWidth="2" className="fd-edge" />

          {/* nodes */}
          <rect x="56" y="6" width="48" height="22" rx="8" fill="#111418" className="fd-node fd-n0" />
          <rect x="6"  y="62" width="44" height="22" rx="8" fill="#111418" className="fd-node fd-n1" />
          <rect x="58" y="62" width="44" height="22" rx="8" fill="#111418" className="fd-node fd-n2" />
          <rect x="110" y="62" width="44" height="22" rx="8" fill="#111418" className="fd-node fd-n3" />
        </svg>

        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-[12px] font-medium text-black/70 tracking-tight">
            Loading canvas…
          </span>
        </div>
      </div>
    </div>
  );
}
