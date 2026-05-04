import { useReactFlow } from "@xyflow/react";
import { Minus, Plus, Maximize2, Mail } from "lucide-react";
import { useCanvasStore } from "../../store.js";

export default function BottomControls() {
  const { zoomIn, zoomOut, fitView, getZoom } = useReactFlow();
  const viewport = useCanvasStore((s) => s.viewport);
  const userEmail = "admin@fluidesigns.in"; // shown in bottom-right pill

  const zoomPct = Math.round((viewport?.zoom ?? 1) * 100);

  return (
    <>
      {/* Bottom-center: zoom controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-white rounded-xl shadow-floating border border-ink-200 px-1.5 py-1 flex items-center gap-0.5">
        <ZoomBtn onClick={() => zoomOut({ duration: 200 })} title="Zoom out">
          <Minus size={14} />
        </ZoomBtn>
        <button
          onClick={() => fitView({ duration: 300, padding: 0.2 })}
          className="px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:bg-ink-100 rounded-md min-w-[44px]"
          title="Fit to screen"
        >
          {zoomPct}%
        </button>
        <ZoomBtn onClick={() => zoomIn({ duration: 200 })} title="Zoom in">
          <Plus size={14} />
        </ZoomBtn>
        <div className="w-px h-5 bg-ink-200 mx-0.5" />
        <ZoomBtn onClick={() => fitView({ duration: 300, padding: 0.2 })} title="Fit view">
          <Maximize2 size={13} />
        </ZoomBtn>
      </div>

      {/* Bottom-right: user pill */}
      <div className="absolute bottom-4 right-4 z-30 bg-white rounded-xl shadow-floating border border-ink-200 pl-2 pr-3 py-1.5 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white text-[11px] font-semibold flex items-center justify-center">
          {(userEmail[0] ?? "?").toUpperCase()}
        </div>
        <div className="text-[11px] text-ink-700 hidden sm:flex items-center gap-1">
          <Mail size={11} className="text-ink-400" /> {userEmail}
        </div>
      </div>
    </>
  );
}

function ZoomBtn({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-md text-ink-500 hover:text-ink-900 hover:bg-ink-100"
    >
      {children}
    </button>
  );
}
