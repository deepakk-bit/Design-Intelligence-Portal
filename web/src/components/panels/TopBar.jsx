import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, MessageSquare, PanelLeft } from "lucide-react";
import { useCanvasStore } from "../../store.js";

export default function TopBar() {
  const [, navigate] = useLocation();
  const name = useCanvasStore((s) => s.workspaceName);
  const setName = useCanvasStore((s) => s.setWorkspaceName);
  const toggleLeft = useCanvasStore((s) => s.toggleLeftPanel);
  const toggleRight = useCanvasStore((s) => s.toggleRightPanel);
  const leftOpen = useCanvasStore((s) => s.leftPanelOpen);
  const rightOpen = useCanvasStore((s) => s.rightPanelOpen);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  return (
    <>
      {/* Left cluster: back + name */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-white rounded-xl shadow-floating border border-ink-200 px-2 py-1.5">
        <button
          onClick={() => navigate("/")}
          className="p-1.5 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-ink-100"
          title="Back to workspaces"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          onClick={() => toggleLeft()}
          className={`p-1.5 rounded-lg ${
            leftOpen ? "text-brand-600 bg-brand-500/10" : "text-ink-500 hover:text-ink-900 hover:bg-ink-100"
          }`}
          title="Toggle agent library"
        >
          <PanelLeft size={16} />
        </button>
        <div className="w-px h-5 bg-ink-200 mx-1" />
        <img src="/assets/logo-icon.svg" className="w-5 h-5 ml-1" alt="" />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setName(draft.trim() || "Untitled workspace");
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(name);
                setEditing(false);
              }
            }}
            className="text-sm font-medium text-ink-900 bg-ink-50 px-2 py-1 rounded outline-none ring-1 ring-brand-500 min-w-[160px]"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-ink-900 px-2 py-1 rounded hover:bg-ink-100"
          >
            {name}
          </button>
        )}
      </div>

      {/* Right cluster: panel toggles */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5 bg-white rounded-xl shadow-floating border border-ink-200 px-2 py-1.5">
        <button
          onClick={() => toggleRight()}
          className={`p-1.5 rounded-lg ${
            rightOpen ? "text-brand-600 bg-brand-500/10" : "text-ink-500 hover:text-ink-900 hover:bg-ink-100"
          }`}
          title="Toggle right panel"
        >
          <MessageSquare size={16} />
        </button>
      </div>
    </>
  );
}
