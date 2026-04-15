"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useFM } from "@/lib/store";

export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const nodes = useFM((s) => s.nodes);
  const select = useFM((s) => s.select);
  const rf = useReactFlow();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return nodes.slice(0, 20);
    return nodes.filter((n) => n.data.name.toLowerCase().includes(needle)).slice(0, 20);
  }, [nodes, q]);

  useEffect(() => { setIdx(0); }, [q]);

  const pick = (id: string) => {
    select(id);
    const n = nodes.find((x) => x.id === id);
    if (n) rf.setCenter(n.position.x + 80, n.position.y + 40, { zoom: 1.1, duration: 300 });
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const n = results[idx]; if (n) pick(n.id); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/20"
      onMouseDown={onClose}
    >
      <div
        className="w-[460px] max-w-[92vw] rounded-xl bg-white border border-black/10 shadow-[0_20px_60px_rgba(0,0,0,0.25)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search features by name…"
          className="w-full px-4 py-3 text-[14px] outline-none border-b border-black/10"
        />
        <ul className="max-h-[300px] overflow-y-auto">
          {results.length === 0 && (
            <li className="px-4 py-3 text-[12px] text-black/40 italic">No features match</li>
          )}
          {results.map((n, i) => (
            <li
              key={n.id}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={() => pick(n.id)}
              className={`px-4 py-2 text-[13px] cursor-pointer flex items-center justify-between ${
                i === idx ? "bg-blue-500 text-white" : "text-black/80 hover:bg-black/[.04]"
              }`}
            >
              <span className="truncate">{n.data.name}</span>
              <span className={`text-[10.5px] uppercase tracking-wider ${i === idx ? "text-white/80" : "text-black/40"}`}>
                {n.data.featureType}
              </span>
            </li>
          ))}
        </ul>
        <div className="px-3 py-1.5 text-[10.5px] text-black/40 border-t border-black/10 flex gap-3">
          <span>↑↓ navigate</span><span>⏎ open</span><span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
