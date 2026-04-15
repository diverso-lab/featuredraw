"use client";
import Canvas from "@/components/Canvas";
import Sidebar from "@/components/Sidebar";
import TabBar from "@/components/TabBar";
import { useFM } from "@/lib/store";

export default function Page() {
  const activeId = useFM((s) => s.activeId);
  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <main className="flex-1 h-full flex flex-col">
        <TabBar />
        <div className="flex-1 relative">
          {/* keying on the active tab forces React Flow to remount → nodes get measured
              properly for the freshly loaded tab content */}
          <Canvas key={activeId} />
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-black/55 bg-white/80 backdrop-blur border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
            <span>Powered by</span>
            <a
              href="https://diversolab.us.es/"
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold text-black/80 hover:text-blue-600 transition-colors"
            >
              Diverso Lab
            </a>
            <span className="text-black/30">·</span>
            <a
              href="https://www.us.es/"
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold text-black/80 hover:text-blue-600 transition-colors"
            >
              Universidad de Sevilla
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
