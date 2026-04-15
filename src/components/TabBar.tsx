"use client";
import { useEffect, useRef, useState } from "react";
import { useFM } from "@/lib/store";

export default function TabBar() {
  const tabs = useFM((s) => s.tabs);
  const activeId = useFM((s) => s.activeId);
  const switchTab = useFM((s) => s.switchTab);
  const newTab = useFM((s) => s.newTab);
  const closeTab = useFM((s) => s.closeTab);
  const renameTab = useFM((s) => s.renameTab);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="h-10 flex items-end gap-1 px-2 bg-[#eceef2] border-b border-black/10 select-none overflow-x-auto">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <Tab
            key={t.id}
            active={active}
            name={t.name}
            editing={editing === t.id}
            onActivate={() => switchTab(t.id)}
            onStartRename={() => setEditing(t.id)}
            onEndRename={() => setEditing(null)}
            onRename={(v) => renameTab(t.id, v)}
            onClose={() => closeTab(t.id)}
          />
        );
      })}
      <div className="relative flex items-center ml-1">
        <button
          className="h-7 w-7 grid place-items-center rounded-md border border-black/10 bg-white hover:bg-black/5 text-black/70 hover:text-black transition-colors"
          onClick={() => newTab({ sample: false, name: "Untitled" })}
          title="New tab"
        >
          ＋
        </button>
        <button
          className="ml-1 h-7 px-2 text-[11px] rounded-md border border-black/10 bg-white hover:bg-black/5 text-black/60 hover:text-black transition-colors"
          onClick={() => newTab({ sample: true, name: "eShop" })}
          title="New tab with sample"
        >
          + sample
        </button>
      </div>
    </div>
  );
}

function Tab({
  active, name, editing, onActivate, onStartRename, onEndRename, onRename, onClose,
}: {
  active: boolean;
  name: string;
  editing: boolean;
  onActivate: () => void;
  onStartRename: () => void;
  onEndRename: () => void;
  onRename: (v: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(name); }, [name]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  return (
    <div
      onClick={onActivate}
      onDoubleClick={onStartRename}
      className={`group relative h-8 flex items-center gap-1.5 px-2.5 pr-1 rounded-t-md border border-b-0 cursor-pointer text-[12.5px] transition-colors
        ${active
          ? "bg-white border-black/15 text-black shadow-[0_-1px_2px_rgba(0,0,0,.04)]"
          : "bg-black/[.03] border-transparent text-black/60 hover:bg-black/[.06] hover:text-black/80"}`}
      style={{ marginBottom: -1 }}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${active ? "bg-blue-500" : "bg-black/25"}`}
      />
      {editing ? (
        <input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft.trim()) onRename(draft.trim()); onEndRename(); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { if (draft.trim()) onRename(draft.trim()); onEndRename(); }
            else if (e.key === "Escape") { setDraft(name); onEndRename(); }
          }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white outline-none border border-blue-400 rounded px-1 text-[12.5px] min-w-[80px] max-w-[160px]"
        />
      ) : (
        <span className="max-w-[160px] truncate">{name}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title="Close tab"
        className="ml-0.5 w-5 h-5 grid place-items-center rounded hover:bg-black/10 text-black/40 hover:text-black text-[13px] leading-none"
      >
        ×
      </button>
    </div>
  );
}
