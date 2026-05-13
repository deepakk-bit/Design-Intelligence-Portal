import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, MessageSquare, PanelLeft, Bookmark } from "lucide-react";
import { useCanvasStore } from "../../store.js";
import UsageChip from "./UsageChip.jsx";
import LibraryModal from "../library/LibraryModal.jsx";

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
  const [libraryOpen, setLibraryOpen] = useState(false);
  useEffect(() => setDraft(name), [name]);

  return (
    <>
      {/* Left cluster: back + name */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-white rounded-xl shadow-floating border border-ink-200 px-2 py-1.5">
        <button
          onClick={() => navigate("/")}
          aria-label="Back to workspaces"
          title="Back to workspaces"
          className="p-1.5 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-ink-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <button
          onClick={() => toggleLeft()}
          aria-label={leftOpen ? "Hide agent library" : "Show agent library"}
          aria-pressed={leftOpen}
          title="Toggle agent library"
          className={`p-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
            leftOpen ? "text-brand-600 bg-brand-500/10" : "text-ink-500 hover:text-ink-900 hover:bg-ink-100"
          }`}
        >
          <PanelLeft size={16} aria-hidden="true" />
        </button>
        <div className="w-px h-5 bg-ink-200 mx-1" aria-hidden="true" />
        <img src="/assets/logo-icon.svg" className="w-5 h-5 ml-1" alt="" aria-hidden="true" />
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
            aria-label="Workspace name"
            className="text-sm font-medium text-ink-900 bg-ink-50 px-2 py-1 rounded outline-none ring-1 ring-brand-500 min-w-[160px]"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            aria-label={`Rename workspace, currently ${name}`}
            title="Click to rename"
            className="text-sm font-medium text-ink-900 px-2 py-1 rounded hover:bg-ink-100 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {name}
          </button>
        )}
      </div>

      {/* Right cluster: usage + panel toggles */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-1 bg-white rounded-xl shadow-floating border border-ink-200 px-1.5 py-1.5">
        <UsageChip />
        <div className="w-px h-5 bg-ink-200 mx-0.5" aria-hidden="true" />
        <button
          onClick={() => setLibraryOpen(true)}
          aria-label="Open saved library"
          title="Saved library + pairing code for the Figma plugin"
          className="p-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 text-ink-500 hover:text-ink-900 hover:bg-ink-100"
        >
          <Bookmark size={16} aria-hidden="true" />
        </button>
        <button
          onClick={() => toggleRight()}
          aria-label={rightOpen ? "Hide chat panel" : "Show chat panel"}
          aria-pressed={rightOpen}
          title="Toggle chat panel"
          className={`p-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
            rightOpen ? "text-brand-600 bg-brand-500/10" : "text-ink-500 hover:text-ink-900 hover:bg-ink-100"
          }`}
        >
          <MessageSquare size={16} aria-hidden="true" />
        </button>
      </div>
      {libraryOpen && <LibraryModal onClose={() => setLibraryOpen(false)} />}
    </>
  );
}
